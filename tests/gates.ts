import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir, assertTempRepo } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
// Doors and gates: the classifier (org defaults, a project's approved list,
// trivial and undecided), the builtin gates, and Studio's change workflow on a
// local repository: gates per node, the worker/reviewer cycle (stub agents),
// the captain's door choice, one-way merge confirmation, and a retro over
// Studio's own event log. Temporary repo and data only.   bun tests/gates.ts
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freePort, waitUp } from "./boot.mjs";
process.env.CREW_SESSION_TOKEN ??= "test-session"; // the server's write guard: a local client sends it as x-crew-session

let pass = 0, fail = 0;
const ok = (c: boolean, name: string, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const here = import.meta.dir, root = join(here, "..");
for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete process.env[k];
const sh = (cwd: string, ...a: string[]) => { const r = Bun.spawnSync(a, { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  if (!r.success) throw new Error(`${a.join(" ")}: ${r.stderr}`); return r.stdout.toString().trim(); };

// ---------- unit: globs, the classifier, builtin gates ----------
{
  const { globRe, classify, loadDefaults } = await import("../src/doors");
  const { BUILTINS } = await import("../src/gates");
  const d = loadDefaults();
  ok(globRe("*.sql").test("db/x.sql") && globRe("**/migrations/**").test("a/migrations/1.py") && !globRe("docs/*").test("docs/a/b.md") && globRe("docs/**").test("docs/a/b.md"), "globs: ** spans folders, * does not, a bare name matches at any depth");
  const one = classify([{ path: "src/app.ts", added: 3 }, { path: "migrations/002_users.sql", added: 10 }], { defaults: d });
  ok(one.tier === "one-way" && one.reasons.some((r) => r.list === "org" && r.path === "migrations/002_users.sql"), "a migration is one-way, and the reason names the path and the org rule");
  ok(classify([{ path: "docs/guide.md", added: 5 }, { path: "README.md", added: 1 }], { defaults: d }).tier === "trivial", "docs only and small: trivial");
  ok(classify([{ path: "docs/guide.md", added: 500 }], { defaults: d }).tier === "two-way", "docs only but large: two-way");
  ok(classify([{ path: "src/a.ts", added: 2 }], { defaults: d }).tier === "two-way", "ordinary code: two-way");
  ok(classify([{ path: "newtop/a.ts", added: 2 }], { defaults: d, topLevel: new Set(["src"]) }).tier === "undecided", "a new top-level path: undecided (the captain picks)");
  ok(classify([{ path: "src/b.ts", status: "R100", from: "src/a.ts" }], { defaults: d }).tier === "undecided", "a rename no list classifies: undecided");
  // a project's sensitive paths are its policy sensitive_paths (Project.sensitive is read from it); a proposed list sits in `proposed` until approved
  const proj: any = { id: "p", name: "p", path: null, base: "main", sensitive: [], proposed: [{ glob: "src/billing/**", why: "money" }], proposedAt: "2026-10-14", approvedAt: null };
  ok(classify([{ path: "src/billing/x.ts" }], { defaults: d, project: proj }).tier === "two-way", "a project's list does nothing until it is approved");
  ok(classify([{ path: "src/billing/x.ts" }], { defaults: d, project: { ...proj, sensitive: proj.proposed, proposed: null, approvedAt: "2026-10-14" } }).tier === "one-way", "once approved, the project's list makes it one-way");
  ok(classify([{ path: "README.md", added: 1 }, { path: "assets/banner.png", added: 1 }], { defaults: d }).tier === "trivial", "the trivial lane's change (README + asset) is trivial");
  const ctx: any = { dir: "/nonexistent", paths: [{ path: "a.txt", added: 3 }], added: [{ path: "a.txt", line: "token = ghp_abcdefghijklmnopqrstuvwxyz0123456789" }, { path: "a.txt", line: "<<<<<<< HEAD" }], messages: "", tier: "two-way" };
  ok(!BUILTINS["no-secrets"](ctx, {}).ok && !BUILTINS["no-conflict-markers"](ctx, {}).ok && BUILTINS["max-diff-lines"](ctx, { max: 10 }).ok, "builtin gates: secrets and conflict markers caught, diff size counted");
}

// ---------- the change workflow on a local repository ----------
const tmp = checkedTempDir("crew-gates-");
const state = join(tmp, "fm", "state"), data = join(tmp, "data"), repo = join(tmp, "repo");
mkdirSync(join(state, "pending"), { recursive: true }); writeFileSync(join(state, "events.jsonl"), ""); mkdirSync(data); mkdirSync(repo);
sh(repo, "git", "init", "-q", "-b", "main");
mkdirSync(join(repo, "src")); mkdirSync(join(repo, "tests")); mkdirSync(join(repo, "data")); mkdirSync(join(repo, "docs"));
writeFileSync(join(repo, "src/app.ts"), "export const x = 1;\n"); writeFileSync(join(repo, "tests/a.test.sh"), "echo ok\n"); writeFileSync(join(repo, "data/x.json"), "{}\n"); writeFileSync(join(repo, "docs/guide.md"), "# Guide\n");
sh(repo, "git", "add", "-A"); sh(repo, "git", "commit", "-q", "-m", "init");
const branch = (name: string, files: Record<string, string>, msg = `${name} change`) => { sh(repo, "git", "checkout", "-q", "-b", name, "main"); for (const [f, t] of Object.entries(files)) { mkdirSync(join(repo, f, ".."), { recursive: true }); writeFileSync(join(repo, f), t); } sh(repo, "git", "add", "-A"); sh(repo, "git", "commit", "-q", "-m", msg); sh(repo, "git", "checkout", "-q", "main"); };
branch("feat-docs", { "docs/guide.md": "# Guide\n\nOne more line.\n" });
branch("feat-json", { "data/x.json": "{bad\n", "src/app.ts": "export const x = 2;\n" });
branch("feat-big", { "tests/big.test.sh": "echo x\n".repeat(1250) });
branch("feat-markers", { "src/app.ts": "<<<<<<< HEAD\nexport const x = 3;\n=======\nexport const x = 4;\n>>>>>>> other\n" });
branch("feat-reject", { "src/notes.txt": "STUB_REJECT left here\n" });
branch("feat-newtop", { "tools/gen.ts": "export {};\n" });

const port = await freePort();
const app = Bun.spawn(["bun", "src/server.ts"], { cwd: root, stdout: "pipe", stderr: "pipe", env: { ...process.env, CREW_FM_STATE: state, CREW_PORT: String(port), CREW_GH: "0", CREW_READONLY: "1", CREW_DATA: data,
  CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_GH_NO_CLI: "1", CREW_CLAUDE_BIN: "/nonexistent/claude", CREW_CODEX_BIN: "/nonexistent/codex",
  HOME: join(tmp, "home"), CREW_MAIN_PROJECT: join(tmp, "proj"), CREW_FILE_ALLOW: tmp } });
const base = `http://127.0.0.1:${port}`;
await waitUp(base, app);
const get = async (p: string) => (await fetch(base + p)).json();
const post = async (p: string, b: any = {}) => { const r = await fetch(base + p, { method: "POST", headers: { "content-type": "application/json", "x-crew-session": process.env.CREW_SESSION_TOKEN }, body: JSON.stringify(b) }); return { ...(await r.json()), http: r.status }; };
const settle = async (id: string, ms = 20000) => { const t = Date.now(); let c: any; while (Date.now() - t < ms) { c = await get(`/api/changes/${id}`); if (!["classifying", "running", "fixing", "reviewing"].includes(c.status)) return c; await Bun.sleep(150); } return c; };
const mainHead = () => sh(repo, "git", "rev-parse", "main");

try {
  const pr = await post("/api/projects", { name: "Demo shop", path: repo, base: "main", propose: [{ glob: "src/billing/**", why: "money moves" }] });
  ok(pr.http === 200 && pr.id === "demo-shop" && pr.proposed?.length === 1 && !pr.approvedAt, "a project is registered with a proposed sensitive list (not in force yet)");
  ok((await post("/api/doors/classify", { project: "demo-shop", paths: ["src/billing/pay.ts"] })).tier === "two-way", "before approval the project's list does not count");
  ok((await post("/api/projects/demo-shop/approve")).approvedAt, "the captain approves the list");
  ok((await post("/api/doors/classify", { project: "demo-shop", paths: ["src/billing/pay.ts"] })).tier === "one-way", "after approval it makes the change one-way");

  const docs = await settle((await post("/api/changes", { project: "demo-shop", branch: "feat-docs", title: "Explain the guide" })).id);
  ok(docs.door.tier === "trivial" && docs.status === "ready", "a docs change: trivial door, gates pass, the reviewer approves, ready", JSON.stringify([docs.status, docs.error, docs.door?.tier]));
  ok(docs.gates.find((g: any) => g.id === "rollback-note") === undefined && docs.gates.some((g: any) => g.id === "diff-size" && g.state === "pass"), "the one-way lane's plan gate is not on a trivial path; its node gates are");
  const before = mainHead();
  const mg = await post(`/api/changes/${docs.id}/merge`);
  ok(mg.http === 200 && mg.status === "merged" && mainHead() !== before && readFileSync(join(repo, "docs/guide.md"), "utf8").includes("One more line"), "Merge fast-forwards main locally (the captain's click)");

  const js = await settle((await post("/api/changes", { project: "demo-shop", branch: "feat-json", title: "Bump x", hint: "replace {bad => {\"ok\":true} in data/x.json" })).id);
  ok(js.status === "ready" && js.rounds.length === 1 && js.rounds[0].why.some((w: string) => /JSON/.test(w)) && js.rounds[0].worker.commit && js.rounds[0].review.verdict === "APPROVE",
    "a failing JSON gate: one worker round fixes it in the worktree, gates pass, the reviewer approves", JSON.stringify([js.status, js.error, js.rounds]));
  ok(js.gates.every((g: any) => g.state !== "fail") && sh(repo, "git", "log", "--format=%s", "-1", js.branch).includes("round 1 fixes"), "the fix is a commit on the change's own branch (crew/…), not the captain's");

  const big = await settle((await post("/api/changes", { project: "demo-shop", branch: "feat-big", title: "Many tests" })).id, 30000);
  ok(big.status === "failed" && big.rounds.length === 3 && /No tests file over 1200 lines/.test(big.error), "a gate the worker cannot fix stops after the round budget (3), naming the gate", JSON.stringify([big.status, big.error, big.rounds.length]));
  ok((await post(`/api/changes/${big.id}/merge`)).http === 400, "a failed change cannot merge");

  const mk = await settle((await post("/api/changes", { project: "demo-shop", branch: "feat-markers", title: "Resolve" })).id);
  ok(mk.gates.some((g: any) => g.id === "no-conflict-markers"), "conflict markers are gated");

  const rj = await settle((await post("/api/changes", { project: "demo-shop", branch: "feat-reject", title: "Notes", hint: "replace STUB_REJECT => reviewed in src/notes.txt" })).id);
  ok(rj.status === "ready" && rj.rounds[0].n === 0 && rj.rounds[0].review.verdict === "REJECT" && rj.rounds[1].review.verdict === "APPROVE", "gates pass but the reviewer rejects: a worker round addresses the finding, then APPROVE", JSON.stringify(rj.rounds?.map((r: any) => [r.n, r.review?.verdict])));

  branch("feat-migration", { "migrations/001_users.sql": "create table users(id int);\n" }, "Add the users table\n\nRollback: drop table users (data written meanwhile is lost)");
  const mig = await settle((await post("/api/changes", { project: "demo-shop", branch: "feat-migration", title: "Users table" })).id);
  ok(mig.door.tier === "one-way" && mig.door.reasons.some((r: any) => r.glob === "migrations/**") && mig.gates.some((g: any) => g.id === "rollback-note" && g.state === "pass"), "a migration: one-way, and the one-way plan gate (rollback note) runs");
  ok(mig.gates.find((g: any) => g.id === "diff-size")?.state === "skip", "a gate limited to two-way is skipped on a one-way change");
  ok((await post(`/api/changes/${mig.id}/merge`)).http === 400, "a one-way merge without the confirm is refused");
  ok((await post(`/api/changes/${mig.id}/merge`, { confirm: "one-way" })).status === "merged", "with the confirm it merges");

  const nt = await settle((await post("/api/changes", { project: "demo-shop", branch: "feat-newtop", title: "Generator" })).id);
  ok(nt.status === "needs-door" && nt.door.tier === "undecided" && nt.door.reasons[0].why.includes("new top-level"), "a new top-level path: the change waits for the captain's door");
  const nt2 = await settle((await post(`/api/changes/${nt.id}/door`, { door: "two-way" })).id);
  ok(nt2.status === "ready" && nt2.door.decidedBy === "captain", "the captain picks two-way; the gates run and it is ready");

  const ev = readFileSync(join(data, "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  ok(ev.some((e) => e.type === "gate_failed" && e.workflow === "change") && ev.some((e) => e.type === "change_merged"), "every step is in Studio's own event log");
  const r = await post("/api/improve/retro", { workflow: "change", days: 1 });
  ok(r.classes?.find((c: any) => c.id === "same-gate-fails")?.found === true && r.metrics.find((m: any) => m.id === "merged").value === 2, "a retro over Studio's own change workflow (same engine, studio log) finds the repeating gate failures", JSON.stringify(r.classes ?? r));
  const ov = await get("/api/changes");
  ok(ov.changes.length === 7 && ov.defaults.base.length > 5, "the Gates page data: every change, projects and the org defaults");
  ok((await get("/api/flows")).some((f: any) => f.id === "change" && f.nodes.some((n: any) => n.gates?.length)), "the change workflow lists its gates per node");
} catch (e: any) { fail++; console.log(`  FAIL  exception ${e?.stack ?? e}`); }
finally { app.kill(); }
console.log(`\ngates: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
