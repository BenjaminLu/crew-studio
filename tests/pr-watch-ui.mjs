import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Pull requests (docs/units/pr-watch.md) in a browser: the real server on temporary data against the fictional GitHub
// (tests/lib/pr-watch-github.ts). The sidebar item and its count, adding and removing by address, refresh on open, on the
// button and on the interval, the change mark (no read/unread), the columns and tabs, the detail dialog with the matched
// rule, the missing-approval menu (the drafted message, the review room, the report, Markdown), the proposal, a drag and a
// dependency edit, applying through the captain's card in the Inbox, drift and both of its actions, text from GitHub
// rendered as text, and screenshots at 1440 and 390, light and dark, in tests/out/pr-watch/.
//   bun tests/pr-watch-ui.mjs          (PLAYWRIGHT_MODULE may point at a playwright install)
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { freePort, waitUp, withSession } from './boot.mjs';
import { prWatchGitHub, fixtureSettings } from './lib/pr-watch-github.ts';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
let pass = 0, fail = 0; const ok = (v, n, e = '') => { console.log(`${v ? 'ok' : 'FAIL'} ${n} ${v ? '' : e}`); v ? pass++ : fail++; };

const gh = prWatchGitHub();
gh.data.find('northwind/mobile', 5).title = 'App checkout <img src=x onerror="window.__xss=1"> <b>retry</b>';
const root = join(import.meta.dir, '..'), port = await freePort(), base = `http://127.0.0.1:${port}`, data = mkdtempSync(join(tmpdir(), 'crew-prwatch-ui-'));
mkdirSync(join(data, 'fm', 'state'), { recursive: true });
process.env.CREW_SESSION_TOKEN = 'test-session';
const app = spawn('bun', ['src/server.ts'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CREW_DATA: data, CREW_PORT: String(port), CREW_CHAT_PROVIDER: 'stub', CREW_GH: '0', CREW_PR_WATCH: '', // CREW_GH=0 must not turn the list off; an exported CREW_PR_WATCH=0 is not inherited
  CREW_GITHUB_API: gh.origin, CREW_GITHUB_TOKEN: 'fixture-token', CREW_GH_NO_CLI: '1', CREW_PR_WATCH_INTERVAL_MS: '4000', CREW_RETRO_AUTO: '0', CREW_SESSION_TOKEN: 'test-session',
  CREW_FM_STATE: join(data, 'fm', 'state'), CREW_CLAUDE_BIN: '/nonexistent', CREW_CODEX_BIN: '/nonexistent', CREW_CODEX_MODEL: '', CODEX_HOME: join(data, 'codex-config'), CREW_TEAM_SEED: '0' } });
const shots = join(root, 'tests/out/pr-watch'); mkdirSync(shots, { recursive: true });
const api = async (path, body) => { const r = await fetch(`${base}${path}`, body === undefined ? { headers: { 'x-crew-session': 'test-session' } } : { method: 'POST', headers: { 'x-crew-session': 'test-session', 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
const users = () => gh.calls.filter((c) => c.path === '/user').length;
const until = async (f, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await new Promise((r) => setTimeout(r, 150)); } return !!(await f()); };
let browser;
try {
  await waitUp(base, app);
  ok((await fetch(`${base}/api/prs`, { headers: { 'x-crew-session': '' } })).status === 401, 'GET /api/prs without a session: 401');
  ok((await fetch(`${base}/api/prs/watch`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: JSON.stringify({ url: 'https://github.com/northwind/web-app' }) })).status === 403, 'a cross-site write is refused');
  browser = withSession(await chromium.launch({ headless: true }), base);
  const open = async (width, theme) => { const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme, permissions: ['clipboard-read', 'clipboard-write'] }); const p = await ctx.newPage();
    await p.addInitScript(([t]) => { try { localStorage.setItem('crew.theme', t); localStorage.setItem('crew.lang', 'en'); localStorage.setItem('crew.side', 'open'); localStorage.setItem('crew.chatOpen', '0'); } catch {} }, [theme]); return { ctx, p }; };
  const { ctx, p } = await open(1440, 'light');
  await p.goto(`${base}/#/board`); await p.waitForSelector('.nav-item[data-view="prs"]');
  const views = await p.locator('.nav .nav-item:visible').evaluateAll((es) => es.map((e) => e.dataset.view));
  ok(views.indexOf('prs') === views.indexOf('inbox') + 1, 'Pull requests is a top-level sidebar item right after Inbox', JSON.stringify(views));
  await p.click('.nav-item[data-view="prs"]'); await p.waitForSelector('[data-prs-page]:not([data-loading])');
  ok(await p.locator('[data-prs-empty]').isVisible(), 'empty at first: it says to paste an address');
  { const o = await open(1440, 'light'); let failing = true; await o.p.route(/\/api\/prs(\/refresh)?$/, (r) => failing ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' }) : r.continue());
    await o.p.goto(`${base}/#/prs`); await o.p.waitForSelector('[data-prs-load-error]'); failing = false; await o.p.click('[data-prs-retry]'); await o.p.waitForSelector('[data-prs-page]:not([data-loading])');
    ok(await o.p.locator('[data-prs-empty]').isVisible(), 'opening #/prs directly loads it; a failed first load offers Try again, which loads the page'); await o.ctx.close(); }
  // adding by address
  await p.fill('#pwAdd', 'https://gitlab.com/northwind/web-app'); await p.press('#pwAdd', 'Enter');
  await p.waitForSelector('[data-prs-add-error]'); ok(/github\.com/.test(await p.locator('[data-prs-add-error]').innerText()), 'a non-GitHub address is refused with a message');
  for (const u of ['https://github.com/northwind/checkout-api', 'https://github.com/northwind/web-app', 'https://github.com/northwind/ledger', 'https://github.com/northwind/mobile/pull/5']) {
    await p.fill('#pwAdd', u); await p.press('#pwAdd', 'Enter'); await p.waitForFunction((u) => !document.querySelector('#pwAdd')?.value && !document.querySelector('[data-prs-add-error]'), u); }
  ok(await p.locator('[data-prs-repo]').count() === 3 && await p.locator('[data-prs-single="northwind/mobile#5"]').count() === 1, 'three watched repositories and a single pull request show as chips');
  ok((await api('/api/prs/settings', { settings: fixtureSettings })).status === 200, 'settings saved (evidence source, required reviewer, four environments, groups)');
  await p.click('[data-prs-refresh]'); await p.waitForFunction(() => document.querySelectorAll('[data-prs-row]').length === 12, null, { timeout: 20000 });
  ok(await p.locator('[data-prs-row]').count() === 12, 'the refresh button reads GitHub: twelve rows');
  const cols = await p.locator('.pw-row.h [role="columnheader"]').allInnerTexts();
  ok(JSON.stringify(cols.slice(1)) === JSON.stringify(['#', 'Pull request', 'Next step · waits on', 'Missing', 'Depends on', 'Test evidence', 'Environments', 'Reviews', 'Issues', 'Group']), 'the columns, in order', JSON.stringify(cols));
  const next = async (id) => p.locator(`[data-prs-row="${id}"] [data-prs-next]`).getAttribute('data-prs-next');
  ok(await next('northwind/checkout-api#16') === 'failed' && await next('northwind/checkout-api#19') === 'ready' && await next('northwind/checkout-api#11') === 'draft', 'the next step per row (failed evidence is a fix, never ready)');
  ok((await p.locator('[data-prs-row="northwind/checkout-api#17"] [data-prs-next]').innerText()).startsWith('Test only the change since '), 'evidence for an older head: test only the change since');
  ok(await p.locator('#navPrs').innerText() === '3', 'the sidebar count: rows waiting on approval or ready to merge', await p.locator('#navPrs').innerText());
  const tab = async (k) => (await p.locator(`[data-prs-tab="${k}"] .tb-count`).innerText()).trim();
  ok(await tab('all') === '12' && await tab('approve') === '2' && await tab('merge') === '1' && await tab('fix') === '2' && await tab('test') === '3' && await tab('hold') === '1' && await tab('dependency') === '1', 'tab counts by next-step kind', JSON.stringify(await Promise.all(['all', 'approve', 'test', 'fix', 'dependency', 'merge', 'hold'].map(tab))));
  await p.click('[data-prs-tab="approve"]'); ok(await p.locator('[data-prs-row]').count() === 2, 'a tab filters the rows'); await p.click('[data-prs-tab="all"]');
  // text from GitHub is text
  ok(await p.evaluate(() => window.__xss === undefined && !document.querySelector('[data-prs-row="northwind/mobile#5"] img')) && (await p.locator('[data-prs-row="northwind/mobile#5"] .pw-title').innerText()).includes('<img src=x'), 'a title with HTML is shown as text, never run');
  ok(await p.locator('[data-prs-row="northwind/checkout-api#12"] .pw-iss small').innerText() === 'external' && await p.locator('[data-prs-single="northwind/mobile#5"]').count() === 1 && await p.locator('[data-prs-row="northwind/mobile#5"] .badge', { hasText: 'single' }).count() === 1, 'an issue outside the watched repositories is marked external; the single pull request is marked single');
  ok(await p.locator('[data-prs-row="northwind/checkout-api#19"] .pw-unreg').count() === 1, 'a repository that is not a registered project gets the grey mark');
  ok(!(await p.locator('text=/mark as read|\\bunread\\b/i').count()), 'no read/unread state anywhere');
  // the detail dialog
  await p.click('[data-prs-row="northwind/checkout-api#16"] .pw-title'); await p.waitForSelector('[data-prs-dialog="detail"]');
  ok(await p.locator('[data-prs-rules] li.hit').getAttribute('data-rule') === 'failed' && (await p.locator('[data-prs-dialog="detail"]').innerText()).includes('Fee lookup'), 'a row opens its detail: the matched rule highlighted');
  ok(await p.locator('[data-prs-dialog="detail"] a').first().evaluate((a) => getComputedStyle(a).textDecorationLine) === 'none' && !(await p.locator('.pw-dtitle a').innerText()).includes('Fee lookup'), 'links in the dialog use Studio\'s link style; the title is text');
  await p.screenshot({ path: join(shots, 'detail-1440-light.png') }); await p.keyboard.press('Escape');
  // the missing-approval menu
  await p.click('[data-prs-cta="northwind/checkout-api#18"]'); await p.waitForSelector('[data-prs-menu]');
  await p.click('[data-prs-action="ask"]'); await p.waitForSelector('[data-prs-dialog="ask"]');
  const msg = await p.locator('[data-prs-message]').inputValue();
  ok(msg.includes('northwind/checkout-api#18') && msg.includes('@dana') && msg.includes('release') && msg.includes('https://github.com/northwind/checkout-api/pull/18'), 'Ask for review drafts a message naming the missing people', msg);
  ok(await p.locator('[data-prs-send]').isDisabled() && /connector/.test(await p.locator('[data-prs-connector]').innerText()), 'Send via connector is disabled, with the reason');
  await p.click('[data-prs-copy]'); ok((await p.evaluate(() => navigator.clipboard.readText())).includes('@dana'), 'Copy puts the message on the clipboard');
  await p.route('**/api/review-room/open-pr', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'PR-x', room: {}, href: '#/room/PR-x' }) }));
  let asked = null; p.on('request', (r) => { if (r.url().endsWith('/api/review-room/open-pr')) asked = r.postDataJSON(); });
  await p.click('[data-prs-cta="northwind/checkout-api#18"]'); await p.click('[data-prs-action="room"]'); await until(() => p.url().includes('#/room/PR-x'), 5000);
  ok(asked?.url === 'https://github.com/northwind/checkout-api/pull/18' && p.url().endsWith('#/room/PR-x'), 'Open in the review room asks the review room for that pull request and opens it', JSON.stringify(asked));
  await p.unroute('**/api/review-room/open-pr'); await p.goto(`${base}/#/prs`); await p.waitForSelector('[data-prs-row]');
  await p.click('[data-prs-cta="northwind/checkout-api#18"]'); await p.click('[data-prs-action="report"]'); await p.waitForSelector('[data-prs-dialog="report"]');
  await p.click('[data-prs-report-copy]'); const rep = await p.evaluate(() => navigator.clipboard.readText());
  ok(rep.startsWith('# Handoff: northwind/checkout-api#18') && rep.includes('| # | Pull request |'), 'the handoff report is copied as Markdown (its Task is a follow-up)', rep.slice(0, 200));
  await p.click('[data-prs-md]'); const md = await p.evaluate(() => navigator.clipboard.readText());
  ok(md.split('\n').length === 14 && md.includes('[northwind/checkout-api#19](https://github.com/northwind/checkout-api/pull/19)'), 'Copy as Markdown (the toolbar): the visible rows');
  await p.click('[data-prs-cta="northwind/checkout-api#18"]'); await p.click('[data-prs-action="md"]'); const md1 = await p.evaluate(() => navigator.clipboard.readText());
  ok(md1.split('\n').length === 3 && md1.includes('northwind/checkout-api#18') && !md1.includes('checkout-api#19'), 'the row menu copies only that row', md1);
  ok(await p.locator('body > .toast').count() === 1, 'one toast at a time: a new one replaces the last', String(await p.locator('body > .toast').count()));
  await p.click('[data-prs-cta="northwind/checkout-api#12"]'); await p.click('[data-prs-action="report"]'); await p.click('[data-prs-report-copy]'); const rep12 = await p.evaluate(() => navigator.clipboard.readText());
  ok(rep12.includes('https://github.com/northwind/platform-issues/issues/7') && !rep12.includes('Capture retries double-charge'), 'copied text leaves out the title of an issue outside the watched repositories (the link stays)', rep12);
  ok(await p.locator('[data-prs-row="northwind/ledger#40"] .pw-next small').innerText() === 'approval rules could not be read', 'unreadable rules: the subtitle says so, no "waits on"');
  const cta = await p.locator('[data-prs-cta="northwind/checkout-api#18"]').evaluate((e) => ({ h: e.getBoundingClientRect().height, t: e.getAttribute('title'), text: e.innerText }));
  ok(cta.h < 44 && cta.t === '1 more approval · @dana · @northwind/release' && cta.text.replace(/\s+/g, ' ').includes('+1 · @dana · @release') && !/missing|more approval/.test(cta.text), 'the missing-approval button shows the count and the names (at most two lines), teams written one way', JSON.stringify(cta));
  await p.click('[data-prs-cta="northwind/checkout-api#18"]'); const exp = await p.locator('[data-prs-cta="northwind/checkout-api#18"]').getAttribute('aria-expanded'); await p.keyboard.press('Escape');
  ok(exp === 'true' && await p.locator('[data-prs-cta="northwind/checkout-api#18"]').getAttribute('aria-expanded') === 'false' && await p.locator('[data-prs-cta][aria-haspopup]').count() === 0, 'the missing-approval button says whether its actions are open (aria-expanded), no popup role it does not have', JSON.stringify([exp, await p.locator('[data-prs-cta="northwind/checkout-api#18"]').getAttribute('aria-expanded'), await p.locator('[data-prs-cta][aria-haspopup]').count()]));
  await p.click('[data-prs-cta="northwind/checkout-api#18"]'); await p.waitForSelector('[data-prs-menu]'); await p.click('[data-prs-cta="northwind/checkout-api#18"]');
  ok(await p.locator('[data-prs-menu]').count() === 0 && await p.locator('[data-prs-cta="northwind/checkout-api#18"]').getAttribute('aria-expanded') === 'false', 'a second click on the missing-approval button closes its menu instead of reopening it');
  ok((await p.locator('[data-prs-cta="northwind/web-app#30"] .pw-ctat').innerText()) === '+1 approval', 'a missing count with no names reads "+1 approval"', await p.locator('[data-prs-cta="northwind/web-app#30"] .pw-ctat').innerText());
  ok((await p.locator('[data-prs-row="northwind/checkout-api#16"] [data-prs-next]').innerText()) === 'Fix the failing tests', 'next-step words follow one pattern');
  const fit = await p.evaluate(() => { const t = document.querySelector('[data-prs-table]'); return { sw: t.scrollWidth, cw: t.clientWidth }; });
  ok(fit.sw <= fit.cw + 1, 'at 1440 with the sidebar open all eleven columns fit without scrolling', JSON.stringify(fit));
  ok(await p.locator('[data-prs-tab][role="tab"], [data-prs-tab][aria-selected]').count() === 0 && await p.locator('[data-prs-tab="all"]').getAttribute('aria-pressed') === 'true' && await p.locator('[data-prs-page] [role="tablist"], [data-prs-page] [role="tab"], .pw-menu [role="menuitem"], .pw-menu[role="menu"]').count() === 0, 'filters are pressed buttons (no tab or menu roles without their keys)');
  await p.focus('[data-prs-row="northwind/checkout-api#13"]'); await p.evaluate(() => window.crewPrs.reload()); await p.waitForTimeout(400);
  ok(await p.evaluate(() => document.activeElement?.dataset?.prsRow) === 'northwind/checkout-api#13', 'a live update gives the keyboard focus back to the row that had it');
  // the proposal, a drag and a dependency edit
  ok(await p.locator('[data-prs-proposed-dep="northwind/checkout-api#14>northwind/checkout-api#15"]').count() === 1 && /Depends-on/.test(await p.locator('[data-prs-proposal]').innerText()), 'the proposal shows each dependency with its reason');
  ok(await p.locator('[data-prs-row="northwind/checkout-api#14"] .pw-prop-tag').count() === 1 && await p.locator('[data-prs-row="northwind/checkout-api#14"] .pw-proposed-pos').count() === 1, 'the row shows the dependency and its position as proposed');
  const fitsCell = await p.locator('[data-prs-row="northwind/checkout-api#14"] .pw-prop-tag').evaluate((t) => { const cell = t.closest('[role="cell"]').getBoundingClientRect(), r = t.getBoundingClientRect(); return r.right <= cell.right + 1; });
  ok(fitsCell, 'the proposed tag stays inside the Depends on column');
  await p.screenshot({ path: join(shots, 'list-1440-light.png'), fullPage: true });
  const firstId = await p.locator('[data-prs-row]').first().getAttribute('data-prs-row'), lastId = await p.locator('[data-prs-row]').nth(2).getAttribute('data-prs-row');
  await p.locator(`[data-prs-row="${firstId}"]`).scrollIntoViewIfNeeded();
  const saved = p.waitForResponse((r) => r.url().endsWith('/api/prs/order') && r.request().method() === 'POST');
  await p.locator(`[data-prs-row="${lastId}"] .pw-grip`).dragTo(p.locator(`[data-prs-row="${firstId}"]`)); await saved;
  await until(async () => (await p.locator('[data-prs-row]').first().getAttribute('data-prs-row')) === lastId);
  ok(await p.locator('[data-prs-row]').first().getAttribute('data-prs-row') === lastId && (await api('/api/prs')).body.rows[0].id === lastId, 'a drag (the third row onto the first) reorders, saved in Studio', `${firstId} ${lastId} ${await p.locator('[data-prs-row]').first().getAttribute('data-prs-row')} ${(await api('/api/prs')).body.rows.map((r) => r.id).join()}`);
  ok(await p.locator('.pw-proposed-pos').count() === 0, 'after a drag no position is proposed');
  await p.focus(`[data-prs-row="${lastId}"]`); await p.keyboard.press('Alt+ArrowDown');
  await until(async () => (await api('/api/prs')).body.rows[1]?.id === lastId);
  ok((await api('/api/prs')).body.rows[1].id === lastId, 'Alt+Down moves a row from the keyboard');
  await p.click('[data-prs-deps="northwind/checkout-api#19"]'); await p.waitForSelector('[data-prs-dialog="deps"]');
  await p.selectOption('[data-prs-dep-add]', 'northwind/checkout-api#18'); await p.waitForSelector('[data-prs-dep-rm="northwind/checkout-api#18"]');
  await p.keyboard.press('Escape');
  ok(await next('northwind/checkout-api#19') === 'dependency' && (await api('/api/prs')).body.rows.find((r) => r.id === 'northwind/checkout-api#19').deps.source === 'captain', 'a dependency edit becomes Studio\'s record for that row, and the next step follows it');
  // accept, then apply through the card
  await p.click('[data-prs-accept]'); await p.waitForSelector('[data-prs-proposal]', { state: 'detached' });
  ok(await p.locator('[data-prs-row="northwind/checkout-api#14"] .pw-prop-tag').count() === 0, 'accepting takes the proposal: nothing shows as proposed');
  const before = gh.data.find('northwind/checkout-api', 14).body;
  await p.click('[data-prs-deps="northwind/checkout-api#14"]'); await p.click('[data-prs-dep-apply]'); await p.waitForSelector('[data-prs-dialog="apply"]');
  ok((await p.locator('[data-prs-target="northwind/checkout-api#14"] pre').innerText()) === '<!-- crew-studio:depends -->\nDepends-on: https://github.com/northwind/checkout-api/pull/15\n<!-- /crew-studio:depends -->', 'the apply dialog shows the exact block');
  await p.click('[data-prs-apply-send]'); await p.waitForSelector('[data-prs-dialog="apply"]', { state: 'detached' });
  ok(!gh.calls.some((c) => c.method === 'PATCH'), 'sending the card writes nothing yet');
  await p.goto(`${base}/#/inbox`); const card = p.locator('[data-scard] [data-option="apply"]').first(); await card.waitFor({ timeout: 15000 });
  ok((await p.locator('[data-scard]').first().innerText()).includes('Depends-on: https://github.com/northwind/checkout-api/pull/15'), 'the captain card in the Inbox shows the block and the repository');
  await p.screenshot({ path: join(shots, 'apply-card-1440-light.png') });
  await card.click(); await until(() => gh.calls.some((c) => c.method === 'PATCH'), 15000);
  const patched = gh.calls.filter((c) => c.method === 'PATCH');
  ok(patched.length === 1 && patched[0].path === '/repos/northwind/checkout-api/pulls/14' && patched[0].body.body.startsWith(before.trim()) && patched[0].body.body.includes('<!-- /crew-studio:depends -->'), 'the captain\'s approval writes the block into that body only', JSON.stringify(patched));
  await p.goto(`${base}/#/prs`); await p.waitForSelector('[data-prs-row]'); await p.click('[data-prs-refresh]');
  await until(async () => (await p.locator('[data-prs-row="northwind/checkout-api#14"] .pw-applied').count()) === 1);
  ok(await p.locator('[data-prs-row="northwind/checkout-api#14"] .pw-applied').count() === 1, 'the row says applied');
  // drift
  const pr14 = gh.data.find('northwind/checkout-api', 14); pr14.body = pr14.body.replace('pull/15', 'pull/15\nDepends-on: https://github.com/northwind/checkout-api/pull/13');
  await p.click('[data-prs-refresh]'); await p.waitForSelector('[data-prs-drift="northwind/checkout-api#14"]', { timeout: 15000 });
  ok(/hint on GitHub changed/.test(await p.locator('[data-prs-drift="northwind/checkout-api#14"]').innerText()) && (await p.locator('[data-prs-drift="northwind/checkout-api#14"]').getAttribute('class')).includes('warn'), 'a block edited on GitHub turns the cell amber');
  await p.click('[data-prs-drift="northwind/checkout-api#14"]'); await p.waitForSelector('[data-prs-dialog="drift"]');
  ok((await p.locator('[data-prs-drift-github]').innerText()).includes('pull/13') && !(await p.locator('[data-prs-drift-studio]').innerText()).includes('pull/13'), 'the drift dialog shows both versions');
  await p.screenshot({ path: join(shots, 'drift-1440-light.png') });
  await p.click('[data-prs-drift-take]'); await p.waitForSelector('[data-prs-drift="northwind/checkout-api#14"]', { state: 'detached' });
  ok((await p.locator('[data-prs-deps="northwind/checkout-api#14"] [title^="northwind/checkout-api#13"]').count()) === 1, 'take GitHub\'s version: the record follows it');
  pr14.body = pr14.body.replace('\nDepends-on: https://github.com/northwind/checkout-api/pull/13', '');
  await p.click('[data-prs-refresh]'); await p.waitForSelector('[data-prs-drift="northwind/checkout-api#14"]', { timeout: 15000 });
  await p.click('[data-prs-drift="northwind/checkout-api#14"]'); await p.click('[data-prs-drift-reapply]'); await p.waitForSelector('[data-prs-dialog="apply"]');
  ok((await p.locator('[data-prs-target="northwind/checkout-api#14"] pre').innerText()).includes('pull/13'), 'apply Studio\'s record again: the card dialog carries Studio\'s record');
  await p.keyboard.press('Escape');
  // refresh on open and on the interval; the change mark
  const u0 = users(); await p.goto(`${base}/#/board`); await p.goto(`${base}/#/prs`); await until(() => users() > u0, 8000);
  ok(users() > u0, 'opening the page refreshes');
  const pr18 = gh.data.find('northwind/checkout-api', 18), h18 = gh.data.head(pr18);
  pr18.reviews.push({ user: 'rel-ray', state: 'APPROVED', commit: h18, at: '2026-11-02T10:00:00Z' }, { user: 'dana', state: 'APPROVED', commit: h18, at: '2026-11-02T10:01:00Z' });
  const u1 = users(); await until(async () => (await p.locator('[data-prs-row="northwind/checkout-api#18"].chg').count()) === 1, 15000);
  ok(users() > u1 && await p.locator('[data-prs-row="northwind/checkout-api#18"].chg').count() === 1, 'the 5-minute timer (shortened here) refreshes without a click');
  const chg = await p.locator('[data-prs-row="northwind/checkout-api#18"] [data-prs-changed]').innerText();
  ok(/changed .*rel-ray approved.*next step approve → merge/.test(chg), 'the changed row is marked with what changed', chg);
  // removing and restoring
  await p.hover('[data-prs-row="northwind/checkout-api#11"]'); await p.click('[data-prs-drop="northwind/checkout-api#11"]');
  await p.waitForSelector('[data-prs-restore]'); ok(await p.locator('[data-prs-row="northwind/checkout-api#11"]').count() === 0 && /excluded 1/.test(await p.locator('[data-prs-restore]').innerText()), 'removing a row from a watched repository records it as excluded');
  await p.click('[data-prs-restore]'); await p.waitForSelector('[data-prs-restore]', { state: 'detached' });
  ok(!(await api('/api/prs')).body.watch.excluded.length, 'restore brings it back');
  // the settings dialog
  await p.click('[data-prs-settings]'); await p.waitForSelector('[data-prs-dialog="settings"]');
  ok(await p.locator('[data-prs-env]').count() === 4 && await p.locator('[data-prs-set="accounts"]').inputValue() === 'qa-lin', 'the settings dialog shows the environments and evidence sources');
  ok((await p.locator('[data-prs-env="3"] [data-prs-template-hint]').innerText()).includes('reads the tag at {tag}') && await p.locator('[data-prs-env="3"] input[placeholder="image: registry/app:{tag}"]').count() === 1, 'the file detector explains its {tag} template in a hint under the row');
  await p.check('[data-prs-which="reviewRequested"]'); await p.click('[data-prs-settings-save]'); await p.waitForSelector('[data-prs-dialog="settings"]', { state: 'detached' });
  ok((await api('/api/prs')).body.settings.which.reviewRequested === true, 'settings save');
  await p.screenshot({ path: join(shots, 'list-1440-light-after.png'), fullPage: true });
  await ctx.close();
  for (const [w, theme] of [[1440, 'dark'], [390, 'light'], [390, 'dark']]) {
    const o = await open(w, theme); await o.p.goto(`${base}/#/prs`); await o.p.waitForSelector('[data-prs-row]');
    const sx = await o.p.evaluate(() => ({ doc: document.documentElement.scrollWidth, main: document.querySelector('#main').scrollWidth, mainW: document.querySelector('#main').clientWidth, w: innerWidth, tbl: document.querySelector('[data-prs-table]').scrollWidth > document.querySelector('[data-prs-table]').clientWidth }));
    ok(sx.doc <= sx.w && sx.main <= sx.mainW + 1, `no sideways page scroll at ${w} ${theme}${w === 390 ? ' (the table scrolls inside its card)' : ''}`, JSON.stringify(sx));
    if (w === 390) ok(sx.tbl, `at ${w} the table scrolls inside its card`);
    if (w === 390) { const tc = await browser.newContext({ viewport: { width: 390, height: 900 }, isMobile: true, hasTouch: true }); const tp = await tc.newPage(); await tp.goto(`${base}/#/prs`); await tp.waitForSelector('[data-prs-row]');
      // read on the element on the page now (a live redraw may replace the row between finding it and reading it)
      const touchOpacity = async () => tp.evaluate(() => { const e = document.querySelector('[data-prs-drop]'); return e ? getComputedStyle(e).opacity : null; });
      await until(async () => (await touchOpacity()) === '1', 5000);
      ok(await touchOpacity() === '1', 'on a touch screen the row × is visible without hover', String(await touchOpacity())); await tc.close(); }
    await o.p.screenshot({ path: join(shots, `list-${w}-${theme}.png`), fullPage: w === 390 });
    if (w === 390) { await o.p.click('[data-prs-row="northwind/checkout-api#18"] .pw-title'); await o.p.waitForSelector('[data-prs-dialog="detail"]');
      const dx = await o.p.evaluate(() => document.documentElement.scrollWidth <= innerWidth); ok(dx, `the detail dialog fits at ${w} ${theme}`); await o.p.screenshot({ path: join(shots, `detail-${w}-${theme}.png`) }); }
    await o.ctx.close();
  }
  ok(!gh.unknown.length, 'every GitHub request was one the fixture knows', JSON.stringify(gh.unknown));
} catch (e) { ok(false, 'the suite ran to its end', String(e?.stack || e)); }
finally { await browser?.close().catch(() => {}); app.kill(); gh.stop(); }
console.log(`\npr-watch-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
