// The review room's web tools (docs/units/review-room.md): web_search and web_fetch, served by Studio, never the round's
// own network. The tutor's round has no egress beyond its model; these run in Studio's process. A query or an address is
// refused when it carries what must not leave Studio: code from the change or the tree (a code-like identifier, a long
// line, code punctuation), a repository path or file name, the repository, owner, project or folder name, a private host,
// a home path, a session link, a denylisted name or anything that looks like a credential. A fetch goes to an http(s)
// host by name on its standard port, through Studio's egress proxy with a one-host credential, so the resolved-address
// guard (src/egress-guard.ts) refuses loopback, private, link-local and metadata addresses, redirects included.
// Search needs a configured endpoint (CREW_REVIEW_SEARCH_URL, a URL with {q}); without one the tool says so plainly.
import { isIP } from "node:net";
import { denial, guardedLookup, isLoopbackName } from "./egress-guard";
import { openScopedProxy, type ProxyAuthority } from "./egress-client";
import { redactText } from "./secure";

export type WebContext = { diff: string; paths: string[]; names: string[]; denylist: string[] };
export type WebResult = { status: number; type: string; url: string; text: string };
export type WebBackend = { search(q: string, signal?: AbortSignal): Promise<any>; fetch(url: string, signal?: AbortSignal): Promise<WebResult> };

const PRIVATE_TLD = /\.(local|lan|internal|intranet|corp|home|localdomain|home\.arpa|ts\.net|private|test|invalid)$/i;
const HOSTNAME = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,30}\b/gi;
const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;
const codeLike = (t: string) => /[_$]|\d|[a-z][A-Z]/.test(t);
const flat = (s: string) => s.replace(/\s+/g, " ").toLowerCase();

/** What in a text must not leave Studio (null when nothing): the shared rule of queries and addresses. */
export function leak(text: string, c: WebContext): string | null {
  const t = String(text ?? ""), low = t.toLowerCase();
  if (redactText(t) !== t) return "it looks like it carries a credential";
  if (/\/Users\/[A-Za-z0-9._-]+|\/home\/[a-z0-9._-]+\/|~\/|-Users-[A-Za-z0-9]+-/.test(t)) return "it names a home path";
  if (/claude\.ai\/code\/session/i.test(t)) return "it carries a session link";
  for (const d of c.denylist) if (d && low.includes(d.toLowerCase())) return "it names a denylisted name";
  for (const n of c.names) if (n && n.length >= 3 && new RegExp(`(^|[^a-z0-9])${n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`).test(low)) return "it names this repository, its owner or its project";
  for (const h of t.match(HOSTNAME) ?? []) if (PRIVATE_TLD.test(h) || isLoopbackName(h)) return "it names a private host";
  if (/\blocalhost\b/i.test(t)) return "it names a private host";
  for (const ip of t.match(IPV4) ?? []) if (isIP(ip) && denial(ip, ip)) return "it names a private address";
  // a path of the tree, or a file name of it (with its extension)
  for (const p of c.paths) { const base = p.split("/").at(-1)!; if ((p.includes("/") && low.includes(p.toLowerCase())) || (base.length >= 5 && /\.[a-z0-9]{1,6}$/i.test(base) && new RegExp(`(^|[^a-z0-9_.-])${base.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9_-])`).test(low))) return "it names a file of this repository"; }
  // a code-like identifier that the change or the tree carries
  const corpus = c.diff + "\n" + c.paths.join("\n");
  for (const w of t.match(/[A-Za-z_$][A-Za-z0-9_$]{5,}/g) ?? []) if (codeLike(w) && new RegExp(`(^|[^A-Za-z0-9_$])${w.replace(/\$/g, "\\$")}($|[^A-Za-z0-9_$])`).test(corpus)) return `it carries an identifier from this change (${w.slice(0, 40)})`;
  // a long stretch of a line of the change
  const f = flat(t), d = flat(c.diff);
  for (let i = 0; i + 24 <= f.length; i += 4) if (d.includes(f.slice(i, i + 24))) return "it carries a line of this change";
  return null;
}
/** Why a search query is refused, or null. */
export function queryRefusal(q: unknown, c: WebContext): string | null {
  const t = typeof q === "string" ? q.trim() : "";
  if (!t) return "the query is empty";
  if (t.length > 200 || /[\r\n]/.test(t)) return "a query is one line of at most 200 characters";
  if (/[{};`]|=>|::|\(\)|\[\]|<\/?[a-z]/i.test(t)) return "it looks like code; ask in general words";
  return leak(t, c);
}
/** Why an illustration prompt is refused, or null: the image model gets the same filter as a web query (no code, no
 *  paths, no repository, owner or project names, no private hosts), in a few sentences of plain words. */
export function illustrationRefusal(p: unknown, c: WebContext): string | null {
  const t = typeof p === "string" ? p.trim() : "";
  if (!t) return "the prompt is empty";
  if (t.length > 600) return "a prompt is at most 600 characters of plain words";
  if (/[{};`]|=>|::|\(\)|\[\]|<\/?[a-z]/i.test(t)) return "it looks like code; describe the idea in general words";
  return leak(t, c);
}
/** Why an address is refused, or null: http(s), a public host by name, its standard port, no credentials, no leak. */
export function urlRefusal(raw: unknown, c: WebContext): string | null {
  let u: URL; try { u = new URL(String(raw ?? "")); } catch { return "not an address"; }
  if (!/^https?:$/.test(u.protocol)) return "only http and https addresses";
  if (u.username || u.password) return "an address with credentials";
  const host = u.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (isIP(host)) return "an address by number (public hosts by name only)";
  if (!host.includes(".") || isLoopbackName(host) || PRIVATE_TLD.test(host)) return "a private host";
  if (u.port && !["80", "443"].includes(u.port)) return "only the standard ports";
  let rest = u.pathname + u.search; try { rest = decodeURIComponent(rest); } catch {}
  const why = leak(`${host} ${rest.slice(0, 2000)}`, c); return why ? `the address ${why.replace(/^it /, "")}` : null;
}

const strip = (html: string) => html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
const BODY_CAP = 500_000, TEXT_CAP = 20_000;
/** Studio's own fetcher: each hop is checked (check), resolved through the guard and sent through the egress proxy. */
export function proxiedWeb(egress: () => ProxyAuthority | null, o: { searchUrl?: string | null; check: (url: string) => string | null; lookup?: typeof guardedLookup;
  /** tests only: the one-host proxy lease (production: openScopedProxy on Studio's egress proxy) */
  lease?: (hosts: string[]) => Promise<{ url: string; close(): void }> }): WebBackend {
  const get = async (start: string, signal?: AbortSignal): Promise<WebResult> => {
    let url = start;
    for (let hop = 0; hop < 4; hop++) {
      const why = o.check(url); if (why) throw new Error(`refused: ${why}`);
      const host = new URL(url).hostname, dns = await (o.lookup ?? guardedLookup)(host);
      if ("refused" in dns) throw new Error(`refused: ${dns.refused}`); if ("unresolved" in dns) throw new Error(dns.unresolved);
      const e = o.lease ? null : egress(); if (!o.lease && !e) throw new Error("Studio's egress proxy is not running, so the web is not reachable");
      const lease = o.lease ? await o.lease([host]) : await openScopedProxy(e!, [host]);
      try {
        const r = await fetch(url, { proxy: lease.url, redirect: "manual", signal: signal ?? AbortSignal.timeout(20_000), headers: { "user-agent": "CrewStudio-ReviewRoom", accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.1" } } as any);
        if (r.status >= 300 && r.status < 400 && r.headers.get("location")) { url = new URL(r.headers.get("location")!, url).toString(); continue; }
        const buf = Buffer.from(await r.arrayBuffer()).subarray(0, BODY_CAP), type = r.headers.get("content-type") ?? "";
        if (buf.includes(0)) return { status: r.status, type, url, text: "(a binary file; not shown)" };
        const s = buf.toString("utf8"); return { status: r.status, type, url, text: (/html/i.test(type) ? strip(s) : s).slice(0, TEXT_CAP) };
      } finally { lease.close(); }
    }
    throw new Error("too many redirects");
  };
  return {
    fetch: get,
    async search(q, signal) {
      const tpl = o.searchUrl ?? process.env.CREW_REVIEW_SEARCH_URL ?? "";
      if (!tpl || !tpl.includes("{q}")) return { configured: false, error: "No web search is configured in this Studio (CREW_REVIEW_SEARCH_URL is not set). The room works offline; answer from the code and its history." };
      const r = await get(tpl.replace("{q}", encodeURIComponent(q)), signal);
      return { configured: true, status: r.status, url: r.url, text: r.text };
    },
  };
}
