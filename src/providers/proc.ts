// A session that runs one CLI process per turn and maps its JSON lines to
// normalized events. Claude and Codex providers are both built on it.
// The process runs in its own process group: interrupting the turn (a timeout, a
// cancel, a hot swap) kills the whole group, so no child outlives its round. When
// the context carries a sandbox profile, the process runs under it (an agent round:
// architecture §10).
import { spawn } from "node:child_process";
import { LOGIN_RE, type NEvent, type Session } from "./types";

export type LineParser = { line(o: any): NEvent[]; exit(code: number, stderr: string): NEvent | null };

export function processSession(cmd: () => string[], cwd: string, env: Record<string, string>, makeParser: () => LineParser, sandbox?: { profile: string } | null): Session {
  let pid: number | null = null;
  let interrupted = false;
  let wake: (() => void) | null = null;
  const killGroup = () => { try { if (pid) process.kill(-pid, "SIGKILL"); } catch {} };
  return {
    interrupt() { interrupted = true; killGroup(); wake?.(); },
    async *send(text: string): AsyncIterable<NEvent> {
      const parser = makeParser();
      const queue: NEvent[] = [];
      let ended = false, stderr = "";
      const push = (e: NEvent) => { if (ended) return; if (e.type === "turnEnd") ended = true; queue.push(e); wake?.(); };
      const inner = cmd().map((a) => (a === "{TEXT}" ? text : a));
      const argv = sandbox ? ["/usr/bin/sandbox-exec", "-f", sandbox.profile, ...inner] : inner;
      let p: ReturnType<typeof spawn>;
      try { p = spawn(argv[0], argv.slice(1), { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] }); pid = p.pid ?? null; }
      catch (e: any) { yield { type: "turnEnd", status: "error", code: "cliUnavailable", message: `${inner[0]} could not start: ${e?.message ?? e}` }; return; }
      let buf = "";
      p.stdout!.on("data", (d: Buffer) => {
        buf += d.toString("utf8"); let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const l = buf.slice(0, i); buf = buf.slice(i + 1);
          if (!l.trim()) continue;
          let o: any; try { o = JSON.parse(l); } catch { continue; }
          for (const e of parser.line(o)) push(e);
        }
      });
      p.stderr!.on("data", (d: Buffer) => { if (stderr.length < 200_000) stderr += d.toString("utf8"); });
      let spawnError: string | null = null;
      p.on("error", (e) => { spawnError = String(e?.message ?? e); if (!pid) push({ type: "turnEnd", status: "error", code: "cliUnavailable", message: `${inner[0]} could not start: ${spawnError}` }); });
      p.on("exit", (code) => {
        setTimeout(() => {
          killGroup(); // a child the CLI left behind does not outlive the turn
          if (interrupted) return push({ type: "turnEnd", status: "interrupted" });
          if (spawnError) return push({ type: "turnEnd", status: "error", code: "cliUnavailable", message: `${inner[0]} could not start: ${spawnError}` });
          const last = parser.exit(code ?? -1, stderr);
          if (last) return push(last);
          const login = LOGIN_RE.test(stderr);
          push({ type: "turnEnd", status: "error", code: login ? "notLoggedIn" : "cliError",
            message: (stderr.trim().split("\n").slice(-3).join(" ") || `${inner[0]} exited ${code}`).slice(0, 400) });
        }, 30); // let stdout drain
      });
      for (;;) {
        while (queue.length) { const e = queue.shift()!; yield e; if (e.type === "turnEnd") return; }
        if (interrupted && !ended) { push({ type: "turnEnd", status: "interrupted" }); continue; }
        await new Promise<void>((r) => { wake = r; });
        wake = null;
      }
    },
  };
}
