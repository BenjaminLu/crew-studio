import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Pull requests (docs/units/pr-watch.md "Find environments automatically") in a browser: the real server on temporary
// data against the fictional GitHub (tests/lib/pr-watch-github.ts) with an invented GitOps/config repository. The entry
// (disabled with its reason while nothing is watched), ① the sources step with the config repository offered and filled
// in, the keyboard kept in the dialog, ② the scan, ③ the matrix (a row per repository, a column per environment; sure,
// pick, not found; repositories with nothing found listed greyed; the summary and legend), Accept held until every pick is
// made with a link to the first, one Accept that saves, writes nothing to GitHub and closes with a toast, the settings'
// cards per environment, Advanced, a failed search clearing the table, re-discovery folding what is set, and screenshots
// at 1440 and 390, light and dark (no sideways scroll, evidence not clipped), in tests/out/pr-watch/.
//   bun tests/pr-watch-envs-ui.mjs          (PLAYWRIGHT_MODULE may point at a playwright install)
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { freePort, waitUp, withSession } from './boot.mjs';
import { prWatchGitHub, addDeployConfig } from './lib/pr-watch-github.ts';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
let pass = 0, fail = 0; const ok = (v, n, e = '') => { console.log(`${v ? 'ok' : 'FAIL'} ${n} ${v ? '' : e}`); v ? pass++ : fail++; };

const gh = prWatchGitHub(), cfg = addDeployConfig(gh.data);
const root = join(import.meta.dir, '..'), port = await freePort(), base = `http://127.0.0.1:${port}`, data = mkdtempSync(join(tmpdir(), 'crew-prenvs-ui-'));
mkdirSync(join(data, 'fm', 'state'), { recursive: true });
process.env.CREW_SESSION_TOKEN = 'test-session';
const app = spawn('bun', ['src/server.ts'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CREW_DATA: data, CREW_PORT: String(port), CREW_CHAT_PROVIDER: 'stub', CREW_GH: '0', CREW_PR_WATCH: '',
  CREW_GITHUB_API: gh.origin, CREW_GITHUB_TOKEN: 'fixture-token', CREW_GH_NO_CLI: '1', CREW_PR_WATCH_INTERVAL_MS: '60000', CREW_RETRO_AUTO: '0', CREW_SESSION_TOKEN: 'test-session',
  CREW_FM_STATE: join(data, 'fm', 'state'), CREW_CLAUDE_BIN: '/nonexistent', CREW_CODEX_BIN: '/nonexistent', CREW_CODEX_MODEL: '', CODEX_HOME: join(data, 'codex-config'), CREW_TEAM_SEED: '0' } });
const shots = join(root, 'tests/out/pr-watch'); mkdirSync(shots, { recursive: true });
const api = async (path, body) => { const r = await fetch(`${base}${path}`, body === undefined ? { headers: { 'x-crew-session': 'test-session' } } : { method: 'POST', headers: { 'x-crew-session': 'test-session', 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
const writes = () => gh.calls.filter((c) => c.method !== 'GET' && c.path !== '/graphql');
let browser;
try {
  await waitUp(base, app);
  browser = withSession(await chromium.launch({ headless: true }), base);
  const open = async (width, theme, lang = 'en') => { const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme }); const p = await ctx.newPage();
    await p.addInitScript(([t, l]) => { try { localStorage.setItem('crew.theme', t); localStorage.setItem('crew.lang', l); localStorage.setItem('crew.side', 'open'); localStorage.setItem('crew.chatOpen', '0'); } catch {} }, [theme, lang]); return { ctx, p }; };
  const { ctx, p } = await open(1440, 'light');
  const settings = async () => { await p.click('[data-prs-settings]'); await p.waitForSelector('[data-prs-dialog="settings"] [data-prs-envs-find]'); };

  // nothing watched: the entry is disabled and says why
  await p.goto(`${base}/#/prs`); await p.waitForSelector('[data-prs-page]:not([data-loading])'); await settings();
  ok(await p.locator('[data-prs-envs-find]').isDisabled() && /Watch a repository first/.test(await p.locator('[data-prs-envs-find-why]').innerText()), 'nothing watched: Find environments automatically is disabled, the reason beside it');
  await p.click('[data-prs-dialog="settings"] [data-prs-close]'); await p.waitForSelector('[data-prs-dialog="settings"]', { state: 'detached' });
  for (const u of ['https://github.com/northwind/checkout-api', 'https://github.com/northwind/web-app', 'https://github.com/northwind/ledger', 'https://github.com/northwind/mobile']) ok((await api('/api/prs/watch', { url: u })).status === 200, `watch ${u}`);
  await p.reload(); await p.waitForSelector('[data-prs-page]:not([data-loading])'); await settings();
  ok(!(await p.locator('[data-prs-envs-find]').isDisabled()) && (await p.locator('[data-prs-envs-find]').getAttribute('class')).includes('primary') && (await p.locator('[data-prs-envs-advanced]').getAttribute('open')) === null, 'the entry is the primary action at the top of the environments; the hand editor folded under Advanced');
  await p.screenshot({ path: join(shots, 'envs-settings-empty-1440-light.png'), fullPage: true });

  // ① sources: the config repository that looks like one is filled in; the keyboard stays in the dialog
  await p.click('[data-prs-envs-find]'); await p.waitForSelector('[data-prs-dialog="discover"][aria-modal]');
  await p.waitForFunction((c) => document.querySelector('[data-prs-discover-config]')?.value === c, cfg);
  ok(await p.locator('[data-prs-discover-src-deployments]').isChecked() && await p.locator('[data-prs-discover-src-config]').isChecked() && await p.locator('[data-prs-discover-suggest-repo="northwind/cluster-ops"]').count() === 1, 'step 1: both sources ticked, the first repository that looks like a config repository filled in, another offered');
  ok(await p.locator('[data-prs-discover-path]').isVisible() && (await p.locator('[data-prs-discover-path]').getAttribute('placeholder')).includes('only this folder'), 'a folder of the config repository can narrow the scan');
  ok(await p.evaluate(() => !!document.activeElement?.closest('[data-prs-dialog="discover"]')), 'the focus starts inside the dialog', await p.evaluate(() => document.activeElement?.tagName));
  ok(/^Start scanning$/.test(await p.locator('[data-prs-discover-run]').innerText()) && await p.locator('[data-prs-discover-accept]').isHidden(), 'the first button says Start scanning; no Accept before a result');
  for (let i = 0; i < 25; i++) await p.keyboard.press('Tab');
  ok(await p.evaluate(() => !!document.activeElement?.closest('[data-prs-dialog="discover"]')), 'Tab cycles inside the dialog');
  await p.screenshot({ path: join(shots, 'envs-sources-1440-light.png') });
  await p.evaluate(() => document.activeElement?.blur()); await p.keyboard.press('Escape'); await p.waitForSelector('[data-prs-dialog="settings"]');
  ok(!(await api('/api/prs')).body.settings.environments.length, 'Escape closes it from anywhere, saves nothing, and goes back to the settings');

  // ② a failed search keeps no table
  await p.click('[data-prs-envs-find]'); await p.waitForFunction((c) => document.querySelector('[data-prs-discover-config]')?.value === c, cfg);
  gh.setRateLimited(true); await p.click('[data-prs-discover-run]'); await p.waitForSelector('[data-prs-discover-error]'); gh.setRateLimited(false);
  ok(/rate limit/i.test(await p.locator('[data-prs-discover-error]').innerText()) && await p.locator('[data-prs-discover-table]').count() === 0 && await p.locator('[data-prs-discover-accept]').isHidden(), 'a rate limit: the message, back on the sources, no table and no Accept');

  // ③ the matrix
  await p.click('[data-prs-discover-run]'); await p.waitForSelector('[data-prs-discover-table]');
  const C = (k) => p.locator(`[data-prs-discover-group="${k}"]`);
  ok(J(await p.locator('[data-prs-discover-repo]').evaluateAll((es) => es.map((e) => e.dataset.prsDiscoverRepo))) === J(['northwind/checkout-api', 'northwind/ledger', 'northwind/web-app', 'northwind/mobile']), 'a row per repository; mobile, with nothing found, last', await p.locator('[data-prs-discover-repo]').evaluateAll((es) => es.map((e) => e.dataset.prsDiscoverRepo).join()));
  ok(await p.locator('[data-prs-discover-repo="northwind/mobile"]').getAttribute('class').then((c) => c.includes('none')) && /nothing found/.test(await p.locator('[data-prs-discover-repo="northwind/mobile"]').innerText()), 'a repository with nothing found is listed greyed, with what to do');
  ok(J(await p.locator('.pw-mx-head [role=columnheader]').allInnerTexts()) === J(['', 'Repository', 'dev', 'staging', 'preprod', 'production · live']), 'a column per environment; the live one marked', J(await p.locator('.pw-mx-head [role=columnheader]').allInnerTexts()));
  ok(await C('northwind/checkout-api|production').getAttribute('data-state') === 'ok' && await C('northwind/checkout-api|production').locator('[data-prs-discover-tick]').isChecked()
    && (await C('northwind/checkout-api|production').innerText()).includes('apps/checkout-api/overlays/prod/deployment.yaml:6'), 'checkout-api production: a green chip, ticked, the manifest path and line under it');
  ok(await C('northwind/checkout-api|production').locator(`a[href="https://github.com/${cfg}/blob/main/apps/checkout-api/overlays/prod/deployment.yaml#L6"]`).count() === 1, 'the evidence links the line on GitHub');
  ok(await p.locator('[data-prs-discover-cell="northwind/web-app|dev"] .pw-chip.none').count() === 1, 'an environment a repository lacks: a grey not found');
  ok(await C('northwind/web-app|staging').getAttribute('data-state') === 'ok' && /2 services: live when every one runs it/.test(await C('northwind/web-app|staging').innerText()) && await C('northwind/web-app|staging').locator('a.pw-path').count() === 2, 'web-app staging: its image in two manifests, one ticked cell reading both', await C('northwind/web-app|staging').innerText());
  ok(/commit [0-9a-f]{12} is in the repository/.test(await C('northwind/web-app|production').locator('[data-prs-discover-signals]').innerText()), 'the cell says what tied the image to the repository', await C('northwind/web-app|production').innerText());
  const ledger = C('northwind/ledger|production');
  ok(await ledger.locator('[data-prs-discover-pick]:disabled').count() === 1 && /does not end in a commit/.test(await ledger.innerText()) && /only resembles/.test(await ledger.innerText()), 'ledger: the tag with no commit cannot be picked; the look-alike is marked weak');
  ok(/^Found 7 environments in 3 repositories · 2 need a pick · 1 not found/.test(await p.locator('[data-prs-discover-summary]').innerText()), 'the summary counts what was found, what needs a pick and what was not found', await p.locator('[data-prs-discover-summary]').innerText());
  ok(await p.locator('.pw-legend .pw-chip').count() === 3, 'a legend for green, amber and grey');
  ok(await p.locator('[data-prs-discover-accept]').isDisabled() && (await p.locator('[data-prs-discover-accept]').innerText()) === 'Accept' && /^2 need a pick$/.test(await p.locator('[data-prs-discover-left]').innerText()), 'Accept waits, with no number, while 2 need a pick', await p.locator('[data-prs-discover-left]').innerText());
  await p.click('[data-prs-discover-left]');
  ok(await p.evaluate(() => !!document.activeElement?.closest('[data-need]')), '"2 need a pick" takes the focus to the first one');
  ok(!/\bnull\b/.test(await p.locator('[data-prs-discover]').innerText()) && !(await p.locator('[data-prs-discover]').innerText()).includes('production [production]'), 'no empty part shows as text, no doubled badge');
  ok(await p.evaluate(() => { const f = document.querySelector('[data-prs-dialog="discover"] .pw-mf'); return getComputedStyle(f).position === 'sticky'; }), 'the footer with Accept stays in view');
  await p.screenshot({ path: join(shots, 'envs-discover-1440-light.png') });
  await C('northwind/checkout-api|staging').locator('[data-prs-discover-pick]').nth(1).check();
  await C('northwind/ledger|production').locator('[data-prs-discover-skip]').check();
  ok(!(await p.locator('[data-prs-discover-accept]').isDisabled()) && (await p.locator('[data-prs-discover-accept]').innerText()) === 'Accept 2 repositories' && await p.locator('[data-prs-discover-left]').isHidden(), 'every pick made: Accept names the repositories it saves', await p.locator('[data-prs-discover-accept]').innerText());
  ok(!writes().length && !(await api('/api/prs')).body.settings.environments.length, 'looking saved nothing and wrote nothing to GitHub');
  await p.click('[data-prs-discover-accept]'); await p.waitForSelector('[data-prs-dialog="discover"]', { state: 'detached' });
  ok(await p.locator('[data-prs-dialog]').count() === 0 && /Environments saved for 2 repositories/.test(await p.locator('body > .toast').innerText()), 'Accept closes it with a toast; no settings dialog left with a Save to press');
  const s = (await api('/api/prs')).body, prodEnv = s.settings.environments.find((e) => e.name === 'production');
  ok(prodEnv?.production && prodEnv.each.map((x) => x.repo).join() === 'northwind/checkout-api,northwind/web-app' && s.envConfig?.repository === cfg, 'one production covering checkout-api and web-app, and the config repository, saved', JSON.stringify(s.settings.environments));
  ok(!writes().length, 'accepting wrote nothing to GitHub');

  // the settings: a card per environment, each repository and its source
  await settings();
  const card = p.locator('[data-prs-envsum="production"]');
  ok(/2 repositories/.test(await card.innerText()) && (await card.innerText()).includes('northwind/web-app') && (await card.innerText()).includes(`${cfg} · apps/web-app/overlays/production/kustomization.yaml`) && await card.locator('.badge').count() === 1, 'production\'s card lists each repository with where it is read', await card.innerText());
  await p.click('[data-prs-envs-advanced] > summary');
  const prow = p.locator('[data-prs-env-name="production"]');
  ok(await prow.locator('[data-prs-env-each="northwind/web-app"] [data-prs-each-field="template"]').inputValue() === 'newTag: "{tag}"', 'Advanced: each repository\'s own row, editable by hand');
  ok(await p.evaluate(() => { const r = document.querySelector('[data-prs-env-name="production"] input.pw-envname').getBoundingClientRect(), c = document.querySelector('[data-prs-env-name="production"] select').getBoundingClientRect(); return Math.abs(r.top - c.top) < 4; }), 'an Advanced row lays its fields side by side (the grid template is valid)');
  ok(await p.evaluate(() => { const row = document.querySelector('[data-prs-env-name="production"] [data-prs-env-each="northwind/web-app"]'), x = row.querySelector(':scope > .pw-x').getBoundingClientRect(), b = row.getBoundingClientRect(), t = row.querySelector('[data-prs-each-field="template"]').getBoundingClientRect(), rp = row.querySelector('[data-prs-each-repo]').getBoundingClientRect();
    return x.top - b.top < 20 && b.right - x.right < 16 && t.width >= 280 && rp.width >= 200; }), 'Advanced: the repository and template fields are wide, × at the top right');
  await p.screenshot({ path: join(shots, 'envs-settings-after-1440-light.png'), fullPage: true });
  await prow.locator('[data-prs-env-each="northwind/web-app"] .pw-x').click();
  ok(!(await p.locator('[data-prs-envsum="production"]').innerText()).includes('northwind/web-app'), 'the cards follow a hand edit at once');
  await p.click('[data-prs-settings-save]'); await p.waitForSelector('[data-prs-dialog="settings"]', { state: 'detached' });
  ok((await api('/api/prs')).body.settings.environments.find((e) => e.name === 'production').each.map((x) => x.repo).join() === 'northwind/checkout-api', 'removing a repository\'s row by hand and saving keeps the rest');
  await ctx.close();

  // again, other widths, themes and Traditional Chinese: what is set folds; nothing clipped or sideways at 390
  for (const [w, theme, lang] of [[1440, 'dark', 'en'], [390, 'light', 'en'], [390, 'dark', 'zh-TW'], [1440, 'light', 'zh-TW']]) {
    const o = await open(w, theme, lang); await o.p.goto(`${base}/#/prs`); await o.p.waitForSelector('[data-prs-page]:not([data-loading])');
    await o.p.click('[data-prs-settings]'); await o.p.waitForSelector('[data-prs-envs-find]'); await o.p.click('[data-prs-envs-find]');
    await o.p.waitForFunction((c) => document.querySelector('[data-prs-discover-config]')?.value === c, cfg);
    if (w === 390) await o.p.screenshot({ path: join(shots, `envs-sources-${w}-${theme}-${lang}.png`), fullPage: true });
    if (w === 390 && theme === 'light') { // closed mid-scan: the search is cancelled and the next one starts at once
      await o.p.click('[data-prs-discover-run]'); await o.p.click('[data-prs-discover-cancel]'); await o.p.waitForSelector('[data-prs-dialog="settings"]');
      await o.p.click('[data-prs-envs-find]'); await o.p.waitForFunction((c) => document.querySelector('[data-prs-discover-config]')?.value === c, cfg); }
    await o.p.click('[data-prs-discover-run]'); await o.p.waitForSelector('[data-prs-discover-table]');
    ok(await o.p.locator('[data-prs-discover-repo="northwind/checkout-api"]').count() === 0 && await o.p.locator('[data-prs-discover-repo="northwind/web-app"]').count() === 1 && await o.p.locator('[data-prs-discover-showset]').count() === 1, `${w} ${theme} ${lang}: searching again folds checkout-api (all set); web-app, edited by hand, is proposed again`);
    await o.p.click('[data-prs-discover-showset]'); await o.p.waitForSelector('[data-prs-discover-repo="northwind/checkout-api"]');
    ok(await o.p.locator('[data-prs-discover-group="northwind/checkout-api|production"]').getAttribute('data-state') === 'set', `${w} ${theme} ${lang}: shown on demand, as already set`);
    ok(await o.p.locator('[data-prs-discover-error]').count() === 0, `${w} ${theme} ${lang}: no "already running" error after a cancelled search`);
    ok(await o.p.evaluate(() => [...document.querySelectorAll('.pw-disc-ev a.pw-path')].every((a) => a.querySelectorAll('wbr').length >= 1)), `${w} ${theme} ${lang}: paths break only after a slash`);
    if (w === 390) ok(await o.p.locator('[data-prs-discover-footnote]').isHidden(), '390: the footer note gives the buttons the room');
    const fits = await o.p.evaluate(() => document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('.pw-disc-ev a')].every((a) => { const r = a.getBoundingClientRect(), m = a.closest('.modal').getBoundingClientRect(); return r.right <= m.right + 1; }));
    ok(fits, `${w} ${theme} ${lang}: no sideways scroll, no evidence cut off`);
    if (lang === 'zh-TW') ok(/GitHub 環境 dev：最近一次部署/.test(await o.p.locator('[data-prs-discover-group="northwind/checkout-api|dev"]').innerText()), `${w} ${theme}: the evidence reads in Traditional Chinese`);
    if (w === 390 && theme === 'light') { for (const c of await o.p.locator('[data-prs-discover-row]').all()) await c.uncheck();
      const acc = o.p.locator('[data-prs-discover-accept]'), wasOff = await acc.isDisabled();
      await o.p.locator('[data-prs-discover-prod="staging"]').check(); ok(wasOff && !(await acc.isDisabled()), 'only a production tick changed on a set environment: Accept is offered'); await o.p.locator('[data-prs-discover-prod="staging"]').uncheck(); }
    await o.p.screenshot({ path: join(shots, `envs-discover-${w}-${theme}-${lang}.png`), fullPage: w === 390 });
    await o.ctx.close();
  }
  ok(!gh.unknown.length, 'every GitHub request was one the fixture knows', JSON.stringify(gh.unknown));
} catch (e) { ok(false, 'the suite ran to its end', String(e?.stack || e)); }
finally { await browser?.close().catch(() => {}); app.kill(); gh.stop(); }
function J(v) { return JSON.stringify(v); }
console.log(`\npr-watch-envs-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
