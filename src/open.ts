// `crew-studio open`: the captain's explicit step that starts a browser session.
// It reads Studio's session token (data/session-token, 0600, or CREW_SESSION_TOKEN)
// and opens Studio's session link, which sets the session cookie and lands on the
// page. Studio's page never hands out a session by itself.
// The browser: `--browser <app>` or CREW_BROWSER (e.g. "Google Chrome", passed as
// `open -a <app>`); else the default http handler LaunchServices records, used
// explicitly (`open -b <bundle id>`); else a plain `open`. It says which it used.
// The link is never printed when a browser opened it (it carries the session).
//   CREW_OPEN_TOOL / CREW_DEFAULTS_TOOL   stand-ins for open(1) / defaults(1) (tests)
import { join } from "node:path";
import { sessionToken } from "./csrf";
import { DEFAULT_DATA } from "./self";
import { defaultHttpHandler } from "./default-browser";

function browserFlag(argv: string[]): string | null {
  const i = argv.indexOf("--browser"); if (i >= 0 && argv[i + 1]) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith("--browser=")); if (eq && eq.slice("--browser=".length).trim()) return eq.slice("--browser=".length).trim(); // an empty --browser= falls through
  return process.env.CREW_BROWSER?.trim() || null;
}

const data = process.env.CREW_DATA ?? DEFAULT_DATA;
const port = Number(process.env.CREW_PORT ?? 4210);
const url = `http://127.0.0.1:${port}/session?t=${sessionToken(data)}`;
const openTool = process.env.CREW_OPEN_TOOL || "open";
const mac = process.platform === "darwin" || !!process.env.CREW_OPEN_TOOL;
const run = (args: string[]) => { try { return Bun.spawnSync([openTool, ...args, url], { stdout: "ignore", stderr: "pipe" }).success; } catch { return false; } };

let used: string | null = null;
if (mac) {
  const asked = browserFlag(process.argv.slice(3));
  if (asked) { if (run(["-a", asked])) used = asked; else console.log(`Could not open ${asked}; trying your default browser.`); }
  if (!used) {
    let handler: string | null = null;
    try { const d = Bun.spawnSync([process.env.CREW_DEFAULTS_TOOL || "defaults", "read", "com.apple.LaunchServices/com.apple.launchservices.secure", "LSHandlers"], { stdout: "pipe", stderr: "ignore" });
      if (d.success) handler = defaultHttpHandler(d.stdout.toString()); } catch {}
    if (handler && run(["-b", handler])) used = `your default browser (${handler})`;
    else if (run([])) used = "the system's default for links";
  }
}
if (!used) console.log(`Open this link in your browser (it carries Studio's session; keep it to yourself):\n${url}`);
else console.log(`Opened Studio's session in ${used} (${join(data, "session-token")}).`);
export {};
