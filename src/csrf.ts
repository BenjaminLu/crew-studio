// The one guard in front of every mutating route (architecture §1.8, §10; legacy A5).
// A non-GET request is accepted only when:
//   it comes from a paired phone (its device token, checked by remote.who), or
//   it carries Studio's session token — the HttpOnly, SameSite=Strict cookie the page
//   receives, or the x-crew-session header a local script reads from
//   data/session-token (0600) — and it is not cross-site: an Origin, when sent, is
//   Studio's own, and Sec-Fetch-Site, when sent, is same-origin or none;
// and its body is JSON (content-type application/json). The agent tool route keeps
// its own per-job token; pairing keeps its pairing code.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";

export const EXEMPT = (p: string) => p === "/api/tools" || p.startsWith("/api/tools/") || p === "/api/remote/pair";
export function sessionToken(dataDir: string): string {
  if (process.env.CREW_SESSION_TOKEN) return process.env.CREW_SESSION_TOKEN;
  const f = join(dataDir, "session-token");
  if (!existsSync(f)) { mkdirSync(dataDir, { recursive: true }); writeFileSync(f, randomBytes(24).toString("hex"), { mode: 0o600 }); }
  return readFileSync(f, "utf8").trim();
}
// Cookies ignore TCP ports. Namespace by the instance's existing random token so
// opening a second local Studio cannot overwrite the first page's session.
// Older unscoped cookies deliberately require reopening the official session link.
export const sessionCookieName = (token: string) => `crew_session_${createHash("sha256").update(token).digest("hex")}`;
export const sessionCookie = (token: string) => `${sessionCookieName(token)}=${token}; Path=/; HttpOnly; SameSite=Strict`;
const cookieOf = (req: Request, token: string) => {
  const name = sessionCookieName(token);
  const matches = (req.headers.get("cookie") ?? "").split(";").map(v => v.trim()).filter(v => v.startsWith(name + "="));
  return matches.length === 1 ? matches[0].slice(name.length + 1) : null;
};
/** The request carries Studio's session (its cookie or x-crew-session). */
export const hasSession = (req: Request, token: string) => cookieOf(req, token) === token || req.headers.get("x-crew-session") === token;
/** The request carries Studio's session cookie (the page's own; a script's x-crew-session header does not count). */
export const hasSessionCookie = (req: Request, token: string) => cookieOf(req, token) === token;
/** null when the request may write; else the refusal. */
export function guardWrite(req: Request, url: URL, token: string, phone: boolean): { status: number; error: string; code: string } | null {
  const origin = req.headers.get("origin"); const sfs = req.headers.get("sec-fetch-site");
  const crossSite = (origin && origin !== url.origin) || (sfs && sfs !== "same-origin" && sfs !== "none");
  if (crossSite) return { status: 403, error: "a request from another site cannot change anything in Studio", code: "crossSite" };
  if (!phone && cookieOf(req, token) !== token && req.headers.get("x-crew-session") !== token) return { status: 403, error: "this request carries no Studio session: open Studio with its session link (`crew-studio open`), or send x-crew-session", code: "session" };
  if (!/^application\/json\b/i.test(req.headers.get("content-type") ?? "")) return { status: 415, error: "send JSON (content-type: application/json)", code: "json" };
  return null;
}
