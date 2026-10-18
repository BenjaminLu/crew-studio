import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Tests never read the operator's local .env (captain decision 2026-10-16). The
// captain runs live Studio from this checkout with a .env that opts into
// unrestricted execution and live data, port and GitHub settings; Bun loads it
// from the working directory. Every test entry imports tests/lib/isolated-env.mjs
// first, and every bun child a test starts inherits --no-env-file.
// This suite fails when a hostile .env reaches a test or a child it starts, or when
// a test entry lacks the guard.     bun tests/env-isolation.ts
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
let pass = 0, fail = 0;
const ok = (c: boolean, name: string, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const root = join(import.meta.dir, "..");
const guard = join(import.meta.dir, "lib", "isolated-env.mjs");
const GUARD_LINE = 'import "./lib/isolated-env.mjs";';
const OPERATOR = ["CREW_LOCAL_UNRESTRICTED", "CREW_LOCAL_DEPENDENCY_ROOT", "CREW_DATA", "CREW_PORT", "CREW_GH"];

// ---------- this suite itself ----------
{
  const { dotenvValues } = await import(guard);
  // the guard's own mark and the BUN_OPTIONS it rewrote may equal a .env line; neither came from the .env
  const leaked = [...dotenvValues()].filter(([k, vs]: [string, Set<string>]) => !["CREW_TEST_ENV_ISOLATED", "BUN_OPTIONS", "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "TMP", "TEMP", "LANG", "TERM", "PWD"].includes(k) && process.env[k] !== undefined && vs.has(process.env[k]!)).map(([k]) => k);
  ok(leaked.length === 0, "this suite holds no value from a .env in its working directory or the repository root", leaked.join(","));
  const opts = (process.env.BUN_OPTIONS || "").split(/\s+/);
  ok(opts.includes("--no-env-file") && !opts.some((f) => f.startsWith("--env-file")), "the bun children this suite starts inherit --no-env-file and no --env-file", process.env.BUN_OPTIONS);
}

// ---------- every test entry imports the guard first ----------
{
  // Modules other tests import or start as fake tools: not entries, so no guard.
  const HELPERS = new Set(["boot.mjs", "codex-image-fixture.mjs", "codex-protocol.mjs", "compare-fixture.ts", "gate-harness.ts", "projects-fixture.ts", "intent-card-fixture.ts", "remote-gates-card-fixture.ts", "rt-harness.ts", "transcripts-fixture.mjs"]);
  const isHelper = (n: string) => HELPERS.has(n) || /^stub-.*\.mjs$/.test(n);
  const top = readdirSync(import.meta.dir).filter((n) => /\.(ts|mjs)$/.test(n) && !isHelper(n));
  const scripts = Object.values(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts as Record<string, string>).join(" ");
  const named = [...new Set([...scripts.matchAll(/tests\/([A-Za-z0-9._-]+\.(?:ts|mjs))/g)].map((m) => m[1]))];
  const missing = [...new Set([...top, ...named])].filter((n) => readFileSync(join(import.meta.dir, n), "utf8").split("\n")[0].trim().split(" //")[0] !== GUARD_LINE);
  ok(top.length > 100 && named.length > 100, "the entry lists are not empty", `${top.length} top-level, ${named.length} named by package.json`);
  ok(missing.length === 0, "every test entry (top-level tests and every file a package.json script runs) imports the guard on its first line", missing.join(", "));
  ok(named.every((n) => !isHelper(n)), "no package.json script runs a file this suite treats as a helper", named.filter(isHelper).join(","));
  const prod = [join(root, "src"), join(root, "scripts")].flatMap((d) => (readdirSync(d, { recursive: true }) as string[]).filter((n) => /\.(ts|mjs|js)$/.test(n)).map((n) => join(d, n)));
  ok(prod.every((f) => !readFileSync(f, "utf8").includes("isolated-env")), "production code (src/, scripts/) never imports the test guard, so bun src/main.ts still loads .env");
  let bunfig = ""; try { bunfig = readFileSync(join(root, "bunfig.toml"), "utf8"); } catch {}
  ok(!/\benv\s*=\s*false|no-env-file|preload/.test(bunfig), "no bunfig.toml setting changes how the live start path loads .env");
  ok(!/--no-env-file|BUN_OPTIONS/.test(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts.start), "bun run start keeps Bun's .env loading");
}

// ---------- a hostile .env in the working directory ----------
{
  const dir = mkdtempSync(join(tmpdir(), "crew-env-isolation-"));
  const hostile: Record<string, string> = { CREW_LOCAL_UNRESTRICTED: "1", CREW_LOCAL_DEPENDENCY_ROOT: dir, CREW_DATA: join(dir, "live-data"), CREW_PORT: "1", CREW_GH: "1" };
  writeFileSync(join(dir, ".env"), Object.entries(hostile).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
  const show = `JSON.stringify(Object.fromEntries(${JSON.stringify(OPERATOR)}.map(k=>[k,process.env[k]??null])))`;
  writeFileSync(join(dir, "child.ts"), `console.log(${show});\n`);
  const probe = (head: string) => `${head}\nimport { spawnSync } from "node:child_process";\nconst child = spawnSync("bun", ["child.ts"], { cwd: ${JSON.stringify(dir)}, encoding: "utf8" });\nconsole.log(JSON.stringify({ self: JSON.parse(${show}), child: JSON.parse(child.stdout || "null") }));\n`;
  writeFileSync(join(dir, "plain.ts"), probe(""));
  writeFileSync(join(dir, "guarded.ts"), probe(`import ${JSON.stringify(guard)};`));
  writeFileSync(join(dir, "guarded.mjs"), probe(`import ${JSON.stringify(guard)};`));
  // A fresh operator shell: no guard marker, no BUN_OPTIONS, no operator keys.
  const fresh: Record<string, string> = { ...(process.env as any) };
  for (const k of [...OPERATOR, "BUN_OPTIONS", "CREW_TEST_ENV_ISOLATED"]) delete fresh[k];
  const run = (cmd: string, file: string, extra: Record<string, string> = {}) => {
    const r = Bun.spawnSync([cmd, file], { cwd: dir, env: { ...fresh, ...extra }, stdout: "pipe", stderr: "pipe" });
    try { return JSON.parse(r.stdout.toString().trim().split("\n").at(-1)!); } catch { return { error: r.stderr.toString().slice(-500) }; }
  };
  const clean = (o: any) => o && OPERATOR.every((k) => o[k] === null);
  const plain = run("bun", "plain.ts");
  ok(plain.self?.CREW_LOCAL_UNRESTRICTED === "1" && plain.child?.CREW_DATA === hostile.CREW_DATA, "control: without the guard Bun loads the hostile .env (the check below is not vacuous)", JSON.stringify(plain));
  const bunRun = run("bun", "guarded.ts");
  ok(clean(bunRun.self), "a bun test entry sees default isolation: no CREW_LOCAL_UNRESTRICTED, CREW_DATA, CREW_PORT, CREW_GH or dependency root from .env", JSON.stringify(bunRun));
  ok(clean(bunRun.child), "a bun child it starts in the same directory does not load the .env either", JSON.stringify(bunRun));
  const nodeRun = run("node", "guarded.mjs");
  ok(clean(nodeRun.self) && clean(nodeRun.child), "a node test entry and its bun child see default isolation", JSON.stringify(nodeRun));
  const polluted = run("node", "guarded.mjs", hostile);
  ok(clean(polluted.self) && clean(polluted.child), "values already exported from the .env (as a runner that loaded it would) are dropped", JSON.stringify(polluted));
  const own = { CREW_DATA: join(dir, "test-data"), CREW_LOCAL_UNRESTRICTED: "0" };
  const exported = run("bun", "guarded.ts", own);
  ok(clean(exported.self) && clean(exported.child), "a top-level test entry clears the operator keys even when the shell exported them", JSON.stringify(exported));
  writeFileSync(join(dir, "sets.ts"), `import ${JSON.stringify(guard)};\nimport { spawnSync } from "node:child_process";\nconst child = spawnSync("bun", ["child.ts"], { cwd: ${JSON.stringify(dir)}, encoding: "utf8", env: { ...process.env, ...${JSON.stringify(own)} } });\nconsole.log(JSON.stringify({ self: JSON.parse(${show}), child: JSON.parse(child.stdout || "null") }));\n`);
  const set = run("bun", "sets.ts");
  ok(set.child?.CREW_DATA === own.CREW_DATA && set.child?.CREW_LOCAL_UNRESTRICTED === "0" && set.child?.CREW_PORT === null, "a value a test sets itself after the import reaches its children; the .env still fills nothing in", JSON.stringify(set));
  const nested = run("bun", "guarded.ts", { CREW_TEST_ENV_ISOLATED: process.env.CREW_TEST_ENV_ISOLATED!, BUN_OPTIONS: process.env.BUN_OPTIONS!, ...hostile });
  ok(nested.self?.CREW_LOCAL_UNRESTRICTED === "1" && nested.child?.CREW_LOCAL_UNRESTRICTED === "1", "a test that deliberately opts a child test into unrestricted mode keeps it (tests/local-execution.ts style)", JSON.stringify(nested));
}

// ---------- a hostile .env that also sets BUN_OPTIONS, the mark or GIT_* ----------
{
  const KEYS = [...OPERATOR, "GIT_DIR", "GIT_WORK_TREE"];
  const show = `JSON.stringify(Object.fromEntries(${JSON.stringify(KEYS)}.map(k=>[k,process.env[k]??null])))`;
  const fresh: Record<string, string> = { ...(process.env as any) };
  for (const k of [...KEYS, "BUN_OPTIONS", "CREW_TEST_ENV_ISOLATED", "CREW_TEST_RESTARTED_BY"]) delete fresh[k];
  const clean = (o: any) => o && KEYS.every((k) => o[k] === null);
  const setup = (files: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), "crew-env-isolation-bunopts-"));
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text.replaceAll("$DIR", dir));
    writeFileSync(join(dir, "child.ts"), `console.log(${show});\n`);
    writeFileSync(join(dir, "guarded.ts"), `import ${JSON.stringify(guard)};\nimport { spawnSync } from "node:child_process";\nconst child = spawnSync("bun", ["child.ts"], { cwd: ${JSON.stringify(dir)}, encoding: "utf8" });\nconsole.log(JSON.stringify({ self: JSON.parse(${show}), child: JSON.parse(child.stdout || "null"), opts: process.env.BUN_OPTIONS }));\n`);
    return dir;
  };
  const run = (dir: string, argv: string[]) => { const r = Bun.spawnSync(argv, { cwd: dir, env: fresh, stdout: "pipe", stderr: "pipe" });
    let out: any; try { out = JSON.parse(r.stdout.toString().trim().split("\n").at(-1)!); } catch { out = {}; } return { ...out, code: r.exitCode, err: r.stderr.toString().slice(-400) }; };
  const ops = "CREW_LOCAL_UNRESTRICTED=1\nCREW_DATA=$DIR/live-data\nCREW_PORT=1\nCREW_GH=1\n";
  const cases: [string, Record<string, string>][] = [
    [".env sets BUN_OPTIONS=--no-env-file", { ".env": `BUN_OPTIONS=--no-env-file\n${ops}` }],
    [".env sets BUN_OPTIONS=--env-file=.env and GIT_DIR=decoy", { ".env": `BUN_OPTIONS=--env-file=.env\nGIT_DIR=$DIR/decoy/.git\nGIT_WORK_TREE=$DIR/decoy\n${ops}` }],
    [".env sets BUN_OPTIONS=--no-env-file and CREW_TEST_ENV_ISOLATED=1", { ".env": `BUN_OPTIONS=--no-env-file\nCREW_TEST_ENV_ISOLATED=1\n${ops}` }],
    [".env sets BUN_OPTIONS=--env-file=.env.local, .env.local sets CREW_LOCAL_UNRESTRICTED=1", { ".env": "BUN_OPTIONS=--env-file=.env.local\n", ".env.local": `${ops}GIT_DIR=$DIR/decoy/.git\n` }],
  ];
  for (const [name, files] of cases) {
    const r = run(setup(files), ["bun", "guarded.ts"]);
    ok(r.code === 0 && clean(r.self) && clean(r.child) && !/--env-file/.test(r.opts ?? "--env-file"), `${name}: the test and its bun child see none of it`, JSON.stringify(r));
  }
  // a forged restart mark naming the real parent (a shell that forks bun): the run refuses instead of trusting it
  const forgedDir = setup({ ".env": ops });
  const forged = run(forgedDir, ["sh", "-c", "CREW_TEST_RESTARTED_BY=$$ bun guarded.ts; exit $?"]);
  ok(forged.code !== 0 && /restarted test run still has/.test(forged.err) && !forged.self, "a forged restart mark with the .env loaded stops the run with a clear message (exit 1)", JSON.stringify(forged));
  const forgedGit = run(setup({}), ["sh", "-c", "CREW_TEST_RESTARTED_BY=$$ GIT_DIR=/nonexistent/.git BUN_OPTIONS=--no-env-file bun guarded.ts; exit $?"]);
  ok(forgedGit.code !== 0 && /GIT_DIR/.test(forgedGit.err), "a forged restart mark with GIT_DIR set stops the run too", JSON.stringify(forgedGit));
}

// ---------- no test reaches the real Claude or Codex CLI ----------
{
  const dir = mkdtempSync(join(tmpdir(), "crew-env-isolation-cli-"));
  // an operator shell: the real PATH (no sentinel), no guard marks, no CLI overrides
  const sentinel = process.env.CREW_TEST_CLI_SENTINEL!;
  const fresh: Record<string, string> = { ...(process.env as any), PATH: (process.env.PATH || "").split(":").filter((d) => d !== sentinel).join(":") };
  for (const k of ["BUN_OPTIONS", "CREW_TEST_ENV_ISOLATED", "CREW_TEST_RESTARTED_BY", "CREW_TEST_CLI_SENTINEL", "CREW_CLAUDE_BIN", "CREW_CODEX_BIN", "CREW_HOST_CLAUDE_BIN", "CREW_HOST_CODEX_BIN"]) delete fresh[k];
  // a fake "real" CLI on the operator's PATH: if the sentinel let a call through, it would answer 0
  const real = join(dir, "real-bin"); mkdirSync(real);
  for (const b of ["claude", "codex"]) { writeFileSync(join(real, b), `#!/bin/sh\necho REAL-${b}\nexit 0\n`); chmodSync(join(real, b), 0o755); }
  fresh.PATH = `${real}:${fresh.PATH}`;
  const body = (head: string, call: string) => `${head}\nimport { spawnSync } from "node:child_process";\n${call}\nconsole.log(JSON.stringify({ bins: ["CREW_CLAUDE_BIN","CREW_CODEX_BIN","CREW_HOST_CLAUDE_BIN","CREW_HOST_CODEX_BIN"].map(k => process.env[k]) }));\n`;
  const runs = `const r = spawnSync("claude", ["auth", "status", "--json"], { encoding: "utf8", env: { PATH: process.env.PATH } }); console.log("child exit " + r.status + " " + (r.stdout || "").trim());`;
  writeFileSync(join(dir, "leaks.ts"), body(`import ${JSON.stringify(guard)};`, runs));
  writeFileSync(join(dir, "leaks.mjs"), body(`import ${JSON.stringify(guard)};`, runs.replace('"claude"', '"codex"')));
  writeFileSync(join(dir, "clean.ts"), body(`import ${JSON.stringify(guard)};`, ""));
  writeFileSync(join(dir, "nests.ts"), `import ${JSON.stringify(guard)};\nimport { spawnSync } from "node:child_process";\nconst r = spawnSync("bun", ["leaks.ts"], { cwd: ${JSON.stringify(dir)}, encoding: "utf8" });\nconsole.log("nested exit " + r.status);\n`);
  const run = (cmd: string, file: string) => { const r = Bun.spawnSync([cmd, file], { cwd: dir, env: fresh, stdout: "pipe", stderr: "pipe" }); return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() }; };
  const leak = run("bun", "leaks.ts");
  ok(leak.code === 1 && /child exit 97/.test(leak.out) && !/REAL-claude/.test(leak.out) && /FAIL 1 call\(s\) reached the real CLI/.test(leak.err) && /claude auth status --json/.test(leak.err), "a bun test whose child runs `claude` from PATH never reaches the real CLI and fails, naming the call", JSON.stringify(leak));
  const nodeLeak = run("node", "leaks.mjs");
  ok(nodeLeak.code === 1 && /child exit 97/.test(nodeLeak.out) && /codex auth status --json/.test(nodeLeak.err), "a node test entry is caught the same way (codex too)", JSON.stringify(nodeLeak));
  const nested = run("bun", "nests.ts");
  ok(nested.code === 1 && /nested exit 0/.test(nested.out) && /claude auth status/.test(nested.err), "a test entry another test starts shares the sentinel: its call fails the outermost run", JSON.stringify(nested));
  const clean = run("bun", "clean.ts");
  let bins: string[] = []; try { bins = JSON.parse(clean.out.trim().split("\n").at(-1)!).bins; } catch {}
  ok(clean.code === 0 && bins.length === 4 && bins.every((b) => b.startsWith("/nonexistent/crew-test-cli/")), "a test that runs no CLI passes; the CLI settings default to a CLI that is not installed", JSON.stringify(clean));
  ok(!readdirSync(tmpdir()).some((n) => n.startsWith("crew-test-cli-sentinel-") && readFileSync(join(tmpdir(), n, "calls.log"), "utf8").includes(dir)), "each run removes its sentinel folder");
}

console.log(`\nenv-isolation: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
