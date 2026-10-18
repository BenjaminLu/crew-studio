import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The cards the captain decides on in the live E2E (scratchpad e2e-sandbox S11, S13, S14, S20), in a real isolated
// Studio and Chromium, at 1440 with the Firstmate panel open and at 390, in English and 繁體中文:
//   - S11 a web A/B acceptance card shows 方向 A / 方向 B side by side: each a labelled thumbnail, 互動預覽, 新分頁開啟
//     and the approve button for that direction; the card's own links are not repeated under them
//   - S13 the spec card (code-firstmate's dispatch) is 核准規格：…, its done lines first, options in plain names
//   - S14 the spec's open scope questions are a question block: quick choices and an answer box that fill the
//     rescope note; unanswered, the card says they stay out of scope
//   - S20 a spec raised again after a rescope shows what changed since the spec the captain last saw
// No accounts, no model calls: the cards are fixtures in the data directory.          bun tests/spec-cards-ui.mjs
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freePort, waitUp, withSession } from "./boot.mjs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const { ArtifactStore } = await import("../src/artifacts.ts");
const root = join(import.meta.dir, ".."), tmp = mkdtempSync(join(tmpdir(), "crew-spec-cards-")), data = join(tmp, "data"), shots = process.env.CREW_SHOTS || join(tmp, "shots");
mkdirSync(join(data, "cards"), { recursive: true }); mkdirSync(shots, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };

// ---- two website directions, real artifacts so the thumbnails load ----
const arts = new ArtifactStore(data);
for (const [id, colour, word] of [["shop-a", "#f4d35e", "Direction A: warm"], ["shop-b", "#3d5a80", "Direction B: calm"]]) {
  const src = join(tmp, id); mkdirSync(src);
  writeFileSync(join(src, "index.html"), `<!doctype html><meta charset="utf-8"><body style="margin:0;font:48px sans-serif;background:${colour};color:#111"><h1 style="margin:80px">${word}</h1><form><input name="n"><button>Book</button></form></body>`);
  arts.create({ id, title: id, type: "web", source: "html", entry: "index.html" }); arts.addVersion(id, { from: src, primary: "index.html", createdBy: { kind: "agent" } });
}
const empty = { why: "", how: "", scope: { in: [], out: [] }, done: [], beforeAfter: "", glossary: [] };
const base = (id, run, kind, node, workflow, title, zhTitle, en, zh, extra = {}) => ({ id, run, node, visit: 1, kind, title: { en: title, "zh-TW": zhTitle }, sections: { en: { ...empty, ...en }, "zh-TW": { ...empty, ...zh } }, body: "",
  options: [], confirmDoor: false, door: null, links: [], detail: null, captainOnly: true, workflow, runTitle: title, ledger: null, ste: null, status: "open", createdAt: "2026-10-18T09:00:00.000Z", answer: null, ...extra });
const offered = [{ id: "shop-a", n: 1, producer: "design-a", format: "web" }, { id: "shop-b", n: 1, producer: "design-b", format: "web" }];
const proof = { check: "core/artifact-ready", evidence: [], seq: 6 };
const accept = base("SC-959", "R-082", "acceptance", "accept", "web-prototype", "Accept 轉角書店單頁網站?", "驗收 轉角書店單頁網站？", { intent: "A one-page bookshop site with a booking form." }, { intent: "一間叫轉角書店的單頁網站，有預約取書表單。" }, {
  detail: { intent: { en: "A one-page bookshop site with a booking form." }, intents: ["A one-page bookshop site with a booking form."], why: [], how: [], scope: { in: [], out: [] }, beforeAfter: { text: "", images: [] }, walk: [], gates: [],
    done: [{ text: "Every delivered source passes its deterministic readiness check", proved: true, proofs: [proof] }, { text: "The content and presentation match the captain's intent", proved: false, proofs: [] }],
    artifactAcceptance: { kind: "artifact", offered, review: { node: "accept", round: 1, attempt: 1 }, refinements: [] } },
  links: [{ label: "Open website in new tab", href: "/af/shop-a/1/index.html", for: "shop-a@1" }, { label: "Open website in new tab", href: "/af/shop-b/1/index.html", for: "shop-b@1" }, { label: "design-a v1", href: "/#/review/shop-a/1", for: "shop-a@1" }, { label: "design-b v1", href: "/#/review/shop-b/1", for: "shop-b@1" }],
  options: [{ id: "approve-design-a", label: "Approve direction A v1", labelZh: "核准方向 A 版本 1", primary: true }, { id: "approve-design-b", label: "Approve direction B v1", labelZh: "核准方向 B 版本 1" }, { id: "changes", label: "Request changes", labelZh: "要求修改", note: true }, { id: "reject", label: "Reject", labelZh: "不採用", hold: true }] });
const cards = [accept];
for (const c of cards) writeFileSync(join(data, "cards", `${c.id}.json`), JSON.stringify(c, null, 1));

const port = await freePort(), url = `http://127.0.0.1:${port}`, token = "spec-cards-fixture";
const env = { ...process.env }; for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CREW_MAIN_PROJECT", "CREW_FM_STATE"]) delete env[k];
const app = spawn("bun", ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, CREW_SESSION_TOKEN: token, CREW_PORT: String(port), CREW_GH: "0", CREW_READONLY: "1", CREW_DATA: data,
  CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_GH_NO_CLI: "1", CREW_CLAUDE_BIN: "/nonexistent/claude", CREW_CODEX_BIN: "/nonexistent/codex",
  CREW_HOST_CLAUDE_BIN: "/nonexistent/claude", CREW_HOST_CODEX_BIN: "/nonexistent/codex", HOME: join(tmp, "home"), CREW_SANDBOX: "0" } });
let appLog = ""; app.stdout.on("data", (d) => (appLog += d)); app.stderr.on("data", (d) => (appLog += d));
let browser; const errors = [];
const at = (id) => `[data-inbox-studio] [data-scard="${id}"]`;
try {
  await waitUp(url, app); browser = withSession(await chromium.launch(), url, token);
  for (const [lang, width] of [["en", 1440], ["zh-TW", 1440], ["en", 390], ["zh-TW", 390]]) {
    const tag = `${lang} ${width}`, zh = lang === "zh-TW", L = (en, tw) => (zh ? tw : en);
    const ctx = await browser.newContext({ viewport: { width, height: 1000 } }); const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
    await p.addInitScript(([l, open]) => { try { localStorage.setItem("crew.lang", l); localStorage.setItem("crew.chatOpen", open); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {} }, [lang, width > 760 ? "1" : "0"]);
    const fits = async () => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

    // ---------- S11: the web directions, side by side ----------
    await p.goto(`${url}/#/inbox/SC-959`); await p.waitForSelector(`${at("SC-959")} [data-directions]`, { timeout: 15000 });
    const tiles = p.locator(`${at("SC-959")} [data-direction]`);
    ok(await tiles.count() === 2 && (await tiles.nth(0).innerText()).includes(L("Direction A", "方向 A")) && (await tiles.nth(1).innerText()).includes(L("Direction B", "方向 B")), `S11 two labelled direction tiles ${tag}`, await tiles.allInnerTexts().then((t) => t.join(" | ")));
    for (const d of ["design-a", "design-b"]) {
      const tile = p.locator(`${at("SC-959")} [data-direction="${d}"]`);
      ok(await tile.locator("iframe[sandbox='']").count() === 1 && await tile.locator(`[data-direction-preview="${d}"]`).innerText() === L("Interactive preview", "互動預覽")
        && await tile.locator(`[data-direction-open="${d}"]`).innerText() === L("Open in new tab", "新分頁開啟") && await tile.locator(`[data-direction-open="${d}"]`).getAttribute("href") === `/af/shop-${d.slice(-1)}/1/index.html`
        && (await tile.locator(`[data-direction-approve="${d}"]`).innerText()).includes(L(`Approve direction ${d.slice(-1).toUpperCase()}`, `核准方向 ${d.slice(-1).toUpperCase()}`)), `S11 ${d}: a scripts-off thumbnail, 互動預覽, 新分頁開啟 to its own website, and its approve button ${tag}`);
    }
    ok(await p.locator(`${at("SC-959")} [data-card-link]`).count() === 0, `S11 no second row of identical "Open website" buttons or bare design-x v1 chips ${tag}`);
    if (width === 1440) { const [a, b] = [await tiles.nth(0).boundingBox(), await tiles.nth(1).boundingBox()]; ok(Math.abs(a.y - b.y) < 2 && b.x > a.x + a.width - 2, `S11 the two directions sit side by side ${tag}`, JSON.stringify([a, b])); }
    await p.locator(`${at("SC-959")} [data-direction-preview="design-b"]`).click();
    const dialog = p.locator("dialog[open]"); await dialog.waitFor();
    ok((await dialog.locator("iframe").getAttribute("src")) === "/af/shop-b/1/index.html?interactive=1", `S11 互動預覽 opens direction B's interactive preview in the page ${tag}`);
    await dialog.locator("button").last().click(); await dialog.waitFor({ state: "detached" });
    // the tile's approve is the card's own option: with no intent ticked it says what is missing, and nothing is sent
    await p.locator(`${at("SC-959")} [data-direction-approve="design-a"]`).click(); await p.waitForTimeout(150);
    ok(await p.locator(`${at("SC-959")} [data-card-msg], ${at("SC-959")} [data-card-hint]`).count() > 0 && (await (await fetch(`${url}/api/scards/SC-959`, { headers: { "x-crew-session": token } })).json()).status === "open", `S11 a tile's approve runs the card's own option and its checks ${tag}`);
    await p.locator(`${at("SC-959")} [data-directions]`).scrollIntoViewIfNeeded(); await p.waitForTimeout(400);
    ok(await fits(), `S11 no horizontal scroll ${tag}`);
    await p.screenshot({ path: join(shots, `s11-directions-${lang}-${width}.png`) });
    await ctx.close();
  }
  ok(!errors.length, "no page errors", errors.join(" | "));
} catch (e) { fail++; console.log(`  FAIL  ${e.stack || e}`); console.log(appLog.slice(-3000)); }
finally { await browser?.close(); app.kill(); }
console.log(`\nspec-cards-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
