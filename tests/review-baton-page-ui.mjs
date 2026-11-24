import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The built-in baton's page in the room's frame (src/domain/review-baton.ts, docs/units/review-room.md "The page and its
// questions"): a packet shaped the way the adapter asks (tests/lib/baton-runbook-packet.mjs: one system map, a runbook on it,
// each row's evidence a permalink at the room's head commit) is built by the vendored render.py and passes the vendored
// verify.py on the engineer register; the same packet with no failure-mode rows, a branch link or a handled row with no
// evidence fails it, so the adapter's rules are the ones verify.py holds. Then, in real Chromium against a real isolated
// Studio serving the page as a version of a room seeded on disk (tests/lib/review-room-download-fixture.mjs), the page's own
// features work inside the room's frame (sandbox="allow-scripts", an opaque origin, OUTPUT_CSP): "/" focuses its search and
// Enter lands on the runbook row with its place on the map marked; #q=<code> on the page's address opens the first hit;
// a row's number moves focus to its place on the map and Enter there marks its rows; the evidence link is the head-commit
// permalink, labelled owner/repo · file:La–Lb, and the frame opens no window for it. No script error, no CSP violation, no
// request off Studio. 1440 and 390 wide, light and dark. Nothing paid runs; needs python3 (the vendored scripts are stdlib only
// when every hans is written, as here).
//        node tests/review-baton-page-ui.mjs
//   BATON_EXTRA_PAGES=<dir>  also serve every *.html in <dir> as a further version and check it renders in the frame
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { withSession } from "./boot.mjs";
import { H, ID, REPO, startStudio } from "./lib/review-room-download-fixture.mjs";
import { ROWS, packet } from "./lib/baton-runbook-packet.mjs";
const root = join(dirname(fileURLToPath(import.meta.url)), ".."), skill = join(root, "packs/core/skills/studio-baton");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => {
  console.error("review-baton-page-ui: Playwright not found; set PLAYWRIGHT_MODULE to its index.mjs or install it"); process.exit(2); });
let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const shots = process.env.ROOM_SHOTS || join(root, "tests/out/review-baton-page"); mkdirSync(shots, { recursive: true });

// ---------- the vendored scripts: the adapter-shaped packet builds and passes; each rule the adapter names has teeth ----------
// python3 -B: no __pycache__ in the vendored folder, which would change the pinned files hash (tests/review-baton.ts)
if (spawnSync("python3", ["--version"]).status !== 0) { console.log("  FAIL  python3 is needed: the vendored render.py and verify.py run here"); process.exit(1); }
const work = mkdtempSync(join(tmpdir(), "crew-baton-page-"));
process.on("exit", () => rmSync(work, { recursive: true, force: true }));
const build = (name, spec) => { const j = join(work, `${name}.json`), h = join(work, `${name}.html`); writeFileSync(j, JSON.stringify(spec));
  execFileSync("python3", ["-B", join(skill, "scripts/render.py"), j, "-o", h], { stdio: "pipe" });
  const v = spawnSync("python3", ["-B", join(skill, "scripts/verify.py"), h, "--register", "engineer"], { encoding: "utf8" });
  return { html: readFileSync(h, "utf8"), code: v.status, out: `${v.stdout}${v.stderr}` }; };
const good = build("good", packet());
ok(good.code === 0 && /^ok — .*failure modes/.test(good.out) && !/warning/.test(good.out), "the adapter-shaped packet (system map, runbook, head-commit permalinks) passes verify.py on the engineer register, with no warning", good.out.slice(0, 400));
{ const p = packet(); p.sections = p.sections.filter((s) => s.kind !== "runbook"); const r = build("no-rows", p);
  ok(r.code === 1 && /the boundary map has no `failures`/.test(r.out), "without the failure-mode rows verify.py fails it (the adapter says they are required)", r.out.slice(0, 300)); }
{ const p = packet(); p.sections[1].rows[0] = { ...p.sections[1].rows[0], ref: p.sections[1].rows[0].ref.replace(H, "main") }; const r = build("branch", p);
  ok(r.code === 1 && /not pinned to a commit/.test(r.out), "a row whose evidence names a branch, not the head commit, fails verify.py", r.out.slice(0, 300)); }
{ const p = packet(); const { ref: _, ...row } = p.sections[1].rows[0]; p.sections[1].rows[0] = row; const r = build("handled-no-ref", p);
  ok(r.code === 1 && /`handled` needs `ref`/.test(r.out), "a handled row with no evidence fails verify.py (the adapter: never handled from code not read)", r.out.slice(0, 300)); }
// a document room (the adapter's document route): layer proposal, rows cite the document's sentence, no ref, planned where it says so
{ const p = packet(); p.layer = "proposal"; delete p.range; p.repo = "Checkout retries, a proposal (v2)";
  p.sections[1].rows = p.sections[1].rows.map(({ ref, ...row }, i) => ({ ...row, source: `doc:Failure handling, item ${i + 1}`, ...(i === 3 ? { planned: true } : {}) }));
  const r = build("document", p);
  ok(r.code === 0 && /<span class="fplan">/.test(r.html), "a document room's rows (source, no ref, planned where the document says so) pass verify.py; the page says not built yet", r.out.slice(0, 400)); }

// ---------- the page in the room's frame ----------
const files = { 1: { skill: { id: "studio-baton", v: 1, name: "baton", upstream: "2d7f9b9" }, files: { "index.html": good.html }, summary: "Add percent, handed on" } };
const extra = process.env.BATON_EXTRA_PAGES ? readdirSync(process.env.BATON_EXTRA_PAGES).filter((f) => f.endsWith(".html")).sort() : [];
extra.forEach((f, i) => { files[i + 2] = { skill: { id: "studio-baton", v: 1, name: "baton", upstream: "2d7f9b9" }, files: { "index.html": readFileSync(join(process.env.BATON_EXTRA_PAGES, f), "utf8") }, summary: f }; });
const last = Object.keys(files).length;
const s = await startStudio("baton-page-ui", files);
const browser = withSession(await chromium.launch(), s.base), errors = [], offsite = [];
const context = async (o = {}) => { const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...o });
  await c.addInitScript(() => { try { localStorage.setItem("crew.lang", "en"); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {}
    // in every frame, the page's own one included: what the CSP refused
    window.__csp = []; addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
    if (window === top) addEventListener("DOMContentLoaded", () => document.body.classList.add("chat-closed")); });
  await c.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => { offsite.push(r.request().url()); return r.abort(); }); return c; };
/** open the room on version n and wait for the baton page inside its frame */
const room = async (c, n) => { const w = await c.newPage(); w.on("pageerror", (e) => errors.push(e.message));
  w.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  await w.goto(`${s.base}/#/room/${ID}`); await w.waitForSelector("[data-explain-frame]", { timeout: 20000 });
  if (n !== last) { await w.click("[data-explain-versions]"); await w.waitForSelector("[data-explain-vermenu]"); await w.click(`[data-explain-version="${n}"]`); }
  await w.waitForSelector(`[data-explain-frame="${n}"]`, { timeout: 20000 });
  const fr = await (await w.$(`[data-explain-frame="${n}"]`)).contentFrame(); await fr.waitForSelector("#q", { timeout: 20000 });
  return { w, fr }; };
/** the runbook's step on screen */
const toRunbook = async (fr) => { for (let k = 0; k < 6 && !(await fr.$("article.step.on .kbox table.fmt")); k++) await fr.click("#next");
  await fr.evaluate(() => document.querySelector("article.step.on .kbox")?.scrollIntoView({ block: "start" })); };
try {
  { const c = await context(), { w, fr } = await room(c, 1);
    const iso = await w.$eval('[data-explain-frame="1"]', (f) => ({ sandbox: f.getAttribute("sandbox"), src: f.getAttribute("src") }));
    const inside = await fr.evaluate(() => ({ origin: self.origin, shim: !!document.querySelector('script[data-crew-studio="storage"]'), title: document.querySelector("h1")?.textContent }));
    ok(iso.sandbox === "allow-scripts" && inside.origin === "null" && inside.shim && /Add percent/.test(inside.title ?? ""), "the page is served in the room's frame: sandbox=allow-scripts, an opaque origin, Studio's storage shim first", JSON.stringify({ iso, inside }));

    // "/" focuses the search; typing an error code lists the runbook row first; Enter lands on it with its place marked
    await fr.click("h1"); await fr.press("body", "/");
    const focused = await fr.evaluate(() => document.activeElement?.id);
    await fr.type("#q", "RATE_LIMITED"); await fr.waitForSelector("#qres:not([hidden]) button[role=option]", { timeout: 3000 });
    const hits = await fr.$$eval("#qres button[role=option]", (bs) => bs.map((b) => b.textContent));
    await fr.press("#q", "Enter"); await w.waitForTimeout(400);
    const landed = await fr.evaluate(() => { const st = document.querySelector("article.step.on"), hit = document.querySelector(".qhit");
      return { runbook: !!st?.querySelector(".kbox table.fmt"), hit: hit?.textContent?.slice(0, 60) ?? null, marked: [...st?.querySelectorAll(".fgroup.on") ?? []].map((g) => g.dataset.fg),
        pressed: [...st?.querySelectorAll(".bmap .fm[aria-pressed=true]") ?? []].map((m) => m.dataset.at), open: !document.querySelector("#qres").hidden }; });
    ok(focused === "q" && /RATE_LIMITED/.test(hits[0] ?? "") && landed.runbook && /RATE_LIMITED/.test(landed.hit ?? "") && landed.marked.join() === "api>pay" && landed.pressed.join() === "api>pay" && !landed.open,
      'in the frame, "/" focuses the search, an error code lists its runbook row first, and Enter lands on it with its place on the map marked', JSON.stringify({ focused, hits: hits.slice(0, 3), landed }));
    await w.screenshot({ path: join(shots, "1-search-landed-1440-light.png") });

    // a row's number: focus moves to its place on the map (no mark), and Enter there marks that place's rows
    await fr.evaluate(() => document.querySelectorAll(".fgroup.on, .fm[aria-pressed=true]").forEach((e) => e.click?.()));
    const nos = await fr.$$eval("article.step.on table.fmt a.fno", (as) => as.map((a) => ({ place: a.dataset.place, href: a.getAttribute("href") })));
    const target = nos.find((x) => /^#/.test(x.href)); await fr.focus(`article.step.on table.fmt a.fno[data-place="${target.place}"]`); await w.keyboard.press("Enter"); await w.waitForTimeout(500);
    const jump = await fr.evaluate((place) => { const a = document.activeElement; return { id: a?.id, place: a?.classList.contains("fm"), at: a?.dataset.at, url: location.href.includes("#" + place) }; }, target.place);
    await w.keyboard.press("Enter"); await w.waitForTimeout(200);
    const marks = await fr.$$eval("article.step.on .fgroup.on", (gs) => gs.map((g) => g.dataset.fg));
    ok(nos.length === ROWS.length && jump.id === target.place && jump.place && !jump.url && marks.length === 1 && marks[0] === jump.at,
      "a row's number is an in-page link: Enter moves focus to its place on the map without leaving the page, and Enter there marks that place's rows", JSON.stringify({ nos: nos.length, target, jump, marks }));
    await w.screenshot({ path: join(shots, "2-row-to-map-1440-light.png") });

    // the evidence link: the head-commit permalink, labelled by repository and lines; the frame opens no window for it
    const refs = await fr.$$eval("article.step.on a.fref", (as) => as.map((a) => ({ href: a.getAttribute("href"), text: a.textContent, rel: a.rel, target: a.target })));
    const want = ROWS.filter((r) => r.ref).map((r) => r.ref);
    ok(refs.length === want.length && refs.every((r, i) => r.href === want[i] && r.rel === "noopener noreferrer" && r.target === "_blank") && refs.every((r, i) => r.text.replace(/\u2060/g, "").replace(/\s/g, " ") === `${REPO} · ${want[i].split("/").pop().replace(/#L(\d+)-L(\d+)$/, ":$1–$2")}`),
      "each row's evidence is the permalink at the room's head commit, labelled owner/repo · file:La–Lb", JSON.stringify(refs));
    const pages = c.pages().length, before = fr.url(), seen = errors.length; await fr.click("article.step.on a.fref"); await w.waitForTimeout(600);
    // Chromium says why in the console: the frame has no allow-popups (a page in the room never opens a window of its own)
    const blocked = errors.splice(seen).filter((e) => /Blocked opening .* sandboxed frame whose 'allow-popups' permission is not set/.test(e));
    ok(c.pages().length === pages && fr.url() === before && blocked.length === 1 && !offsite.length, "clicking it in the room's frame opens no window and leaves the page where it is (the frame has no allow-popups); nothing leaves Studio",
      JSON.stringify({ pages: c.pages().length, url: fr.url() === before, blocked, offsite }));

    // #q=<code> on the page's own address opens the first hit (the frame's address, as a link to the page would carry it)
    await w.evaluate(() => { const f = document.querySelector('[data-explain-frame="1"]'); f.dataset.src = f.src; f.src = "about:blank"; });
    await w.waitForTimeout(200);
    await w.evaluate(() => { const f = document.querySelector('[data-explain-frame="1"]'); f.src = f.dataset.src + "#q=ROUNDING_MISMATCH"; });
    await w.waitForTimeout(1500);
    const fr2 = await (await w.$('[data-explain-frame="1"]')).contentFrame(); await fr2.waitForSelector("#q");
    const deep = await fr2.evaluate(() => ({ q: document.querySelector("#q").value, hit: document.querySelector(".qhit")?.textContent?.slice(0, 40) ?? null,
      pressed: [...document.querySelectorAll("article.step.on .bmap .fm[aria-pressed=true]")].map((m) => m.dataset.at) }));
    ok(deep.q === "ROUNDING_MISMATCH" && /ROUNDING_MISMATCH/.test(deep.hit ?? "") && deep.pressed.join() === "api", "#q=ROUNDING_MISMATCH on the page's address opens its runbook row, its place (the Pricing API) marked", JSON.stringify(deep));
    const csp = [...(await w.evaluate(() => window.__csp)), ...(await fr2.evaluate(() => window.__csp))];
    ok(!csp.length, "no CSP violation in Studio or in the page", JSON.stringify(csp));
    await c.close(); }

  // ---------- light and dark, 1440 and 390: the runbook and its map fit, nothing scrolls sideways ----------
  for (const [width, scheme] of [[1440, "dark"], [390, "light"], [390, "dark"]]) {
    const c = await context({ viewport: { width, height: width < 600 ? 844 : 900 }, colorScheme: scheme }), { w, fr } = await room(c, 1);
    await toRunbook(fr); await w.waitForTimeout(300);
    const geo = await fr.evaluate(() => { const st = document.querySelector("article.step.on"), q = document.querySelector("#q").getBoundingClientRect();
      return { runbook: !!st?.querySelector(".kbox table.fmt"), side: document.documentElement.scrollWidth - innerWidth, q: Math.round(q.right) <= innerWidth, dark: matchMedia("(prefers-color-scheme: dark)").matches,
        bg: getComputedStyle(document.body).backgroundColor }; });
    ok(geo.runbook && geo.side <= 0 && geo.q && geo.dark === (scheme === "dark"), `${width} ${scheme}: the runbook step and the search box fit the frame, no sideways scroll`, JSON.stringify(geo));
    await w.screenshot({ path: join(shots, `3-runbook-${width}-${scheme}.png`) });
    await fr.click("h1").catch(() => {}); await fr.press("body", "/"); await fr.type("#q", "429"); await fr.waitForSelector("#qres:not([hidden]) button", { timeout: 3000 }).catch(() => {});
    await w.screenshot({ path: join(shots, `4-search-${width}-${scheme}.png`) });
    await c.close(); }

  // ---------- further pages (BATON_EXTRA_PAGES): each renders in the frame ----------
  for (let n = 2; n <= last; n++) {
    for (const scheme of ["light", "dark"]) {
      const c = await context({ colorScheme: scheme }), { w, fr } = await room(c, n);
      const r = await fr.evaluate(() => ({ steps: document.querySelectorAll("article.step").length, csp: window.__csp }));
      ok(r.steps > 0 && !r.csp.length, `${files[n].summary} (${scheme}): renders in the room's frame, no CSP violation`, JSON.stringify(r));
      await w.screenshot({ path: join(shots, `5-extra-${n}-${scheme}.png`) }); await c.close(); } }
  ok(!errors.length && !offsite.length, "no script error, and no request off Studio", JSON.stringify({ errors, offsite }));
  ok(!existsSync(join(skill, "scripts/__pycache__")), "the vendored folder is left as pinned (no __pycache__)");
} catch (e) { fail++; console.log(`  FAIL  the suite threw: ${e?.stack ?? e}\n${s.log().slice(-3000)}`); }
finally { await browser.close(); s.stop(); }
console.log(`\nreview-baton-page-ui: ${pass} passed, ${fail} failed (screenshots in ${shots})`);
process.exit(fail ? 1 : 0);
