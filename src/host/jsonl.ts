import { claudeCredentialFds } from "../providers/credential-fds";
// A child process speaking newline-delimited JSON on stdin/stdout.
export type JsonProc = {
  pid: number;
  write(o: unknown): void;
  kill(sig?: number): void;
  exited: Promise<number | null>;
  stderr(): string;
};

export function spawnJsonl(argv: string[], cwd: string, env: Record<string, string>, onLine: (o: any) => void): JsonProc {
  if (env.OPENAI_API_KEY || env.CODEX_API_KEY) throw new Error("Host JSONL requires file-based Codex login, never an API-key environment");
  const auth = claudeCredentialFds(env);
  let p: ReturnType<typeof Bun.spawn>;
  try { p = Bun.spawn(argv, { cwd, env: auth.env, stdio: ["pipe", "pipe", "pipe", ...auth.fds] }); }
  finally { auth.close(); }
  let err = "";
  (async () => {
    const reader = (p.stdout as ReadableStream<Uint8Array>).getReader();
    const dec = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const l = buf.slice(0, i); buf = buf.slice(i + 1);
          if (!l.trim()) continue;
          let o: any; try { o = JSON.parse(l); } catch { continue; }
          try { onLine(o); } catch {}
        }
      }
    } catch {}
  })();
  (async () => { try { const r = (p.stderr as ReadableStream<Uint8Array>).getReader(); const d = new TextDecoder(); for (;;) { const { value, done } = await r.read(); if (done) break; err = (err + d.decode(value)).slice(-4000); } } catch {} })();
  return {
    pid: p.pid,
    write(o) { try { (p.stdin as any).write(JSON.stringify(o) + "\n"); (p.stdin as any).flush?.(); } catch {} },
    kill(sig = 15) { try { process.kill(-p.pid, sig); } catch {} try { p.kill(sig); } catch {} },
    exited: p.exited.then((c) => c, () => null),
    stderr: () => err,
  };
}

export const isScript = (bin: string) => /\.(mjs|js|ts)$/.test(bin);
export const binArgv = (bin: string, args: string[]) => (isScript(bin) ? [process.execPath, bin, ...args] : [bin, ...args]);
/** A cursor-agent child's environment without what ties it to another cursor-agent or terminal session: Studio started inside a
 *  persistent session (CURSOR_AGENT_PERSIST_SESSION, tmux's TMUX*) would make cursor-agent ignore SIGINT and SIGTERM (its y1())
 *  and rebind chats in the user's /tmp/cursor-agent-persist-<uid>; started by a cursor-agent, its CURSOR_AGENT and CURSOR_AGENT_*
 *  (socket, chat, worker, store …), CURSOR_CONVERSATION_ID and CURSOR_REQUEST_ID belong to that agent's chat. Studio sets none of
 *  these; the variables it does set (CURSOR_API_KEY, CURSOR_DATA_DIR, AGENT_CLI_CREDENTIAL_STORE …) pass. */
export const cursorEnv = (env: Record<string, string>): Record<string, string> => Object.fromEntries(Object.entries(env).filter(([k]) => !/^(TMUX(_|$)|CURSOR_AGENT(_|$)|CURSOR_(CONVERSATION|REQUEST)_ID$)/.test(k)));
/** cursor-agent's prompt operand, placed after `--`: its option parser stops there, but cursor-agent also scans the raw argv for
 *  some flags (--statsig-overrides, --disable-project-configs), so the operand never starts with "-" either; and a lone word
 *  operand naming one of its subcommands (worker, update, logout, about …) runs that subcommand even after `--`, so a prompt
 *  with no whitespace in it never stands alone either. */
export const cursorPrompt = (text: string) => (/^-|^\S+$/.test(text) ? ` ${text}` : text);
