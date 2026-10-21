import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { sessionCookie } from "../src/csrf.ts";
// The one write guard (fix-runtime-r2, check-runtime#16, legacy A5): every mutating
// route Studio's router knows refuses a request from another site, a request with
// no Studio session, and a body that is not JSON. The routes are read from the
// router's own source, so a new route is covered the day it lands.
//   bun tests/write-guard.ts
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { suite } from "./rt-harness";
import { freePort, waitUp } from "./boot.mjs";
const { ok, end } = suite("write-guard");
const root = join(import.meta.dir, "..");
const tmp = mkdtempSync(join(tmpdir(), "crew-guard-")); const data = join(tmp, "data"), state = join(tmp, "state");
for (const d of [data, state, join(tmp, "home"), join(tmp, "proj")]) mkdirSync(d, { recursive: true });
const TOKEN = "guard-test-session";

// every route the router names: literal paths, and one sample path per route pattern
const srcs = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? srcs(join(d, e.name)) : e.name.endsWith(".ts") ? [join(d, e.name)] : []);
const text = srcs(join(root, "src")).map((f) => readFileSync(f, "utf8")).join("\n");
const routes = new Set<string>();
for (const m of text.matchAll(/p === "(\/api\/[^"]+)"/g)) routes.add(m[1]);
for (const m of text.matchAll(/\^\\\/api\\\/([a-z-]+)(?:\\\/)?/g)) routes.add(`/api/${m[1]}/X-1`);
for (const m of text.matchAll(/\^\\\/api\\\/\(([a-z|-]+)\)/g)) for (const s of m[1].split("|")) routes.add(`/api/${s}/X-1`);
const all = [...routes].filter((r) => !/^\/api\/tools\b|^\/api\/remote\/pair$/.test(r)).sort();
ok(all.length >= 60, `the router names many routes (${all.length})`);

const port = await freePort();
const env: any = { ...process.env }; for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN"]) delete env[k];
const app = spawn("bun", ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, CREW_SESSION_TOKEN: TOKEN, CREW_FM_STATE: state, CREW_PORT: String(port), CREW_GH: "0", CREW_READONLY: "1", CREW_DATA: data, CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_GH_NO_CLI: "1", CREW_SANDBOX: "0", HOME: join(tmp, "home"), CREW_MAIN_PROJECT: join(tmp, "proj"), CREW_FILE_ALLOW: tmp } });
const base = `http://127.0.0.1:${port}`;
let errs = ""; app.stderr!.on("data", (d) => (errs += d));
await waitUp(base, app);
const hit = async (path: string, headers: Record<string, string>, body = "{}") => { const r = await fetch(base + path, { method: "POST", headers, body }); let j: any = {}; try { j = await r.json(); } catch {} return { status: r.status, code: j.code }; };
const bad: Record<string, string[]> = { cross: [], session: [], json: [], phonelike: [] };
for (const r of all) {
  const a = await hit(r, { "content-type": "application/json", "x-crew-session": TOKEN, origin: "https://evil.example" }); if (!(a.status === 403 && a.code === "crossSite")) bad.cross.push(`${r}:${a.status}`);
  const s = await hit(r, { "content-type": "application/json", "sec-fetch-site": "same-origin" }); if (!(s.status === 403 && s.code === "session")) bad.session.push(`${r}:${s.status}`);
  const c = await hit(r, { "content-type": "text/plain", "x-crew-session": TOKEN }, "{}"); if (!(c.status === 415 && c.code === "json")) bad.json.push(`${r}:${c.status}`);
  const x = await hit(r, { "content-type": "application/json", "x-crew-session": TOKEN, "sec-fetch-site": "cross-site" }); if (!(x.status === 403 && x.code === "crossSite")) bad.phonelike.push(`${r}:${x.status}`);
}
ok(!bad.cross.length, "every mutating route refuses a request whose Origin is another site, even with the session", bad.cross.join(" "));
ok(!bad.phonelike.length, "every mutating route refuses Sec-Fetch-Site: cross-site", bad.phonelike.join(" "));
ok(!bad.session.length, "every mutating route refuses a request with no Studio session", bad.session.join(" "));
ok(!bad.json.length, "every mutating route refuses a body that is not JSON (415)", bad.json.join(" "));
// the same request, done right, passes the guard
{ const r = await fetch(base + "/api/intake", { method: "POST", headers: { "content-type": "application/json", "x-crew-session": TOKEN, origin: base }, body: JSON.stringify({ text: "fix a typo in the readme" }) });
  ok(r.status === 200, "a same-origin JSON request with the session passes", String(r.status)); }
{ const page = await fetch(base + "/"); const link = await fetch(`${base}/session?t=${TOKEN}`, { redirect: "manual" }); const ck = link.headers.get("set-cookie") ?? "";
  ok(!page.headers.get("set-cookie") && link.status === 303 && ck === sessionCookie(TOKEN), "the page sets no session; the session link sets it as an HttpOnly, SameSite=Strict cookie", ck);
  const r = await fetch(base + "/api/intake", { method: "POST", headers: { "content-type": "application/json", cookie: sessionCookie(TOKEN).split(";")[0], "sec-fetch-site": "same-origin" }, body: "{}" });
  ok(r.status === 200, "the link's cookie is a session", String(r.status)); }
// a grant needs the captain's fresh confirmation in the UI
{ const r = await fetch(base + "/api/policies/auth-window", { method: "POST", headers: { "content-type": "application/json", "x-crew-session": TOKEN }, body: JSON.stringify({ kinds: ["merge"], until: "2099-01-01T00:00:00Z" }) });
  ok(r.status >= 400, "a grant without the UI's fresh confirmation is refused", String(r.status)); }
app.kill();
end();
