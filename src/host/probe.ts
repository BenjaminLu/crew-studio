import { scrubEnv } from "../secure";
// Who else may be driving a session: running claude/codex processes, their
// working directories, and how recently a session file was written. Studio
// uses it twice: to mark sessions "possibly open" and to hold the driver lock.
import { readlinkSync, statSync } from "node:fs";

export type Proc = { pid: number; command: string; cwd: string | null };
export interface ProcProbe { list(): Proc[] }

/** Match the launched CLI, not a shell/read command which merely mentions its path. */
export function isVendorProcess(command:string):boolean {
  if (/^(?:\S*\/)?(?:claude|codex)(?:\s|$)/.test(command)) return true;
  const args = command.trim().split(/\s+/);
  if (!/^(?:\S*\/)?node$/.test(args.shift() ?? '')) return false;
  // Only skip known standalone flags; never mistake an eval payload for a CLI.
  while (/^(?:--enable-source-maps|--no-warnings|--disable-warning=[^\s]+)$/.test(args[0] ?? '')) args.shift();
  return /(?:^|\/)node_modules\/(?:@openai\/codex\/bin\/codex\.js|@anthropic-ai\/claude-code\/cli\.js)$/.test(args[0] ?? '');
}

const run = (argv: string[]): string => {
  try { const r = Bun.spawnSync(argv, { env: scrubEnv(), stdout: "pipe", stderr: "ignore" }); return r.success || r.exitCode === 1 ? r.stdout.toString() : ""; } catch { return ""; }
};

/** Real processes from `ps`, with cwd from `lsof` (macOS) or /proc (Linux). Studio's own children are excluded by the caller. */
export const systemProbe: ProcProbe = {
  list() {
    const procs: Proc[] = [];
    for (const line of run(["ps", "-axo", "pid=,command="]).split("\n")) {
      const m = /^\s*(\d+)\s+(.*)$/.exec(line);
      if (!m) continue;
      const command = m[2];
      if (!isVendorProcess(command)) continue;
      procs.push({ pid: Number(m[1]), command, cwd: null });
    }
    if (!procs.length) return procs;
    if (process.platform === "linux") {
      for (const p of procs) { try { p.cwd = readlinkSync(`/proc/${p.pid}/cwd`); } catch {} }
    } else {
      let pid = 0;
      for (const l of run(["lsof", "-a", "-d", "cwd", "-p", procs.map((p) => p.pid).join(","), "-Fpn"]).split("\n")) {
        if (l[0] === "p") pid = Number(l.slice(1));
        else if (l[0] === "n") { const p = procs.find((x) => x.pid === pid); if (p) p.cwd = l.slice(1); }
      }
    }
    return procs;
  },
};

export const RECENT_MS = 3 * 60_000;
export const mtimeOf = (file: string | null): number => { if (!file) return 0; try { return statSync(file).mtimeMs; } catch { return 0; } };

/** Is a terminal (any process but ours) driving this session? */
export function driving(probe: ProcProbe, s: { host: string; id: string; cwd: string; file: string | null; newestInDir: boolean }, own: Set<number>, now = Date.now()): string | null {
  const procs = probe.list().filter((p) => !own.has(p.pid) && p.pid !== process.pid);
  const tool = s.host === "codex" ? "codex" : "claude";
  const named = procs.find((p) => p.command.includes(s.id));
  if (named) return `${tool} process ${named.pid} names this session`;
  if (s.newestInDir) {
    const here = procs.find((p) => new RegExp(`(^|/)${tool}(\\s|$)`).test(p.command) && !/\s-p(\s|$)|\sexec\s|app-server/.test(p.command) && p.cwd === s.cwd);
    if (here) return `an interactive ${tool} (pid ${here.pid}) runs in ${s.cwd}`;
  }
  const m = mtimeOf(s.file);
  if (m && now - m < RECENT_MS) return `the session file was written ${Math.round((now - m) / 1000)}s ago`;
  return null;
}
