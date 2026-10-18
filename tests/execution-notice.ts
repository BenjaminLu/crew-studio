import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Which execution mode a Studio runs in, said where the captain looks. With the OS sandbox and the egress proxy on (the
// default) the Doctor's sandbox and round-sandbox rows are healthy and nothing warns; with CREW_LOCAL_UNRESTRICTED=1 both rows
// are degraded and the Board and the Doctor each show the "Sandbox off" notice above everything else.
//   bun tests/execution-notice.ts
import { bootStudio, type Studio } from "./acceptance/studio";
import { withSession } from "./boot.mjs";

let pass = 0, fail = 0;
const ok = (c: boolean, name: string, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const studios: Studio[] = [];
let browser: any = null;
try {
  const sandboxed = await bootStudio("notice-sandboxed"), open = await bootStudio("notice-unrestricted", { localUnrestricted: true }); studios.push(sandboxed, open);
  const rows = async (s: Studio) => { const d = (await s.api("/api/doctor")).body; return { d, by: Object.fromEntries((d.items ?? []).map((i: any) => [i.id, i])) as Record<string, any> }; };
  {
    const { d, by } = await rows(sandboxed);
    ok(d.execution === "sandboxed" && (await sandboxed.api("/api/policies")).body.execution === "sandboxed", "the Doctor and the policies say the sandbox is on");
    ok(by.sandbox?.status === "ok" && by["round-sandbox"]?.status === "ok", "with the sandbox on and its prerequisites there, sandbox and round-sandbox are healthy", JSON.stringify([by.sandbox, by["round-sandbox"]]));
  }
  {
    const { d, by } = await rows(open);
    ok(d.execution === "local-unrestricted" && (await open.api("/api/policies")).body.execution === "local-unrestricted", "the Doctor and the policies say local unrestricted mode is on");
    ok(by.sandbox?.status === "degraded" && by["round-sandbox"]?.status === "degraded", "local unrestricted mode marks sandbox and round-sandbox degraded");
  }
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  browser = await chromium.launch({ headless: true });
  for (const [s, on] of [[sandboxed, false], [open, true]] as const) {
    const token = `acceptance-${s.name}-session`; withSession(browser, s.base, token);
    const p = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    for (const route of ["board", "doctor"]) {
      await p.goto(`${s.base}/#/${route}`); await p.locator("h1").first().waitFor();
      if (on) await p.locator('[data-execution="local-unrestricted"]').first().waitFor({ timeout: 8000 }).catch(() => {}); else await p.waitForTimeout(1200);
      const n = await p.locator('[data-execution="local-unrestricted"]').count(), text = n ? await p.locator('[data-execution="local-unrestricted"]').first().innerText() : "";
      ok(on ? n === 1 && /Sandbox off/.test(text) && /CREW_LOCAL_UNRESTRICTED=1/.test(text) : n === 0, `${route}: ${on ? "the Sandbox off notice is shown" : "no sandbox notice while the sandbox is on"}`, `count ${n}`);
    }
    await p.context().close();
  }
} catch (e: any) { ok(false, "unexpected error", String(e?.stack ?? e)); }
finally { await browser?.close(); await Promise.all(studios.map((s) => s.close())); }
console.log(`\nexecution-notice: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
