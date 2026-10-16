// Claude Code as a host. Discovery reads ~/.claude/projects/<encoded cwd>/*.jsonl.
// Attaching runs ONE long-lived `claude -p --resume <id>` that reads each captain
// turn from stdin as stream-json, so the conversation, memory and context carry
// on. Tool permissions go to Studio through --permission-prompt-tool (a stdio
// MCP server that asks Studio over a private socket; any failure denies).
// Never --dangerously-skip-permissions, never a bypass mode.
// A FRESH primary (opts.fresh) is a new session: Studio picks its UUID (--session-id),
// runs it in the config identity the caller passes (CLAUDE_CONFIG_DIR + the crew token
// in opts.env), and hands it Studio's native tools through Studio's own MCP helper
// (src/mcp.ts) over owned stdio. That helper reaches back to this session over a
// private unix socket (0700 dir, random token); only the native tool names are
// pre-allowed. In the default (manual) mode every other tool asks the permission bridge;
// in auto mode Claude's classifier approves or denies the rest, and only what it escalates
// (ask rules, paths outside the workspace, repeated blocks) reaches the bridge. Deny rules
// (opts.denyEdits) hold in every mode.
//   CREW_HOST_CLAUDE_BIN       executable (default "claude"; a .mjs path runs under bun: test stub)
//   CREW_HOST_CLAUDE_PROJECTS  where session files live (default ~/.claude/projects)
import { chmodSync, closeSync, existsSync, mkdtempSync, openSync, readSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { binArgv, spawnJsonl, type JsonProc } from "./jsonl";
import { claudeContent, readAttachment } from "../attachments";
import { nativeToolError } from "./native-errors";
import { NativeToolFailure, cleanEnv, shortSummary, type AttachOpts, type AttachedSession, type Host, type HostEvent, type HostRefusalCode, type SessionInfo } from "./types";

const QUOTA = /rate.?limit|usage.?limit|quota|insufficient_quota|credit balance|spend.?limit|billing|payment/i;
const AUTH = /not logged in|please run \/login|authentication|invalid.*(?:token|key)|unauthori[sz]ed|oauth token|credential/i;
/** A typed vendor refusal in claude's stream-json, or null: quota and sign-in are never retried on another host. */
export function claudeRefusal(m: any): { code: HostRefusalCode; reason: { en: string; "zh-TW": string } } | null {
  const status = m?.api_error_status ?? m?.error?.status;
  const text = [m?.error?.type, m?.error?.message, m?.error, m?.result, ...(Array.isArray(m?.errors) ? m.errors : [])].filter((x) => typeof x === "string").join(" ");
  const errorContext = !!m?.error || m?.is_error === true || (m?.type === "result" && m.subtype !== "success");
  if ((m?.type === "rate_limit_event" && m.rate_limit_info?.status === "rejected") || status === 429 || status === 402 || (errorContext && QUOTA.test(text)))
    return { code: "claudeQuotaExhausted", reason: { en: "Claude quota is exhausted. Wait for the reset; signing in again will not help. Studio does not switch to Codex.", "zh-TW": "Claude 額度已耗盡；請等待重設，重新登入沒有幫助。Studio 不會改用 Codex。" } };
  if (status === 401 || status === 403 || (errorContext && AUTH.test(text)))
    return { code: "claudeNotSignedIn", reason: { en: "Claude refused the sign-in for this Firstmate. Sign in to Claude again, then start a new Firstmate. Studio does not switch to Codex.", "zh-TW": "Claude 拒絕了這個 Firstmate 的登入；請重新登入 Claude，再開新的 Firstmate。Studio 不會改用 Codex。" } };
  return null;
}

/** One session's private folder: 0700, named with Studio's pid so a later Studio can sweep it once that pid is gone.
 *  It holds the MCP config file and the token files, so no token or socket path ever appears on a command line. */
export const PRIVATE_PREFIX = "crew-native-";
const liveDirs = new Set<string>();
let exitHook = false;
/** Every private folder goes when Studio exits, whatever the session (fresh, takeover or attach) and however it ends. */
function privateDir() {
  const dir = mkdtempSync(join(tmpdir(), `${PRIVATE_PREFIX}${process.pid}-`)); chmodSync(dir, 0o700); liveDirs.add(dir);
  if (!exitHook) { exitHook = true; process.once("exit", () => { for (const d of liveDirs) try { rmSync(d, { recursive: true, force: true }); } catch {} }); }
  return dir;
}
const secretFile = (dir: string, name: string, text: string) => { const f = join(dir, name); writeFileSync(f, text, { mode: 0o600 }); chmodSync(f, 0o600); return f; };
/** Remove private folders a Studio that is no longer running left behind (its pid is gone). */
export function sweepPrivateDirs(root = tmpdir()) {
  let n = 0;
  for (const name of (() => { try { return readdirSync(root); } catch { return [] as string[]; } })()) {
    const m = new RegExp(`^${PRIVATE_PREFIX}(\\d+)-`).exec(name); if (!m) continue;
    const pid = Number(m[1]); if (pid === process.pid) continue;
    let alive = true; try { process.kill(pid, 0); } catch (e: any) { alive = e?.code === "EPERM"; }
    if (!alive) { try { rmSync(join(root, name), { recursive: true, force: true }); n++; } catch {} }
  }
  return n;
}

/** The private endpoint the studio MCP helper calls for one session's native tools: a 0600 unix socket in the private folder, a random token in a 0600 file. */
function nativeEndpoint(dir: string, handle: (name: string | null, args: unknown) => Promise<unknown>) {
  const socket = join(dir, "tools.sock"), token = randomBytes(32).toString("hex"), tok = Buffer.from(token);
  const tokenFile = secretFile(dir, "tool.token", token);
  const reply = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
  const server = Bun.serve({ unix: socket, fetch: async (req) => {
    const given = Buffer.from(req.headers.get("x-crew-tool-token") ?? "");
    if (given.length !== tok.length || !timingSafeEqual(given, tok)) return reply({ error: "no valid tool token" }, 403);
    const path = new URL(req.url).pathname;
    if (path === "/api/tools" && req.method === "GET") return reply(await handle(null, null));
    if (path.startsWith("/api/tools/") && req.method === "POST") { let a: unknown = {}; try { a = await req.json(); } catch {} return reply(await handle(decodeURIComponent(path.slice("/api/tools/".length)), a)); }
    return reply({ error: "unknown" }, 404);
  } });
  try { chmodSync(socket, 0o600); } catch {}
  return { socket, tokenFile, close() { try { server.stop(true); } catch {} } };
}

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
      const fresh = !!opts.fresh;
      // a fresh primary: a real new session, its UUID chosen here and checked against the CLI's init
      let id = fresh ? randomUUID() : requested;
      let named = !fresh; // false until the CLI has created the fresh session; until then a respawn starts it again by --session-id
      let turnSeq = 0;
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
        turn = { resolve: () => {}, external: true }; busy = true; turnSeq++; refused = null;
        emit({ type: "turnStart", source: notified ? "task" : "hook" }); notified = false;
      };
      const mcpName = "studio_permission", studioName = "studio";
      let refused: { code: HostRefusalCode; reason: { en: string; "zh-TW": string } } | null = null;
      // native tools: only a fresh primary with Studio's MCP helper; calls run inside the turn that asked
      const native = fresh && opts.nativeTools && opts.studioMcp ? opts.nativeTools : null;
      const priv = privateDir();
      const dropPrivate = () => { endpoint?.close(); try { rmSync(priv, { recursive: true, force: true }); } catch {} liveDirs.delete(priv); };
      const endpoint = native ? nativeEndpoint(priv, async (name, args) => {
        if (name === null) return native.specs.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
        const t = turn, seq = turnSeq, p = proc;
        const live = () => !!t && turn === t && turnSeq === seq && !interrupting && !!p && proc === p;
        try {
          if (!native.specs.some((x) => x.name === name)) throw new NativeToolFailure("unknown_tool", "This Studio tool does not exist. List the Studio tools before continuing.", "這個 Studio 工具不存在；請先列出 Studio 工具。", "read_current_state");
          if (!live()) throw new NativeToolFailure("owner_ended", "The request no longer owns this session. Read the current state before continuing.", "此請求已不再持有 session，請先讀取目前狀態。", "read_current_state");
          const result = await native.call(name, args, { thread: id, turn: String(seq), call: randomUUID(), live });
          if (!live()) throw new NativeToolFailure("owner_ended", "The request no longer owns this session. Read the current state before continuing.", "此請求已不再持有 session，請先讀取目前狀態。", "read_current_state");
          return result;
        } catch (error) {
          const failure = nativeToolError(error, name, native.onDiagnostic);
          emit({ type: "nativeToolFailure", failure });
          return { error: failure.reason.en, failure };
        }
      }) : null;
      const spawn = () => {
        const args = ["-p", ...(named ? ["--resume", id] : ["--session-id", id]), "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages"];
        if (forkPending) args.push("--fork-session");
        if (opts.model && /^[\w.:\[\]-]{1,80}$/.test(opts.model)) args.push("--model", opts.model);
        if (opts.permissionMode && SAFE_MODES.includes(opts.permissionMode)) args.push("--permission-mode", opts.permissionMode);
        else if (fresh) args.push("--permission-mode", "default");
        const servers: Record<string, unknown> = {};
        if (opts.permissionMcp) {
          // the bridge token goes in a 0600 file; the helper reads it by path (CREW_PERM_TOKEN_FILE)
          const { CREW_PERM_TOKEN, ...rest } = opts.permissionMcp.env;
          servers[mcpName] = { type: "stdio", command: opts.permissionMcp.command[0], args: opts.permissionMcp.command.slice(1), env: { ...rest, ...(CREW_PERM_TOKEN ? { CREW_PERM_TOKEN_FILE: secretFile(priv, "perm.token", CREW_PERM_TOKEN) } : {}) } };
        }
        if (endpoint && opts.studioMcp) servers[studioName] = { type: "stdio", command: opts.studioMcp.command[0], args: opts.studioMcp.command.slice(1), env: { CREW_STUDIO_SOCKET: endpoint.socket, CREW_TOOL_TOKEN_FILE: endpoint.tokenFile } };
        if (opts.permissionMcp) args.push("--permission-prompt-tool", `mcp__${mcpName}__approve`);
        else args.push("--permission-prompts", "none"); // nobody to ask: anything that would prompt is denied
        // the config lives in the private folder: argv names a file, never a token or the socket
        if (Object.keys(servers).length) args.push("--mcp-config", secretFile(priv, "mcp.json", JSON.stringify({ mcpServers: servers })));
        if (fresh) args.push("--strict-mcp-config"); // Studio's servers only, never ones from a config the primary did not choose
        // user scope is Studio's own config folder (CLAUDE_CONFIG_DIR): the workspace's .claude/settings*.json and hooks never load
        if (fresh) args.push("--setting-sources", "user");
        // Studio's own native tools carry their own captain authority (cards, staffing, ledger): pre-allowed by exact name only
        if (native) args.push("--allowedTools", native.specs.map((t) => `mcp__${studioName}__${t.name}`).join(","));
        // edit-tool deny rules hold even in auto mode: Edit(//abs/path) covers every built-in file-editing tool and shell redirects
        if (fresh && opts.denyEdits?.length) args.push("--disallowedTools", opts.denyEdits.filter((x) => x.startsWith("/") && !x.includes(",")).map((x) => `Edit(/${x})`).join(","));
        const p = spawnJsonl(binArgv(bin, args), opts.cwd, { ...cleanEnv(), ...(opts.env ?? {}) }, (m) => {
          if (m.parent_tool_use_id) return; // subagent traffic stays inside the session
          if (m.type === "system" && m.subtype === "task_notification") notified = true;
          if (m.type === "system" && m.subtype === "compact_boundary") emit({ type: "compacted" });
          const r = claudeRefusal(m);
          if (r && !refused) { refused = r; emit({ type: "hostRefusal", code: r.code, reason: r.reason, raw: m }); }
          if (m.type === "system" && m.subtype === "init") {
            external();
            if (m.model) model = String(m.model);
            if (m.permissionMode) emit({ type: "permissionMode", mode: String(m.permissionMode) });
            if (!named && m.session_id === id) named = true;
            if (m.session_id && m.session_id !== id && fresh && !named) { emit({ type: "exit", code: null, stderr: "claude did not start the requested new session id" }); endTurn("failed", "Claude did not start the requested new session id"); p.kill(15); return; }
            if (m.session_id && m.session_id !== id) { const old = id; id = String(m.session_id); forkPending = false; emit({ type: "forked", oldId: old, newId: id }); }
          } else if (m.type === "system" && m.subtype === "status" && m.permissionMode) {
            emit({ type: "permissionMode", mode: String(m.permissionMode) }); // the mode changed during the session
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
            const status = interrupting || m.subtype === "error_during_execution" && interrupting ? "interrupted" : m.is_error || refused ? "failed" : "completed";
            endTurn(status, refused ? `${refused.reason.en} / ${refused.reason["zh-TW"]}` : m.is_error ? text.slice(0, 400) : undefined);
          }
        });
        p.exited.then((code) => {
          const mine = proc === p; // false after detach(): Studio stopped it on purpose, which detach reports itself
          if (mine) proc = null;
          emit({ type: "exit", code, stderr: p.stderr().slice(-600) });
          if (mine) endTurn(interrupting ? "interrupted" : "failed", interrupting ? undefined : (p.stderr().trim().split("\n").slice(-2).join(" ") || `claude exited ${code}`));
        });
        return p;
      };
      const session: AttachedSession = {
        host: "claude",
        get id() { return id; },
        get model() { return model; },
        get busy() { return busy; },
        get pid() { return proc?.pid ?? null; },
        get path() { return fresh ? "fresh" as const : opts.fork ? "fork" as const : "resume" as const; },
        get file() { return fresh ? join(opts.env?.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"), "projects", encodeCwd(opts.cwd), `${id}.jsonl`) : null; },
        send(text, files = []) {
          if (busy) return Promise.reject(new Error("BUSY"));
          // attachments: image and document (PDF) blocks, base64, in the same user message; a refusal fails the turn before anything is sent
          let content: any[];
          try { content = files.length ? claudeContent(text, files, readAttachment) : [{ type: "text", text }]; } catch (e: any) { return Promise.reject(e); }
          busy = true;
          if (!proc) proc = spawn();
          return new Promise((resolve) => {
            turn = { resolve }; turnSeq++; refused = null;
            proc!.write({ type: "user", session_id: id, parent_tool_use_id: null, message: { role: "user", content } });
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
          dropPrivate();
          endTurn("interrupted");
          return `claude --resume ${id}`;
        },
      };
      // a takeover starts the CLI at once, so its hooks (firstmate's watch) are armed before the first message;
      // a fresh primary too, so Studio owns (and Stop kills) a real process from the start
      if (opts.fork || fresh) { try { proc = spawn(); } catch (e) { dropPrivate(); throw e; } }
      return session;
    },
  };
}
