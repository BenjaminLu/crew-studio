import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// What the captain is looking at reaches Studio only from the captain's own page on this Mac (docs/units/observe.md "Focus"):
// POST /api/focus with the page's session cookie on a same-origin request. A script's x-crew-session header, a tool token, a
// request without the page's origin, a cross-site one and a paired phone are refused; so is a report carrying anything but
// ids and labels. Sharing off (POST /api/focus/sharing) refuses reports and forgets what was kept.
//      bun tests/observe-focus.ts
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { sessionCookie } from "../src/csrf.ts";
import { suite } from "./rt-harness";
import { freePort, waitUp } from "./boot.mjs";
const { ok, end } = suite("observe-focus");
const root = join(import.meta.dir, ".."), tmp = mkdtempSync(join(tmpdir(), "crew-focus-srv-"));
const home = join(tmp, "home"), data = join(tmp, "data"), state = join(tmp, "fm", "state");
mkdirSync(join(state, "pending"), { recursive: true }); mkdirSync(data, { recursive: true }); mkdirSync(home, { recursive: true });
const port = await freePort(), base = `http://127.0.0.1:${port}`, TOKEN = "test-session-focus";
const env: Record<string, string> = { ...process.env as any }; for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CREW_LOCAL_UNRESTRICTED"]) delete env[k];
const app = spawn("bun", ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, CREW_SESSION_TOKEN: TOKEN, CREW_FM_STATE: state, CREW_PORT: String(port), CREW_GH: "0", CREW_READONLY: "1", CREW_DATA: data,
  CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_GH_NO_CLI: "1", CREW_CLAUDE_BIN: "/nonexistent/claude", CREW_CODEX_BIN: "/nonexistent/codex", HOME: home, CREW_MAIN_PROJECT: join(tmp, "proj"), CREW_FILE_ALLOW: tmp } });
let appLog = ""; app.stdout!.on("data", (d) => (appLog += d)); app.stderr!.on("data", (d) => (appLog += d));
const cookie = sessionCookie(TOKEN).split(";")[0];
const page = { cookie, origin: base, "sec-fetch-site": "same-origin" };
const call = async (method: string, p: string, body: any, headers: Record<string, string>) => { const r = await fetch(base + p, { method, headers: { "content-type": "application/json", ...headers }, body: method === "GET" ? undefined : JSON.stringify(body) }); let j: any = {}; try { j = await r.json(); } catch {} return { status: r.status, ...j }; };
const report = { route: "#/room/PR-0123456789ab-1645", ref: "room:PR-0123456789ab-1645", selection: { kind: "scene", id: "3", label: "場景 3" }, dialog: null, label: "Review room · PR #1645 · 場景 3", tab: "tab-a", visible: true };
try {
  await waitUp(base, app);
  const good = await call("POST", "/api/focus", report, page);
  ok(good.status === 200 && good.sharing === true && good.kept === true, "the captain's page reports what it shows", JSON.stringify(good));
  ok((await call("GET", "/api/focus", null, { cookie })).sharing === true, "sharing is on by default");
  const script = await call("POST", "/api/focus", report, { "x-crew-session": TOKEN });
  const tool = await call("POST", "/api/focus", report, { ...page, "x-crew-tool-token": "t-" + "1".repeat(40) });
  const noOrigin = await call("POST", "/api/focus", report, { cookie });
  const cross = await call("POST", "/api/focus", report, { cookie, origin: "http://evil.example", "sec-fetch-site": "cross-site" });
  const pc = await call("POST", "/api/remote/pair/start", {}, page); const pr = await call("POST", "/api/remote/pair", { code: pc.code, name: "test-phone" }, { origin: base });
  const phone = await call("POST", "/api/focus", report, { authorization: `Bearer ${pr.token}` });
  const phoneRead = await call("GET", "/api/focus", null, { authorization: `Bearer ${pr.token}` });
  ok(script.status === 403 && tool.status === 403 && noOrigin.status === 403 && cross.status === 403 && !!pr.token && phone.status === 403 && phoneRead.status === 403,
    "a script's header, a tool token, no origin, a cross-site request and a paired phone cannot report or read it", JSON.stringify([script.status, tool.status, noOrigin.status, cross.status, !!pr.token, phone.status, phoneRead.status]));
  const typed = await call("POST", "/api/focus", { ...report, draft: "the captain is typing this" }, page);
  const typedSel = await call("POST", "/api/focus", { ...report, selection: { ...report.selection, text: "typed" } }, page);
  ok(typed.status === 400 && typedSel.status === 400, "a report carrying anything but ids and labels (typed text) is refused", JSON.stringify([typed, typedSel]));
  const offSet = await call("POST", "/api/focus/sharing", { on: false }, page);
  const offScript = await call("POST", "/api/focus/sharing", { on: true }, { "x-crew-session": TOKEN });
  const whileOff = await call("POST", "/api/focus", report, page);
  ok(offSet.sharing === false && offScript.status === 403 && whileOff.status === 200 && whileOff.kept === false && whileOff.sharing === false, "the captain turns sharing off; a script cannot turn it back on; a report while off is not kept", JSON.stringify([offSet, offScript.status, whileOff]));
  ok((await call("POST", "/api/focus/sharing", { on: true }, page)).sharing === true, "and on again from the page");
} finally { app.kill(); if (process.env.DEBUG) console.log(appLog.slice(-2000)); }
end();
