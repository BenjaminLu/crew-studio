// Whether a FRESH Firstmate primary may start on Claude, and with what. Every "no" is typed
// and final for that request: Studio never falls back to Codex.
//   signed in   the official read-only `claude auth status` of the ordinary account (the Claude account card)
//   quota       a quota refusal Studio has seen and not yet seen reset
//   crew token  the session signs in with the crew's long-lived token (or the captain's chosen API key),
//               never the access token of the captain's interactive login, which dies when that login refreshes
// The session runs in Studio's own Claude config folder, so the captain's ~/.claude settings, hooks,
// plugins and MCP servers never load into it and its transcript stays apart from terminal sessions.
import { chmodSync, mkdirSync } from "node:fs";
import type { Login, LoginKind } from "../providers/login";
import type { ClaudeCapability, ClaudePair } from "../providers/claude-native";
import { validClaudePair } from "../providers/claude-native";
import type { HostRefusalCode } from "./types";

export type ClaudePrimaryReady =
  | { ok: true; env: Record<string, string>; model: string; effort: string | null; source: string }
  | { ok: false; code: HostRefusalCode; reason: string; en: string; zh: string };

const no = (code: HostRefusalCode, en: string, zh: string): ClaudePrimaryReady => ({ ok: false, code, reason: `${en} / ${zh}`, en, zh });
/** The credentials a Claude primary may run on: the crew token, an explicit OAuth token in Studio's environment, or the captain's chosen API key. */
const PRIMARY_KINDS: LoginKind[] = ["crew", "env-oauth", "api-key"];

/** `dry`: the read-only preflight the cards use before Start or Switch: it reads the login by existence only (`probe`, no
 *  keychain decrypt), creates no folder and returns no environment. */
export async function claudePrimaryReadiness(o: { pair: ClaudePair; status: () => Promise<ClaudeCapability>; login: () => Login; probe?: () => { ok: boolean; kind?: LoginKind }; configDir: string; signInPending: boolean; dry?: boolean }): Promise<ClaudePrimaryReady> {
  if (o.signInPending) return no("claudeSignInPending", "Finish or cancel the Claude sign-in first.", "請先完成或取消 Claude 登入。");
  if (!validClaudePair(o.pair)) return no("claudeUnavailable", `The configured Claude model ${o.pair.model} is not supported here; Studio picks no substitute.`, `設定的 Claude 模型 ${o.pair.model} 不支援；Studio 不會改用其他模型。`);
  let st: ClaudeCapability;
  try { st = await o.status(); } catch { return no("claudeUnavailable", "Claude sign-in status could not be read. Check again.", "無法讀取 Claude 登入狀態，請重新檢查。"); }
  if (st.quota === "exhausted" || st.refusal === "exhausted")
    return no("claudeQuotaExhausted", "Claude is signed in, but its quota is exhausted. Wait for the reset; signing in again will not help. Studio does not switch to Codex.", "Claude 已登入，但額度已耗盡。請等待重設，重新登入沒有幫助。Studio 不會改用 Codex。");
  if (!st.available) return no("claudeUnavailable", "The Claude CLI is not available to Studio.", "Studio 找不到可用的 Claude CLI。");
  if (st.loginState !== "logged-in") // what the Claude account card shows as signed in
    return no("claudeNotSignedIn", "Sign in to Claude on the Claude account card first. Studio does not switch to Codex.", "請先在「Claude 帳號」卡片登入 Claude。Studio 不會改用 Codex。");
  const crewMissing = () => no("claudeCrewTokenMissing", "Firstmate on Claude signs in with the crew token, and none is set up. Run `claude setup-token` once and keep it in the keychain item crew-studio-claude-token (Doctor shows how).", "Claude 上的 Firstmate 使用 crew token 登入，但尚未設定。請執行一次 `claude setup-token`，並存進鑰匙圈項目 crew-studio-claude-token（Doctor 有說明）。");
  if (o.dry) {
    let p: { ok: boolean; kind?: LoginKind } = { ok: false };
    try { p = o.probe ? o.probe() : { ok: false }; } catch {}
    return p.ok && p.kind && PRIMARY_KINDS.includes(p.kind) ? { ok: true, model: o.pair.model, effort: o.pair.effort, source: "", env: {} } : crewMissing();
  }
  let login: Login;
  try { login = o.login(); } catch { login = { ok: false, error: "unreadable" }; }
  if (!login.ok || !login.kind || !PRIMARY_KINDS.includes(login.kind)) return crewMissing();
  mkdirSync(o.configDir, { recursive: true, mode: 0o700 }); try { chmodSync(o.configDir, 0o700); } catch {}
  return { ok: true, model: o.pair.model, effort: o.pair.effort, source: login.source,
    env: { CLAUDE_CONFIG_DIR: o.configDir, DISABLE_AUTOUPDATER: "1", ...(o.pair.effort ? { CLAUDE_CODE_EFFORT_LEVEL: o.pair.effort } : {}), ...login.env } };
}
