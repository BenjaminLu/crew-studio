import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// M6 checks: the generalized retro over a recorded firstmate log (the four repeat
// classes), proposal cards with their expected metric and replay evals (stub
// provider), never re-proposing a rejected one, adoption and before/after
// tracking, chat-driven skill edits for any workflow role, and the triggers.
// A temporary state and firstmate checkout; nothing real is touched.   bun tests/m6.ts
import { cpSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { freePort, waitUp } from "./boot.mjs";
process.env.CREW_SESSION_TOKEN ??= "test-session"; // the server's write guard: a local client sends it as x-crew-session

let pass = 0, fail = 0;
const ok = (c: boolean, name: string, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const here = import.meta.dir, root = join(here, "..");
for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete process.env[k];
const sha = (f: string) => createHash("sha256").update(readFileSync(f)).digest("hex");

// ---------- unit: detectors, metrics, triggers ----------
{
  const { RawLog } = await import("../src/rawlog");
  const { Retros, detect, beforeAfter } = await import("../src/retro");
  const cfg = (Bun as any).YAML.parse(readFileSync(join(root, "workflows/code.retro.yaml"), "utf8"));
  const log = new RawLog(join(here, "fixture/retro/events.jsonl")); const evs = log.poll();
  const to = evs.at(-1)!.ts;
  const dir = mkdtempSync(join(tmpdir(), "crew-m6-unit-"));
  const R = new Retros(dir);
  ok(R.due(cfg, evs, to)?.startsWith("every 7 days") === true, "with no retro yet, the weekly trigger is due");
  const r = R.run(cfg, evs, { trigger: "test", days: 14, to: new Date(Date.parse(to) + 1000).toISOString() });
  const c = Object.fromEntries(r.classes.map((x) => [x.id, x]));
  ok(c["tests-line-cap"].found && c["tests-line-cap"].groups.length >= 2, "tests file over the 1200-line cap: found, repeating across tasks", JSON.stringify(c["tests-line-cap"].groups));
  ok(c["ci-shard-budget"].found && c["ci-shard-budget"].examples.some((e) => /shard \d\/\d/.test(e.text)), "CI shard budget overruns: found from shard-job failures");
  ok(c["round-time-cap"].found && c["round-time-cap"].examples.every((e) => { const s = parseInt(e.text); return s >= 3540 && s <= 3840; }), "rounds killed at the ~3600 s cap: found, every hit within the cap band");
  ok(c["brief-wrong-round"].found && c["brief-wrong-round"].count >= 2, "brief bound to the wrong round: found");
  ok(r.metrics.find((m) => m.id === "merged")!.value! > 0 && r.metrics.find((m) => m.id === "round_p90")!.value! > r.metrics.find((m) => m.id === "round_p50")!.value!, "metrics come from the event log (merges, round p50 < p90)");
  ok(R.due(cfg, evs, to) === null, "right after a retro, no trigger is due (nothing new)");
  const later = [...evs, ...[1, 2, 3, 4].map((i) => ({ seq: evs.length + i, ts: new Date(Date.parse(to) + 3600e3 * i).toISOString(), type: "crew_status", task: `T-90${i}`, actor: `worker-x-t90${i}-r1`, pr: null, summary: { en: "x" },
    data: { coverage: { gaps: ["acceptance association unavailable: Assertion every file under tests stays within 1200 lines"] } } }))];
  ok(/repeats since the last retro/.test(R.due(cfg, later as any, new Date(Date.parse(to) + 5 * 3600e3).toISOString()) ?? ""), "a class repeating on 4 new tasks fires the repeat trigger");
  const d = cfg.classes.find((x: any) => x.id === "brief-wrong-round");
  const ba = beforeAfter(d, evs, to, 14, to);
  ok(ba.beforePerWeek > 0 && ba.afterPerWeek === null, "before/after tracking: a baseline per week, no 'after' until a day has passed");
  ok(detect({ id: "x", title: "x", kind: "regex", field: "summary.en", pattern: "zzzz-not-there", group: "task" }, evs).length === 0, "a class not in the data is reported as not found, not invented");
}

// ---------- the server: retro → proposals → evals → adopt/reject; chat edits ----------
const tmp = mkdtempSync(join(tmpdir(), "crew-m6-"));
const fmRoot = join(tmp, "fm"), state = join(fmRoot, "state"), data = join(tmp, "data");
mkdirSync(join(state, "pending"), { recursive: true }); mkdirSync(data);
cpSync(join(here, "fixture/retro/events.jsonl"), join(state, "events.jsonl"));
for (const r of ["worker", "reviewer", "designer"]) { mkdirSync(join(fmRoot, "skills", r), { recursive: true }); cpSync(join(here, "fixture/skills", `${r === "designer" ? "reviewer" : r}.md`), join(fmRoot, "skills", r, "SKILL.md")); }
const before = { events: sha(join(state, "events.jsonl")), worker: sha(join(fmRoot, "skills/worker/SKILL.md")), mtime: statSync(join(fmRoot, "skills/worker/SKILL.md")).mtimeMs };
const port = await freePort();
const app = Bun.spawn(["bun", "src/server.ts"], { cwd: root, stdout: "pipe", stderr: "pipe", env: { ...process.env, CREW_FM_STATE: state, CREW_PORT: String(port), CREW_GH: "0", CREW_READONLY: "1", CREW_DATA: data,
  CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_GH_NO_CLI: "1", CREW_CLAUDE_BIN: "/nonexistent/claude", CREW_CODEX_BIN: "/nonexistent/codex",
  HOME: join(tmp, "home"), CREW_MAIN_PROJECT: join(tmp, "proj"), CREW_FILE_ALLOW: tmp } });
const base = `http://127.0.0.1:${port}`;
await waitUp(base, app);
const get = async (p: string) => (await fetch(base + p)).json();
const post = async (p: string, b: any = {}) => { const r = await fetch(base + p, { method: "POST", headers: { "content-type": "application/json", "x-crew-session": process.env.CREW_SESSION_TOKEN }, body: JSON.stringify(b) }); return { ...(await r.json()), http: r.status }; };
const until = async (f: () => Promise<boolean>, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await Bun.sleep(150); } return false; };
const lastTs = readFileSync(join(state, "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l).ts).sort().at(-1);

try {
  const ov = await get("/api/improve");
  const code = ov.flows.find((f: any) => f.id === "code");
  ok(code?.retro && code.roles.map((r: any) => r.id).join() === "worker,reviewer,designer", "the code workflow lists its roles and has a retro config");
  ok((await post("/api/improve/settings", { evalMode: "model", provider: "stub" })).evalMode === "model", "eval mode: model replay on the stub provider");

  const rep = await post("/api/improve/retro", { workflow: "code", days: 14, to: new Date(Date.parse(lastTs) + 1000).toISOString() });
  ok(rep.classes?.filter((c: any) => c.found).length === 4, "the retro finds all four repeat classes", JSON.stringify(rep.classes?.map((c: any) => [c.id, c.found, c.note])));
  ok(rep.proposals?.length === 4 && rep.edits.every((e: any) => e.status === "offered"), "each class becomes a proposal, offered only after its evals ran", JSON.stringify(rep.edits?.map((e: any) => [e.id, e.status, e.error])));
  const e0 = rep.edits[0];
  ok(e0.expected?.metric && typeof e0.expected.baselinePerWeek === "number" && e0.expected.target === 0, "a proposal carries the metric it should move: baseline per week and target");
  ok(rep.edits.every((e: any) => e.evals.cases > 0 && e.evals.before.mode === "model" && e.evals.before.provider === "stub"), "every proposal's evals ran as model replays on the stub provider");
  ok(rep.edits.every((e: any) => e.evals.after.passed > e.evals.before.passed), "each proposed rule makes its replay cases pass (after > before)", JSON.stringify(rep.edits.map((e: any) => [e.class, e.evals.before.passed, e.evals.after.passed, e.evals.cases])));
  ok(rep.edits.every((e: any) => e.evals.own.total >= 2 && e.evals.own.after === e.evals.own.total && e.evals.own.before < e.evals.own.after && e.evals.regressions.length === 0), "each rule passes its own class's cases with no regression on the others", JSON.stringify(rep.edits.map((e: any) => [e.class, e.evals.own, e.evals.regressions])));
  const full = await get(`/api/improve/edits/${e0.id}`);
  ok(full.hunks.length >= 1 && full.hunks.flat().some((o: any) => o.op === "+" && o.text.includes("- ")), "the edit page shows the diff (before → after)");
  ok(full.evidence?.length >= 2 && full.evidence.every((h: any) => Number.isInteger(h.seq)), "the proposal cites the recorded events it came from");
  const cases = await get(`/api/improve/evals/code/worker`);
  ok(cases.length >= 4 && cases.every((c: any) => c.from.seq != null && c.from.retro === rep.id), "eval cases were replayed from recorded runs (each names its event)");

  const capped = rep.edits.find((e: any) => e.class === "tests-line-cap");
  const rj = await post(`/api/improve/edits/${capped.id}/reject`, { reason: "we will lift the cap instead" });
  ok(rj.http === 200 && (await get(`/api/improve/edits/${capped.id}`)).status === "rejected", "reject a proposal");
  const rep2 = await post("/api/improve/retro", { workflow: "code", days: 14, to: new Date(Date.parse(lastTs) + 2000).toISOString() });
  ok(rep2.proposals.length === 0 && rep2.skipped.some((s: any) => s.class === "tests-line-cap" && /rejected before/.test(s.why)), "a rejected proposal is never proposed again", JSON.stringify(rep2.skipped));
  ok(rep2.skipped.filter((s: any) => /already proposed/.test(s.why)).length === 3, "an open proposal is not proposed twice");

  const cap = rep.edits.find((e: any) => e.class === "round-time-cap");
  const ad = await post(`/api/improve/edits/${cap.id}/adopt`);
  ok(ad.http === 200 && ad.adoptedVersion === 2, "adopt: Studio's worker skill becomes v2", JSON.stringify(ad).slice(0, 300));
  const sk = await get("/api/improve/skills/code/worker");
  ok(sk.versions.length === 2 && sk.text.includes("3600 seconds") && sk.versions[1].edit === cap.id, "v2 holds the rule and names the proposal that made it");
  ok(ad.tracking && typeof ad.tracking.beforePerWeek === "number", "an adopted proposal is tracked before/after from the event log");
  const patch = await (await fetch(base + "/api/improve/skills/code/worker/patch")).text();
  ok(patch.startsWith("--- a/code/worker/SKILL.md") && patch.includes("+- A round has about 3600 seconds"), "a patch for firstmate's own copy (Studio never writes it)");
  ok(sha(join(fmRoot, "skills/worker/SKILL.md")) === before.worker && statSync(join(fmRoot, "skills/worker/SKILL.md")).mtimeMs === before.mtime, "firstmate's skill file is untouched");
  const other = rep.edits.find((e: any) => e.class === "brief-wrong-round");
  const ad2 = await post(`/api/improve/edits/${other.id}/adopt`);
  ok(ad2.http === 200 && ad2.adoptedVersion === 3 && (await get("/api/improve/skills/code/worker")).text.includes("3600 seconds"), "a second proposal adopts onto the moved skill (rule re-applied, nothing lost)");

  // chat-driven edit of another role
  const ce = await post("/api/improve/edits", { workflow: "code", role: "reviewer", request: "Reject a round whose brief names another head", provider: "stub" });
  ok(ce.http === 200 && ce.kind === "chat" && ce.status !== "failed", "a chat request starts an edit of the reviewer's skill");
  ok(await until(async () => (await get(`/api/improve/edits/${ce.id}`)).status === "offered"), "the editor agent edits a copy, evals run, the edit is offered");
  const cf = await get(`/api/improve/edits/${ce.id}`);
  ok(cf.stat.added >= 1 && cf.hunks.flat().some((o: any) => o.op === "+" && o.text.includes("another head")) && cf.job?.provider === "stub" && cf.job.tools >= 2, "the diff holds the change; the job used only the skill tools", JSON.stringify(cf.job?.log?.slice(-4)));
  ok((await post(`/api/improve/edits/${ce.id}/adopt`)).adoptedVersion === 2, "adopt the chat edit: reviewer v2");
  const nc = await post("/api/improve/edits", { workflow: "code", role: "designer", request: "STUB_NOCHANGE please", provider: "stub" });
  ok(await until(async () => (await get(`/api/improve/edits/${nc.id}`)).status === "no-change"), "an editor that changes nothing makes no offer");
  ok((await post("/api/improve/edits", { workflow: "code", role: "nobody", request: "x" })).http === 400, "an unknown role is refused");
  ok((await fetch(base + "/api/tools/skill_read", { method: "POST", body: "{}" })).status === 403, "agent tools refuse a call without the job's token");
  const tr = await post("/api/improve/triggers", {});
  const trR = await Promise.all(tr.ran.map((id: string) => get(`/api/improve/retro/${id}`)));
  ok(!trR.some((r: any) => r.workflow === "code") && trR.some((r: any) => r.workflow === "change" && /every 7 days/.test(r.trigger)) && trR.some((r: any) => r.workflow === "file-organization"), "triggers: the code retro is not due right after one; workflows never retro'd (change, the file-organization pack) are", JSON.stringify(trR.map((r: any) => [r.workflow, r.trigger])));
  const chat = await (await fetch(base + "/api/chat", { method: "POST", headers: { "content-type": "application/json", "x-crew-session": process.env.CREW_SESSION_TOKEN }, body: JSON.stringify({ message: "STUB_SKILL make the worker checkpoint" }) })).text();
  const eid = /#\/edit\/(E-\d+)/.exec(chat)?.[1];
  ok(!!eid && (await get(`/api/improve/edits/${eid}`)).kind === "chat", "the status chat starts a skill edit with its skill_edit tool (offered, never adopted by itself)");
  ok(await until(async () => (await get(`/api/improve/edits/${eid}`)).status === "offered"), "the chat-started edit is offered after its evals");
  const page = await get("/api/improve");
  ok(page.reports.length === 2 + tr.ran.length && page.rejected.length === 1 && page.edits.length >= 7, "the overview lists reports, edits and the rejected list");
  ok(sha(join(state, "events.jsonl")) === before.events, "the event log is read, never written");
} catch (e: any) { fail++; console.log(`  FAIL  exception ${e?.stack ?? e}`); }
finally { app.kill(); }
console.log(`\nm6: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
