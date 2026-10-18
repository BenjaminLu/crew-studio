// Prepare: a skill version's dependencies, installed once from the lockfiles inside the skill (docs/units/skill-packages.md §4).
//   data/envs/<key>/            key = sha256(lockfile bytes + platform + arch + runtime versions): content-addressed, shared by
//                               every skill version with the same locks on the same runtimes, never changed once complete
//     env.json                  written last: the env is complete only with it (key, kind, runtimes, installScripts, refs)
//     node/{package.json, package-lock.json, node_modules/}
//     py/venv/
//   data/envs/.cache-<rand>/    one prepare's own package cache, deleted after it
// The install runs inside the round sandbox: it writes only the env folder and its cache, reads nothing of Studio's data or the
// user's secrets, and reaches only the hosts its lockfiles name (registry.npmjs.org, pypi.org, files.pythonhosted.org … as
// the lock resolves them), through a strict egress credential of its own. npm runs with --ignore-scripts: a package's install
// script is code from the registry, unreviewed, so it never runs at prepare unless the captain's approval named that package;
// the packages that ship one are recorded. Python installs wheels only (--only-binary: an sdist build is an install script
// too) with every hash required (--require-hashes). An env no approved, in-use skill version names is removed (gc).
import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { roundExec } from "../runtime/checks";
import { requirementLines, type PackageInfo } from "./analyze";
import type { Runtime } from "./runtimes";

export type EnvRecord = { schema: 1; key: string; npm: boolean; python: boolean; runtimes: { node?: string; npm?: string; python?: string }; installScripts: string[]; ranScripts: string[]; hosts: string[]; refs: string[]; at: string };
export type PrepareCtx = { dataDir: string; protect?: string[]; egress?: { port: number; open(t: string, h: string[], meta?: any): void; close(t: string): void } | null; timeoutS?: number; signal?: AbortSignal };
export class PrepareError extends Error { constructor(m: string, readonly zh: string) { super(m); } }
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

/** What a lockfile set installs, read without running anything: the hosts it resolves to and the packages with install scripts. */
export function npmPlan(lockText: string): { hosts: string[]; installScripts: string[]; packages: number } {
  let lock: any; try { lock = JSON.parse(lockText); } catch { throw new PrepareError("package-lock.json is not JSON", "package-lock.json 不是 JSON"); }
  if (!lock?.packages || typeof lock.packages !== "object" || Number(lock.lockfileVersion) < 2) throw new PrepareError("package-lock.json must be lockfileVersion 2 or 3 (npm 7 or later)", "package-lock.json 需要 lockfileVersion 2 或 3（npm 7 以後）");
  const hosts = new Set<string>(), scripts = new Set<string>(); let n = 0;
  for (const [path, p] of Object.entries<any>(lock.packages)) {
    if (!path) continue;
    if (p?.link) throw new PrepareError(`${path}: linked dependencies are not registry tarballs`, `${path}：連結依賴不是套件庫 tarball`);
    n++;
    if (typeof p.resolved !== "string") throw new PrepareError(`${path}: no resolved registry tarball URL`, `${path}：缺少套件庫 tarball 的 resolved 網址`);
    let u: URL; try { u = new URL(p.resolved); } catch { throw new PrepareError(`${path}: resolved is not a URL`, `${path}：resolved 不是網址`); }
    if (!/^https?:$/.test(u.protocol)) throw new PrepareError(`${path} resolves to a ${u.protocol} URL; only registry tarballs are installed`, `${path} 不是從套件庫下載；只裝套件庫的 tarball`);
    if (typeof p.integrity !== "string" || !/^sha(256|384|512)-/.test(p.integrity)) throw new PrepareError(`${path} has no integrity hash in package-lock.json`, `${path} 在 package-lock.json 裡沒有 integrity 雜湊`);
    hosts.add(u.hostname.toLowerCase());
    if (p.hasInstallScript) scripts.add(path.replace(/^.*node_modules\//, ""));
  }
  return { hosts: [...hosts].sort(), installScripts: [...scripts].sort(), packages: n };
}
/** A python lock as hash-pinned requirement lines and the index to read them from (uv.lock and a script's .lock are uv's TOML). */
export function pythonPlan(kind: "uv" | "requirements" | "pep723", text: string): { requirements: string; index: string; hosts: string[] } {
  if (kind === "requirements") {
    const idx = /^\s*(?:--index-url|-i)[ =](\S+)/m.exec(text)?.[1] ?? "https://pypi.org/simple/";
    const lines = requirementLines(text); if (!lines.length) throw new PrepareError("the requirements file lists nothing", "requirements 檔是空的");
    if (lines.some((l) => !/--hash=sha256:[a-f0-9]{64}/.test(l))) throw new PrepareError("every requirement needs a --hash (a lockfile)", "每一行都要有 --hash（才算 lockfile）");
    return { requirements: lines.join("\n") + "\n", index: idx, hosts: indexHosts(idx) };
  }
  let lock: any; try { lock = (Bun as any).TOML.parse(text); } catch (e: any) { throw new PrepareError(`the uv lockfile does not parse: ${e?.message ?? e}`, "uv lockfile 讀不了"); }
  const out: string[] = []; const hosts = new Set<string>(); let index = "https://pypi.org/simple/";
  for (const p of Array.isArray(lock?.package) ? lock.package : []) {
    const src = p?.source ?? {}; if (src.virtual || src.editable || src.directory || src.path) continue; // the project itself
    if (typeof src.registry !== "string") throw new PrepareError(`${p?.name}: only registry packages are installed (not ${Object.keys(src).join(", ") || "an unknown source"})`, `${p?.name}：只裝套件庫的套件`);
    index = src.registry.endsWith("/") ? src.registry : `${src.registry}/`; for (const h of indexHosts(index)) hosts.add(h);
    const hashes = [...(Array.isArray(p.wheels) ? p.wheels : []), ...(p.sdist ? [p.sdist] : [])].map((w: any) => { try { if (w.url) hosts.add(new URL(w.url).hostname); } catch {} return /^sha256:([a-f0-9]{64})$/.exec(String(w.hash ?? ""))?.[1]; }).filter(Boolean);
    if (!hashes.length) throw new PrepareError(`${p?.name} has no sha256 in the lockfile`, `${p?.name} 在 lockfile 裡沒有 sha256`);
    out.push(`${p.name}==${p.version} ${hashes.map((h: string) => `--hash=sha256:${h}`).join(" ")}`);
  }
  if (!out.length) throw new PrepareError("the uv lockfile installs nothing", "uv lockfile 沒有要裝的套件");
  return { requirements: out.join("\n") + "\n", index, hosts: [...hosts].sort() };
}
const indexHosts = (idx: string) => { const h = new URL(idx).hostname.toLowerCase(); return h === "pypi.org" ? ["pypi.org", "files.pythonhosted.org"] : [h]; };

/** The env key of a version's locks on these runtimes; null when it has no lockfile (nothing to install). */
export function envKey(pkg: PackageInfo, files: string, rt: { node?: Runtime | null; python?: Runtime | null }, platform = process.platform, arch = process.arch, allowScripts: string[] = []): string | null {
  if (!pkg.npm && !pkg.python) return null;
  const parts = [`schema:2`, `platform:${platform}`, `arch:${arch}`, `installScripts:${JSON.stringify([...new Set(allowScripts)].sort())}`];
  if (pkg.npm) { parts.push(`node:${rt.node?.version ?? "-"}`, `npm:${rt.node?.npmVersion ?? "-"}`); for (const f of pkg.npm.files) parts.push(`${f.replace(/^.*\//, "")}:${sha(readFileSync(join(files, f)))}`); }
  if (pkg.python) { parts.push(`python:${rt.python?.version ?? "-"}`, `pykind:${pkg.python.kind}`); for (const f of pkg.python.files) parts.push(`pylock:${sha(readFileSync(join(files, f)))}`); }
  return sha(parts.join("\n"));
}
export const envDir = (dataDir: string, key: string) => join(dataDir, "envs", key);
export function readEnv(dataDir: string, key: string): EnvRecord | null { try { return JSON.parse(readFileSync(join(envDir(dataDir, key), "env.json"), "utf8")); } catch { return null; } }

/** Run one prepare step in the sandbox: writes only the env and the cache, the lock's hosts only. Exported for its tests. */
export async function prepareExec(argv: string[], c: PrepareCtx & { cwd: string; writes: string[]; tmp: string; hosts: string[]; env?: Record<string, string>; reads?: string[] }) {
  return roundExec(argv, { cwd: c.cwd, writes: c.writes, tmp: c.tmp, dataDir: c.dataDir, protect: c.protect, timeoutS: c.timeoutS ?? 900, egress: c.egress, hosts: c.hosts, env: c.env, reads: c.reads,
    egressMeta: { purpose: "prepare", strict: true }, signal: c.signal, stdoutCap: 64 * 1024 });
}
const inflight = new Map<string, Promise<EnvRecord>>();
/**
 * Make (or reuse) the env for a version's locks. ref: "<id>@v<N>", recorded on the env (gc keeps an env any in-use ref names).
 * allowScripts: packages whose install scripts the captain's approval named (run after the install, with no network).
 */
export function prepareEnv(pkg: PackageInfo, files: string, rt: { node?: Runtime | null; python?: Runtime | null }, ref: string, c: PrepareCtx & { allowScripts?: string[] }): Promise<EnvRecord> {
  const key = envKey(pkg, files, rt, process.platform, process.arch, c.allowScripts); if (!key) throw new PrepareError("nothing to prepare", "沒有要準備的東西");
  const had = readEnv(c.dataDir, key);
  if (had) { if (!had.refs.includes(ref)) { had.refs = [...had.refs, ref].sort(); writeFileSync(join(envDir(c.dataDir, key), "env.json"), JSON.stringify(had, null, 1)); } return Promise.resolve(had); }
  const running = inflight.get(key); if (running) return running.then((e) => prepareEnv(pkg, files, rt, ref, c).then(() => e));
  const p = build(key, pkg, files, rt, ref, c).finally(() => inflight.delete(key)); inflight.set(key, p); return p;
}
async function build(key: string, pkg: PackageInfo, files: string, rt: { node?: Runtime | null; python?: Runtime | null }, ref: string, c: PrepareCtx & { allowScripts?: string[] }): Promise<EnvRecord> {
  const root = join(c.dataDir, "envs"), dir = envDir(c.dataDir, key), cache = join(root, `.cache-${randomBytes(6).toString("hex")}`);
  mkdirSync(root, { recursive: true });
  // an env folder without env.json is a prepare that did not finish (a crash): it is started again from nothing
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }); mkdirSync(join(cache, "tmp"), { recursive: true });
  const reads = [rt.node?.dir, rt.python?.dir].filter(Boolean) as string[];
  const hosts = new Set<string>(); let installScripts: string[] = [], ranScripts: string[] = [];
  const fail = (m: string, zh: string, out?: { stdout: string; stderr: string; refused?: string }) => { throw new PrepareError(`${m}${out?.refused ? ` (${out.refused})` : ""}${out ? `: ${(out.stderr || out.stdout).trim().split("\n").slice(-6).join(" | ").slice(0, 600)}` : ""}`, zh); };
  try {
    if (pkg.npm) {
      if (!rt.node || !rt.node.npm) fail("npm is not installed on this Mac: Studio needs the host's npm to install the skill's package-lock.json (it never installs node or npm itself)", "這台 Mac 沒有 npm：Studio 需要它來安裝 skill 的 package-lock.json");
      const plan = npmPlan(readFileSync(join(files, pkg.npm.files[1]), "utf8")); plan.hosts.forEach((h) => hosts.add(h)); installScripts = plan.installScripts;
      const nd = join(dir, "node"); mkdirSync(nd); for (const f of pkg.npm.files) copyFileSync(join(files, f), join(nd, f.replace(/^.*\//, "")));
      // no npmrc of the user's or of the npm install (a token or another registry there would change what is fetched): two empty ones
      writeFileSync(join(cache, "user.npmrc"), ""); writeFileSync(join(cache, "global.npmrc"), "");
      const env = { npm_config_cache: join(cache, "npm"), npm_config_userconfig: join(cache, "user.npmrc"), npm_config_globalconfig: join(cache, "global.npmrc"), npm_config_update_notifier: "false", npm_config_fund: "false", npm_config_audit: "false", npm_config_loglevel: "warn",
        npm_config_ignore_scripts: "true", npm_config_offline: "false" };
      const r = await prepareExec([rt.node!.npm!, "ci", "--ignore-scripts", "--no-audit", "--no-fund", "--no-update-notifier"], { ...c, cwd: nd, writes: [dir, cache], tmp: join(cache, "tmp"), hosts: plan.hosts, env, reads });
      if (r.code !== 0) fail(`npm ci failed (exit ${r.code}${r.timedOut ? ", timed out" : ""})`, "npm ci 失敗", r);
      const allowed = installScripts.filter((n) => (c.allowScripts ?? []).includes(n));
      if (allowed.length) { // the captain named these packages: their install scripts run now, still sandboxed, with no network
        const s = await prepareExec([rt.node!.npm!, "rebuild", ...allowed, "--ignore-scripts=false", "--foreground-scripts"], { ...c, cwd: nd, writes: [dir, cache], tmp: join(cache, "tmp"), hosts: [], env: { ...env, npm_config_ignore_scripts: "false" }, reads });
        if (s.code !== 0) fail(`the approved install scripts of ${allowed.join(", ")} failed (exit ${s.code})`, "核准的安裝腳本執行失敗", s);
        ranScripts = allowed;
      }
    }
    if (pkg.python) {
      if (!rt.python) fail("no python3 to install the skill's Python lock into", "沒有 python3 可以安裝 skill 的 Python 套件");
      const plan = pythonPlan(pkg.python.kind, readFileSync(join(files, pkg.python.files[0]), "utf8")); plan.hosts.forEach((h) => hosts.add(h));
      const pd = join(dir, "py"); mkdirSync(pd); writeFileSync(join(pd, "requirements.lock.txt"), plan.requirements);
      const v = await prepareExec([rt.python!.bin, "-I", "-m", "venv", join(pd, "venv")], { ...c, cwd: pd, writes: [dir, cache], tmp: join(cache, "tmp"), hosts: [], reads });
      if (v.code !== 0) fail(`python3 -m venv failed (exit ${v.code})`, "建立 Python venv 失敗", v);
      const r = await prepareExec([join(pd, "venv", "bin", "python"), "-I", "-m", "pip", "install", "--no-deps", "--require-hashes", "--only-binary", ":all:", "--no-input", "--disable-pip-version-check", "--progress-bar", "off",
        "--cache-dir", join(cache, "pip"), "--index-url", plan.index, ...(plan.index.startsWith("http://") ? ["--trusted-host", new URL(plan.index).hostname] : []), "-r", join(pd, "requirements.lock.txt")], { ...c, cwd: pd, writes: [dir, cache], tmp: join(cache, "tmp"), hosts: plan.hosts, env: { PIP_CONFIG_FILE: "/dev/null", PYTHONNOUSERSITE: "1" }, reads });
      if (r.code !== 0) fail(`pip install failed (exit ${r.code}${r.timedOut ? ", timed out" : ""}); only wheels are installed (an sdist build runs code)`, "pip install 失敗（只裝 wheel）", r);
    }
    const rec: EnvRecord = { schema: 1, key, npm: !!pkg.npm, python: !!pkg.python, runtimes: { ...(pkg.npm ? { node: rt.node?.version, npm: rt.node?.npmVersion ?? undefined } : {}), ...(pkg.python ? { python: rt.python?.version } : {}) },
      installScripts, ranScripts, hosts: [...hosts].sort(), refs: [ref], at: new Date().toISOString() };
    writeFileSync(join(dir, "env.json"), JSON.stringify(rec, null, 1));
    return rec;
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e; }
  finally { rmSync(cache, { recursive: true, force: true }); }
}
/** Remove every env no in-use ref names (and leftover caches). inUse: "<id>@v<N>" of the approved script skills the team or a workflow pins. */
export function gcEnvs(dataDir: string, inUse: Set<string>, keepNewerThanMs = 0): { removed: string[]; kept: string[] } {
  const root = join(dataDir, "envs"); const removed: string[] = [], kept: string[] = [];
  if (!existsSync(root)) return { removed, kept };
  for (const d of readdirSync(root)) {
    const p = join(root, d);
    if (d.startsWith(".cache-")) { if (!inflight.size) { rmSync(p, { recursive: true, force: true }); removed.push(d); } continue; }
    if (!/^[a-f0-9]{64}$/.test(d) || inflight.has(d)) continue;
    const rec = readEnv(dataDir, d);
    const young = (() => { try { return Date.now() - statSync(p).mtimeMs < keepNewerThanMs; } catch { return false; } })();
    if (rec && (rec.refs.some((r) => inUse.has(r)) || young)) { kept.push(d); continue; }
    if (!rec && young) { kept.push(d); continue; }
    rmSync(p, { recursive: true, force: true }); removed.push(d);
  }
  return { removed, kept };
}
