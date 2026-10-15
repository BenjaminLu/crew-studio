// Claude Code as a host. Discovery reads ~/.claude/projects/<encoded cwd>/*.jsonl.
// Attaching runs ONE long-lived `claude -p --resume <id>` that reads each captain
// turn from stdin as stream-json, so the conversation, memory and context carry
// on. Tool permissions go to Studio through --permission-prompt-tool (a stdio
// MCP server that asks Studio over a private socket; any failure denies).
// Never --dangerously-skip-permissions, never a bypass mode.
//   CREW_HOST_CLAUDE_BIN       executable (default "claude"; a .mjs path runs under bun: test stub)
//   CREW_HOST_CLAUDE_PROJECTS  where session files live (default ~/.claude/projects)
import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { binArgv, spawnJsonl, type JsonProc } from "./jsonl";
import { cleanEnv, shortSummary, type AttachOpts, type AttachedSession, type Host, type HostEvent, type SessionInfo } from "./types";

export const encodeCwd = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, "-");
const SAFE_MODES = ["default", "acceptEdits", "plan", "auto", "manual", "dontAsk"];

function readEdges(file: string, head = 256 * 1024, tail = 128 * 1024): string[] {
  let fd = -1;
  try {
    fd = openSync(file, "r");
    const size = statSync(file).size;
    const out: string[] = [];
    const take = (start: number, len: number) => { const b = Buffer.alloc(len); const n = readSync(fd, b, 0, len, start); return b.subarray(0, n).toString("utf8"); };
    out.push(...take(0, Math.min(size, head)).split("\n"));
    if (size > head) out.push(...take(Math.max(head, size - tail), Math.min(tail, size - head)).split("\n").slice(1));
    return out;
  } catch { return []; } finally { if (fd >= 0) closeSync(fd); }
}

export function claudeHost(bin = process.env.CREW_HOST_CLAUDE_BIN ?? "claude", projects = process.env.CREW_HOST_CLAUDE_PROJECTS ?? join(homedir(), ".claude/projects")): Host {
  return {
    id: "claude",
    resumeCommand: (id) => `claude --resume ${id}`,
    async discover(projectDir) {
      const dir = join(projects, encodeCwd(projectDir));
      if (!existsSync(dir)) return [];
      const out: SessionInfo[] = [];
      for (const f of readdirSync(dir)) {
        if (!f.endsWith(".jsonl") || f.startsWith("agent-")) continue;
        const file = join(dir, f), id = f.slice(0, -6);
        let cwd = projectDir, title = "", sidechainOnly = true, mode = "", model = "";
        for (const l of readEdges(file)) {
          if (!l.trim()) continue;
          let o: any; try { o = JSON.parse(l); } catch { continue; }
          if (o.isSidechain === false || (o.type === "user" && !o.isSidechain)) sidechainOnly = false;
          if (typeof o.cwd === "string") cwd = o.cwd;
          if (o.type === "summary" && o.summary) title = String(o.summary);
          if (o.permissionMode && !o.isSidechain) mode = String(o.permissionMode);
          if (o.type === "assistant" && !o.isSidechain && typeof o.message?.model === "string" && !o.message.model.startsWith("<")) model = o.message.model;
          if (!title && o.type === "user" && !o.isSidechain) {
            const c = o.message?.content;
            const t = typeof c === "string" ? c : Array.isArray(c) ? c.find((x: any) => x.type === "text")?.text : "";
            if (t && !/^<(command|local-command|system)/.test(t)) title = String(t).replace(/\s+/g, " ").slice(0, 120);
          }
        }
        if (sidechainOnly) continue;
        out.push({ host: "claude", id, title: title || "(untitled)", cwd, updated: statSync(file).mtimeMs, possiblyOpen: false, openReason: null, file,
          model: model || null, permissionMode: mode || null });
      }
      return out.sort((a, b) => b.updated - a.updated);
    },
    async attach(requested, opts) {
      let id = requested;
      let proc: JsonProc | null = null;
      let busy = false, model = "claude";
      let turn: { resolve: (r: { status: "completed" | "interrupted" | "failed"; message?: string }) => void; external?: boolean } | null = null;
      let interrupting = false;
      // --fork-session only on the first start; once the CLI names the copy, later restarts resume the copy
      let forkPending = !!opts.fork;
      const emit = (e: HostEvent) => { try { opts.onEvent(e); } catch {} };
      const endTurn = (status: "completed" | "interrupted" | "failed", message?: string) => {
        if (!turn) return;
        const t = turn; turn = null; busy = false; interrupting = false;
        emit({ type: "turnEnd", status, message, external: t.external });
        t.resolve({ status, message });
      };
      // output with no turn of Studio's: the session's own hook woke it (asyncRewake); follow that turn too
      let notified = false; // a background task's notification came first: the CLI runs a turn for it
      const external = () => {
        if (turn || !proc) return;
        turn = { resolve: () => {}, external: true }; busy = true;
        emit({ type: "turnStart", source: notified ? "task" : "hook" }); notified = false;
      };
      const mcpName = "studio_permission";
      const spawn = () => {
        const args = ["-p", "--resume", id, "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages"];
        if (forkPending) args.push("--fork-session");
        if (opts.model && /^[\w.:\[\]-]{1,80}$/.test(opts.model)) args.push("--model", opts.model);
        if (opts.permissionMode && SAFE_MODES.includes(opts.permissionMode)) args.push("--permission-mode", opts.permissionMode);
        if (opts.permissionMcp) {
          const mcp = { mcpServers: { [mcpName]: { type: "stdio", command: opts.permissionMcp.command[0], args: opts.permissionMcp.command.slice(1), env: opts.permissionMcp.env } } };
          args.push("--permission-prompt-tool", `mcp__${mcpName}__approve`, "--mcp-config", JSON.stringify(mcp));
        } else {
          args.push("--permission-prompts", "none"); // nobody to ask: anything that would prompt is denied
        }
        const p = spawnJsonl(binArgv(bin, args), opts.cwd, { ...cleanEnv(), ...(opts.env ?? {}) }, (m) => {
          if (m.parent_tool_use_id) return; // subagent traffic stays inside the session
          if (m.type === "system" && m.subtype === "task_notification") notified = true;
          if (m.type === "system" && m.subtype === "init") {
            external();
            if (m.model) model = String(m.model);
            if (m.session_id && m.session_id !== id) { const old = id; id = String(m.session_id); forkPending = false; emit({ type: "forked", oldId: old, newId: id }); }
          } else if (m.type === "stream_event") {
            external();
            const ev = m.event;
            if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) emit({ type: "delta", text: ev.delta.text });
          } else if (m.type === "assistant") {
            external();
            for (const c of m.message?.content ?? []) {
              if (c.type === "tool_use") emit({ type: "toolStart", id: String(c.id), name: String(c.name), summary: shortSummary(c.input) });
              else if (c.type === "text" && c.text) emit({ type: "progress", text: String(c.text) });
            }
          } else if (m.type === "user") {
            for (const c of m.message?.content ?? []) if (c.type === "tool_result") emit({ type: "toolEnd", id: String(c.tool_use_id), ok: !c.is_error });
          } else if (m.type === "result") {
            const text = String(m.result ?? "");
            if (text) emit({ type: "message", text });
            const status = interrupting || m.subtype === "error_during_execution" && interrupting ? "interrupted" : m.is_error ? "failed" : "completed";
            endTurn(status, m.is_error ? text.slice(0, 400) : undefined);
          }
        });
        p.exited.then((code) => {
          if (proc === p) proc = null;
          emit({ type: "exit", code, stderr: p.stderr().slice(-600) });
          endTurn(interrupting ? "interrupted" : "failed", interrupting ? undefined : (p.stderr().trim().split("\n").slice(-2).join(" ") || `claude exited ${code}`));
        });
        return p;
      };
      const session: AttachedSession = {
        host: "claude",
        get id() { return id; },
        get model() { return model; },
        get busy() { return busy; },
        get pid() { return proc?.pid ?? null; },
        send(text) {
          if (busy) return Promise.reject(new Error("BUSY"));
          busy = true;
          if (!proc) proc = spawn();
          return new Promise((resolve) => {
            turn = { resolve };
            proc!.write({ type: "user", session_id: id, parent_tool_use_id: null, message: { role: "user", content: [{ type: "text", text }] } });
          });
        },
        async interrupt() {
          if (!proc || !busy) return;
          interrupting = true;
          const p = proc;
          p.write({ type: "control_request", request_id: `int-${Date.now()}`, request: { subtype: "interrupt" } });
          const done = await Promise.race([new Promise<boolean>((r) => { const t = setInterval(() => { if (!busy) { clearInterval(t); r(true); } }, 50); setTimeout(() => { clearInterval(t); r(false); }, 5000); })]);
          if (!done) { p.kill(15); setTimeout(() => p.kill(9), 1500); }
        },
        async detach() {
          if (proc) { const p = proc; proc = null; p.kill(15); await Promise.race([p.exited, Bun.sleep(3000)]); p.kill(9); }
          endTurn("interrupted");
          return `claude --resume ${id}`;
        },
      };
      // a takeover starts the CLI at once, so its hooks (firstmate's watch) are armed before the first message
      if (opts.fork) { proc = spawn(); }
      return session;
    },
  };
}
