// Cursor as a host: a FRESH Firstmate primary only. Studio never takes over a Cursor session
// from a terminal (discover finds none; attach refuses anything but fresh). cursor-agent -p runs one process per turn:
// in Studio's own workspace the first turn uses a chat Studio made with `cursor-agent create-chat` (else the id the CLI reports
// in its init event), later turns `--resume <chatId>`, so the conversation carries on (an explicit project's below does not).
// It runs in a private root of its own (0700, swept with the Claude primary's folders): HOME, XDG_CONFIG_HOME, the
// workspace and CURSOR_DATA_DIR live there, so neither the captain's ~/.cursor nor a repository's .cursor/ is read.
// The workspace's .cursor/mcp.json registers only Studio's MCP helper (src/mcp.ts), which reaches this session's
// native tools over a private unix socket (random token in a 0600 file); cli-config.json allows exactly those tools
// and denies every built-in Shell, Read and Write, so Firstmate on Cursor works through Studio alone.
// In an explicit project (opts.cursorProject) it is a fresh Firstmate in that project's folder instead, as Codex's is: the
// folder is the workspace, so cursor-agent follows its AGENTS.md and its own tools work there. cursor-agent's permission rules
// alone do not confine it (reads are allowed anywhere unless a Read deny names the path as asked, and a symlink defeats that),
// so every cursor-agent process runs under the OS sandbox a round uses (cursorProjectProfile: reads only the folder, its own
// install, the system and this turn's attachments; writes only the folder, never its .cursor/, .claude/, .git/, .vscode/ or
// .idea/ in any case, plus its private HOME, data and tmp; Studio's data folder and the user's secret folders closed; network
// only to Cursor's API through a scoped proxy), with --sandbox disabled inside it as an image job has. cli-config.json
// (cursorProjectPermissions) denies Shell, every MCP tool, the secrets by name and writes to its private folder, and never allows
// a write. A project whose hooks, MCP servers or cursor-agent settings would apply (cursorProjectHooks) is refused at the start
// and before every turn. No Studio tool, and nothing is written into the project's .cursor/. Without the OS sandbox (none on this
// computer, or local unrestricted execution) it does not start: cursor-agent's own rules alone do not hold there
// (cursorProjectSandboxRefusal). Every turn is a new cursor-agent chat whose prompt carries the conversation so far: --resume
// would need cursor-agent's shared /tmp/cursor-agent-persist-<uid>, which the sandbox keeps closed.
// Residual risk: hooks that are not the project's still run, with the key in their environment: the Mac's enterprise
// /Library/Application Support/Cursor/hooks.json (its administrator's) and team hooks Cursor syncs for a team account (into the
// private HOME's .cursor/managed/). Studio cannot see or refuse those. In Studio's own workspace nothing sandboxes them; in an
// explicit project they inherit the OS sandbox (and its Cursor-only network).
// cleanEnv drops every *_API_KEY: the caller hands the Cursor API key back explicitly in opts.env.CURSOR_API_KEY.
//   CREW_HOST_CURSOR_BIN  executable (default "cursor-agent"; a .mjs path runs under bun: test stub)
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, relative } from "node:path";
import { dropPrivateDir, nativeEndpoint, privateDir } from "./claude";
import { cursorInput } from "../attachments";
import { binArgv, cursorPrompt } from "./jsonl";
import { nativeToolError } from "./native-errors";
import { NativeToolFailure, cleanEnv, shortSummary, type AttachedSession, type Host, type HostEvent } from "./types";
import { Egress } from "../egress";
import { openScopedProxy } from "../egress-client";
import { localUnrestricted } from "../local-execution";
import { CURSOR_HOSTS } from "../providers/cursor";
import { cursorNeeds } from "../providers/needs";
import { roundProfile, sandboxInfo, SECRET_DIRS } from "../runtime/checks";

/** Where a carried conversation (an explicit project's turn) ends and the captain's new message starts. */
export const CURSOR_NEW_MESSAGE = "[Studio: the captain's new message]";
const CHAT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{5,127}$/;
const MODEL = /^[\w.:\[\]=,-]{1,120}$/;
export const CURSOR_PROJECT_NO_SANDBOX = { en: "Firstmate on Cursor starts in an explicit project only under the OS sandbox, and this computer has none (macOS sandbox-exec); start Firstmate on Codex here.",
  "zh-TW": "Cursor 上的 Firstmate 只在作業系統沙盒中於明確專案啟動，而這台電腦沒有（macOS sandbox-exec）；請在這裡改用 Codex 啟動 Firstmate。" };
export const CURSOR_PROJECT_UNRESTRICTED = { en: "Firstmate on Cursor starts in an explicit project only under the OS sandbox, and this Studio runs with it off (CREW_LOCAL_UNRESTRICTED=1): cursor-agent's own rules alone do not protect the project's settings. Start Firstmate on Codex here, or turn the sandbox back on.",
  "zh-TW": "Cursor 上的 Firstmate 只在作業系統沙盒中於明確專案啟動，而這個 Studio 關閉了沙盒（CREW_LOCAL_UNRESTRICTED=1）：單靠 cursor-agent 自己的規則保護不了專案的設定。請在這裡改用 Codex 啟動 Firstmate，或重新開啟沙盒。" };
/** Why Firstmate on Cursor cannot start in an explicit project here, or null: only under the OS sandbox (without it cursor-agent's
 *  case-insensitive, non-Unicode checks and Studio's case-sensitive denies leave .curſor/ and the like writable). */
export const cursorProjectSandboxRefusal = () => { try { if (localUnrestricted()) return CURSOR_PROJECT_UNRESTRICTED; } catch { return CURSOR_PROJECT_UNRESTRICTED; } return sandboxInfo().ok ? null : CURSOR_PROJECT_NO_SANDBOX; };
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

/** An explicit project's cli-config.json permissions. cursor-agent (InteractivePermissionsService) checks a deny first and then an
 *  explicit allow, which skips its own protection of config files (.cursor/, .claude/*.json, .vscode/, .idea/, *.code-workspace,
 *  .git/hooks/, .git/config …, matched in any case), so there is no Write allow at all: a write inside the folder is allowed by
 *  default and those files stay protected. The denies repeat them for nested folders too; they are matched case-sensitively, so
 *  they back the protection up rather than replace it. Shell is denied: a command inherits cursor-agent's environment,
 *  CURSOR_API_KEY included. Every MCP tool is denied, and so is every read and write of Studio's and the user's secrets (SECRET_DIRS;
 *  the OS sandbox is what holds there, as a Read deny is matched against the path as asked, never its realpath). Its private
 *  folder (`priv`: HOME, CURSOR_DATA_DIR, TMPDIR) is denied to the Write tool as well, as given and as its realpath: cursor-agent
 *  writes anything under /private/tmp/ or /private/var/folders/ outside its HOME without asking ($f), and its data folder holds
 *  projects/<slug>/mcp-approvals.json, which would approve an MCP server for the next turn. The Read allow names this turn's
 *  attached PDFs only. */
export function cursorProjectPermissions(ws: string, reads: string[] = [], dataDir?: string | null, priv?: string): { allow: string[]; deny: string[] } {
  let own: string[] = [];
  if (priv) { own = [priv]; try { const r = realpathSync(priv); if (r !== priv) own.push(r); } catch {} }
  return { allow: reads.map((f) => `Read(${f})`),
    deny: ["Shell(*)", "Mcp(*:*)", ...[".cursor", ".claude", ".git", ".vscode", ".idea"].map((d) => `Write(${ws}*/${d}/**)`), `Write(${ws}*.code-workspace)`, `Write(${ws}*/.cursorignore)`,
      ...own.flatMap((p) => [`Write(${p})`, `Write(${p}/**)`]),
      ...SECRET_DIRS(dataDir).flatMap((p) => [`Read(${p})`, `Read(${p}/**)`, `Write(${p})`, `Write(${p}/**)`])] };
}

const sbRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const anyCase = (s: string) => sbRegex(s).replace(/[a-z]/gi, (c) => `[${c.toLowerCase()}${c.toUpperCase()}]`);
/** The OS sandbox of an explicit project's cursor-agent: a round's profile (roundProfile) with the folder as its cwd and writable,
 *  its private HOME, data and tmp writable, its install and this turn's attachments readable; then Studio's data folder closed
 *  even when the project holds it, and the folder's config folders and files (.cursor, .claude, .git, .vscode, .idea,
 *  *.code-workspace, .cursorignore) unwritable at any depth and in any case. */
export function cursorProjectProfile(o: { ws: string; priv: string; reads: string[]; readOnly: string[]; proxyPort: number; dataDir?: string | null }): string {
  if (/["\n]/.test(o.ws)) throw new Error("Firstmate on Cursor cannot sandbox a project folder whose path holds a quote or a line break");
  const real = (p: string) => { try { return realpathSync(p); } catch { return p; } };
  const ws = real(o.ws), data = o.dataDir ? real(o.dataDir) : null, readOnly = o.readOnly.map(real);
  const base = roundProfile({ cwd: ws, tmp: join(o.priv, "t"), writes: [ws, join(o.priv, "h"), join(o.priv, "d")], reads: o.reads, readOnly, proxyPort: o.proxyPort, toolPort: 1, dataDir: data });
  const root = `^${sbRegex(ws)}/(.*/)?`;
  return `${base}${data && ws !== data && !ws.startsWith(data + "/") ? `(deny file-read* file-read-metadata file-write* (subpath ${JSON.stringify(data)}))\n` : ""}${readOnly.length ? `(allow file-read* file-read-metadata ${readOnly.map((p) => `(literal ${JSON.stringify(p)})`).join(" ")})\n` : ""}(deny file-write* (regex #"${root}(${[".cursor", ".claude", ".git", ".vscode", ".idea"].map(anyCase).join("|")})(/.*)?$") (regex #"${root}[^/]*${anyCase(".code-workspace")}$") (regex #"${root}${anyCase(".cursorignore")}$"))
`;
}

/** The folders cursor-agent takes project settings from: the workspace and each one above it up to the git root, the nearest
 *  holding .git (utils/git.ts p()), else the workspace alone. */
function projectChain(ws: string): string[] {
  let root = ws;
  for (let d = ws; ; d = dirname(d)) { if (existsSync(join(d, ".git"))) { root = d; break; } if (dirname(d) === d) break; }
  const out: string[] = [];
  for (let d = ws; ; d = dirname(d)) { out.push(d); if (d === root || dirname(d) === d) return out; }
}
const hasHooks = (f: string) => {
  let text: string;
  try { text = readFileSync(f, "utf8"); } catch (e: any) { return e?.code !== "ENOENT" && e?.code !== "ENOTDIR"; }
  try { const h = JSON.parse(text)?.hooks; return h !== undefined && h !== null && !(typeof h === "object" && !Array.isArray(h) && Object.keys(h).length === 0); } catch { return true; }
};
const entries = (dir: string): string[] | null => { try { return readdirSync(dir); } catch (e: any) { return e?.code === "ENOENT" || e?.code === "ENOTDIR" ? [] : null; } };
/** A file's identity, "" when it is absent, null when it cannot be told. */
const fileId = (f: string): string | null => { try { const s = statSync(f); return `${s.dev}:${s.ino}`; } catch (e: any) { return e?.code === "ENOENT" || e?.code === "ENOTDIR" ? "" : null; } };
const fold = (s: string) => s.normalize("NFKC").toUpperCase().toLowerCase();
const SETTINGS: Record<string, string[]> = { ".cursor": ["hooks.json", "cli.json", "sandbox.json", "mcp.json"], ".claude": ["settings.json", "settings.local.json"] };
const counts = (folder: string, file: string, p: string) => folder === ".claude" || file === "hooks.json" ? hasHooks(p) : true;
/** The project files cursor-agent would act on, in the workspace or any folder above it up to the git root: .cursor/hooks.json and
 *  Claude Code's .claude/settings.json and settings.local.json with hooks (hooks-exec runs them in cursor-agent's own environment,
 *  CURSOR_API_KEY included, outside its sandbox; Shell(*) does not stop a hook), any .cursor/cli.json (merged into its config,
 *  permissions and approval mode included), .cursor/sandbox.json (widens its sandbox) and .cursor/mcp.json (servers that, once
 *  approved, start inside it). cursor-agent opens each by its own name and the disk resolves it (the Mac's ignores case and folds
 *  ſ to s), so each is looked up by that name first; the names actually there are scanned too, folded (NFKC, any case). One that
 *  cannot be read or parsed counts. The user-level files (~/.cursor/hooks.json, team hooks, plugins, ~/.claude/settings.json) come
 *  from os.homedir(), this host's private HOME, so none exists there. */
export function cursorProjectHooks(folder: string): string[] {
  let ws = folder; try { ws = realpathSync(folder); } catch {}
  const found: string[] = [], seen = new Set<string>(), rel = (p: string) => relative(ws, p) || ".";
  const add = (p: string) => { const id = fileId(p); if (id && seen.has(id)) return; if (id) seen.add(id); found.push(rel(p)); };
  for (const dir of projectChain(ws)) {
    const top = entries(dir);
    if (!top) { found.push(rel(dir)); continue; }
    for (const name of top) {
      const kind = fold(name);
      if (!SETTINGS[kind]) continue;
      const files = entries(join(dir, name));
      if (!files) { found.push(rel(join(dir, name))); continue; }
      for (const f of files) { const l = fold(f), p = join(dir, name, f); if (SETTINGS[kind].includes(l) && counts(kind, l, p)) add(p); }
    }
    for (const [kind, names] of Object.entries(SETTINGS)) for (const f of names) {
      const p = join(dir, kind, f), id = fileId(p);
      if (id === null || id && !seen.has(id) && counts(kind, f, p)) add(p);
    }
  }
  return found;
}
export const cursorHooksRefusal = (files: string[], turn = false) => turn
  ? { en: `Not sent: ${files.join(", ")} in this project now defines hooks, MCP servers or cursor-agent settings; cursor-agent would run those hooks with the Cursor API key in their environment, start those servers, or take its permissions from those settings. Remove them, or stop Firstmate on Cursor here.`,
      "zh-TW": `未送出：這個專案的 ${files.join("、")} 現在定義了 hooks、MCP 伺服器或 cursor-agent 設定；cursor-agent 會在帶有 Cursor API key 的環境中執行這些 hooks、啟動這些伺服器，或依這些設定決定它的權限。請移除它們，或停止這裡的 Cursor Firstmate。` }
  : { en: `Firstmate on Cursor does not start in this project: ${files.join(", ")} defines hooks, MCP servers or cursor-agent settings; cursor-agent would run those hooks with the Cursor API key in their environment, start those servers, or take its permissions from those settings. Remove them, or start Firstmate on Codex here.`,
      "zh-TW": `Cursor 上的 Firstmate 不在這個專案啟動：${files.join("、")} 定義了 hooks、MCP 伺服器或 cursor-agent 設定；cursor-agent 會在帶有 Cursor API key 的環境中執行這些 hooks、啟動這些伺服器，或依這些設定決定它的權限。請移除它們，或在這裡改用 Codex 啟動 Firstmate。` };

export function cursorHost(bin = process.env.CREW_HOST_CURSOR_BIN ?? "cursor-agent"): Host {
  return {
    id: "cursor",
    resumeCommand: (id) => `cursor-agent --resume ${id}`,
    async discover() { return []; },
    async attach(_requested, opts) {
      if (!opts.fresh) throw new Error(CURSOR_TAKEOVER_REFUSED);
      const key = opts.env?.CURSOR_API_KEY;
      if (!key) throw new Error("Firstmate on Cursor needs a Cursor API key (keychain item crew-studio-cursor-api-key first; CURSOR_API_KEY in Studio's environment only as the last fallback)");
      const project = opts.cursorProject === true;
      const native = !project && opts.nativeTools && opts.studioMcp ? opts.nativeTools : null;
      if (!project && !native) throw new Error("Firstmate on Cursor runs only with Studio's native tools");
      let projectDir = "";
      if (project) { try { projectDir = realpathSync(opts.cwd); } catch {} if (!projectDir || !statSync(projectDir).isDirectory()) throw new Error("Firstmate on Cursor needs the explicit project's folder"); }
      const hooks = project ? cursorProjectHooks(projectDir) : [];
      if (hooks.length) { const r = cursorHooksRefusal(hooks); throw new Error(`${r.en} / ${r["zh-TW"]}`); }
      const unsafe = project ? cursorProjectSandboxRefusal() : null;
      if (unsafe) throw new Error(`${unsafe.en} / ${unsafe["zh-TW"]}`);
      const confined = project;
      const model = opts.model && MODEL.test(opts.model) ? opts.model : null;
      let chatId: string | null = null, shownModel = model ?? "cursor", turnSeq = 0, busy = false, interrupting = false;
      let proc: ChildProcess | null = null;
      let turn: { resolve: (r: { status: "completed" | "interrupted" | "failed"; message?: string }) => void } | null = null;
      const emit = (e: HostEvent) => { try { opts.onEvent(e); } catch {} };
      const priv = privateDir();
      for (const d of ["h/.config/cursor", "d", ...(project ? ["t"] : ["w/.cursor"])]) mkdirSync(join(priv, d), { recursive: true, mode: 0o700 });
      const ws = project ? projectDir : join(priv, "w");
      const cliConfig = join(priv, "h", ".config", "cursor", "cli-config.json");
      const endpoint = !native ? null : nativeEndpoint(priv, async (name, args) => {
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
      // an explicit project's network: Cursor's API only, through a proxy scoped to its hosts
      const egress = confined ? new Egress() : null;
      let lease: Awaited<ReturnType<typeof openScopedProxy>> | null = null;
      const drop = () => { endpoint?.close(); lease?.close(); egress?.stop(); dropPrivateDir(priv); };
      if (egress) try { await egress.start(); lease = await openScopedProxy(egress, CURSOR_HOSTS); } catch (e) { drop(); throw e; }
      const resolved = (f: string) => { try { const r = realpathSync(f); return r === f ? [f] : [f, r]; } catch { return [f]; } };
      // readBoundary "workspace" applies only where Cursor turns its read control on for the account; harmless elsewhere
      const writeConfig = (reads: string[] = []) => writeFileSync(cliConfig, JSON.stringify({ version: 1, permissions: project ? cursorProjectPermissions(ws, reads.flatMap(resolved), opts.dataDir, priv) : { allow: native!.specs.map((t) => `Mcp(studio:${t.name})`), deny: ["Shell(*)", "Read(**)", "Write(**)"] },
        ...(project ? { sandbox: { readBoundary: "workspace" } } : {}) }), { mode: 0o600 });
      // the OS sandbox profile every cursor-agent process of an explicit project runs under (rewritten with each turn's attachments)
      const profile = join(priv, "project.sb"), installReads = confined ? cursorNeeds(bin, []).reads : [];
      const confine = (readOnly: string[]) => { if (confined) writeFileSync(profile, cursorProjectProfile({ ws, priv, reads: installReads, readOnly: readOnly.flatMap(resolved), proxyPort: lease!.port, dataDir: opts.dataDir }), { mode: 0o600 }); };
      try {
        // an explicit project's own .cursor/ is never written: Studio's MCP helper is registered only in its private workspace
        if (endpoint) writeFileSync(join(ws, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: { studio: { command: opts.studioMcp!.command[0], args: opts.studioMcp!.command.slice(1), env: { CREW_STUDIO_SOCKET: endpoint.socket, CREW_TOOL_TOKEN_FILE: endpoint.tokenFile } } } }), { mode: 0o600 });
        writeConfig(); confine([]);
      } catch (e) { drop(); throw e; }
      const env: Record<string, string> = { ...cleanEnv(), ...(opts.env ?? {}), CURSOR_API_KEY: key, HOME: join(priv, "h"), XDG_CONFIG_HOME: join(priv, "h", ".config"), CURSOR_DATA_DIR: join(priv, "d"), AGENT_CLI_CREDENTIAL_STORE: "memory" };
      if (lease) Object.assign(env, { TMPDIR: join(priv, "t"), HTTPS_PROXY: lease.url, HTTP_PROXY: lease.url, https_proxy: lease.url, http_proxy: lease.url, ALL_PROXY: lease.url, all_proxy: lease.url, NO_PROXY: "", no_proxy: "" });
      const run = (args: string[], onLine: (m: any) => void) => {
        const argv = confined ? ["/usr/bin/sandbox-exec", "-f", profile, ...binArgv(bin, args)] : binArgv(bin, args);
        const p = spawn(argv[0], argv.slice(1), { cwd: ws, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
        let buf = "", err = "";
        p.stdout!.on("data", (d: Buffer) => { buf += d.toString("utf8"); let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (!l.trim()) continue; let o: any; try { o = JSON.parse(l); } catch { o = { type: "_text", text: l }; } try { onLine(o); } catch {} } });
        p.stderr!.on("data", (d: Buffer) => { err = (err + d.toString("utf8")).slice(-4000); });
        const exited = new Promise<number | null>((r) => { p.once("exit", (c) => r(c)); p.once("error", () => r(null)); });
        return { p, exited, stderr: () => err };
      };
      const kill = (p: ChildProcess | null, sig: NodeJS.Signals = "SIGTERM") => { if (!p?.pid) return; try { process.kill(-p.pid, sig); } catch {} try { p.kill(sig); } catch {} };
      // the first turn's chat: `create-chat` prints its id; a CLI that cannot make one leaves the init event to name it.
      // An explicit project never resumes a chat: `--resume` (and --continue) first checks cursor-agent's persistent sessions in
      // /tmp/cursor-agent-persist-<uid> (index.js k(): "/tmp" hard-coded, no flag or variable moves it) and mkdirs a claim lock
      // there, which the OS sandbox refuses (EPERM) and must: that folder is the user's own sessions'. Each turn is a new chat
      // instead, the conversation so far carried in its prompt (carried()).
      const history: string[] = [];
      const clip = (t: string, n: number) => t.length > n ? `${t.slice(0, n)} …` : t;
      const carried = (text: string) => {
        if (!history.length) return text;
        const kept: string[] = []; let size = 0;
        for (const h of [...history].reverse()) { if (size + h.length > 24_000) break; kept.unshift(h); size += h.length; }
        return `[Studio: this chat so far, oldest first${kept.length < history.length ? `, its ${history.length - kept.length} earliest turn(s) left out` : ""}; context, not a new request]\n${kept.join("\n\n")}\n\n${CURSOR_NEW_MESSAGE}\n${text}`;
      };
      if (!project) try {
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
          // hooks added since the start (by the captain or another tool) would run in this turn's process: refused, never run
          const added = project ? cursorProjectHooks(ws) : [];
          if (added.length) { const reason = cursorHooksRefusal(added, true); emit({ type: "hostRefusal", code: "cursorProjectHooks", reason }); return Promise.resolve({ status: "failed" as const, message: reason.en }); }
          // attachments: images as --image (cursor-agent reads the file itself); a PDF only where its Read tool works (src/attachments.ts)
          let input: ReturnType<typeof cursorInput>;
          try { input = cursorInput(text, files, { cursorReads: project }); if (project) { writeConfig(input.reads); confine(files.map((f) => f.path)); } } catch (e) { return Promise.reject(e); }
          busy = true; turnSeq++;
          return new Promise((resolve) => {
            turn = { resolve };
            let reply = "", ended = false;
            // an explicit project: never --force, the project's MCP servers not auto-approved and its .cursor/cli.json files not
            // merged into the config; cursor-agent's own sandbox cannot nest in the OS sandbox, so it is off inside it
            const mode = project ? ["--sandbox", "disabled", "--disable-project-configs"] : ["--approve-mcps", "--sandbox", "disabled"];
            const args = ["-p", "--output-format", "stream-json", "--trust", ...mode, "--workspace", ws, ...(model ? ["--model", model] : []), ...(chatId && !project ? ["--resume", chatId] : []), ...input.args, "--", cursorPrompt(project ? carried(input.text) : input.text)];
            let r: ReturnType<typeof run>;
            try {
              r = run(args, (m) => {
                if (m.type === "system" && m.subtype === "init") {
                  if (typeof m.model === "string" && m.model) shownModel = m.model;
                  if (typeof m.session_id === "string" && CHAT_ID.test(m.session_id) && !(project && chatId)) {
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
                  if (project) history.push(`Captain: ${clip(input.text, 4000)}\nYou: ${clip(said || reply || "(no reply)", 4000)}`);
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
          // no terminal can resume a Studio-made Cursor chat: there is no resume command to hand back
          return "";
        },
      };
      return session;
    },
  };
}
