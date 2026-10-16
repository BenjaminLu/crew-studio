import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// One website link for every place that opens a site in a new tab (acceptance card, Task outputs, Library),
// the /af/ sandbox header by request kind, and a bound site's bytes hashed once per version, not on every read.
// Real M3 + runtime handlers in process; no vendor, model or network call.
//   bun tests/web-open-links.ts
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createM3 } from "../src/m3";
import { createRuntime } from "../src/runtime/index";
import { WorkflowDefs } from "../src/runtime/defs";
import { Agents } from "../src/agent";
import { StudioLog } from "../src/rawlog";
import * as artifacts from "../src/artifacts";

let pass = 0, fail = 0;
// each assertion reports on its own, so a fail-first run lists every one that fails
const ok = (c: unknown, name: string, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const data = mkdtempSync(join(tmpdir(), "crew-web-open-links-"));
const wf = { id: "website-link-fixture", name: "Website link fixture", version: 1, roles: [], nodes: [{ id: "produce", kind: "hook", label: "Pinned website", do: "fixture.output", x: 0, y: 0 }, { id: "accept", kind: "card", label: "Final acceptance", args: { mode: "deliver-accept" }, x: 200, y: 0 }, { id: "closed", kind: "hook", label: "Closed", args: { result: "closed" }, x: 400, y: 100 }, { id: "done", kind: "hook", label: "Approved", x: 400, y: 0 }], edges: [["produce", "accept"], ["accept", "closed", "rejected"], ["accept", "done", "approved"]] };
new WorkflowDefs(data, () => [JSON.stringify(wf)]);
const m3 = createM3({ dataDir: data, fileAllow: [data], studioUrl: () => "http://127.0.0.1:9", provider: () => { throw new Error("No provider calls"); }, send() {}, allowDrive: () => true });
// a site whose entry is not index.html and needs encoding
const src = join(data, "nested-src"); mkdirSync(join(src, "pages"), { recursive: true });
writeFileSync(join(src, "pages", "home page.html"), '<!doctype html><link rel="stylesheet" href="../site.css"><h1>Nested</h1><video src="../film.mp4"></video>');
writeFileSync(join(src, "site.css"), "body{color:red}"); writeFileSync(join(src, "film.mp4"), Buffer.alloc(256 * 1024, 7));
m3.store.create({ id: "nested-site", title: "Nested site", type: "web", source: "html", entry: "index.html" });
const v = m3.store.addVersion("nested-site", { from: src, primary: "pages/home page.html", createdBy: { kind: "captain" } });
const expected = "/af/nested-site/1/pages/home%20page.html";
// and an ordinary index.html site with an MP4, the shape every coffee and deliver site has
const plainSrc = join(data, "plain-src"); mkdirSync(plainSrc, { recursive: true });
writeFileSync(join(plainSrc, "index.html"), '<!doctype html><video src="film.mp4"></video>'); writeFileSync(join(plainSrc, "film.mp4"), Buffer.alloc(512 * 1024, 9));
m3.store.create({ id: "plain-site", title: "Plain site", type: "web", source: "html", entry: "index.html" });
const pv = m3.store.addVersion("plain-site", { from: plainSrc, primary: "index.html", createdBy: { kind: "captain" } });
const runtime = createRuntime({ dataDir: data, agents: new Agents(data, () => ""), provider: () => { throw new Error("No paid model"); }, defaultProvider: () => ({ provider: "stub", model: null }), log: new StudioLog(join(data, "events")), send() {}, fmRoot: data, m3, fileorg: {}, docs: {} } as any);
const E = runtime.engine;
E.actions["fixture.output"] = (x: any) => { const plain = x.run.text === "Plain site"; x.ctx.deliver = { draft: plain ? { id: "plain-site", n: pv.n, sha256: pv.sha256, format: "web", producer: "draft" } : { id: "nested-site", n: v.n, sha256: v.sha256, format: "web", producer: "draft" } }; x.ctx.spec = { done: ["The site opens"] }; return "ok"; };
const until = async (fn: () => boolean) => { for (let i = 0; i < 500; i++) { if (fn()) return true; await Bun.sleep(20); } return false; };
const desktop = { kind: "desktop" };
const get = async (path: string, who: any = desktop, headers: Record<string, string> = {}) => { const req = new Request("http://127.0.0.1" + path, { headers }); const url = new URL(req.url);
  return (await m3.handle(req, url, who, false)) ?? (await runtime.handle(req, url, who, false)); };
try {
  // the shared builder
  const href = (artifacts as any).websiteHref;
  ok(typeof href === "function", "src/artifacts.ts exports one website link builder");
  if (typeof href === "function") {
    ok(href({ id: "a", type: "web", source: "html", entry: "index.html" }, { n: 2, primary: "pages/home page.html" }) === "/af/a/2/pages/home%20page.html", "the builder uses the version's primary and encodes each segment");
    ok(href({ id: "a", type: "web", source: "html", entry: "index.html" }, { n: 2, primary: null }) === "/af/a/2/index.html", "without a primary it falls back to the artifact entry");
    ok([href({ id: "a", type: "web", source: "html", entry: null }, { n: 1, primary: "../x.html" }), href({ id: "a", type: "web", source: "url", entry: null }, { n: 1, primary: "index.html" }), href({ id: "a", type: "video", source: "file", entry: "v.mp4" }, { n: 1, primary: "v.mp4" })].every((x) => x === null), "no link for an unsafe entry, a URL artifact or a non-web artifact");
  }

  // the acceptance card, the Task outputs and the Library all carry the same link
  const task = E.start({ workflow: wf.id, text: "Nested site" });
  await until(() => E.cards.list({ run: task.id, open: true }).length === 1 && !E.busy(task.id));
  const card = E.cards.list({ run: task.id, open: true })[0];
  const cardLink = card?.links?.find((l: any) => l.label === "Open website in new tab")?.href;
  ok(cardLink === expected, "the acceptance card opens the version's own entry, encoded", String(cardLink));
  const view = await (await get(`/api/wruns/${task.id}`))!.json();
  ok(view.outputs?.[0]?.href === expected, "the Task outputs link is the same encoded link", JSON.stringify(view.outputs));
  // the run page refetches after every event: the bound site's files (its MP4 included) are hashed once per version, not per read
  const plain = E.start({ workflow: wf.id, text: "Plain site" });
  await until(() => E.cards.list({ run: plain.id, open: true }).length === 1 && !E.busy(plain.id));
  const verify = m3.store.verify.bind(m3.store); let hashed = 0; (m3.store as any).verify = (id: string, n: number) => { if (id === "plain-site") hashed++; return verify(id, n); };
  const reads = []; for (let i = 0; i < 5; i++) reads.push(await (await get(`/api/wruns/${plain.id}`))!.json());
  (m3.store as any).verify = verify;
  ok(reads.every((r) => r.outputs?.[0]?.href === "/af/plain-site/1/index.html"), "every read still lists the site", JSON.stringify(reads[4].outputs));
  ok(hashed <= 1, "reading the Task five times hashes the bound site's files at most once", `verify ran ${hashed} times`);
  const lib = await (await get("/api/artifacts/nested-site"))!.json();
  ok(lib.versions?.[0]?.openHref === expected, "the Library version carries the same link", String(lib.versions?.[0]?.openHref));

  // a site file changed on disk after the version was cached: the link goes without a restart, and comes back once restored
  const plainFile = join(m3.store.filesDir("plain-site", pv.n), "index.html"); const original = readFileSync(plainFile);
  writeFileSync(plainFile, '<!doctype html><h1>tampered</h1>');
  const tampered = await (await get(`/api/wruns/${plain.id}`))!.json();
  ok(!tampered.outputs?.length, "tampering a bound site's file on disk drops the Task's website link on the next read", JSON.stringify(tampered.outputs));
  const again = await (await get(`/api/wruns/${plain.id}`))!.json();
  ok(!again.outputs?.length, "a damaged site stays hidden on later reads", JSON.stringify(again.outputs));
  const plainLib = await (await get("/api/artifacts/plain-site"))!.json();
  ok(plainLib.versions?.[0]?.integrity?.length && plainLib.versions?.[0]?.openHref == null, "the Library hides openHref for a changed version", JSON.stringify({ integrity: plainLib.versions?.[0]?.integrity, openHref: plainLib.versions?.[0]?.openHref }));
  writeFileSync(plainFile, original);
  const restored = await (await get(`/api/wruns/${plain.id}`))!.json();
  ok(restored.outputs?.[0]?.href === "/af/plain-site/1/index.html", "a false result is not cached: the restored site's link returns without a restart", JSON.stringify(restored.outputs));

  // /af/: a page opened as its own tab is sandboxed; Studio's own frame is not
  const csp = async (dest: string | null) => (await get(`/af/nested-site/1/pages/home%20page.html`, desktop, dest ? { "sec-fetch-dest": dest } : {}))!.headers.get("content-security-policy") ?? "";
  const doc = await csp("document"), frame = await csp("iframe"), none = await csp(null);
  ok(doc.startsWith("sandbox allow-scripts;") && !doc.includes("allow-same-origin") && doc.includes("connect-src 'none'"), "a top-level page gets an opaque-origin sandbox that still blocks network", doc);
  ok(none.startsWith("sandbox allow-scripts;"), "a request without Sec-Fetch-Dest is sandboxed by default", none);
  ok(!frame.includes("sandbox") && frame.includes("frame-ancestors 'self'"), "Studio's preview frame keeps its CSP", frame);
} catch (e: any) { fail++; console.log(`  FAIL  ${e?.stack ?? e}`); }
console.log(`web-open-links: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
