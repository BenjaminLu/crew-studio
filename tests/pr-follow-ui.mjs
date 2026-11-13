import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// PR follow-through (docs/units/pr-watch.md "Follow-through") in a browser: the real server on temporary data against the
// fictional GitHub (tests/lib/pr-follow-github.ts) and a loopback webhook stub. The four Inbox cards in their own layout
// (ask QA, ask the reviewers again, ask for approval with a team's members to pick, confirm a push), Copy, copy and DM
// (the link opened is only the one Studio built from the contact), send to a channel, nudge again, the history, an
// option that keeps the card and one that answers it; the row's link to its card, the sending settings with the
// webhook masked, the release brief's send, and the github-review graph with the new nodes. Screenshots in
// tests/out/pr-follow/.        bun tests/pr-follow-ui.mjs        (PLAYWRIGHT_MODULE may point at a playwright install)
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { freePort, waitUp, withSession } from './boot.mjs';
import { prWatchGitHub } from './lib/pr-watch-github.ts';
import { followFixture } from './lib/pr-follow-github.ts';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
let pass = 0, fail = 0; const ok = (v, n, e = '') => { console.log(`${v ? 'ok' : 'FAIL'} ${n} ${v ? '' : e}`); v ? pass++ : fail++; };

const fx = followFixture(), gh = prWatchGitHub(fx.data), gw = fx.gw;
const posted = []; const hook = Bun.serve({ port: 0, hostname: '127.0.0.1', async fetch(req) { posted.push(await req.json()); return new Response('ok'); } });
const root = join(import.meta.dir, '..'), port = await freePort(), base = `http://127.0.0.1:${port}`, data = mkdtempSync(join(tmpdir(), 'crew-prfollow-ui-'));
mkdirSync(join(data, 'fm', 'state'), { recursive: true });
process.env.CREW_SESSION_TOKEN = 'test-session';
const app = spawn('bun', ['src/server.ts'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CREW_DATA: data, CREW_PORT: String(port), CREW_CHAT_PROVIDER: 'stub', CREW_GH: '0', CREW_PR_WATCH: '',
  CREW_GITHUB_API: gh.origin, CREW_GITHUB_TOKEN: 'fixture-token', CREW_GH_NO_CLI: '1', CREW_PR_WATCH_INTERVAL_MS: '600000', CREW_RETRO_AUTO: '0', CREW_SESSION_TOKEN: 'test-session', CREW_WEBHOOK_LOOPBACK: '1',
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
  ok((await box.locator('[data-follow-lead]').innerText()).includes('「Please attach a staging run that shows the 429 for the 21st request.」') && await box.locator('[data-follow-rcpt="qa-lead"]').count() === 1, 'the QA card: the reviewer quoted, for the evidence source');
  ok((await box.locator('[data-follow-msg]').inputValue()).includes('POST /v1/orders') && await p.locator('.ib-row.on .ib-kind').innerText() === '請 QA 測試', 'its message cites the route in the diff; the Inbox row names the kind');
  await box.locator('[data-follow-dm="qa-lead"]').click(); await p.waitForFunction(() => window.__opened.length === 1);
  ok(await p.evaluate(() => window.__opened[0]) === 'slack://user?team=T0TEAM&id=U04QALEAD' && (await p.evaluate(() => navigator.clipboard.readText())).includes('POST /v1/orders'), 'copy and DM: the message copied, the Slack DM opened from the contact');
  await box.locator('[data-follow-send]').click(); await until(() => posted.length === 1);
  ok(posted.length === 1 && posted[0].text.includes('/v1/orders'), 'send to the channel: one post through the webhook');
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
  await p.locator(`[data-follow-card="${ap.id}"] [data-follow-dm="sec-bob"]`).click(); await p.waitForFunction(() => window.__opened.length === 2);
  ok((await p.evaluate(() => window.__opened[1])).startsWith('mailto:bob@example.com?subject=') && (await api('/api/prs')).body.settings && true, 'picking sec-bob from the team, copy and DM opens an email with the message');
  ok((await p.locator(`[data-follow-card="${ap.id}"] [data-follow-missing]`).innerText()).includes('@northwind/security') && !(await p.locator(`[data-follow-card="${ap.id}"] [data-follow-missing]`).innerText()).includes('release-approvers'), 'only the group still missing');
  await p.waitForFunction((id) => document.querySelector(`[data-follow-card="${id}"] [data-follow-rcpt]`)?.innerText.includes('上次找的是 sec-bob'), ap.id).catch(() => {});
  ok((await p.locator(`[data-follow-card="${ap.id}"] [data-follow-rcpt]`).innerText()).includes('上次找的是 sec-bob') && await p.locator(`[data-follow-card="${ap.id}"] [data-follow-target]`).inputValue() === '', 'the approve card says who was asked last time, and offers no QA channel by default');
  ok((await p.locator(`[data-follow-card="${ap.id}"] .ba`).innerText()).split('rel-dan').length === 2, 'rel-dan shows once under done (as the team that approved)');
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
  await p.screenshot({ path: join(shots, 'prs-open-1440.png'), fullPage: true });
  await p.click(`[data-prs-row="${gw}#212"] .pw-title`); await p.waitForSelector('[data-prs-flow="needs-evidence"]'); await p.waitForSelector('[data-prs-detail-card] [data-follow-card]');
  ok((await p.locator('[data-prs-flow] > .card:first-child .pw-rules li.hit').innerText()).startsWith('QA 實測') && (await p.locator('[data-prs-flow]').innerText()).includes('為什麼走這條岔路') && await p.locator('[data-prs-rules] li.hit').getAttribute('data-rule') === 'evidence-asked', 'the row detail: where the flow is, why this branch, its card; the rule list agrees (evidence asked, not fix)');
  await p.screenshot({ path: join(shots, 'prs-detail-212-1440.png') }); await p.keyboard.press('Escape');
  await p.click('[data-prs-settings]'); await p.waitForSelector('[data-prs-targets]');
  const hookShown = await p.locator('[data-prs-hook="qa"]').inputValue();
  ok(hookShown.includes('••••') && !hookShown.includes('/x') && await p.locator('[data-prs-contact]').count() === 3, 'the settings show the webhook masked and the contacts', hookShown);
  await p.locator('[data-prs-targets]').scrollIntoViewIfNeeded(); await p.screenshot({ path: join(shots, 'settings-1440.png') });
  await p.click('[data-prs-hook-test="qa"]'); await until(() => posted.length === 2); ok(posted.length === 2, 'Send a test posts once');
  await p.keyboard.press('Escape');
  // the github-review graph with the new nodes
  await p.goto(`${base}/#/workflows/github-review/advanced`); await p.waitForSelector('svg .rt-node', { timeout: 20000 }).catch(() => {}); await p.getByRole('button', { name: '編輯流程' }).click().catch(() => {}); await p.waitForTimeout(800);
  const labels = await p.locator('svg .rt-node').evaluateAll((es) => es.map((e) => e.textContent || '')).catch(() => []);
  ok(['PR follow-through', 'Ask QA to test', 'Ask reviewers to look again', 'Ask for approval', 'Follow to production', 'Release brief'].every((l) => labels.some((x) => x.startsWith(l.slice(0, 10)))) && labels.some((x) => x.includes('pr.track-dep')), 'the github-review graph shows the new nodes', JSON.stringify(labels.slice(-12)));
  await p.evaluate(() => { const g = document.querySelector('svg.rt-graph'), n = [...g.querySelectorAll('.rt-node')].find((e) => e.textContent.startsWith('PR follow-through')), b = n.getBBox(), m = n.getCTM(), s = g.getScreenCTM().inverse().multiply(m); const x = s.e + b.x, y = s.f + b.y; g.setView({ x: x - 500, y: y - 420, w: 1500, h: 820 }); }); await p.locator('svg .rt-node', { hasText: 'PR follow-through' }).first().click().catch(() => {}); await p.waitForTimeout(600);
  ok(await p.locator('[data-node-explain="shepherd"]').count() === 1 && (await p.locator('[data-node-branches="shepherd"]').innerText()).includes('needs-evidence') && await p.locator('[data-node-preview="shepherd"]').count() === 1 && (await p.locator('[data-node-explain="shepherd"]').innerText()).includes('還不會執行'), 'the PR follow-through node explains what it reads, its branches, that it does not run yet, and links to its card');
  ok(await p.locator('[data-node-new="shepherd"]').count() === 1 && await p.locator('[data-add-preset="pr.shepherd"] .pw-new').count() === 1, 'new nodes carry the new mark, in the graph and in the palette\'s PR section');
  await p.screenshot({ path: join(shots, 'workflow-1440.png') });
  ok(!gh.calls.some((c) => c.method !== 'GET' && c.path !== '/graphql') && !gh.unknown.length, 'nothing was written to GitHub', JSON.stringify(gh.unknown));
  await ctx.close();
} catch (e) { ok(false, 'the suite ran to its end', String(e?.stack || e)); }
finally { await browser?.close().catch(() => {}); app.kill(); gh.stop(); hook.stop(true); }
console.log(`\npr-follow-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
