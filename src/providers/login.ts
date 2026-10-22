// A round's vendor login (the captain's credential model, firstmate v1's "option A"
// with T-117/T-126; ported from ~/Desktop/firstmate-workflow/bin/lib/fm_registry.py
// VENDORS and bin/lib/fm_sandbox_policy.py keychain_read/file_read/without_refresh):
// Studio, outside the sandbox, reads the vendor's own login and hands the round only
// that: an access token in the round's env, or a copy of a login file without its
// refresh token in the round's own home. A round reaches no keychain, no other
// credential, no GitHub token.
//
// claude, in order:
//   1. CLAUDE_CODE_OAUTH_TOKEN already in Studio's environment, as is;
//      with API billing chosen (CREW_CLAUDE_BILLING=api-key, or data/claude-billing.json, where
//      Studio moved the earlier keychain/API-key switch), ANTHROPIC_API_KEY or the key store's key;
//   2. the crew's own long-lived token (`claude setup-token`), kept for Studio once:
//      a keychain item of Studio's own (service crew-studio-claude-token, account $USER),
//      else a file only the captain can read (~/.config/crew-studio/claude-token, mode 600);
//   3. else the access token of the captain's own interactive login (keychain item
//      "Claude Code-credentials", field claudeAiOauth.accessToken; off macOS
//      ~/.claude/.credentials.json), with a warning: it dies when that login refreshes.
//   handed in as CLAUDE_CODE_OAUTH_TOKEN (or ANTHROPIC_API_KEY), each checked for its shape first
//   (sk-ant-oat<nn>-… / sk-ant-api<nn>-…; a mismatch is that source failing, and no character of
//   the value is ever logged or shown). An error at one source (a keychain
//   prompt denied, an empty item, an expired login) moves on to the next; the round is refused only
//   when every source fails, and the refusal lists why each one did.
// codex: CODEX_API_KEY is materialized in the private auth.json; else a copy of ~/.codex/auth.json
//   with its refresh token dropped, in the round's CODEX_HOME (refused if a refresh
//   token remains).
// One resolver serves both a round (it reads the token) and the Doctor (it probes: variables
// by name, keychain items by existence without decrypting them, files by reading them, which
// asks no one). A keychain item's content only decrypting can tell (empty, unreadable, an
// expired own login): the Doctor says so ("present, but its content is checked when a round
// starts") and, once a round has tried it, shows that round's outcome (data/login-outcomes.json).
//   CREW_KEYCHAIN_TOOL   the security(1) to read the keychain with (tests point it at a stand-in)
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { registerSecretValues, scrubEnv } from "../secure";
import { keptKeys } from "../keys";

/** Which kind of credential a login is, for code to decide on (the source text is for people). */
export type LoginKind = "env-oauth" | "api-key" | "crew" | "own-login" | "codex";
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
/** The last outcome of each login source a round tried (data/login-outcomes.json): the Doctor, which never decrypts a keychain
 *  item, shows a keychain source's last failure instead of calling an item that merely exists OK. Only names and errors, never a value. */
let outcomeFile: string | null = null;
export function setLoginOutcomeFile(f: string | null) { outcomeFile = f; }
type Outcome = { ok: boolean; error?: string; at: string };
function outcomes(): Record<string, Outcome> { try { return outcomeFile ? JSON.parse(readFileSync(outcomeFile, "utf8")) : {}; } catch { return {}; } }
function remember(source: string, o: Omit<Outcome, "at">) {
  if (!outcomeFile) return;
  try { const all = outcomes(); all[source] = { ...o, at: new Date().toISOString() }; writeFileSync(outcomeFile, JSON.stringify(all, null, 1), { mode: 0o600 }); } catch {}
}
/** The captain's home: HOME as it is now (a process may set it), else the system's. */
const home = () => process.env.HOME || homedir();
const user = () => { try { return userInfo().username; } catch { return process.env.USER ?? ""; } };

/** The shape of a claude credential, checked before a round starts (never printed: no prefix, no suffix of the value):
 *  an OAuth token (`claude setup-token`, or a login's access token) is sk-ant-oat<nn>-…; an API key is sk-ant-api<nn>-…. */
export const CLAUDE_OAUTH_SHAPE = /^sk-ant-oat\d{2}-[A-Za-z0-9_-]{40,}$/;
export const CLAUDE_API_KEY_SHAPE = /^sk-ant-api\d{2}-[A-Za-z0-9_-]{20,}$/;
const NOT_SETUP_TOKEN = "crew token is not a claude setup-token result (expected sk-ant-oat01-…)";
// verified: false only for a keychain item the Doctor saw by existence and no round has signed in with yet
type Resolved = { ok: true; env: Record<string, string>; source: string; warn: string | null; verified?: boolean; kind: LoginKind } | { ok: false; error: string };
const CREW_HINT = "make a crew token once (claude setup-token) and keep it in the keychain (security add-generic-password -s crew-studio-claude-token -a \"$USER\" -w) or in ~/.config/crew-studio/claude-token (mode 600)";
/** claude's login, in v1's order; `probe` reads no keychain secret (the Doctor), and its env values are empty. */
function resolveClaude(probe: boolean, record = true, remembered = true, has: (service: string, account: string) => boolean = keychainHas): Resolved {
  const env = process.env; const val = (v: string) => (probe ? "" : seen(v));
  const early: string[] = [];
  if (env.CLAUDE_CODE_OAUTH_TOKEN?.trim()) {
    if (CLAUDE_OAUTH_SHAPE.test(env.CLAUDE_CODE_OAUTH_TOKEN.trim())) return { ok: true, env: { CLAUDE_CODE_OAUTH_TOKEN: val(env.CLAUDE_CODE_OAUTH_TOKEN.trim()) }, source: "CLAUDE_CODE_OAUTH_TOKEN in Studio's environment", warn: null, kind: "env-oauth" };
    early.push("CLAUDE_CODE_OAUTH_TOKEN in Studio's environment: it is not a claude OAuth token (expected sk-ant-oat01-…)");
  }
  if (claudeBilling() === "api-key") {
    // two sources in order, Studio's environment then the key Studio keeps; a shape failure moves on, both failing refuses with both reasons
    const why: string[] = [];
    for (const [name, k] of [["ANTHROPIC_API_KEY in Studio's environment", env.ANTHROPIC_API_KEY?.trim()], ["the Anthropic key Studio keeps (Doctor → API keys)", keptKeys().anthropic?.trim()]] as const) {
      if (!k) continue;
      if (CLAUDE_API_KEY_SHAPE.test(k)) return { ok: true, env: { ANTHROPIC_API_KEY: val(k) }, source: "an Anthropic API key (API billing)", warn: why.length ? `tried first and failed: ${why.join("; ")}` : null, kind: "api-key" };
      why.push(`${name}: it is not an Anthropic API key (expected sk-ant-api03-…)`);
    }
    return { ok: false, error: why.length ? `API billing is chosen and no Anthropic API key works (${why.join("; ")})` : "API billing is chosen and Studio has no Anthropic API key (ANTHROPIC_API_KEY, or Doctor → API keys)" };
  }
  // each source in order; an error at one (a keychain prompt denied, an empty item, an unreadable file, an expired login) moves on
  // to the next, and only when every source fails is the round refused, with why each one failed (v1's fm_sandbox_policy order)
  type Src = { name: string; get: () => Resolved | { ok: false; error: string } | null };
  const ok = (v: string, source: string, warn: string | null = null, kind: LoginKind = "crew"): Resolved => ({ ok: true, env: { CLAUDE_CODE_OAUTH_TOKEN: val(v) }, source, warn, kind });
  const WARN = "it stops working when your own login refreshes; a crew token (claude setup-token) does not";
  const fromJSON = (raw: string, name: string): Resolved => {
    let tok = "", exp = 0; try { const j = JSON.parse(raw); tok = String(j?.claudeAiOauth?.accessToken ?? ""); exp = Number(j?.claudeAiOauth?.expiresAt ?? 0); } catch {}
    if (!tok) return { ok: false, error: `${name} holds no access token` };
    if (exp && exp < Date.now()) return { ok: false, error: `${name}'s access token has expired; start claude once outside a round to refresh it` };
    if (!CLAUDE_OAUTH_SHAPE.test(tok)) return { ok: false, error: `${name}'s access token is not a claude OAuth token (expected sk-ant-oat01-…)` };
    return ok(tok, "your own claude login's access token", WARN, "own-login"); };
  const crewTok = (v: string, source: string): Resolved => (CLAUDE_OAUTH_SHAPE.test(v) ? ok(v, source) : { ok: false, error: NOT_SETUP_TOKEN });
  const keychain = keychainOn();
  const sources: Src[] = [
    { name: "keychain item crew-studio-claude-token", get: () => {
      if (!keychain) return null;
      if (probe) { if (!has("crew-studio-claude-token", user())) return null; const last = remembered ? outcomes()["keychain item crew-studio-claude-token"] : undefined;
        if (last && !last.ok) return { ok: false, error: `${last.error} (the last round, ${last.at})` };
        return { ...ok("", "the crew's token (keychain item crew-studio-claude-token)", last?.ok ? null : "crew keychain item present, but its content is checked when a round starts (the Doctor does not decrypt it)"), verified: !!last?.ok }; }
      const r = keychainRead("crew-studio-claude-token", user()); return r.found ? crewTok(r.found, "the crew's token (keychain item crew-studio-claude-token)") : r.error ? { ok: false, error: r.error } : null; } },
    { name: "~/.config/crew-studio/claude-token", get: () => {
      const r = privateFile(join(home(), ".config", "crew-studio", "claude-token")); return r.found ? crewTok(r.found, "the crew's token (~/.config/crew-studio/claude-token)") : r.error ? { ok: false, error: r.error } : null; } },
    { name: "your own claude login (keychain item Claude Code-credentials)", get: () => {
      if (!keychain) return null;
      if (probe) { if (!has("Claude Code-credentials", user())) return null; const last = remembered ? outcomes()["your own claude login (keychain item Claude Code-credentials)"] : undefined;
        if (last && !last.ok) return { ok: false, error: `${last.error} (the last round, ${last.at})` };
        return { ...ok("", "your own claude login's access token", last?.ok ? WARN : `${WARN}; its expiry is checked when a round starts (the Doctor does not decrypt it)`, "own-login"), verified: !!last?.ok }; }
      const r = keychainRead("Claude Code-credentials", user()); return r.found ? fromJSON(r.found, "your claude login") : r.error ? { ok: false, error: r.error } : null; } },
    { name: "your own claude login (~/.claude/.credentials.json)", get: () => {
      if (keychain) return null; // where there is a keychain, the login lives there
      const r = privateFile(join(home(), ".claude", ".credentials.json")); return r.found ? fromJSON(r.found, "your claude login") : r.error ? { ok: false, error: r.error } : null; } },
  ];
  const failed: string[] = [...early];
  for (const s of sources) {
    const r = s.get(); if (!r) continue;
    if (!probe && record) remember(s.name, r.ok ? { ok: true } : { ok: false, error: r.error });
    if (r.ok) return failed.length ? { ...r, warn: [r.warn, `tried first and failed: ${failed.join("; ")}`].filter(Boolean).join("; ") } : r;
    failed.push(`${s.name}: ${r.error}`);
  }
  return { ok: false, error: failed.length ? `no claude login for rounds works (${failed.join("; ")}); ${CREW_HINT}` : `no claude login for rounds: ${CREW_HINT}` };
}
/** The login a claude round gets (read when it starts). */
export function claudeLogin(options: { record?: boolean } = {}): Login { return resolveClaude(false, options.record !== false); }
/** Which login a start would try first, by presence only (no decrypt) and ignoring earlier outcomes: a fixed item can be tried again. */
export function claudeLoginPresence(): { ok: boolean; kind?: LoginKind } { const r = resolveClaude(true, false, false); return r.ok ? { ok: true, kind: r.kind } : { ok: false }; }
/** The same presence check without blocking: the keychain items' existence is asked with an async `security find-generic-password`
 *  (no -w: no secret is read), then the same resolver runs on those answers. Used by the readiness gate. */
export async function claudeLoginPresenceAsync(): Promise<{ ok: boolean; kind?: LoginKind }> {
  const found = new Map<string, boolean>();
  if (keychainOn()) { const tool = process.env.CREW_KEYCHAIN_TOOL || "/usr/bin/security";
    await Promise.all(["crew-studio-claude-token", "Claude Code-credentials"].map(async (service) => { try { const p = Bun.spawn([tool, "find-generic-password", "-s", service, "-a", user()], { env: scrubEnv(), stdout: "ignore", stderr: "ignore" }); found.set(service, (await p.exited) === 0); } catch { found.set(service, false); } })); }
  const r = resolveClaude(true, false, false, (service) => found.get(service) ?? false); return r.ok ? { ok: true, kind: r.kind } : { ok: false };
}
/** What the Doctor shows: the same resolver, reading no keychain secret. */
export function claudeLoginStatus(): { ok: boolean; verified?: boolean; source?: string; warn?: string | null; error?: string; kind?: LoginKind } {
  const r = resolveClaude(true); return r.ok ? { ok: true, verified: r.verified !== false, source: r.source, warn: r.warn, kind: r.kind } : { ok: false, error: r.error };
}

/** The shape of a Cursor API key (never printed): a user or service-account key, crsr_… or the older key_…. */
export const CURSOR_KEY_SHAPE = /^(crsr|key)_[A-Za-z0-9]{32,}$/;
/** cursor-agent's own sign-in (`agent login`) lives in the macOS keychain, which no round reaches (v1 T-117), so a round signs in
 *  with a Cursor API key only, in order: CURSOR_API_KEY in Studio's environment; the crew's key in a keychain item of Studio's own
 *  (crew-studio-cursor-api-key) or ~/.config/crew-studio/cursor-api-key (mode 600); firstmate v1's item firstmate-cursor-api-key. */
export function cursorLogin(options: { probe?: boolean } = {}): Login {
  const probe = !!options.probe, failed: string[] = [];
  const ok = (v: string, source: string): Login => ({ ok: true, env: { CURSOR_API_KEY: probe ? "" : seen(v) }, source, warn: failed.length ? `tried first and failed: ${failed.join("; ")}` : null, kind: "api-key" });
  const shaped = (v: string, name: string): Login | null => { if (CURSOR_KEY_SHAPE.test(v)) return ok(v, name); failed.push(`${name}: it is not a Cursor API key (expected crsr_…)`); return null; };
  const k = process.env.CURSOR_API_KEY?.trim();
  if (k) { const r = shaped(k, "CURSOR_API_KEY in Studio's environment"); if (r) return r; }
  for (const service of ["crew-studio-cursor-api-key", "firstmate-cursor-api-key"]) {
    if (probe) { if (keychainHas(service, user())) return ok("", `the crew's Cursor API key (keychain item ${service})`); }
    else {
      const r = keychainRead(service, user());
      if (r.found) { const got = shaped(r.found.trim(), `the crew's Cursor API key (keychain item ${service})`); if (got) return got; }
      else if (r.error) failed.push(r.error);
    }
    if (service === "crew-studio-cursor-api-key") {
      const f = privateFile(join(home(), ".config", "crew-studio", "cursor-api-key"));
      if (f.found) { const got = probe ? ok("", "the crew's Cursor API key (~/.config/crew-studio/cursor-api-key)") : shaped(f.found, "the crew's Cursor API key (~/.config/crew-studio/cursor-api-key)"); if (got) return got; }
      else if (f.error) failed.push(f.error);
    }
  }
  const hint = "keep a Cursor API key for the crew once (security add-generic-password -s crew-studio-cursor-api-key -a \"$USER\" -w), or set CURSOR_API_KEY";
  return { ok: false, error: failed.length ? `no Cursor API key for rounds works (${failed.join("; ")}); ${hint}` : `no Cursor API key for rounds: ${hint}` };
}

/** The shape of a codex credential (never printed): an OpenAI API key is sk-…; a login's access token is a JWT. */
export const CODEX_KEY_SHAPE = /^sk-[A-Za-z0-9_-]{20,}$/;
const JWT_SHAPE = /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/;
/** Original nonsecret metadata only: validate without inventing freshness. */
function codexTimestamp(value:unknown):value is string {
  if(typeof value!=="string")return false;
  const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if(!m)return false;
  const [year,month,day,hour,minute,second]=m.slice(1,7).map(Number),leap=year%4===0&&(year%100!==0||year%400===0),days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  return month>=1&&month<=12&&day>=1&&day<=days[month-1]&&hour<24&&minute<60&&second<60&&(!m[7]||Number(m[8])<24&&Number(m[9])<60)&&Number.isFinite(Date.parse(value));
}
/** A copy of codex's login file for the round's CODEX_HOME, without its refresh token; or CODEX_API_KEY in a private auth.json.
 *  Same rule as claude: an error at one source moves on to the next; refused only when every source fails, saying why each did. */
export function codexLogin(codexHome: string): Login {
  const failed: string[] = [];
  if (process.env.CODEX_API_KEY !== undefined && !process.env.CODEX_API_KEY.trim()) failed.push("CODEX_API_KEY: it is set but empty");
  const k = process.env.CODEX_API_KEY?.trim();
  if (k && CODEX_KEY_SHAPE.test(k)) {
    mkdirSync(codexHome, { recursive: true, mode: 0o700 });
    const path = join(codexHome, "auth.json");
    writeFileSync(path, JSON.stringify({ auth_mode: "api_key", OPENAI_API_KEY: seen(k) }), { mode: 0o600 });
    chmodSync(path, 0o600);
    return { ok: true, env: { CODEX_HOME: codexHome }, source: "CODEX_API_KEY in Studio's environment", warn: null };
  }
  if (k) failed.push("CODEX_API_KEY: it is not an OpenAI API key (expected sk-…)");
  const p = join(process.env.CODEX_HOME || join(home(), ".codex"), "auth.json");
  const file = ((): Login | null => {
    if (!existsSync(p)) return null;
    let doc: any; try { doc = JSON.parse(readFileSync(p, "utf8")); } catch { return { ok: false, error: `${p} does not read as JSON` }; }
    if (doc?.tokens && typeof doc.tokens === "object") delete doc.tokens.refresh_token;
    const left = JSON.stringify(doc); if (/refresh_?token/i.test(left)) return { ok: false, error: `${p} still holds a refresh token Studio does not drop; nothing is handed to the round` };
    const at = doc?.tokens?.access_token, ak = doc?.OPENAI_API_KEY;
    if (typeof at === "string" && at && !JWT_SHAPE.test(at)) return { ok: false, error: `its access token is not a codex login token (expected a JWT)` };
    if (typeof ak === "string" && ak && !CODEX_KEY_SHAPE.test(ak)) return { ok: false, error: `its OPENAI_API_KEY is not an OpenAI API key (expected sk-…)` };
    if (!(typeof at === "string" && at) && !(typeof ak === "string" && ak)) return { ok: false, error: "it holds no access token and no API key" };
    for (const v of [at, doc?.tokens?.id_token, ak]) if (typeof v === "string" && v) seen(v);
    if(typeof at==="string"&&at&&doc.last_refresh!==undefined&&!codexTimestamp(doc.last_refresh))return {ok:false,error:"its last_refresh metadata is not a supported original RFC3339 timestamp"};
    const handedDoc: any = {};
    if (["chatgpt", "api_key"].includes(doc.auth_mode)) handedDoc.auth_mode = doc.auth_mode;
    if (typeof ak === "string" && ak) handedDoc.OPENAI_API_KEY = ak;
    if (typeof at === "string" && at) { // Installed CLI requires the schema key; an empty string provides no refresh credential.
      if(doc.last_refresh!==undefined)handedDoc.last_refresh=doc.last_refresh;
      handedDoc.tokens = { access_token: at, refresh_token: "" }; if (typeof doc.tokens.id_token === "string") handedDoc.tokens.id_token = doc.tokens.id_token; if (typeof doc.tokens.account_id === "string") handedDoc.tokens.account_id = doc.tokens.account_id; }
    mkdirSync(codexHome, { recursive: true }); writeFileSync(join(codexHome, "auth.json"), JSON.stringify(handedDoc), { mode: 0o600 });
    return { ok: true, env: { CODEX_HOME: codexHome }, source: "a copy of your codex login, without its refresh token", warn: null };
  })();
  if (file?.ok) return file;
  if (file) failed.push(`${p}: ${file.error}`);
  return { ok: false, error: failed.length ? `no codex login for rounds works (${failed.join("; ")}): sign in to codex once outside a round, or set CODEX_API_KEY` : `no codex login (${p}): sign in to codex once outside a round, or set CODEX_API_KEY` };
}
