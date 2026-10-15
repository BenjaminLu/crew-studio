// Starting Studio in a test: a port the OS says is free, and a wait that only
// accepts the server this test started (its pid answers /api/instance) and fails
// loudly when it exits or does not answer in time. Used by every suite that boots
// the server (bun and node alike).
import { createServer } from "node:net";

/** A free local port: bind port 0, read the port, release it. */
export function freePort() {
  return new Promise((resolve, reject) => { const s = createServer(); s.unref(); s.on("error", reject); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}
/** Wait until the server this test started answers; throw (with its stderr) if it exits or never does. */
export async function waitUp(base, app, ms = 45000) {
  let err = ""; try { app.stderr?.on?.("data", (d) => { if (err.length < 20000) err += d; }); } catch {}
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (app.exitCode !== null && app.exitCode !== undefined) throw new Error(`the server exited (${app.exitCode}) before it answered: ${err.slice(-2000)}`);
    try { const r = await fetch(`${base}/api/instance`); if (r.ok) { const j = await r.json(); if (j.pid === app.pid) return; throw new Error(`another server answers on ${base} (pid ${j.pid}, not ${app.pid})`); } }
    catch (e) { if (/another server/.test(String(e?.message))) throw e; }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`the server did not answer on ${base} within ${ms / 1000} s: ${err.slice(-2000)}`);
}
/**
 * Every context and page the browser opens starts its Studio session the way the
 * captain does: through Studio's session link (`crew-studio open`), never from the page.
 */
export function withSession(browser, base, token = process.env.CREW_SESSION_TOKEN) {
  const start = async (ctx) => { const p = await ctx.newPage(); const r = await p.goto(`${base}/session?t=${encodeURIComponent(token)}`); if (!r || !r.ok()) throw new Error(`the session link was refused (${r?.status()})`); await p.close(); };
  const nc = browser.newContext.bind(browser); browser.newContext = async (o) => { const c = await nc(o); await start(c); return c; };
  const np = browser.newPage.bind(browser); browser.newPage = async (o) => { const c = await nc(o); await start(c); const p = await c.newPage(); return p; };
  return browser;
}
