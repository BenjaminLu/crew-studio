import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Projects in the sidebar, phase 1 (projects design §2, §3.4): the real server on temporary data with three projects in
// different states and a Task in no project (tests/projects-fixture.ts), driven in a browser.
//   bun tests/projects-ui.mjs          (PLAYWRIGHT_MODULE may point at a playwright install)
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { seedProjects } from './projects-fixture.ts';
import { freePort, waitUp, withSession } from './boot.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
let pass = 0, fail = 0; const ok = (v, n, e = '') => { console.log(`${v ? 'ok' : 'FAIL'} ${n} ${v ? '' : e}`); v ? pass++ : fail++; };

const seed = await seedProjects();
const root = join(import.meta.dir, '..'), port = await freePort(), base = `http://127.0.0.1:${port}`;
mkdirSync(join(seed.data, 'fm', 'state'), { recursive: true });
process.env.CREW_SESSION_TOKEN = 'test-session';
// This fixture exercises per-project staffing; global team migration has its own suite.
const app = spawn('bun', ['src/server.ts'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CREW_DATA: seed.data, CREW_PORT: String(port), CREW_CHAT_PROVIDER: 'stub', CREW_GH: '0', CREW_READONLY: '1', CREW_RETRO_AUTO: '0',
  CREW_SESSION_TOKEN: 'test-session', CREW_FM_STATE: join(seed.data, 'fm', 'state'), CREW_CLAUDE_BIN: '/nonexistent', CREW_CODEX_BIN: '/nonexistent', CREW_CODEX_MODEL: '', CODEX_HOME: join(seed.data, 'codex-config'), CREW_TEAM_SEED: '0' } });
const shots = join(root, 'tests/out/projects'); mkdirSync(shots, { recursive: true });
let browser;
const COST = /\$\s?\d|\bcost\b|\bUSD\b|\bprice\b|成本|費用|花費/i;
try {
  await waitUp(base, app);
  // auth over HTTP: no session, a 401; the session header reads
  ok((await fetch(`${base}/api/projects/overview`, { headers: { 'x-crew-session': '' } })).status === 401, 'GET /api/projects/overview without a session: 401');
  ok((await fetch(`${base}/api/projects/harbor-api/overview`, { headers: { 'x-crew-session': '' } })).status === 401, 'GET /api/projects/<id>/overview without a session: 401');
  const side = await (await fetch(`${base}/api/projects/overview`, { headers: { 'x-crew-session': 'test-session' } })).json();
  ok(side.projects?.map((p) => p.id).join() === 'harbor-api,tidepool-docs,sandbox,studio', 'the sidebar payload lists the three projects and the Studio row', JSON.stringify(side.projects?.map((p) => p.id)));
  browser = withSession(await chromium.launch({ headless: true }), base);

  const regFile = join(seed.data, 'projects.json'), healthy = readFileSync(regFile, 'utf8');
  const open = async (width, theme, o = {}) => { const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme }); const p = await ctx.newPage();
    await p.addInitScript(([t, dock]) => { try { localStorage.setItem('crew.theme', t); localStorage.setItem('crew.lang', 'en'); localStorage.setItem('crew.side', 'open'); localStorage.setItem('crew.chatOpen', dock ? '1' : '0'); } catch {} }, [theme, !!o.dock]); return { ctx, p }; };
  const full = (p) => p.evaluate(() => { const f = document.querySelector('#chatFab'); if (f) f.style.visibility = 'hidden'; document.body.style.overflow = 'visible'; const s = document.querySelector('.shell'); if (s) s.style.height = 'auto'; const m = document.querySelector('#main'); if (m) m.style.overflow = 'visible'; });
  { // ---- broken registrations: kelp-notes (disabled, folder gone) and reef-log (enabled, folder gone) ----
    writeFileSync(regFile, JSON.stringify([...JSON.parse(healthy), ...seed.broken], null, 1));
    const { ctx, p } = await open(1280, 'light');
    await p.goto(`${base}/#/project/harbor-api`); await p.waitForSelector('[data-project-page="harbor-api"]:not([data-loading])');
    const crewTile = await p.locator('[data-health="crew"]').innerText(), crewSec = await p.locator('#s-crew').innerText(), txt = await p.locator('[data-project-page]').innerText();
    ok(/No task can start/.test(crewTile) && crewTile.includes('Registration drift-log: its Git data is missing or malformed.') && !/Crew approved/.test(txt), 'harbor-api: the crew tile says no task can start and names the registration and why', crewTile);
    ok(crewSec.includes('No task can start: Registration drift-log: its Git data is missing or malformed.') && !txt.includes('-gone') && !/ENOENT|no such file|stat '/.test(txt), 'the crew section says the same, with no path and no exception text', crewSec);
    const enabledTile = await p.locator('[data-health="enabled"]').innerText();
    ok(enabledTile.includes('No task can start (see Crew)') && !enabledTile.includes('New tasks can start') && (await p.locator('[data-health="enabled"]').getAttribute('class')).includes(' warn') && (await p.locator('[data-health="enabled"] svg path').first().getAttribute('d')) !== 'M20 6 9 17l-5-5', 'the Enabled tile does not say tasks can start, and shows no check mark', enabledTile);
    ok(await p.locator('[data-crew-link]').count() === 0, 'no Choose your crew together link while no task can start');
    ok((await p.locator('[data-project-enabled="1"]').getAttribute('class')).includes('warn') && (await p.locator('[data-project-enabled="1"]').getAttribute('data-can-start')) === '0', 'the header Enabled badge warns too, matching the tile');
    ok(!(await p.locator('[data-health="crew"]').getAttribute('class')).includes(' ok'), 'the warning does not count as a passing check');
    const rows = Object.fromEntries(await p.locator('[data-projects-nav] [data-project-row]').evaluateAll((es) => es.map((e) => [e.dataset.projectRow, e.querySelector('[data-project-status]').textContent])));
    ok(rows['reef-log'] === 'Folder missing' && rows['kelp-notes'] === 'Disabled' && rows['harbor-api'] === 'No task can start', 'the sidebar: Folder missing for an enabled project whose folder is gone, Disabled first', JSON.stringify(rows));
    await full(p); await p.screenshot({ path: join(shots, 'project-harbor-broken-registry-1280-light.png'), fullPage: true });
    { const ph = await open(390, 'dark'); await ph.p.goto(`${base}/#/project/harbor-api`); await ph.p.waitForSelector('[data-project-page="harbor-api"]:not([data-loading])');
      const sum = await ph.p.locator('.pj-h-sum').innerText().catch(() => '');
      ok(!/enabled/i.test(sum) && await ph.p.locator('[data-health="enabled"]').isVisible(), 'on a phone the passing-checks summary does not list Enabled, and the Enabled warning stays visible', sum);
      await ph.ctx.close(); }
    await p.goto(`${base}/#/project/reef-log`); await p.waitForSelector('[data-project-page="reef-log"]:not([data-loading])');
    ok(await p.locator('[data-project-folder="missing"]').count() === 1 && await p.locator('[data-project-registered]').count() === 0 && await p.locator('[data-project-enabled]').count() === 0 && await p.locator('[data-crew-link]').count() === 0, 'reef-log: a Folder missing badge (no Enabled badge), and no Choose your crew together link');
    const reefEnabled = await p.locator('[data-health="enabled"]').innerText();
    ok(reefEnabled.includes('Folder missing') && !reefEnabled.includes('New tasks can start'), 'reef-log: the Enabled tile reads Folder missing', reefEnabled);
    await p.screenshot({ path: join(shots, 'project-reef-log-1280-light.png'), fullPage: false });
    await p.goto(`${base}/#/project/kelp-notes`); await p.waitForSelector('[data-project-page="kelp-notes"]:not([data-loading])');
    const kp = await p.locator('[data-project-page="kelp-notes"]').innerText();
    ok((await p.locator('[data-project-notice="disabled"]').count()) === 1 && (await p.locator('[data-crew-state="disabled"]').count()) === 1 && (await p.locator('[data-health="enabled"] svg').count()) === 1 && !/ENOENT|no such file|stat '/.test(kp), 'kelp-notes: plain words, a non-check icon, the crew text matching its tile');
    ok(kp.includes('Repository folder missing') && kp.includes('Crew not checked'), 'kelp-notes tiles: folder missing, crew not checked');
    await p.screenshot({ path: join(shots, 'project-kelp-notes-1280-light.png'), fullPage: false });
    await p.goto(`${base}/#/projects`); await p.waitForSelector('[data-projects-index] [data-project-card="reef-log"]');
    ok((await p.locator('[data-project-card="reef-log"] .faint').textContent()).startsWith('Folder missing'), 'the index card of reef-log says Folder missing');
    // the sidebar at 1280x900 with more projects than it can show (independent of the sidebar's own chrome): spare
    // registrations (missing roots, so they block nothing) are added until the list runs on 100 px past its height
    const spare = (i) => ({ id: `spare-${String(i).padStart(2, '0')}`, name: `spare-${String(i).padStart(2, '0')}`, path: join(seed.data, `spare-gone-${i}`), base: 'main', sensitive: [], proposed: null, proposedAt: null, approvedAt: null });
    const overflowList = async () => { for (let n = 4; n <= 60; n += 4) {
      writeFileSync(regFile, JSON.stringify([...JSON.parse(healthy), ...seed.broken, ...Array.from({ length: n }, (_, i) => spare(i + 1))], null, 1));
      await p.goto(`${base}/#/project/harbor-api`); await p.reload(); await p.waitForSelector('[data-projects-nav] [data-project-row="studio"]'); await p.waitForTimeout(300);
      const o = await p.evaluate(() => { const l = document.querySelector('[data-projects-list]'); return { sh: l.scrollHeight, ch: l.clientHeight }; });
      if (o.sh > o.ch + 100) return { n, ...o }; } return null; };
    const of = await overflowList();
    ok(!!of, 'precondition: the projects list overflows its height by more than 100 px at 1280x900 (spare registrations added until it does)', JSON.stringify(of));
    const side = await p.evaluate(async () => { const sec = document.querySelector('[data-projects-list]'), foot = document.querySelector('.side-foot'); const moreAtTop = sec.dataset.more; sec.scrollTop = sec.scrollHeight; await new Promise((r) => setTimeout(r, 200));
      const sr = sec.getBoundingClientRect(), fr = foot.getBoundingClientRect(), last = sec.querySelector('[data-project-row="studio"]').getBoundingClientRect();
      return { secBottom: sr.bottom, footTop: fr.top, lastTop: last.top, lastBottom: last.bottom, secTop: sr.top, scrolls: sec.scrollHeight > sec.clientHeight, moreAtTop, moreAtEnd: sec.dataset.more }; });
    ok(side.secBottom <= side.footTop + 0.5 && side.lastBottom <= side.secBottom + 0.5 && side.lastTop >= side.secTop, 'at 1280x900 the projects list scrolls above the footer; its last row is fully visible when scrolled', JSON.stringify(side));
    ok(side.scrolls && side.moreAtTop === '1' && side.moreAtEnd === '0', 'a list that runs on past the footer says so (a fade and a "more" mark) until it is scrolled to the end', JSON.stringify(side));
    await p.evaluate(() => { document.querySelector('[data-projects-list]').scrollTop = 0; });
    await p.screenshot({ path: join(shots, 'sidebar-1280x900-overflowing.png'), clip: { x: 0, y: 0, width: 240, height: 900 } });
    // ten projects at 1280x900, the list scrolled to the middle: nothing shows through above the PROJECTS heading, and no row
    // is drawn under it (a row's visible part starts below the heading)
    { // the overflowing registry written above is still in place
      await p.reload(); await p.waitForSelector('[data-projects-nav] [data-project-row="studio"]'); await p.waitForTimeout(300);
      const r = await p.evaluate(async () => {
        const sec = document.querySelector('[data-projects-nav]'), hdr = sec.querySelector('.nav-proj-h');
        const scroller = [sec, ...sec.querySelectorAll('*')].find((e) => e.scrollHeight > e.clientHeight + 2 && /auto|scroll/.test(getComputedStyle(e).overflowY));
        if (!scroller) return { error: 'no scroller' };
        scroller.scrollTop = Math.round((scroller.scrollHeight - scroller.clientHeight) / 2) + 13; await new Promise((x) => setTimeout(x, 150));
        const h = hdr.getBoundingClientRect(), sr = sec.getBoundingClientRect(), clip = scroller.getBoundingClientRect(), bad = [];
        for (let y = Math.ceil(sr.top) + 1; y < h.bottom - 1; y += 2) for (const x of [h.left + 14, (h.left + h.right) / 2, h.right - 14]) { const el = document.elementFromPoint(x, y); if (el && el.closest('.pj-item')) bad.push(`row shows at y=${y}`); }
        const rowsUnder = [...sec.querySelectorAll('.pj-item')].map((e) => e.getBoundingClientRect()).filter((b) => b.bottom > clip.top && b.top < clip.bottom).filter((b) => Math.max(b.top, clip.top) < h.bottom - 0.5).length;
        return { bad: bad.slice(0, 3), rowsUnder, hdrBottom: h.bottom, clipTop: clip.top, scrollTop: scroller.scrollTop };
      });
      ok(!r.error && !r.bad.length && r.rowsUnder === 0, 'an overflowing list, scrolled: no row shows above or under the PROJECTS heading', JSON.stringify(r));
      await p.screenshot({ path: join(shots, 'sidebar-1280x900-ten-projects-scrolled.png'), clip: { x: 0, y: 0, width: 240, height: 900 } });
      writeFileSync(regFile, JSON.stringify([...JSON.parse(healthy), ...seed.broken], null, 1)); await p.reload(); await p.waitForSelector('[data-projects-nav] [data-project-row="studio"]'); }
    // an unreadable project policy: every path is one-way; the page says so and offers no edits
    { const pf = join(seed.data, 'policies', 'project-harbor-api.yaml'), keep = readFileSync(pf, 'utf8'); writeFileSync(pf, 'sensitive_paths: [unclosed\n  - : :');
      await p.goto(`${base}/#/projects`); await p.goto(`${base}/#/project/harbor-api`); await p.waitForSelector('[data-project-page="harbor-api"]:not([data-loading]) #s-paths');
      await p.waitForSelector('#s-paths [data-policy-unreadable]', { timeout: 8000 }).catch(() => {});
      const t = await p.locator('#s-paths').innerText();
      ok(t.includes('Policy file cannot be read: every path is one-way until it is fixed') && await p.locator('[data-propose-open]').count() === 0 && await p.locator('[data-approve-list]').count() === 0 && !t.includes('No project lines yet'), 'an unreadable project policy: one-way message, no Propose, no Approve', t);
      const inline = await p.evaluate(() => { const e = document.querySelector('#s-paths [data-policy-unreadable]'), i = e.querySelector('svg').getBoundingClientRect(), t = e.querySelector('span').getBoundingClientRect(); return i.right <= t.left + 0.5 && Math.abs(i.top - t.top) < 8; });
      ok(inline, 'the alert icon sits inline before the message');
      { const r = await p.locator('#s-paths').boundingBox(); if (r) await p.screenshot({ path: join(shots, 'sensitive-unreadable-1280-light.png'), clip: r }); }
      writeFileSync(pf, keep); }
    await ctx.close(); writeFileSync(regFile, healthy);
  }
  { // ---- 1280 with the Firstmate dock open (the default): the page lays out by its own width ----
    const { ctx, p } = await open(1280, 'light', { dock: true });
    await p.goto(`${base}/#/project/harbor-api`); await p.waitForSelector('[data-project-page="harbor-api"]:not([data-loading])');
    ok(await p.evaluate(() => !document.body.classList.contains('chat-closed')), 'the dock is open');
    ok((await p.locator('[data-project-enabled="1"]').getAttribute('class')).includes('ok'), 'with a healthy registry the header Enabled badge is green');
    const lay = await p.evaluate(() => ({ main: document.querySelector('#main').clientWidth, cols: getComputedStyle(document.querySelector('.pj-cols')).gridTemplateColumns.split(' ').length,
      wrapped: [...document.querySelectorAll('[data-project-page] .sec-head h2, [data-project-page] .pj-title h1')].filter((e) => { const r = e.getClientRects(); const lh = parseFloat(getComputedStyle(e).lineHeight) || 20; return e.getBoundingClientRect().height > lh * 1.6; }).map((e) => e.textContent),
      over: document.documentElement.scrollWidth - innerWidth, overMain: document.querySelector('#main').scrollWidth - document.querySelector('#main').clientWidth }));
    ok(lay.main < 900 && lay.cols === 1, 'with the dock open the page is one column', JSON.stringify(lay));
    ok(!lay.wrapped.length, 'no heading wraps', JSON.stringify(lay.wrapped));
    ok(lay.over <= 1 && lay.overMain <= 1, 'no sideways scroll', JSON.stringify(lay));
    await full(p); await p.screenshot({ path: join(shots, 'project-1280-light-dock.png'), fullPage: true });
    await ctx.close();
  }
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
      ok(rows.map((r) => r.id).join() === 'harbor-api,tidepool-docs,sandbox,studio', `sidebar renders the projects and the Studio row last (${tag})`, JSON.stringify(rows));
      ok(rows[0].status === L('Waiting for you', '等你處理') && rows[0].count === '2' && rows[1].status === L('GitHub: grant not signed by this Studio', 'GitHub：授權不是這個 Studio 簽的') && rows[2].status === L('Built-in · idle', '內建 · 閒置'), `each row has its status line and card count (${tag})`, JSON.stringify(rows));
      ok(rows[3].href === '#/runs?project=studio' && rows[3].status === L('No project · Waiting for you', '無專案 · 等你處理'), `the Studio row links to Tasks with no project (${tag})`, JSON.stringify(rows[3]));
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
    ok(tiles.find((t) => t[0] === 'crew')[1].includes(L('Crew approved', '船員已核准')) && !/ENOENT|no such file|stat '/.test(await pg.innerText()), `with a healthy registry the crew reads approved, and no exception text shows (${tag})`);
    ok((await pg.locator(`[data-worktree="${seed.runs.rate}"] small`).textContent()).startsWith(`…/work/wt/harbor-api/${seed.runs.rate}`) && (await pg.locator(`[data-worktree="${seed.runs.rate}"] small`).getAttribute('title')).startsWith('/'), `a worktree path is shortened at its start, keeping the task folder (${tag})`);
    if (width <= 760) ok(await pg.locator('.pj-h-sum').isVisible() && (await pg.locator('.pj-h-sum b').textContent()).includes('4') && await pg.locator('.pj-h.ok[data-health="enabled"]').isHidden(), `on a phone passing tiles fold into one row (${tag})`);
    const tasks = await pg.locator('[data-project-task]').evaluateAll((es) => es.map((e) => [e.dataset.projectTask, e.querySelector('[data-waits-on]').dataset.waitsOn, e.querySelector('[data-waits-on]').textContent]));
    ok(tasks.length === 2 && tasks.every((t) => t[1] === 'captain') && tasks.some((t) => t[2].includes(L('at Merge', '在「Merge」'))), `active tasks with who each waits on (${tag})`, JSON.stringify(tasks));
    ok(await pg.locator('[data-crew="code-firstmate"] .pj-role').count() === 4 && (await pg.locator('[data-crew-link]').getAttribute('href')) === '#/team?staffing=harbor-api', `crew read only, with the Choose your crew together link (${tag})`);
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
      // the language picker lives on Settings now (it left the sidebar): switch there, then come back to the project page
      await p.goto(`${base}/#/settings`); await p.click('[data-lang-set="zh-TW"]');
      await p.goto(`${base}/#/project/harbor-api`); await p.waitForSelector('[data-project-page="harbor-api"]:not([data-loading]) #hHealth');
      ok((await p.locator('#projH').textContent()) === '專案' && (await pg.locator('#hHealth').textContent()) === '健康狀態' && (await pg.locator('[data-health="rules"]').textContent()).includes('尚未檢查'), 'switching to zh-TW relabels the section and the page');
      await p.goto(`${base}/#/settings`); await p.click('[data-lang-set="en"]');
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
      ok(await p.evaluate((id) => { const a = document.activeElement; return !!a?.dataset?.option && !!a.closest(`[data-scard="${id}"]`) && a === document.querySelector(`[data-scard="${id}"] [data-option]:not([disabled])`); }, cardId), 'the deep link focuses the card\'s first answer option', await p.evaluate(() => document.activeElement?.outerHTML?.slice(0, 120)));
      // the Studio row: Tasks filtered to no project
      await p.route('**/api/tasks?project=*', async (r) => { await new Promise((x) => setTimeout(x, 1500)); await r.continue(); });
      await p.click('[data-projects-nav] [data-project-row="studio"]');
      await p.waitForSelector('[data-project-filter="studio"]');
      const loadingPanel = await p.waitForSelector('[data-section="node-runs"][data-loading]', { timeout: 1200 }).then(() => true).catch(() => false);
      ok(loadingPanel && !(await p.locator('[data-section="node-runs"]').innerText()).includes('No agent rounds yet'), 'while the project\'s Task ids load, the Agent rounds panel shows loading');
      await p.unroute('**/api/tasks?project=*');
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
      await p.goto(`${base}/#/project/sandbox`); await p.waitForSelector('[data-project-page="sandbox"]:not([data-loading])');
      ok((await p.locator('[data-project-registered="builtin"]').textContent()).includes('Built-in'), 'the sandbox page: Built-in');
      await p.goto(`${base}/#/projects`); await p.waitForSelector('[data-projects-index] [data-project-card="studio"]');
      ok(await p.locator('[data-projects-index] [data-project-card]').count() === 4, 'the projects index: one card per project and Studio');
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
