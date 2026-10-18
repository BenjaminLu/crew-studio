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
  runTitle: "轉角書店單頁網站", detail: { intent: { en: "A one-page bookshop site with a booking form." }, intents: ["A one-page bookshop site with a booking form."], why: [], how: [], scope: { in: [], out: [] }, beforeAfter: { text: "", images: [] }, walk: [], gates: [],
    done: [{ text: "Every delivered source passes its deterministic readiness check", proved: true, proofs: [proof] }, { text: "The content and presentation match the captain's intent", proved: false, proofs: [] }],
    artifactAcceptance: { kind: "artifact", offered, review: { node: "accept", round: 1, attempt: 1 }, refinements: [] } },
  links: [{ label: "Open website in new tab", href: "/af/shop-a/1/index.html", for: "shop-a@1" }, { label: "Open website in new tab", href: "/af/shop-b/1/index.html", for: "shop-b@1" }, { label: "design-a v1", href: "/#/review/shop-a/1", for: "shop-a@1" }, { label: "design-b v1", href: "/#/review/shop-b/1", for: "shop-b@1" }],
  options: [{ id: "approve-design-a", label: "Approve direction A v1", labelZh: "核准方向 A 版本 1", primary: true }, { id: "approve-design-b", label: "Approve direction B v1", labelZh: "核准方向 B 版本 1" }, { id: "changes", label: "Request changes", labelZh: "要求修改", note: true }, { id: "reject", label: "Reject", labelZh: "不採用", hold: true }] });
// the spec card code-firstmate raises after its spec round (src/domain/code.ts cardBodies.dispatch)
const DONE = ["test/percent.test.ts: percent(1999, 15) returns 300 (planned fail-first: percent is not exported on base)", "test/percent.test.ts: percent(-1, 50) rounds half away from zero (planned fail-first)", "The Corner Shop page shows the discount line"];
const spec = base("SC-960", "R-087", "dispatch", "dispatch", "code-firstmate", "Approve the spec: Add percent()", "核准規格：新增 percent()",
  { intent: "Add percent(amount, pct) rounded to integer cents.", why: "Shops need discounts.", how: "A worker builds it on its own branch. Checks and a fresh reviewer judge each round.", done: DONE, scope: { in: ["src/money.ts", "test/percent.test.ts"], out: [] } },
  { intent: "新增 percent(amount, pct)，四捨五入到整數分。", why: "商店需要折扣。", how: "worker 在自己的 branch 上做；每一輪由檢查和全新的 reviewer 判定。", done: DONE, scope: { in: ["src/money.ts", "test/percent.test.ts"], out: [] } },
  { runTitle: "Add percent()", body: "# Add percent()\n\nWhat: percent helper\n\nDone when:\n1. ...\nRepository: /tmp/money-kit (main) · branch crew/R-087",
    spec: { scope: ["src/money.ts", "test/percent.test.ts"], verification: ["app/server.ts"], questions: [{ q: "Negative half-cent ties: which way?", choices: ["Away from zero", "Banker's", "Not supported yet"] }, { q: "Fractional percentages?", choices: [] }] },
    options: [{ id: "dispatch", label: "Approve the spec and start", labelZh: "核准規格並開工", primary: true }, { id: "rescope", label: "Adjust the scope", labelZh: "調整範圍", note: true, noteLabel: "What the new scope adds or removes", noteLabelZh: "新範圍要加入或移除什麼" }, { id: "drop", label: "Drop", labelZh: "放棄" }] });
// the same spec raised again after a rescope: what changed since the spec the captain approved
const respec = { ...spec, id: "SC-961", visit: 2, title: { en: "Approve the spec: Add percent() without the shop test", "zh-TW": "核准規格：新增 percent()（不含商店測試）" }, runTitle: "Add percent() without the shop test",
  spec: { ...spec.spec, questions: [], changed: { since: 2, approved: true, done: { added: ["Studio CI on GitHub runs test/shop.test.ts"], removed: ["test/shop.test.ts passes in the round"] }, scope: { added: [], removed: [] }, verification: { added: [], removed: ["app/server.ts"] } } } };
const cards = [accept, spec, respec];
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
    const posts = [], fixture = Object.fromEntries(cards.map((c) => [c.id, c]));
    await p.route("**/api/scards/*/answer", async (r) => { const body = r.request().postDataJSON(), id = decodeURIComponent(r.request().url().split("/").at(-2)); posts.push({ id, ...body });
      await r.fulfill({ json: { ...fixture[id], status: "answered", answer: { choice: body.choice, note: body.note ?? null, by: "captain", at: new Date().toISOString(), confirm: null } } }); });

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
    await dialog.locator('iframe[src^="/afc/"]').waitFor();
    ok(/^\/afc\/[^/]+\/shop-b\/1\/index\.html\?interactive=1$/.test(await dialog.locator("iframe").getAttribute("src") ?? ""), `S11 互動預覽 opens direction B's interactive preview (path-capability form) in the page ${tag}`);
    await dialog.locator("button").last().click(); await dialog.waitFor({ state: "detached" });
    // the tile's approve is the card's own option, shown only there: not ready without the ticks, and a click says why and sends nothing
    ok(await p.locator(`${at("SC-959")} .cc-actions [data-option^="approve-design"]`).count() === 0 && await p.locator(`${at("SC-959")} [data-option^="approve-design"]`).count() === 2, `S11 the approve buttons for A and B are on their tiles only ${tag}`);
    const approveA = p.locator(`${at("SC-959")} [data-direction-approve="design-a"]`);
    ok(await approveA.getAttribute("data-ready") === "false", `S11 a tile's approve is not ready while the intent line is unticked ${tag}`);
    await approveA.click(); await p.waitForTimeout(200);
    const msg11 = await p.locator(`${at("SC-959")} [data-card-msg]`).innerText();
    ok(msg11 === L("Tick every intent line (0 of 1) or write a note", "請勾完每一條意圖（0/1），或寫備註") && !posts.length && await p.evaluate(() => document.activeElement?.matches("[data-intent-tick]")), `S11 clicking it says what is missing, moves to the tick, and sends nothing ${tag}`, JSON.stringify([msg11, posts]));
    await p.locator(`${at("SC-959")} [data-intent-tick="0"]`).check();
    ok(await approveA.getAttribute("data-ready") === "true" && await p.evaluate(() => document.activeElement?.matches("[data-intent-tick]")), `S11 ticking the line makes the tile's approve ready in place ${tag}`);
    await p.locator(`${at("SC-959")} [data-directions]`).scrollIntoViewIfNeeded(); await p.waitForTimeout(400);
    ok(await fits(), `S11 no horizontal scroll ${tag}`);
    await p.screenshot({ path: join(shots, `s11-directions-${lang}-${width}.png`) });
    // ---------- S13: the spec card: approving the spec, its done lines first ----------
    await p.goto(`${url}/#/inbox/SC-960`); await p.waitForSelector(`${at("SC-960")} [data-spec-done]`, { timeout: 15000 });
    const secs = await p.$$eval(`${at("SC-960")} [data-sec]`, (es) => es.map((e) => e.dataset.sec));
    ok(secs[0] === "done" && secs.indexOf("intent") > 0, `S13 the spec card shows its done lines first ${tag}`, secs.join());
    ok(await p.locator(`${at("SC-960")} [data-spec-done] li`).count() === 3 && (await p.locator(`${at("SC-960")} [data-sec="done"] h4`).innerText()).toLowerCase() === L("Done when", "完成條件").toLowerCase(), `S13 one numbered line per done line, headed Done when ${tag}`);
    ok((await p.locator(`${at("SC-960")} .cc-h b`).innerText()).startsWith(L("Approve the spec: ", "核准規格：")) && (await p.locator(`${at("SC-960")} [data-option]`).allInnerTexts()).map((t) => t.split(" · ")[0]).join("|") === L("Approve the spec and start|Adjust the scope|Drop", "核准規格並開工|調整範圍|放棄"),
      `S13 titled as approving the spec, options in plain names ${tag}`, (await p.locator(`${at("SC-960")} [data-option]`).allInnerTexts()).join("|"));
    ok(await fits(), `S13 no horizontal scroll ${tag}`);
    await p.screenshot({ path: join(shots, `s13-spec-${lang}-${width}.png`) });
    ok((await p.locator(`[data-inbox-row="SC-960"]`).innerText()).includes(L("Add percent()", "新增 percent()")), `S13 the Inbox row names the spec card's Task in the page language ${tag}`, await p.locator(`[data-inbox-row="SC-960"]`).innerText());
    // ---------- S14: the open scope questions are a question block that fills the rescope note ----------
    const qs = p.locator(`${at("SC-960")} [data-spec-question]`);
    ok(await qs.count() === 2 && await qs.nth(0).locator("[data-spec-choice]").count() === 3 && await qs.nth(1).locator("[data-spec-choice]").count() === 0 && await qs.nth(1).locator("[data-spec-answer]").count() === 1, `S14 each question with its quick choices and an answer box ${tag}`);
    ok((await p.locator(`${at("SC-960")} [data-spec-questions-state="open"]`).innerText()).includes(L("stay out of scope", "不在範圍內")), `S14 unanswered, the card says the questions stay out of scope ${tag}`);
    ok((await p.locator(`${at("SC-960")} [data-sec="spec-scope"]`).innerText()).includes("src/money.ts") && (await p.locator(`${at("SC-960")} [data-sec="spec-scope"]`).innerText()).includes("app/server.ts"), `S14 the spec's scope and read-only verification paths show ${tag}`);
    ok(!(await p.locator(`${at("SC-960")} .rt-card-body`).isVisible()), `S14 the full spec text is folded away under the parts shown ${tag}`);
    const box = p.locator(`${at("SC-960")} [data-note-for="rescope"]`), rescope = p.locator(`${at("SC-960")} [data-option="rescope"]`);
    await box.fill("Keep the API small.");
    const banker = qs.nth(0).locator('[data-spec-choice="Banker\'s"]');
    await banker.focus(); await p.keyboard.press("Enter");
    ok(await banker.getAttribute("aria-pressed") === "true" && await p.evaluate(() => document.activeElement?.dataset.specChoice === "Banker's"), `S14 a quick choice is pressed in place and keeps the keyboard focus ${tag}`);
    await qs.nth(1).locator("[data-spec-answer]").pressSequentially(L("Not supported yet", "先不支援"));
    ok(await p.evaluate(() => document.activeElement?.matches("[data-spec-answer]")) && await rescope.getAttribute("data-ready") === "true" && (await p.locator(`${at("SC-960")} [data-spec-questions-state]`).innerText()).includes(L("2 of 2 answered", "已回答 2/2")),
      `S14 typing an answer keeps the focus, makes Adjust the scope ready and updates the count line ${tag}`);
    // the captain adds a line after the answers block: changing an answer replaces the block only
    await box.evaluate((t) => { t.value += "\n\nAlso update the README."; t.dispatchEvent(new Event("input", { bubbles: true })); });
    await qs.nth(0).locator('[data-spec-choice="Away from zero"]').click();
    const note = await box.inputValue();
    ok(note.startsWith("Keep the API small.\n\n") && note.trimEnd().endsWith("Also update the README.") && note.includes("1. Negative half-cent ties: which way? → Away from zero") && !note.includes("Banker's") && note.includes(`2. Fractional percentages? → ${L("Not supported yet", "先不支援")}`),
      `S14 the answers fill one block of the Adjust the scope note; the captain's text before and after it stays ${tag}`, note);
    await p.locator(`${at("SC-960")} [data-sec="questions"]`).scrollIntoViewIfNeeded(); await p.screenshot({ path: join(shots, `s14-questions-${lang}-${width}.png`) });
    // approving the spec with answers on the card would drop them: blocked, with why, and nothing sent
    await p.locator(`${at("SC-960")} [data-option="dispatch"]`).click(); await p.waitForTimeout(200);
    const msg14 = await p.locator(`${at("SC-960")} [data-card-msg]`).innerText();
    ok(msg14 === L('You answered 2 questions: press "Adjust the scope" so the spec takes your answers, or clear the answers and then approve.', "你回答了 2 題：按「調整範圍」讓規格帶入回答；或清除回答後再核准") && !posts.length
      && await p.evaluate(() => document.activeElement?.matches("[data-card-msg]")) && await p.locator(`${at("SC-960")} [data-spec-clear]`).isVisible(), `S14 approving with answers is blocked: it says why, moves the focus there, offers 清除回答, sends nothing ${tag}`, JSON.stringify([msg14, posts]));
    await p.screenshot({ path: join(shots, `s14-blocked-${lang}-${width}.png`) });
    await p.locator(`${at("SC-960")} [data-spec-clear]`).click();
    const cleared = await box.inputValue();
    ok(cleared === "Keep the API small.\n\nAlso update the README." && await p.locator(`${at("SC-960")} [data-spec-questions-state="open"]`).count() === 1 && await p.locator(`${at("SC-960")} [aria-pressed="true"][data-spec-choice]`).count() === 0 && await p.locator(`${at("SC-960")} [data-option="dispatch"]`).getAttribute("data-ready") === "true",
      `S14 清除回答 removes the answers block only; the out-of-scope line is back and approving is ready ${tag}`, cleared);
    await qs.nth(0).locator('[data-spec-choice="Banker\'s"]').click();
    await rescope.click(); await p.waitForTimeout(300);
    const sent = posts.at(-1);
    ok(posts.length === 1 && sent?.choice === "rescope" && /Banker's/.test(sent.note) && sent.note.startsWith("Keep the API small."), `S14 choosing Adjust the scope sends the answers with the captain's own text as its note ${tag}`, JSON.stringify(posts));
    // ---------- S20: a spec raised again says what changed since the approved one ----------
    await p.goto(`${url}/#/inbox/SC-961`); await p.waitForSelector(`${at("SC-961")} [data-sec="spec-changed"]`, { timeout: 15000 });
    const secs2 = await p.$$eval(`${at("SC-961")} [data-sec]`, (es) => es.map((e) => e.dataset.sec));
    const changed = p.locator(`${at("SC-961")} [data-sec="spec-changed"]`);
    ok(secs2[0] === "spec-changed" && secs2[1] === "done", `S20 what changed comes first, then the done lines ${tag}`, secs2.join());
    ok((await changed.locator("h4").innerText()).toLowerCase() === L("What changed since the spec you approved (v2)", "和你核准的規格（v2）相比改了什麼").toLowerCase(), `S20 it names the spec version the captain approved ${tag}`, await changed.locator("h4").innerText());
    ok(await changed.locator('[data-spec-changed="done"] li.add').count() === 1 && await changed.locator('[data-spec-changed="done"] li.del s').count() === 1 && await changed.locator('[data-spec-changed="verification"] li.del').count() === 1 && await changed.locator('[data-spec-changed="scope"]').count() === 0,
      `S20 added and removed done lines and verification paths, nothing for an unchanged scope ${tag}`);
    ok(await fits(), `S20 no horizontal scroll ${tag}`);
    await changed.scrollIntoViewIfNeeded(); await p.screenshot({ path: join(shots, `s20-changed-${lang}-${width}.png`) });
    await ctx.close();
  }
  ok(!errors.length, "no page errors", errors.join(" | "));
} catch (e) { fail++; console.log(`  FAIL  ${e.stack || e}`); console.log(appLog.slice(-3000)); }
finally { await browser?.close(); app.kill(); }
console.log(`\nspec-cards-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
