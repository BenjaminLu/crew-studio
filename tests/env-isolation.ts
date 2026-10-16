import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Tests never read the operator's local .env (captain decision 2026-10-16). The
// captain runs live Studio from this checkout with a .env that opts into
// unrestricted execution and live data, port and GitHub settings; Bun loads it
// from the working directory. Every test entry imports tests/lib/isolated-env.mjs
// first, and every bun child a test starts inherits --no-env-file.
// This suite fails when a hostile .env reaches a test or a child it starts, or when
// a test entry lacks the guard.     bun tests/env-isolation.ts
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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
  const leaked = [...dotenvValues()].filter(([k, vs]: [string, Set<string>]) => !["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "TMP", "TEMP", "LANG", "TERM", "PWD"].includes(k) && process.env[k] !== undefined && vs.has(process.env[k]!)).map(([k]) => k);
  ok(leaked.length === 0, "this suite holds no value from a .env in its working directory or the repository root", leaked.join(","));
  ok((process.env.BUN_OPTIONS || "").split(/\s+/).includes("--no-env-file"), "the bun children this suite starts inherit --no-env-file");
}

// ---------- every test entry imports the guard first ----------
{
  // Modules other tests import or start as fake tools: not entries, so no guard.
  const HELPERS = new Set(["boot.mjs", "codex-image-fixture.mjs", "codex-protocol.mjs", "intent-card-fixture.ts", "remote-gates-card-fixture.ts", "rt-harness.ts", "transcripts-fixture.mjs"]);
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
  const set = run("bun", "guarded.ts", own);
  ok(set.self?.CREW_DATA === own.CREW_DATA && set.child?.CREW_DATA === own.CREW_DATA && set.child?.CREW_LOCAL_UNRESTRICTED === "0" && set.child?.CREW_PORT === null, "a value a test sets itself is kept and reaches its children; the .env still fills nothing in", JSON.stringify(set));
  const nested = run("bun", "guarded.ts", { CREW_TEST_ENV_ISOLATED: "1", BUN_OPTIONS: "--no-env-file", ...hostile });
  ok(nested.self?.CREW_LOCAL_UNRESTRICTED === "1" && nested.child?.CREW_LOCAL_UNRESTRICTED === "1", "a test that deliberately opts a child test into unrestricted mode keeps it (tests/local-execution.ts style)", JSON.stringify(nested));
}

console.log(`\nenv-isolation: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
