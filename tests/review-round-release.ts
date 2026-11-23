import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
// A review attempt always gives its worktree back. The review mode's begin takes the task's round lock and then
// prepares the reviewer's checkout; its end drops that checkout and then releases the lock. When the preparation
// or the drop throws, the lock must still be released: otherwise the node's retry (retries: 1, same visit, same
// holder) and every later round of the Task are refused with "the worktree of R-… is taken by R-…/review#1"
// (CI 2026-11-23, ACCEPTANCE_PROVIDER=cursor code-firstmate:firstmate-merge).      bun tests/review-round-release.ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { harness, suite, until } from "./rt-harness";
const { ok, end } = suite("review-round-release");
const root = join(import.meta.dir, "..");
const WF = readFileSync(join(root, "packs/firstmate/workflows/code-firstmate.wf.yaml"), "utf8");
const { prepareSandbox, registerSandbox } = await import("../src/sandbox-repo");
const { installCode } = await import("../src/domain/code"); const { Projects } = await import("../src/doors");
const intent = ["Add a percent function to money-kit",
  "STUB_FILE src/percent.ts :: export function percent(amount: number, pct: number): number {\\n  return Math.round((amount * pct) / 100);\\n}\\n",
  'STUB_FILE test/percent.test.ts :: import { expect, test } from "bun:test";\\ntest("percent rounds to the cent", async () => { expect(await Bun.file(new URL("../src/percent.ts", import.meta.url)).exists()).toBe(true); const { percent } = await import("../src/percent"); expect(percent(1999, 15)).toBe(300); });\\n'].join("\n");
const locks = (data: string) => { const out: string[] = []; const walk = (d: string) => { let es: any[] = []; try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const e of es) { const p = join(d, e.name); if (e.isDirectory() && e.name !== ".tmp" && !/^R-\d+$/.test(e.name)) walk(p); else if (e.isFile() && e.name.endsWith(".lock")) out.push(p); } };
  walk(join(data, "work", "wt")); return out; };

// "prepare+end": the preparation throws, and so does the round's end that gives the lock back: the preparation's error is
// the one the retry reports, and the lock is still released (the end releases it in its own finally)
for (const step of ["prepare", "drop", "prepare+end"] as const) {
  const at0 = step === "drop" ? "drop" : "prepare";
  const data = checkedTempDir("crew-revrelease-"); prepareSandbox(data); registerSandbox(data);
  let fired = 0, endFired = 0;
  const H = await harness([WF], { data, checkRoots: [] });
  // the first review attempt's preparation (or the drop at its end) throws once, as a transient file-system error would
  installCode(H.engine, { dataDir: data, projects: new Projects(data), seams: {
    reviewTree: (_x: any, at: "prepare" | "drop") => { if (at === at0 && !fired) { fired++; throw new Error(`injected ${at0} failure`); } },
    roundEnd: (x: any) => { if (step === "prepare+end" && x.node.id === "review" && !endFired) { endFired++; throw new Error("injected end failure"); } } } });
  const E = H.engine;
  const r = E.start({ workflow: "code-firstmate", params: {}, text: intent });
  const settled = () => ["succeeded", "failed", "cancelled"].includes(E.get(r.id)!.status);
  await until(() => settled() || E.cards.list({ run: r.id, open: true }).some((c: any) => c.kind === "dispatch"), 180000);
  const d = E.cards.list({ run: r.id, open: true }).find((c: any) => c.kind === "dispatch"); if (d) await E.answer(d.id, { choice: "dispatch", by: "captain" });
  await until(() => settled() || E.cards.list({ run: r.id, open: true }).some((c: any) => c.kind === "merge"), 180000);
  const run = E.get(r.id)!, tl = E.timeline(r.id);
  const taken = tl.filter((e: any) => /is taken by/.test(JSON.stringify(e)));
  ok(fired === 1 && endFired === (step === "prepare+end" ? 1 : 0), `${step}: the injected failure fired once`, JSON.stringify([fired, endFired]));
  if (at0 === "prepare") { const retry = tl.find((e: any) => e.type === "retry" && e.node === "review");
    ok(/injected prepare failure/.test(retry?.error ?? "") && !/injected end failure/.test(retry?.error ?? ""), `${step}: the review's retry reports the preparation's error`, String(retry?.error ?? JSON.stringify(retry)).slice(0, 400)); }
  ok(!taken.length, `${step}: no round is refused because the review attempt kept the worktree`, JSON.stringify(taken.map((e: any) => e.error ?? e.summary ?? e)).slice(0, 600));
  ok(E.cards.list({ run: r.id, open: true }).some((c: any) => c.kind === "merge") && run.status !== "failed",
    `${step}: the Task still reaches its merge card`, JSON.stringify([run.status, run.nodes.review?.state, run.nodes.review?.cause]).slice(0, 400));
  const held = locks(data);
  ok(!held.length, `${step}: at the merge card no round lock is left on the Task's worktree`, held.join(", "));
  H.stop();
}
end();
