// Studio's render helper, run with node (playwright needs it). Five modes:
//   film  --html F --out OUT.mp4 [--fps 30] [--width 1600] [--workers 4]
//         an HTML film that defines DUR, render(t), build(), schedule() and #stage (the firstmate
//         promo film's contract): frames by seeking render(t), audio rendered offline from the page's
//         own WebAudio schedule, muxed by ffmpeg. The MP4 is exactly 1920x1080, or 1080x1920 only when
//         #stage itself is a fixed 9:16 box: the viewport is exactly 16:9, so a stage that follows it is
//         captured as authored; a #stage of any other shape (or empty) is forced to 960x540 and the
//         evidence carries a note saying so. No #stage fails fast with code "no-stage".
//   stills --html F --out DIR --times 1.5,6 [--width 1600]      one PNG per time (A/B compare)
//   crop  --html F --out OUT.png --selector S | --bbox x,y,w,h [--width 1280]   a web element crop
//   interact --html F --actions JSON   click each named primary action on a fresh load; report whether the page changed
//   page  --root DIR --page NAME --out OUT.png [--width 1280]   a whole page a change built (hostile): served from DIR over
//         a local http origin (regular files only, real paths inside DIR), scripts off, every request outside that origin
//         (file://, other hosts) refused; prints the refused URLs
// Env: CREW_PLAYWRIGHT_MODULE (path to playwright's index.mjs), CREW_FFMPEG (ffmpeg binary).
import { lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";

const args = process.argv.slice(2);
const mode = args[0];
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const { chromium } = await import(process.env.CREW_PLAYWRIGHT_MODULE);
const FFMPEG = process.env.CREW_FFMPEG || "ffmpeg";
const html = opt("html");
const out = opt("out");
const width = Number(opt("width", mode === "crop" ? 1280 : 1600));
const log = (s) => process.stdout.write(JSON.stringify(s) + "\n");
// Every mode serves only regular, single-link files from its canonical input root.
// An HTTP origin prevents file:// frames/navigation from inheriting file-page access.
const refused = [], servers = [];
const refusal = value => {
  let text = String(value); try { const u = new URL(text); u.username = ""; u.password = ""; u.search = ""; u.hash = ""; text = u.href; } catch { text = text.split(/[?#]/)[0]; }
  text = text.slice(0, 200); if (refused.length < 128 && !refused.includes(text)) refused.push(text);
};
const serveRoot = async rootInput => {
  const root = realpathSync(rootInput);
  const srv = createServer((req, res) => {
    try {
      const rel = decodeURIComponent(new URL(req.url, "http://fixture.invalid").pathname).replace(/^\/+/, "");
      const f = resolve(root, rel); if (!f.startsWith(root + "/")) throw new Error("outside root");
      const real = realpathSync(f), st = lstatSync(f);
      if (!real.startsWith(root + "/") || !st.isFile() || st.isSymbolicLink() || st.nlink > 1) throw new Error("refused");
      const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "application/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".webp": "image/webp" };
      const ext = rel.slice(rel.lastIndexOf(".")); res.writeHead(200, { "content-type": types[ext] ?? "application/octet-stream" }); res.end(readFileSync(real));
    } catch { refusal(req.url); res.writeHead(404); res.end(); }
  });
  await new Promise(r => srv.listen(0, "127.0.0.1", r)); servers.push(srv);
  return `http://127.0.0.1:${srv.address().port}`;
};
const offline = async (ctx, origin) => {
  // HTTP request routing cannot intercept WebSockets. Install before every page.
  if (typeof ctx.routeWebSocket !== "function") throw new Error("renderer WebSocket isolation unavailable: upgrade the optional Playwright tool");
  await ctx.routeWebSocket(() => true, ws => { refusal(ws.url()); ws.close({ code: 1008, reason: "Renderer has no WebSocket capability" }); });
  ctx.on("requestfailed", q => { const u = q.url(); if (!u.startsWith(origin + "/") && !refused.includes(u.slice(0, 200))) refusal(u); });
  await ctx.route(() => true, r => { const u = r.request().url(); if (u.startsWith(origin + "/")) return r.continue(); refusal(u); return r.abort(); });
};

const browser = await chromium.launch();
try {
  const inputOrigin = html && mode !== "page" ? await serveRoot(dirname(resolve(html))) : null;
const inputUrl = inputOrigin ? `${inputOrigin}/${encodeURIComponent(basename(html))}` : null;
  if (mode === "page") {
    const page = opt("page"), origin = await serveRoot(opt("root"));
    const ctx = await browser.newContext({ viewport: { width, height: 800 }, javaScriptEnabled: false, serviceWorkers: "block" });
    await offline(ctx, origin);
    const p = await ctx.newPage();
    p.on("requestfailed", (q) => { const u = q.url(); if (!u.startsWith(origin + "/") && !refused.includes(u.slice(0, 200))) refusal(u); });
    await p.goto(`${origin}/${encodeURIComponent(page)}`); await p.waitForTimeout(150);
    // a frame that shows anything from outside the origin (Chromium refuses a file:// frame on an http page without a request): no picture
    const outside = p.frames().map((f) => f.url()).filter((u) => u && u !== "about:blank" && !u.startsWith(origin + "/") && !u.startsWith("chrome-error://"));
    if (outside.length) { log({ ok: false, error: `a frame loaded from outside the page's origin: ${outside.join(", ").slice(0, 200)}`, refused }); process.exit(3); }
    await p.screenshot({ path: out, fullPage: true });
    log({ ok: true, out, refused, frames: p.frames().map((f) => f.url().slice(0, 200)) });
  } else if (mode === "interact") {
    // a prototype's primary actions, named by the captain. For each: a no-click baseline records which parts of the
    // page change on their own (clocks, carousels) over the same interval; then a fresh load, empty fields filled
    // with plausible values, the click, and only a change the baseline did not make (or another document, or a
    // dialog) counts. Every Playwright wait is bounded; the caller kills the whole run after its own limit.
    const actions = JSON.parse(opt("actions", "[]")).slice(0, 6), results = [];
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
    ctx.setDefaultTimeout(10000); ctx.setDefaultNavigationTimeout(10000);
    await offline(ctx, inputOrigin);
    const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const WAIT = 600;
    const open = async (errors) => {
      const p = await ctx.newPage(); p.setDefaultTimeout(10000);
      p.on("pageerror", (e) => errors.length < 5 && errors.push(String(e?.message ?? e).slice(0, 200)));
      await p.goto(inputUrl); await p.waitForTimeout(250);
      for (const f of await p.locator("input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=checkbox]):not([type=radio]), textarea").all()) {
        try { if (!(await f.isVisible()) || (await f.inputValue())) continue; const t = (await f.getAttribute("type")) ?? "text";
          await f.fill(t === "email" ? "captain@example.com" : t === "number" ? "1" : t === "tel" ? "0912345678" : t === "url" ? "https://example.com" : t === "date" ? "2026-10-17" : "Captain"); } catch {}
      }
      // every DOM mutation from here on, by the mutated element's path
      await p.evaluate(() => { const path = (n) => { const parts = []; let e = n && n.nodeType === 1 ? n : n?.parentElement; while (e && e !== document.documentElement) { parts.unshift(`${e.tagName}:${e.parentElement ? [...e.parentElement.children].indexOf(e) : 0}`); e = e.parentElement; } return parts.join("/"); };
        window.__crewMut = new Set(); new MutationObserver((ms) => { for (const m of ms) window.__crewMut.add(path(m.target)); }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true }); });
      return p;
    };
    const mutated = (p) => p.evaluate(() => window.__crewMut ? [...window.__crewMut] : null).catch(() => null);
    for (const a of actions) {
      const errors = []; let dialog = null, p = null;
      try {
        const base = await open([]); await base.waitForTimeout(WAIT); const spontaneous = new Set((await mutated(base)) ?? []); await base.close().catch(() => {});
        p = await open(errors); p.on("dialog", (d) => { dialog = d.message().slice(0, 200); d.dismiss().catch(() => {}); });
        const named = a.kind === "submit" ? /submit|send|sign up|subscribe|book|order|join|送出|提交|訂閱|報名/i : new RegExp(esc(a.text), "i");
        let target = a.kind === "submit" ? p.locator("form button[type=submit], form input[type=submit], form button:not([type])") : p.getByRole("button", { name: named });
        if (!(await target.count())) target = p.getByRole("button", { name: named }).or(p.getByRole("link", { name: named })).or(p.locator("input[type=submit], input[type=button]").filter({ hasText: named }));
        if (!(await target.count())) { results.push({ ...a, found: false, changed: false, errors }); continue; }
        const path0 = new URL(p.url()).pathname, doc0 = await p.evaluate(() => !!window.__crewMut);
        await target.first().click({ timeout: 3000 }).catch((e) => errors.push(`click: ${String(e?.message ?? e).split("\n")[0].slice(0, 160)}`));
        await p.waitForTimeout(WAIT); await p.waitForLoadState().catch(() => {});
        const got = await mutated(p), path1 = new URL(p.url()).pathname, reloaded = doc0 && got === null;
        const own = (got ?? []).filter((m) => !spontaneous.has(m));
        const text = await p.evaluate(() => document.body?.innerText ?? "").catch(() => "");
        // a reload of the same document (a form with no handler) is not a response; another document is
        results.push({ ...a, found: true, changed: own.length > 0 || path1 !== path0 || !!dialog, navigated: path1 !== path0, reloaded, dialog, errors, ignored: spontaneous.size, text: text.replace(/\s+/g, " ").slice(0, 300) });
      } catch (e) { results.push({ ...a, found: false, changed: false, errors: [...errors, String(e?.message ?? e).slice(0, 200)] }); }
      finally { await p?.close().catch(() => {}); }
    }
    log({ ok: true, results, refused });
  } else if (mode === "crop") {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" });
    await offline(ctx, inputOrigin);
    const p = await ctx.newPage();
    await p.goto(inputUrl);
    await p.waitForTimeout(300);
    const sel = opt("selector"), bb = opt("bbox");
    let clip = null;
    if (sel) { const el = await p.$(sel); const b = el ? await el.boundingBox() : null; if (b) clip = b; }
    if (!clip && bb) { const [x, y, w, h] = bb.split(",").map(Number); clip = { x, y, width: w, height: h }; }
    if (!clip) { log({ ok: false, error: "element not found" }); process.exit(2); }
    const pad = 12;
    clip = { x: Math.max(0, clip.x - pad), y: Math.max(0, clip.y - pad), width: Math.max(8, clip.width + pad * 2), height: Math.max(8, clip.height + pad * 2) };
    await p.screenshot({ path: out, clip, fullPage: true });
    log({ ok: true, out, refused });
  } else if (mode === "stills" || mode === "film") {
    const fps = Number(opt("fps", 30));
    const workers = Math.max(1, Math.min(8, Number(opt("workers", 4))));
    // The film contract is a fixed 16:9 (or 9:16) #stage. A stage sized by the viewport (%, vw, vh)
    // or of another shape is forced to the template's 960x540 (540x960) box before any capture.
    const landscape = { width, height: Math.round(width * 9 / 16) }, portrait = { width: Math.round(width * 9 / 16), height: width };
    const shape = (b) => !b || !(b.width > 0 && b.height > 0) ? null : Math.abs(b.height - b.width * 9 / 16) <= 1 ? "landscape" : Math.abs(b.width - b.height * 9 / 16) <= 1 ? "portrait" : null;
    const box = (p) => p.evaluate(() => { const e = document.getElementById("stage"); if (!e) return null; const r = e.getBoundingClientRect(); return { width: r.width, height: r.height }; });
    let stage = null; const notes = [];
    const force = (p, s) => p.evaluate(({ w, h }) => { const e = document.getElementById("stage"); if (!e) return; for (const [k, v] of [["width", `${w}px`], ["height", `${h}px`], ["min-width", "0"], ["min-height", "0"], ["max-width", "none"], ["max-height", "none"], ["flex", "none"], ["aspect-ratio", "auto"]]) e.style.setProperty(k, v, "important"); }, s);
    const open = async () => {
      const ctx = await browser.newContext({ viewport: stage?.orient === "portrait" ? portrait : landscape, serviceWorkers: "block" });
      await offline(ctx, inputOrigin);
      const p = await ctx.newPage();
      await p.goto(inputUrl);
      await p.waitForTimeout(1500);
      await p.evaluate(() => { const ps = document.getElementById("poster"); if (ps) ps.hidden = true; });
      if (!stage) {
        // The viewport is exactly 16:9, so a stage that follows it (%, vw/vh, scale-to-fit) already
        // measures the right shape and is captured as authored. Only a stage of another shape is forced.
        let measured = await box(p);
        if (!measured) { log({ ok: false, code: "no-stage", error: "the film has no #stage element: the renderer captures only #stage", refused }); process.exit(2); }
        // Orientation comes only from the stage the film wrote: a fixed 9:16 box (it stays 9:16 in this
        // 16:9 viewport, so it cannot be following the viewport) renders portrait; everything else is 16:9.
        let orient = shape(measured) ?? "landscape";
        if (orient === "portrait") { await p.setViewportSize(portrait); measured = await box(p); if (shape(measured) !== "portrait") { orient = "landscape"; await p.setViewportSize(landscape); measured = await box(p); } }
        stage = { orient, measured, forced: shape(measured) === orient ? null : { w: 960, h: 540 } };
        if (orient === "portrait") notes.push(`portrait: #stage is a fixed 9:16 box (${Math.round(measured.width)}x${Math.round(measured.height)}); rendered 1080x1920`);
        if (stage.forced) notes.push(`stage normalized: #stage measured ${Math.round(measured.width)}x${Math.round(measured.height)}, not 16:9 or a fixed 9:16; forced to ${stage.forced.w}x${stage.forced.h} px`);
      }
      if (stage.forced) await force(p, stage.forced);
      return p;
    };
    const first = await open();
    const target = stage.orient === "portrait" ? { w: 1080, h: 1920 } : { w: 1920, h: 1080 };
    const DUR = await first.evaluate(() => DUR);
    if (mode === "stills") {
      mkdirSync(out, { recursive: true });
      for (const t of String(opt("times", "0")).split(",").map(Number)) {
        await first.evaluate((t) => render(t), Math.min(Math.max(0, t), DUR));
        await first.locator("#stage").screenshot({ path: join(out, `t${t.toFixed(2)}.png`) });
      }
      log({ ok: true, out, dur: DUR, refused, stage: stage.measured, normalized: !!stage.forced, notes });
    } else {
      const frames = out + ".frames";
      rmSync(frames, { recursive: true, force: true }); mkdirSync(frames, { recursive: true });
      // audio: render offline from the page's own schedule
      const wav = await first.evaluate(async () => {
        const sr = 48000; const Off = () => new OfflineAudioContext(2, Math.ceil(sr * (DUR + 0.5)), sr);
        window.AudioContext = function () { return Off(); }; window.webkitAudioContext = window.AudioContext;
        muted = false; build(); startAt = 0; schedule(0); const buf = await ctx.startRendering();
        const n = buf.length, L = buf.getChannelData(0), R = buf.getChannelData(1), ab = new ArrayBuffer(44 + n * 4), v = new DataView(ab);
        const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
        w(0, "RIFF"); v.setUint32(4, 36 + n * 4, true); w(8, "WAVEfmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 4, true);
        for (let i = 0; i < n; i++) { v.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true); v.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true); }
        let s = ""; const u = new Uint8Array(ab); for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode.apply(null, u.subarray(i, i + 32768)); return btoa(s);
      }).catch(() => null);
      if (wav) writeFileSync(out + ".wav", Buffer.from(wav, "base64"));
      const N = Math.round(DUR * fps);
      const pages = [first]; for (let i = 1; i < workers; i++) pages.push(await open());
      let done = 0;
      await Promise.all(pages.map(async (p, w) => {
        const st = p.locator("#stage");
        for (let i = w; i <= N; i += workers) {
          await p.evaluate((t) => render(t), Math.min(i / fps, DUR));
          await st.screenshot({ path: join(frames, `f${String(i).padStart(5, "0")}.png`) });
          if (++done % 60 === 0) log({ progress: done / (N + 1) });
        }
      }));
      const ff = [FFMPEG, "-y", "-loglevel", "error", "-framerate", String(fps), "-i", join(frames, "f%05d.png")];
      if (wav) ff.push("-i", out + ".wav");
      ff.push("-vf", `scale=${target.w}:${target.h}:force_original_aspect_ratio=decrease,pad=${target.w}:${target.h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p`, "-c:v", "libx264", "-crf", "20", "-preset", "medium");
      // cut to the video's own length: -shortest can end the mux before the encoder emits a single video packet
      if (wav) ff.push("-c:a", "aac", "-b:a", "192k", "-t", String((N + 1) / fps));
      ff.push(out);
      const r = spawnSync(ff[0], ff.slice(1), { stdio: ["ignore", "inherit", "inherit"] });
      rmSync(frames, { recursive: true, force: true }); rmSync(out + ".wav", { force: true });
      if (r.status !== 0) { log({ ok: false, error: `ffmpeg exited ${r.status}` }); process.exit(3); }
      log({ ok: true, out, dur: DUR, frames: N + 1, refused, width: target.w, height: target.h, stage: stage.measured, normalized: !!stage.forced, notes });
    }
  } else { log({ ok: false, error: `unknown mode ${mode}` }); process.exit(64); }
} finally { await browser.close(); for (const srv of servers) srv.close(); }
