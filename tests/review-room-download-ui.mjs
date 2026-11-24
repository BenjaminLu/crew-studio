import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Download on the room's page (public/review-explain.js, public/review-room.js; docs/units/review-room.md "Downloading a page"),
// in real Chromium against a real isolated Studio serving a room seeded on disk (tests/lib/review-room-download-fixture.mjs):
// the shown version's Download on the output's line and one per version in the version menu, each saving that version's bytes
// as kept (one HTML file, or a zip for a page with a picture); a file changed since it was made is refused with why and nothing
// saved; the frame keeps sandbox="allow-scripts" only; a paired phone gets no Download and a note; a Library save's versions
// download from its read-only route. 1440 and 390 wide, light and dark. Nothing paid runs.
//        node tests/review-room-download-ui.mjs
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { withSession } from "./boot.mjs";
import { FILES, ID, sha, startStudio, unzipEntries } from "./lib/review-room-download-fixture.mjs";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => {
  console.error("review-room-download-ui: Playwright not found; set PLAYWRIGHT_MODULE to its index.mjs or install it"); process.exit(2); });
let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const shots = process.env.ROOM_SHOTS || join(root, "tests/out/review-room-download"); mkdirSync(shots, { recursive: true });
const s = await startStudio("room-download-ui");
const browser = withSession(await chromium.launch(), s.base), errors = [];
const context = async (o = {}) => { const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, ...o });
  await c.addInitScript(() => { try { localStorage.setItem("crew.lang", "en"); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {} addEventListener("DOMContentLoaded", () => document.body.classList.add("chat-closed")); });
  await c.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort()); return c; };
/** click, and the file the browser saved for it */
const saved = async (pg, sel) => { const [d] = await Promise.all([pg.waitForEvent("download", { timeout: 10000 }), pg.click(sel)]); return { name: d.suggestedFilename(), body: readFileSync(await d.path()) }; };
const openMenu = async (pg) => { if (!(await pg.$("[data-explain-vermenu]"))) { await pg.click("[data-explain-versions]"); await pg.waitForSelector("[data-explain-vermenu]"); }
  await pg.waitForFunction(() => !!document.activeElement?.closest("[data-explain-vermenu]"), null, { timeout: 3000 }).catch(() => {}); };
let artifact = null;
try {
  // fixture: a Library save of the room as it is now (before any file is changed)
  { const r = await fetch(`${s.base}/api/review-room/${ID}/save`, { method: "POST", headers: { "x-crew-session": process.env.CREW_SESSION_TOKEN, "content-type": "application/json" }, body: "{}" }), j = await r.json();
    artifact = j.artifact; ok(r.status === 200 && !!artifact, "fixture: the room saved to the Library", JSON.stringify(j)); }

  // ---------- the room: Download on the line (the version shown) and in the menu (every version) ----------
  { const c = await context(), w = await c.newPage(); w.on("pageerror", (e) => errors.push(e.message));
    await w.goto(`${s.base}/#/room/${ID}`); await w.waitForSelector('[data-explain-frame="3"]', { timeout: 20000 }); await w.waitForSelector("[data-explain-download]");
    const fr = await w.$eval('[data-explain-frame="3"]', (f) => f.getAttribute("sandbox"));
    ok(fr === "allow-scripts", "the output's frame keeps sandbox=allow-scripts only (no allow-downloads)", String(fr));
    const line = await w.$eval("[data-explain-download]", (b) => ({ n: b.dataset.explainDownload, label: b.getAttribute("aria-label"), text: b.textContent }));
    ok(line.n === "3" && line.label === "Download v3" && /Download/.test(line.text), "the output's line has Download for the version shown", JSON.stringify(line));
    const f3 = await saved(w, "[data-explain-download]");
    ok(f3.name === `${ID}-v3-studio-baton.html` && sha(f3.body) === sha(FILES[3].files["index.html"]), "clicking it saves v3's page, byte for byte as kept, under <room>-v3-studio-baton.html", JSON.stringify({ name: f3.name, sha: sha(f3.body) }));
    await w.screenshot({ path: join(shots, "1-line-1440-light.png") });
    await openMenu(w);
    const menu = await w.$$eval("[data-explain-vermenu] [data-explain-verdl]", (bs) => bs.map((b) => ({ n: b.dataset.explainVerdl, label: b.getAttribute("aria-label") })));
    ok(menu.map((x) => x.n).join(",") === "3,2,1" && menu.every((x) => x.label === `Download v${x.n}`), "the version menu has a Download beside every version, each named for its version", JSON.stringify(menu));
    // the arrow keys still walk the versions only; Tab reaches each Download
    await w.focus('[data-explain-version="3"]'); await w.keyboard.press("ArrowDown");
    const next = await w.evaluate(() => document.activeElement?.dataset.explainVersion ?? document.activeElement?.dataset.explainVerdl ?? null);
    await w.focus('[data-explain-version="3"]'); await w.keyboard.press("Tab");
    const tab = await w.evaluate(() => document.activeElement?.dataset.explainVerdl ?? null);
    ok(next === "2" && tab === "3", "↓ goes from v3 to v2 (not to a Download); Tab goes from v3 to its Download", JSON.stringify({ next, tab }));
    await w.screenshot({ path: join(shots, "2-menu-1440-light.png") });
    const f2 = await saved(w, '[data-explain-verdl="2"]'), z = unzipEntries(f2.body);
    ok(f2.name === `${ID}-v2-walkthrough.zip` && z.get("index.html")?.equals(Buffer.from(FILES[2].files["index.html"])) && z.get("fig.png")?.equals(FILES[2].files["fig.png"]),
      "v2's Download (a page and its picture) saves a zip of both, byte for byte", JSON.stringify({ name: f2.name, entries: [...z.keys()] }));
    const shown = await w.evaluate(() => document.querySelector("[data-explain-frame]")?.dataset.explainFrame);
    ok(shown === "3", "downloading another version does not change the version shown", String(shown));
    // v1's file changed on disk since it was made: refused with why, nothing saved
    writeFileSync(s.room.file(1, "index.html"), "<h1>changed</h1>");
    let got = null; w.once("download", (d) => (got = d.suggestedFilename()));
    await openMenu(w); await w.click('[data-explain-verdl="1"]'); await w.waitForSelector("[data-explain-error]", { timeout: 10000 }); await w.waitForTimeout(400);
    const err = await w.$eval("[data-explain-error]", (e) => e.textContent);
    ok(!got && /changed since it was made/.test(err) && /nothing was downloaded/.test(err), "a version whose file changed is refused: the room says why, and nothing is saved", JSON.stringify({ got, err }));
    await w.screenshot({ path: join(shots, "3-refused-1440-light.png") });
    // a paired phone reads only: no Download, a note in the menu
    await w.evaluate(() => { window.__tok = window.crewRemote.token; window.crewRemote.token = () => "phone"; render(); });
    await openMenu(w); await w.waitForSelector("[data-explain-dl-desktop]");
    const ph = await w.evaluate(() => ({ line: !!document.querySelector("[data-explain-download]"), menu: document.querySelectorAll("[data-explain-verdl]").length, note: document.querySelector("[data-explain-dl-desktop]")?.textContent }));
    ok(!ph.line && !ph.menu && /download on the Mac running Studio/.test(ph.note || ""), "on a paired phone: no Download on the line or in the menu, and the menu says where pages download", JSON.stringify(ph));
    await w.evaluate(() => { window.crewRemote.token = window.__tok; render(); });
    await c.close(); }

  // ---------- light and dark, 1440 and 390: the line and the menu hold their Download, nothing scrolls sideways ----------
  for (const [width, scheme] of [[1440, "dark"], [390, "light"], [390, "dark"]]) {
    const c = await context({ viewport: { width, height: width < 600 ? 844 : 900 }, colorScheme: scheme }), w = await c.newPage(); w.on("pageerror", (e) => errors.push(e.message));
    await w.goto(`${s.base}/#/room/${ID}`); await w.waitForSelector("[data-explain-download]", { timeout: 20000 }); await w.waitForTimeout(300);
    const geo = await w.evaluate(() => { const b = document.querySelector("[data-explain-download]").getBoundingClientRect(); return { side: document.documentElement.scrollWidth - innerWidth, w: Math.round(b.width), h: Math.round(b.height), right: Math.round(b.right), vw: innerWidth }; });
    ok(geo.side <= 0 && geo.right <= geo.vw && geo.h >= 24, `${width} ${scheme}: Download sits on the line inside the window, no sideways scroll`, JSON.stringify(geo));
    await w.screenshot({ path: join(shots, `4-line-${width}-${scheme}.png`) });
    await openMenu(w); await w.waitForTimeout(150);
    const mg = await w.evaluate(() => { const m = document.querySelector("[data-explain-vermenu]").getBoundingClientRect(), d = [...document.querySelectorAll("[data-explain-verdl]")].map((e) => e.getBoundingClientRect());
      return { side: document.documentElement.scrollWidth - innerWidth, inside: d.every((r) => r.left >= m.left && r.right <= m.right + 0.5), size: d.map((r) => Math.round(r.width)) }; });
    ok(mg.side <= 0 && mg.inside && mg.size.every((x) => x >= 24), `${width} ${scheme}: each version's Download sits inside the menu, a target of 24 px or more`, JSON.stringify(mg));
    await w.screenshot({ path: join(shots, `5-menu-${width}-${scheme}.png`) });
    if (width === 390) { const f = await saved(w, '[data-explain-verdl="3"]'); ok(sha(f.body) === sha(FILES[3].files["index.html"]), `${width} ${scheme}: Download in the menu saves the page`, f.name); }
    await c.close(); }

  // ---------- a Library save's read-only route: each version as saved, downloadable ----------
  for (const scheme of ["light", "dark"]) {
    const c = await context({ colorScheme: scheme }), w = await c.newPage(); w.on("pageerror", (e) => errors.push(e.message));
    await w.goto(`${s.base}/#/room/lib:${artifact}@1`); await w.waitForSelector("[data-saved-download]", { timeout: 20000 });
    const ns = await w.$$eval("[data-saved-download]", (bs) => bs.map((b) => b.dataset.savedDownload));
    ok(ns.join(",") === "1,2,3", `${scheme}: the saved room lists a Download for every saved version`, JSON.stringify(ns));
    if (scheme === "light") { const f = await saved(w, '[data-saved-download="3"]');
      ok(f.name === `${ID}-v3-studio-baton.html` && sha(f.body) === sha(FILES[3].files["index.html"]), "a saved version downloads from the save, byte for byte", JSON.stringify({ name: f.name }));
      // the save's own copy is what downloads: the room's v1 changed after the save, the save's v1 did not
      const f1 = await saved(w, '[data-saved-download="1"]');
      ok(f1.body.equals(Buffer.from(FILES[1].files["index.html"])), "the save's v1 is the page as saved, whatever the room's copy became", f1.name); }
    await w.screenshot({ path: join(shots, `6-saved-1440-${scheme}.png`) });
    await w.evaluate(() => { window.__tok = window.crewRemote.token; window.crewRemote.token = () => "phone"; render(); }); await w.waitForSelector("[data-saved-dl-desktop]");
    ok(!(await w.$("[data-saved-download]")), `${scheme}: on a paired phone the saved room offers no Download, and says where pages download`);
    await c.close(); }
  ok(!errors.length, "no page error", JSON.stringify(errors));
} catch (e) { fail++; console.log(`  FAIL  the suite threw: ${e?.stack ?? e}\n${s.log().slice(-3000)}`); }
finally { await browser.close(); s.stop(); }
console.log(`\nreview-room-download-ui: ${pass} passed, ${fail} failed (screenshots in ${shots})`);
process.exit(fail ? 1 : 0);
