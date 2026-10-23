// Cursor as a host: a FRESH Firstmate primary in Studio's own workspace only. Studio never takes over a Cursor session
// from a terminal (discover finds none; attach refuses anything but fresh). cursor-agent -p runs one process per turn:
// the first turn uses a chat Studio made with `cursor-agent create-chat` (else the id the CLI reports in its init event),
// later turns `--resume <chatId>`, so the conversation carries on.
// It runs in a private root of its own (0700, swept with the Claude primary's folders): HOME, XDG_CONFIG_HOME, the
// workspace and CURSOR_DATA_DIR live there, so neither the captain's ~/.cursor nor a repository's .cursor/ is read.
// The workspace's .cursor/mcp.json registers only Studio's MCP helper (src/mcp.ts), which reaches this session's
// native tools over a private unix socket (random token in a 0600 file); cli-config.json allows exactly those tools
// and denies every built-in Shell, Read and Write, so Firstmate on Cursor works through Studio alone.
// cleanEnv drops every *_API_KEY: the caller hands the Cursor API key back explicitly in opts.env.CURSOR_API_KEY.
//   CREW_HOST_CURSOR_BIN  executable (default "cursor-agent"; a .mjs path runs under bun: test stub)
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { dropPrivateDir, nativeEndpoint, privateDir } from "./claude";
import { cursorInput } from "../attachments";
import { binArgv } from "./jsonl";
import { nativeToolError } from "./native-errors";
import { NativeToolFailure, cleanEnv, shortSummary, type AttachedSession, type Host, type HostEvent } from "./types";

const CHAT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/;
const MODEL = /^[\w.:\[\]=,-]{1,120}$/;
export const CURSOR_TAKEOVER_REFUSED = "Studio does not take over a Cursor session from a terminal; start Firstmate on Cursor in Studio instead";

/** The tool call's own name and arguments in a cursor-agent tool_call event (an MCP call names its tool; a built-in its kind). */
function callOf(tc: any): { name: string; args: unknown; result: any } {
  if (tc?.mcpToolCall) return { name: String(tc.mcpToolCall.args?.toolName ?? tc.mcpToolCall.args?.name ?? "mcp"), args: tc.mcpToolCall.args?.args ?? {}, result: tc.mcpToolCall.result };
  const key = Object.keys(tc ?? {})[0] ?? "tool";
  return { name: key.replace(/ToolCall$/, ""), args: tc?.[key]?.args ?? {}, result: tc?.[key]?.result };
}
const resultOf = (r: any): { ok: boolean; text?: string } => {
  if (r?.success) { const c = r.success.content; const text = Array.isArray(c) ? c.map((b: any) => typeof b?.text === "string" ? b.text : typeof b?.text?.text === "string" ? b.text.text : "").join("") : undefined; return { ok: !r.success.isError, text: text?.slice(0, 2000) }; }
  return { ok: false, text: String(r?.rejected?.reason ?? r?.permissionDenied?.error ?? r?.error?.errorMessage ?? "").slice(0, 2000) || undefined };
};

export function cursorHost(bin = process.env.CREW_HOST_CURSOR_BIN ?? "cursor-agent"): Host {
  return {
    id: "cursor",
    resumeCommand: (id) => `cursor-agent --resume ${id}`,
    async discover() { return []; },
    async attach(_requested, opts) {
      if (!opts.fresh) throw new Error(CURSOR_TAKEOVER_REFUSED);
      const key = opts.env?.CURSOR_API_KEY;
      if (!key) throw new Error("Firstmate on Cursor needs a Cursor API key (keychain item crew-studio-cursor-api-key or CURSOR_API_KEY)");
      const native = opts.nativeTools && opts.studioMcp ? opts.nativeTools : null;
      if (!native) throw new Error("Firstmate on Cursor runs only with Studio's native tools");
      const model = opts.model && MODEL.test(opts.model) ? opts.model : null;
      let chatId: string | null = null, shownModel = model ?? "cursor", turnSeq = 0, busy = false, interrupting = false;
      let proc: ChildProcess | null = null;
      let turn: { resolve: (r: { status: "completed" | "interrupted" | "failed"; message?: string }) => void } | null = null;
      const emit = (e: HostEvent) => { try { opts.onEvent(e); } catch {} };
      const priv = privateDir();
      for (const d of ["h/.config/cursor", "w/.cursor", "d"]) mkdirSync(join(priv, d), { recursive: true, mode: 0o700 });
      const ws = join(priv, "w");
      const endpoint = nativeEndpoint(priv, async (name, args) => {
        if (name === null) return native.specs.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
        const t = turn, seq = turnSeq, p = proc;
        const live = () => !!t && turn === t && turnSeq === seq && !interrupting && !!p && proc === p;
        try {
          if (!native.specs.some((x) => x.name === name)) throw new NativeToolFailure("unknown_tool", "This Studio tool does not exist. List the Studio tools before continuing.", "這個 Studio 工具不存在；請先列出 Studio 工具。", "read_current_state");
          if (!live()) throw new NativeToolFailure("owner_ended", "The request no longer owns this session. Read the current state before continuing.", "此請求已不再持有 session，請先讀取目前狀態。", "read_current_state");
          const result = await native.call(name, args, { thread: chatId ?? "", turn: String(seq), call: randomUUID(), live });
          if (!live()) throw new NativeToolFailure("owner_ended", "The request no longer owns this session. Read the current state before continuing.", "此請求已不再持有 session，請先讀取目前狀態。", "read_current_state");
          return result;
        } catch (error) {
          const failure = nativeToolError(error, name, native.onDiagnostic);
          emit({ type: "nativeToolFailure", failure });
          return { error: failure.reason.en, failure };
        }
      });
      const drop = () => { endpoint.close(); dropPrivateDir(priv); };
      try {
        writeFileSync(join(ws, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: { studio: { command: opts.studioMcp!.command[0], args: opts.studioMcp!.command.slice(1), env: { CREW_STUDIO_SOCKET: endpoint.socket, CREW_TOOL_TOKEN_FILE: endpoint.tokenFile } } } }), { mode: 0o600 });
        const permissions = { allow: native.specs.map((t) => `Mcp(studio:${t.name})`), deny: ["Shell(*)", "Read(**)", "Write(**)"] };
        writeFileSync(join(priv, "h", ".config", "cursor", "cli-config.json"), JSON.stringify({ version: 1, permissions }), { mode: 0o600 });
      } catch (e) { drop(); throw e; }
      const env: Record<string, string> = { ...cleanEnv(), ...(opts.env ?? {}), CURSOR_API_KEY: key, HOME: join(priv, "h"), XDG_CONFIG_HOME: join(priv, "h", ".config"), CURSOR_DATA_DIR: join(priv, "d"), AGENT_CLI_CREDENTIAL_STORE: "memory" };
      const run = (args: string[], onLine: (m: any) => void) => {
        const argv = binArgv(bin, args);
        const p = spawn(argv[0], argv.slice(1), { cwd: ws, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
        let buf = "", err = "";
        p.stdout!.on("data", (d: Buffer) => { buf += d.toString("utf8"); let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (!l.trim()) continue; let o: any; try { o = JSON.parse(l); } catch { o = { type: "_text", text: l }; } try { onLine(o); } catch {} } });
        p.stderr!.on("data", (d: Buffer) => { err = (err + d.toString("utf8")).slice(-4000); });
        const exited = new Promise<number | null>((r) => { p.once("exit", (c) => r(c)); p.once("error", () => r(null)); });
        return { p, exited, stderr: () => err };
      };
      const kill = (p: ChildProcess | null, sig: NodeJS.Signals = "SIGTERM") => { if (!p?.pid) return; try { process.kill(-p.pid, sig); } catch {} try { p.kill(sig); } catch {} };
      // the first turn's chat: `create-chat` prints its id; a CLI that cannot make one leaves the init event to name it
      try {
        const made = run(["create-chat"], (m) => { if (m.type === "_text" && CHAT_ID.test(m.text.trim())) chatId = m.text.trim(); });
        const code = await Promise.race([made.exited, Bun.sleep(20_000).then(() => "timeout" as const)]);
        if (code === "timeout") kill(made.p, "SIGKILL");
      } catch {}
      const endTurn = (status: "completed" | "interrupted" | "failed", message?: string) => {
        if (!turn) return;
        const t = turn; turn = null; busy = false; interrupting = false;
        emit({ type: "turnEnd", status, message });
        t.resolve({ status, message });
      };
      const session: AttachedSession = {
        host: "cursor",
        get id() { return chatId ?? "new-cursor-chat"; },
        get model() { return shownModel; },
        get busy() { return busy; },
        get pid() { return proc?.pid ?? null; },
        get path() { return "fresh" as const; },
        get file() { return null; },
        send(text, files = []) {
          if (busy) return Promise.reject(new Error("BUSY"));
          // attachments: images as --image (cursor-agent reads the file itself); a PDF only where its Read tool works (src/attachments.ts)
          let input: ReturnType<typeof cursorInput>;
          try { input = cursorInput(text, files, { cursorReads: false }); } catch (e) { return Promise.reject(e); }
          busy = true; turnSeq++;
          return new Promise((resolve) => {
            turn = { resolve };
            let reply = "", ended = false;
            const args = ["-p", "--output-format", "stream-json", "--trust", "--approve-mcps", "--sandbox", "disabled", "--workspace", ws, ...(model ? ["--model", model] : []), ...(chatId ? ["--resume", chatId] : []), ...input.args, input.text];
            let r: ReturnType<typeof run>;
            try {
              r = run(args, (m) => {
                if (m.type === "system" && m.subtype === "init") {
                  if (typeof m.model === "string" && m.model) shownModel = m.model;
                  if (typeof m.session_id === "string" && CHAT_ID.test(m.session_id)) {
                    if (chatId && m.session_id !== chatId) { const old = chatId; chatId = m.session_id; emit({ type: "forked", oldId: old, newId: chatId }); }
                    else chatId = m.session_id;
                  }
                } else if (m.type === "assistant") {
                  for (const c of m.message?.content ?? []) if (c?.type === "text" && c.text) { reply += c.text; emit({ type: "delta", text: String(c.text) }); }
                } else if (m.type === "tool_call") {
                  const c = callOf(m.tool_call);
                  if (m.subtype === "started") emit({ type: "toolStart", id: String(m.call_id), name: c.name, tool: c.name, summary: shortSummary(c.args), input: c.args });
                  else if (m.subtype === "completed") { const o = resultOf(c.result); emit({ type: "toolEnd", id: String(m.call_id), ok: o.ok, result: o.text }); }
                } else if (m.type === "result") {
                  ended = true;
                  const said = String(m.result ?? "");
                  if (m.is_error || m.subtype !== "success") { endTurn(interrupting ? "interrupted" : "failed", interrupting ? undefined : said.slice(0, 400) || "Cursor reported an error"); return; }
                  if (said || reply) emit({ type: "message", text: said || reply });
                  endTurn("completed");
                }
              });
            } catch (e: any) { busy = false; turn = null; resolve({ status: "failed", message: `cursor-agent could not start: ${e?.message ?? e}` }); return; }
            const p = r.p; proc = p;
            void r.exited.then((code) => {
              if (proc === p) proc = null;
              emit({ type: "exit", code, stderr: r.stderr().slice(-600) });
              if (!ended) endTurn(interrupting ? "interrupted" : "failed", interrupting ? undefined : (r.stderr().trim().split("\n").slice(-2).join(" ") || `cursor-agent exited ${code}`));
            });
          });
        },
        async interrupt() {
          if (!proc || !busy) return;
          interrupting = true;
          const p = proc; kill(p);
          await Promise.race([new Promise((r) => p.once("exit", r)), Bun.sleep(1500)]); kill(p, "SIGKILL");
        },
        async detach() {
          if (proc) { const p = proc; proc = null; kill(p); await Promise.race([new Promise((r) => p.once("exit", r)), Bun.sleep(3000)]); kill(p, "SIGKILL"); }
          drop();
          endTurn("interrupted");
          return CURSOR_TAKEOVER_REFUSED;
        },
      };
      return session;
    },
  };
}
