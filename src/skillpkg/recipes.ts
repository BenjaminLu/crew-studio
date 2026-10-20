// Where a skill's system programs come from (docs/units/skill-packages.md §4), resolved without asking anyone:
//   1. the host already has it (PATH, or an app bundle the recipe names);
//   2. Studio fetched it before: data/tools/<recipe>/<version>-<sha12>/ (complete only with its .complete marker);
//   3. a recipe's pinned download: fetched inside the prepare sandbox (network: that one host), its size capped and its
//      sha256 checked BEFORE anything is extracted, then unpacked into data/tools only (never /Applications);
//   4. a Homebrew formula, only through a Homebrew already installed at a prefix the user owns (never a cask, never sudo);
//   5. otherwise "not ready: <program> missing" with the reason, shown on the Crew page and in Firstmate's status.
// gcc, cc, clang and make come only from Xcode's command line tools: detected, never installed (Studio reports it).
// The recipes are data: one entry per program family, each source with its URL, sha256 and size cap.
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { roundExec } from "../runtime/checks";

export type ToolSource = { platform: string; arch: string; url: string; sha256: string; bytes: number; kind: "tar" | "dmg-app"; app?: string };
export type ToolRecipe = { id: string; version: string; bins: Record<string, string>; sources: ToolSource[]; host?: string[]; brew?: string; clt?: boolean; note?: string };
/** The recipes Studio ships. A source with no sha256 is never fetched: its recipe says so instead of trusting the download. */
export const RECIPES: ToolRecipe[] = [
  { id: "libreoffice", version: "25.8.2", bins: { soffice: "LibreOffice.app/Contents/MacOS/soffice" },
    host: ["/Applications/LibreOffice.app/Contents/MacOS/soffice", "~/Applications/LibreOffice.app/Contents/MacOS/soffice"],
    // the official disk image, from the archive host (no mirror redirect): the app is copied out of it into data/tools
    sources: [
      { platform: "darwin", arch: "arm64", kind: "dmg-app", app: "LibreOffice.app", bytes: 450 * 1024 * 1024, sha256: "",
        url: "https://downloadarchive.documentfoundation.org/libreoffice/old/25.8.2.2/mac/aarch64/LibreOffice_25.8.2.2_MacOS_aarch64.dmg" },
      { platform: "darwin", arch: "x64", kind: "dmg-app", app: "LibreOffice.app", bytes: 450 * 1024 * 1024, sha256: "",
        url: "https://downloadarchive.documentfoundation.org/libreoffice/old/25.8.2.2/mac/x86_64/LibreOffice_25.8.2.2_MacOS_x86-64.dmg" }],
    note: "the sha256 of the official image is pinned when the recipe is reviewed; until then Studio does not fetch it" },
  { id: "poppler", version: "brew", bins: { pdftoppm: "bin/pdftoppm", pdftocairo: "bin/pdftocairo", pdfinfo: "bin/pdfinfo", pdftotext: "bin/pdftotext" }, sources: [], brew: "poppler",
    note: "Poppler publishes no portable macOS build: Homebrew's formula, when Homebrew is installed at a prefix you own" },
  { id: "xcode-clt", version: "system", bins: { gcc: "", cc: "", clang: "", make: "" }, sources: [], clt: true, note: "Xcode's command line tools (xcode-select --install); Studio never installs them" },
];
export const recipeFor = (bin: string, list: ToolRecipe[] = RECIPES) => list.find((r) => Object.hasOwn(r.bins, bin)) ?? null;

export type BinState = { name: string; state: "host" | "tool" | "brew" | "missing"; path?: string; recipe?: string; reason?: { en: string; zh: string } };
const sha256File = (f: string) => new Promise<string>((res, rej) => { const h = createHash("sha256"); createReadStream(f).on("data", (d) => h.update(d)).on("end", () => res(h.digest("hex"))).on("error", rej); });
/** A program on PATH (the first executable regular file of that name). */
export function onPath(name: string, path = process.env.PATH ?? ""): string | null {
  for (const d of path.split(delimiter)) { if (!d) continue; const f = join(d, name); try { const st = statSync(f); if (st.isFile() && st.mode & 0o111) return f; } catch {} }
  return null;
}
/** Xcode's command line tools are present (xcode-select -p names a folder); without them /usr/bin/gcc is only an installer stub. */
export function cltPresent(): boolean { try { const r = Bun.spawnSync(["/usr/bin/xcode-select", "-p"], { stdout: "pipe", stderr: "ignore", env: { PATH: "/usr/bin:/bin" } }); return r.exitCode === 0 && existsSync(r.stdout.toString().trim()); } catch { return false; } }

export type ToolsCtx = { dataDir: string; protect?: string[]; egress?: { port: number; open(t: string, h: string[], meta?: any): void; close(t: string): void } | null;
  /** PATH to look on (Studio's own) */ path?: string; platform?: string; arch?: string; recipes?: ToolRecipe[];
  /** the Homebrew to use: false never (tests, the manual smoke), a path, or undefined to look for one the user owns */ brew?: false | string; clt?: () => boolean; signal?: AbortSignal };
/** The install folder of a recipe source in data/tools. */
const toolDir = (c: ToolsCtx, r: ToolRecipe, s: ToolSource) => join(c.dataDir, "tools", r.id, `${r.version}-${s.sha256.slice(0, 12)}`);

/** Find one program without changing anything: host, an earlier fetch, Xcode's tools. Null: it must be fetched or is missing. */
export function findBin(name: string, c: ToolsCtx): BinState | null {
  const r = recipeFor(name, c.recipes);
  if (r?.clt) { const p = onPath(name, "/usr/bin"); return (c.clt ?? cltPresent)() && p ? { name, state: "host", path: p, recipe: r.id } : { name, state: "missing", recipe: r.id, reason: { en: `${name} missing: Xcode's command line tools are not installed (run xcode-select --install); Studio does not install them`, zh: `缺 ${name}：沒有安裝 Xcode 命令列工具（執行 xcode-select --install）；Studio 不會自己裝` } }; }
  const host = onPath(name, c.path ?? process.env.PATH); if (host) return { name, state: "host", path: host };
  for (const h of r?.host ?? []) { const f = h.replace(/^~/, homedir()); if (existsSync(f)) return { name, state: "host", path: f, recipe: r!.id }; }
  if (r) for (const s of r.sources) { const d = toolDir(c, r, s); if (s.sha256 && existsSync(join(d, ".complete")) && existsSync(join(d, r.bins[name]))) return { name, state: "tool", path: join(d, r.bins[name]), recipe: r.id }; }
  if (r?.brew) { const b = brewOf(c); if (b) { const p = join(dirname(dirname(b)), r.bins[name]); if (existsSync(p)) return { name, state: "brew", path: p, recipe: r.id }; } }
  return null;
}
/** A Homebrew Studio may use: already installed, at a prefix the current user owns (so it never needs sudo). */
export function brewOf(c: Pick<ToolsCtx, "brew">): string | null {
  if (c.brew === false) return null;
  for (const b of c.brew ? [c.brew] : ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"]) { try { const prefix = dirname(dirname(b)); if (statSync(b).isFile() && statSync(prefix).uid === process.getuid?.()) return b; } catch {} }
  return null;
}
/** The one command a formula install runs: never a cask, never sudo, no auto-update, no analytics. */
export function brewPlan(brew: string, formula: string): { argv: string[]; env: Record<string, string> } {
  if (!/^[a-z0-9][a-z0-9@._+-]{0,60}$/.test(formula)) throw new Error(`not a formula name: ${formula}`);
  return { argv: [brew, "install", "--formula", formula], env: { PATH: `${dirname(brew)}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: homedir(), HOMEBREW_NO_AUTO_UPDATE: "1", HOMEBREW_NO_ANALYTICS: "1", HOMEBREW_NO_INSTALL_CLEANUP: "1", HOMEBREW_NO_ENV_HINTS: "1", HOMEBREW_NO_INSTALL_FROM_API: "", NONINTERACTIVE: "1" } };
}

/** Resolve one program, fetching it when a recipe can: the state, and the hosts the fetch needed (for the record). */
export async function resolveBin(name: string, c: ToolsCtx): Promise<BinState & { hosts?: string[] }> {
  const found = findBin(name, c); if (found) return found;
  const r = recipeFor(name, c.recipes);
  if (!r) return { name, state: "missing", reason: { en: `${name} missing: not on this Mac and Studio has no recipe for it`, zh: `缺 ${name}：這台 Mac 上沒有，Studio 也沒有它的取得方式` } };
  const platform = c.platform ?? process.platform, arch = c.arch ?? process.arch;
  const src = r.sources.find((s) => s.platform === platform && s.arch === arch);
  if (src && !/^[a-f0-9]{64}$/.test(src.sha256)) {
    if (!r.brew) return { name, state: "missing", recipe: r.id, reason: { en: `${name} missing: Studio's ${r.id} recipe has no pinned checksum yet, so it does not download it (install ${r.id} yourself, or pin the recipe)`, zh: `缺 ${name}：Studio 的 ${r.id} 取得方式還沒有釘住校驗碼，所以不下載（請自行安裝 ${r.id}，或先釘住校驗碼）` } };
  } else if (src) {
    try { await fetchTool(r, src, c); const again = findBin(name, c); if (again) return { ...again, hosts: [new URL(src.url).hostname] }; }
    catch (e: any) { return { name, state: "missing", recipe: r.id, reason: { en: `${name} missing: ${e?.message ?? e}`, zh: `缺 ${name}：${e?.zh ?? e?.message ?? e}` } }; }
  }
  if (r.brew) {
    const b = brewOf(c);
    if (!b) return { name, state: "missing", recipe: r.id, reason: { en: `${name} missing: ${r.note ?? ""}; no Homebrew at a prefix you own was found`, zh: `缺 ${name}：需要 Homebrew 的 ${r.brew}，但沒有找到你自己擁有的 Homebrew` } };
    const plan = brewPlan(b, r.brew);
    const p = Bun.spawn(plan.argv, { env: plan.env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => p.kill(), 1_800_000); const code = await p.exited; clearTimeout(timer);
    const again = findBin(name, c); if (code === 0 && again) return again;
    return { name, state: "missing", recipe: r.id, reason: { en: `${name} missing: brew install ${r.brew} exited ${code}`, zh: `缺 ${name}：brew install ${r.brew} 失敗（${code}）` } };
  }
  return { name, state: "missing", recipe: r.id, reason: { en: `${name} missing: ${r.note ?? `no ${platform}/${arch} source in the ${r.id} recipe`}`, zh: `缺 ${name}：${r.id} 沒有這台機器（${platform}/${arch}）可用的來源` } };
}

/** Fetch one recipe source: download in the prepare sandbox (that host only), check size and sha256, then unpack into data/tools. */
export async function fetchTool(r: ToolRecipe, s: ToolSource, c: ToolsCtx): Promise<string> {
  const dest = toolDir(c, r, s); if (existsSync(join(dest, ".complete"))) return dest;
  const host = new URL(s.url).hostname;
  const work = join(c.dataDir, "tools", ".fetch", `${r.id}-${process.pid}-${Date.now()}`); mkdirSync(join(work, "tmp"), { recursive: true });
  const file = join(work, "download");
  try {
    const dl = await roundExec(["/usr/bin/curl", "-fsSL", "--proto", "=https,http", "--max-redirs", "0", "--max-filesize", String(s.bytes), "-o", file, s.url],
      { cwd: work, writes: [work], tmp: join(work, "tmp"), dataDir: c.dataDir, protect: c.protect, timeoutS: 1800, egress: c.egress, hosts: [host], egressMeta: { purpose: "prepare", strict: true }, signal: c.signal });
    if (dl.refused) throw new Error(`the download could not run in the sandbox (${dl.refused})`);
    if (dl.code !== 0) throw new Error(`the download from ${host} failed (curl exit ${dl.code}${dl.timedOut ? ", timed out" : ""}): ${dl.stderr.trim().slice(-200)}`);
    const size = statSync(file).size; if (size > s.bytes) throw new Error(`the download is ${size} bytes, over the recipe's cap of ${s.bytes}`);
    const got = await sha256File(file);
    if (got !== s.sha256) throw Object.assign(new Error(`the download's sha256 is ${got.slice(0, 16)}…, not the recipe's ${s.sha256.slice(0, 16)}…: refused, nothing installed`), { zh: `下載檔的 sha256 跟取得方式釘住的不一樣：拒絕，什麼都沒裝` });
    const stage = join(work, "stage"); mkdirSync(stage, { recursive: true });
    if (s.kind === "tar") {
      const x = await roundExec(["/usr/bin/tar", "-xf", file, "-C", stage], { cwd: work, writes: [stage], tmp: join(work, "tmp"), dataDir: c.dataDir, protect: c.protect, timeoutS: 600 });
      if (x.code !== 0) throw new Error(`unpacking failed: ${x.stderr.trim().slice(-200)}`);
    } else {
      // a disk image is attached read-only, outside the sandbox (hdiutil needs the disk service), never opened in Finder; the app is copied out, then detached
      const mnt = join(work, "mnt"); mkdirSync(mnt);
      const a = Bun.spawnSync(["/usr/bin/hdiutil", "attach", "-nobrowse", "-readonly", "-noautoopen", "-mountpoint", mnt, file], { stdout: "pipe", stderr: "pipe", env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" } });
      if (a.exitCode !== 0) throw new Error(`the disk image could not be attached: ${a.stderr.toString().trim().slice(-200)}`);
      try { const cp = Bun.spawnSync(["/usr/bin/ditto", join(mnt, s.app ?? ""), join(stage, s.app ?? "")], { stdout: "ignore", stderr: "pipe" }); if (cp.exitCode !== 0) throw new Error(`copying ${s.app} failed: ${cp.stderr.toString().trim().slice(-200)}`); }
      finally { Bun.spawnSync(["/usr/bin/hdiutil", "detach", "-force", mnt], { stdout: "ignore", stderr: "ignore" }); }
    }
    for (const [bin, rel] of Object.entries(r.bins)) if (rel && !existsSync(join(stage, rel))) throw new Error(`the ${r.id} download has no ${rel} (for ${bin})`);
    writeFileSync(join(stage, ".complete"), JSON.stringify({ recipe: r.id, version: r.version, url: s.url, sha256: s.sha256, at: new Date().toISOString() }));
    mkdirSync(dirname(dest), { recursive: true }); rmSync(dest, { recursive: true, force: true }); renameSync(stage, dest);
    return dest;
  } finally { rmSync(work, { recursive: true, force: true }); }
}
/** The fetched tool folders (data/tools/<recipe>/<version>), for the round's read-only list. */
export function toolDirs(dataDir: string): string[] {
  const root = join(dataDir, "tools"); if (!existsSync(root)) return [];
  return readdirSync(root).filter((r) => !r.startsWith(".")).flatMap((r) => { try { return readdirSync(join(root, r)).filter((v) => existsSync(join(root, r, v, ".complete"))).map((v) => join(root, r, v)); } catch { return []; } });
}
