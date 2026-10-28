import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
// A tainted Task: work drawn from untrusted issue text (an issue triage's work package; params._tainted, Studio's own mark,
// set only by Firstmate's proposeTainted). It never touches GitHub: it stops reviewed on its local branch, no push, no pull
// request, no GitHub call of any kind. Its commits name no issue and mention no one, its review runs the tests whatever
// reviewer.mode says, and it runs only in the OS sandbox: never in local unrestricted mode, never under a sandbox-off grant
// (src/runtime/engine.ts taintRefusal: steps, agent turns, checks and card answers). Offline: stub providers, temp data.
//      bun tests/tainted-task.ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { harness, suite, until, Y } from "./rt-harness";
import { must } from "../src/git";
const { ok, end } = suite("tainted-task");
const root = join(import.meta.dir, "..");
const { withoutGitHubLinks: W } = await import("../src/domain/pull-template");
const { GitHubPrAdapter } = await import("../src/adapters/github");
const { RoundBlocked } = await import("../src/round-blocked");

// --- the text: every reference GitHub links becomes "an issue", every mention loses its @ ---
const refs = /#\d|GH-\d|\/issues\/\d|\/pulls?\/\d|\/discussions\/\d|(^|[^\w`])@\w/im;
for (const [t, why] of [["Fixes #12", "a closing keyword"], ["Refs #12", "a plain reference"], ["see #3 and #4", "two bare references"], ["**Closes**: fixture/project#7", "another repository's form, with emphasis"],
  ["Resolved https://github.com/fixture/project/issues/9#issuecomment-1", "an issue URL"], ["like https://ghe.example/o/r/pull/5", "a pull request URL on another host"], ["GH-21 again", "GH-n"],
  ["see www.github.com/o/r/issues/12", "a www. URL without a scheme"], ["https://github.com/o/r/discussions/12", "a discussion"], ["as in ../../issues/12 above", "a relative issues path"], ["(#5)", "a reference in parentheses"]] as const)
  ok(!refs.test(W(t)) && /an issue/.test(W(t)), `no issue reference survives: ${why}`, W(t));
for (const [t, want, why] of [["thanks @octocat", "thanks octocat", "a user"], ["cc @fixture-org/core-team please", "cc fixture-org/core-team please", "a team"]] as const)
  ok(W(t) === want, `an @mention loses its @: ${why}`, W(t));
for (const [t, why] of [["## Door\ntwo-way\n\n# Title", "markdown headings"], ["color: #123456;", "a CSS color"], ["a &#123; entity", "an HTML entity"], ["mail me@example.com", "an email address"],
  ["https://github.com/o/r/blob/main/src/url.ts#12", "a blob URL's anchor"], ["run `git log #12 @octocat` here", "an inline code span"], ["```\nFixes #12 @octocat\n```", "a fenced code block"]] as const)
  ok(W(t) === t, `left as written: ${why}`, W(t));

// --- the one rule: a tainted run goes on only in the OS sandbox ---
const unrestricted = async (f: () => Promise<void>, data: string) => { process.env.CREW_LOCAL_UNRESTRICTED = "1"; process.env.CREW_LOCAL_DEPENDENCY_ROOT = join(data, "deps");
  try { await f(); } finally { delete process.env.CREW_LOCAL_UNRESTRICTED; delete process.env.CREW_LOCAL_DEPENDENCY_ROOT; } };
const flow = Y({ id: "plain-hook", name: "plain-hook", version: 1, params: {}, roles: [], nodes: [{ id: "go", kind: "hook", label: "Go", do: "fixture.go", x: 0, y: 0 }, { id: "end", kind: "hook", label: "End", x: 1, y: 0 }], edges: [["go", "end", "pass"]] });
const cardFlow = Y({ id: "plain-card", name: "plain-card", version: 1, params: {}, roles: [], nodes: [{ id: "ask", kind: "card", label: "Ask", card: { body: { en: "Pick.", "zh-TW": "選一個。" }, options: [{ id: "go", label: "Go", labelZh: "繼續" }, { id: "stop", label: "Stop", labelZh: "停", hold: true }] }, x: 0, y: 0 },
  { id: "end", kind: "hook", label: "End", x: 1, y: 0 }, { id: "held", kind: "hook", label: "Held", args: { result: "closed" }, x: 1, y: 1 }], edges: [["ask", "end", "go"], ["ask", "held", "stop"]] });
{ const H = await harness([flow, cardFlow]), E = H.engine; let ran = 0, boom = false; E.actions["fixture.go"] = async () => { ran++; if (boom) throw new Error("fixture failure"); return { outcome: "pass" }; };
  const done = (id: string) => until(() => ["succeeded", "failed", "cancelled"].includes(E.get(id)!.status), 20000);
  const plain = E.start({ workflow: "plain-hook", params: {} }); await done(plain.id);
  ok(E.get(plain.id)!.status === "succeeded" && ran === 1 && E.taintRefusal(E.get(plain.id)!) === null, "an untainted run runs as before");
  await unrestricted(async () => {
    const loose = E.start({ workflow: "plain-hook", params: {} }); await done(loose.id);
    ok(E.get(loose.id)!.status === "succeeded" && ran === 2, "local unrestricted mode still runs untainted work");
    const t = E.start({ workflow: "plain-hook", params: { _tainted: "issue-text" } }); await done(t.id);
    ok(E.get(t.id)!.status === "failed" && ran === 2 && /untrusted issue text.*CREW_LOCAL_UNRESTRICTED/.test(String(E.get(t.id)!.nodes.go?.error)), "in local unrestricted mode a tainted run starts no step", String(E.get(t.id)!.nodes.go?.error));
    let turn = ""; try { E.roundSandbox({ run: E.get(t.id)!, log() {}, policy: () => [] } as any, null); } catch (e: any) { turn = e instanceof RoundBlocked ? e.message : `not blocked: ${e?.message}`; }
    ok(/CREW_LOCAL_UNRESTRICTED/.test(turn), "nor does an agent turn of it open (roundSandbox)", turn);
  }, H.data);
  const g = E.grants.add({ kinds: ["sandbox-off"], until: "2099-01-01T00:00:00Z" }, "captain (desktop)");
  const off = E.start({ workflow: "plain-hook", params: { _tainted: "issue-text" } }); await done(off.id);
  ok(E.get(off.id)!.status === "failed" && ran === 2 && new RegExp(`sandbox-off grant ${g.id}`).test(String(E.get(off.id)!.nodes.go?.error)), "under a sandbox-off grant a tainted run starts no step", String(E.get(off.id)!.nodes.go?.error));
  let turn = ""; try { E.roundSandbox({ run: E.get(off.id)!, log() {}, policy: () => [] } as any, null); } catch (e: any) { turn = e instanceof RoundBlocked ? e.message : `not blocked: ${e?.message}`; }
  ok(new RegExp(`sandbox-off grant ${g.id}`).test(turn), "under a sandbox-off grant an agent turn of it opens neither (roundSandbox)", turn);
  E.grants.revoke(g.id, "captain (desktop)");
  // a card raised in the sandbox: once the sandbox is off, an answer that carries the run on is refused; holding it is not
  const asked = E.start({ workflow: "plain-card", params: { _tainted: "issue-text" } }); await until(() => E.cards.list({ run: asked.id, open: true }).length === 1);
  const g2 = E.grants.add({ kinds: ["sandbox-off"], until: "2099-01-01T00:00:00Z" }, "captain (desktop)"), card = E.cards.list({ run: asked.id, open: true })[0];
  let refused = ""; try { await E.answer(card.id, { choice: "go", by: "captain" }); } catch (e: any) { refused = String(e?.message); }
  ok(/sandbox-off grant/.test(refused) && E.cards.get(card.id)?.status === "open", "under a sandbox-off grant an answer that carries a tainted run on is refused, the card left open", refused);
  await E.answer(card.id, { choice: "stop", by: "captain" }); await done(asked.id);
  ok(E.get(asked.id)!.status === "succeeded" && E.get(asked.id)!.result === "closed", "holding it is always allowed", JSON.stringify([E.get(asked.id)!.status, E.get(asked.id)!.result, E.get(asked.id)!.error]));
  E.grants.revoke(g2.id, "captain (desktop)");
  const back = E.start({ workflow: "plain-hook", params: { _tainted: "issue-text" } }); await done(back.id);
  ok(E.get(back.id)!.status === "succeeded" && ran === 3, "in the OS sandbox a tainted run runs");
  // a new Task from its failure card repeats as a tainted one
  boom = true; const failed = E.start({ workflow: "plain-hook", params: { _tainted: "issue-text" } }); await done(failed.id); boom = false;
  await until(() => !!E.get(failed.id)!.failureCard, 5000); const fc = E.cards.get(E.get(failed.id)!.failureCard!)!;
  const before = new Set(E.list().map((r) => r.id)); await E.answer(fc.id, { choice: "new-task", by: "captain" });
  const again = E.list().find((r) => !before.has(r.id));
  ok(fc.options.some((o: any) => o.id === "new-task") && again?.params._tainted === "issue-text", "a new Task started from a tainted Task's failure card is tainted too", JSON.stringify(again?.params));
  H.stop(); }

// --- Firstmate: only Studio marks a proposal tainted, and the Task the captain dispatches carries it ---
{ const { installFirstmate } = await import("../src/firstmate"); const { Projects } = await import("../src/doors"); const { bundledText } = await import("../src/bundled");
  const local = Y({ id: "local-code", kind: "code", name: "Local code", version: 1, params: { project: {}, base: {} }, roles: [], nodes: [{ id: "wait", kind: "card", label: "Wait", card: { body: { en: "A fixture card: pick an option.", "zh-TW": "測試用卡片：請選一個選項。" }, options: [{ id: "close", label: "Close", labelZh: "關閉" }] } }], edges: [] });
  const data = join(checkedTempDir("crew-tainted-fm-"), "data"), H = await harness([bundledText("workflows/v2/firstmate-proposal.wf.yaml")!, local], { data }), E = H.engine;
  const repo = join(H.data, "demo-repo"); mkdirSync(repo, { recursive: true });
  for (const a of [["init", "-qb", "main"], ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-q", "--allow-empty", "-m", "Fixture"]]) must(repo, a);
  writeFileSync(join(H.data, "projects.json"), JSON.stringify([{ id: "sandbox", name: "sandbox", path: repo, base: "main", sensitive: [], proposed: null, proposedAt: null, approvedAt: null, enabled: true }]));
  let seat = ""; const tools = installFirstmate(E, new Projects(H.data), { crewSeatGate: async () => { if (seat) { const run = seat; seat = ""; throw Object.assign(new Error("a seat needs the captain"), { seatRun: run }); } } }); E.load();
  const owner = (key: string) => ({ key, captain: true, text: "Fix issue 3 of the project", live: () => true });
  const args = { workflow: "local-code", version: 1, title: "Fix issue 3 (P-1)", text: "Fix GitHub issue 3", params: { project: "sandbox" } };
  try {
    let forged = ""; try { await tools.call("studio_propose_work", { ...args, params: { project: "sandbox", _tainted: "no" } }, owner("forged")); } catch (e: any) { forged = String(e?.message); }
    ok(/safe declared parameters/.test(forged), "a model cannot set the taint, nor clear it: no _ parameter is accepted", forged);
    const seatRun = E.start({ workflow: "local-code", version: 1, params: { project: "sandbox" } }).id; seat = seatRun;
    let held = ""; try { await tools.proposeTainted(args, owner("held")); } catch (e: any) { held = String(e?.message); }
    ok(/seat/.test(held), "a proposal held for a seat card waits", held);
    const resumed = await tools.resumeHeld(seatRun); const pid = resumed[0]?.proposal;
    ok(!!pid && JSON.parse(E.get(pid)!.params.target).params._tainted === "issue-text", "proposed again once the seat is approved, it is still tainted", JSON.stringify(resumed));
    const p: any = await tools.proposeTainted(args, owner("direct"));
    await until(() => E.cards.list({ run: p.proposal, open: true }).some((c: any) => c.kind === "dispatch"), 20000);
    const d = E.cards.list({ run: p.proposal, open: true }).find((c: any) => c.kind === "dispatch")!;
    await E.answer(d.id, { choice: "approve", by: "captain" }); await until(() => !!E.get(p.proposal)?.ctx.childRun, 20000);
    const child = E.get(E.get(p.proposal)!.ctx.childRun)!;
    ok(child.params._tainted === "issue-text" && child.params.project === "sandbox", "the Task the captain dispatches from it carries the taint", JSON.stringify(child.params));
    const plainP: any = await tools.call("studio_propose_work", args, owner("plain"));
    ok(!JSON.parse(E.get(plainP.proposal)!.params.target).params._tainted, "an ordinary proposal is not tainted");
  } finally { for (const r of E.list()) if (!["succeeded", "failed", "cancelled"].includes(r.status)) await E.cancel(r.id, "test cleanup"); H.stop(); } }

// --- a tainted code Task end to end: no GitHub call, reviewed in run mode, stopped on its local branch ---
const WF = readFileSync(join(root, "packs/firstmate/workflows/code-firstmate.wf.yaml"), "utf8");
const { prepareSandbox, registerSandbox } = await import("../src/sandbox-repo");
const { installCode } = await import("../src/domain/code"); const { Projects } = await import("../src/doors");
const intent = ["Add a percent function to money-kit, fixes #12 (https://github.com/fixture/project/issues/12) cc @octocat",
  "STUB_FILE src/percent.ts :: export function percent(amount: number, pct: number): number {\\n  return Math.round((amount * pct) / 100);\\n}\\n",
  'STUB_FILE test/percent.test.ts :: import { expect, test } from "bun:test";\\ntest("percent rounds to the cent", async () => { expect(await Bun.file(new URL("../src/percent.ts", import.meta.url)).exists()).toBe(true); const { percent } = await import("../src/percent.ts"); expect(percent(1999, 15)).toBe(300); });\\n'].join("\n");
// a GitHub adapter that records every call: a tainted Task must make none, whatever the project's grant
const calls: string[] = [];
const github = new Proxy(Object.create(GitHubPrAdapter.prototype), { get(_t, k) {
  if (k === "grant") return { mode: "simulator", repository: "fixture/project", approvalId: "fixture", base: "main", branchPrefix: "crew/" };
  if (typeof k === "symbol" || k === "then" || k === "toJSON" || k === "constructor") return undefined;
  return (...a: unknown[]) => { calls.push(String(k)); throw new Error(`GitHub adapter called: ${String(k)}`); }; } });
for (const tainted of [false, true]) {
  const data = checkedTempDir("crew-tainted-"); prepareSandbox(data); registerSandbox(data);
  const H = await harness([WF], { data, checkRoots: [], policies: "reviewer:\n  mode: diff\n" }), E = H.engine; installCode(E, { dataDir: data, projects: new Projects(data), ...(tainted ? { adapter: github } : {}) });
  const r = E.start({ workflow: "code-firstmate", params: tainted ? { _tainted: "issue-text" } : {}, text: intent });
  const fin = () => ["succeeded", "failed", "cancelled"].includes(E.get(r.id)!.status);
  await until(() => fin() || E.cards.list({ run: r.id, open: true }).some((c: any) => c.kind === "dispatch"), 60000);
  const d = E.cards.list({ run: r.id, open: true }).find((c: any) => c.kind === "dispatch"); if (d) await E.answer(d.id, { choice: "dispatch", by: "captain" });
  await until(() => fin() || E.cards.list({ run: r.id, open: true }).some((c: any) => c.kind === "merge"), 180000);
  const run = E.get(r.id)!, dep = E.ledger(r.id).filter((e: any) => e.check === "firstmate/review-depth").at(-1) as any;
  const wt = run.ctx.worktree, log = wt ? must(wt, ["log", "--format=%B", "-n", "20"]) : "";
  if (!tainted) { ok(dep?.data?.mode === "diff" && /#12/.test(log) && E.cards.list({ run: r.id, open: true }).some((c: any) => c.kind === "merge"), "untainted, the diff policy holds, the commits keep what the spec says and the merge card comes", JSON.stringify([dep?.data?.mode, log.slice(0, 300)])); E.cancel(r.id, "captain"); }
  else {
    const ready = E.ledger(r.id).find((e: any) => e.record === "tainted-ready") as any, main = must(run.ctx.repo, ["rev-parse", "main"]);
    ok(run.status === "succeeded" && run.result === "closed" && run.ctx.taintedReady?.branch === run.ctx.branch && ready?.data?.head === run.ctx.taintedReady.head && !E.cards.list({ run: r.id }).some((c: any) => c.kind === "merge") && !run.nodes.merge?.visits,
      "tainted, it ends ready on its local branch: no merge card and no merge, the branch and head on the ledger", JSON.stringify([run.status, run.result, run.ctx.taintedReady, run.error]));
    ok(main === run.ctx.baseCommit && must(run.ctx.repo, ["rev-parse", run.ctx.branch]) === run.ctx.taintedReady?.head, "the base branch is untouched; the work is on the Task's branch", JSON.stringify([main, run.ctx.baseCommit]));
    ok(calls.length === 0 && run.ctx.pr?.adapter === "local", "the project's GitHub adapter is never called: no push, no pull request, no read", calls.join(", "));
    ok(dep?.data?.mode === "run", "the review runs in run mode whatever reviewer.mode says", JSON.stringify(dep?.data?.mode));
    ok(!!log && !refs.test(log) && /an issue/.test(log), "its round commits name no issue and mention no one", log.slice(0, 400));
    // a check of it under a sandbox-off grant (an edge's, a card's, one run after an answer) records an error instead of running
    const g = E.grants.add({ kinds: ["sandbox-off"], until: "2099-01-01T00:00:00Z" }, "captain (desktop)");
    const node = run.def.nodes.find((n: any) => n.id === "review")!, entry = await E.runCheck(E.x(run, node, run.nodes.review), { use: "firstmate/ci" }, "hook:after_merge");
    ok(entry.verdict === "error" && entry.blocking && /sandbox-off grant/.test(String(entry.error)), "a check of a tainted run (here a lifecycle hook's, which runs even after the end) does not run outside the OS sandbox", JSON.stringify([entry.verdict, entry.error]));
    E.grants.revoke(g.id, "captain (desktop)"); }
  H.stop(); }
end();
