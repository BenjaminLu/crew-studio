import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
// The round contract's environment preflight (slice S4): Studio fills what it can before a round starts, and a gap it
// cannot fill is found at dispatch and goes to Firstmate, never a HOLD inside the build round (R-028: the test command
// was null because Studio read only .crew/gates.json while package.json had `node --test`).
//   1. a worktree with only package-lock.json / pnpm-lock.yaml / yarn.lock runs the matching frozen install (deps.ran
//      recorded); a missing package manager is a typed gap (env.tool-missing), not ok
//   2. repoCfgAt resolves the test command from package.json scripts.test when .crew/gates.json has none, from the base
//   3. at dispatch, a done-line test path outside the test globs, is a typed gap sent to
//      Firstmate's spec repair turn; absent test commands are recorded not-run and allowed
//   4. env.test-command / env.tool-missing go to Firstmate first; only env.permission (a host the sandbox must reach)
//      raises a captain card
//      bun tests/env-preflight.ts
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { harness, suite, until } from "./rt-harness";
const { ok, end } = suite("env-preflight");
const root = join(import.meta.dir, "..");
const tmp = checkedTempDir("crew-envpf-");
const data = join(tmp, "data"); mkdirSync(data);
const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const sh = (cwd: string, ...a: string[]) => { const r = Bun.spawnSync(a, { cwd, stdout: "pipe", stderr: "pipe", env: gitEnv }); return { code: r.exitCode, out: r.stdout.toString().trim(), err: r.stderr.toString().trim() }; };
let n = 0;
const mkRepo = (files: Record<string, string>) => {
  const dir = join(tmp, `repo-${++n}`); mkdirSync(dir, { recursive: true });
  for (const [p, c] of Object.entries(files)) { mkdirSync(join(dir, p, ".."), { recursive: true }); writeFileSync(join(dir, p), c); }
  sh(dir, "git", "init", "-q", "-b", "main"); sh(dir, "git", "add", "-A"); sh(dir, "git", "commit", "-qm", "init");
  return dir;
};
const pkg = (o: any = {}) => JSON.stringify({ name: "demo", version: "1.0.0", private: true, ...o }, null, 1);
const npmLock = JSON.stringify({ name: "demo", version: "1.0.0", lockfileVersion: 3, requires: true, packages: { "": { name: "demo", version: "1.0.0" } } });
// recording package managers: each writes the argv it was run with into the folder it runs in
const fakebin = join(tmp, "fakebin"); mkdirSync(fakebin);
for (const b of ["pnpm", "yarn"]) { writeFileSync(join(fakebin, b), `#!/bin/sh\necho "${b} $*" > "$PWD/.pm-argv"\n`); chmodSync(join(fakebin, b), 0o755); }
const realPath = process.env.PATH ?? "";
const withFake = [fakebin, ...realPath.split(delimiter)].join(delimiter);
// a PATH with no pnpm and everything else as it was: the folders that hold pnpm are replaced by links to all their other programs
const kept = join(tmp, "kept-bin"); mkdirSync(kept);
for (const d of realPath.split(delimiter)) if (d && existsSync(join(d, "pnpm"))) for (const f of readdirSync(d)) if (f !== "pnpm" && !existsSync(join(kept, f))) symlinkSync(join(d, f), join(kept, f));
const noPnpm = [kept, ...realPath.split(delimiter).filter((d) => d && !existsSync(join(d, "pnpm")))].join(delimiter);

const { Worktrees, EnvGapError } = await import("../src/worktrees") as any;
const W = new Worktrees(data, { protect: () => [] });

// ---------- 1. the lockfile's frozen install ----------
{ // a local dependency (a file: package, offline) and a package-lock.json written by npm itself
  const repo = mkRepo({ "package.json": pkg({ dependencies: { helper: "file:./vendor/helper" } }), "vendor/helper/package.json": JSON.stringify({ name: "helper", version: "1.0.0", main: "index.js" }),
    "vendor/helper/index.js": "module.exports = 2;\n", ".gitignore": "node_modules/\n" });
  sh(repo, "npm", "install", "--package-lock-only", "--ignore-scripts", "--offline"); sh(repo, "git", "add", "-A"); sh(repo, "git", "commit", "-qm", "lock");
  const res = await W.installIn(repo, "npm", null);
  ok(existsSync(join(repo, "package-lock.json")) && JSON.stringify(res.ran) === JSON.stringify(["npm", "ci", "--ignore-scripts"]) && res.ok && existsSync(join(repo, "node_modules", "helper", "index.js")),
    "1a: a worktree with only package-lock.json runs npm ci (lifecycle scripts off) in the round sandbox, and deps.ran records it", JSON.stringify(res)); }
process.env.PATH = withFake;
try {
  const cases: [string, Record<string, string>, string][] = [
    ["pnpm-lock.yaml", { "pnpm-lock.yaml": "lockfileVersion: '9.0'\n" }, "pnpm install --frozen-lockfile --ignore-scripts --ignore-pnpmfile"],
    ["yarn.lock (classic)", { "yarn.lock": "# yarn lockfile v1\n" }, "yarn install --frozen-lockfile --ignore-scripts --no-default-rc"],
    ["yarn.lock (Berry)", { "yarn.lock": "__metadata:\n  version: 8\n", ".yarnrc.yml": "nodeLinker: node-modules\n" }, "yarn install --immutable --mode=skip-build"],
  ];
  for (const [name, files, want] of cases) {
    const repo = mkRepo({ "package.json": pkg(), ...files });
    const res = await W.installIn(repo, name.replace(/\W/g, "_"), null);
    const argv = existsSync(join(repo, ".pm-argv")) ? readFileSync(join(repo, ".pm-argv"), "utf8").trim() : "(not run)";
    ok(res.ok && res.ran?.join(" ") === want && argv === want, `1b: a worktree with only ${name} runs \`${want}\`, and deps.ran records it`, JSON.stringify({ res, argv }));
  }
} finally { process.env.PATH = realPath; }
process.env.PATH = noPnpm;
try {
  const repo = mkRepo({ "package.json": pkg(), "pnpm-lock.yaml": "lockfileVersion: '9.0'\n" });
  const res = await W.installIn(repo, "nopnpm", null);
  ok(res.ok === false && res.ran === null && res.gap?.code === "env.tool-missing" && res.gap.tool === "pnpm" && res.gap.route === "firstmate",
    "1c: the lockfile's package manager missing is a typed gap (env.tool-missing, to Firstmate), not ok and not \"nothing to install\"", JSON.stringify(res));
  const r = W.ensure({ project: "demo", task: "R-901", repo, base: "main", branchPrefix: "feature/", run: "R-901" });
  let err: any = null; try { const s = await W.startRound("demo", "R-901", "R-901/build#1", { write: true }); s.release(); } catch (e) { err = e; }
  ok(!!EnvGapError && err instanceof EnvGapError && err.gap.code === "env.tool-missing" && /dependencies not installed: env\.tool-missing/.test(JSON.stringify(W.get("demo", "R-901")?.history ?? null)),
    "1d: a round whose dependencies cannot be installed does not start: startRound stops with the typed gap and the worktree record says why", String(err?.message ?? err) + " " + r.path);
} finally { process.env.PATH = realPath; }

// ---------- 2. the test command from package.json, read from the base ----------
const code = await import("../src/domain/code") as any;
{ const repo = mkRepo({ "package.json": pkg({ scripts: { test: "node --test" } }), "test/a.test.mjs": 'import test from "node:test";\ntest("a", () => {});\n' });
  const base = sh(repo, "git", "rev-parse", "HEAD").out;
  sh(repo, "git", "checkout", "-q", "-b", "feature/x"); writeFileSync(join(repo, "package.json"), pkg({ scripts: { test: "exit 7" } })); sh(repo, "git", "commit", "-qam", "change the test script");
  const at = typeof code.repoCfgAt === "function" ? code.repoCfgAt(repo, base) : null;
  ok(!!at?.test && /package\.json scripts\.test: node --test/.test(at.testSource ?? ""), "2a: repoCfgAt resolves the test command from package.json scripts.test when there is no .crew/gates.json", JSON.stringify(at));
  const run = at?.test ? Bun.spawnSync(at.test, { cwd: repo, stdout: "pipe", stderr: "pipe" }) : null;
  ok(run?.exitCode === 0 && /pass 1/.test(run.stdout.toString()), "2b: the resolved command really runs the package's tests (node --test)", run ? run.stdout.toString().slice(-200) + run.stderr.toString().slice(-200) : "(no command)");
  ok(at?.test?.at(-1) === "node --test", "2c: an edit of the test script on the branch never changes the command resolved from the base", JSON.stringify(at?.test));
  const gates = mkRepo({ "package.json": pkg({ scripts: { test: "node --test" } }), ".crew/gates.json": JSON.stringify({ test: ["bun", "test"] }) });
  const g = typeof code.repoCfgAt === "function" ? code.repoCfgAt(gates, "HEAD") : null;
  ok(g?.test?.join(" ") === "bun test" && g.testSource === ".crew/gates.json test", "2d: .crew/gates.json `test` still wins over package.json", JSON.stringify(g)); }

// ---------- 3 and 4. the preflight at dispatch, through the real code-firstmate workflow ----------
const { installCode } = code;
const { Projects } = await import("../src/doors");
const def = readFileSync(join(root, "packs/firstmate/workflows/code-firstmate.wf.yaml"), "utf8");
const H = await harness([def], { data: join(tmp, "engine"), checkRoots: [] });
const E = H.engine;
installCode(E, { dataDir: H.data, projects: new Projects(H.data) });
const intent = (test = "test/percent.test.ts") => ["Add a percent function", "STUB_FILE src/percent.mjs :: export const percent = (a, p) => Math.round((a * p) / 100);\\n",
  `STUB_FILE ${test} :: import test from "node:test";\\ntest("p", () => {});\\n`].join("\n");
const settle = async (id: string, f: () => boolean) => until(() => f() || ["failed", "succeeded"].includes(E.get(id)!.status), 120000);
const openCards = (id: string) => E.cards.list({ run: id, open: true });
const envEntries = (id: string) => E.ledger(id).filter((e: any) => e.check === "firstmate/env-preflight");
const nodes = (id: string) => JSON.stringify(Object.entries(E.get(id)!.nodes).filter(([, x]: any) => x.state !== "pending").map(([k, x]: any) => `${k}:${x.state}:${x.outcome}:${x.visits}`));
const firstOutcome = (id: string) => E.get(id)!.ctx.refine?.["spec-fix"]?.history?.[0]?.outcome;

// 3a. a repository without a test command proceeds to dispatch; missing tests are not an environment blocker.
{ const repo = mkRepo({ "package.json": pkg(), "src/money.mjs": "export const m = 1;\n" });
  const r = E.start({ workflow: "code-firstmate", text: intent(), params: { repo } });
  await settle(r.id, () => openCards(r.id).length > 0);
  const pf = envEntries(r.id)[0] as any;
  ok(pf?.verdict === "pass" && pf.data?.testing?.status === "not-run", "3a: no test command allows dispatch and records testing as not-run", JSON.stringify(pf));
  ok(E.cards.list({ run: r.id }).some((c: any) => c.kind === "dispatch"), "3b: no-test repository reaches the captain's dispatch card", nodes(r.id));
  ok(!E.events(r.id).some((e: any) => e.type === "env_gap" && e.code === "env.test-command"), "3c: absent tests do not cause spec repair or a fabricated test result");
  await E.cancel(r.id, "captain"); }

// 3e. a done line whose test path matches none of the repository's test globs
{ const repo = mkRepo({ "package.json": pkg(), ".crew/gates.json": JSON.stringify({ test: ["node", "--test"], tests: ["test/**"] }), "test/a.test.mjs": "\n" });
  const r = E.start({ workflow: "code-firstmate", text: intent("tests/percent.test.mjs"), params: { repo } });
  await settle(r.id, () => (E.get(r.id)!.nodes.spec?.visits ?? 0) >= 2 || openCards(r.id).length > 0);
  const pf = envEntries(r.id)[0] as any;
  ok(pf?.verdict === "fail" && pf.findings.some((f: any) => f.class === "env.test-path" && /tests\/percent\.test\.mjs/.test(f.message) && f.locator?.section === "done[0]") && !E.cards.list({ run: r.id }).some((c: any) => c.kind === "dispatch") && firstOutcome(r.id) === "retry",
    "3e: a done line naming tests/percent.test.mjs in a repo whose tests are test/** is an env.test-path gap at dispatch, sent to Firstmate", JSON.stringify(pf?.findings ?? null) + nodes(r.id));
  await E.cancel(r.id, "captain"); }

// 3f. the control: R-028's shape (package.json `node --test`, no gates file) passes the preflight and reaches the dispatch card
{ const repo = mkRepo({ "package.json": pkg({ scripts: { test: "node --test" } }), "test/a.test.mjs": "\n" });
  const r = E.start({ workflow: "code-firstmate", text: intent(), params: { repo } });
  await settle(r.id, () => openCards(r.id).length > 0);
  const pf = envEntries(r.id)[0] as any;
  ok(pf?.verdict === "pass" && openCards(r.id).some((c: any) => c.kind === "dispatch"), "3f: a repository whose package.json has `node --test` (R-028) passes the env preflight and reaches the dispatch card", JSON.stringify(pf ?? null) + nodes(r.id));
  await E.cancel(r.id, "captain"); }

// 4a. a missing tool goes to Firstmate first, not to a captain card
process.env.PATH = noPnpm;
try {
  const repo = mkRepo({ "package.json": pkg({ scripts: { test: "node --test" } }), "pnpm-lock.yaml": "lockfileVersion: '9.0'\n", "test/a.test.mjs": "\n" });
  const r = E.start({ workflow: "code-firstmate", text: intent(), params: { repo } });
  await settle(r.id, () => (E.get(r.id)!.nodes.spec?.visits ?? 0) >= 2 || openCards(r.id).length > 0);
  const pf = envEntries(r.id)[0] as any;
  ok(pf?.findings?.some((f: any) => f.class === "env.tool-missing" && /pnpm/.test(f.message)) && firstOutcome(r.id) === "retry" && (E.get(r.id)!.ctx.envGaps ?? []).every((x: any) => x.route === "firstmate"),
    "4a: env.tool-missing (pnpm-lock.yaml, no pnpm) goes to Firstmate's repair turn first, not to a captain card", JSON.stringify([pf?.findings, firstOutcome(r.id)]) + nodes(r.id));
  await E.cancel(r.id, "captain");
} finally { process.env.PATH = realPath; }

// 4b. only a permission need surfaces to the captain: dependencies to install and no registry host the sandbox may reach
{ const repo = mkRepo({ "package.json": pkg({ scripts: { test: "node --test" }, devDependencies: { leftpad: "1.0.0" } }), "package-lock.json": npmLock, "test/a.test.mjs": "\n" });
  const r = E.start({ workflow: "code-firstmate", text: intent(), params: { repo } });
  await settle(r.id, () => openCards(r.id).length > 0);
  const card = openCards(r.id)[0] as any; const g = E.get(r.id)!;
  ok(card?.kind === "scope" && /^Permission needed/.test(card.title?.en ?? card.title) && /env\.permission/.test(card.body) && /egress\.allow/.test(card.body) && /registry\.npmjs\.org/.test(card.body) && firstOutcome(r.id) === "env-permission" && g.nodes.spec.visits === 1 && g.nodes.build.state === "pending",
    "4b: an install that needs a registry host is env.permission: a captain card that names the permission, straight from dispatch, with no build round", JSON.stringify([card?.kind, card?.title, card?.body?.slice(0, 300), firstOutcome(r.id)]) + nodes(r.id));
  ok((g.ctx.envGaps ?? []).some((x: any) => x.code === "env.permission" && x.route === "captain"), "4c: the permission gap is the only kind routed to the captain", JSON.stringify(g.ctx.envGaps));
  await E.cancel(r.id, "captain"); }

// 4d. only a registry needs the permission: local file: packages install offline, so no captain card for them
{ const ep = await import("../src/env-preflight").catch(() => null) as any;
  const files: Record<string, string> = { "package.json": pkg({ scripts: { test: "node --test" }, dependencies: { helper: "file:./vendor/helper" } }), "package-lock.json": npmLock };
  const gaps = ep?.envPreflight({ cfg: { test: ["node", "--test"], tests: ["test/**"], testSource: ".crew/gates.json test" }, done: [], has: (p: string) => p in files, read: (p: string) => files[p] ?? null, install: null, egressHosts: [], unrestricted: false });
  ok(Array.isArray(gaps) && !gaps.some((g: any) => g.code === "env.permission"), "4d: dependencies that are only local file: packages need no registry permission", JSON.stringify(gaps)); }

// 4e. the permission names the exact hosts to allow, and is gone once they are allowed
{ const ep = await import("../src/env-preflight").catch(() => null) as any;
  const pre = (files: Record<string, string>, egressHosts: string[]) => ep?.envPreflight({ cfg: { test: ["node", "--test"], tests: ["test/**"], testSource: ".crew/gates.json test" }, done: [], has: (p: string) => p in files, read: (p: string) => files[p] ?? null, install: null, egressHosts, unrestricted: false, which: () => "/bin/true" }) ?? [];
  const npm = { "package.json": pkg({ dependencies: { leftpad: "1.0.0" } }), "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: { "node_modules/leftpad": { resolved: "https://registry.npmjs.org/leftpad/-/leftpad-1.0.0.tgz" } } }) };
  const yarn = { "package.json": pkg({ dependencies: { leftpad: "1.0.0" } }), "yarn.lock": '# yarn lockfile v1\nleftpad@1.0.0:\n  resolved "https://registry.yarnpkg.com/leftpad/-/leftpad-1.0.0.tgz#abc"\n' };
  const a = pre(npm, []).find((g: any) => g.code === "env.permission"), b = pre(npm, ["registry.npmjs.org"]), c = pre(yarn, ["registry.npmjs.org"]).find((g: any) => g.code === "env.permission");
  ok(JSON.stringify(a?.hosts) === JSON.stringify(["registry.npmjs.org"]) && /allow registry\.npmjs\.org in/.test(a?.expected ?? "") && !b.some((g: any) => g.code === "env.permission") && JSON.stringify(c?.hosts) === JSON.stringify(["registry.yarnpkg.com"]),
    "4e: the permission card names exactly the registry hosts the lockfile needs, and allowing them clears it", JSON.stringify({ a, b, c })); }

H.stop();
end();
