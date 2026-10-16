// Whether a FRESH Firstmate primary may start on Claude, and with what. Every "no" is typed
// and final for that request: Studio never falls back to Codex.
//   signed in   the official read-only `claude auth status` of the ordinary account (the Claude account card)
//   quota       a quota refusal Studio has seen and not yet seen reset
//   crew token  the session signs in with the crew's long-lived token (or the captain's chosen API key),
//               never the access token of the captain's interactive login, which dies when that login refreshes
// The session runs in Studio's own Claude config folder, so the captain's ~/.claude settings, hooks,
// plugins and MCP servers never load into it and its transcript stays apart from terminal sessions.
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Login, LoginKind } from "../providers/login";
import type { ClaudeCapability, ClaudePair } from "../providers/claude-native";
import { validClaudePair } from "../providers/claude-native";
import type { HostRefusalCode } from "./types";

export type ClaudePermissionMode = "auto" | "default";
/** The captain's own auto-mode rules, as Studio found them: applied (copied into the primary's settings), none, or malformed (skipped). */
export type CaptainAutoMode = ({ state: "applied"; block: Record<string, unknown> } | { state: "none" } | { state: "malformed" }) & { summary: string; summaryZh: string };
export type ClaudePrimaryReady =
  | { ok: true; env: Record<string, string>; model: string; effort: string | null; source: string; permissionMode: ClaudePermissionMode; autoMode: { state: CaptainAutoMode["state"]; summary: string; summaryZh: string } }
  | { ok: false; code: HostRefusalCode; reason: string; en: string; zh: string };

const no = (code: HostRefusalCode, en: string, zh: string): ClaudePrimaryReady => ({ ok: false, code, reason: `${en} / ${zh}`, en, zh });
/** The credentials a Claude primary may run on: the crew token, an explicit OAuth token in Studio's environment, or the captain's chosen API key. */
const PRIMARY_KINDS: LoginKind[] = ["crew", "env-oauth", "api-key"];

/** The fresh primary's Claude permission mode. Auto by default: Claude's classifier approves or denies tool calls, and whatever
 *  it escalates still goes to Studio's permission bridge. Only the operator picks another, through CREW_CLAUDE_PERMISSION_MODE
 *  in the environment or .env (never a model or an API body): "default" or "auto"; anything else is refused, never guessed. */
export function claudePermissionMode(raw: string | undefined): { ok: true; mode: ClaudePermissionMode } | { ok: false; en: string; zh: string } {
  const v = (raw ?? "").trim();
  if (v === "") return { ok: true, mode: "auto" };
  if (v === "auto" || v === "default") return { ok: true, mode: v };
  const shown = JSON.stringify(v.slice(0, 40));
  return { ok: false, en: `CREW_CLAUDE_PERMISSION_MODE=${shown} is not a Claude Firstmate permission mode; use default or auto, then restart Studio.`, zh: `CREW_CLAUDE_PERMISSION_MODE=${shown} 不是 Claude Firstmate 的權限模式；請改成 default 或 auto，再重新啟動 Studio。` };
}

/** The captain's Claude settings file: $CLAUDE_CONFIG_DIR/settings.json when the captain's environment sets it, else ~/.claude/settings.json. */
export const captainSettingsFile = () => join(process.env.CLAUDE_CONFIG_DIR || join(process.env.HOME || homedir(), ".claude"), "settings.json");
const AUTO_LISTS = ["environment", "allow", "soft_deny", "hard_deny"];
/** Reads ONLY the `autoMode` block of the captain's settings and checks its shape: string lists for environment, allow,
 *  soft_deny and hard_deny, a boolean classifyAllShell, nothing else. Every other key in that file is never read out. */
export function captainAutoMode(file = captainSettingsFile()): CaptainAutoMode {
  const bad = (why: string, whyZh: string): CaptainAutoMode => ({ state: "malformed", summary: `malformed (${why}); using Claude's built-in defaults`, summaryZh: `格式錯誤（${whyZh}）；改用 Claude 內建預設` });
  const none = (why: string, whyZh: string): CaptainAutoMode => ({ state: "none", summary: `none (${why}); using Claude's built-in defaults`, summaryZh: `沒有（${whyZh}）；使用 Claude 內建預設` });
  if (!existsSync(file)) return none("no captain settings file", "沒有船長的設定檔");
  let settings: any;
  try { if (statSync(file).size > 1024 * 1024) return bad("settings file over 1 MB", "設定檔超過 1 MB"); settings = JSON.parse(readFileSync(file, "utf8")); } catch { return bad("settings file is not readable JSON", "設定檔不是可讀的 JSON"); }
  const block = settings?.autoMode;
  if (block === undefined) return none("no autoMode block", "沒有 autoMode 區塊");
  if (!block || typeof block !== "object" || Array.isArray(block)) return bad("autoMode is not an object", "autoMode 不是物件");
  const counts: string[] = [];
  for (const [k, v] of Object.entries(block)) {
    if (k === "classifyAllShell") { if (typeof v !== "boolean") return bad("classifyAllShell is not true or false", "classifyAllShell 不是 true 或 false"); counts.push(`classifyAllShell ${v}`); continue; }
    if (!AUTO_LISTS.includes(k)) return bad(`unknown key ${JSON.stringify(k.slice(0, 40))}`, `不認得的鍵 ${JSON.stringify(k.slice(0, 40))}`);
    if (!Array.isArray(v) || v.length > 500 || !v.every((x) => typeof x === "string" && x.length <= 8000)) return bad(`${k} is not a list of text rules`, `${k} 不是文字規則清單`);
    counts.push(`${k} ${v.length}`);
  }
  return { state: "applied", block: JSON.parse(JSON.stringify(block)), summary: `applied (${counts.join(", ") || "empty block"})`, summaryZh: `已套用（${counts.join("、") || "空區塊"}）` };
}
/** Studio owns the primary's user-scope settings file: it holds the captain's autoMode block when one is applied, and nothing else. */
function writePrimarySettings(configDir: string, am: CaptainAutoMode) {
  // a fresh random temp name opened with O_EXCL ("wx"): never follows a planted symlink; rename replaces settings.json itself, link or not
  const file = join(configDir, "settings.json"), tmp = `${file}.${randomBytes(12).toString("hex")}.tmp`;
  const fd = openSync(tmp, "wx", 0o600);
  try { writeSync(fd, JSON.stringify(am.state === "applied" ? { autoMode: am.block } : {})); } catch (e) { closeSync(fd); rmSync(tmp, { force: true }); throw e; }
  closeSync(fd); renameSync(tmp, file); try { chmodSync(file, 0o600); } catch {}
}

/** `dry`: the preflight the cards use to enable Start and Switch. It reads the crew login by existence only (`probe`, no
 *  keychain decrypt), creates no Claude config folder and returns no environment. Its sign-in status read (`status`) does
 *  run `claude auth status` in a temporary folder and may record a refusal. An existing but empty or malformed crew item
 *  passes here; Start and the server-side Switch decide with the full read. */
export async function claudePrimaryReadiness(o: { pair: ClaudePair; status: () => Promise<ClaudeCapability>; login: () => Login; probe?: () => { ok: boolean; kind?: LoginKind }; configDir: string; signInPending: boolean; dry?: boolean; permissionMode?: string; captainSettings?: string }): Promise<ClaudePrimaryReady> {
  const pm = claudePermissionMode(o.permissionMode);
  if (!pm.ok) return no("claudeUnavailable", pm.en, pm.zh);
  const am = captainAutoMode(o.captainSettings);
  const autoMode = { state: am.state, summary: am.summary, summaryZh: am.summaryZh };
  if (o.signInPending) return no("claudeSignInPending", "Finish or cancel the Claude sign-in first.", "請先完成或取消 Claude 登入。");
  if (!validClaudePair(o.pair)) return no("claudeUnavailable", `The configured Claude model ${o.pair.model} is not supported here; Studio picks no substitute.`, `設定的 Claude 模型 ${o.pair.model} 不支援；Studio 不會改用其他模型。`);
  let st: ClaudeCapability;
  try { st = await o.status(); } catch { return no("claudeUnavailable", "Claude sign-in status could not be read. Check again.", "無法讀取 Claude 登入狀態，請重新檢查。"); }
  if (st.quota === "exhausted" || st.refusal === "exhausted")
    return no("claudeQuotaExhausted", "Claude is signed in, but its quota is exhausted. Wait for the reset; signing in again will not help. Studio does not switch to Codex.", "Claude 已登入，但額度已耗盡。請等待重設，重新登入沒有幫助。Studio 不會改用 Codex。");
  if (!st.available) return no("claudeUnavailable", "The Claude CLI is not available to Studio.", "Studio 找不到可用的 Claude CLI。");
  if (st.loginState !== "logged-in") // what the Claude account card shows as signed in
    return no("claudeNotSignedIn", "Sign in to Claude on this card first. Studio does not switch to Codex.", "請先在這張卡片登入 Claude。Studio 不會改用 Codex。");
  const crewMissing = () => no("claudeCrewTokenMissing", "Firstmate on Claude signs in with the crew token, and none is set up. Run `claude setup-token` once and keep it in the keychain item crew-studio-claude-token (Doctor shows how).", "Claude 上的 Firstmate 使用 crew token 登入，但尚未設定。請執行一次 `claude setup-token`，並存進鑰匙圈項目 crew-studio-claude-token（Doctor 有說明）。");
  if (o.dry) {
    let p: { ok: boolean; kind?: LoginKind } = { ok: false };
    try { p = o.probe ? o.probe() : { ok: false }; } catch {}
    return p.ok && p.kind && PRIMARY_KINDS.includes(p.kind) ? { ok: true, model: o.pair.model, effort: o.pair.effort, source: "", env: {}, permissionMode: pm.mode, autoMode } : crewMissing();
  }
  let login: Login;
  try { login = o.login(); } catch { login = { ok: false, error: "unreadable" }; }
  if (!login.ok || !login.kind || !PRIMARY_KINDS.includes(login.kind)) return crewMissing();
  mkdirSync(o.configDir, { recursive: true, mode: 0o700 }); try { chmodSync(o.configDir, 0o700); } catch {}
  writePrimarySettings(o.configDir, am);
  return { ok: true, model: o.pair.model, effort: o.pair.effort, source: login.source, permissionMode: pm.mode, autoMode,
    env: { CLAUDE_CONFIG_DIR: o.configDir, DISABLE_AUTOUPDATER: "1", ...(o.pair.effort ? { CLAUDE_CODE_EFFORT_LEVEL: o.pair.effort } : {}), ...login.env } };
}
