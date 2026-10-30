import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The review room's local neural voice on the page (public/review-room.js narration; src/voice): the picker offers
// Kokoro only when Studio says its engine is ready, while this Mac's best voice stays the default; picked, each point is
// asked for as its own clip, the next one while the current one plays, and the caption follows the clip that plays; the
// mixed-language setting is sent with each clip; a clip that fails falls back to this Mac's voice. The room and the
// voice routes are answered by the test: no model, no engine.        node tests/review-room-voice-ui.mjs
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";
const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => {
  console.error("review-room-voice-ui: Playwright not found; set PLAYWRIGHT_MODULE to its index.mjs or install it"); process.exit(2); });
process.env.CREW_SESSION_TOKEN ??= "test-session";
const tmp = mkdtempSync(join(tmpdir(), "crew-room-voice-ui-")), data = join(tmp, "data"); mkdirSync(data);
const port = await freePort();
const env = { ...process.env }; for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete env[k];
const app = spawn("bun", ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, CREW_PORT: String(port), CREW_GH: "0", CREW_READONLY: "1", CREW_DATA: data,
  CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_GH_NO_CLI: "1", CREW_CLAUDE_BIN: "/nonexistent/claude", CREW_CODEX_BIN: "/nonexistent/codex", HOME: join(tmp, "home"), CREW_MAIN_PROJECT: join(tmp, "proj"), CREW_FILE_ALLOW: tmp } });
let appLog = ""; app.stdout.on("data", (d) => (appLog += d)); app.stderr.on("data", (d) => (appLog += d));
const base = `http://127.0.0.1:${port}`;
await waitUp(base, app);
let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const browser = withSession(await chromium.launch(), base);
const errors = [];
const H = "a".repeat(40), B = "b".repeat(40);
const cl = (text) => ({ text, kind: "claim", basis: "inference", cites: [] });
const POINTS = ["The tutor here is Claude, which has no voice of its own.", "This PR rounds to the cent.", "Nothing leaves this Mac."];
const ROOM = { card: { id: "SC-60", run: "R-060", node: "merge-card", title: { en: "Merge: Add percent", "zh-TW": "合併：新增 percent" }, status: "open" }, task: { id: "R-060", title: "Add percent" }, pr: { id: 8, url: null }, head: H, base: B, open: true, running: null,
  offer: { provider: "claude", model: "sonnet", effort: null, paid: true, independence: { level: "vendor", adaptive: true, en: "Another vendor than the author.", zh: "和作者不同供應商。" }, hash: "feedc0ffee654321", voice: null },
  actions: [], board: [], sources: [], check: { questions: [] },
  turns: [{ n: 1, action: "ask", text: "How does it round?", lang: "en", status: "done", provider: "claude", model: "sonnet", answer: "x", claims: POINTS.map(cl) }],
  diffstat: { files: [{ path: "src/percent.ts", added: 4, removed: 0 }], total: { files: 1, added: 4, removed: 0 }, from: "git" } };
const stubs = () => {
  window.__spoken = []; window.__clips = [];
  const mac = (name, uri) => ({ name, lang: "en-US", localService: true, voiceURI: uri });
  Object.defineProperty(window, "speechSynthesis", { configurable: true, value: { getVoices: () => [mac("Ava (Premium)", "ava"), mac("Samantha", "com.apple.voice.compact.en-US.Samantha")], speak: (u) => { window.__spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 5); }, cancel: () => {} } });
  window.SpeechSynthesisUtterance = function (t) { this.text = t; };
  // headless Chromium's own on-device recognizer is never asked (the mic is not what this test is about)
  window.SpeechRecognition = class { static async available() { return "unavailable"; } };
  // a clip "plays" until the test ends it: the test decides when each point is over
  window.Audio = function (src) { const a = { src, onended: null, onerror: null, paused: false, play: async () => { window.__clips.push(a); }, pause() { a.paused = true; } }; return a; };
};
async function open(readyAt, failClip = false) {
  const state = { ready: readyAt, statusAsks: 0, hold: false, held: [], failed: [], resets: 0 };
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  await ctx.addInitScript(() => { try { localStorage.setItem("crew.lang", "en"); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {} addEventListener("DOMContentLoaded", () => document.body.classList.add("chat-closed")); });
  await ctx.addInitScript(stubs);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  const asked = [];
  await ctx.route(/\/api\/review-room\/SC-60(\?open=1)?$/, (r) => r.fulfill({ json: ROOM }));
  await ctx.route(/\/api\/voice\/status(\?fresh=1)?$/, (r) => { state.statusAsks++; const ready = state.ready; r.fulfill({ json: { ready, engine: "kokoro-test", voices: { zh: "zf_xiaobei", en: "af_heart" }, runtime: { ok: ready }, model: { ok: ready, source: "studio" } } }); });
  await ctx.route(/\/api\/review-room\/SC-60\/reset$/, (r) => { state.resets++; r.fulfill({ json: { ok: true, moved: ["room"] } }); });
  await ctx.route(/\/api\/review-room\/SC-60\/voice$/, (r) => { const b = JSON.parse(r.request().postData() || "{}"); asked.push(b); if (state.hold) { state.held.push(r); return; } if (failClip) return r.fulfill({ status: 409, json: { error: "The local voice is not installed", code: "no_voice" } });
    r.fulfill({ json: { src: `/api/review-room/SC-60/voice/kvoice-${String(asked.length).padStart(16, "0")}.wav`, cached: false, engine: "kokoro" } }); });
  const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message)); p.on("requestfailed", (q) => { if (/\/voice$/.test(q.url())) state.failed.push(q.failure()?.errorText || "failed"); }); if (process.env.VOICE_UI_DEBUG) p.on("console", (m) => console.log("console:", m.text().slice(0, 300)));
  await p.goto(`${base}/#/room/SC-60`); await p.waitForSelector("[data-voice]");
  await p.click('[data-jump="t1"]').catch(async () => { await p.click("[data-transcript-toggle]").catch(() => {}); await p.click('[data-jump="t1"]').catch(() => {}); });
  return { ctx, p, asked, state };
}
const caption = (p) => p.$eval("[data-caption-text]", (e) => e.textContent).catch(() => null);
const options = (p) => p.$$eval("[data-voice] option", (els) => els.map((e) => [e.value, e.textContent]));
try {
  // ---------- not ready: the picker is as before ----------
  { const { ctx, p } = await open(false);
    await p.waitForTimeout(300); const o = await options(p);
    ok(!o.some(([v]) => v === "kokoro") && o[0][0] === "auto", "while Studio's local voice is not ready, Kokoro is not offered", JSON.stringify(o));
    await ctx.close(); }
  // ---------- installed or removed in Doctor: the room follows without a reload ----------
  { const { ctx, p, state } = await open(false);
    await p.waitForTimeout(300); state.ready = true; await p.waitForTimeout(1600);
    await p.focus("[data-voice]"); await p.waitForFunction(() => !!document.querySelector('[data-voice] option[value="kokoro"]'), null, { timeout: 5000 }).catch(() => {});
    ok(!!(await p.$('[data-voice] option[value="kokoro"]')), "a model installed in Doctor shows in the room when the picker is opened, without a reload", String(state.statusAsks));
    state.ready = false; await p.waitForTimeout(1600); await p.evaluate(() => window.dispatchEvent(new Event("focus")));
    await p.waitForFunction(() => !document.querySelector('[data-voice] option[value="kokoro"]'), null, { timeout: 5000 }).catch(() => {});
    ok(!(await p.$('[data-voice] option[value="kokoro"]')), "one deleted while away is hidden when the page comes back into focus");
    await ctx.close(); }
  // ---------- ready: offered after this Mac's best voice, the default unchanged ----------
  { const { ctx, p, asked } = await open(true);
    await p.waitForFunction(() => !!document.querySelector('[data-voice] option[value="kokoro"]'));
    const o = await options(p);
    ok(o[0][0] === "auto" && o[1][0] === "kokoro" && /Kokoro local neural voice \(af_heart\)/.test(o[1][1]) && o.some(([v]) => v === "local:ava") && o.some(([v]) => v === "off"), "when the voice API says it is ready, Kokoro is offered right after this Mac's best voice, beside each Mac voice and off", JSON.stringify(o));
    ok((await p.$eval("[data-voice]", (e) => e.value)) === "auto" && !(await p.$("[data-voice-mix]")), "this Mac's best voice stays the default until Kokoro is picked");
    // even a tutor with no voice of its own (Claude) may use it: nothing leaves the Mac
    await p.selectOption("[data-voice]", "kokoro");
    ok((await p.$eval("[data-voice-mix]", (e) => e.value)) === "switch", "picked: the mixed-language setting appears, English words in an English voice by default");
    await p.click("[data-replay]");
    await p.waitForFunction(() => window.__clips.length === 1);
    await p.waitForFunction(() => document.querySelectorAll("[data-voice-mix]").length && true);
    await p.waitForTimeout(100);
    ok(asked.length === 2 && asked[0].text === POINTS[0] && asked[1].text === POINTS[1] && asked.every((b) => b.lang === "en" && b.mix === "switch"), "each point is its own clip: the first is asked for, and the next one while the first plays", JSON.stringify(asked));
    ok((await caption(p)) === POINTS[0] && (await p.evaluate(() => window.__clips[0].src)).endsWith("kvoice-0000000000000001.wav") && !(await p.evaluate(() => window.__spoken.length)), "the caption is the point whose clip plays; no browser voice speaks over it", await caption(p));
    await p.evaluate(() => window.__clips[0].onended());
    await p.waitForFunction(() => window.__clips.length === 2);
    await p.waitForTimeout(100);
    ok((await caption(p)) === POINTS[1] && (await p.evaluate(() => window.__clips[1].src)).endsWith("kvoice-0000000000000002.wav") && asked.length === 3 && asked[2].text === POINTS[2], "when a clip ends the next point shows and its prefetched clip plays at once; the one after it is asked for", JSON.stringify({ c: await caption(p), asked: asked.map((b) => b.text) }));
    await p.evaluate(() => window.__clips[1].onended()); await p.waitForFunction(() => window.__clips.length === 3);
    ok((await caption(p)) === POINTS[2] && asked.length === 3, "the last point plays its clip; nothing more is asked for", String(asked.length));
    await p.evaluate(() => window.__clips[2].onended()); await p.waitForTimeout(500);
    ok((await p.$eval("[data-play]", (e) => e.getAttribute("aria-pressed"))) === "false", "after the last clip the scene stops");
    // the same voice for everything: a different clip, the setting sent along
    await p.selectOption("[data-voice-mix]", "same"); await p.click("[data-replay]"); await p.waitForFunction(() => window.__clips.length === 4);
    ok(asked.at(-1).mix === "same" && asked.slice(3).every((b) => b.mix === "same"), "the mixed-language setting goes with each clip, so the other mode is a clip of its own", JSON.stringify(asked.slice(3)));
    await p.click("[data-play]").catch(() => {});
    ok((await p.evaluate(() => window.__clips[3].paused)), "pausing stops the clip that plays");
    await ctx.close(); }
  // ---------- a clip gone from Studio is asked for again; a stopped play cancels what it waits for; a reset forgets ----------
  { const { ctx, p, asked, state } = await open(true);
    await p.waitForFunction(() => !!document.querySelector('[data-voice] option[value="kokoro"]'));
    await p.selectOption("[data-voice]", "kokoro"); await p.click("[data-replay]"); await p.waitForFunction(() => window.__clips.length === 1);
    await p.evaluate(() => window.__clips[0].onerror()); await p.waitForFunction(() => window.__clips.length === 2, null, { timeout: 5000 }).catch(() => {});
    const firsts = asked.filter((b) => b.text === POINTS[0]).length, second = await p.evaluate(() => window.__clips[1]?.src || "");
    ok(firsts === 2 && second && second !== (await p.evaluate(() => window.__clips[0].src)) && !(await p.evaluate(() => window.__spoken.length)), "a clip whose file is gone is asked for again and the new one plays (no Mac fallback)", JSON.stringify({ firsts, second }));
    await p.click("[data-play]").catch(() => {});
    state.hold = true; await p.selectOption("[data-voice-mix]", "same"); await p.click("[data-replay]");
    await p.waitForFunction(() => true); for (let i = 0; i < 50 && !state.held.length; i++) await p.waitForTimeout(50);
    await p.click("[data-play]").catch(() => {}); for (let i = 0; i < 50 && !state.failed.length; i++) await p.waitForTimeout(50);
    ok(state.held.length >= 1 && state.failed.length >= 1, "pausing while a clip is being made cancels its request, so Studio stops making it", JSON.stringify({ held: state.held.length, failed: state.failed }));
    state.hold = false; await p.selectOption("[data-voice-mix]", "switch");
    if (!(await p.isVisible("[data-room-reset]"))) await p.click("[data-transcript-toggle]").catch(() => {});
    await p.click("[data-room-reset]", { timeout: 3000 }).catch(() => {}); await p.click("[data-reset-confirm]", { timeout: 3000 }).catch(() => {}); for (let i = 0; i < 50 && !state.resets; i++) await p.waitForTimeout(50);
    await p.click('[data-jump="t1"]').catch(async () => { await p.click("[data-transcript-toggle]").catch(() => {}); await p.click('[data-jump="t1"]').catch(() => {}); });
    const before = asked.filter((b) => b.text === POINTS[0] && b.mix === "switch").length; await p.click("[data-replay]");
    for (let i = 0; i < 50 && asked.filter((b) => b.text === POINTS[0] && b.mix === "switch").length === before; i++) await p.waitForTimeout(50);
    ok(state.resets === 1 && asked.filter((b) => b.text === POINTS[0] && b.mix === "switch").length === before + 1, "after the room is started over its clips are asked for anew (their files were deleted)", JSON.stringify({ resets: state.resets, before }));
    await ctx.close(); }
  // ---------- a clip that cannot be made: this Mac's voice speaks instead ----------
  { const { ctx, p, asked } = await open(true, true);
    await p.waitForFunction(() => !!document.querySelector('[data-voice] option[value="kokoro"]'));
    await p.selectOption("[data-voice]", "kokoro"); await p.click("[data-replay]");
    await p.waitForFunction(() => window.__spoken.length >= 1, null, { timeout: 5000 }).catch(() => {});
    ok(asked.length >= 1 && (await p.evaluate(() => window.__spoken[0])) === POINTS[0], "a clip that fails falls back to this Mac's voice for that point", JSON.stringify({ asked, spoken: await p.evaluate(() => window.__spoken) }));
    await ctx.close(); }
  // ---------- Doctor: the voice group, with nothing installed in this test's folders ----------
  { const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 } }); await ctx.addInitScript(() => { try { localStorage.setItem("crew.lang", "en"); localStorage.setItem("crew.onboarding.journey.dismissed.v1", "1"); } catch {} });
    const p = await ctx.newPage(); p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(`${base}/#/doctor`); await p.waitForSelector('[data-doc-group="voice"] [data-item="voice-tts"]', { timeout: 20000 });
    const rows = await p.$$eval('[data-doc-group="voice"] [data-item]', (els) => els.map((e) => [e.dataset.item, e.dataset.status, !!e.querySelector("[data-install]") && e.querySelector("[data-install]").dataset.install]));
    ok(JSON.stringify(rows.map((r) => r[0])) === JSON.stringify(["voice-runtime", "voice-tts", "voice-mac"]) && rows[1][1] === "info" && rows[1][2] === "voice-tts" && ["voice-runtime", "node"].includes(rows[0][2]),
      "Doctor shows the voice group: the runtime and the model not found here, each with its one-click install", JSON.stringify(rows));
    ok(/no text or audio leaves it/.test(await p.textContent('[data-item="voice-tts"]')) && /401 MB/.test(await p.textContent('[data-item="voice-tts"]')), "the model's row names the download's size and that nothing leaves this Mac");
    await ctx.close(); }
  ok(!errors.length, "no page errors", errors.join(" | "));
} catch (e) { fail++; console.log(`  FAIL  ${e?.stack || e}`); }
finally { await browser.close().catch(() => {}); app.kill(); }
if (fail) console.log(appLog.slice(-2000));
console.log(`\nreview-room-voice-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
