// The review room's web tools (docs/units/review-room.md): web_search and web_fetch, served by Studio, never the round's
// own network. The tutor's round has no egress beyond its model; these run in Studio's process.
// The boundary is the destination and the shape, not a guess at what is secret:
// - a query is plain words: after NFKC it is ASCII letters, digits and a little punctuation (so no confusable, fullwidth or
//   mixed-script spelling), at most twelve words of human shape (no encoded-looking word, no run of single letters), and
//   it carries none of the change's identifiers, file names, repository / owner / project / folder names or denylisted
//   names, compared with every separator stripped and the case folded, nor a stretch of the diff;
// - a page is fetched only when its address came back in this turn's search results, or its host is a documentation host
//   (a short built-in list plus policy review_room.docs_hosts); http(s), by host name, on its standard port, with no
//   query string, no credentials, short human-looking path segments and host labels, nothing left percent-encoded after
//   one decode. All of it is decided before any DNS lookup. Redirects stay on the same host. A turn makes at most a few calls.
// - the image model gets no free text at all: an illustration is built from a fixed vocabulary of concepts.
// A fetch goes through Studio's egress proxy with a one-host credential, so the resolved-address guard
// (src/egress-guard.ts) refuses loopback, private, link-local and metadata addresses. Search needs a configured endpoint
// (CREW_REVIEW_SEARCH_URL, a URL with {q}, on a public host); without one the tool says so plainly.
import { isIP } from "node:net";
import { denial, guardedLookup, isLoopbackName } from "./egress-guard";
import { openScopedProxy, type ProxyAuthority } from "./egress-client";
import { redactText } from "./secure";

export type WebContext = { diff: string; paths: string[]; names: string[]; denylist: string[] };
export type WebResult = { status: number; type: string; url: string; text: string };
export type WebBackend = { search(q: string, signal?: AbortSignal): Promise<any>; fetch(url: string, signal?: AbortSignal): Promise<WebResult> };

/** web calls (searches and pages together) one turn may make */
export const WEB_CALLS_PER_TURN = 8;
/** documentation hosts a page may come from without having been a search result (policy review_room.docs_hosts adds more) */
export const DOCS_HOSTS = ["developer.mozilla.org", "docs.python.org", "nodejs.org", "bun.sh", "www.typescriptlang.org", "react.dev", "www.rfc-editor.org", "datatracker.ietf.org", "en.wikipedia.org", "html.spec.whatwg.org", "tc39.es", "docs.github.com", "git-scm.com", "www.postgresql.org", "sqlite.org"];
const PRIVATE_TLD = /\.(local|lan|internal|intranet|corp|home|localdomain|home\.arpa|ts\.net|private|test|invalid|onion)$/i;
const comp = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
/** a word that reads like encoded data: hex, or letters and digits or cases switching back and forth */
export const encodedLooking = (w: string) => {
  if (/^[0-9a-f]{8,}$/i.test(w) && /\d/.test(w)) return true;
  const caseFlips = (w.match(/(?=[a-z][A-Z])/g) ?? []).length, digitFlips = (w.match(/(?=[A-Za-z]\d|\d[A-Za-z])/g) ?? []).length;
  if (caseFlips >= 2 || digitFlips >= 2) return true;
  if (w.length >= 10 && /\d/.test(w) && /[A-Za-z]/.test(w)) return true;
  if (/[bcdfghjklmnpqrstvwxz]{6,}/i.test(w)) return true;
  if (/[A-Za-z0-9]{24,}/.test(w)) return true;
  return false;
};
/** the change's identifiers and file stems, compressed (lower case, no separators): what a query may not spell out */
function corpusOf(c: WebContext): string[] {
  const out = new Set<string>();
  for (const t of c.diff.match(/[A-Za-z_$][A-Za-z0-9_$]{5,}/g) ?? []) if (/[_$\d]|[a-z][A-Z]/.test(t)) { const k = comp(t); if (k.length >= 8) out.add(k); }
  for (const p of c.paths) { const stem = (p.split("/").at(-1) ?? "").replace(/\.[^.]+$/, ""), k = comp(stem); if (k.length >= 6) out.add(k); }
  return [...out];
}
const memo = new WeakMap<WebContext, { corpus: string[]; diff: string }>();
const memoOf = (c: WebContext) => { let m = memo.get(c); if (!m) memo.set(c, (m = { corpus: corpusOf(c), diff: comp(c.diff) })); return m; };
/** names compared with separators stripped: a long one anywhere, a short one as one word or adjacent words joined */
function nameHit(words: string[], all: string, names: string[]): boolean {
  const joins = new Set<string>(); for (let i = 0; i < words.length; i++) { let j = ""; for (let k = i; k < Math.min(words.length, i + 4); k++) { j += words[k]; joins.add(j); } }
  return names.map(comp).filter((n) => n.length >= 3).some((n) => n.length >= 5 ? all.includes(n) : joins.has(n));
}
/** What in a plain-words text must not leave Studio (null when nothing). The text is already NFKC and ASCII. */
export function leak(text: string, c: WebContext): string | null {
  const t = String(text ?? ""), words = t.split(/[^A-Za-z0-9]+/).filter(Boolean), cw = words.map(comp), all = comp(t);
  if (redactText(t) !== t) return "it looks like it carries a credential";
  if (nameHit(cw, all, c.denylist)) return "it names a denylisted name";
  if (nameHit(cw, all, c.names)) return "it names this repository, its owner or its project";
  for (const h of t.match(/\b(?:[a-z0-9-]+\.)+[a-z][a-z0-9-]+\b/gi) ?? []) if (PRIVATE_TLD.test(h) || isLoopbackName(h)) return "it names a private host";
  if (/\blocalhost\b/i.test(t)) return "it names a private host";
  for (const ip of t.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? []) if (isIP(ip) && denial(ip, ip)) return "it names a private address";
  const m = memoOf(c);
  const hit = m.corpus.find((k) => all.includes(k)); if (hit) return "it spells out an identifier or file of this change";
  for (let i = 0; i + 20 <= all.length; i += 3) if (m.diff.includes(all.slice(i, i + 20))) return "it carries a stretch of this change";
  return null;
}
/** plain words: NFKC, then ASCII only (no confusables, no fullwidth, no mixed scripts), human-shaped */
function plainWords(raw: string, max: number, maxWords: number): { text: string } | { refused: string } {
  const t = String(raw ?? "").normalize("NFKC").trim();
  if (!t) return { refused: "it is empty" };
  if (t.length > max || /[\r\n]/.test(t)) return { refused: `one line of at most ${max} characters` };
  if (/[^\x20-\x7e]/.test(t)) return { refused: "only plain ASCII words (no other scripts, lookalike letters or symbols)" };
  if (/[^A-Za-z0-9 .,'?+-]/.test(t)) return { refused: "only words: no code, paths, addresses or symbols" };
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length > maxWords) return { refused: `at most ${maxWords} words` };
  const bare = words.map((w) => w.replace(/^[.,'?+-]+|[.,'?+-]+$/g, "")).filter(Boolean);
  if (bare.some((w) => w.length > 24)) return { refused: "a word is too long to be a word" };
  if (bare.some(encodedLooking)) return { refused: "a word looks like encoded data" };
  let singles = 0; for (const w of bare) { singles = w.length === 1 ? singles + 1 : 0; if (singles >= 4) return { refused: "it spells something out letter by letter" }; }
  return { text: t };
}
/** Why a search query is refused, or null. */
export function queryRefusal(q: unknown, c: WebContext): string | null {
  const p = plainWords(String(q ?? ""), 160, 12); if ("refused" in p) return p.refused;
  return leak(p.text, c);
}
const LABEL_OK = (l: string) => /^[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])?$/.test(l) && !l.startsWith("xn--") && !encodedLooking(l);
const SEGMENT_OK = (s: string) => /^[A-Za-z0-9._~-]{1,48}$/.test(s) && s.split(/[._~-]+/).filter(Boolean).every((w) => !encodedLooking(w));
/** Why an address is refused by its shape and content, or null (before any DNS lookup). allowed: the hosts or exact
 *  addresses this turn may reach (its search results, the documentation hosts). */
export function urlRefusal(raw: unknown, c: WebContext, allowed?: { urls: Set<string>; hosts: Set<string> }): string | null {
  const t = String(raw ?? "").normalize("NFKC");
  if (/[^\x21-\x7e]/.test(t)) return "only a plain ASCII address";
  let u: URL; try { u = new URL(t); } catch { return "not an address"; }
  if (!/^https?:$/.test(u.protocol)) return "only http and https addresses";
  if (u.username || u.password) return "an address with credentials";
  const host = u.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (isIP(host)) return "an address by number (public hosts by name only)";
  if (!host.includes(".") || isLoopbackName(host) || PRIVATE_TLD.test(host)) return "a private host";
  if (u.port && !["80", "443"].includes(u.port)) return "only the standard ports";
  if (u.search || t.includes("?")) return "no query string (a page address only)";
  const labels = host.split("."); if (labels.length > 5 || !labels.every(LABEL_OK)) return "a host name that does not look like a public site";
  let path = u.pathname; try { path = decodeURIComponent(path); } catch { return "a malformed address"; }
  if (path.includes("%")) return "an address encoded more than once";
  const segs = path.split("/").filter(Boolean); if (segs.length > 8 || !segs.every(SEGMENT_OK)) return "a page path that does not look like a document";
  if (segs.filter((x) => x.length === 1).length >= 3) return "a path that spells something out letter by letter";
  const why = leak(`${labels.join(" ")} ${segs.join(" ")}`, c); if (why) return `the address ${why.replace(/^it /, "")}`;
  if (allowed) { const norm = `${u.protocol}//${host}${u.pathname}`; if (!allowed.urls.has(norm) && !allowed.hosts.has(host)) return "only a page from this turn's search results or a documentation host"; }
  return null;
}
/** the http(s) addresses in a search result, normalised as urlRefusal compares them (query strings and fragments dropped) */
export function resultUrls(text: string): string[] {
  const out = new Set<string>();
  for (const m of String(text ?? "").match(/https?:\/\/[^\s"'<>\\)\]]+/g) ?? []) { try { const u = new URL(m.replace(/[.,;:]+$/, "")); out.add(`${u.protocol}//${u.hostname.toLowerCase()}${u.pathname}`); } catch {} if (out.size >= 50) break; }
  return [...out];
}

// ---------- illustrations: a fixed vocabulary, never free text ----------
/** the concepts an illustration may show; the tutor picks from these only */
export const ILLUSTRATION_CONCEPTS = ["request", "response", "client", "server", "browser", "page", "screen", "button", "form", "input", "output", "user", "person", "team", "file", "folder", "database", "table", "row", "cache", "queue", "message", "event", "timer", "clock", "counter", "limit", "number", "number line", "money", "coin", "price", "total", "percent", "rounding", "half", "whole number", "decimal", "list", "item", "filter", "sort", "split", "merge", "copy", "move", "delete", "add", "change", "before", "after", "old", "new", "check", "test", "error", "warning", "retry", "timeout", "lock", "key", "door", "gate", "wall", "sandbox", "network", "cloud", "card", "approval", "review", "build", "step", "loop", "branch", "choice", "yes", "no", "state", "flow", "arrow", "layer", "boundary", "inside", "outside", "safe", "unsafe", "fast", "slow"] as const;
export const ILLUSTRATION_LAYOUTS = { flow: "a left-to-right flow", "before-after": "a before and after side by side", layers: "stacked layers", cycle: "a cycle", comparison: "two things compared" } as const;
/** The image prompt built from chosen concepts and a layout, or why the choice is refused. */
export function illustrationPrompt(a: { concepts?: unknown; layout?: unknown }): { prompt: string } | { refused: string } {
  const cs = Array.isArray(a?.concepts) ? a.concepts.map((x) => String(x)) : [];
  if (!cs.length || cs.length > 6) return { refused: "pick 1 to 6 concepts from the list" };
  const bad = cs.filter((x) => !(ILLUSTRATION_CONCEPTS as readonly string[]).includes(x)); if (bad.length) return { refused: `not in the concept list: ${bad.slice(0, 3).join(", ")}` };
  const layout = String(a?.layout ?? "flow"); if (!Object.hasOwn(ILLUSTRATION_LAYOUTS, layout)) return { refused: `layout is one of ${Object.keys(ILLUSTRATION_LAYOUTS).join(", ")}` };
  return { prompt: `${ILLUSTRATION_LAYOUTS[layout as keyof typeof ILLUSTRATION_LAYOUTS]} showing: ${[...new Set(cs)].join(", ")}` };
}

const strip = (html: string) => html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
const BODY_CAP = 500_000, TEXT_CAP = 20_000;
/** Studio's own fetcher: each hop is checked (check, before DNS), resolved through the guard and sent through the egress
 *  proxy; a redirect stays on the host it started from. The search endpoint is the captain's setting, so only its host is
 *  checked (public, by name). */
export function proxiedWeb(egress: () => ProxyAuthority | null, o: { searchUrl?: string | null; check: (url: string) => string | null; lookup?: typeof guardedLookup;
  /** tests only: the one-host proxy lease (production: openScopedProxy on Studio's egress proxy) */
  lease?: (hosts: string[]) => Promise<{ url: string; close(): void }> }): WebBackend {
  const get = async (start: string, signal: AbortSignal | undefined, first: (url: string) => string | null): Promise<WebResult> => {
    let url = start; const origin = new URL(start).hostname.toLowerCase();
    for (let hop = 0; hop < 4; hop++) {
      const why = hop ? (new URL(url).hostname.toLowerCase() !== origin ? "a redirect to another host" : null) ?? first(url) : first(url); if (why) throw new Error(`refused: ${why}`);
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
  const searchHost = (u: string) => { try { const x = new URL(u), h = x.hostname.toLowerCase(); return !/^https?:$/.test(x.protocol) || x.username || x.password ? "the search endpoint must be a plain http(s) address" : isIP(h) || !h.includes(".") || isLoopbackName(h) || PRIVATE_TLD.test(h) ? "the search endpoint must be a public host by name (a local search server is refused)" : null; } catch { return "the search endpoint is not an address"; } };
  return {
    fetch: (u, signal) => get(u, signal, o.check),
    async search(q, signal) {
      const tpl = o.searchUrl ?? process.env.CREW_REVIEW_SEARCH_URL ?? "";
      if (!tpl || !tpl.includes("{q}")) return { configured: false, error: "No web search is configured in this Studio (CREW_REVIEW_SEARCH_URL is not set). The room works offline; answer from the code and its history." };
      const r = await get(tpl.replace("{q}", encodeURIComponent(q)), signal, searchHost);
      return { configured: true, status: r.status, url: r.url, text: r.text };
    },
  };
}
