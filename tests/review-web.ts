import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The review room's web tools (src/review-web.ts; docs/units/review-room.md): which queries and addresses Studio refuses,
// every known way around the filter (split or spaced identifiers, names without separators, lookalike and fullwidth
// letters, encoded words, double encoding, one-letter path segments, data in host names), the destination rule (this
// turn's search results or a documentation host), and the fetcher's own guards (no DNS lookup before the checks, the
// resolved address, redirects on the same host, no search configured). Illustrations take concepts from a fixed list.
// No real network: the lookup, the proxy lease and fetch are stubs.        bun tests/review-web.ts
import { DOCS_HOSTS, ILLUSTRATION_CONCEPTS, illustrationPrompt, leak, proxiedWeb, queryRefusal, resultUrls, urlRefusal, type WebContext } from "../src/review-web";
let pass = 0, fail = 0;
const ok = (c: boolean, name: string, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const ctx: WebContext = {
  diff: "+export function priceWithTax(amount_cents: number) {\n+  return Math.round(amount_cents * TAX_RATE_2026) / 100;\n+}\n",
  paths: ["src/billing/tax-table.ts", "README.md", "test/tax.test.ts"], names: ["acme-org/ledger-kit", "acme-org", "ledger-kit", "nyx"], denylist: ["Contoso Holdings"] };
const refused = (q: string, re: RegExp, name = q) => { const why = queryRefusal(q, ctx); ok(!!why && re.test(why), `refused: ${name}`, String(why)); };
// what the change carries
refused("how does priceWithTax handle rounding", /identifier or file of this change|encoded data/);
refused("price with tax rounding", /identifier or file of this change/, "an identifier split into words");
refused("PRICEWITHTAX", /identifier or file of this change/, "an identifier in capitals");
refused("amount cents rounding rules", /identifier or file of this change/, "a snake_case identifier as words");
refused("tax table conventions", /identifier or file of this change/, "a file name as words");
refused("return Math.round amount cents", /identifier|stretch of this change/);
// names, with or without separators
refused("ledger-kit release notes", /repository, its owner or its project/);
refused("ledgerkit release notes", /repository, its owner or its project/, "a repository name without its separator");
refused("ledger kit release notes", /repository, its owner or its project/, "a repository name split in two");
refused("acme org engineering blog", /repository, its owner or its project/);
refused("nyx service outage", /repository, its owner or its project/, "a short name as a whole word");
ok(queryRefusal("onyx gemstone", ctx) === null, "a short name inside another word is not a hit");
refused("Contoso Holdings tax policy", /denylisted/);
refused("contosoholdings", /denylisted/, "a denylisted name without its space");
// spellings that dodge plain matching
refused("p r i c e w i t h t a x", /letter by letter/, "spaced letters");
refused("lеdger kit", /plain ASCII/, "a Cyrillic lookalike letter");
refused("ｌｅｄｇｅｒｋｉｔ news", /repository, its owner or its project/, "fullwidth letters (folded by NFKC, then matched)");
refused("cHJpY2VXaXRoVGF4 meaning", /encoded data/, "a base64 word");
refused("deadbeefcafe1234 meaning", /encoded data/, "a hex word");
refused("rounding рolicy", /plain ASCII/, "mixed scripts");
// what is not words at all
refused("status of build.corp", /private host/); refused("is 10.1.2.3 reachable", /private address/);
refused("open /home/you/notes", /only words/); refused("const x = () => { return 1; }", /only words/);
refused("token ghp_abcdefghijklmnopqrstuvwxyz0123456789", /only words|encoded|credential/);
refused("two\nlines", /one line/); refused("", /empty/);
refused("one two three four five six seven eight nine ten eleven twelve thirteen", /at most 12 words/);
for (const q of ["JavaScript Math.round rounding of halves", "IEEE 754 banker's rounding", "how does HTTP 304 revalidation work", "PostgreSQL numeric rounding"]) ok(queryRefusal(q, ctx) === null, `allowed: ${q}`, String(queryRefusal(q, ctx)));

// addresses: the shape first, then the destination
const allowed = { urls: new Set(resultUrls('results: "https://example.org/rounding-guide?utm=x" and https://blog.example.net/posts/half-up.')), hosts: new Set(DOCS_HOSTS) };
const urlRefused = (u: string, re: RegExp, name = u) => { const why = urlRefusal(u, ctx, allowed); ok(!!why && re.test(why), `refused address: ${name}`, String(why)); };
urlRefused("http://127.0.0.1/", /by number/); urlRefused("http://[::1]/", /by number/); urlRefused("http://169.254.169.254/latest/meta-data", /by number/);
urlRefused("http://localhost:4210/api", /private host/); urlRefused("https://studio.localhost/", /private host/); urlRefused("https://nas.lan/", /private host/); urlRefused("https://box.tailnet.ts.net/", /private host/);
urlRefused("javascript:alert(document.cookie)", /only http/); urlRefused("file:///etc/passwd", /only http/); urlRefused("https://user:pw@example.org/", /credentials/); urlRefused("https://example.org:8443/", /standard ports/);
urlRefused("https://developer.mozilla.org/search?q=price", /no query string/);
urlRefused("https://developer.mozilla.org/en-US/%2570rice", /encoded more than once/, "double URL-encoding");
urlRefused("https://developer.mozilla.org/p/r/i/c/e", /letter by letter|does not look like a document/, "one-letter path segments");
urlRefused("https://cHJpY2VXaXRo.example.org/", /does not look like a public site/, "data in a host label");
urlRefused("https://pricewithtax.example.org/", /identifier or file of this change|does not look like a public site/, "an identifier as a host label");
urlRefused("https://xn--80ak6aa92e.com/", /does not look like a public site/, "a punycode host");
urlRefused("https://developer.mozilla.org/en-US/docs/price-with-tax", /identifier or file of this change/, "an identifier in a docs path");
urlRefused("https://github.com/acme-org/ledger-kit/pull/3", /repository/);
urlRefused("https://example.com/page", /search results or a documentation host/, "a host that is neither a search result nor documentation");
ok(urlRefusal("https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/round", ctx, allowed) === null, "allowed: a page on a documentation host");
ok(urlRefusal("https://example.org/rounding-guide", ctx, allowed) === null && urlRefusal("https://blog.example.net/posts/half-up", ctx, allowed) === null && /search results/.test(String(urlRefusal("https://example.org/other-page", ctx, allowed))), "allowed: exactly the pages this turn's search returned, nothing else on their hosts");
ok(leak("plain words", ctx) === null, "plain words carry nothing");

// illustrations: concepts from the fixed list only
ok("refused" in illustrationPrompt({ concepts: ["priceWithTax"] }) && "refused" in illustrationPrompt({ concepts: ["a sketch of src/billing/tax-table.ts"] }) && "refused" in illustrationPrompt({ concepts: [] }) && "refused" in illustrationPrompt({ concepts: ["number"], layout: "free text" }),
  "an illustration takes no free text: a concept outside the list, an empty list or an unknown layout is refused");
const built = illustrationPrompt({ concepts: ["number", "rounding", "whole number"], layout: "flow" });
ok("prompt" in built && built.prompt === "a left-to-right flow showing: number, rounding, whole number" && ILLUSTRATION_CONCEPTS.every((k) => /^[a-z ]+$/.test(k)), "the image prompt is built only from listed concepts and a layout", JSON.stringify(built));

// ---------- the fetcher: no lookup before the checks, the resolved-address guard, same-host redirects, no search configured ----------
const leases: string[][] = [], lookups: string[] = [];
const check = (u: string) => urlRefusal(u, ctx, { urls: new Set(), hosts: new Set(["public.example", "docs.example"]) });
const web = (resolve: any, searchUrl: string | null = null) => proxiedWeb(() => null, { check, searchUrl, lookup: async (h: string) => { lookups.push(h); return resolve(h); }, lease: async (hosts) => { leases.push(hosts); return { url: "http://round:x@127.0.0.1:9", close() {} }; } });
const pub = () => ({ address: "93.184.216.34", family: 4 });
const realFetch = globalThis.fetch; const sent: any[] = [];
globalThis.fetch = (async (u: any, i: any) => { sent.push([String(u), i?.proxy, i?.redirect]);
  if (String(u).includes("redirect-away")) return new Response("", { status: 302, headers: { location: "https://other.example/x" } });
  if (String(u).includes("redirect-here")) return new Response("", { status: 302, headers: { location: "/doc" } });
  return new Response("<html><script>x()</script><p>Hello &amp; welcome</p></html>", { status: 200, headers: { "content-type": "text/html" } }); }) as any;
try {
  let e = ""; try { await web(pub).fetch("https://cHJpY2VXaXRo.public.example/"); } catch (x: any) { e = x.message; }
  ok(/refused/.test(e) && !lookups.length && !sent.length, "an encoded host label is refused before any DNS lookup", e);
  e = ""; try { await web(() => ({ refused: "public.example resolved to a loopback address" })).fetch("https://public.example/"); } catch (x: any) { e = x.message; }
  ok(/refused: .*loopback/.test(e) && !sent.length, "a public name that resolves to loopback is refused before any request", e);
  const page = await web(pub).fetch("https://public.example/doc");
  ok(page.text === "Hello & welcome" && sent.at(-1)[1] === "http://round:x@127.0.0.1:9" && sent.at(-1)[2] === "manual" && JSON.stringify(leases.at(-1)) === '["public.example"]', "a page is fetched through a one-host proxy lease, redirects handled by Studio, scripts and tags stripped", JSON.stringify(sent));
  e = ""; try { await web(pub).fetch("https://public.example/redirect-away"); } catch (x: any) { e = x.message; }
  ok(/refused: a redirect to another host/.test(e) && !sent.some((s) => s[0].startsWith("https://other.example")), "a redirect to another host is refused at its hop and never requested", e);
  const here = await web(pub).fetch("https://public.example/redirect-here");
  ok(here.url === "https://public.example/doc", "a redirect on the same host is followed");
  const none = await web(pub).search("rounding");
  ok(none.configured === false && /not set/.test(none.error), "without a configured search endpoint the tool says so plainly");
  const found = await web(pub, "https://search.example/?q={q}").search("half rounding");
  ok(found.configured === true && sent.at(-1)[0] === "https://search.example/?q=half%20rounding", "a configured search goes to its endpoint with the query encoded", JSON.stringify(sent.at(-1)));
  e = ""; try { await web(pub, "http://127.0.0.1:8888/search?q={q}").search("half rounding"); } catch (x: any) { e = x.message; }
  ok(/a local search server is refused/.test(e), "a search endpoint on this machine or the LAN is refused (documented)", e);
} finally { globalThis.fetch = realFetch; }
console.log(`\nreview-web: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
