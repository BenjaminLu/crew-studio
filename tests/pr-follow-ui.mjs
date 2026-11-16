import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// PR follow-through (docs/units/pr-watch.md "Follow-through") in a browser: the real server on temporary data against the
// fictional GitHub (tests/lib/pr-follow-github.ts) and a loopback webhook stub. The four Inbox cards in their own layout
// (ask QA, ask the reviewers again, ask for approval with a team's members to pick, confirm a push), Copy, copy and DM
// (the link opened is only the one Studio built from the contact), send to a channel, nudge again, the history, an
// option that keeps the card and one that answers it; the row's link to its card, the sending settings with the
// webhook masked, the release brief's send, and the github-review graph with the new nodes. Screenshots in
// tests/out/pr-follow/.        bun tests/pr-follow-ui.mjs        (PLAYWRIGHT_MODULE may point at a playwright install)
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { freePort, waitUp, withSession } from './boot.mjs';
import { prWatchGitHub } from './lib/pr-watch-github.ts';
import { followFixture } from './lib/pr-follow-github.ts';
import { fakeSlack } from './lib/fake-slack.ts';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
let pass = 0, fail = 0; const ok = (v, n, e = '') => { console.log(`${v ? 'ok' : 'FAIL'} ${n} ${v ? '' : e}`); v ? pass++ : fail++; };

const fx = followFixture(), gh = prWatchGitHub(fx.data), gw = fx.gw;
const slack = fakeSlack('fake-bot-token-0001'); slack.users.set('U04QALEAD', { id: 'U04QALEAD', team_id: 'T0TEAM', name: 'qlead', real_name: 'Quinn Lead', profile: { real_name: 'Quinn Lead', display_name: 'qlead' } });
const posted = []; const hook = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(req) { posted.push(await req.json()); return new Response('ok'); } });
const posted2 = []; const hook2 = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(req) { posted2.push(await req.json()); return new Response('ok'); } });
const hookBad = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('no', { status: 500 }) });
const root = join(import.meta.dir, '..'), port = await freePort(), base = `http://127.0.0.1:${port}`, data = mkdtempSync(join(tmpdir(), 'crew-prfollow-ui-'));
mkdirSync(join(data, 'fm', 'state'), { recursive: true });
process.env.CREW_SESSION_TOKEN = 'test-session';
const app = spawn('bun', ['src/server.ts'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CREW_DATA: data, CREW_PORT: String(port), CREW_CHAT_PROVIDER: 'stub', CREW_GH: '0', CREW_PR_WATCH: '',
  CREW_GITHUB_API: gh.origin, CREW_GITHUB_TOKEN: 'fixture-token', CREW_GH_NO_CLI: '1', CREW_PR_WATCH_INTERVAL_MS: '600000', CREW_RETRO_AUTO: '0', CREW_SESSION_TOKEN: 'test-session', CREW_WEBHOOK_LOOPBACK: '1', CREW_SLACK_API: slack.origin,
  CREW_FM_STATE: join(data, 'fm', 'state'), CREW_CLAUDE_BIN: '/nonexistent', CREW_CODEX_BIN: '/nonexistent', CREW_CODEX_MODEL: '', CODEX_HOME: join(data, 'codex-config'), CREW_TEAM_SEED: '0' } });
const shots = join(root, 'tests/out/pr-follow'); mkdirSync(shots, { recursive: true });
const api = async (path, body) => { const r = await fetch(`${base}${path}`, body === undefined ? { headers: { 'x-crew-session': 'test-session' } } : { method: 'POST', headers: { 'x-crew-session': 'test-session', 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };
const until = async (f, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await new Promise((r) => setTimeout(r, 200)); } return !!(await f()); };
const cards = async () => ((await api('/api/scards?open=1')).body.cards || []).filter((c) => c.follow);
const cardOf = async (pr, kind) => (await cards()).find((c) => c.follow.pr === pr && c.follow.kind === kind);
let browser;
try {
  await waitUp(base, app);
  await api('/api/prs/watch', { url: `https://github.com/${gw}` });
  const settings = { which: { mine: true, assigned: true, reviewRequested: false }, evidence: { accounts: ['qa-lead'], checks: [], labels: [] }, requiredReviewers: [], environments: [{ name: 'staging', production: false, repos: [], detect: { kind: 'check', name: 'deploy/staging' } }], groups: [], shortForm: false, messageLang: null,
    follow: { enabled: true }, sending: { targets: [{ id: 'qa', name: '#qa-requests', tool: 'slack', use: 'qa', url: `http://127.0.0.1:${hook.port}/services/T0/B0/x` }, { id: 'deploy', name: '#deploy', tool: 'slack', use: 'brief', url: `http://127.0.0.1:${hook.port}/services/T0/B3/y` }],
      contacts: [{ gh: 'qa-lead', tool: 'slack', id: 'U04QALEAD' }, { gh: 'sec-bob', tool: 'email', id: 'bob@example.com' }, { gh: 'rel-dan', tool: 'teams', id: 'dan@example.com' }], slackTeam: 'T0TEAM' } };
  ok((await api('/api/prs/settings', { settings })).status === 200, 'settings: follow-through on, two send targets, contacts');
  await api('/api/prs/refresh', {}); await until(async () => (await cards()).length >= 3);
  const push = await api('/api/prs/push-check', { pr: `${gw}#216`, quote: 'Do not log the key id.', by: 'review-bot-b', tests: true }); await until(async () => !!(await cardOf(`${gw}#216`, 'push')));
  const qa = await cardOf(`${gw}#212`, 'qa'), nudge = await cardOf(`${gw}#215`, 'nudge'), ap = await cardOf(`${gw}#216`, 'approve'), pc = await cardOf(`${gw}#216`, 'push');
  ok(!!qa && !!nudge && !!ap && !!pc && push.body.voids === 2, 'four cards: QA, reviewers again, approve, and the push that voids 2 approvals', JSON.stringify(push.body));
  browser = withSession(await chromium.launch({ headless: true }), base);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] }), p = await ctx.newPage();
  await p.addInitScript(() => { try { localStorage.setItem('crew.lang', 'zh-TW'); localStorage.setItem('crew.side', 'open'); localStorage.setItem('crew.chatOpen', '0'); } catch {}
    window.__opened = []; HTMLAnchorElement.prototype.click = function () { window.__opened.push(this.getAttribute('href')); }; });
  // the QA card
  await p.goto(`${base}/#/inbox/${encodeURIComponent(qa.id)}`); await p.waitForSelector(`[data-follow-card="${qa.id}"]`);
  const box = p.locator(`[data-follow-card="${qa.id}"]`);
  ok((await box.locator('[data-follow-lead]').innerText()).includes('「Please attach a staging run that shows the 429 for the 21st request」') && await box.locator('[data-follow-rcpt="qa-lead"]').count() === 1, 'the QA card: the reviewer quoted, for the evidence source');
  ok((await box.locator('[data-follow-msg]').inputValue()).includes('POST /v1/orders') && await p.locator('.ib-row.on .ib-kind').innerText() === '請 QA 測試', 'its message cites the route in the diff; the Inbox row names the kind');
  await box.locator('[data-follow-dm="qa-lead"]').click(); await p.waitForFunction(() => window.__opened.length === 1);
  ok(await p.evaluate(() => window.__opened[0]) === 'slack://user?team=T0TEAM&id=U04QALEAD' && (await p.evaluate(() => navigator.clipboard.readText())).includes('POST /v1/orders'), 'copy and DM: the message copied, the Slack DM opened from the contact');
  await box.locator('[data-follow-send]').click(); await until(() => posted.length === 1);
  ok(posted.length === 1 && posted[0].text.includes('/v1/orders'), 'send to the channel: one post through the webhook');
  // a Slack DM through the bot: token set, contacts checked, the confirm step shows who, only its button sends
  ok(await box.locator('[data-follow-slackdm]').count() === 0, 'no Slack DM button without a bot token');
  ok((await api('/api/prs/settings', { settings: { ...settings, sending: { ...settings.sending, targets: settings.sending.targets.map(({ url, ...t }) => ({ ...t, url: '••••' })), botToken: 'fake-bot-token-0001' } } })).status === 200
    && (await api('/api/prs/sending/check', {})).body.checks['qa-lead']?.ready, 'with a bot token set, Check contacts passes qa-lead');
  await p.reload(); await p.waitForSelector(`[data-follow-card="${qa.id}"] [data-follow-slackdm="qa-lead"]`);
  ok((await box.locator('[data-follow-slackdm="qa-lead"]').innerText()).includes('Quinn Lead (qlead)'), 'a Slack DM: the card offers it named as Slack reports the person');
  await box.locator('[data-follow-slackdm="qa-lead"]').click(); await p.waitForSelector(`[data-follow-card="${qa.id}"] [data-follow-confirm]`);
  ok(await box.locator('[data-follow-confirm-to]').innerText() === 'qa-lead → Quinn Lead (qlead) → U04QALEAD' && (await box.locator('[data-follow-confirm-text]').innerText()).includes('POST /v1/orders') && slack.posted.length === 0, 'a Slack DM: the confirm step shows login → Slack name → member id and the full message; nothing sent yet');
  await p.screenshot({ path: join(shots, 'card-qa-slack-confirm-1440.png'), fullPage: true });
  await box.locator('[data-follow-confirm-send]').click(); await until(() => slack.posted.length === 1);
  await p.waitForFunction((id) => document.querySelector(`[data-follow-card="${id}"] [data-follow-history]`)?.innerText.includes('U04QALEAD'), qa.id);
  ok(slack.posted.length === 1 && slack.posted[0].channel === 'D04QALEAD' && slack.posted[0].text.includes('POST /v1/orders') && await box.locator('[data-follow-confirm]').count() === 0, 'a Slack DM: only the confirm button sends, once, recorded in the history', JSON.stringify(slack.posted));
  await p.waitForFunction((id) => document.querySelector(`[data-follow-card="${id}"] [data-follow-history]`)?.innerText.includes('已發到 #qa-requests'), qa.id);
  await box.locator('[data-follow-opt="sent"]').click(); await box.locator('[data-follow-submit]').click();
  await p.waitForFunction((id) => document.querySelector(`[data-follow-card="${id}"] [data-follow-history]`)?.innerText.includes('選了 A'), qa.id);
  ok(await p.locator(`[data-follow-card="${qa.id}"]`).count() === 1, 'option A records the choice and keeps the card until GitHub shows the evidence');
  await p.screenshot({ path: join(shots, 'card-qa-1440.png'), fullPage: true });
  await p.locator(`[data-follow-card="${qa.id}"] [data-follow-chase]`).click();
  await p.waitForFunction((id) => document.querySelector(`[data-follow-card="${id}"] [data-follow-msg]`)?.value.startsWith('再提醒一下'), qa.id);
  ok(true, 'nudge again swaps in the short follow-up');
  // the nudge card
  await p.goto(`${base}/#/inbox/${encodeURIComponent(nudge.id)}`); await p.waitForSelector(`[data-follow-card="${nudge.id}"]`);
  ok(await p.locator(`[data-follow-card="${nudge.id}"] [data-follow-rcpt]`).count() === 2 && (await p.locator(`[data-follow-card="${nudge.id}"] [data-follow-msg]`).inputValue()).includes('麻煩重驗'), 'the nudge card: both reviewers, the evidence and their comments');
  await p.screenshot({ path: join(shots, 'card-nudge-1440.png'), fullPage: true });
  // the approve card: a team's members from GitHub, the pick remembered
  await p.goto(`${base}/#/inbox/${encodeURIComponent(ap.id)}`); await p.waitForSelector(`[data-follow-card="${ap.id}"]`);
  await p.selectOption(`[data-follow-card="${ap.id}"] [data-follow-pick="@northwind/security"]`, 'sec-bob');
  await p.waitForFunction((id) => document.querySelector(`[data-follow-card="${id}"] [data-follow-dm]`)?.dataset.followDm === 'sec-bob', ap.id);
  await p.locator(`[data-follow-card="${ap.id}"] [data-follow-dm="sec-bob"]`).click(); await p.waitForFunction(() => window.__opened.some((x) => x.startsWith('mailto:')));
  ok((await p.evaluate(() => window.__opened.find((x) => x.startsWith('mailto:')))).startsWith('mailto:bob@example.com?subject=') && (await api('/api/prs')).body.settings && true, 'picking sec-bob from the team, copy and DM opens an email with the message');
  ok((await p.locator(`[data-follow-card="${ap.id}"] [data-follow-missing]`).innerText()).includes('@northwind/security') && !(await p.locator(`[data-follow-card="${ap.id}"] [data-follow-missing]`).innerText()).includes('release-approvers'), 'only the group still missing');
  await p.waitForFunction((id) => document.querySelector(`[data-follow-card="${id}"] [data-follow-rcpt]`)?.innerText.includes('上次找的是 sec-bob'), ap.id).catch(() => {});
  ok((await p.locator(`[data-follow-card="${ap.id}"] [data-follow-rcpt]`).innerText()).includes('上次找的是 sec-bob') && await p.locator(`[data-follow-card="${ap.id}"] [data-follow-target]`).inputValue() === '', 'the approve card says who was asked last time, and offers no QA channel by default');
  ok((await p.locator(`[data-follow-card="${ap.id}"] .ba`).innerText()).split('rel-dan').length === 2 && (await p.locator(`[data-follow-card="${ap.id}"] [data-follow-msg]`).inputValue()).split('rel-dan').length === 2, 'rel-dan shows once under done and once in the message (as the team that approved)');
  await p.screenshot({ path: join(shots, 'card-approve-1440.png'), fullPage: true });
  // the push card: answering it with a reason
  await p.goto(`${base}/#/inbox/${encodeURIComponent(pc.id)}`); await p.waitForSelector(`[data-follow-card="${pc.id}"]`);
  ok((await p.locator(`[data-follow-card="${pc.id}"] [data-follow-title]`).innerText()).includes('這次 push 會讓 2 個 approve 失效') && await p.locator(`[data-follow-card="${pc.id}"] [data-follow-msg]`).count() === 0, 'the push card asks before voiding 2 approvals; it has no message to send');
  { const lead = await p.locator(`[data-follow-card="${pc.id}"] [data-follow-lead]`).innerText();
    ok(lead.startsWith('review-bot-b 留了一條意見：「Do not log the key id」') && !lead.includes('."') && (await p.locator(`[data-follow-card="${pc.id}"] .ba`).innerText()).includes('測試通過'), 'the push card says who commented, without doubled punctuation, and that the tests pass', lead); }
  await p.screenshot({ path: join(shots, 'card-push-1440.png'), fullPage: true });
  await p.locator(`[data-follow-card="${pc.id}"] [data-follow-opt="no-push"]`).click();
  ok(await p.locator(`[data-follow-card="${pc.id}"] [data-follow-submit]`).isDisabled(), 'an option that needs a reason waits for it');
  await p.fill(`[data-follow-card="${pc.id}"] [data-follow-note]`, 'The key id is not secret; the log keeps it on purpose.'); await p.locator(`[data-follow-card="${pc.id}"] [data-follow-submit]`).click();
  await until(async () => !(await cardOf(`${gw}#216`, 'push')));
  ok(!(await cardOf(`${gw}#216`, 'push')), 'answering B closes the push card with the reason');
  // the Pull requests page: the row's link to its card, the settings with the webhook masked
  await p.goto(`${base}/#/prs`); await p.waitForSelector(`[data-prs-row="${gw}#212"]`);
  ok(await p.locator(`[data-prs-row="${gw}#212"] [data-prs-follow-card="qa"]`).getAttribute('href') === `#/inbox/${encodeURIComponent(qa.id)}`, 'the row links to its open card');
  ok(await p.locator('[data-prs-tab="nudge"]').count() === 1 && (await p.locator('[data-prs-tab] ').allInnerTexts()).map((t) => t.replace(/\s*\d+.*$/s, '')).slice(0, 5).join() === '全部,等 approve,等測試,等修正,等重驗', 'the tabs follow the design: 等重驗 after 等修正', JSON.stringify(await p.locator('[data-prs-tab]').allInnerTexts()));
  ok(await p.locator(`[data-prs-row="${gw}#212"] [data-prs-next]`).innerText() === '等 QA 實測' && await p.locator(`[data-prs-row="${gw}#212"]`).getAttribute('data-next') === 'test', '212 reads 等 QA 實測, under the test tab, like its card');
  await p.evaluate(() => localStorage.setItem('crew.lang', 'en')); await p.addInitScript(() => { try { localStorage.setItem('crew.lang', 'en'); } catch {} }); await p.reload(); await p.waitForSelector(`[data-prs-row]`); await p.waitForTimeout(800);
  { const spill = await p.evaluate(() => [...document.querySelectorAll('[data-prs-row] .pw-next')].flatMap((c) => { const r = { right: Math.min(c.getBoundingClientRect().right, c.nextElementSibling.getBoundingClientRect().left) }; return [c, ...c.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > r.right + 1 || e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.slice(0, 30)); }));
    ok(!spill.length, 'at 1440 (English) the next step and its card button stay inside their column', JSON.stringify(spill)); }
  // a cramped column (the reviewer's 1440 page had one): squeeze the card button and check its mark
  await p.addStyleTag({ content: '.pw-next .pw-followcta{max-width:96px!important}' });
  for (const w of [1440, 1280, 1180]) { await p.setViewportSize({ width: w, height: 1000 }); await p.waitForTimeout(200);
    ok(await p.evaluate(() => [...document.querySelectorAll('[data-prs-follow-card] .pw-new')].every((e) => { const g = document.createRange(); g.selectNodeContents(e); return new Set([...g.getClientRects()].map((x) => Math.round(x.top))).size === 1; }) && document.querySelectorAll('[data-prs-follow-card] .pw-new').length > 0), `at ${w} the card button's "new" mark stays on one line`); }
  await p.setViewportSize({ width: 1440, height: 1000 });
  await p.addInitScript(() => { try { localStorage.setItem('crew.lang', 'zh-TW'); } catch {} }); await p.evaluate(() => localStorage.setItem('crew.lang', 'zh-TW')); await p.reload(); await p.waitForSelector(`[data-prs-row]`);
  await p.screenshot({ path: join(shots, 'prs-open-1440.png'), fullPage: true });
  await p.click(`[data-prs-row="${gw}#212"] .pw-title`); await p.waitForSelector('[data-prs-flow="needs-evidence"]'); await p.waitForSelector('[data-prs-detail-card] [data-follow-card]');
  ok(await p.locator('[data-prs-detail-card] .pw-new').count() === 2 && (await p.locator('[data-prs-flow] > .card:first-child .pw-rules li.hit').innerText()).startsWith('QA 實測') && (await p.locator('[data-prs-flow]').innerText()).includes('為什麼走這條岔路') && await p.locator('[data-prs-rules] li.hit').getAttribute('data-rule') === 'evidence-asked', 'the row detail: where the flow is, why this branch, its card; the rule list agrees (evidence asked, not fix)');
  await p.screenshot({ path: join(shots, 'prs-detail-212-1440.png') }); await p.keyboard.press('Escape');
  // every kind of card, embedded in its row's dialog, stays inside the dialog at 1440 and at 390
  for (const w of [1440, 390]) { await p.setViewportSize({ width: w, height: 1000 });
    for (const id of [`${gw}#212`, `${gw}#215`, `${gw}#216`]) {
      await p.locator(`[data-prs-row="${id}"] .pw-title`).click(); await p.waitForSelector('[data-prs-dialog="detail"] [data-prs-detail-card] [data-follow-card]', { timeout: 10000 });
      const fit = await p.evaluate(() => { const d = document.querySelector('[data-prs-dialog="detail"]').getBoundingClientRect(), c = document.querySelector('[data-prs-detail-card]');
        const out = [...c.querySelectorAll('*')].filter((e) => e.getClientRects().length).map((e) => e.getBoundingClientRect().right).filter((r) => r > d.right + 1); return { dr: d.right, n: out.length, max: Math.max(0, ...out) }; });
      ok(fit.n === 0, `at ${w} the ${id} card inside the dialog stays inside it`, JSON.stringify(fit));
      if (id.endsWith('#216') && w === 1440) await p.screenshot({ path: join(shots, 'prs-detail-216-1440.png') });
      if (id.endsWith('#216') && w === 390) await p.screenshot({ path: join(shots, 'prs-detail-216-390.png') });
      await p.keyboard.press('Escape'); await p.waitForSelector('[data-prs-dialog="detail"]', { state: 'detached' }); } }
  await p.setViewportSize({ width: 1440, height: 1000 });
  await p.click('[data-prs-settings]'); await p.waitForSelector('[data-prs-targets]');
  const hookShown = await p.locator('[data-prs-hook="qa"]').inputValue();
  ok(hookShown.includes('••••') && !hookShown.includes('services/T0') && await p.locator('[data-prs-contact]').count() === 3, 'the settings show the webhook masked and the contacts', hookShown);
  { const tok = await p.locator('[data-prs-bot-token]').inputValue();
    ok(tok.startsWith('••••') && !tok.includes('fake-bot') && await p.locator('[data-prs-slack-check-row="qa-lead"]').getAttribute('data-ok') === 'true' && (await p.locator('[data-prs-slack-check-row="qa-lead"]').innerText()).includes('Quinn Lead (qlead)'), 'the settings show the bot token masked and each Slack contact as last checked', tok); }
  await p.locator('[data-prs-targets]').scrollIntoViewIfNeeded(); await p.screenshot({ path: join(shots, 'settings-1440.png') });
  await p.setViewportSize({ width: 390, height: 900 }); await p.locator('[data-prs-contacts]').scrollIntoViewIfNeeded();
  ok(await p.evaluate(() => [...document.querySelectorAll('[data-prs-contact]')].every((row) => { const x = row.querySelector('.pw-x').getBoundingClientRect(), r = row.getBoundingClientRect(); return x.top - r.top < 20; })), 'at 390 each settings row keeps its × at the top, not on a line of its own');
  await p.screenshot({ path: join(shots, 'settings-390.png') }); await p.setViewportSize({ width: 1440, height: 1000 });
  await p.click('[data-prs-hook-test="qa"]'); await until(() => posted.length === 2); ok(posted.length === 2, 'Send a test posts once');
  await p.waitForSelector('[data-prs-hook-result="qa"].ok'); ok((await p.locator('[data-prs-hook-result="qa"]').innerText()).includes('#qa-requests') && !(await p.locator('[data-prs-hook-result="qa"]').innerText()).includes('尚未儲存'), 'the saved target: the result on its row names the channel to check', await p.locator('[data-prs-hook-result="qa"]').innerText());
  // an unsaved target: paste, press Enter, the result on the row; nothing kept until Save
  await p.click('[data-prs-target-add]'); const row = p.locator('[data-prs-target-row]').last(), rid = await row.getAttribute('data-prs-target-row');
  await row.locator('input').first().fill('#unsaved-test'); await row.locator('[data-prs-hook]').fill(`http://127.0.0.1:${hook2.port}/services/T0/B9/typed`); await row.locator('[data-prs-hook]').press('Enter');
  await p.waitForSelector(`[data-prs-hook-result="${rid}"].ok`); { const t = await row.locator('[data-prs-hook-result]').innerText();
    ok(posted2.length === 1 && posted2[0].text.startsWith('Crew Studio: a test message') && t.includes('#unsaved-test') && t.includes('webhook 不會告訴 Studio') && t.includes('尚未儲存') && posted.length === 2, 'Enter on an unsaved webhook sends the test there and says so on the row', t); }
  await row.locator('[data-prs-hook]').fill(`http://127.0.0.1:${hookBad.port}/services/T0/B8/bad`); await row.locator('[data-prs-hook]').press('Enter');
  await p.waitForSelector(`[data-prs-hook-result="${rid}"].bad`); ok((await row.locator('[data-prs-hook-result]').innerText()).includes('500'), 'a webhook that answers 500: the reason inline on the row', await row.locator('[data-prs-hook-result]').innerText());
  await row.locator('[data-prs-hook]').fill('https://example.com/services/x'); await row.locator('[data-prs-hook-test]').click();
  await p.waitForFunction((id) => document.querySelector(`[data-prs-hook-result="${id}"]`)?.innerText.includes('not a slack webhook'), rid); ok(posted2.length === 1, 'a host that is not the tool\'s own: refused inline, nothing posted');
  await p.locator('[data-prs-targets]').scrollIntoViewIfNeeded(); await p.screenshot({ path: join(shots, 'settings-send-test-1440.png') });
  // Send test DM: the saved contact, then one typed and not saved
  await p.click('[data-prs-contact-test="0"]'); await p.waitForSelector('[data-prs-contact-result="0"].ok');
  { const t = await p.locator('[data-prs-contact-result="0"]').innerText(); ok(t.includes('D04QALEAD') && t.includes('Quinn Lead (qlead)') && slack.posted.at(-1).channel === 'D04QALEAD' && slack.posted.at(-1).text.startsWith('Crew Studio: a test message'), 'Send test DM: the fixed test text, the DM and the name Slack reports on the row', t); }
  const dms = slack.posted.length; await p.click('[data-prs-contact-add]'); const ci = await p.locator('[data-prs-contact]').count() - 1;
  await p.locator(`[data-prs-contact-id="${ci}"]`).fill('U04NOBODY'); await p.locator(`[data-prs-contact-id="${ci}"]`).press('Enter');
  await p.waitForSelector(`[data-prs-contact-result="${ci}"].bad`); ok((await p.locator(`[data-prs-contact-result="${ci}"]`).innerText()).includes('user_not_found') && slack.posted.length === dms, 'Enter on an unknown member id: the reason inline, no DM', await p.locator(`[data-prs-contact-result="${ci}"]`).innerText());
  await p.locator('[data-prs-contacts]').scrollIntoViewIfNeeded(); await p.screenshot({ path: join(shots, 'settings-send-test-dm-1440.png') });
  await p.locator('[data-prs-contact="sec-bob"] .pw-x').click();
  ok((await p.locator(`[data-prs-contact-result="${ci - 1}"]`).innerText()).includes('user_not_found') && (await p.locator('[data-prs-contact-result="0"]').innerText()).includes('D04QALEAD'), 'removing a row above keeps each result on its own row');
  await p.locator('[data-prs-contact-id="0"]').fill('U04OTHER'); ok(await p.locator('[data-prs-contact-result="0"]').innerText() === '', 'editing the value clears its old result');
  await p.keyboard.press('Escape');
  { const v = (await api('/api/prs')).body; ok(v.settings.sending.targets.length === 2 && v.settings.sending.contacts.length === 3 && !JSON.stringify(v).includes('#unsaved-test') && !readdirSync(join(data, 'pr-watch')).some((f) => readFileSync(join(data, 'pr-watch', f), 'utf8').includes('B9/typed')), 'closed without saving: the tested target, webhook and contact were not kept'); }
  // the github-review graph with the new nodes
  await p.goto(`${base}/#/workflows/github-review/advanced`); await p.waitForSelector('svg .rt-node', { timeout: 20000 }).catch(() => {}); await p.getByRole('button', { name: '編輯流程' }).click().catch(() => {}); await p.waitForTimeout(800);
  const labels = await p.locator('svg .rt-node').evaluateAll((es) => es.map((e) => e.textContent || '')).catch(() => []);
  ok(['PR follow-through', 'Ask QA to test', 'Ask reviewers to look again', 'Ask for approval', 'Follow to production', 'Release brief'].every((l) => labels.some((x) => x.startsWith(l.slice(0, 10)))) && labels.some((x) => x.includes('pr.track-dep')), 'the github-review graph shows the new nodes', JSON.stringify(labels.slice(-12)));
  await p.evaluate(() => { const g = document.querySelector('svg.rt-graph'), n = [...g.querySelectorAll('.rt-node')].find((e) => e.textContent.startsWith('PR follow-through')), b = n.getBBox(), m = n.getCTM(), s = g.getScreenCTM().inverse().multiply(m); const x = s.e + b.x, y = s.f + b.y; g.setView({ x: x - 500, y: y - 420, w: 1500, h: 820 }); }); await p.locator('svg .rt-node', { hasText: 'PR follow-through' }).first().click().catch(() => {}); await p.waitForTimeout(600);
  ok(await p.locator('[data-node-explain="shepherd"]').count() === 1 && (await p.locator('[data-node-branches="shepherd"]').innerText()).includes('needs-evidence') && await p.locator('[data-node-preview="shepherd"]').count() === 1 && (await p.locator('[data-node-explain="shepherd"]').innerText()).includes('還不會執行'), 'the PR follow-through node explains what it reads, its branches, that it does not run yet, and links to its card');
  ok(await p.locator('[data-node-new="shepherd"]').count() === 1 && await p.locator('[data-add-preset="pr.shepherd"] .pw-new').count() === 1 && await p.locator('[data-add-preset="Ask for approval (card)"]').count() === 1, 'new nodes carry the new mark, in the graph and in the palette\'s PR section');
  await p.screenshot({ path: join(shots, 'workflow-1440.png') });
  ok(!gh.calls.some((c) => c.method !== 'GET' && c.path !== '/graphql') && !gh.unknown.length, 'nothing was written to GitHub', JSON.stringify(gh.unknown));
  await ctx.close();
} catch (e) { ok(false, 'the suite ran to its end', String(e?.stack || e)); }
finally { await browser?.close().catch(() => {}); app.kill(); gh.stop(); hook.stop(true); hook2.stop(true); hookBad.stop(true); slack.stop(); }
console.log(`\npr-follow-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
