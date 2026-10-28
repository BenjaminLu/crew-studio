import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir, assertTempRepo } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
// Remote readiness while GitHub still computes mergeability: after a push or an edit of the pull request GitHub answers
// `mergeable: null` for a moment. Remote readiness reads the pull request again a few times (bounded, short backoff) before
// it stops; a value that turns true passes with no card. One that stays null stops on the card, and the card, the log and
// the ledger name the actual cause, not only "could not be proved".
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { harness, Y, until, suite } from "./rt-harness";
import { installCode } from "../src/domain/code";
import { Projects } from "../src/doors";
import { Worktrees } from "../src/worktrees";
import { git, must, setGitHome } from "../src/git";
import { GitHubPrAdapter } from "../src/adapters/github";
import { githubSimulator } from "./lib/github-simulator";

const { ok, end } = suite("remote-mergeability-pending");
const temp = checkedTempDir("remote-mergeability-"), repo = join(temp, "repo"), bare = join(temp, "bare.git");
mkdirSync(repo); assertTempRepo(repo); setGitHome(join(temp, "git"));
must(repo, ["init", "-qb", "main"]); writeFileSync(join(repo, "base"), "base"); must(repo, ["add", "."]); must(repo, ["commit", "-qm", "base"]);
const base = must(repo, ["rev-parse", "HEAD"]);
must(temp, ["clone", "--bare", "-q", repo, bare]);

const H = await harness([Y({ id: "pending", name: "Pending", roles: [], nodes: [
  { id: "setup", kind: "hook", do: "fixture.setup", label: "Setup", x: 0, y: 0 }, { id: "remote-ready", kind: "hook", do: "remote.ready", label: "Remote readiness", x: 1, y: 0 },
  { id: "done", kind: "hook", label: "Done", x: 2, y: 0 }, { id: "closed", kind: "hook", label: "Closed", args: { result: "closed" }, x: 2, y: 1 }],
  edges: [["setup", "remote-ready"], ["remote-ready", "done", "ok"], ["remote-ready", "closed", "close"]] })]);
const E = H.engine, W = new Worktrees(H.data), rec = W.ensure({ project: "fixture", task: "task", repo, base: "main", branchPrefix: "crew/", run: "fixture" });
const round = await W.startRound("fixture", "task", "fixture-build", { write: true, install: null });
writeFileSync(join(rec.path, "task"), "task");
const old = W.handBack("fixture", "task", { run: "fixture", node: "build", round: 1, agent: "fixture", message: "task" }).head;
round.release();
const sim = githubSimulator(bare);
const adapter = new GitHubPrAdapter({ mode: "simulator", repository: "fixture/project", localPath: repo, pushUrl: bare, apiOrigin: sim.origin, base: "main", branchPrefix: "crew/", approvedAt: "2026-10-15T00:00:00Z", approvalId: "fixture",
  operations: { version: 1, repository: "fixture/project", approvalId: "fixture-op", approvedAt: "2026-10-15T00:00:00Z", mergeMethod: "merge" } } as any, () => "fake-token", 2000);
mkdirSync(join(temp, "record"));
const pr = await adapter.open({ repo, base: "main", branch: rec.branch, head: old, title: "Fixture", body: "Fixture" }, join(temp, "record"));
// GitHub computing mergeability: the next `nulls` reads of the pull request answer null, then true (clean)
let nulls = 0, reads = 0;
const pull = sim.pulls.get(Number(pr.id)); pull.mergeable_state = "clean";
Object.defineProperty(pull, "mergeable", { enumerable: true, configurable: true, get() { reads++; if (nulls > 0) { nulls--; return null; } return true; } });
installCode(E, { dataDir: H.data, projects: new Projects(H.data), adapter, mergeabilityRetryMs: [30, 30, 30] });
let pending = 0;
E.actions["fixture.setup"] = (x) => {
  Object.assign(x.ctx, { repo, worktree: rec.path, wt: { project: "fixture", task: "task" }, head: old, base: "main", baseCommit: base, branch: rec.branch, pr, spec: { scope: ["task"], done: ["task exists"] } });
  E.record(x, "fixture-review", { check: "firstmate/review-verdict", head: old, verdict: "pass", data: { binding: { version: 1, head: old, base, patch: git(repo, ["patch-id", "--stable"], git(repo, ["diff", "--binary", base, old]).out).out.split(" ")[0] } } } as any);
  nulls = pending; reads = 0; return "ok";
};
const openCard = (r: any) => E.cards.list({ run: r.id, open: true })[0];
try {
  // null, null, then true: remote readiness waits it out and passes, no card
  pending = 2;
  const a = E.start({ workflow: "pending" });
  await until(() => ["succeeded", "failed"].includes(a.status) || (!!openCard(a) && !E.busy(a.id)), 15000);
  ok(a.status === "succeeded" && !openCard(a) && a.nodes["remote-ready"]?.outcome === "ok", "mergeability null, then true: remote readiness reads again and passes without a card",
    `${a.status} ${a.nodes["remote-ready"]?.outcome} ${openCard(a)?.body ?? ""}`);
  ok(reads >= 3, "it read the pull request again while GitHub was computing", String(reads));

  // null on every read: a bounded number of reads, then the card, with the cause on it, in the log and on the ledger
  pending = 1000;
  const b = E.start({ workflow: "pending" });
  await until(() => (!!openCard(b) && !E.busy(b.id)) || ["succeeded", "failed"].includes(b.status), 15000);
  const c = openCard(b);
  ok(c?.node === "remote-ready" && (c.options ?? []).some((o: any) => o.id === "check"), "mergeability that stays null stops on the remote-stop card with Check again", `${b.status} ${c?.node} ${c?.body}`);
  ok(/remote mergeability remains unverified/.test(c?.body ?? "") && /remote mergeability remains unverified/.test(c?.sections?.en?.why ?? ""), "the card names the cause (en)", `${c?.body} | ${c?.sections?.en?.why}`);
  ok(/remote mergeability remains unverified/.test(c?.sections?.["zh-TW"]?.why ?? ""), "the Chinese text carries the cause too", c?.sections?.["zh-TW"]?.why);
  ok(reads <= 8, "the re-reads are bounded", String(reads));
  const stop = E.trusted(b.id).entries.filter((e: any) => e.record === "remote-readiness-stop").at(-1) as any;
  ok(/remote mergeability remains unverified/.test(String(stop?.data?.cause ?? "")), "the ledger records the cause", JSON.stringify(stop?.data));
  ok(E.events(b.id).some((e: any) => e.type === "log" && /remote mergeability remains unverified/.test(e.summary ?? "")), "the run's log names the cause");
  E.cancel(b.id); await until(() => !E.busy(b.id), 8000);

  // the ledger write of the stop's cause fails: the stop card is still raised (the node never fails without it)
  const record = E.record.bind(E);
  E.record = ((x: any, kind: string, e: any) => { if (kind === "remote-readiness-stop") throw new Error("ledger write failed"); return record(x, kind, e); }) as any;
  const f = E.start({ workflow: "pending" });
  await until(() => (!!openCard(f) && !E.busy(f.id)) || ["succeeded", "failed"].includes(f.status), 15000);
  E.record = record;
  const fc = openCard(f);
  ok(f.status !== "failed" && fc?.node === "remote-ready" && /remote mergeability remains unverified/.test(fc?.body ?? ""), "a failed ledger write of the cause still raises the stop card", `${f.status} ${fc?.body ?? ""}`);
  E.cancel(f.id); await until(() => !E.busy(f.id), 8000);
} catch (e: any) { ok(false, "unexpected error", e.stack); } finally { H.stop(); sim.stop(); rmSync(temp, { recursive: true, force: true }); }
end();
