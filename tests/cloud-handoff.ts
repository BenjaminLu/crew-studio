import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir, assertTempRepo } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
// Cloud hand-off, the parts with no Task (src/domain/cloud-handoff.ts): the setup secret (0600, never shown), the routine
// fire provider against a loopback stub of the documented API (session id and URL; 401, 429 with Retry-After, 5xx, a lost
// answer: one request each, never retried), the blocking rules, the one prompt (snapshot: branch and completion condition
// as the confirm view shows them), the Handoff-Status trailer (untrusted), the sessionUrl check and the Doctor rows.
//   bun tests/cloud-handoff.ts        (UPDATE_SNAPSHOT=1 rewrites tests/fixtures/cloud-handoff/prompt.txt)
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { suite } from "./rt-harness";
import { CloudSetupStore, ClaudeRoutineProvider, FIRE_TEXT_MAX, handoffBlockers, handoffPrompt, handoffStatus, sessionUrlOff, type HandoffFacts, type BlockerInput } from "../src/domain/cloud-handoff";
import { redactText } from "../src/secure";
import { must } from "../src/git";
import { FIXTURE_ROUTINE, FIXTURE_TOKEN, routineFireStub } from "./lib/routine-fire-stub";

const { ok, end } = suite("cloud-handoff");
const temp = checkedTempDir("cloud-handoff-");

// ---------- the setup: one Studio secret file, 0600; the token never comes back ----------
{
  const data = join(temp, "data"); mkdirSync(data, { recursive: true });
  const store = new CloudSetupStore(data);
  ok(!store.status().configured, "nothing is set up at first");
  let refused = ""; try { store.save({ routineId: "routine_1", token: FIXTURE_TOKEN, repos: ["fixture/money-kit"] }); } catch (e: any) { refused = e.message; }
  ok(/trig_/.test(refused), "a routine id that is not trig_… is refused", refused);
  refused = ""; try { store.save({ routineId: FIXTURE_ROUTINE, token: "not a token", repos: ["fixture/money-kit"] }); } catch (e: any) { refused = e.message; }
  ok(/sk-ant-oat01-/.test(refused), "a token that is not a routine token is refused", refused);
  const s = store.save({ routineId: FIXTURE_ROUTINE, token: FIXTURE_TOKEN, repos: ["fixture/money-kit", "fixture/money-kit"] });
  ok(s.configured && s.routineId === FIXTURE_ROUTINE && s.token === true && s.repos.join() === "fixture/money-kit" && !JSON.stringify(s).includes(FIXTURE_TOKEN), "saved: the status names the routine and its repositories, never the token", JSON.stringify(s));
  ok((statSync(store.file()).mode & 0o777) === 0o600, "the setup file is 0600", (statSync(store.file()).mode & 0o777).toString(8));
  ok(redactText(`token ${FIXTURE_TOKEN} here`).includes("[credential removed]") && !redactText(`x ${FIXTURE_TOKEN}`).includes(FIXTURE_TOKEN), "the token is a registered Studio secret: the redactor removes it");
  store.save({ routineId: FIXTURE_ROUTINE, repos: ["fixture/money-kit", "fixture/coffee"] });
  ok(store.read()!.token === FIXTURE_TOKEN && store.status().repos.length === 2, "an empty token keeps the saved one");
  ok(!store.clear().configured && !existsSync(store.file()), "clear removes the file");
}

// ---------- the provider: the documented fire API, one request per call, never retried ----------
{
  const stub = routineFireStub(), p = new ClaudeRoutineProvider(stub.origin, 3000);
  const setup = { version: 1 as const, routineId: FIXTURE_ROUTINE, token: FIXTURE_TOKEN, repos: ["fixture/money-kit"], savedAt: "2026-11-18T00:00:00Z" };
  try {
    let threw = ""; try { new ClaudeRoutineProvider("https://example.invalid"); } catch (e: any) { threw = e.message; } ok(/api\.anthropic\.com/.test(threw), "the provider talks only to api.anthropic.com (a loopback stub in tests)");
    const okay = await p.fire(setup, "hello cloud");
    const c = stub.calls[0];
    ok(okay.ok && /^session_01Fixture/.test((okay as any).sessionId) && (okay as any).url.endsWith((okay as any).sessionId) && stub.calls.length === 1 && c.path === `/v1/claude_code/routines/${FIXTURE_ROUTINE}/fire` && c.auth === `Bearer ${FIXTURE_TOKEN}` && !!c.version && c.type === "application/json" && c.text === "hello cloud",
      "a fire POSTs the text with the bearer token and anthropic-version, and returns the session id and URL", JSON.stringify([okay, c]));
    for (const [status, retryAfter, re] of [[401, undefined, /401/], [429, "1800", /429/], [500, undefined, /500/], [503, undefined, /503/]] as const) {
      stub.set({ status, retryAfter }); const before = stub.calls.length, out: any = await p.fire(setup, "again");
      ok(!out.ok && out.status === status && stub.calls.length === before + 1 && re.test(out.en) && !/fake-vendor-detail/.test(out.en + out.zh) && (status === 429 ? out.retryAfter === "1800" && /1800/.test(out.en) : out.retryAfter === null),
        `${status}: one request, no retry, its class only${status === 429 ? ", with Retry-After" : ""}`, JSON.stringify(out));
    }
    stub.set({ status: 200, body: { type: "routine_fire", claude_code_session_id: "session_01Fixture9999", claude_code_session_url: "https://example.invalid/x" } });
    const odd: any = await p.fire(setup, "odd"); ok(!odd.ok && odd.lost === true, "an answer without a matching claude.ai session URL is refused, and says a session may have started", JSON.stringify(odd));
    const before = stub.calls.length, long: any = await p.fire(setup, "x".repeat(FIRE_TEXT_MAX + 1));
    ok(!long.ok && stub.calls.length === before && /65536/.test(long.en), "text over 65,536 characters is never sent");
    stub.stop(); const lost: any = await p.fire(setup, "nobody there");
    ok(!lost.ok && lost.lost === true && lost.status === null && /claude\.ai\/code/.test(lost.en), "no answer: not retried, and the captain is told a session may have started", JSON.stringify(lost));
  } finally { stub.stop(); }
}

// ---------- the blocking rules (acceptance 7) ----------
{
  const base: BlockerInput = { profile: null, worker: true, roundLive: true, secrets: [], egress: [], github: true, setup: { configured: true, routineId: FIXTURE_ROUTINE, repos: ["fixture/money-kit"], token: true, savedAt: null },
    repository: "fixture/money-kit", owner: "User", policy: null, active: false, promptChars: 1000 };
  const codes = (o: Partial<BlockerInput>) => handoffBlockers({ ...base, ...o }).map((b) => b.code);
  ok(codes({}).length === 0, "a personal repository bound to the routine, no secrets, a live round: nothing blocks");
  ok(codes({ profile: "issue" }).includes("profile") && codes({ profile: "lan" }).includes("profile"), "an issue or lan profile is refused");
  ok(codes({ secrets: ["DEPLOY_KEY"] }).includes("secrets") && codes({ egress: ["registry.npmjs.org"] }).includes("egress"), "steps that need secrets or egress.allow are refused");
  ok(codes({ owner: "Organization" }).includes("org-policy") && !codes({ owner: "Organization", policy: "allow" }).includes("org-policy") && codes({ owner: "unknown" }).includes("org-policy"), "an organisation repository (or one GitHub does not say) needs cloud_handoff: allow");
  ok(codes({ policy: "deny" }).includes("policy"), "cloud_handoff: deny refuses any repository");
  ok(codes({ repository: "fixture/other" }).includes("routine-repo"), "a repository the routine is not bound to is refused");
  ok(codes({ roundLive: false }).includes("round") && codes({ worker: false }).includes("workflow") && codes({ github: false }).includes("github") && codes({ active: true }).includes("active") && codes({ promptChars: FIRE_TEXT_MAX + 1 }).includes("prompt"), "no live round, no build step, no GitHub, already handed off, an over-long prompt: refused");
  ok(codes({ setup: { configured: false, routineId: null, repos: [], token: false, savedAt: null } }).includes("setup"), "no setup: refused, pointing at the Doctor");
  ok(handoffBlockers({ ...base, owner: "Organization" }).every((b) => b.en && /[一-鿿]/.test(b.zh)), "every reason is said in English and Traditional Chinese");
}

// ---------- the one prompt (acceptance 8): a snapshot ----------
{
  const facts: HandoffFacts = { task: "R-162", title: "Add a percent function", request: "Add a percent function to money-kit", repository: "fixture/money-kit", base: "main", branch: "crew/handoff/R-162-1",
    baseHead: "a".repeat(40), baseCommit: "b".repeat(40), goal: { title: "Add percent()", what: "A percent of an amount in cents, rounded to the cent.", why: ["Prices need discounts."] },
    doneLines: ["percent(1999, 15) is 300 (test/percent.test.ts, planned fail-first)"], scope: ["src/percent.ts", "test/percent.test.ts"], doneSteps: ["Capture intent", "Worktree", "Spec", "Dispatch card", "Door"],
    commits: [{ sha: "c".repeat(40), subject: "feat: add percent (round 1)" }], worker: "Build round", after: ["Review request", "CI", "Fresh reviewer"], tests: ["bun test"],
    rules: { text: "# Operating rules (set by the captain)\nNone set.", hash: "0".repeat(64) } };
  const text = handoffPrompt(facts), file = join(import.meta.dir, "fixtures", "cloud-handoff", "prompt.txt");
  if (process.env.UPDATE_SNAPSHOT === "1") { mkdirSync(join(import.meta.dir, "fixtures", "cloud-handoff"), { recursive: true }); writeFileSync(file, text); }
  ok(existsSync(file) && readFileSync(file, "utf8") === text, "the prompt matches its snapshot", existsSync(file) ? "" : "no snapshot");
  ok(text.includes(`Push your commits to ${facts.branch} only`) && text.includes("do not open a pull request") && text.includes("`bun test`") && text.includes("Handoff-Status: done") && text.includes("Handoff-Status: blocked") && text.includes(facts.rules.text),
    "it names the branch, no PR / no merge, the test command, the trailer and the operating rules");
  ok(text.split("\n").filter((l) => l.includes(facts.branch)).length >= 3 && !/HANDOFF\.md/.test(text), "the branch is the one the confirm view shows; no HANDOFF.md on the branch");
}

// ---------- Handoff-Status (untrusted), sessionUrl ----------
{
  ok(JSON.stringify(handoffStatus("feat: x\n\nHandoff-Status: done all three done lines pass")) === JSON.stringify({ status: "done", reason: "all three done lines pass" }), "the trailer and its reason are read");
  ok(handoffStatus("x\n\nHandoff-Status: blocked‮ evil\u0007 text").status === "blocked" && !/[‮\u0007]/.test(handoffStatus("x\nHandoff-Status: blocked‮ evil\u0007").reason ?? ""), "control and direction characters are cleaned from the reason");
  ok(handoffStatus("no trailer here\nHandoff-Status: maybe").status === null, "anything but done or blocked is no status");
  const repo = join(temp, "repo"); mkdirSync(repo); assertTempRepo(repo); must(repo, ["init", "-qb", "main"]); writeFileSync(join(repo, "a"), "a"); must(repo, ["add", "."]); must(repo, ["commit", "-qm", "a"]);
  ok(!sessionUrlOff(repo, must(repo, ["rev-parse", "HEAD"])), "no .claude/settings.json: session links are on");
  mkdirSync(join(repo, ".claude")); writeFileSync(join(repo, ".claude", "settings.json"), JSON.stringify({ attribution: { sessionUrl: false } })); must(repo, ["add", "."]); must(repo, ["commit", "-qm", "settings"]);
  ok(sessionUrlOff(repo, must(repo, ["rev-parse", "HEAD"])), "a committed attribution.sessionUrl: false turns them off");
}
end();
