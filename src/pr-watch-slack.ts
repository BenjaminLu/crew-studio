// Pull requests (docs/units/pr-watch.md "Sending"): the optional Slack bot that checks contacts and sends a DM the captain
// confirmed on a follow-through card. Three Slack Web API methods only: users.info (who a member id is), conversations.open
// (the DM with them) and chat.postMessage (the one message). The token goes in the Authorization header, never in an
// address. Slack's own host only; a loopback test server only under the test environment (CREW_TEST_ENV_ISOLATED).
import type { L } from "./pr-watch-follow";

export const SLACK_API = "https://slack.com/api";
/** Slack's Web API, or a loopback http test server named by CREW_SLACK_API while Studio runs under its tests. */
export function slackApiBase(): string {
  const v = (process.env.CREW_SLACK_API || "").replace(/\/+$/, "");
  if (!v || v === SLACK_API) return SLACK_API;
  if (!process.env.CREW_TEST_ENV_ISOLATED) throw new Error("CREW_SLACK_API is honoured only under Studio's tests");
  let u: URL; try { u = new URL(v); } catch { throw new Error("CREW_SLACK_API is not an address"); }
  if (u.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname) && !u.search && !u.username && !u.password) return v;
  throw new Error("CREW_SLACK_API must be a loopback test server");
}

export class SlackError extends Error { constructor(public code: string) { super(`Slack answered ${code}`); } }
/** One Web API call: GET with a query (users.info), else a JSON POST. Slack's own errors come back as SlackError. */
export async function slackCall(token: string, method: "users.info" | "conversations.open" | "chat.postMessage", args: Record<string, string | boolean>): Promise<any> {
  const base = slackApiBase(), get = method === "users.info";
  const url = `${base}/${method}${get ? `?${new URLSearchParams(Object.entries(args).map(([k, v]) => [k, String(v)]))}` : ""}`;
  let r: Response;
  try { r = await fetch(url, { method: get ? "GET" : "POST", headers: { authorization: `Bearer ${token}`, ...(get ? {} : { "content-type": "application/json; charset=utf-8" }) }, ...(get ? {} : { body: JSON.stringify(args) }), redirect: "manual", signal: AbortSignal.timeout(10_000) }); }
  catch { throw new SlackError("no_answer"); }
  let j: any = null; try { j = await r.json(); } catch {}
  if (!r.ok) throw new SlackError(`http_${r.status}`);
  if (!j || j.ok !== true) throw new SlackError(String(j?.error ?? "not_ok").replace(/[^a-z0-9_]/gi, "").slice(0, 60) || "not_ok");
  return j;
}

const clean = (s: unknown) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80);
/** The name Slack reports for a member, as the card shows it: the real name, then the display name when it differs. */
export function slackName(u: any): string {
  const real = clean(u?.profile?.real_name) || clean(u?.real_name), display = clean(u?.profile?.display_name);
  if (real && display && display !== real) return `${real} (${display})`;
  return real || display || clean(u?.name) || "?";
}
/** users.info's answer for a contact, judged: it fails when it is not that member, in another workspace, deactivated, a
 *  bot, or an external (Slack Connect) account. */
export function slackVerdict(u: any, team: string | null, id: string): { ok: boolean; name: string; problem: L | null } {
  const name = slackName(u), no = (en: string, tw: string) => ({ ok: false, name, problem: { en, tw } });
  if (!u || typeof u !== "object" || u.id !== id) return no("Slack answered for another member", "Slack 回的是另一個成員");
  if (!team) return no("set the Slack workspace id first", "先設定 Slack workspace ID");
  if (u.team_id !== team) return no(`in another Slack workspace (${clean(u.team_id) || "?"}), not ${team}`, `在別的 Slack workspace（${clean(u.team_id) || "?"}），不是 ${team}`);
  if (u.deleted) return no("the Slack account is deactivated", "這個 Slack 帳號已停用");
  if (u.is_bot || u.is_app_user) return no("a bot, not a person", "是 bot，不是人");
  if (u.is_stranger) return no("an external (Slack Connect) account", "是外部（Slack Connect）帳號");
  return { ok: true, name, problem: null };
}
export const slackErrorText = (e: unknown): L => { if (!(e instanceof SlackError) && e instanceof Error) return { en: e.message, tw: e.message };
  const c = e instanceof SlackError ? e.code : "no_answer"; return { en: `Slack answered ${c}`, tw: `Slack 回了 ${c}` }; };
