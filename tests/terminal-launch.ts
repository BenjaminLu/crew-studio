import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// A Studio window (src/open.ts, docs/units/web-terminal.md "A Studio window"): the commands that open Studio as a Chromium
// app window on each platform, the launch with an injected spawn (no browser ever opens here), the fallback to the default
// browser with the plain link, and the page's POST /api/terminals/app-window: the desktop page's own request only.
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
let pass = 0, fail = 0;
const ok = (c: unknown, name: string, detail = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${detail}`); } };
const tmp = mkdtempSync(join(tmpdir(), "crew-terminal-launch-")), runtime = join(tmp, "runtime");
process.env.CREW_RUNTIME_DIR = runtime; delete process.env.CREW_OPEN_TOOL; process.env.CREW_DEFAULTS_TOOL = "/nonexistent/defaults";
const { appWindowCommands, defaultOpenCommand, requestBrowser } = await import("../src/open");
const { terminalRoutes } = await import("../src/terminals");
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
try {
  // ---------- the commands, per platform ----------
  const T = "file:///tmp/x/browser-1.html";
  ok(same(appWindowCommands("darwin", T, { tool: "open" }).map((c) => c[2]), ["Google Chrome", "Microsoft Edge", "Brave Browser", "Chromium"])
    && same(appWindowCommands("darwin", T, { tool: "open" })[0], ["open", "-na", "Google Chrome", "--args", `--app=${T}`]), "macOS: open -na <browser> --args --app=<file>, Chrome first");
  const win = appWindowCommands("win32", T, { env: { ProgramFiles: "C:\\Program Files", "ProgramFiles(x86)": "C:\\Program Files (x86)", LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" },
    exists: (p) => p === "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" || p === "C:\\Users\\u\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe" });
  ok(same(win, [["C:\\Users\\u\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe", `--app=${T}`], ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", `--app=${T}`]]),
    "Windows: the Chrome and Edge that are installed (Program Files, the user's AppData), each with --app", JSON.stringify(win));
  ok(same(appWindowCommands("win32", T, { env: {}, exists: () => false }), []), "Windows without Chromium: none");
  const lin = appWindowCommands("linux", T, { which: (b) => (b === "chromium" || b === "microsoft-edge" ? `/usr/bin/${b}` : null) });
  ok(same(lin, [["/usr/bin/chromium", `--app=${T}`], ["/usr/bin/microsoft-edge", `--app=${T}`]]), "Linux: the Chromium browsers on PATH, each with --app", JSON.stringify(lin));
  ok(same(defaultOpenCommand("linux", "/f.html"), ["xdg-open", "/f.html"]) && same(defaultOpenCommand("win32", "C:\\f.html"), ["cmd", "/c", "start", "", "C:\\f.html"]), "the default opener: xdg-open, start");

  // ---------- the launch, with the spawn injected ----------
  const inst = { origin: "http://127.0.0.1:4999", token: "launch-secret-0123" } as any;
  const launch = (platform: string, accept: (c: string[]) => boolean, opts: any = {}) => { const calls: string[][] = [];
    const used = requestBrowser(inst, { platform, argv: [], spawn: (c) => { calls.push(c); return accept(c); }, ...opts }); return { used, calls }; };
  const target = (arg: string) => { const f = arg.startsWith("--app=") ? fileURLToPath(arg.slice(6)) : arg; const m = /location\.replace\((".*?")\)/.exec(readFileSync(f, "utf8")); return m ? JSON.parse(m[1]) : ""; };
  const L1 = launch("linux", () => true, { app: true, find: { which: (b: string) => (b === "google-chrome" ? "/opt/google/chrome/google-chrome" : null) } });
  ok(L1.used === "a Studio window (google-chrome)" && L1.calls.length === 1 && L1.calls[0][0] === "/opt/google/chrome/google-chrome" && L1.calls[0][1].startsWith("--app=file://")
    && target(L1.calls[0][1]) === `${inst.origin}/session?t=${inst.token}&w=app`, "Linux: Chrome's app window on the private redirect file, its link marked &w=app", JSON.stringify(L1));
  ok(!JSON.stringify(L1.calls).includes(inst.token), "the token is never in a command line (the file holds it, 0600)");
  ok((statSync(fileURLToPath(L1.calls[0][1].slice(6))).mode & 0o777) === 0o600, "the redirect file is private");
  const L2 = launch("linux", (c) => c[0] === "xdg-open", { app: true, find: { which: (b: string) => (b === "chromium" ? "/usr/bin/chromium" : null) } });
  ok(L2.used === "the system's default for links" && L2.calls.length === 2 && L2.calls[1][0] === "xdg-open" && target(L2.calls[1][1]) === `${inst.origin}/session?t=${inst.token}`,
    "Linux: an app window that does not open falls back to xdg-open with the plain link (a tab is not a Studio window)", JSON.stringify(L2));
  const L3 = launch("win32", () => true, { app: true, find: { env: { ProgramFiles: "C:\\PF" }, exists: (p: string) => p.endsWith("msedge.exe") } });
  ok(L3.used === "a Studio window (msedge.exe)" && same(L3.calls[0].slice(0, 1), ["C:\\PF\\Microsoft\\Edge\\Application\\msedge.exe"]), "Windows: Edge's app window when it is the Chromium installed", JSON.stringify(L3));
  const L4 = launch("win32", () => true, { app: true, find: { env: {}, exists: () => false } });
  ok(L4.calls.length === 1 && same(L4.calls[0].slice(0, 4), ["cmd", "/c", "start", ""]) && target(L4.calls[0][4]) === `${inst.origin}/session?t=${inst.token}`, "Windows without Chromium: the default browser (start)", JSON.stringify(L4));
  const L5 = launch("darwin", (c) => c[2] === "Google Chrome", { app: true });
  ok(L5.used === "a Studio window (Google Chrome)" && same(L5.calls[0].slice(0, 4), ["open", "-na", "Google Chrome", "--args"]), "macOS: Chrome's app window through open -na", JSON.stringify(L5));
  const L6 = launch("linux", () => true, { app: false, find: { which: () => "/usr/bin/chromium" } });
  ok(L6.calls.length === 1 && L6.calls[0][0] === "xdg-open" && target(L6.calls[0][1]) === `${inst.origin}/session?t=${inst.token}`, "app: false (--tab) opens the default browser only");
  const L7 = launch("linux", () => false, { app: true, find: { which: () => null } });
  ok(L7.used === false, "nothing opens: false, and the caller says so");

  // ---------- POST /api/terminals/app-window: the desktop page's own request ----------
  let opened = 0; let answer: string | false = "a Studio window (Google Chrome)";
  const svc = { o: { openWindow: () => { opened++; return answer; } } } as any;
  const base = "http://127.0.0.1:4999", url = new URL(`${base}/api/terminals/app-window`);
  const req = (h: Record<string, string> = {}, method = "POST") => new Request(url, { method, headers: { "content-type": "application/json", ...h }, body: method === "POST" ? "{}" : undefined });
  const page = { origin: base, "sec-fetch-site": "same-origin" };
  const call = async (r: Request, who: any, writing: boolean, cookie: boolean) => { const res = await terminalRoutes(svc, r, url, who, writing, cookie); return { status: res?.status, body: await res?.json() }; };
  let r = await call(req(page), { kind: "desktop" }, true, true);
  ok(r.status === 200 && r.body.used === "a Studio window (Google Chrome)" && opened === 1, "the desktop page (its cookie, same origin) opens a Studio window", JSON.stringify(r));
  r = await call(req(page), { kind: "phone", device: { id: "d1" } }, true, false);
  ok(r.status === 403 && r.body.code === "desktopOnly" && opened === 1, "a phone is refused (desktopOnly), nothing opens", JSON.stringify(r));
  r = await call(req({ ...page, "x-crew-session": "t" }), { kind: "desktop" }, true, false);
  ok(r.status === 403 && r.body.code === "pageOnly" && opened === 1, "a script with x-crew-session but no page cookie is refused (pageOnly)", JSON.stringify(r));
  r = await call(req({ origin: "http://evil.example", "sec-fetch-site": "cross-site" }), { kind: "desktop" }, true, true);
  ok(r.status === 403 && r.body.code === "pageOnly" && opened === 1, "another origin is refused", JSON.stringify(r));
  r = await call(req({}, "GET"), { kind: "desktop" }, false, true);
  ok(r.status === 405 && opened === 1, "a GET opens nothing", JSON.stringify(r));
  answer = false; r = await call(req(page), { kind: "desktop" }, true, true);
  ok(r.status === 502 && r.body.code === "noWindow" && opened === 2, "no browser accepts: 502 noWindow, and the page stays", JSON.stringify(r));
} finally { rmSync(tmp, { recursive: true, force: true }); }
console.log(`\nterminal-launch: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
