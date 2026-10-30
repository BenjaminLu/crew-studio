// What a CLI provider needs inside a sandboxed round (architecture §10):
// - its own install (the real path of its binary, two folders up, so a package's files resolve), read only;
// - the API hosts it calls (the round's egress list starts from these);
// - a throwaway home for the round: the CLI writes its config, sessions and caches
//   there, never into the user's real config (~/.claude, ~/.codex …), which a later,
//   unsandboxed session would run;
// - its login (src/providers/login.ts): an API key Studio keeps, handed in through a file
//   descriptor; or the captain's own account, which the vendor's CLI reads and refreshes itself:
//   then `account` opens that account's own folders to the round (read and write, kept after it),
//   `keychain` the login keychain when the CLI keeps its sign-in there, and `exec` narrows what
//   the round may execute. Studio never reads or copies a subscription credential;
// - the variables that name the CLI's own temporary folder (set to the round's tmp).
import { existsSync, mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { claudeAccountContext, claudeBilling, claudeLogin, codexLogin, cursorLogin, type Login } from "./login";
import { dirname, join } from "node:path";
import type { AccountContext } from "../runtime/checks";

export type SandboxNeeds = {
  reads: string[]; hosts: string[]; tmpEnv: string[];
  /** a provider that runs in Studio's own process (direct HTTP): nothing to spawn or confine; its requests go through the egress proxy with the round's credential, to its hosts only */
  inProcess?: boolean;
  /** Trusted provider configuration only; never a workflow egress grant. */
  localOrigins?: string[];
  /** make the round's throwaway home in `dir`; returns the variables that point the CLI at it */
  home(dir: string): Record<string, string>;
  /** folders home() made outside `dir` that the round also writes (and Studio removes with the round) */
  writes?: string[];
  /** the vendor's own login for the round (src/providers/login.ts) */
  login(dir: string): Login;
  /** the captain's own account context the vendor's CLI signs in from, opened to the round: folders it reads and writes
   *  (never removed with the round), file-name patterns beside them (SBPL regexes), and whether the login keychain is opened */
  account?: () => AccountContext | null;
  /** when set, the only programs the round may execute (subpaths or files); everything else is denied */
  exec?: () => string[] | null;
};
const which = (bin: string): string | null => {
  if (bin.includes("/")) return existsSync(bin) ? bin : null;
  for (const d of (process.env.PATH ?? "").split(":")) { const p = join(d, bin); if (existsSync(p)) return p; }
  return null;
};
const installOf = (bin: string) => { const found = which(bin); if (!found) return []; let r = found; try { r = realpathSync(found); } catch {} return [dirname(r), dirname(dirname(r))]; };

export type ApprovedClaudeConfig = { model: string; effort: string | null; login: () => Login; live: () => boolean; invalidate: (code?: string,event?: unknown) => void };
export const claudeSettings = (approved: Pick<ApprovedClaudeConfig,'model'|'effort'>) => ({model:approved.model,...approved.effort?{effortLevel:approved.effort}:{},availableModels:[approved.model],fallbackModel:[],switchModelsOnFlag:false,disableAllHooks:true,disableAutoMemory:true,disableWorkflows:true,enabledPlugins:{}});
/** The programs a claude round may run when it signs in with the captain's own account: the CLI's install, Studio's own
 *  runtime (its MCP server), the shell the CLI runs its keychain command through, that command, git, and a few read-only
 *  system facts. The model in the
 *  round has no tool of its own, so nothing else is ever needed; a shell it is somehow handed can start none of the rest. */
export const claudeExecAllow = (bin: string) => [...installOf(bin), process.execPath, "/bin/sh", "/bin/bash", "/usr/bin/env", "/usr/bin/security", "/usr/bin/git", "/usr/bin/xcrun", "/Library/Developer/CommandLineTools/usr/bin/git",
  // read-only facts the CLI asks for and copes without: its own process state (ps), the machine's name and version
  "/bin/ps", "/usr/sbin/scutil", "/usr/bin/uname", "/usr/bin/sw_vers"];
const regexQuote = (p: string) => p.replace(/[\\^$.*+?()[\]{}|]/g, (c) => `\\${c}`);
/** What the captain's own Claude folder loads into every one of the captain's sessions: read-only to a round. */
export const CLAUDE_ACCOUNT_READ_ONLY = ["CLAUDE.md", "hooks", "plugins", "skills", "agents", "commands", "output-styles", "keybindings.json", "managed-settings.json"];
/** What the captain's own codex home loads into every codex session: read-only to a round. */
export const CODEX_ACCOUNT_READ_ONLY = ["config.toml", "AGENTS.md", "AGENTS.override.md", "rules", "prompts", "skills", "hooks.json"];
export function claudeNeeds(bin: string, hosts: string[], approved?: ApprovedClaudeConfig): SandboxNeeds {
  // Under API billing: claude's config, sessions and caches live in the round's own throwaway home (v1 bin/adapters/claude.sh).
  // With the captain's own account: claude runs in that account context (its HOME, and its CLAUDE_CONFIG_DIR only when the
  // captain set one), where it finds and refreshes its own sign-in; Studio never reads it. The round opens that context to
  // the claude process, and claude.ts loads none of its settings, hooks, plugins, memory or MCP servers (--setting-sources "").
  const own = () => claudeBilling() !== "api-key";
  return { reads: installOf(bin), hosts, tmpEnv: ["CLAUDE_CODE_TMPDIR"],
    home(dir) {
      if (own()) { mkdirSync(dir, { recursive: true }); return { ...claudeAccountContext().env, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" }; }
      const cfg = join(dir, ".claude-config"); mkdirSync(cfg, { recursive: true }); return { HOME: dir, CLAUDE_CONFIG_DIR: cfg, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1" }; },
    login: () => approved ? approved.live() ? approved.login() : {ok:false,error:'Claude native verification expired or was revoked'} : claudeLogin(),
    account: () => { if (!own()) return null; const c = claudeAccountContext();
      // ~/.claude.json and the lock, temp and backup files the CLI writes beside it live in HOME unless CLAUDE_CONFIG_DIR is set
      return { dirs: [c.configDir], regex: c.env.CLAUDE_CONFIG_DIR ? [] : [`^${regexQuote(join(c.home, ".claude.json"))}`], keychain: process.platform === "darwin",
        readOnly: CLAUDE_ACCOUNT_READ_ONLY.map((x) => join(c.configDir, x)), readOnlyRegex: [`^${regexQuote(c.configDir)}/settings[^/]*\\.json$`] }; },
    exec: () => own() ? claudeExecAllow(bin) : null };
}
export type ApprovedCodexConfig = { model: string; effort: string | null };
export function codexNeeds(bin: string, hosts: string[], approved?: ApprovedCodexConfig): SandboxNeeds {
  // codex signs in from CODEX_HOME: a private one holding Studio's own API key, or the captain's own, whose login the codex CLI
  // reads and refreshes itself (Studio never reads it). The model and effort Studio approved go on the command line
  // (src/providers/codex.ts), so nothing is ever written into the captain's codex home.
  let login: Login | null = null;
  return { reads: installOf(bin), hosts, tmpEnv: [],
    home(dir) { mkdirSync(dir, { recursive: true }); return { HOME: dir }; },
    login: (dir) => {
      if (approved && (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(approved.model) || approved.effort !== null && !["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"].includes(approved.effort))) return (login = { ok: false, error: "approved Codex model/effort snapshot is invalid" });
      return (login = codexLogin(join(dir, ".codex")));
    },
    account: () => login?.ok && login.kind === "account" ? { dirs: [login.env.CODEX_HOME], regex: [], keychain: false, readOnly: CODEX_ACCOUNT_READ_ONLY.map((x) => join(login!.env.CODEX_HOME, x)) } : null };
}
/** A private root for one cursor-agent turn, short enough for its data folder: past 84 characters cursor-agent falls back to a
 *  shared /tmp/.cursor (v1 bin/adapters/cursor-agent.sh). h/ is its HOME (h/.config its XDG_CONFIG_HOME), w/ its workspace,
 *  d/ its CURSOR_DATA_DIR. */
export function cursorRoot(): string {
  const root = realpathSync(mkdtempSync("/tmp/crc."));
  if (root.length > 60) throw new Error("cannot make a short private folder for cursor-agent");
  for (const d of ["h/.config/cursor", "w/.cursor", "d"]) mkdirSync(join(root, d), { recursive: true, mode: 0o700 });
  return root;
}
export function cursorNeeds(bin: string, hosts: string[]): SandboxNeeds {
  const writes: string[] = [];
  return { reads: installOf(bin), hosts, tmpEnv: [], writes,
    home(dir) { mkdirSync(dir, { recursive: true }); const root = cursorRoot(); writes.push(root); return { CREW_CURSOR_ROOT: root }; },
    login: () => cursorLogin() };
}
/** A direct-HTTP provider: in Studio's process, its egress the API host of its base URL only (through the proxy). */
export function httpNeeds(baseUrl: () => string): SandboxNeeds {
  return { reads: [], tmpEnv: [], inProcess: true, get localOrigins() { try { const u = new URL(baseUrl()); return [u.origin]; } catch { return []; } }, get hosts() { try { return [new URL(baseUrl()).hostname]; } catch { return []; } }, home: () => ({}), login: () => ({ ok: true, env: {}, source: "Studio's key store (the request leaves from Studio's process)", warn: null }) };
}
