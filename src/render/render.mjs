// Studio's render helper, run with node (playwright needs it). Four modes:
//   film  --html F --out OUT.mp4 [--fps 30] [--width 1600] [--workers 4]
//         an HTML film that defines DUR, render(t), build(), schedule() and #stage (the firstmate
//         promo film's contract): frames by seeking render(t), audio rendered offline from the page's
//         own WebAudio schedule, muxed by ffmpeg.
//   stills --html F --out DIR --times 1.5,6 [--width 1600]      one PNG per time (A/B compare)
//   crop  --html F --out OUT.png --selector S | --bbox x,y,w,h [--width 1280]   a web element crop
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
    const open = async () => {
      const ctx = await browser.newContext({ viewport: { width, height: Math.round(width * 9 / 16) + 200 }, serviceWorkers: "block" });
      await offline(ctx, inputOrigin);
      const p = await ctx.newPage();
      await p.goto(inputUrl);
      await p.waitForTimeout(1500);
      await p.evaluate(() => { const ps = document.getElementById("poster"); if (ps) ps.hidden = true; });
      return p;
    };
    const first = await open();
    const DUR = await first.evaluate(() => DUR);
    if (mode === "stills") {
      mkdirSync(out, { recursive: true });
      for (const t of String(opt("times", "0")).split(",").map(Number)) {
        await first.evaluate((t) => render(t), Math.min(Math.max(0, t), DUR));
        await first.locator("#stage").screenshot({ path: join(out, `t${t.toFixed(2)}.png`) });
      }
      log({ ok: true, out, dur: DUR, refused });
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
      ff.push("-vf", "scale=1920:-2,format=yuv420p", "-c:v", "libx264", "-crf", "20", "-preset", "medium");
      if (wav) ff.push("-c:a", "aac", "-b:a", "192k", "-shortest");
      ff.push(out);
      const r = spawnSync(ff[0], ff.slice(1), { stdio: ["ignore", "inherit", "inherit"] });
      rmSync(frames, { recursive: true, force: true }); rmSync(out + ".wav", { force: true });
      if (r.status !== 0) { log({ ok: false, error: `ffmpeg exited ${r.status}` }); process.exit(3); }
      log({ ok: true, out, dur: DUR, frames: N + 1, refused });
    }
  } else { log({ ok: false, error: `unknown mode ${mode}` }); process.exit(64); }
} finally { await browser.close(); for (const srv of servers) srv.close(); }
