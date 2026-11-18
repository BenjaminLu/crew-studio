// Doctor's "Install the CLI" (docs/units/cli.md "Install"): puts `crew-studio` in ~/.local/bin, the one folder most shells
// already have on PATH, pointing at this Studio: the binary itself (a symlink), or, from a source checkout, a two-line shim
// that runs `bun <checkout>/src/main.ts`. It never overwrites a file it did not write, and says which line to add to the
// shell's profile when ~/.local/bin is not on PATH. Nothing here touches the shell profile itself.
import { chmodSync, lstatSync, mkdirSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const MARK = "# crew-studio CLI shim, written by Studio's Doctor";
export type CliInstallEnv = { home?: string; path?: string; shell?: string; compiled: boolean; execPath: string; srcRoot: string };
export type CliInstallState = { bin: string; dir: string; installed: boolean; current: boolean; ours: boolean; onPath: boolean; target: string; pathLine: string; profile: string };

const shimText = (e: CliInstallEnv) => `#!/bin/sh\n${MARK}\nexec ${JSON.stringify(e.execPath)} ${JSON.stringify(join(e.srcRoot, "src", "main.ts"))} "$@"\n`;
/** What is at ~/.local/bin/crew-studio now, and whether it runs this Studio. */
export function cliInstallState(e: CliInstallEnv): CliInstallState {
  const home = e.home ?? process.env.HOME ?? homedir(), dir = join(home, ".local", "bin"), bin = join(dir, "crew-studio");
  const target = e.compiled ? e.execPath : join(e.srcRoot, "src", "main.ts");
  let installed = false, current = false, ours = false;
  try { const st = lstatSync(bin); installed = true;
    if (st.isSymbolicLink()) { ours = true; current = e.compiled && readlinkSync(bin) === e.execPath; }
    else if (st.isFile()) { const t = readFileSync(bin, "utf8"); ours = t.includes(MARK); current = ours && !e.compiled && t === shimText(e); } } catch {}
  const onPath = (e.path ?? process.env.PATH ?? "").split(":").some((p) => p.replace(/\/$/, "") === dir || p === "$HOME/.local/bin");
  const sh = basename(e.shell ?? process.env.SHELL ?? "/bin/zsh"), profile = sh === "bash" ? "~/.bash_profile" : sh === "fish" ? "~/.config/fish/config.fish" : "~/.zprofile";
  const pathLine = sh === "fish" ? "fish_add_path ~/.local/bin" : 'export PATH="$HOME/.local/bin:$PATH"';
  return { bin, dir, installed, current, ours, onPath, target, pathLine, profile };
}
/** Install (or bring up to date) ~/.local/bin/crew-studio. Refuses a file there that Studio did not write. */
export function installCli(e: CliInstallEnv): CliInstallState {
  const s = cliInstallState(e);
  if (s.installed && !s.ours) throw new Error(`${s.bin} exists and is not Studio's: move it away, then install again`);
  mkdirSync(s.dir, { recursive: true });
  const tmp = `${s.bin}.tmp-${process.pid}`; rmSync(tmp, { force: true });
  if (e.compiled) symlinkSync(e.execPath, tmp); else { writeFileSync(tmp, shimText(e), { mode: 0o755 }); chmodSync(tmp, 0o755); }
  renameSync(tmp, s.bin);
  return cliInstallState(e);
}
/** Doctor's row for it. */
export function cliDoctorItem(s: CliInstallState) {
  const status = s.current && s.onPath ? "ok" : s.current ? "degraded" : "info";
  return { id: "crew-studio-cli", title: "crew-studio CLI", titleZh: "crew-studio CLI", status, group: "optional" as const,
    detail: s.current ? `${s.bin} runs this Studio${s.onPath ? "" : `; ${s.dir} is not on PATH`}` : s.installed ? (s.ours ? `${s.bin} points at another Studio` : `${s.bin} is not Studio's`) : "not installed",
    detailZh: s.current ? `${s.bin} 會執行這個 Studio${s.onPath ? "" : `；${s.dir} 不在 PATH 上`}` : s.installed ? (s.ours ? `${s.bin} 指向另一個 Studio` : `${s.bin} 不是 Studio 的`) : "還沒安裝",
    adds: "Lets an agent you run (Claude Code, Codex) read Studio through a grant: crew-studio now, get, help", addsZh: "讓你執行的 agent（Claude Code、Codex）透過授權讀取 Studio：crew-studio now、get、help",
    fix: s.current && !s.onPath ? `Add this line to ${s.profile}, then open a new terminal: ${s.pathLine}` : s.installed && !s.ours ? `Move ${s.bin} away, then install` : s.current ? "" : "Install the CLI",
    fixZh: s.current && !s.onPath ? `把這一行加進 ${s.profile}，再開新的 terminal：${s.pathLine}` : s.installed && !s.ours ? `先把 ${s.bin} 移開，再安裝` : s.current ? "" : "安裝 CLI",
    action: s.current ? { kind: "none" as const } : { kind: "cli-install" as const }, cli: s };
}
