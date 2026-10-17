import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Website new tab and same-Task continuation through the real src/server.ts (no fixture router):
// the opened site runs in an opaque-origin sandbox (no Studio storage, no same-origin window, no /api),
// its CSS, image, poster and MP4 still load and play, and the continuation routes keep CSRF, session
// and phone refusals. A seed child process writes the closed Tasks and sites into a fresh data folder,
// then the actual server boots on it. No vendor, model or network call.
//   bun tests/web-open-server.mjs        (PLAYWRIGHT_MODULE points at playwright/index.mjs)
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { request as httpRequest } from "node:http";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..");
const media = join(here, "fixture/web-open");

const COFFEE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Harbor Roast</title><link rel="stylesheet" href="site.css"></head>
<body><header><h1>Harbor Roast</h1><p>Small-batch coffee by the pier.</p></header>
<main><figure><img id="beans" src="assets/coffee.png" alt="Roasted beans" width="360" height="240"><figcaption>House blend, roasted this morning</figcaption></figure>
<figure><video id="film" src="assets/coffee.mp4" poster="assets/coffee-poster.png" controls muted loop playsinline preload="auto"></video><figcaption>From bean to cup</figcaption></figure></main>
<script>document.documentElement.dataset.scriptRan = "yes";</script></body></html>`;
const COFFEE_CSS = `body{margin:0;font-family:Georgia,serif;background:rgb(43,29,20);color:rgb(243,229,208)}header{padding:28px 32px}h1{margin:0;font-size:40px}main{display:flex;flex-wrap:wrap;gap:24px;padding:0 32px 32px}figure{margin:0}img,video{display:block;width:360px;max-width:100%;height:auto;border-radius:10px}video{width:480px}`;
// The attack the review proved on the unsandboxed route, kept as a test: everything it can reach lands in data-probe.
const PROBE_HTML = (task) => `<!doctype html><html><head><meta charset="utf-8"><title>Probe</title></head><body><h1>Order coffee</h1><script>
const out = {};
try { out.origin = self.origin; } catch (e) { out.origin = "error"; }
try { out.storage = Object.keys(localStorage).sort().join(",") || "(empty)"; out.token = localStorage.getItem("crew.remoteToken"); } catch (e) { out.storage = "blocked:" + e.name; }
try { out.cookie = document.cookie; } catch (e) { out.cookie = "blocked:" + e.name; }
try { const w = window.open("/", "_blank"); out.popup = w ? "opened" : "blocked"; if (w) { try { out.popupStorage = Object.keys(w.localStorage).join(","); } catch (e) { out.popupStorage = "blocked:" + e.name; } } } catch (e) { out.popup = "blocked:" + e.name; }
out.frame = "none"; addEventListener("message", (e) => { out.frame = String(e.data); });
const f = document.createElement("iframe"); f.src = "evil.html"; document.body.append(f);
const tryFetch = (u, o) => fetch(u, o).then((r) => "status " + r.status, (e) => "blocked:" + e.name);
Promise.all([tryFetch("/api/wruns/${task}"), tryFetch("/api/wruns/${task}/continuation/offer", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })])
  .then(([get, post]) => { out.apiGet = get; out.apiPost = post; setTimeout(() => { try { out.frameDoc = f.contentDocument ? (f.contentDocument.body?.dataset.evil ?? "empty") : "no document"; } catch (e) { out.frameDoc = "blocked:" + e.name; } document.body.dataset.probe = JSON.stringify(out); }, 1500); });
</script></body></html>`;
// R-071: an order form whose own submit handler shows a summary, plus a bare form (no handler) that would post away.
const ORDER_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Order</title></head><body><h1>Order coffee</h1>
<form id="order"><label>Name <input name="name" value="Captain"></label><button type="submit" id="send">Order</button></form><p id="summary" hidden></p>
<form id="bare" action="/api/wruns" method="post"><input name="x" value="1"><button type="submit" id="bareSend">Post</button></form>
<script>document.getElementById("order").addEventListener("submit", (e) => { e.preventDefault(); const s = document.getElementById("summary"); s.textContent = "Summary: " + new FormData(e.target).get("name"); s.hidden = false; });</script></body></html>`;
const EVIL_HTML = `<!doctype html><html><body><script>let r; try { r = "framed-storage:" + Object.keys(localStorage).sort().join(","); } catch (e) { r = "framed-blocked:" + e.name; } try { parent.postMessage(r, "*"); } catch {}
document.body.dataset.evil = JSON.stringify({ origin: self.origin, r });</script></body></html>`;

// ---------- seed (child process): three Tasks and the sites, written by the real engine ----------
if (process.argv[2] === "--seed") {
  const data = process.argv[3];
  const { createM3 } = await import("../src/m3.ts"); const { createRuntime } = await import("../src/runtime/index.ts");
  const { WorkflowDefs } = await import("../src/runtime/defs.ts"); const { Agents } = await import("../src/agent.ts"); const { StudioLog } = await import("../src/rawlog.ts");
  const wf = { id: "website-continuation-fixture", name: "Website captain review", version: 1, roles: [], nodes: [{ id: "produce", kind: "hook", label: "Pinned website", do: "fixture.output", x: 0, y: 0 }, { id: "ready", kind: "check", label: "Readiness", checks: [{ use: "core/artifact-ready", proves: [0] }], args: { producer: "all" }, x: 100, y: 0 }, { id: "accept", kind: "card", label: "Final acceptance", args: { mode: "deliver-accept" }, x: 200, y: 0 }, { id: "closed", kind: "hook", label: "Closed", args: { result: "closed" }, x: 400, y: 100 }, { id: "done", kind: "hook", label: "Approved", x: 400, y: 0 }], edges: [["produce", "ready"], ["ready", "accept", "pass"], ["ready", "accept", "fail"], ["accept", "closed", "rejected"], ["accept", "done", "approved"]] };
  new WorkflowDefs(data, () => [JSON.stringify(wf)]);
  const m3 = createM3({ dataDir: data, fileAllow: [data], studioUrl: () => "http://127.0.0.1:9", provider: () => { throw new Error("No provider calls"); }, send() {}, allowDrive: () => true });
  const site = (id, title, files) => { const dir = join(data, "src-" + id); for (const [p, body] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); typeof body === "string" ? writeFileSync(join(dir, p), body) : copyFileSync(body.copy, join(dir, p)); }
    m3.store.create({ id, title, type: "web", source: "html", entry: "index.html" }); return m3.store.addVersion(id, { from: dir, primary: "index.html", createdBy: { kind: "captain" } }); };
  const coffee = site("coffee-site", "Harbor Roast website", { "index.html": COFFEE_HTML, "site.css": COFFEE_CSS, "assets/coffee.png": { copy: join(media, "coffee.png") }, "assets/coffee.mp4": { copy: join(media, "coffee.mp4") }, "assets/coffee-poster.png": { copy: join(media, "coffee-poster.png") } });
  const runtime = createRuntime({ dataDir: data, agents: new Agents(data, () => ""), provider: () => { throw new Error("No paid model"); }, defaultProvider: () => ({ provider: "stub", model: null }), log: new StudioLog(join(data, "events")), send() {}, fmRoot: data, m3, fileorg: {}, docs: {} });
  const E = runtime.engine;
  E.actions["fixture.output"] = (x) => { x.ctx.deliver = { draft: { id: "coffee-site", n: coffee.n, sha256: coffee.sha256, format: "web", producer: "draft" } }; x.ctx.spec = { done: ["The website fits the captain intent"] }; return "ok"; };
  const wait = async (fn) => { for (let i = 0; i < 500; i++) { if (fn()) return; await Bun.sleep(20); } throw new Error("seed wait timed out"); };
  const openCard = async (id) => { await wait(() => E.cards.list({ run: id, open: true }).length === 1 && !E.busy(id)); return E.cards.list({ run: id, open: true })[0]; };
  const closed = async (text) => { const t = E.start({ workflow: wf.id, text }); const c = await openCard(t.id); await E.answer(c.id, { choice: "reject", by: "captain" }); await wait(() => E.get(t.id).status === "succeeded" && !E.busy(t.id)); return t.id; };
  const closedTask = await closed("Build the Harbor Roast coffee website");
  const waiting = E.start({ workflow: wf.id, text: "A Task still waiting at its acceptance card" }); await openCard(waiting.id);
  const archived = await closed("A closed Task archived before anyone continued it"); E.archive(archived, true, "captain");
  site("probe-site", "Probe website", { "index.html": PROBE_HTML(closedTask), "evil.html": EVIL_HTML, "order.html": ORDER_HTML });
  console.log(JSON.stringify({ closed: closedTask, waiting: waiting.id, archived }));
  process.exit(0);
}

// ---------- the test ----------
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { freePort, waitUp, withSession } = await import("./boot.mjs");
let pass = 0, fail = 0;
// every assertion reports on its own (no throw), so a fail-first run shows each one that fails
const ok = (c, name, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const tmp = mkdtempSync(join(tmpdir(), "crew-web-open-server-")), data = join(tmp, "data"), home = join(tmp, "home"), proj = join(tmp, "proj");
for (const d of [data, home, proj, join(tmp, "fm", "state")]) mkdirSync(d, { recursive: true });
const seeded = spawnSync("bun", [fileURLToPath(import.meta.url), "--seed", data], { cwd: root, encoding: "utf8", timeout: 120000 });
if (seeded.status !== 0) { console.error(seeded.stdout, seeded.stderr); throw new Error("seed failed"); }
const ids = JSON.parse(seeded.stdout.trim().split("\n").at(-1));
const token = "web-open-session-" + Date.now().toString(36);
const port = await freePort();
const env = { ...process.env }; for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CREW_COMPAT_BASE_URL"]) delete env[k];
const app = spawn("bun", ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, CREW_SESSION_TOKEN: token, CREW_FM_STATE: join(tmp, "fm", "state"), CREW_PORT: String(port), CREW_GH: "0", CREW_READONLY: "0",
  CREW_DATA: data, CREW_FILE_ALLOW: tmp, CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_GH_NO_CLI: "1", CREW_KEYCHAIN_TOOL: "none",
  CREW_CLAUDE_BIN: "/nonexistent/claude", CREW_CODEX_BIN: "/nonexistent/codex", CREW_BOARD_URL: "http://127.0.0.1:9", CREW_BOARD_SECRET: join(tmp, "board.secret"), HOME: home, CREW_MAIN_PROJECT: proj } });
let appLog = ""; app.stdout.on("data", (d) => (appLog += d)); app.stderr.on("data", (d) => (appLog += d));
const base = `http://127.0.0.1:${port}`;
// raw HTTP, so the test sets Origin, Sec-Fetch-Site and Authorization exactly as a browser or phone would
const raw = (method, path, { headers = {}, body } = {}) => new Promise((resolve) => {
  const text = body === undefined ? null : JSON.stringify(body);
  const r = httpRequest({ host: "127.0.0.1", port, method, path, headers: { host: `127.0.0.1:${port}`, ...(text ? { "content-type": "application/json", "content-length": Buffer.byteLength(text) } : {}), ...headers } }, (res) => {
    let s = ""; res.on("data", (c) => (s += c)); res.on("end", () => { let j = null; try { j = JSON.parse(s); } catch {} resolve({ status: res.statusCode, headers: res.headers, body: j, text: s }); }); });
  r.on("error", (e) => resolve({ status: 0, body: null, text: String(e) })); if (text) r.write(text); r.end();
});
const desk = { "x-crew-session": token };
const offers = async (id) => ((await raw("GET", `/api/wruns/${id}`, { headers: desk })).body?.ledger ?? []).filter((e) => e.record === "captain-continuation-offer-v1").length;
const shots = join(root, "tests/out/web-open-server"); mkdirSync(shots, { recursive: true });
let browser;
try {
  await waitUp(base, app);
  const { closed, waiting, archived } = ids;

  // ---- the new-tab route: top-level pages sandboxed, Studio's own frames not ----
  const top = await raw("GET", "/af/coffee-site/1/index.html", { headers: { "sec-fetch-dest": "document" } });
  const framed = await raw("GET", "/af/coffee-site/1/index.html", { headers: { "sec-fetch-dest": "iframe" } });
  const bare = await raw("GET", "/af/coffee-site/1/index.html");
  ok(/^sandbox allow-scripts allow-forms;/.test(top.headers["content-security-policy"] ?? "") && !/allow-same-origin/.test(top.headers["content-security-policy"]), "a site opened as its own tab is served in an opaque-origin sandbox (sandbox allow-scripts allow-forms, no allow-same-origin)", top.headers["content-security-policy"]);
  ok(/^sandbox allow-scripts allow-forms;/.test(bare.headers["content-security-policy"] ?? ""), "a request that does not say it is a frame is sandboxed too");
  ok(framed.status === 200 && !/sandbox/.test(framed.headers["content-security-policy"] ?? "") && /frame-ancestors 'self'/.test(framed.headers["content-security-policy"] ?? ""), "Studio's own preview frames keep their CSP (frame-ancestors 'self'), unsandboxed by the header");

  // ---- continuation routes through the real server: CSRF, session, phone ----
  const before = await offers(closed);
  const cross = await raw("POST", `/api/wruns/${closed}/continuation/offer`, { headers: { ...desk, origin: "http://evil.example" }, body: {} });
  ok(cross.status === 403 && cross.body?.code === "crossSite", "a cross-site offer request is refused (CSRF)", JSON.stringify(cross.body));
  const crossFetch = await raw("POST", `/api/wruns/${closed}/continuation/confirm`, { headers: { cookie: `crew_session=${token}`, "sec-fetch-site": "cross-site" }, body: { token: "0".repeat(32), confirm: closed } });
  ok(crossFetch.status === 403 && crossFetch.body?.code === "crossSite", "a cross-site confirm carrying the session cookie is refused (CSRF)", JSON.stringify(crossFetch.body));
  const noSession = await raw("POST", `/api/wruns/${closed}/continuation/offer`, { body: {} });
  ok(noSession.status === 403 && noSession.body?.code === "session", "an offer without Studio's session is refused", JSON.stringify(noSession.body));
  // pair a phone on the real server and let it drive: the continuation routes still refuse it
  const code = (await raw("POST", "/api/remote/pair/start", { headers: desk, body: {} })).body?.code;
  const paired = await raw("POST", "/api/remote/pair", { body: { code, name: "Test phone" } });
  const phone = { authorization: `Bearer ${paired.body?.token}` };
  ok(paired.status === 200 && (await raw("GET", "/api/remote/me", { headers: phone })).body?.kind === "phone", "a phone pairs with the real server");
  await raw("POST", "/api/remote/settings", { headers: desk, body: { allowDrive: true } });
  const phoneOffer = await raw("POST", `/api/wruns/${closed}/continuation/offer`, { headers: phone, body: {} });
  const phoneConfirm = await raw("POST", `/api/wruns/${closed}/continuation/confirm`, { headers: phone, body: { token: "0".repeat(32), confirm: closed } });
  ok(phoneOffer.status === 403 && phoneConfirm.status === 403, "a paired phone allowed to drive still cannot get or confirm a continuation", `${phoneOffer.status} ${phoneConfirm.status}`);
  ok(await offers(closed) === before && (await raw("GET", `/api/wruns/${closed}`, { headers: desk })).body?.result === "closed", "refused requests record no offer and leave the Task closed");
  const phoneView = (await raw("GET", `/api/wruns/${closed}`, { headers: phone })).body, deskView = (await raw("GET", `/api/wruns/${closed}`, { headers: desk })).body;
  ok(deskView?.continuable === true && phoneView?.continuable === false, "the run view tells the desktop it can continue and the phone it cannot", `${deskView?.continuable} ${phoneView?.continuable}`);
  ok((await raw("GET", `/api/wruns/${archived}`, { headers: desk })).body?.continuable === false && (await raw("GET", `/api/wruns/${waiting}`, { headers: desk })).body?.continuable === false, "a Task the engine would refuse (archived, or still waiting) is not offered");
  const deskOffer = await raw("POST", `/api/wruns/${closed}/continuation/offer`, { headers: desk, body: {} });
  ok(deskOffer.status === 200 && /^[a-f0-9]{32}$/.test(deskOffer.body?.token ?? "") && await offers(closed) === before + 1, "the same offer from the desktop session is made and recorded", JSON.stringify(deskOffer.body));

  browser = withSession(await chromium.launch(), base, token);
  // a section that cannot run (an element missing on an older build) fails on its own and the rest still runs
  const section = async (name, fn) => { try { await fn(); } catch (e) { ok(false, `${name} section ran`, String(e?.message ?? e).split("\n")[0]); } };
  const errors = [];
  // ---- the button: desktop sees it only where it can succeed; a phone never ----
  const deskCtx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await deskCtx.addInitScript(() => { try { localStorage.setItem("crew.lang", "en"); localStorage.setItem("crew.theme", "light"); localStorage.setItem("crew.canary", "studio-only"); } catch {} });
  deskCtx.setDefaultTimeout(8000);
  const page = await deskCtx.newPage(); page.on("pageerror", (e) => errors.push(e.message));
  const seen = (p, sel, timeout = 8000) => p.waitForSelector(sel, { timeout }).then(() => true, () => false);
  await page.goto(`${base}/#/run/${archived}`); await seen(page, "[data-runview]");
  ok(await seen(page, "[data-run-delete]") && await page.locator("[data-continue-task]").count() === 0, "a closed Task the engine refuses (archived) shows no Continue button");
  await page.goto(`${base}/#/run/${waiting}`); await seen(page, "[data-runview]");
  ok(await seen(page, "[data-run-cancel]") && await page.locator("[data-continue-task]").count() === 0, "a Task still waiting shows no Continue button");
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 900 } });
  await phoneCtx.addInitScript((t) => { try { localStorage.setItem("crew.remoteToken", t); } catch {} }, paired.body?.token);
  const phonePage = await phoneCtx.newPage(); await phonePage.goto(`${base}/#/run/${closed}`);
  ok(await seen(phonePage, "[data-runview]") && await seen(phonePage, "[data-run-archive]") && await phonePage.locator("[data-continue-task]").count() === 0, "a phone sees the closed Task without a Continue button");

  // ---- one phrase for the closed state: pill and Timeline ----
  await page.goto(`${base}/#/run/${closed}`); await seen(page, "[data-continue-task]");
  const words = await page.locator("[data-runview]").innerText();
  ok((await page.locator("[data-run-status]").innerText()).includes("Closed without approval") && words.includes("Closed without approval") && !words.includes("Closed without merging"), "the status pill and the Timeline both say Closed without approval", words.match(/Closed without \w+/g)?.join("|"));

  // ---- the continuation panel laid out like Delete ----
  await section("panel", async () => {
  await page.locator("[data-run-delete]").click(); const del = await page.locator(".rt-endpanel").boundingBox(); const delBorder = await page.locator(".rt-endpanel").evaluate((e) => getComputedStyle(e).borderTopColor); await page.locator("[data-run-delete]").click();
  await page.locator("[data-continue-task]").click(); await seen(page, "[data-continuation-confirm]");
  // read the panel in one pass (no waiting), so each design assertion reports on its own on any build
  const facts = () => page.evaluate(() => {
    const input = document.querySelector("[data-continuation-confirm]"); if (!input) return {};
    const panel = input.closest(".rt-endpanel, section, .card"), primary = panel.querySelector("[data-confirm-continuation]");
    const keep = [...panel.querySelectorAll("button")].find((b) => /Keep closed|保持關閉/.test(b.textContent)), box = (el) => { const r = el?.getBoundingClientRect(); return r ? { x: r.x, y: r.y } : null; };
    return { role: panel.getAttribute("role"), label: panel.getAttribute("aria-label"), hint: input.closest("label")?.innerText.trim() ?? "", disabled: primary ? primary.disabled : null, keepClass: keep?.className ?? "", border: getComputedStyle(panel).borderTopColor, calm: panel.classList.contains("calm"), pb: box(primary), kb: box(keep), px: box(panel)?.x };
  });
  const f0 = await facts();
  ok(f0.role === "group" && !!f0.label && f0.label.includes(closed), "the continuation card has a title and is labelled by it", JSON.stringify(f0));
  ok(f0.hint === `Type ${closed} to continue it`, "the label names the Task ID", f0.hint);
  ok(f0.calm && !!delBorder && f0.border !== delBorder, "the Continue panel uses the neutral endPanel border; red stays for Delete", JSON.stringify({ continue: f0.border, delete: delBorder }));
  ok(f0.disabled === true, "Continue is disabled while the field is empty");
  await page.fill("[data-continuation-confirm]", "R-999"); ok((await facts()).disabled === true, "Continue stays disabled for a different ID");
  await page.fill("[data-continuation-confirm]", closed); const f1 = await facts(); ok(f1.disabled === false, "Continue enables once the ID matches");
  ok(/\bghost\b/.test(f1.keepClass) && !!f1.pb && !!f1.kb && Math.abs(f1.pb.y - f1.kb.y) < 2 && f1.kb.x > f1.pb.x, "Continue and Keep closed sit on one row, Keep closed a text button", JSON.stringify(f1));
  ok(!!del && f1.px === del.x, "the panel sits where the Delete panel does");
  const panel = page.locator("[data-continuation-confirm]").locator("xpath=ancestor::*[contains(@class,'card')][1]");
  await page.screenshot({ path: join(shots, "continue-panel-1280-light-en.png"), fullPage: false });
  await panel.screenshot({ path: join(shots, "continue-panel-crop.png") });
  for (const [w, theme, lang] of [[390, "dark", "zh-TW"]]) {
    const c = await browser.newContext({ viewport: { width: w, height: 900 } }); await c.addInitScript(([l, t]) => { localStorage.setItem("crew.lang", l); localStorage.setItem("crew.theme", t); }, [lang, theme]);
    const p = await c.newPage(); await p.goto(`${base}/#/run/${closed}`); await seen(p, "[data-continue-task]"); await p.locator("[data-continue-task]").click(); await seen(p, "[data-continuation-confirm]");
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `the panel fits ${w} ${theme} ${lang}`);
    ok((await p.locator("[data-continuation-hint]").innerText()).includes(closed), `the ${lang} label names the Task ID`);
    await p.screenshot({ path: join(shots, `continue-panel-${w}-${theme}-${lang}.png`), fullPage: true }); await c.close();
  }

  });
  // ---- the opened site: opaque origin, no Studio storage, no same-origin window, no /api ----
  const probeTab = await deskCtx.newPage(); await probeTab.goto(`${base}/af/probe-site/1/index.html`);
  const probe = await probeTab.waitForFunction(() => document.body?.dataset.probe, null, { timeout: 10000 }).then((h) => h.jsonValue()).then(JSON.parse, () => ({}));
  ok(probe.origin === "null", "the opened site runs with an opaque origin", JSON.stringify(probe));
  ok(/^blocked:SecurityError/.test(probe.storage ?? "") && probe.token === undefined, "it cannot read Studio's localStorage (crew.* keys, the phone token)", probe.storage);
  ok(/^blocked:/.test(probe.cookie ?? ""), "it cannot read Studio's cookies", probe.cookie);
  ok(probe.popup === "blocked", "it cannot open a same-origin Studio window", probe.popup + " " + (probe.popupStorage ?? ""));
  ok(/^blocked:/.test(probe.apiGet ?? "") && /^blocked:/.test(probe.apiPost ?? ""), "it cannot fetch or post to /api", `${probe.apiGet} ${probe.apiPost}`);
  ok(probe.frame === "none" && !/framed-storage|origin/.test(probe.frameDoc ?? ""), "a Studio page it tries to frame never loads (default-src none, frame-ancestors self) and leaks nothing", `${probe.frame} ${probe.frameDoc}`);
  const phoneProbe = await phoneCtx.newPage(); await phoneProbe.goto(`${base}/af/probe-site/1/index.html`);
  const pp = await phoneProbe.waitForFunction(() => document.body?.dataset.probe, null, { timeout: 10000 }).then((h) => h.jsonValue()).then(JSON.parse, () => ({}));
  ok(/^blocked:SecurityError/.test(pp.storage ?? "") && !pp.token, "on a phone, the opened site cannot read the bearer token crew.remoteToken", JSON.stringify(pp));
  const evilTop = await deskCtx.newPage(); await evilTop.goto(`${base}/af/probe-site/1/evil.html`);
  const ev = await evilTop.waitForFunction(() => document.body?.dataset.evil, null, { timeout: 8000 }).then((h) => h.jsonValue()).then(JSON.parse, () => ({}));
  ok(ev.origin === "null" && /framed-blocked/.test(ev.r ?? ""), "any other page of the site navigated to directly is sandboxed too", JSON.stringify(ev));
  // R-071: the sandbox allows forms, so a prototype's own submit handler runs in the captain's tab (and in the
  // interactive preview); form-action 'none' still sends nothing anywhere
  for (const q of ["", "?interactive=1"]) {
    const order = await deskCtx.newPage(); const posts = []; order.on("request", (r) => { if (r.method() === "POST") posts.push(r.url()); });
    await order.goto(`${base}/af/probe-site/1/order.html${q}`); await order.click("#send");
    const summary = await order.waitForFunction(() => { const s = document.getElementById("summary"); return s && !s.hidden && s.textContent; }, null, { timeout: 5000 }).then((h) => h.jsonValue(), () => null);
    ok(summary === "Summary: Captain", `an order form's own submit handler runs in the sandboxed preview${q ? " (interactive)" : " tab"} and shows its summary (R-071)`, String(summary));
    await order.evaluate(() => document.getElementById("bareSend").click()); await order.waitForTimeout(500);
    ok(!posts.length && new URL(order.url()).pathname.endsWith("/order.html") && await order.evaluate(() => !!document.getElementById("order")), `a form with no handler still submits nowhere (form-action 'none')${q ? " (interactive)" : ""}`, JSON.stringify([posts, order.url()]));
    await order.close();
  }
  ok(await offers(closed) === before + 1, "the opened site created no continuation offer");

  // ---- the coffee site through the real Task link: CSS, image, poster and MP4 ----
  // each new-tab link is read without waiting or throwing, so a build without it fails that one assertion
  const linksOf = (p, sel) => p.$$eval(sel, (els) => els.map((e) => ({ href: e.getAttribute("href"), target: e.getAttribute("target"), rel: e.getAttribute("rel") || "" }))).catch(() => []);
  const outLinks = await linksOf(page, "[data-open-task-website]");
  ok(outLinks.length === 1 && outLinks[0].href === "/af/coffee-site/1/index.html" && outLinks[0].target === "_blank" && outLinks[0].rel.includes("noopener"), "the Task output link opens the pinned version in a new tab without an opener", JSON.stringify(outLinks));
  await section("coffee site", async () => {
  await page.bringToFront();
  // through the real link when it is there; otherwise straight to the URL, so the sandbox and media assertions still run
  let site; if (outLinks.length) { const popupP = page.waitForEvent("popup"); await page.locator("[data-open-task-website]").first().click(); site = await popupP; } else { site = await deskCtx.newPage(); await site.goto(`${base}/af/coffee-site/1/index.html`); }
  await site.setViewportSize({ width: 1100, height: 760 });
  await site.waitForLoadState();
  const playing = await site.waitForFunction(async () => { const v = document.getElementById("film"), i = document.getElementById("beans"); if (!v || !i?.complete || !i.naturalWidth) return false; if (v.paused) { try { await v.play(); } catch {} } return v.readyState >= 2 && v.videoWidth > 0 && v.currentTime > 0.2; }, null, { timeout: 15000, polling: 200 }).then(() => true, () => false);
  const facts = await site.evaluate(() => ({ origin: self.origin, opener: window.opener, bg: getComputedStyle(document.body).backgroundColor, script: document.documentElement.dataset.scriptRan, img: document.getElementById("beans").naturalWidth, vw: document.getElementById("film").videoWidth, t: document.getElementById("film").currentTime,
    poster: performance.getEntriesByType("resource").some((e) => e.name.endsWith("/assets/coffee-poster.png")) }));
  ok(facts.origin === "null" && facts.opener === null, "the coffee site opens sandboxed with no opener", JSON.stringify(facts));
  ok(facts.bg === "rgb(43, 29, 20)" && facts.script === "yes", "its CSS applies and its own script runs", JSON.stringify(facts));
  ok(facts.img === 360 && facts.poster, "its image and poster load", JSON.stringify(facts));
  ok(playing && facts.vw === 480, "its MP4 decodes and plays", JSON.stringify(facts));
  await site.evaluate(() => { const v = document.getElementById("film"); v.pause(); v.currentTime = 1; });
  await site.waitForTimeout(400); await site.screenshot({ path: join(shots, "coffee-site-new-tab.png") });
  await site.close();

  });
  // ---- confirm through the panel: the fresh card carries the same new-tab link ----
  await section("confirm", async () => { const primary = page.locator("[data-confirm-continuation]");
  await primary.click();
  ok(await seen(page, `[data-card-link="Open website in new tab"]`, 10000), "confirming reopens the Task with a fresh card");
  const cardLinks = await linksOf(page, `[data-card-link="Open website in new tab"]`);
  ok(cardLinks.length === 1 && cardLinks[0].href === "/af/coffee-site/1/index.html" && cardLinks[0].target === "_blank" && cardLinks[0].rel.includes("noopener"), "the fresh card's new-tab link is the same shared link", JSON.stringify(cardLinks));
  let after = null; for (let i = 0; i < 50 && after?.status !== "waiting"; i++) { after = (await raw("GET", `/api/wruns/${closed}`, { headers: desk })).body; if (after?.status !== "waiting") await new Promise((r) => setTimeout(r, 100)); }
  ok(after?.status === "waiting" && after.cards.filter((c) => c.status === "open").length === 1, "the Task is waiting on its one fresh card", `${after?.status}`);
  await page.screenshot({ path: join(shots, "continued-1280-light-en.png"), fullPage: false });
  });
  // the Library detail page opens the same version the same way
  await page.goto(`${base}/#/artifact/coffee-site`); await seen(page, "[data-open-website-version]");
  const libLinks = await linksOf(page, "[data-open-website-version]");
  ok(libLinks.length >= 1 && libLinks.every((l) => l.href === "/af/coffee-site/1/index.html" && l.target === "_blank" && l.rel.includes("noopener")), "the Library opens the same version through the same link", JSON.stringify(libLinks));
  ok(errors.length === 0, "no page errors", errors.join(" | "));
} catch (e) { fail++; console.log(`  FAIL  ${e?.stack ?? e}`); }
finally { await browser?.close(); app.kill(); }
if (fail) console.log(appLog.slice(-3000));
console.log(`web-open-server: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
