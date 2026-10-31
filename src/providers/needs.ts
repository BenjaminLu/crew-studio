// What a CLI provider needs inside a sandboxed round (architecture §10):
// - its own install (the real path of its binary, two folders up, so a package's files resolve), read only;
// - the API hosts it calls (the round's egress list starts from these);
// - a throwaway home for the round: the CLI writes its config, sessions and caches
//   there, never into the user's real config (~/.claude, ~/.codex …), which a later,
//   unsandboxed session would run;
// - its login (src/providers/login.ts): an API key Studio keeps, handed in through a file
//   descriptor; or the captain's own sign-in, which the vendor's CLI reads and refreshes itself.
//   Studio never reads or copies a subscription credential. The CLI is a credentialed model client
//   and nothing more (the model has no tool of its own; every tool runs in Studio's own sandbox
//   without credentials), so on the captain's own sign-in the round opens to it only that credential
//   (`account`: the login keychain database, or one linked login file), never a folder of the
//   captain's and never the repository (`noWorkspace`), and runs only what signing in needs (`exec`);
// - the variables that name the CLI's own temporary folder (set to the round's tmp).
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readSync, realpathSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { claudeAccountContext, claudeBilling, claudeLogin, codexLogin, cursorLogin, type Login } from "./login";
import { dirname, join } from "node:path";
import { accountHomeDir, type AccountContext } from "../runtime/checks";

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
  /** the captain's own credential the vendor's CLI signs in with, opened to the round (runtime/checks.ts AccountContext) */
  account?: () => AccountContext | null;
  /** the CLI never needs the round's worktree (its model has Studio's tools only): run it in the round's tmp, with no worktree access */
  noWorkspace?: () => boolean;
  /** when set, the only programs the round may execute (subpaths or files); everything else is denied */
  exec?: () => string[] | null;
};
const which = (bin: string): string | null => {
  if (bin.includes("/")) return existsSync(bin) ? bin : null;
  for (const d of (process.env.PATH ?? "").split(":")) { const p = join(d, bin); if (existsSync(p)) return p; }
  return null;
};
const installOf = (bin: string) => { const found = which(bin); if (!found) return []; let r = found; try { r = realpathSync(found); } catch {} return [dirname(r), dirname(dirname(r))]; };
/** What a round may execute to start a CLI: its real binary, the folder it ships in (an npm package or a versioned install,
 *  never a shared folder), and the interpreter its #! line names (an npm launcher runs under node). */
/** Install layouts whose folder belongs to the CLI alone (an npm package, a versioned install, a cask, a vendored binary). */
const PACKAGE = /\/node_modules\/|\/\.local\/share\/claude\/|\/Caskroom\/|\/Cellar\/|\/vendor\//;
export function execOf(bin: string): string[] {
  const found = which(bin); if (!found) return [];
  let r = found; try { r = realpathSync(found); } catch {}
  // its folder and the package above it only in a layout that is the CLI's alone; a binary in a shared folder (~/.local/bin,
  // ~/.bun/bin, /usr/local/bin …) is allowed as itself only
  const out = [r], dir = dirname(r), pkg = dirname(dir);
  if (PACKAGE.test(r) && dir !== homedir()) { out.push(dir); if (PACKAGE.test(pkg + "/") && pkg !== homedir()) out.push(pkg); }
  // only the first bytes (a native CLI is hundreds of megabytes): the #! line, if any
  try { const fd = openSync(r, "r"), buf = Buffer.alloc(200); let n = 0; try { n = readSync(fd, buf, 0, 200, 0); } finally { closeSync(fd); } const head = buf.subarray(0, n).toString("latin1"); const m = /^#!\s*(\S+)(?:\s+(\S+))?/.exec(head);
    if (m) { out.push(m[1]); if (/\/env$/.test(m[1]) && m[2]) { const i = which(m[2]); if (i) { out.push(i); try { out.push(realpathSync(i)); } catch {} } } } } catch {}
  return [...new Set(out)];
}

export type ApprovedClaudeConfig = { model: string; effort: string | null; login: () => Login; live: () => boolean; invalidate: (code?: string,event?: unknown) => void };
export const claudeSettings = (approved: Pick<ApprovedClaudeConfig,'model'|'effort'>) => ({model:approved.model,...approved.effort?{effortLevel:approved.effort}:{},availableModels:[approved.model],fallbackModel:[],switchModelsOnFlag:false,disableAllHooks:true,disableAutoMemory:true,disableWorkflows:true,enabledPlugins:{}});
/** The programs a claude round may run on the captain's own sign-in: the CLI (execOf), Studio's runtime (the MCP relay it
 *  starts), and the shell and command the CLI reads its keychain item with. Nothing else, ever: the model has no tool. */
export const claudeExecAllow = (bin: string) => [...execOf(bin), process.execPath, "/bin/sh", "/usr/bin/security"];
const regexQuote = (p: string) => p.replace(/[\\^$.*+?()[\]{}|]/g, (c) => `\\${c}`);
/** Whether the CLI keeps its sign-in in the login keychain (macOS; CREW_CLAUDE_KEYCHAIN=0/1 overrides, for tests). */
export const KEYCHAIN = () => process.env.CREW_CLAUDE_KEYCHAIN ? process.env.CREW_CLAUDE_KEYCHAIN === "1" : process.platform === "darwin";
/** The login user the CLI names its keychain item's account after (it reads USER, else the system's). */
export const loginUserEnv = (): Record<string, string> => { let u = process.env.USER || process.env.LOGNAME || ""; if (!u) try { u = userInfo().username; } catch {} return u ? { USER: u, LOGNAME: u } : {}; };
/** What of the captain's own Claude sign-in a round reaches: on macOS the login keychain database (and the temporary and lock
 *  files written beside it when the CLI refreshes its item), where the CLI keeps its sign-in; and a captain's own
 *  CLAUDE_CONFIG_DIR, named only so the CLI finds its keychain item (it names the item after that folder), kept closed. */
export function claudeAccountRules(): AccountContext {
  const kc = join(accountHomeDir(), "Library", "Keychains"), own = process.env.CLAUDE_CONFIG_DIR?.trim();
  return { writeRegex: KEYCHAIN() ? [`^${regexQuote(kc)}/login\\.keychain(-db)?([.-][^/]*)?$`, `^${regexQuote(kc)}/\\.fl[0-9A-Fa-f]+$`] : [], deny: own ? [own] : [] };
}
export function claudeNeeds(bin: string, hosts: string[], approved?: ApprovedClaudeConfig): SandboxNeeds {
  // claude's config, sessions and caches live in the round's own throwaway home in every case (v1 bin/adapters/claude.sh).
  // Under API billing Studio hands its key through a descriptor. On the captain's own sign-in the CLI reads its keychain item
  // itself: that item is named for the login user (USER) and, only when the captain set one, the CLAUDE_CONFIG_DIR path, never
  // for HOME, so a throwaway HOME finds it; the round reaches that keychain database and nothing else of the captain's.
  // One decision per round: the login a verified receipt was made with, else the billing choice now; a receipt whose login no
  // longer matches the billing choice is invalidated (Studio verifies again).
  const now = claudeBilling() === "api-key" ? "api-key" : "account";
  const receipt = approved?.login(), mode = receipt?.ok && receipt.kind ? receipt.kind : now, own = mode === "account";
  return { reads: installOf(bin), hosts, tmpEnv: ["CLAUDE_CODE_TMPDIR"],
    home(dir) {
      // where there is no keychain (off macOS) the CLI keeps its sign-in in a file of the captain's own config folder: there it
      // runs in the captain's own account context (rounds there run only in local unrestricted mode; Linux rounds are refused)
      if (own && !KEYCHAIN()) return { ...claudeAccountContext().env, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", ...loginUserEnv() };
      const cfg = join(dir, ".claude-config"), captain = process.env.CLAUDE_CONFIG_DIR?.trim();
      mkdirSync(cfg, { recursive: true });
      // on the captain's own sign-in with a CLAUDE_CONFIG_DIR of theirs, the CLI must be told that path to find its item; the
      // profile keeps it closed (claudeAccountRules), so the CLI runs with an empty config there
      // (without one, CLAUDE_CONFIG_DIR stays unset: a set folder renames the item, and the CLI keeps its config in HOME/.claude)
      const config = own ? (captain ? { CLAUDE_CONFIG_DIR: captain } : {}) : { CLAUDE_CONFIG_DIR: cfg };
      return { HOME: dir, ...config, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", ...(own ? loginUserEnv() : {}) };
    },
    login: () => {
      if (!approved) { const l = claudeLogin(); return l.ok && l.kind !== mode ? { ok: false, error: "Claude billing changed while the round was being set up; start it again" } : l; }
      if (!approved.live()) return { ok: false, error: "Claude native verification expired or was revoked" };
      if (mode !== now) { approved.invalidate("billingChanged"); return { ok: false, error: "Claude billing changed since Studio verified this model; it verifies again before the next round" }; }
      return approved.login(); },
    account: () => own ? claudeAccountRules() : null,
    noWorkspace: () => own,
    exec: () => own ? claudeExecAllow(bin) : null };
}
export type ApprovedCodexConfig = { model: string; effort: string | null };
/** On the captain's own codex sign-in a round opens only that login file, read and write (the CLI refreshes it in place through
 *  the link in the round's private CODEX_HOME); nothing else of the captain's codex home is reachable or loads. */
export function codexAccountRules(loginFile: string): AccountContext { return { writeFiles: [loginFile] }; }
export function codexNeeds(bin: string, hosts: string[], approved?: ApprovedCodexConfig): SandboxNeeds {
  // codex signs in from a private CODEX_HOME: holding Studio's own API key, or a link to the captain's own auth.json, which
  // the codex CLI reads and refreshes in place (Studio never reads it). The model and effort Studio approved go on the command line
  // (src/providers/codex.ts), so nothing is ever written into the captain's codex home.
  let login: Login | null = null;
  return { reads: installOf(bin), hosts, tmpEnv: [],
    home(dir) { mkdirSync(dir, { recursive: true }); return { HOME: dir }; },
    login: (dir) => {
      if (approved && (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(approved.model) || approved.effort !== null && !["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"].includes(approved.effort))) return (login = { ok: false, error: "approved Codex model/effort snapshot is invalid" });
      return (login = codexLogin(join(dir, ".codex")));
    },
    account: () => login?.ok && login.kind === "account" && login.account ? codexAccountRules(login.account) : null,
    noWorkspace: () => !!(login?.ok && login.kind === "account") };
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
