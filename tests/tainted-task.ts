import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
// A tainted Task: work drawn from untrusted issue text (an issue triage's work package; params._tainted, Studio's own mark).
// Its commits and pull request name no issue (GitHub would link or close it), its review runs the tests whatever
// reviewer.mode says, and it runs only in the OS sandbox: never in local unrestricted mode, never under a sandbox-off
// grant (src/runtime/engine.ts taintRefusal). Offline: stub providers, temp data.     bun tests/tainted-task.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { harness, suite, until } from "./rt-harness";
import { must } from "../src/git";
const { ok, end } = suite("tainted-task");
const root = join(import.meta.dir, "..");
const { withoutIssueRefs } = await import("../src/domain/pull-template");

// --- the text: every reference GitHub links becomes "an issue" ---
const refs = /#\d|GH-\d|\/issues\/\d|\/pull\/\d/i;
for (const [t, why] of [["Fixes #12", "a closing keyword"], ["Refs #12", "a plain reference"], ["see #3 and #4", "two bare references"], ["**Closes**: fixture/project#7", "another repository's form, with emphasis"],
  ["Resolved https://github.com/fixture/project/issues/9#issuecomment-1", "an issue URL"], ["like https://ghe.example/o/r/pull/5", "a pull request URL on another host"], ["GH-21 again", "GH-n"]] as const)
  ok(!refs.test(withoutIssueRefs(t)) && /an issue/.test(withoutIssueRefs(t)), `no issue reference survives: ${why}`, withoutIssueRefs(t));
ok(withoutIssueRefs("## Door\ntwo-way\n\n# Title") === "## Door\ntwo-way\n\n# Title", "markdown headings are not references");

// --- the one rule: a tainted run starts no step outside the OS sandbox ---
const flow = JSON.stringify({ id: "plain-hook", name: "plain-hook", version: 1, params: {}, roles: [], nodes: [{ id: "go", kind: "hook", label: "Go", do: "fixture.go", x: 0, y: 0 }, { id: "end", kind: "hook", label: "End", x: 1, y: 0 }], edges: [["go", "end", "pass"]] });
{ const H = await harness([flow]), E = H.engine; let ran = 0; E.actions["fixture.go"] = async () => { ran++; return { outcome: "pass" }; };
  const done = (id: string) => until(() => ["succeeded", "failed", "cancelled"].includes(E.get(id)!.status), 20000);
  const plain = E.start({ workflow: "plain-hook", params: {} }); await done(plain.id);
  ok(E.get(plain.id)!.status === "succeeded" && ran === 1 && E.taintRefusal(E.get(plain.id)!) === null, "an untainted run runs as before");
  process.env.CREW_LOCAL_UNRESTRICTED = "1"; process.env.CREW_LOCAL_DEPENDENCY_ROOT = join(H.data, "deps");
  try {
    const loose = E.start({ workflow: "plain-hook", params: {} }); await done(loose.id);
    ok(E.get(loose.id)!.status === "succeeded" && ran === 2, "local unrestricted mode still runs untainted work");
    const t = E.start({ workflow: "plain-hook", params: { _tainted: "issue-text" } }); await done(t.id);
    ok(E.get(t.id)!.status === "failed" && ran === 2 && /untrusted issue text.*CREW_LOCAL_UNRESTRICTED/.test(String(E.get(t.id)!.nodes.go?.error)), "in local unrestricted mode a tainted run starts no step", String(E.get(t.id)!.nodes.go?.error));
  } finally { delete process.env.CREW_LOCAL_UNRESTRICTED; delete process.env.CREW_LOCAL_DEPENDENCY_ROOT; }
  const g = E.grants.add({ kinds: ["sandbox-off"], until: "2099-01-01T00:00:00Z" }, "captain (desktop)");
  const off = E.start({ workflow: "plain-hook", params: { _tainted: "issue-text" } }); await done(off.id);
  ok(E.get(off.id)!.status === "failed" && ran === 2 && new RegExp(`sandbox-off grant ${g.id}`).test(String(E.get(off.id)!.nodes.go?.error)), "under a sandbox-off grant a tainted run starts no step", String(E.get(off.id)!.nodes.go?.error));
  E.grants.revoke(g.id, "captain (desktop)");
  const back = E.start({ workflow: "plain-hook", params: { _tainted: "issue-text" } }); await done(back.id);
  ok(E.get(back.id)!.status === "succeeded" && ran === 3, "in the OS sandbox a tainted run runs");
  H.stop(); }

// --- a tainted code Task: reviewed in run mode under a diff policy, and no issue reference in its commits ---
const WF = readFileSync(join(root, "packs/firstmate/workflows/code-firstmate.wf.yaml"), "utf8");
const { prepareSandbox, registerSandbox } = await import("../src/sandbox-repo");
const { installCode } = await import("../src/domain/code"); const { Projects } = await import("../src/doors");
const intent = ["Add a percent function to money-kit, fixes #12 (https://github.com/fixture/project/issues/12)",
  "STUB_FILE src/percent.ts :: export function percent(amount: number, pct: number): number {\\n  return Math.round((amount * pct) / 100);\\n}\\n",
  'STUB_FILE test/percent.test.ts :: import { expect, test } from "bun:test";\\ntest("percent rounds to the cent", async () => { expect(await Bun.file(new URL("../src/percent.ts", import.meta.url)).exists()).toBe(true); const { percent } = await import("../src/percent.ts"); expect(percent(1999, 15)).toBe(300); });\\n'].join("\n");
for (const tainted of [false, true]) {
  const data = checkedTempDir("crew-tainted-"); prepareSandbox(data); registerSandbox(data);
  const H = await harness([WF], { data, checkRoots: [], policies: "reviewer:\n  mode: diff\n" }), E = H.engine; installCode(E, { dataDir: data, projects: new Projects(data) });
  const r = E.start({ workflow: "code-firstmate", params: tainted ? { _tainted: "issue-text" } : {}, text: intent });
  const fin = () => ["succeeded", "failed", "cancelled"].includes(E.get(r.id)!.status);
  await until(() => fin() || E.cards.list({ run: r.id, open: true }).some((c: any) => c.kind === "dispatch"), 60000);
  const d = E.cards.list({ run: r.id, open: true }).find((c: any) => c.kind === "dispatch"); if (d) await E.answer(d.id, { choice: "dispatch", by: "captain" });
  await until(() => fin() || E.cards.list({ run: r.id, open: true }).some((c: any) => c.kind === "merge"), 180000);
  const dep = E.ledger(r.id).filter((e: any) => e.check === "firstmate/review-depth").at(-1) as any, m = E.cards.list({ run: r.id, open: true }).find((c: any) => c.kind === "merge");
  const wt = E.get(r.id)!.ctx.worktree, log = wt ? must(wt, ["log", "--format=%B", "-n", "20"]) : "";
  if (!tainted) ok(dep?.data?.mode === "diff" && /#12/.test(log), "untainted, the diff policy holds and the commits keep what the spec says", JSON.stringify([dep?.data?.mode, log.slice(0, 300)]));
  else {
    ok(!!m && dep?.data?.mode === "run" && m.detail?.review?.mode === "run", "tainted, the review runs in run mode whatever reviewer.mode says", JSON.stringify([dep?.data?.mode, E.get(r.id)!.status]));
    ok(!!log && !refs.test(log) && /an issue/.test(log), "tainted, its round commits name no issue", log.slice(0, 400));
    const landing = String(m?.body ?? "").match(/Lands one curated commit [^\n]*?: "([^"\n]+)"/)?.[1];
    ok(!!landing && !refs.test(landing) && /fixes an issue/.test(landing), "tainted, the commit its merge lands names no issue", String(m?.body).slice(0, 400)); }
  E.cancel(r.id, "captain"); H.stop(); }
end();
