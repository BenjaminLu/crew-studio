// Projects in the sidebar, phase 1 (projects design §2, §3.4): the real server on temporary data with three projects in
// different states and a Task in no project (tests/projects-fixture.ts), driven in a browser.
//   bun tests/projects-ui.mjs          (PLAYWRIGHT_MODULE may point at a playwright install)
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
  CREW_SESSION_TOKEN: 'test-session', CREW_FM_STATE: join(seed.data, 'fm', 'state'), CREW_CLAUDE_BIN: '/nonexistent', CREW_CODEX_BIN: '/nonexistent' } });
const shots = join(root, 'tests/out/projects'); mkdirSync(shots, { recursive: true });
let browser;
const COST = /\$\s?\d|\bcost\b|\bUSD\b|\bprice\b|成本|費用|花費/i;
try {
  await waitUp(base, app);
  // auth over HTTP: no session, a 401; the session header reads
  ok((await fetch(`${base}/api/projects/overview`)).status === 401, 'GET /api/projects/overview without a session: 401');
  ok((await fetch(`${base}/api/projects/harbor-api/overview`)).status === 401, 'GET /api/projects/<id>/overview without a session: 401');
  const side = await (await fetch(`${base}/api/projects/overview`, { headers: { 'x-crew-session': 'test-session' } })).json();
  ok(side.projects?.map((p) => p.id).join() === 'harbor-api,kelp-notes,tidepool-docs,sandbox,studio', 'the sidebar payload lists the three projects and the Studio row', JSON.stringify(side.projects?.map((p) => p.id)));
  browser = withSession(await chromium.launch({ headless: true }), base);

  // the light pass writes (a live Task, a card answered by link), so it goes last
  for (const [width, theme, lang] of [[1280, 'dark', 'en'], [390, 'dark', 'zh-TW'], [1280, 'light', 'en']]) {
    const tag = `${width} ${theme} ${lang}`;
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
    const p = await ctx.newPage();
    await p.addInitScript(([t, l]) => { try { localStorage.setItem('crew.theme', t); localStorage.setItem('crew.lang', l); localStorage.setItem('crew.side', 'open'); } catch {} }, [theme, lang]);
    await p.goto(`${base}/#/project/harbor-api`);
    await p.waitForSelector('[data-project-page="harbor-api"]:not([data-loading])');
    const zh = lang === 'zh-TW', L = (en, tw) => (zh ? tw : en);

    // ---- the sidebar (desktop) or the top-bar item (phone) ----
    if (width > 760) {
      await p.waitForSelector('[data-projects-nav] [data-project-row="studio"]');
      const rows = await p.locator('[data-projects-nav] [data-project-row]').evaluateAll((es) => es.map((e) => ({ id: e.dataset.projectRow, href: e.getAttribute('href'), status: e.querySelector('[data-project-status]')?.textContent, count: e.querySelector('.count')?.textContent })));
      ok(rows.map((r) => r.id).join() === 'harbor-api,kelp-notes,tidepool-docs,sandbox,studio', `sidebar renders the projects and the Studio row last (${tag})`, JSON.stringify(rows));
      ok(rows[0].status === L('Waiting for you', '等你處理') && rows[0].count === '2' && rows[1].status === L('Disabled', '已停用') && rows[2].status === L('External: cannot dispatch yet', '外部專案：暫無法派工') && rows[3].status === L('Built-in · idle', '內建 · 閒置'), `each row has its status line and card count (${tag})`, JSON.stringify(rows));
      ok(rows[4].href === '#/runs?project=studio' && rows[4].status === L('No project · Waiting for you', '無專案 · 等你處理'), `the Studio row links to Tasks with no project (${tag})`, JSON.stringify(rows[4]));
      ok(await p.locator('[data-projects-nav] [data-project-row="harbor-api"][aria-current="page"]').count() === 1, `the open project is marked current (${tag})`);
      const ratio = await p.evaluate(() => { const lum = (c) => { const [r, g, b] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
        let worst = 99; for (const row of document.querySelectorAll('[data-projects-nav] .pj-item')) { const fg = getComputedStyle(row.querySelector('.ps')).color; let el = row, bg = 'rgba(0, 0, 0, 0)'; while (el && /rgba\(0, 0, 0, 0\)|transparent/.test(bg)) { bg = getComputedStyle(el).backgroundColor; el = el.parentElement; }
          const a = lum(fg), b = lum(bg); worst = Math.min(worst, (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)); } return worst; });
      ok(ratio >= 4.5, `sidebar status text contrast is at least 4.5:1 (${tag})`, String(ratio));
      ok(await p.locator('.nav-item[data-view="projects"]').isHidden(), `no Projects nav item on a desktop (${tag})`);
    } else {
      ok(await p.locator('[data-projects-nav]').isHidden(), `the sidebar section folds away on a phone (${tag})`);
      ok(await p.locator('.nav-item[data-view="projects"]').isVisible() && (await p.locator('.nav-item[data-view="projects"] .count').textContent()) === '3', `a Projects item with the card count in the phone top bar (${tag})`);
    }

    // ---- the page: every section ----
    const pg = p.locator('[data-project-page="harbor-api"]');
    ok((await pg.locator('h1').textContent()).includes('harbor-api') && await pg.locator('[data-project-enabled="1"]').count() === 1 && (await pg.locator('[data-project-registered="registered"]').textContent()).includes(L('Registered', '已註冊')), `header: name, Enabled, Registered (${tag})`);
    ok((await pg.locator('[data-project-path]').textContent()) === seed.harbor, `the identity line shows the path (${tag})`);
    for (const s of ['s-tasks', 's-cards', 's-crew', 's-paths', 's-out', 's-wt']) ok(await pg.locator(`#${s}`).count() === 1, `section ${s} renders (${tag})`);
    ok(await pg.locator('.pj-jump .chip').count() === 6, `six jump chips (${tag})`);
    ok((await pg.locator('[data-project-attention]').getAttribute('data-project-attention')) === '2', `the attention strip: 2 cards (${tag})`);
    const tiles = await pg.locator('[data-health]').evaluateAll((es) => es.map((e) => [e.dataset.health, e.textContent]));
    ok(tiles.map((t) => t[0]).join() === 'enabled,registered,base,crew,test,rules,gitconfig', `7 health tiles (${tag})`, JSON.stringify(tiles));
    ok(tiles.filter((t) => ['rules', 'gitconfig'].includes(t[0])).every((t) => t[1].includes(L('Not checked yet', '尚未檢查'))), `operating rules and git config: not checked yet (${tag})`);
    ok(tiles.find((t) => t[0] === 'test')[1].includes('bun test'), `the test command shows (${tag})`);
    ok(tiles.find((t) => t[0] === 'crew')[1].includes(L('Crew approved', '船員已核准')) && !/ENOENT|no such file|stat '/.test(await pg.innerText()), `a broken registration elsewhere does not break this crew read, and no exception text shows (${tag})`);
    ok((await pg.locator(`[data-worktree="${seed.runs.rate}"] small`).textContent()).startsWith(`…/work/wt/harbor-api/${seed.runs.rate}`) && (await pg.locator(`[data-worktree="${seed.runs.rate}"] small`).getAttribute('title')).startsWith('/'), `a worktree path is shortened at its start, keeping the task folder (${tag})`);
    if (width <= 760) ok(await pg.locator('.pj-h-sum').isVisible() && (await pg.locator('.pj-h-sum b').textContent()).includes('4') && await pg.locator('.pj-h.ok[data-health="enabled"]').isHidden(), `on a phone passing tiles fold into one row (${tag})`);
    const tasks = await pg.locator('[data-project-task]').evaluateAll((es) => es.map((e) => [e.dataset.projectTask, e.querySelector('[data-waits-on]').dataset.waitsOn, e.querySelector('[data-waits-on]').textContent]));
    ok(tasks.length === 2 && tasks.every((t) => t[1] === 'captain') && tasks.some((t) => t[2].includes(L('at Merge', '在「Merge」'))), `active tasks with who each waits on (${tag})`, JSON.stringify(tasks));
    ok(await pg.locator('[data-crew="code-firstmate"] .pj-role').count() === 4 && (await pg.locator('[data-crew-link]').getAttribute('href')) === '#/firstmate?staffing=harbor-api', `crew read only, with the Choose your crew together link (${tag})`);
    ok(await pg.locator('[data-proposed] [data-approve-list]').count() === 1 && (await pg.locator('#s-paths').textContent()).includes('migrations/**'), `sensitive paths with the proposed list (${tag})`);
    ok(await pg.locator('[data-output="web"] a[target="_blank"]').count() === 1, `outputs: the website opens its preview (${tag})`);
    ok(await pg.locator(`[data-worktree="${seed.runs.rate}"] [data-copy]`).count() === 1, `worktrees with a Copy button (${tag})`);
    ok(!COST.test(await p.locator('body').innerText()), `no cost text on the page (${tag})`);
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `no horizontal overflow (${tag})`);
    // the screenshot of the real page (the whole main column)
    await p.evaluate(() => { document.body.classList.add('chat-closed'); const f = document.querySelector('#chatFab'); if (f) f.style.visibility = 'hidden'; document.body.style.overflow = 'visible'; const s = document.querySelector('.shell'); if (s) s.style.height = 'auto'; const m = document.querySelector('#main'); if (m) m.style.overflow = 'visible'; });
    await p.screenshot({ path: join(shots, `project-${width}-${theme}${zh ? '-zh' : ''}.png`), fullPage: true });
    await p.evaluate(() => { document.body.style.overflow = ''; const s = document.querySelector('.shell'); if (s) s.style.height = ''; const m = document.querySelector('#main'); if (m) m.style.overflow = ''; });

    if (width === 1280 && theme === 'light') {
      // Copy puts the path on the clipboard
      await pg.locator('.pj-id [data-copy]').click();
      await p.waitForSelector('.toast');
      ok((await p.locator('.toast').last().textContent()) === 'Path copied' && (await p.evaluate(() => navigator.clipboard.readText())) === seed.harbor, 'Copy puts the path on the clipboard and says so');
      // live update: a Task started in harbor-api appears without a reload, and the sidebar count follows
      const before = await p.locator('[data-project-task]').count();
      const started = await p.evaluate(async () => (await (await fetch('/api/wruns', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workflow: 'ask', title: 'Live arrival', text: 'Live arrival', params: { project: 'harbor-api' } }) })).json()));
      const appeared = await p.waitForSelector(`[data-project-task="${started.id}"]`, { timeout: 8000 }).then(() => true).catch(() => false);
      ok(!!started.id && appeared && (await p.locator('[data-project-task]').count()) === before + 1, 'a wrun event for this project refetches the page: the new Task appears', JSON.stringify(started).slice(0, 200));
      const counted = await p.waitForFunction(() => document.querySelector('[data-projects-nav] [data-project-row="harbor-api"] .count')?.textContent === '3', null, { timeout: 8000 }).then(() => true).catch(() => false);
      ok(counted, 'the sidebar count follows the new card');
      // language switch: the sidebar and the page relabel
      await p.click('[data-lang-set="zh-TW"]');
      ok((await p.locator('#projH').textContent()) === '專案' && (await pg.locator('#hHealth').textContent()) === '健康狀態' && (await pg.locator('[data-health="rules"]').textContent()).includes('尚未檢查'), 'switching to zh-TW relabels the section and the page');
      await p.click('[data-lang-set="en"]');
      // the Studio page refetches on a wrun of a run that counts under Studio (a coffee run's own namespace, not a registered id)
      await p.goto(`${base}/#/project/studio`); await p.waitForSelector('[data-project-page="studio"]:not([data-loading])');
      const hits = await p.evaluate(async () => { let hit = 0; const f = window.fetch; window.fetch = (u, ...a) => { if (String(u).includes('/api/projects/studio/overview')) hit++; return f(u, ...a); };
        LIVE.es.dispatchEvent(new MessageEvent('wrun', { data: JSON.stringify({ id: 'R-999', project: 'coffee:shop', status: 'running' }) }));
        await new Promise((r) => setTimeout(r, 900)); window.fetch = f; return hit; });
      ok(hits > 0, 'a coffee run\'s wrun event refreshes the Studio page', String(hits));
      // the onboarding tour counts a Task opened through a card deep link as opening the Task
      ok(await p.evaluate(() => typeof window.crewIsTaskHash === 'function' && window.crewIsTaskHash('#/run/R-12?card=SC-3') && window.crewIsTaskHash('#/run/R-12') && !window.crewIsTaskHash('#/runs') && !window.crewIsTaskHash('#/run/R-12/x')), 'the onboarding Task check accepts a ?card= deep link');
      await p.goto(`${base}/#/project/harbor-api`); await p.waitForSelector('[data-project-page="harbor-api"]:not([data-loading])');
      // a pending card deep link opens the card
      const cardId = await pg.locator('[data-card-link]').first().getAttribute('data-card-link');
      const href = await pg.locator('[data-card-link]').first().getAttribute('href');
      await pg.locator('[data-card-link]').first().click();
      const linked = await p.waitForSelector(`[data-scard="${cardId}"][data-card-linked]`, { timeout: 8000 }).then(() => true).catch(() => false);
      ok(/^#\/run\/R-\d+\?card=SC-/.test(href) && linked && (await p.evaluate(() => location.hash)) === href, 'a pending card deep link opens the Task with that card', href);
      ok(await p.evaluate((id) => { const r = document.querySelector(`[data-scard="${id}"]`).getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; }, cardId), 'the linked card is in view');
      // the Studio row: Tasks filtered to no project
      await p.click('[data-projects-nav] [data-project-row="studio"]');
      await p.waitForSelector('[data-project-filter="studio"]');
      await p.waitForFunction(() => document.querySelectorAll('[data-run]').length > 0, null, { timeout: 8000 }).catch(() => {});
      const runs = await p.locator('[data-run]').evaluateAll((es) => es.map((e) => e.dataset.run));
      ok(runs.join() === seed.runs.loose, 'the Studio row opens Tasks filtered to the Tasks in no project', JSON.stringify(runs));
      await p.waitForSelector('[data-section="node-runs"] h2');
      const rounds = await p.locator('[data-node-run]').evaluateAll((es) => es.map((e) => e.dataset.nodeRun));
      ok(!rounds.some((r) => r.startsWith(`${seed.runs.rate}/`) || r.startsWith(`${seed.runs.merged}/`)), 'the Agent rounds panel follows the project filter', JSON.stringify(rounds));
      // the crew link preselects the project in the staffing panel
      await p.goto(`${base}/#/firstmate?staffing=harbor-api`); await p.waitForTimeout(400);
      ok(await p.evaluate(() => { const el = window.crewStaffingPanel?.(); return el?.querySelector('select')?.getAttribute('value') === 'harbor-api'; }), 'the Choose your crew together link preselects the project');
      // the external project and the sandbox
      await p.goto(`${base}/#/project/tidepool-docs`); await p.waitForSelector('[data-project-page="tidepool-docs"]:not([data-loading])');
      ok((await p.locator('[data-project-notice="external"]').textContent()).includes('External project: cannot dispatch yet') && await p.locator('[data-crew-link]').count() === 0, 'an external project: cannot dispatch yet, and no crew link');
      await p.screenshot({ path: join(shots, 'project-external-1280-light.png'), fullPage: false });
      // the broken, disabled registration renders in plain words
      await p.goto(`${base}/#/project/kelp-notes`); await p.waitForSelector('[data-project-page="kelp-notes"]:not([data-loading])');
      const kp = await p.locator('[data-project-page="kelp-notes"]').innerText();
      ok((await p.locator('[data-project-notice="disabled"]').count()) === 1 && (await p.locator('[data-crew-state="disabled"]').count()) === 1 && (await p.locator('[data-health="enabled"] svg').count()) === 1 && !/ENOENT|no such file|stat '/.test(kp), 'a disabled project with a missing folder: plain words, a non-check icon, the crew text matching its tile');
      ok(kp.includes('Repository folder missing') && kp.includes('Crew not checked'), 'its tiles: folder missing, crew not checked');
      await p.screenshot({ path: join(shots, 'project-broken-1280-light.png'), fullPage: false });
      await p.goto(`${base}/#/project/sandbox`); await p.waitForSelector('[data-project-page="sandbox"]:not([data-loading])');
      ok((await p.locator('[data-project-registered="builtin"]').textContent()).includes('Built-in'), 'the sandbox page: Built-in');
      await p.goto(`${base}/#/projects`); await p.waitForSelector('[data-projects-index] [data-project-card="studio"]');
      ok(await p.locator('[data-projects-index] [data-project-card]').count() === 5, 'the projects index: one card per project and Studio');
      const lines = Object.fromEntries(await p.locator('[data-project-card]').evaluateAll((es) => es.map((e) => [e.dataset.projectCard, e.querySelector('.faint').textContent])));
      ok(lines['harbor-api'] === '3 wait for you' && lines.sandbox === "No tasks yet. Studio's own practice repository." && lines.studio.startsWith('Tasks that belong to no project (artifact work, proposals). 1 wait for you'), 'index card lines follow the prototype', JSON.stringify(lines));
      await p.screenshot({ path: join(shots, 'index-1280-light.png'), fullPage: false });
      await p.goto(`${base}/#/project/nope`); await p.waitForSelector('[data-project-missing]');
      ok((await p.locator('[data-project-missing]').textContent()).includes('No such project'), 'an unknown project: No such project');
    }
    await ctx.close();
  }
} catch (e) { ok(false, 'the suite ran to the end', String(e?.stack || e)); }
finally { await browser?.close(); app.kill(); await new Promise((r) => (app.exitCode !== null ? r() : app.once('exit', r))); }
console.log(`\nprojects-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
