// The environment a round needs, found before any provider starts (the round contract's P2 and P3 preflight,
// docs: the v1-vs-Studio briefing, slice S4). Deterministic, no model:
//   - which frozen install the lockfile actually present asks for (bun, npm, pnpm or yarn), and whether its
//     package manager is installed;
//   - whether the repository has a test command (read from the base commit: .crew/gates.json, else package.json
//     scripts.test) and whether its program is there;
//   - whether every test path a done line names is one the repository counts as a test (its `tests` globs).
// Each gap is a typed record with a code and a route. Studio fills what it can (the install, the test command
// discovery); a gap it cannot fill goes to Firstmate first (route "firstmate"). Only a permission the environment
// needs (a registry host the round sandbox may reach) goes to the captain (route "captain").
// TODO(failure-taxonomy): map these env.* codes onto src/runtime/failures.ts once the failure-taxonomy branch is on main.
import { matches } from "./doors";

export type EnvGapCode = "env.test-command" | "env.test-path" | "env.tool-missing" | "env.permission";
export type EnvGap = { code: EnvGapCode; route: "firstmate" | "captain"; message: string; expected: string; tool?: string; path?: string; done?: number; hosts?: string[] };
export type InstallPlan = { manager: "bun" | "npm" | "pnpm" | "yarn"; lockfile: string; argv: string[] };

const MANAGERS: { manager: InstallPlan["manager"]; lockfiles: string[] }[] = [
  { manager: "bun", lockfiles: ["bun.lock", "bun.lockb"] },
  { manager: "pnpm", lockfiles: ["pnpm-lock.yaml"] },
  { manager: "yarn", lockfiles: ["yarn.lock"] },
  { manager: "npm", lockfiles: ["package-lock.json", "npm-shrinkwrap.json"] },
];

/**
 * The frozen install for the lockfile a folder actually has: bun install --frozen-lockfile, npm ci, pnpm install
 * --frozen-lockfile, yarn install --frozen-lockfile (classic) or --immutable (Berry: a .yarnrc.yml, or a lockfile with
 * __metadata). package.json `packageManager` picks between several lockfiles; else the order above. Lifecycle scripts run
 * only when `scripts` is set. null: no package.json, or no lockfile.
 */
export function installPlan(has: (path: string) => boolean, read: (path: string) => string | null, o: { scripts?: boolean } = {}): InstallPlan | null {
  if (!has("package.json")) return null;
  const present = MANAGERS.map((m) => ({ ...m, lockfile: m.lockfiles.find(has) })).filter((m) => m.lockfile);
  if (!present.length) return null;
  let declared: string | null = null; try { declared = String(JSON.parse(read("package.json") ?? "{}")?.packageManager ?? "").split("@")[0] || null; } catch {}
  const pick = present.find((m) => m.manager === declared) ?? present[0];
  const lockfile = pick.lockfile!; const scripts = !!o.scripts;
  const argv = pick.manager === "bun" ? ["bun", "install", "--frozen-lockfile", ...(scripts ? [] : ["--ignore-scripts"])]
    : pick.manager === "npm" ? ["npm", "ci", ...(scripts ? [] : ["--ignore-scripts"])]
    : pick.manager === "pnpm" ? ["pnpm", "install", "--frozen-lockfile", ...(scripts ? [] : ["--ignore-scripts", "--ignore-pnpmfile"])]
    : has(".yarnrc.yml") || /^__metadata:/m.test(read("yarn.lock") ?? "") ? ["yarn", "install", "--immutable", ...(scripts ? [] : ["--mode=skip-build"])]
    : ["yarn", "install", "--frozen-lockfile", ...(scripts ? [] : ["--ignore-scripts", "--no-default-rc"])];
  return { manager: pick.manager, lockfile, argv };
}

/**
 * The hosts the frozen install fetches from: every http(s) host the lockfile names, plus the registry the repository
 * configures (.npmrc / .yarnrc `registry`, .yarnrc.yml `npmRegistryServer`), else the package manager's default registry.
 */
export function registryHosts(plan: { manager: string; lockfile: string }, read: (path: string) => string | null): string[] {
  const hosts = new Set<string>(); const add = (u: string) => { try { const h = new URL(u).hostname.toLowerCase(); if (h) hosts.add(h); } catch {} };
  for (const m of (read(plan.lockfile) ?? "").matchAll(/https?:\/\/[^\s"'#,)]+/g)) add(m[0]);
  const configured: string[] = [];
  for (const f of [".npmrc", ".yarnrc"]) for (const m of (read(f) ?? "").matchAll(/^\s*registry\s*[=\s]\s*"?([^"\s]+)"?\s*$/gm)) configured.push(m[1]);
  for (const m of (read(".yarnrc.yml") ?? "").matchAll(/^\s*npmRegistryServer:\s*["']?([^"'\s]+)/gm)) configured.push(m[1]);
  for (const u of configured.length ? configured : [plan.manager === "yarn" ? "https://registry.yarnpkg.com" : "https://registry.npmjs.org"]) add(u);
  return [...hosts].sort();
}
const allowedBy = (list: string[], h: string) => list.some((x) => { const a = x.toLowerCase(); return a === h || (a.startsWith("*.") && (h === a.slice(2) || h.endsWith(a.slice(1)))); });

/** A program on PATH (the PATH a round's install and tests get: Studio's own). */
export const onPath = (bin: string): string | null => (bin.includes("/") ? bin : Bun.which(bin, { PATH: process.env.PATH ?? "/usr/bin:/bin" }));

export function toolMissing(bin: string, why: string): EnvGap {
  return { code: "env.tool-missing", route: "firstmate", tool: bin, message: `${bin} is not installed on this machine, and ${why}`,
    expected: `install ${bin} where Studio runs (Doctor), or change the repository to a tool that is there` };
}

/** Only npm init's literal placeholder is absence of a real test script. */
export const isNpmTestPlaceholder = (script: string) => /^\s*echo\s+(?:"Error: no test specified"|'Error: no test specified')\s*&&\s*exit\s+1\s*$/.test(script);
const TEST_PATH = /(?:^|[\s`(])((?:tests?\/[\w./-]+)|(?:[\w./-]+\.test\.\w+))/gi;

/**
 * The environment gaps of a spec against the base: what a build round would otherwise find out inside the round (and
 * HOLD on). `cfg` is the repository's declared commands at the base; `read`/`has` read files of the base commit.
 */
export function envPreflight(o: {
  cfg: { test: string[] | null; tests: string[]; testSource: string | null; testError?: string | null };
  done: string[]; has: (path: string) => boolean; read: (path: string) => string | null;
  install: string[] | false | null; scripts?: boolean; egressHosts: string[]; unrestricted: boolean;
  which?: (bin: string) => string | null;
}): EnvGap[] {
  const which = o.which ?? onPath; const gaps: EnvGap[] = [];
  let pkg: any = null; try { pkg = JSON.parse(o.read("package.json") ?? "null"); } catch {}
  // dependencies a registry serves (a local file:, link:, workspace: or portal: package installs offline)
  const deps = pkg && typeof pkg === "object" ? ["dependencies", "devDependencies", "optionalDependencies"].some((k) => pkg[k] && typeof pkg[k] === "object" && Object.values(pkg[k]).some((v) => !/^(file|link|workspace|portal):/.test(String(v)))) : false;
  // P2: the dependencies
  if (o.install !== false) {
    const plan = Array.isArray(o.install) && o.install.length ? { argv: o.install, lockfile: "the project's install policy", manager: o.install[0] } : installPlan(o.has, o.read, { scripts: o.scripts });
    if (plan && !which(plan.argv[0])) gaps.push(toolMissing(plan.argv[0], `the repository's ${plan.lockfile} needs it to install its dependencies`));
    else if (plan && deps && !o.unrestricted) {
      const need = registryHosts({ manager: plan.manager, lockfile: plan.lockfile === "the project's install policy" ? "package-lock.json" : plan.lockfile }, o.read).filter((h) => !allowedBy(o.egressHosts, h));
      if (need.length) gaps.push({ code: "env.permission", route: "captain", tool: plan.argv[0], hosts: need, message: `installing the dependencies (${plan.argv.join(" ")}) needs ${need.join(", ")}, and the round sandbox may not reach ${need.length > 1 ? "them" : "it"}`,
        expected: `allow ${need.join(", ")} in the project's egress.allow policy, or set install: false` });
    }
  }
  // P3: the test command, from the base
  const script = o.cfg.testSource?.startsWith("package.json") ? o.cfg.test?.at(-1) ?? "" : null;
  if (o.cfg.testError) gaps.push({code:"env.test-command",route:"firstmate",message:o.cfg.testError,expected:"repair the malformed test configuration on the base branch"});
  else if (o.cfg.test && !(script !== null && isNpmTestPlaceholder(script))) {
    const prog = script !== null ? (script.trim().split(/\s+/)[0] ?? "") : o.cfg.test[0];
    if (prog && !/[=$`'"]/.test(prog) && !which(prog) && !(script !== null && deps))
      gaps.push(toolMissing(prog, `the test command (${o.cfg.testSource ?? o.cfg.test.join(" ")}) runs it`));
  }
  // P3: every test path a done line names is a test the repository runs
  o.done.forEach((line, n) => {
    for (const m of String(line).matchAll(TEST_PATH)) {
      const p = m[1].replace(/[.,;:)]+$/, "");
      if (!o.cfg.tests.some((g) => matches(g, p)))
        gaps.push({ code: "env.test-path", route: "firstmate", path: p, done: n, message: `done line ${n + 1} names ${p}, which matches none of the repository's test globs (${o.cfg.tests.join(", ")}): CI and fail-first would never run it`,
          expected: `name a test path under ${o.cfg.tests.join(" or ")}, or declare the path in .crew/gates.json \`tests\` on the base` });
    }
  });
  return gaps;
}
