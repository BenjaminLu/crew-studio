import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Pull requests (docs/units/pr-watch.md "Find environments automatically") in a browser: the real server on temporary
// data against the fictional GitHub (tests/lib/pr-watch-github.ts) with an invented GitOps/config repository. From the
// settings: Find environments automatically, a config repository offered by name and picked, the review table (ticked,
// needs a pick, a problem never pickable), Accept held until every pick is made, one Accept that saves and writes nothing
// to GitHub, the settings showing one production covering two repositories, Advanced with each repository's own row,
// Cancel saving nothing, and screenshots at 1440 and 390, light and dark, in tests/out/pr-watch/.
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
  for (const u of ['https://github.com/northwind/checkout-api', 'https://github.com/northwind/web-app', 'https://github.com/northwind/ledger']) ok((await api('/api/prs/watch', { url: u })).status === 200, `watch ${u}`);
  browser = withSession(await chromium.launch({ headless: true }), base);
  const open = async (width, theme) => { const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme }); const p = await ctx.newPage();
    await p.addInitScript(([t]) => { try { localStorage.setItem('crew.theme', t); localStorage.setItem('crew.lang', 'en'); localStorage.setItem('crew.side', 'open'); localStorage.setItem('crew.chatOpen', '0'); } catch {} }, [theme]); return { ctx, p }; };
  const { ctx, p } = await open(1440, 'light');
  await p.goto(`${base}/#/prs`); await p.waitForSelector('[data-prs-page]:not([data-loading])');
  await p.click('[data-prs-settings]'); await p.waitForSelector('[data-prs-dialog="settings"]');
  ok(await p.locator('[data-prs-envs-find]').isVisible() && (await p.locator('[data-prs-envs-advanced]').getAttribute('open')) === null, 'no environments yet: Find environments automatically comes first, the hand editor folded under Advanced');
  await p.screenshot({ path: join(shots, 'envs-settings-empty-1440-light.png'), fullPage: true });

  // Cancel: nothing saved, the settings open again
  await p.click('[data-prs-envs-find]'); await p.waitForSelector('[data-prs-dialog="discover"] [data-prs-discover-table]');
  ok(await p.locator('[data-prs-discover-suggest-repo="northwind/deploy-config"]').count() === 1, 'a repository that looks like a config repository is offered by name');
  ok(await p.locator('[data-prs-discover-group]').count() === 3, 'without one: checkout-api\'s GitHub environments only (dev, staging, preprod)', String(await p.locator('[data-prs-discover-group]').count()));
  await p.click('[data-prs-discover-cancel]'); await p.waitForSelector('[data-prs-dialog="settings"]');
  ok(!(await api('/api/prs')).body.settings.environments.length, 'Cancel saves nothing and goes back to the settings');

  // the config repository picked: the review table
  await p.click('[data-prs-envs-find]'); await p.waitForSelector('[data-prs-discover-suggest-repo="northwind/deploy-config"]');
  await p.click('[data-prs-discover-suggest-repo="northwind/deploy-config"]');
  await p.waitForSelector('[data-prs-discover-group="northwind/web-app|production"]');
  const G = (k) => p.locator(`[data-prs-discover-group="${k}"]`);
  ok(await G('northwind/checkout-api|production').getAttribute('data-state') === 'ok' && await G('northwind/checkout-api|production').locator('input[type=checkbox]').isChecked()
    && (await G('northwind/checkout-api|production').innerText()).includes('apps/checkout-api/overlays/prod/deployment.yaml:6'), 'checkout-api production: ticked, with the manifest path and line');
  ok(await G('northwind/checkout-api|production').locator(`a[href="https://github.com/${cfg}/blob/main/apps/checkout-api/overlays/prod/deployment.yaml#L6"]`).count() === 1, 'the evidence links the line on GitHub');
  ok(await G('northwind/web-app|staging').getAttribute('data-state') === 'pick' && await G('northwind/web-app|staging').locator('.need, [data-prs-discover-pick]').count() >= 2, 'web-app staging: two manifests, a pick');
  const ledger = G('northwind/ledger|production');
  ok(await ledger.locator('[data-prs-discover-pick]:disabled').count() === 1 && /does not end in a commit/.test(await ledger.innerText()) && /only resembles/.test(await ledger.innerText()), 'ledger: the tag with no commit cannot be picked; the look-alike is marked weak');
  const need = await p.locator('[data-prs-discover-group][data-state="pick"]').count();
  ok(await p.locator('[data-prs-discover-accept]').isDisabled() && new RegExp(`^${need} need`).test(await p.locator('[data-prs-discover-left]').innerText()), 'Accept waits until every ambiguous one is picked', await p.locator('[data-prs-discover-left]').innerText());
  ok(await p.locator('[data-prs-discover-prod="production"]').isChecked() && !(await p.locator('[data-prs-discover-prod="staging"]').isChecked()), 'production inferred from the names, editable');
  ok(!/\bnull\b/.test(await p.locator('[data-prs-discover]').innerText()), 'no empty part of the dialog shows as text');
  await p.screenshot({ path: join(shots, 'envs-discover-1440-light.png'), fullPage: true });
  // pick: checkout-api staging → the manifest; web-app staging → the first; ledger → leave out
  await G('northwind/checkout-api|staging').locator('[data-prs-discover-pick]').nth(1).check();
  await G('northwind/web-app|staging').locator('[data-prs-discover-pick]').first().check();
  await G('northwind/ledger|production').locator('[data-prs-discover-skip]').check();
  ok(!(await p.locator('[data-prs-discover-accept]').isDisabled()) && /^Accept \d+$/.test(await p.locator('[data-prs-discover-accept]').innerText()), 'every pick made: Accept counts what it saves', await p.locator('[data-prs-discover-accept]').innerText());
  ok(!writes().length && !(await api('/api/prs')).body.settings.environments.length, 'looking saved nothing and wrote nothing to GitHub');
  await p.click('[data-prs-discover-accept]'); await p.waitForSelector('[data-prs-dialog="settings"]');
  const s = (await api('/api/prs')).body;
  const prodEnv = s.settings.environments.find((e) => e.name === 'production');
  ok(prodEnv?.production && prodEnv.each.map((x) => x.repo).join() === 'northwind/checkout-api,northwind/web-app' && s.envConfig?.repository === cfg, 'one Accept saved one production covering checkout-api and web-app, and the config repository', JSON.stringify(s.settings.environments));
  ok(!writes().length, 'accepting wrote nothing to GitHub');
  ok(/2 repositories with their own detection/.test(await p.locator('[data-prs-envsum="production"]').innerText()), 'the settings say production covers 2 repositories', await p.locator('[data-prs-envsum="production"]').innerText());
  await p.click('[data-prs-envs-advanced] > summary');
  const prow = p.locator('[data-prs-env-name="production"]');
  ok(await prow.count() === 1 && await prow.locator('[data-prs-env-each="northwind/web-app"] [data-prs-each-field="template"]').inputValue() === 'newTag: "{tag}"', 'Advanced: each repository\'s own row, editable by hand');
  await p.screenshot({ path: join(shots, 'envs-settings-after-1440-light.png'), fullPage: true });
  // a hand edit in Advanced saves through the same settings
  await prow.locator('[data-prs-env-each="northwind/web-app"] .pw-x').click(); await p.click('[data-prs-settings-save]'); await p.waitForSelector('[data-prs-dialog="settings"]', { state: 'detached' });
  ok((await api('/api/prs')).body.settings.environments.find((e) => e.name === 'production').each.map((x) => x.repo).join() === 'northwind/checkout-api', 'removing a repository\'s row by hand and saving keeps the rest');
  await ctx.close();

  // the other widths and themes: the review table fits
  for (const [w, theme] of [[390, 'light'], [1440, 'dark'], [390, 'dark']]) {
    const o = await open(w, theme); await o.p.goto(`${base}/#/prs`); await o.p.waitForSelector('[data-prs-page]:not([data-loading])');
    await o.p.click('[data-prs-settings]'); await o.p.waitForSelector('[data-prs-envs-find]'); await o.p.click('[data-prs-envs-find]');
    await o.p.waitForSelector('[data-prs-dialog="discover"] [data-prs-discover-table]');
    ok(await o.p.locator('[data-prs-discover-config]').inputValue() === cfg, `${w} ${theme}: the remembered config repository is filled in`);
    const fits = await o.p.evaluate(() => document.documentElement.scrollWidth <= innerWidth); ok(fits, `the review table fits at ${w} ${theme}`);
    await o.p.screenshot({ path: join(shots, `envs-discover-${w}-${theme}.png`), fullPage: w === 390 });
    await o.ctx.close();
  }
  ok(!gh.unknown.length, 'every GitHub request was one the fixture knows', JSON.stringify(gh.unknown));
} catch (e) { ok(false, 'the suite ran to its end', String(e?.stack || e)); }
finally { await browser?.close().catch(() => {}); app.kill(); gh.stop(); }
console.log(`\npr-watch-envs-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
