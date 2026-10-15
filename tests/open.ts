// `crew-studio open` picks the browser: --browser / CREW_BROWSER (open -a), else LaunchServices' default http handler (open -b), else a plain open
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
let pass = 0, fail = 0;
const ok = (c: boolean, name: string, detail = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${detail}`); } };
const { defaultHttpHandler } = await import("../src/default-browser");
const LISTING = `(
        {
        LSHandlerContentType = "public.html";
        LSHandlerRoleAll = "com.apple.safari";
    },
        {
        LSHandlerPreferredVersions =         {
            LSHandlerRoleAll = "-";
        };
        LSHandlerRoleAll = "com.google.chrome";
        LSHandlerURLScheme = http;
    },
        {
        LSHandlerRoleAll = "org.example.other";
        LSHandlerURLScheme = https;
    }
)`;
ok(defaultHttpHandler(LISTING) === "com.google.chrome" && defaultHttpHandler("(\n)") === null && defaultHttpHandler(`({ LSHandlerPreferredVersions = { LSHandlerRoleAll = "-"; }; LSHandlerURLScheme = http; })`) === null,
  "the default http handler is read from the http entry's own LSHandlerRoleAll (not the nested preferred-versions one, not another scheme's)", String(defaultHttpHandler(LISTING)));
const tmp = mkdtempSync(join(tmpdir(), "crew-open-")); const log = join(tmp, "argv.log");
const openStub = join(tmp, "open"), defStub = join(tmp, "defaults");
// each call's argv, one element per NUL, a call per record (RS): argument boundaries are kept, so "-a" "Google Chrome" is proven as two elements
const stub = (failOn: string | null) => { writeFileSync(openStub, `#!/bin/sh\nprintf '%s\\0' "$@" >> "${log}"\nprintf '\\036' >> "${log}"\n${failOn ? `case "$*" in *${failOn}*) exit 1;; esac\n` : ""}exit 0\n`); chmodSync(openStub, 0o755); };
const defaults = (body: string | null) => { writeFileSync(defStub, body === null ? "#!/bin/sh\nexit 1\n" : `#!/bin/sh\ncat <<'X'\n${body}\nX\n`); chmodSync(defStub, 0o755); };
const env = (extra: Record<string, string> = {}) => { const e: any = { ...process.env, CREW_DATA: join(tmp, "data"), CREW_PORT: "4999", CREW_OPEN_TOOL: openStub, CREW_DEFAULTS_TOOL: defStub, CREW_SESSION_TOKEN: "sessfixture0123", ...extra }; if (!extra.CREW_BROWSER) delete e.CREW_BROWSER; return e; };
const go = (args: string[], extra: Record<string, string> = {}) => { rmSync(log, { force: true }); const r = Bun.spawnSync(["bun", "src/main.ts", "open", ...args], { cwd: join(import.meta.dir, ".."), env: env(extra), stdout: "pipe", stderr: "pipe" });
  const calls = existsSync(log) ? readFileSync(log, "utf8").split("\x1e").filter(Boolean).map((c) => c.split("\0").slice(0, -1)) : [];
  return { out: r.stdout.toString(), calls }; };
const same = (a: string[] | undefined, b: string[]) => JSON.stringify(a) === JSON.stringify(b);
const URL = "http://127.0.0.1:4999/session?t=sessfixture0123";
stub(null); defaults(LISTING);
const a = go(["--browser", "Google Chrome"]);
ok(a.calls.length === 1 && same(a.calls[0], ["-a", "Google Chrome", URL]) && /Opened Studio's session in Google Chrome/.test(a.out) && !a.out.includes("sessfixture0123"), "--browser <app> opens with open -a <app>, says so, and does not print the link", JSON.stringify(a));
const b = go([], { CREW_BROWSER: "Firefox" });
ok(same(b.calls[0], ["-a", "Firefox", URL]) && /in Firefox/.test(b.out), "CREW_BROWSER does the same", JSON.stringify(b));
const c = go([]);
ok(same(c.calls[0], ["-b", "com.google.chrome", URL]) && /in your default browser \(com\.google\.chrome\)/.test(c.out), "with neither, LaunchServices' default http handler is used explicitly (open -b) and named", JSON.stringify(c));
defaults(null); const d = go([]);
ok(d.calls.length === 1 && same(d.calls[0], [URL]) && /the system's default for links/.test(d.out), "when LaunchServices cannot be read, a plain open", JSON.stringify(d));
defaults(LISTING); stub("com.google.chrome"); const e = go([]);
ok(e.calls.length === 2 && same(e.calls[0], ["-b", "com.google.chrome", URL]) && same(e.calls[1], [URL]) && /the system's default for links/.test(e.out), "when the default handler will not open, a plain open", JSON.stringify(e));
stub("Nope"); const f = go(["--browser", "Nope"]);
ok(same(f.calls[0], ["-a", "Nope", URL]) && same(f.calls[1], ["-b", "com.google.chrome", URL]) && /Could not open Nope/.test(f.out), "an app that will not open falls back to the default browser, saying so", JSON.stringify(f));
stub(null); const h = go(["--browser=Google Chrome"]);
ok(same(h.calls[0], ["-a", "Google Chrome", URL]) && /in Google Chrome/.test(h.out), "--browser=<app> works the same as --browser <app>", JSON.stringify(h));
const i = go(["--browser="], { CREW_BROWSER: "Firefox" });
ok(same(i.calls[0], ["-a", "Firefox", URL]), "an empty --browser= falls back to CREW_BROWSER", JSON.stringify(i));
const j = go(["--browser="]);
ok(j.calls.length === 1 && same(j.calls[0], ["-b", "com.google.chrome", URL]), "an empty --browser= with no CREW_BROWSER falls back to the default browser", JSON.stringify(j));
writeFileSync(openStub, "#!/bin/sh\nexit 1\n"); chmodSync(openStub, 0o755); const g = go([]);
ok(/Open this link in your browser/.test(g.out) && g.out.includes(URL), "when nothing opens, the link is printed for the captain to open", g.out);
rmSync(tmp, { recursive: true, force: true });
console.log(`\nopen: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
