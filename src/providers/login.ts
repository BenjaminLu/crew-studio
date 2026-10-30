// A round's vendor login. Studio never reads, copies or hands on a vendor's subscription credential:
// Anthropic's terms forbid a third-party app to collect, store or intermediate Claude.ai credentials or
// session tokens, and a copied login is a credential a round could leak. Instead the vendor's own,
// unmodified CLI signs in with the captain's own login, which it reads and refreshes itself:
//
// claude: with API billing chosen (CREW_CLAUDE_BILLING=api-key, or data/claude-billing.json),
//   ANTHROPIC_API_KEY or the key Studio keeps (handed in through a file descriptor, never argv or env);
//   otherwise "account": the claude CLI runs in the captain's own account context (HOME, and
//   CLAUDE_CONFIG_DIR only when the captain set one), where it finds its own sign-in (the login
//   keychain on macOS, ~/.claude/.credentials.json elsewhere). Whether that context is signed in is
//   the CLI's own `claude auth status` (src/providers/claude-native.ts); this resolver reads nothing.
//   The round's sandbox opens that context to the claude process only (src/providers/needs.ts);
//   the model in it has no tool of its own, only Studio's MCP tools, which run sandboxed elsewhere.
// codex: CODEX_API_KEY in a private auth.json of the round's own CODEX_HOME (Studio's own key);
//   otherwise "account": the codex CLI runs with the captain's own CODEX_HOME, whose login it reads
//   and refreshes itself. Studio checks only that its auth.json exists, never what it holds.
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { registerSecretValues, scrubEnv } from "../secure";
import { keptKeys } from "../keys";

/** Which kind of credential a login is, for code to decide on (the source text is for people). */
export type LoginKind = "account" | "api-key";
export type Login = { ok: true; env: Record<string, string>; source: string; warn: string | null; kind?: LoginKind } | { ok: false; error: string };
const handed = new Set<string>();
// every login value Studio hands a round is a known secret for the one redactor, from the moment it is read
registerSecretValues(() => [...handed]);
const seen = (v: string) => { handed.add(v); return v; };

/** Is there a keychain to read? macOS, or a stand-in tool; CREW_KEYCHAIN_TOOL=none means none (tests of the keychain-less order). */
const keychainOn = () => process.env.CREW_KEYCHAIN_TOOL === "none" ? false : process.platform === "darwin" || !!process.env.CREW_KEYCHAIN_TOOL;
/** One keychain item by service and account (never a search). 44: no such item. */
function keychainRead(service: string, account: string): { found: string | null; error: string | null } {
  if (!keychainOn()) return { found: null, error: null };
  const tool = process.env.CREW_KEYCHAIN_TOOL || "/usr/bin/security";
  const r = Bun.spawnSync([tool, "find-generic-password", "-s", service, "-a", account, "-w"], { env: scrubEnv(), stdout: "pipe", stderr: "pipe", timeout: 5000 });
  if (r.exitCode === 44) return { found: null, error: null };
  if (!r.success) return { found: null, error: `the keychain item '${service}' could not be read (${r.stderr.toString().trim().slice(0, 120) || `exit ${r.exitCode}`}); macOS may be asking to allow it` };
  const v = r.stdout.toString().replace(/\n$/, ""); return v ? { found: v, error: null } : { found: null, error: `the keychain item '${service}' is empty` };
}
/** A login file only the captain may read. */
function privateFile(path: string): { found: string | null; error: string | null } {
  if (!existsSync(path)) return { found: null, error: null };
  try { if (statSync(path).mode & 0o077) return { found: null, error: `${path} can be read by others than you; chmod 600 it` };
    const v = readFileSync(path, "utf8").trim(); return v ? { found: v, error: null } : { found: null, error: `${path} is empty` }; }
  catch (e: any) { return { found: null, error: `${path} could not be read (${e?.code ?? e})` }; }
}
/** Does the item exist? find-generic-password without -w: nothing is decrypted, no dialog asks to allow it (v1's status probes). */
function keychainHas(service: string, account: string): boolean {
  if (!keychainOn()) return false;
  const tool = process.env.CREW_KEYCHAIN_TOOL || "/usr/bin/security";
  return Bun.spawnSync([tool, "find-generic-password", "-s", service, "-a", account], { env: scrubEnv(), stdout: "ignore", stderr: "ignore" }).exitCode === 0;
}
/** The captain's billing choice for claude rounds: CREW_CLAUDE_BILLING, else the setting Studio keeps (data/claude-billing.json). */
let billingFile: string | null = null;
export function setBillingFile(f: string) { billingFile = f; }
export function claudeBilling(): "subscription" | "api-key" {
  if (process.env.CREW_CLAUDE_BILLING) return process.env.CREW_CLAUDE_BILLING === "api-key" ? "api-key" : "subscription";
  try { if (billingFile && JSON.parse(readFileSync(billingFile, "utf8")).billing === "api-key") return "api-key"; } catch {}
  return "subscription";
}
/** The last outcome of each login source a round tried (data/login-outcomes.json): only names and errors, never a value. */
let outcomeFile: string | null = null;
export function setLoginOutcomeFile(f: string | null) { outcomeFile = f; }
/** The captain's home: HOME as it is now (a process may set it), else the system's. */
const home = () => process.env.HOME || homedir();
const user = () => { try { return userInfo().username; } catch { return process.env.USER ?? ""; } };

/** The shape of an Anthropic API key, checked before a round starts (never printed: no prefix, no suffix of the value). */
export const CLAUDE_API_KEY_SHAPE = /^sk-ant-api\d{2}-[A-Za-z0-9_-]{20,}$/;
/** The captain's own Claude account context: where the claude CLI keeps its config and finds its own sign-in. Its
 *  CLAUDE_CONFIG_DIR only when the captain's environment sets one (the CLI names its keychain item after it). */
export function claudeAccountContext(): { home: string; configDir: string; env: Record<string, string> } {
  const h = home(), set = process.env.CLAUDE_CONFIG_DIR?.trim();
  return { home: h, configDir: set || join(h, ".claude"), env: { HOME: h, ...(set ? { CLAUDE_CONFIG_DIR: set } : {}) } };
}
const ACCOUNT_SOURCE = "your own Claude sign-in (the claude CLI reads it itself; Studio never reads it)";
type Resolved = { ok: true; env: Record<string, string>; source: string; warn: string | null; kind: LoginKind } | { ok: false; error: string };
function resolveClaude(probe: boolean): Resolved {
  if (claudeBilling() === "api-key") {
    // two sources in order, Studio's environment then the key Studio keeps; a shape failure moves on, both failing refuses with both reasons
    const why: string[] = [];
    for (const [name, k] of [["ANTHROPIC_API_KEY in Studio's environment", process.env.ANTHROPIC_API_KEY?.trim()], ["the Anthropic key Studio keeps (Doctor → API keys)", keptKeys().anthropic?.trim()]] as const) {
      if (!k) continue;
      if (CLAUDE_API_KEY_SHAPE.test(k)) return { ok: true, env: { ANTHROPIC_API_KEY: probe ? "" : seen(k) }, source: "an Anthropic API key (API billing)", warn: why.length ? `tried first and failed: ${why.join("; ")}` : null, kind: "api-key" };
      why.push(`${name}: it is not an Anthropic API key (expected sk-ant-api03-…)`);
    }
    return { ok: false, error: why.length ? `API billing is chosen and no Anthropic API key works (${why.join("; ")})` : "API billing is chosen and Studio has no Anthropic API key (ANTHROPIC_API_KEY, or Doctor → API keys)" };
  }
  return { ok: true, env: {}, source: ACCOUNT_SOURCE, warn: null, kind: "account" };
}
/** The login a claude round gets (read when it starts): an API key under API billing, else the captain's own account (no value). */
export function claudeLogin(_options: { record?: boolean } = {}): Login { return resolveClaude(false); }
/** Which login a start would use, reading no secret. */
export function claudeLoginPresence(): { ok: boolean; kind?: LoginKind } { const r = resolveClaude(true); return r.ok ? { ok: true, kind: r.kind } : { ok: false }; }
export async function claudeLoginPresenceAsync(): Promise<{ ok: boolean; kind?: LoginKind }> { return claudeLoginPresence(); }
/** What the Doctor shows: the same resolver, reading no secret. For the account, whether it is signed in is the CLI's own status. */
export function claudeLoginStatus(): { ok: boolean; verified?: boolean; source?: string; warn?: string | null; error?: string; kind?: LoginKind } {
  const r = resolveClaude(true); return r.ok ? { ok: true, verified: true, source: r.source, warn: r.warn, kind: r.kind } : { ok: false, error: r.error };
}

/** The shape of a Cursor API key (never printed): a user or service-account key, crsr_… or the older key_…. */
export const CURSOR_KEY_SHAPE = /^(crsr|key)_[A-Za-z0-9]{32,}$/;
/** cursor-agent's own sign-in (`agent login`) lives in the macOS keychain, which no round reaches (v1 T-117), so a round signs in
 *  with a Cursor API key only, keychain first, in order: the keychain item crew-studio-cursor-api-key; firstmate v1's keychain
 *  item firstmate-cursor-api-key; ~/.config/crew-studio/cursor-api-key (mode 600); last, CURSOR_API_KEY in Studio's environment. */
export function cursorLogin(options: { probe?: boolean } = {}): Login {
  const probe = !!options.probe, failed: string[] = [];
  const ok = (v: string, source: string): Login => ({ ok: true, env: { CURSOR_API_KEY: probe ? "" : seen(v) }, source, warn: failed.length ? `tried first and failed: ${failed.join("; ")}` : null, kind: "api-key" });
  const shaped = (v: string, name: string): Login | null => { if (CURSOR_KEY_SHAPE.test(v)) return ok(v, name); failed.push(`${name}: it is not a Cursor API key (expected crsr_…)`); return null; };
  for (const service of ["crew-studio-cursor-api-key", "firstmate-cursor-api-key"]) {
    const name = `the crew's Cursor API key (keychain item ${service})`;
    if (probe) { if (keychainHas(service, user())) return ok("", name); continue; }
    const r = keychainRead(service, user());
    if (r.found) { const got = shaped(r.found.trim(), name); if (got) return got; }
    else if (r.error) failed.push(r.error);
  }
  const fileName = "the crew's Cursor API key (~/.config/crew-studio/cursor-api-key)";
  const f = privateFile(join(home(), ".config", "crew-studio", "cursor-api-key"));
  if (f.found) { const got = probe ? ok("", fileName) : shaped(f.found, fileName); if (got) return got; }
  else if (f.error) failed.push(f.error);
  const k = process.env.CURSOR_API_KEY?.trim();
  if (k) { const r = shaped(k, "CURSOR_API_KEY in Studio's environment"); if (r) return r; }
  const hint = "keep a Cursor API key for the crew once in the keychain (security add-generic-password -s crew-studio-cursor-api-key -a \"$USER\" -w); CURSOR_API_KEY in Studio's environment is used only when no keychain item or key file is found";
  return { ok: false, error: failed.length ? `no Cursor API key for rounds works (${failed.join("; ")}); ${hint}` : `no Cursor API key for rounds: ${hint}` };
}

/** The shape of a codex API key (never printed). */
export const CODEX_KEY_SHAPE = /^sk-[A-Za-z0-9_-]{20,}$/;
/** The captain's own codex home: CODEX_HOME when the captain's environment sets one, else ~/.codex. */
export const codexAccountHome = () => process.env.CODEX_HOME?.trim() || join(home(), ".codex");
/** The login a codex round gets: CODEX_API_KEY in a private auth.json of the round's own `codexHome`; else the captain's own
 *  codex home, whose sign-in the codex CLI reads and refreshes itself. Studio checks only that its auth.json exists as a plain
 *  file and never reads what it holds. */
export function codexLogin(codexHome: string): Login {
  const failed: string[] = [];
  if (process.env.CODEX_API_KEY !== undefined && !process.env.CODEX_API_KEY.trim()) failed.push("CODEX_API_KEY: it is set but empty");
  const k = process.env.CODEX_API_KEY?.trim();
  if (k && CODEX_KEY_SHAPE.test(k)) {
    mkdirSync(codexHome, { recursive: true, mode: 0o700 });
    const path = join(codexHome, "auth.json");
    writeFileSync(path, JSON.stringify({ auth_mode: "api_key", OPENAI_API_KEY: seen(k) }), { mode: 0o600 });
    chmodSync(path, 0o600);
    return { ok: true, env: { CODEX_HOME: codexHome }, source: "CODEX_API_KEY in Studio's environment", warn: null, kind: "api-key" };
  }
  if (k) failed.push("CODEX_API_KEY: it is not an OpenAI API key (expected sk-…)");
  const own = codexAccountHome(), file = join(own, "auth.json");
  let plain = false; try { plain = lstatSync(file).isFile(); } catch {}
  if (plain) return { ok: true, env: { CODEX_HOME: own }, source: "your own codex sign-in (the codex CLI reads it itself; Studio never reads it)", warn: failed.length ? `tried first and failed: ${failed.join("; ")}` : null, kind: "account" };
  const hint = "sign in to codex once (codex login), or set CODEX_API_KEY";
  return { ok: false, error: failed.length ? `no codex login for rounds works (${failed.join("; ")}; ${file} is missing): ${hint}` : `no codex login (${file} is missing): ${hint}` };
}
