import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The Add local project form's "Choose folder…" (docs/units/local-project-add.md), driven in a browser against the real
// server on temporary data. The page's POST /api/projects/pick-folder is answered by the test (page.route), so no OS
// dialog ever opens; tests/folder-picker.ts covers the route itself.
//   bun tests/folder-picker-ui.mjs          (PLAYWRIGHT_MODULE may point at a playwright install)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { seedProjects } from './projects-fixture.ts';
import { freePort, waitUp, withSession } from './boot.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
let pass = 0, fail = 0; const ok = (v, n, e = '') => { console.log(`${v ? 'ok' : 'FAIL'} ${n} ${v ? '' : e}`); v ? pass++ : fail++; };

const seed = await seedProjects();
const root = join(import.meta.dir, '..'), port = await freePort(), base = `http://127.0.0.1:${port}`;
mkdirSync(join(seed.data, 'fm', 'state'), { recursive: true });
process.env.CREW_SESSION_TOKEN = 'test-session';
const app = spawn('bun', ['src/server.ts'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CREW_DATA: seed.data, CREW_PORT: String(port), CREW_CHAT_PROVIDER: 'stub', CREW_GH: '0', CREW_READONLY: '1', CREW_RETRO_AUTO: '0',
  CREW_SESSION_TOKEN: 'test-session', CREW_FM_STATE: join(seed.data, 'fm', 'state'), CREW_CLAUDE_BIN: '/nonexistent', CREW_CODEX_BIN: '/nonexistent', CREW_CODEX_MODEL: '', CODEX_HOME: join(seed.data, 'codex-config'), CREW_TEAM_SEED: '0' } });
let browser;
try {
  await waitUp(base, app);
  browser = withSession(await chromium.launch({ headless: true }), base);
  // `supported` forces the sidebar read's folderPicker flag, so the suite runs the same on any OS;
  // `answers` are what the stubbed dialog returns, one per click
  const open = async ({ supported = true, answers = [], lang = 'en', width = 1280 } = {}) => {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } }), p = await ctx.newPage(), picks = [], errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    await p.addInitScript((l) => { try { localStorage.setItem('crew.lang', l); localStorage.setItem('crew.chatOpen', '0'); } catch {} }, lang);
    await p.route('**/api/projects/overview', async (route) => { const r = await route.fetch(), j = await r.json(); await route.fulfill({ response: r, json: { ...j, folderPicker: supported } }); });
    await p.route('**/api/projects/pick-folder', async (route) => { picks.push(route.request().method()); const a = answers.shift() ?? { status: 200, json: { cancelled: true } }; if (a.wait) await a.wait; await route.fulfill({ status: a.status ?? 200, json: a.json }); });
    await p.goto(`${base}/#/projects`); await p.locator('[data-add-local-project]').click(); await p.locator('[data-local-project-form]').waitFor();
    const close = async () => { await p.unrouteAll({ behavior: 'ignoreErrors' }); await ctx.close(); };
    return { ctx: { close }, p, picks, errors };
  };
  const field = (p) => p.locator('#project-local-path');
  { // macOS: the button sits by the path field and fills it; a redraw keeps the value; the field stays editable
    const { ctx, p, picks, errors } = await open({ answers: [{ json: { path: '/Users/you/code/harbor' } }, { json: { cancelled: true } }, { status: 409, json: { error: 'A folder dialog is already open. Finish or cancel it first.', code: 'busy' } }] });
    const btn = p.locator('[data-local-project-form] [data-pick-folder]');
    ok(await btn.isVisible() && (await btn.innerText()).includes('Choose folder'), 'macOS: a Choose folder… button is offered');
    ok(await p.evaluate(() => { const b = document.querySelector('[data-pick-folder]'), i = document.getElementById('project-local-path'); return b.parentElement === i.parentElement && b.type === 'button'; }), 'it sits next to the path field and does not submit the form');
    // the pick is answered once the server was asked and the button is back to idle
    await Promise.all([p.waitForResponse('**/api/projects/pick-folder'), btn.click()]);
    await p.waitForFunction(() => { const b = document.querySelector('[data-pick-folder]'); return b && !b.disabled; });
    ok(picks.join() === 'POST', 'one click asks the server once, with a POST', picks.join());
    ok(await field(p).inputValue() === '/Users/you/code/harbor', 'the chosen folder fills the path field');
    await p.evaluate(() => render()); await p.locator('[data-local-project-form]').waitFor();
    ok(await field(p).inputValue() === '/Users/you/code/harbor', 'the chosen path survives a full render()');
    await field(p).fill('/Users/you/code/harbor-typed'); await p.evaluate(() => render());
    ok(await field(p).inputValue() === '/Users/you/code/harbor-typed', 'the field stays editable after a pick, and a redraw keeps the edit');
    await p.locator('[data-pick-folder]').click(); await p.waitForFunction(() => !document.querySelector('[data-pick-folder]')?.disabled); await p.evaluate(() => render());
    ok(await field(p).inputValue() === '/Users/you/code/harbor-typed' && await p.locator('[data-local-project-form] [role=alert]').count() === 0, 'Cancel in the dialog changes nothing and shows no error');
    await p.locator('[data-pick-folder]').click(); await p.locator('[data-local-project-form] [role=alert]').waitFor();
    ok((await p.locator('[data-local-project-form] [role=alert]').innerText()).includes('already open') && await field(p).inputValue() === '/Users/you/code/harbor-typed', 'a refused pick shows its reason and keeps the field');
    ok(!errors.length, 'no page errors', errors.join('; ')); await ctx.close(); }
  { // while the dialog is open the button says so and cannot be pressed again
    let release; const wait = new Promise((r) => (release = r));
    const { ctx, p, picks } = await open({ lang: 'zh-TW', width: 390, answers: [{ wait, json: { path: '/Users/you/code/漁港' } }] });
    const btn = p.locator('[data-pick-folder]');
    ok((await btn.innerText()).includes('選擇資料夾'), 'zh-TW: the button reads 選擇資料夾…');
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '390 px: the row does not overflow');
    await btn.click(); await p.waitForFunction(() => document.querySelector('[data-pick-folder]')?.disabled);
    ok((await p.locator('[data-pick-folder]').innerText()).includes('選擇中'), 'while the dialog is open the button reads 選擇中… and is disabled');
    await p.locator('[data-pick-folder]').click({ force: true }).catch(() => {});
    release(); await p.waitForFunction(() => document.getElementById('project-local-path')?.value === '/Users/you/code/漁港');
    ok(picks.length === 1, 'a second press while open asks nothing', String(picks.length)); await ctx.close(); }
  { // not macOS: no button, the field alone
    const { ctx, p, picks } = await open({ supported: false });
    ok(await p.locator('[data-pick-folder]').count() === 0 && await field(p).isVisible() && picks.length === 0, 'elsewhere than macOS the button is not shown; the field is');
    await ctx.close(); }
} catch (e) { ok(false, 'the suite ran to the end', String(e?.stack || e)); }
finally { await browser?.close(); app.kill(); await new Promise((r) => (app.exitCode !== null ? r() : app.once('exit', r))); }
console.log(`\nfolder-picker-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
