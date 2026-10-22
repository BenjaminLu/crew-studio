import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Live S25: after a deploy an already-open Board tab kept the old page JS (R-069 still showed its old status until a manual
// reload). Two "versions" of Studio on one port and data dir (CREW_PAGE_RELEASE names each): an open tab whose stream
// reconnects to a newer release reloads itself when that loses nothing; with unsent text in a field it keeps the text and
// shows a small "Studio was updated · Reload" bar instead. Offline: stub providers only.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, ".."), tmp = mkdtempSync(join(tmpdir(), "crew-page-release-ui-"));
const home = join(tmp, "home"), data = join(tmp, "data"), state = join(tmp, "state"), proj = join(tmp, "proj");
for (const d of [home, data, state, proj, join(home, ".codex")]) mkdirSync(d, { recursive: true });
const TOKEN = "page-release-ui";
const env = { ...process.env }; for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR", "CREW_PAGE_RELEASE"]) delete env[k];
let pass = 0, fail = 0, browser, app, serverPhase = "initial"; const errors = [];
const traceRequests = (p, tag) => p.on("requestfailed", r => { const path = new URL(r.url()).pathname; if (path.startsWith("/api/")) console.log("release-request-failure " + JSON.stringify({ tag, path, method: r.method(), failure: r.failure()?.errorText, phase: serverPhase })); });
const ok = (v, n, extra = "") => { if (v) { pass++; console.log("ok " + n); } else { fail++; console.log(("FAIL " + n + " " + extra).trimEnd()); } };
const port = await freePort(), base = `http://127.0.0.1:${port}`;
const start = async (release) => {
  serverPhase = `starting-${release}`;
  app = spawn("bun", ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, HOME: home, CODEX_HOME: join(home, ".codex"), CREW_SESSION_TOKEN: TOKEN, CREW_PORT: String(port), CREW_DATA: data,
    CREW_FM_STATE: state, CREW_MAIN_PROJECT: proj, CREW_GH: "0", CREW_GH_NO_CLI: "1", CREW_CHAT_PROVIDER: "stub", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_SANDBOX: "0", CREW_LOCAL_UNRESTRICTED: "0",
    CREW_HOST_CODEX_BIN: join(here, "stub-host-codex.mjs"), CREW_HOST_CLAUDE_BIN: join(here, "stub-host-claude.mjs"), CREW_PAGE_RELEASE: release } });
  app.stdout.resume(); app.stderr.resume(); await waitUp(base, app); serverPhase = `running-${release}`;
};
const stop = async () => { if (app && app.exitCode === null && app.signalCode === null) { const done = new Promise((r) => app.once("exit", r)); serverPhase = "stopping"; app.kill("SIGTERM"); await done; serverPhase = "stopped"; } };
const until = async (f, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { try { if (await f()) return true; } catch {} await new Promise((r) => setTimeout(r, 100)); } return false; };
try {
  await start("v1");
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  browser = withSession(await chromium.launch({ headless: true }), base, TOKEN);
  // A genuine bootstrap request is held before hitting the real server, then
  // released while that server is stopped. This identifies the request/phase
  // behind a restart rejection without suppressing the final pageerror gate.
  { const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await ctx.newPage(); let phase = "holding-types", releaseTypes;
    const failures = [], pageErrors = [], otherRequests = new Set(); let lastOtherRequest = Date.now();
    const other = r => new URL(r.url()).pathname.startsWith("/api/") && !["/api/types", "/api/stream", "/api/main/locale"].includes(new URL(r.url()).pathname);
    p.on("request", r => { if (other(r)) { otherRequests.add(r); lastOtherRequest = Date.now(); } });
    const finished = r => { if (other(r)) { otherRequests.delete(r); lastOtherRequest = Date.now(); } };
    p.on("requestfinished", finished); p.on("requestfailed", finished);
    p.on("requestfailed", r => { if (new URL(r.url()).pathname === "/api/types") failures.push({ path: new URL(r.url()).pathname, method: r.method(), failure: r.failure()?.errorText, phase }); });
    p.on("pageerror", e => { const detail = { message: e.message, stack: e.stack, phase }; pageErrors.push(detail); errors.push(`controlled-types: ${JSON.stringify(detail)}`); });
    let held = false;
    const resume = new Promise(resolve => { releaseTypes = resolve; });
    await p.route("**/api/types", async route => { held = true; await resume; await route.continue(); });
    await p.goto(base + "/#/board");
    if (!await until(() => held)) throw new Error("the real types request was not held");
    if (!await until(() => otherRequests.size === 0 && Date.now() - lastOtherRequest >= 300)) throw new Error("other bootstrap requests did not settle: " + JSON.stringify([...otherRequests].map(r => ({path:new URL(r.url()).pathname,method:r.method(),type:r.resourceType()}))));
    phase = "server-stopped"; await stop(); releaseTypes();
    ok(await until(() => failures.length === 1), "controlled bootstrap failure identifies the real types request", JSON.stringify(failures));
    ok(await until(() => p.getByText("Crew Studio could not load", { exact: true }).count()), "failed bootstrap metadata reaches the existing visible load error boundary");
    console.log("types-request-diagnostic " + JSON.stringify({ failures, pageErrors }));
    await p.unroute("**/api/types"); await start("v1"); phase = "recovered"; await p.reload();
    ok(await until(async () => (await p.locator("#conn.ok").count()) === 1), "reload after the server returns reconnects normally");
    ok(await p.evaluate(async () => JSON.stringify(S.types) === JSON.stringify(await fetch("/api/types").then(r => r.json()))), "recovered bootstrap loads the actual types metadata");
    await ctx.close();
  }
  let n = 1;
  for (const [width, lang] of [[1440, "en"], [390, "zh-TW"]]) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 } });
    await ctx.addInitScript((lang) => { try { localStorage.setItem("crew.lang", lang); localStorage.setItem("crew.chatOpen", "1"); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {} }, lang);
    const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(`${width} ${serverPhase}: ${e.stack || e}`)); traceRequests(p, `${width}-${lang}`);
    const tag = `${width}-${lang}`, mine = () => p.evaluate(() => document.querySelector('meta[name="crew-release"]')?.content);
    await p.goto(base + "/#/board");
    await until(async () => (await p.locator("#conn.ok").count()) === 1);
    const was = `v${n}`;
    ok(await mine() === was, `${tag}: the page names the release it was served as`, String(await mine()));
    // a deploy with nothing unsent: the open tab reloads itself onto the new page
    await p.evaluate(() => { window.__oldPage = true; });
    await stop(); n++; await start(`v${n}`);
    ok(await until(async () => await mine() === `v${n}` && !(await p.evaluate(() => window.__oldPage === true))), `${tag}: after a deploy the open tab reloads itself onto the new release`);
    ok(await p.locator("#releaseBar").count() === 0, `${tag}: no bar when it could reload by itself`);
    // a deploy while the captain has typed something: nothing is lost, a small bar offers the reload
    await until(async () => (await p.locator("#conn.ok").count()) === 1);
    if (width < 500 && await p.locator("#chatFab").isVisible().catch(() => false)) await p.locator("#chatFab").click();
    await p.locator("#chatIn").fill("half-written message");
    await p.evaluate(() => { window.__oldPage = true; });
    await stop(); n++; await start(`v${n}`);
    ok(await until(async () => (await p.locator("#releaseBar").count()) === 1), `${tag}: with unsent text a deploy shows the update bar instead of reloading`);
    const bar = (await p.locator("#releaseBar").innerText().catch(() => "")) || "";
    ok(lang === "en" ? /Studio was updated/.test(bar) && /Reload/.test(bar) : /Studio 已更新/.test(bar) && /重新載入/.test(bar), `${tag}: the bar says Studio was updated and offers a reload, in the page language`, bar);
    ok(await p.evaluate(() => window.__oldPage === true) && await p.locator("#chatIn").inputValue() === "half-written message", `${tag}: the typed text and the page stay`);
    const box = await p.locator("#releaseBar").boundingBox();
    ok(!!box && box.x >= 0 && box.x + box.width <= width && await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${tag}: the bar fits the screen`);
    // Reload with the text still there asks once, in the page (never window.confirm); Cancel keeps everything
    let dialogs = 0; p.on("dialog", (d) => { dialogs++; d.dismiss().catch(() => {}); });
    await p.locator("[data-release-reload]").click();
    const asked = (await p.locator("#releaseBar").innerText().catch(() => "")) || "";
    ok(lang === "en" ? /There is unsent content\. Reload anyway\?/.test(asked) : /有未送出的內容，仍要重新載入？/.test(asked), `${tag}: Reload with unsent content asks once, in the page`, asked);
    await p.locator("[data-release-cancel]").click();
    ok(await p.evaluate(() => window.__oldPage === true) && await p.locator("#chatIn").inputValue() === "half-written message" && await p.locator("[data-release-reload]").count() === 1, `${tag}: Cancel keeps the page and the text`);
    await p.locator("[data-release-reload]").click(); await p.locator("[data-release-confirm]").click();
    ok(await until(async () => await mine() === `v${n}` && !(await p.evaluate(() => window.__oldPage === true).catch(() => false))) && dialogs === 0, `${tag}: confirming opens the new release; no browser dialog was used`);
    await ctx.close();
  }
  // every kind of unsent state a reload would lose keeps the page and shows the bar (W34 review): set without any input
  // event, the way a redraw or a programmatic stage leaves it, so the modules' own checks decide, not the keystroke net
  { const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(() => { try { localStorage.setItem("crew.lang", "en"); localStorage.setItem("crew.chatOpen", "1"); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {} });
    const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(`cases ${serverPhase}: ${e.stack || e}`)); traceRequests(p, "unsent-cases");
    const mine = () => p.evaluate(() => document.querySelector('meta[name="crew-release"]')?.content);
    const card = { id: "SC-990", run: "R-990", node: "ask", visit: 1, kind: "question", status: "open", workflow: "fixture", title: { en: "Pick one", "zh-TW": "選一個" },
      body: "Pick one", options: [{ id: "a", label: "A", primary: true }, { id: "b", label: "B", note: true }], createdAt: new Date().toISOString(), answer: null };
    const cases = [
      ["a chat draft with only an attachment", () => { MS.att.push({ key: "k1", name: "poster.png", state: "ready", ref: { id: "a1", name: "poster.png" } }); }],
      ["a ticked card", (c) => { const box = document.body.appendChild(document.createElement("div")); window.mountCard(box, c, { state: { ticks: new Set([0]) } }); }],
      ["a card note the card drew anew", (c) => { const box = document.body.appendChild(document.createElement("div")); window.mountCard(box, c, { state: { note: "half a note" } }); }],
      ["a typed password field", () => { const i = document.createElement("input"); i.type = "password"; document.body.append(i); i.value = "ghp_partial"; }],
      ["an open dialog", () => { const d = document.createElement("dialog"); d.textContent = "preview"; document.body.append(d); d.show(); }],
    ];
    for (const [name, setup] of cases) {
      await p.goto("about:blank"); await p.goto(base + "/#/board"); await until(async () => (await p.locator("#conn.ok").count()) === 1);
      await p.evaluate(setup, card); await p.evaluate(() => { window.__oldPage = true; });
      await stop(); n++; await start(`v${n}`);
      ok(await until(async () => (await p.locator("#releaseBar").count()) === 1) && await p.evaluate(() => window.__oldPage === true), `${name}: the page is kept and the update bar shows`);
    }
    // and the clean page still reloads by itself
    await p.goto("about:blank"); await p.goto(base + "/#/board"); await until(async () => (await p.locator("#conn.ok").count()) === 1);
    await p.evaluate(() => { window.__oldPage = true; });
    await stop(); n++; await start(`v${n}`);
    ok(await until(async () => await mine() === `v${n}` && !(await p.evaluate(() => window.__oldPage === true).catch(() => false))), "a clean page still reloads by itself");
    await ctx.close(); }
  ok(!errors.length, "no page errors", errors.join(" | "));
} catch (e) { ok(false, "the UI run finished", String(e?.stack ?? e).slice(0, 800)); }
finally { await browser?.close().catch(() => {}); await stop().catch(() => {}); }
console.log(`page-release-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
