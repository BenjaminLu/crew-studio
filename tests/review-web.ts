import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The review room's web tools (src/review-web.ts; docs/units/review-room.md): which queries and addresses Studio refuses,
// and the fetcher's own guards (resolved address, redirects, no search configured). No real network: the lookup, the
// proxy lease and fetch are stubs.        bun tests/review-web.ts
import { illustrationRefusal, leak, proxiedWeb, queryRefusal, urlRefusal, type WebContext } from "../src/review-web";
let pass = 0, fail = 0;
const ok = (c: boolean, name: string, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const ctx: WebContext = {
  diff: "+export function priceWithTax(amount_cents: number) {\n+  return Math.round(amount_cents * TAX_RATE_2026) / 100;\n+}\n",
  paths: ["src/billing/tax-table.ts", "README.md", "test/tax.test.ts"], names: ["acme-org/ledger-kit", "acme-org", "ledger-kit"], denylist: ["Contoso Holdings"] };
const refused = (q: string, re: RegExp) => { const why = queryRefusal(q, ctx); ok(!!why && re.test(why), `refused: ${q}`, String(why)); };
refused("how does priceWithTax handle rounding", /identifier from this change/);
refused("amount_cents rounding", /identifier from this change/);
refused("return Math.round(amount_cents * TAX_RATE", /identifier|line of this change/);
refused("what is in src/billing/tax-table.ts", /file of this repository/);
refused("tax-table.ts conventions", /file of this repository/);
refused("ledger-kit release notes", /repository, its owner or its project/);
refused("acme-org engineering blog", /repository, its owner or its project/);
refused("Contoso Holdings tax policy", /denylisted/);
refused("status of build.corp", /private host/);
refused("is 10.1.2.3 reachable", /private address/);
refused(`open ${"/" + "Users"}/someone/notes`, /home path/); // built at run time: no home path in a tracked file
refused("const x = () => { return 1; }", /looks like code/);
refused("token ghp_abcdefghijklmnopqrstuvwxyz0123456789", /credential/);
refused("two\nlines", /one line/);
refused("", /empty/);
for (const q of ["JavaScript Math.round rounding of halves", "IEEE 754 banker's rounding", "how does HTTP 304 revalidation work"]) ok(queryRefusal(q, ctx) === null, `allowed: ${q}`, String(queryRefusal(q, ctx)));
const urlRefused = (u: string, re: RegExp) => { const why = urlRefusal(u, ctx); ok(!!why && re.test(why), `refused address: ${u}`, String(why)); };
urlRefused("http://127.0.0.1/", /by number/); urlRefused("http://[::1]/", /by number/); urlRefused("http://169.254.169.254/latest/meta-data", /by number/);
urlRefused("http://localhost:4210/api", /private host/); urlRefused("https://studio.localhost/", /private host/); urlRefused("https://nas.lan/", /private host/); urlRefused("https://box.tailnet.ts.net/", /private host/);
urlRefused("file:///etc/passwd", /only http/); urlRefused("https://user:pw@example.com/", /credentials/); urlRefused("https://example.com:8443/", /standard ports/);
urlRefused("https://example.com/search?q=priceWithTax", /identifier from this change/); urlRefused("https://github.com/acme-org/ledger-kit/pull/3", /repository/);
ok(urlRefusal("https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/round", ctx) === null, "allowed address: a public documentation page");
ok(leak("plain words", ctx) === null, "plain words carry nothing");
ok(/identifier from this change/.test(String(illustrationRefusal("a sketch of priceWithTax", ctx))) && /file of this repository/.test(String(illustrationRefusal("boxes for src/billing/tax-table.ts", ctx))) && /looks like code/.test(String(illustrationRefusal("draw x => y;", ctx))) && illustrationRefusal("a value flowing through a rounding step into whole cents, drawn as three boxes", ctx) === null, "an illustration prompt gets the same filter as a web query: plain words only");

// ---------- the fetcher: resolved-address guard, every redirect hop checked, no search configured ----------
const check = (u: string) => urlRefusal(u, ctx);
const leases: string[][] = [];
const web = (lookup: any, searchUrl: string | null = null) => proxiedWeb(() => null, { check, lookup, searchUrl, lease: async (hosts) => { leases.push(hosts); return { url: "http://round:x@127.0.0.1:9", close() {} }; } });
const realFetch = globalThis.fetch; const sent: any[] = [];
globalThis.fetch = (async (u: any, i: any) => { sent.push([String(u), i?.proxy, i?.redirect]);
  if (String(u).includes("redirect")) return new Response("", { status: 302, headers: { location: "http://localhost/admin" } });
  return new Response("<html><script>x()</script><p>Hello &amp; welcome</p></html>", { status: 200, headers: { "content-type": "text/html" } }); }) as any;
try {
  let e = ""; try { await web(async () => ({ refused: "public.example resolved to a loopback address" })).fetch("https://public.example/"); } catch (x: any) { e = x.message; }
  ok(/refused: .*loopback/.test(e) && !sent.length, "a public name that resolves to loopback is refused before any request", e);
  const page = await web(async () => ({ address: "93.184.216.34", family: 4 })).fetch("https://public.example/doc");
  ok(page.text === "Hello & welcome" && sent[0][1] === "http://round:x@127.0.0.1:9" && sent[0][2] === "manual" && JSON.stringify(leases.at(-1)) === '["public.example"]', "a page is fetched through a one-host proxy lease, redirects handled by Studio, scripts and tags stripped", JSON.stringify(sent));
  e = ""; try { await web(async () => ({ address: "93.184.216.34", family: 4 })).fetch("https://public.example/redirect"); } catch (x: any) { e = x.message; }
  ok(/refused: a private host/.test(e) && !sent.some((s) => s[0].startsWith("http://localhost")), "a redirect to a private host is refused at its hop and never requested", e);
  const none = await web(async () => ({ address: "93.184.216.34", family: 4 })).search("rounding");
  ok(none.configured === false && /not set/.test(none.error), "without a configured search endpoint the tool says so plainly");
  const found = await web(async () => ({ address: "93.184.216.34", family: 4 }), "https://search.example/?q={q}").search("half rounding");
  ok(found.configured === true && sent.at(-1)[0] === "https://search.example/?q=half%20rounding", "a configured search goes to its endpoint with the query encoded", JSON.stringify(sent.at(-1)));
} finally { globalThis.fetch = realFetch; }
console.log(`\nreview-web: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
