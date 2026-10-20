// The runtimes a skill's scripts and its prepare use (docs/units/skill-packages.md §4), resolved without asking:
//   node: the host's node (with npm, which installs a package-lock); else Studio's own bun runs the scripts (no npm: a
//         skill with a package-lock is then not ready, and says why);
//   python: the host's python3 (not macOS's /usr/bin/python3 stub when Xcode's tools are missing); else a standalone build
//         that uv fetches into data/runtimes/python inside the prepare sandbox (uv checks each build's sha256), when uv is here.
// The versions found are part of an env's key: a new node or python makes a new env, never a mixed one.
import { existsSync, mkdirSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { roundExec } from "../runtime/checks";
import { cltPresent, onPath } from "./recipes";

export type Runtime = { name: "node" | "python"; bin: string; version: string; source: "host" | "studio" | "uv"; npm?: string | null; npmVersion?: string | null; dir: string };
export type RuntimeCtx = { dataDir: string; protect?: string[]; path?: string; egress?: { port: number; open(t: string, h: string[], meta?: any): void; close(t: string): void } | null; clt?: () => boolean; uv?: string | false; signal?: AbortSignal };
const out = (argv: string[]) => { try { const r = Bun.spawnSync(argv, { stdout: "pipe", stderr: "pipe", env: { PATH: `${dirname(argv[0])}:/usr/bin:/bin`, HOME: process.env.HOME ?? "/" } }); return r.exitCode === 0 ? r.stdout.toString().trim() : null; } catch { return null; } };
/** The folder a runtime's own files live in (its install prefix), which a round must be able to read. */
export const prefixOf = (bin: string) => { let r = bin; try { r = realpathSync(bin); } catch {} return dirname(dirname(r)); };

export function resolveNode(c: RuntimeCtx): Runtime | null {
  const node = onPath("node", c.path ?? process.env.PATH);
  if (node) { const v = out([node, "-v"]); const npm = onPath("npm", dirname(node)) ?? onPath("npm", c.path ?? process.env.PATH);
    if (v) return { name: "node", bin: node, version: v.replace(/^v/, ""), source: "host", npm, npmVersion: npm ? out([npm, "-v"]) : null, dir: prefixOf(node) }; }
  // Studio's own bun runs node scripts; it cannot run npm ci
  if (/^bun(-|$)/.test(basename(process.execPath))) return { name: "node", bin: process.execPath, version: `bun-${Bun.version}`, source: "studio", npm: null, npmVersion: null, dir: prefixOf(process.execPath) };
  return null;
}
const PY_CHECK = "import sys, venv, ensurepip; print('%d.%d.%d' % sys.version_info[:3])";
export function hostPython(c: RuntimeCtx): Runtime | null {
  for (const cand of ["python3"]) {
    const p = onPath(cand, c.path ?? process.env.PATH); if (!p) continue;
    if (p === "/usr/bin/python3" && !(c.clt ?? cltPresent)()) continue; // the stub asks to install Xcode's tools
    const v = out([p, "-I", "-c", PY_CHECK]); if (v) return { name: "python", bin: p, version: v, source: "host", dir: prefixOf(p) };
  }
  return null;
}
/** A python uv fetched earlier into data/runtimes/python. */
function uvPython(dataDir: string): Runtime | null {
  const root = join(dataDir, "runtimes", "python"); if (!existsSync(root)) return null;
  for (const d of readdirSync(root).filter((x) => /^cpython-/.test(x)).sort().reverse()) { const bin = join(root, d, "bin", "python3"); if (!existsSync(bin)) continue; const v = out([bin, "-I", "-c", PY_CHECK]); if (v) return { name: "python", bin, version: v, source: "uv", dir: join(root, d) }; }
  return null;
}
/** The python a skill uses: the host's, one fetched before, or a pinned standalone build fetched now by uv (its downloads are checksummed). */
export async function resolvePython(c: RuntimeCtx): Promise<{ rt: Runtime } | { missing: { en: string; zh: string } }> {
  const h = hostPython(c) ?? uvPython(c.dataDir); if (h) return { rt: h };
  const uv = c.uv === false ? null : c.uv ?? onPath("uv", c.path ?? process.env.PATH);
  if (!uv) return { missing: { en: "python3 missing: not on this Mac, and uv (which fetches a standalone Python into Studio's data) is not installed either", zh: "缺 python3：這台 Mac 沒有，也沒有 uv 可以把獨立版 Python 抓進 Studio 的資料夾" } };
  const dest = join(c.dataDir, "runtimes", "python"), work = join(c.dataDir, "runtimes", `.uv-${process.pid}-${Date.now()}`); mkdirSync(dest, { recursive: true }); mkdirSync(join(work, "tmp"), { recursive: true });
  try {
    const r = await roundExec([uv, "python", "install", "3.12", "--install-dir", dest, "--no-bin"], { cwd: work, writes: [dest, work], tmp: join(work, "tmp"), dataDir: c.dataDir, protect: c.protect, timeoutS: 900, egress: c.egress,
      hosts: ["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"], egressMeta: { purpose: "prepare", strict: true }, env: { UV_CACHE_DIR: join(work, "cache"), UV_NO_CONFIG: "1", UV_PYTHON_PREFERENCE: "only-managed" }, signal: c.signal });
    const got = uvPython(c.dataDir); if (got) return { rt: got };
    return { missing: { en: `python3 missing: uv could not fetch a standalone Python (exit ${r.code}${r.refused ? `, ${r.refused}` : ""}): ${r.stderr.trim().slice(-200)}`, zh: "缺 python3：uv 沒能抓到獨立版 Python" } };
  } finally { try { (await import("node:fs")).rmSync(work, { recursive: true, force: true }); } catch {} }
}
