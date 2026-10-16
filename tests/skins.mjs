import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Skins (M4/M5): the built-in voyage and terminal skins, the compatibility
// kit's checks, hash-pinned installs (a changed file is refused), no network by
// default (CSP, and installs that reach the network are refused unless granted),
// the read-only snapshot filtered by permissions, a skin that may only OPEN a
// card, a hostile skin that cannot reach Studio or answer anything, a skin that
// never starts (back to pro mode), and pro mode always one click away.
// Pages at 1440 and 390, light and dark.   node tests/skins.mjs
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
// Playwright: PLAYWRIGHT_MODULE (a path to its index.mjs), else the "playwright" package resolvable from here
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => {
  console.error("skins: Playwright not found; set PLAYWRIGHT_MODULE to its index.mjs or install it"); process.exit(2); });
process.env.CREW_SESSION_TOKEN ??= "test-session"; // the server's write guard: a local client sends it as x-crew-session
const tmp = mkdtempSync(join(tmpdir(), "crew-skins-"));
const state = join(tmp, "state"); cpSync(join(here, "fixture/state"), state, { recursive: true });
const data = join(tmp, "data"); mkdirSync(data);
const mk = (id, files, manifest = {}) => { const d = join(tmp, "src", id); mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "manifest.json"), JSON.stringify({ id, name: id, version: "1.0.0", entry: "index.html", permissions: ["snapshot.tasks", "snapshot.pending", "openCard"], network: [], ...manifest }));
  for (const [f, t] of Object.entries(files)) writeFileSync(join(d, f), t); return d; };
const page0 = (body) => `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="o">starting</div><script src="/skin/_kit/skin-kit.js"></script><script>${body}</script></body></html>`;
const good = mk("plain", { "index.html": page0(`CrewSkin.onSnapshot((s) => { document.getElementById("o").textContent = "tasks " + s.tasks.length + " crew " + s.crew.length; }); CrewSkin.ready();`) });
const hostile = mk("hostile", { "index.html": page0(`
  const o = document.getElementById("o"); const out = [];
  try { parent.document.body; out.push("parent-open"); } catch { out.push("isolated"); }
  fetch("/api/pending").then(() => out.push("fetch-ok")).catch(() => out.push("fetch-blocked")).finally(() => { o.textContent = out.join(" "); });
  parent.postMessage({ type: "crew:answer", id: "D-firstmate-workflow-T305-1", chosen: "A" }, "*");
  parent.postMessage({ type: "crew:navigate", hash: "#/changes" }, "*");
  try { top.location.href = "/#/changes"; } catch {}
  CrewSkin.ready();`) });
const stalled = mk("stalled", { "index.html": page0(`document.getElementById("o").textContent = "never ready";`) });
const leaky = mk("leaky", { "index.html": page0(`CrewSkin.ready();`).replace("</body>", `<img src="https://cdn.example.com/pixel.png"></body>`) });
const netty = mk("netty", { "index.html": page0(`CrewSkin.ready();`) }, { network: ["https://api.example.com"] });
const weird = mk("weird", { "index.html": page0(`CrewSkin.ready();`) }, { permissions: ["answerCards"] });

const port = await freePort();
const env = { ...process.env };
for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete env[k];
const app = spawn("bun", ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, CREW_FM_STATE: state, CREW_PORT: String(port), CREW_GH: "0", CREW_READONLY: "1", CREW_DATA: data,
  CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_GH_NO_CLI: "1", CREW_CLAUDE_BIN: "/nonexistent/claude", CREW_CODEX_BIN: "/nonexistent/codex",
  HOME: join(tmp, "home"), CREW_MAIN_PROJECT: join(tmp, "proj"), CREW_FILE_ALLOW: tmp, CREW_RECENT_DAYS: "3650" } });
let appLog = ""; app.stdout.on("data", (d) => (appLog += d)); app.stderr.on("data", (d) => (appLog += d));
const base = `http://127.0.0.1:${port}`;
await waitUp(base, app);
const post = async (p, b = {}) => { const r = await fetch(base + p, { method: "POST", headers: { "content-type": "application/json", "x-crew-session": process.env.CREW_SESSION_TOKEN }, body: JSON.stringify(b) }); return { ...(await r.json()), http: r.status }; };
const get = async (p) => (await fetch(base + p)).json();
let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const browser = withSession(await chromium.launch(), base);
const errors = [], offbox = [];
const page = async (width, scheme) => {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
  await ctx.addInitScript(() => { try { localStorage.setItem("crew.labs", "1"); } catch {} }); // these pages are labs (backbone sidebar)
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => { offbox.push(r.request().url()); r.abort(); });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`${width}/${scheme}: ${e}`));
  p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource.*(404|net::ERR_FAILED)|Content Security Policy|Unsafe attempt to initiate navigation|sandboxed|Blocked a frame/i.test(m.text())) errors.push(`${width}/${scheme}: ${m.text()}`); });
  return p;
};
const noHScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const shots = join(root, "tests/out");
try {
  // ---- API ----
  const list = (await get("/api/skins")).skins;
  ok(["voyage", "terminal"].every((id) => list.find((s) => s.id === id)?.ok && list.find((s) => s.id === id).checks.length === 5), "the built-in voyage and terminal skins pass all five kit checks", JSON.stringify(list.map((s) => [s.id, s.checks.filter((c) => !c.ok)])));
  const r = await fetch(`${base}/skin/voyage/index.html`);
  ok(r.ok && /connect-src 'none'/.test(r.headers.get("content-security-policy")) && /img-src 'self' data:/.test(r.headers.get("content-security-policy")), "skin files are served with no network (CSP connect-src 'none')");
  const snapT = await get("/api/skins/terminal/snapshot"), snapV = await get("/api/skins/voyage/snapshot");
  ok(snapT.flow === null && snapV.flow?.nodes?.length > 0 && snapT.tasks.length > 0 && !("details" in (snapT.pending[0] || {})), "the snapshot carries only what the manifest's permissions name (read-only fields)");
  const ins = await post("/api/skins/install", { path: good });
  ok(ins.http === 200 && ins.check.ok && Object.keys(ins.lock.files).length === 2 && /^[0-9a-f]{64}$/.test(ins.lock.sha256), "install a skin from a folder: checked and pinned by sha256");
  ok((await post("/api/skins/install", { path: leaky })).http === 400, "a skin that reaches the network is refused");
  const n1 = await post("/api/skins/install", { path: netty });
  ok(n1.http === 400 && /grant it explicitly/.test(n1.error), "a skin asking for network origins needs the captain's explicit grant");
  const n2 = await post("/api/skins/install", { path: netty, grantNetwork: true });
  ok(n2.http === 200 && /connect-src https:\/\/api\.example\.com/.test((await fetch(`${base}/skin/netty/index.html`)).headers.get("content-security-policy")), "granted: only the listed origin is allowed");
  ok((await post("/api/skins/install", { path: weird })).http === 400, "an unknown permission (answering cards) is refused");
  ok((await post("/api/skins/install", { path: hostile })).http === 200 && (await post("/api/skins/install", { path: stalled })).http === 400, "the kit check refuses a skin that never calls ready(); a hostile one installs (its powers are what is tested)");
  // stalled skin: install a copy that calls ready() in a dead branch so it passes the static check but never starts
  writeFileSync(join(stalled, "index.html"), page0(`if (false) CrewSkin.ready(); document.getElementById("o").textContent = "never ready";`));
  ok((await post("/api/skins/install", { path: stalled })).http === 200, "a skin that never starts at run time installs (the 5-second fallback is the guard)");
  // tamper: a changed file is refused
  await post("/api/skins/install", { path: good });
  appendFileSync(join(data, "skins", "installed", "plain", "index.html"), "<!-- changed -->");
  const t = await fetch(`${base}/skin/plain/index.html`);
  ok(t.status === 409 && !(await get("/api/skins")).skins.find((s) => s.id === "plain").ok && (await fetch(`${base}/api/skins/plain/snapshot`)).status === 409, "a file changed after install: refused, the skin is off");
  await post("/api/skins/install", { path: good });

  // ---- browser ----
  const pend = await get("/api/pending");
  // one event stream with voyage showing; a snapshot that arrives late is posted only to the skin and frame it was loaded for
  { const p = await page(1440, "light"); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    let streams = 0; p.on("request", (r) => { if (new URL(r.url()).pathname === "/api/stream") streams++; });
    await p.addInitScript(() => { window.__skinPosts = []; });
    await p.goto(`${base}/#/skins`); await p.evaluate(() => { window.__skinPosts = []; });
    await p.locator('[data-skin="voyage"] .btn.primary').click();
    await p.frameLocator("#skinLayer iframe").locator(".ship").first().waitFor({ timeout: 6000 });
    ok(streams === 1, "with voyage showing, the page holds one event stream", String(streams));
    // a snapshot delayed past pro mode: no page error, nothing posted after pro mode came back
    await p.route("**/api/skins/voyage/snapshot", async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.continue(); });
    await p.evaluate(() => { window.__skinPosts = []; document.querySelector("#skinLayer iframe")?.dispatchEvent(new Event("load")); });
    await p.waitForTimeout(150); await p.locator("#proBtn").click(); await p.waitForTimeout(2200);
    const afterPro = await p.evaluate(() => window.__skinPosts.length);
    ok(!errs.length && afterPro === 0, "a snapshot delayed past pro mode raises no page error and posts nothing", JSON.stringify([errs, afterPro]));
    // a snapshot for voyage delayed past a switch to terminal: observed in terminal's own frame, it never arrives there
    await p.unroute("**/api/skins/voyage/snapshot");
    // the late snapshot is held until terminal's listener is confirmed installed (no timer), so the check cannot pass on a slow load
    let lateStatus = 200, gate = null;
    const newGate = () => { let open, sent; const g = { held: new Promise((r) => (open = r)), done: new Promise((r) => (sent = r)) }; g.open = open; g.sent = sent; return g; };
    await p.route("**/api/skins/voyage/snapshot", async (route) => { const g = gate; const res = await route.fetch(); const body = await res.json(); await g.held;
      await route.fulfill({ status: lateStatus, contentType: "application/json", body: JSON.stringify({ ...body, __src: "voyage" }) }); g.sent(); });
    const switchAndWatch = async () => {
      gate = newGate(); await p.goto(`${base}/#/skins`); if (await p.locator("#proBtn").count()) await p.locator("#proBtn").click();
      await p.locator('[data-skin="voyage"] .btn.primary').click(); await p.waitForTimeout(200); // voyage's feed is held at the gate
      await p.locator("#proBtn").click(); await p.locator('[data-skin="terminal"] .btn.primary').click();
      await p.waitForFunction(() => document.querySelector('#skinLayer iframe[data-skin="terminal"]'), null, { timeout: 4000 });
      const tf = await (await p.$('#skinLayer iframe[data-skin="terminal"]')).contentFrame(); await tf.waitForLoadState("load");
      await tf.evaluate(() => { window.__got = []; addEventListener("message", (e) => window.__got.push(e.data)); });
      await tf.waitForFunction(() => Array.isArray(window.__got), null, { timeout: 4000 }); // the listener is in place: only now the late snapshot goes
      gate.open(); await Promise.race([gate.done, new Promise((_, no) => setTimeout(() => no(new Error("voyage's late snapshot was never requested")), 8000))]); await p.waitForTimeout(700);
      return { got: await tf.evaluate(() => window.__got), terminal: await p.locator('#skinLayer iframe[data-skin="terminal"]').count(), toast: await p.locator("text=failed its checks").count() };
    };
    const w1 = await switchAndWatch();
    ok(!errs.length && !w1.got.some((m) => m?.snapshot?.__src === "voyage"), "a late snapshot for one skin is never posted into another skin's frame (observed in that frame)", JSON.stringify(w1.got.map((m) => [m?.type, m?.snapshot?.__src ?? null])));
    lateStatus = 500; const before = errors.length; const w2 = await switchAndWatch();
    errors.splice(before).filter((e) => !/status of 500/.test(e)).forEach((e) => errors.push(e)); // the 500 this test forces is expected
    ok(w2.terminal === 1 && w2.toast === 0, "a late failed snapshot for one skin leaves the next skin showing (no pro mode, no toast)", JSON.stringify(w2));
    await p.unroute("**/api/skins/voyage/snapshot"); await p.evaluate(() => localStorage.removeItem("crew.skin")); await p.context().close(); }
  // a saved skin does not replace a skin the user picked while the startup list loaded
  { const p = await page(1440, "light"); let n = 0;
    // the page's own list request goes first and through; the startup's (the one that brings the saved skin back) waits 2.5 s
    await p.route("**/api/skins", async (route) => { if (++n >= 2) await new Promise((r) => setTimeout(r, 2500)); await route.continue(); });
    await p.addInitScript(() => { try { localStorage.setItem("crew.skin", "voyage"); } catch {} });
    await p.goto(`${base}/#/skins`); const t0 = Date.now(); await p.locator('[data-skin="terminal"] .btn.primary').click({ timeout: 2300 });
    await p.waitForTimeout(3200);
    ok(await p.locator('#skinLayer iframe[data-skin="terminal"]').count() === 1 && await p.locator('#skinLayer iframe[data-skin="voyage"]').count() === 0, "a saved skin does not replace a skin the user picked while the list loaded");
    await p.context().close(); }
  {
    const p = await page(1440, "light");
    await p.goto(`${base}/#/skins`);
    await p.locator('[data-skin="voyage"] .btn.primary').click();
    await p.locator("#skinBar .x-skinstat", { hasText: "read-only" }).waitFor({ timeout: 6000 });
    const vf = p.frameLocator("#skinLayer iframe");
    await vf.locator(".ship").first().waitFor({ timeout: 5000 });
    ok(await vf.locator(".ship").count() >= 1 && await vf.locator(".flag").count() === pend.length, "voyage: tasks sail as ships, waiting cards fly as flags");
    await p.screenshot({ path: join(shots, "skins-voyage-1440-light.png") });
    await p.reload(); ok(await p.locator("#skinBar .x-skinstat", { hasText: "read-only" }).waitFor({ timeout: 6000 }).then(() => true, () => false), "a chosen skin comes back after a reload");
    const target = pend.find((c) => !c.boardOnly) ?? pend[0];
    await p.frameLocator("#skinLayer iframe").locator(".flag", { hasText: target.task || target.id }).first().click();
    await p.waitForFunction((re) => new RegExp(re).test(location.hash), "#\\/inbox\\/", { timeout: 90000 }); // a hash change has no load event
    ok(await p.locator("#skinLayer").count() === 0 && decodeURIComponent(p.url()).includes(target.id), "clicking a flag asks the host to open that card: Studio shows it in pro mode (the skin never answers)");
    // terminal
    await p.goto(`${base}/#/skins`); await p.locator('[data-skin="terminal"] .btn.primary').click();
    const tf = p.frameLocator("#skinLayer iframe");
    await tf.locator("text=crew status").first().waitFor({ timeout: 5000 });
    await tf.locator("#in").fill("cards"); await tf.locator("#in").press("Enter");
    ok(await tf.locator("button.c").count() >= pend.length, "terminal: status, crew and cards as text; `cards` lists them");
    await p.screenshot({ path: join(shots, "skins-terminal-1440-light.png") });
    await p.locator("#proBtn").click();
    ok(await p.locator("#skinLayer").count() === 0, "Pro mode: one click back");
    // hostile
    await p.goto(`${base}/#/skins`); await p.locator('[data-skin="hostile"] .btn.primary').click();
    const hf = p.frameLocator("#skinLayer iframe");
    await hf.locator("#o", { hasText: "fetch" }).waitFor({ timeout: 5000 });
    const txt = await hf.locator("#o").innerText();
    ok(txt.includes("isolated") && txt.includes("fetch-blocked"), "a hostile skin cannot touch Studio's page or fetch its API", txt);
    await p.locator("#skinBar .x-ignored", { hasText: "ignored" }).waitFor({ timeout: 3000 });
    ok(/2 requests ignored/.test(await p.locator("#skinBar .x-ignored").innerText()) && !/changes/.test(p.url()), "its answer and navigate requests are ignored and counted; it cannot navigate Studio");
    ok((await get("/api/pending")).length === pend.length, "no card was answered");
    await p.keyboard.press("Escape");
    ok(await p.locator("#skinLayer").count() === 0, "Escape returns to pro mode");
    // stalled
    await p.locator('[data-skin="stalled"] .btn.primary').click();
    await p.waitForTimeout(5600);
    ok(await p.locator("#skinLayer").count() === 0 && await p.locator(".toast", { hasText: "did not start" }).count() === 1, "a skin that never starts: back to pro mode after 5 s, with a note");
    // pro via URL
    await p.locator('[data-skin="voyage"] .btn.primary').click(); await p.waitForTimeout(500);
    await p.goto(`${base}/?pro=1#/board`); await p.waitForTimeout(800);
    ok(await p.locator("#skinLayer").count() === 0, "/?pro=1 always opens pro mode (and forgets the skin)");
    await p.close();
  }
  for (const width of [1440, 390]) for (const scheme of ["light", "dark"]) {
    const p = await page(width, scheme);
    await p.goto(`${base}/#/skins`); await p.locator("[data-skin]").first().waitFor(); await p.waitForTimeout(300);
    ok(await noHScroll(p), `skins page ${width} ${scheme}: no sideways scroll`);
    await p.screenshot({ path: join(shots, `skins-page-${width}-${scheme}.png`), fullPage: true });
    for (const id of ["voyage", "terminal"]) {
      await p.locator(`[data-skin="${id}"] .btn.primary`).click();
      await p.locator("#skinBar .x-skinstat", { hasText: "read-only" }).waitFor({ timeout: 6000 }); await p.waitForTimeout(500);
      ok(await noHScroll(p), `${id} ${width} ${scheme}: no sideways scroll`);
      await p.screenshot({ path: join(shots, `skins-${id}-${width}-${scheme}.png`) });
      await p.locator("#proBtn").click();
    }
    await p.close();
  }
  ok(errors.length === 0, "no console errors", errors.join("\n"));
  ok(offbox.length === 0, "no request leaves this machine", offbox.join(", "));
} catch (e) { fail++; console.log(`  FAIL  exception ${e?.stack ?? e}\n${appLog.slice(-1500)}`); }
finally { await browser.close(); app.kill(); }
console.log(`\nskins: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
