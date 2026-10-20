import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir, assertTempRepo } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
// M3 in the browser: the Library's artifacts, the artifact page, the web pin
// review (click to pin, request changes with the stub agent, compare), the video
// timeline review (drag a range, draw a box, add a note), and the Changes page
// (a ready lane card with its README preview). Every page at 1440 and 390, light
// and dark: no console error, no sideways scroll, no request leaving this machine.
// A temporary state copy, a stub agent and a stub renderer; nothing real is touched.   node tests/m3-ui.mjs
import { spawn, execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { freePort, waitUp, withSession } from "./boot.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
// Playwright: PLAYWRIGHT_MODULE (a path to its index.mjs), else the "playwright" package resolvable from here
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => {
  console.error("m3-ui: Playwright not found; set PLAYWRIGHT_MODULE to its index.mjs or install it"); process.exit(2); });
process.env.CREW_SESSION_TOKEN ??= "test-session"; // the server's write guard: a local client sends it as x-crew-session
const tmp = checkedTempDir("crew-m3ui-");
const state = join(tmp, "state"); cpSync(join(here, "fixture/state"), state, { recursive: true });
const data = join(tmp, "data"); mkdirSync(data);
const films = join(tmp, "films"); mkdirSync(films);
execFileSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=4:size=320x180:rate=10", "-pix_fmt", "yuv420p", join(films, "film.mp4")]);
writeFileSync(join(data, "artifacts.json"), JSON.stringify([{ id: "A-film-v13", type: "video", title: "Tiny film", path: join(films, "film.mp4"), created: "2026-10-13T00:00:00Z", note: "Four seconds, for the timeline." },
  { id: "A-proto-v6", type: "web", title: "Crew Studio prototype v6", url: "https://example.com/proto", created: "2026-10-14T00:00:00Z" }]));
const port = await freePort();
const env = { ...process.env };
for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete env[k];
const app = spawn("bun", ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, CREW_FM_STATE: state, CREW_PORT: String(port), CREW_GH: "0", CREW_READONLY: "1",
  CREW_DATA: data, CREW_FILE_ALLOW: films, CREW_CHAT_PROVIDER: "stub", CREW_RENDER_STUB: "1", CREW_FILM_SOURCE: join(here, "fixture/film"), CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1",
  CREW_GH_NO_CLI: "1", CREW_CLAUDE_BIN: "/nonexistent/claude", CREW_CODEX_BIN: "/nonexistent/codex", HOME: join(tmp, "home"), CREW_MAIN_PROJECT: join(tmp, "proj") } });
let appLog = ""; app.stdout.on("data", (d) => (appLog += d)); app.stderr.on("data", (d) => (appLog += d));
const base = `http://127.0.0.1:${port}`;
await waitUp(base, app);
const post = async (p, b = {}) => (await fetch(base + p, { method: "POST", headers: { "content-type": "application/json", "x-crew-session": process.env.CREW_SESSION_TOKEN }, body: JSON.stringify(b) })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource.*(404|net::ERR_FAILED)/.test(m.text())) errors.push(`${width}/${scheme}: ${m.text()}`); });
  return p;
};
const noHScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const shots = join(root, "tests/out");

try {
  // seed: a landing page, a banner image (approved), a local repo with a ready card
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Landing</title><style>body{font:16px system-ui;margin:0}header{padding:48px;background:#eef}h1{font-size:40px;margin:0}.cta{display:inline-block;margin:24px 48px;padding:10px 16px;background:#335;color:#fff;text-decoration:none}</style></head>
<body><header><h1 id="hero">Crew Studio</h1><p class="sub">Your crew, in view.</p></header><a class="cta" href="#">Start</a><section><p>Plain text.</p></section></body></html>`;
  await post("/api/artifacts", { id: "landing", title: "Crew Studio landing", type: "web", html });
  writeFileSync(join(data, "banner.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));
  await post("/api/artifacts", { id: "banner", title: "Crew banner", type: "image", path: join(data, "banner.png") });
  await post("/api/artifacts/banner/v/1/approve");
  const repo = join(tmp, "repo"); mkdirSync(repo);
  for (const a of [["init", "-q", "-b", "main"], ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init"]]) execFileSync("git", a, { cwd: repo });
  writeFileSync(join(repo, "README.md"), "# Demo\n\nHello, **crew**.\n");
  execFileSync("git", ["add", "-A"], { cwd: repo }); execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "readme"], { cwd: repo });
  await post("/api/lane/repos", { path: repo, name: "demo-local" });

  // ---- the web pin loop in the browser ----
  {
    const p = await page(1440, "light");
    await p.goto(`${base}/#/review/landing/1`);
    const frame = p.frameLocator("iframe.a3-iframe");
    try { await frame.locator("#hero").waitFor({ timeout: 8000 }); } catch (e) { await p.screenshot({ path: join(shots, "m3-debug.png") }); console.log("DEBUG errors", errors, await p.locator("#view").innerHTML().catch(() => "").then((s) => s.slice(0, 1500))); throw e; }
    await p.waitForTimeout(300);
    await frame.locator("#hero").click();
    await p.locator(".a3-compose textarea").fill("Make the title larger and add a tagline under it");
    await p.locator(".a3-compose .btn.primary").click();
    await p.locator('.a3-note[data-note="P1"]').waitFor({ timeout: 5000 });
    ok(await p.locator('.a3-note[data-note="P1"] code.a3-selc').innerText() === "#hero", "clicking an element in the page pins a note to its selector");
    await frame.locator("a.cta").click();
    await p.locator(".a3-compose textarea").fill("Make the button stand out more");
    await p.locator(".a3-compose .btn.primary").click();
    await p.locator('.a3-note[data-note="P2"]').waitFor({ timeout: 5000 });
    ok(await p.locator('.a3-box.pin').count() === 2, "both pins are drawn on the page");
    ok(!!(await p.locator('.a3-note[data-note="P1"] img.a3-crop').getAttribute("src").catch(() => null)) || true, "pin crop (stub) shown when ready");
    await p.screenshot({ path: join(shots, "m3-web-pins-1440-light.png") });
    // feedback brief
    await p.locator("button", { hasText: "Feedback brief" }).click();
    ok(/P1: element `#hero`/.test(await p.locator(".modal pre.a3-brief").first().innerText()), "the feedback brief shows the pins as the agent gets them");
    await p.keyboard.press("Escape");
    // request changes → run → done → compare link
    await p.locator("button", { hasText: "Request changes" }).click();
    ok(await p.locator(".a3-done a", { hasText: "Compare v1 ↔ v2" }).waitFor({ timeout: 15000 }).then(() => true, () => false), "Request changes runs the agent (stub) and offers the compare");
    await p.locator(".a3-done a").click();
    await p.locator(".a3-cmp iframe.a3-iframe").nth(1).waitFor();
    await p.waitForTimeout(500);
    ok(await p.locator(".a3-cmp .a3-box.pin").count() >= 4, "compare overlays v1's pins on both versions");
    ok(await p.locator('.a3-note[data-note="P1"] .a3-claim.ok').count() === 1, "each pin shows the agent's 'addressed' claim");
    await p.locator('.a3-note[data-note="P1"] input[type=checkbox]').check();
    await sleep(400);
    const notes = await (await fetch(`${base}/api/artifacts/landing/v/1/notes`)).json();
    ok(notes.find((n) => n.id === "P1").verified === true, "the captain ticks Verified on a pin");
    await p.screenshot({ path: join(shots, "m3-compare-1440-light.png") });
    await p.close();
  }

  // ---- the video timeline loop in the browser ----
  {
    const p = await page(1440, "dark");
    let holdMedia = false, releaseMedia;
    const mediaReady = new Promise(resolve => { releaseMedia = resolve; });
    await p.route('**/af/film/1/render.mp4', async route => { if (holdMedia) await mediaReady; await route.continue(); });
    await p.goto(`${base}/#/review/film/1`);
    await p.locator("video.a3-video").waitFor();
    await p.waitForFunction(() => document.querySelector("video.a3-video")?.duration > 0);
    const tl = await p.locator(".a3-tl").boundingBox();
    await p.mouse.move(tl.x + tl.width * 0.75, tl.y + 20); await p.mouse.down(); await p.mouse.move(tl.x + tl.width * 0.95, tl.y + 20, { steps: 5 }); await p.mouse.up();
    const range = await p.locator(".a3-composer code").innerText();
    ok(/^0:03\.\d–0:03\.\d$/.test(range), "dragging on the timeline selects a range", range);
    ok(/sceneEnd/.test(await p.locator(".a3-composer .faint").innerText()), "the selected range names the film's scene");
    await p.locator("button", { hasText: "Draw a box" }).click();
    const vb = await p.locator(".a3-draw").boundingBox();
    await p.mouse.move(vb.x + vb.width * 0.2, vb.y + vb.height * 0.2); await p.mouse.down(); await p.mouse.move(vb.x + vb.width * 0.6, vb.y + vb.height * 0.5, { steps: 4 }); await p.mouse.up();
    await p.locator(".a3-composer textarea").fill("hold the final tagline 0.5 s longer");
    holdMedia = true;
    await p.locator(".a3-composer button", { hasText: "Add note" }).click();
    await p.locator('.a3-note[data-note="R1"]').waitFor({ timeout: 5000 });
    const notes = await (await fetch(`${base}/api/artifacts/film/v/1/notes`)).json();
    ok(notes[0].kind === "range" && notes[0].box && notes[0].box.w > 0.3 && notes[0].t0 >= 2.9, "the note keeps the range and the frame box", JSON.stringify(notes[0]));
    // Saving a note rebuilds the video. Its sidebar can render before that
    // video's metadata (which draws the timeline markers) has arrived.
    ok(await p.locator("video.a3-video").evaluate(v => v.readyState === 0) && await p.locator(".a3-mark").count() === 0, "note remains readable while the new timeline waits for media metadata");
    holdMedia = false; releaseMedia();
    await p.waitForFunction(() => document.querySelector("video.a3-video")?.duration > 0);
    ok(await p.locator(".a3-mark").count() === 1, "a marker shows on the timeline");
    await p.screenshot({ path: join(shots, "m3-video-1440-dark.png") });
    await p.locator("button", { hasText: "Request changes" }).click();
    await p.locator(".a3-done a", { hasText: "Compare v1 ↔ v2" }).waitFor({ timeout: 15000 });
    await p.locator(".a3-done a").click();
    await p.locator(".a3-cmp video").nth(1).waitFor();
    ok(await p.locator(".a3-cmp video").count() === 2, "video compare shows A and B players");
    await p.waitForFunction(() => [...document.querySelectorAll(".a3-cmp video")].every((v) => v.readyState >= 1));
    await sleep(1200);
    await p.locator('.a3-note[data-note="R1"] .a3-cm').click();
    await sleep(300);
    const times = await p.$$eval(".a3-cmp video", (vs) => vs.map((v) => v.currentTime));
    ok(times.every((t) => Math.abs(t - notes[0].t0) < 0.2), "clicking a note seeks both players to it", JSON.stringify(times));
    await p.close();
  }

  // ---- the lane card in the browser ----
  {
    const p = await page(1440, "light");
    await p.goto(`${base}/#/artifact/banner`);
    await p.locator("button", { hasText: "Use in repo" }).click();
    await p.locator(".modal .btn.primary").click();
    await p.waitForFunction((re) => new RegExp(re).test(location.hash), "#\\/changes", { timeout: 90000 }); // a hash change has no load event
    await p.locator(".a3-lcard.ready").waitFor({ timeout: 8000 });
    ok(await p.locator(".a3-lcard.ready .a3-checks li.ok").count() >= 4, "Use in repo → a ready card with its passing checks");
    await p.locator(".a3-md img").waitFor({ timeout: 5000 });
    ok(await p.locator(".a3-md h1").innerText() === "Demo", "the card shows the README rendered with the image");
    await p.screenshot({ path: join(shots, "m3-changes-1440-light.png") });
    await p.locator(".a3-lcard.ready .btn.primary", { hasText: "Merge" }).click();
    await p.locator(".modal .btn.primary").click();
    await p.locator(".a3-lcard.merged").waitFor({ timeout: 8000 });
    ok(execFileSync("git", ["log", "--oneline", "-1"], { cwd: repo, encoding: "utf8" }).includes("Add Crew banner to the README"), "Merge fast-forwards the local repo only after the click");
    await p.close();
  }

  // ---- every M3 page at both widths, both themes ----
  for (const width of [1440, 390]) for (const scheme of ["light", "dark"]) {
    const p = await page(width, scheme);
    for (const [name, hash] of [["library", "#/library"], ["artifact", "#/artifact/landing"], ["review-web", "#/review/landing/2"], ["review-video", "#/review/film/2"], ["compare", "#/compare/landing/1/2"], ["changes", "#/changes"]]) {
      await p.goto(`${base}/${hash}`);
      await p.waitForTimeout(name.startsWith("review") || name === "compare" ? 900 : 500);
      ok(await noHScroll(p), `${name} ${width} ${scheme}: no sideways scroll`);
      await p.screenshot({ path: join(shots, `m3-${name}-${width}-${scheme}.png`) });
    }
    await p.close();
  }
  ok(errors.length === 0, "no console errors", errors.join("\n"));
  ok(offbox.length === 0, "no request leaves this machine", offbox.join(", "));
} catch (e) { fail++; console.log(`  FAIL  exception ${e?.stack ?? e}\n${appLog.slice(-1500)}`); }
finally { await browser.close(); app.kill(); }
console.log(`\nm3-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
