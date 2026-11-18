// Doctor's "Install the CLI" (docs/units/cli.md "Install"): puts `crew-studio` in ~/.local/bin, the one folder most shells
// already have on PATH, pointing at this Studio:
//   - the app: a symlink to Studio's binary (its path stays the same across updates)
//   - a source checkout or a live release: a small shim. It finds bun when it runs (PATH, then the usual places, so a brew
//     upgrade does not break it), and it finds the Studio to run when it runs too: for a release under a releases folder
//     (scripts/live-release.ts), the release live.json names now, so a deploy or a prune never leaves it on old or missing
//     code. bun runs with --no-env-file --config=/dev/null: the folder the agent runs it in (an untrusted repository) can
//     neither preload code through its bunfig.toml nor set CREW_STUDIO_GRANT through its .env. When nothing can be found it
//     prints the CLI's exit-6 JSON asking for a reinstall from Doctor.
// It never overwrites a file or a link it did not write, and never edits a shell profile: when ~/.local/bin is not on PATH
// it says which line to add.
import { chmodSync, lstatSync, mkdirSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { BUN_ISOLATED } from "./self";

const MARK = "# crew-studio CLI shim, written by Studio's Doctor";
export type CliInstallEnv = { home?: string; path?: string; shell?: string; compiled: boolean; execPath: string; srcRoot: string };
export type CliInstallState = { bin: string; dir: string; installed: boolean; current: boolean; ours: boolean; onPath: boolean; target: string; pathLine: string; profile: string; foreign: string | null };

/** A value inside single quotes in sh: no $, backtick or backslash is expanded there. */
const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const exit6 = JSON.stringify({ ok: false, exit: 6, error: "the crew-studio CLI cannot find Studio or bun: install it again from Studio's Doctor (crew-studio CLI row)", meaning: "Studio is not answering: start it with `crew-studio launch`" });
export function shimText(e: CliInstallEnv): string {
  // only a release of scripts/live-release.ts (a folder named by its full commit under the releases folder) follows that
  // folder's live.json; a plain checkout runs itself, whatever its parent folder holds
  const releases = dirname(e.srcRoot), release = /^[0-9a-f]{40}$/.test(basename(e.srcRoot));
  return [
    "#!/bin/sh",
    MARK,
    `root=${sq(e.srcRoot)}`,
    ...(release ? [`live=${sq(join(releases, "live.json"))}`,
      `if [ -f "$live" ]; then sha=$(sed -n 's/.*"sha": *"\\([0-9a-f]\\{40\\}\\)".*/\\1/p' "$live" | head -n 1); if [ -n "$sha" ] && [ -f ${sq(releases)}/"$sha"/src/main.ts ]; then root=${sq(releases)}/"$sha"; fi; fi`] : []),
    // the bun Studio was installed with while it still runs, else the one on PATH, else the usual places
    `bun=`,
    `for b in ${sq(e.execPath)} "$(command -v bun 2>/dev/null)" "$HOME/.bun/bin/bun" /opt/homebrew/bin/bun /usr/local/bin/bun; do if [ -n "$b" ] && [ -x "$b" ]; then bun="$b"; break; fi; done`,
    `if [ -z "$bun" ] || [ ! -f "$root/src/main.ts" ]; then printf '%s\\n' ${sq(exit6)}; exit 6; fi`,
    `exec "$bun" ${BUN_ISOLATED.join(" ")} "$root/src/main.ts" "$@"`,
    "",
  ].join("\n");
}
/** What is at ~/.local/bin/crew-studio now, and whether it runs this Studio. */
export function cliInstallState(e: CliInstallEnv): CliInstallState {
  const home = e.home ?? process.env.HOME ?? homedir(), dir = join(home, ".local", "bin"), bin = join(dir, "crew-studio");
  const target = e.compiled ? e.execPath : join(e.srcRoot, "src", "main.ts");
  let installed = false, current = false, ours = false, foreign: string | null = null;
  try { const st = lstatSync(bin); installed = true;
    // a link is Studio's only when it points at this Studio's binary; a file only when Studio wrote it
    if (st.isSymbolicLink()) { const to = readlinkSync(bin); ours = to === e.execPath; current = ours && e.compiled; if (!ours) foreign = `a link to ${to}`; }
    else if (st.isFile()) { const t = readFileSync(bin, "utf8"); ours = t.includes(MARK); current = ours && !e.compiled && t === shimText(e); if (!ours) foreign = "a file Studio did not write"; }
    else foreign = "not a file"; } catch {}
  // PATH as Studio sees it (an app started by launchd may have a shorter one than your shell)
  const onPath = (e.path ?? process.env.PATH ?? "").split(":").some((p) => p.replace(/\/$/, "") === dir);
  const sh = basename(e.shell ?? process.env.SHELL ?? "/bin/zsh"), profile = sh === "bash" ? "~/.bash_profile" : sh === "fish" ? "~/.config/fish/config.fish" : "~/.zprofile";
  const pathLine = sh === "fish" ? "fish_add_path ~/.local/bin" : 'export PATH="$HOME/.local/bin:$PATH"';
  return { bin, dir, installed, current, ours, onPath, target, pathLine, profile, foreign };
}
/** Install (or bring up to date) ~/.local/bin/crew-studio. Refuses anything there that is not Studio's. */
export function installCli(e: CliInstallEnv): CliInstallState {
  const s = cliInstallState(e);
  if (s.installed && !s.ours) throw new Error(`${s.bin} is ${s.foreign}, not Studio's: move it away, then install again`);
  mkdirSync(s.dir, { recursive: true });
  const tmp = `${s.bin}.tmp-${process.pid}`; rmSync(tmp, { force: true });
  if (e.compiled) symlinkSync(e.execPath, tmp); else { writeFileSync(tmp, shimText(e), { mode: 0o755 }); chmodSync(tmp, 0o755); }
  renameSync(tmp, s.bin);
  return cliInstallState(e);
}
/** Doctor's row for it. */
export function cliDoctorItem(s: CliInstallState) {
  const status = s.current && s.onPath ? "ok" : s.current ? "degraded" : "info";
  const pathNote = " (as Studio sees PATH; a terminal's may differ)", pathNoteZh = "（這是 Studio 看到的 PATH；terminal 的可能不同）";
  return { id: "crew-studio-cli", title: "crew-studio CLI", titleZh: "crew-studio CLI", status, group: "optional" as const,
    detail: s.current ? `${s.bin} runs this Studio${s.onPath ? "" : `; ${s.dir} is not on PATH${pathNote}`}` : s.foreign ? `${s.bin} is ${s.foreign}, not Studio's` : s.installed ? `${s.bin} points at another Studio` : "not installed",
    detailZh: s.current ? `${s.bin} 會執行這個 Studio${s.onPath ? "" : `；${s.dir} 不在 PATH 上${pathNoteZh}`}` : s.foreign ? `${s.bin} 不是 Studio 的（${s.foreign}）` : s.installed ? `${s.bin} 指向另一個 Studio` : "還沒安裝",
    adds: "Lets an agent you run (Claude Code, Codex) read Studio through a grant: crew-studio now, get, help", addsZh: "讓你執行的 agent（Claude Code、Codex）透過授權讀取 Studio：crew-studio now、get、help",
    fix: s.current && !s.onPath ? `Add this line to ${s.profile}, then open a new terminal: ${s.pathLine}` : s.foreign ? `Move ${s.bin} away (it is not Studio's), then install` : s.current ? "" : "Install the CLI",
    fixZh: s.current && !s.onPath ? `把這一行加進 ${s.profile}，再開新的 terminal：${s.pathLine}` : s.foreign ? `先把 ${s.bin} 移開（它不是 Studio 的），再安裝` : s.current ? "" : "安裝 CLI",
    // no Install button when it could only fail (something else is there) or there is nothing to do
    action: s.current || s.foreign ? { kind: "none" as const } : { kind: "cli-install" as const }, cli: s };
}
