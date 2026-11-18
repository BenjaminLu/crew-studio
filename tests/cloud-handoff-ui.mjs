import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The cloud hand-off on the Task page (public/runtime.js): the "Hand off to the cloud…" action, the one confirm view
// (branch, the honest "an instruction, not enforced" wording, no cost estimate, what is left, the completion condition,
// the sessionUrl warning, the exact prompt), the refusal list, a 429 with its Retry-After (sent once), and the waiting Task
// (session link, what GitHub shows, the cloud's own words marked unverified, the red post checks and what to do next,
// take back, discard behind its own confirm, a refused take-back).
// The server side is covered by tests/cloud-handoff-flow.ts; here the hand-off endpoints are answered in the browser with
// what that server returns, over a real Studio serving a real Task. 1440 and 390, light and dark, en and zh-TW.
//   bun tests/cloud-handoff-ui.mjs        (CLOUD_HANDOFF_SHOTS=<dir> keeps the screenshots there)
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { freePort, waitUp, withSession } from "./boot.mjs";
import { harness, until, Y } from "./rt-harness.ts";
import { sessionUrl } from "./lib/routine-fire-stub.ts";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => {
  console.error("cloud-handoff-ui: Playwright not found; set PLAYWRIGHT_MODULE to its index.mjs or install it"); process.exit(2); });
process.env.CREW_SESSION_TOKEN ??= "test-session";
const root = join(import.meta.dir, "..");
let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };

const H = await harness([Y({ id: "cardy", name: "cardy", roles: [], nodes: [{ id: "q", kind: "card", label: "Wait", card: { body: { en: "A fixture card.", "zh-TW": "測試卡片。" }, title: { en: "Wait here", "zh-TW": "在這裡等" }, options: [{ id: "go", label: "Go", labelZh: "繼續" }] }, x: 0, y: 0 }, { id: "done", kind: "hook", label: "Done", x: 1, y: 0 }], edges: [["q", "done", "go"]] })]);
const r = H.engine.start({ workflow: "cardy", text: "Add a percent function to money-kit", title: "Add a percent function" });
await until(() => H.engine.cards.list({ run: r.id, open: true }).length > 0, 8000); H.stop();
const ID = r.id, BRANCH = `crew/handoff/${ID}-1`, SID = "session_01FixtureUi0001", HEAD = "a1b2c3d4".repeat(5), CLOUD = "c0ffee00".repeat(5);
const PROMPT = `CREW STUDIO CLOUD HAND-OFF · Task ${ID}\n\n## Branch\nWork on the branch ${BRANCH} only.\nPush your commits to ${BRANCH} only. Do not push any other branch or any tag, do not open a pull request, and do not merge anything.\n\n## Completion condition\nRun the repository's tests and make them pass:\n- \`bun test\`\n\n## When you stop\nHandoff-Status: done <one-line reason>`;
const t2 = (en, zh) => ({ en, zh });
const CONFIRM = { blockers: [], confirm: { branch: BRANCH, baseHead: HEAD, repository: "fixture/money-kit", routine: "trig_01FixtureRoutine",
  breakpoint: t2(`Interrupt the running round and hand off its last committed round (${HEAD.slice(0, 8)}). Uncommitted work of the interrupted round is kept aside on this Mac.`, `中斷正在跑的回合，交接上一個已 commit 的 round（${HEAD.slice(0, 8)}）。被中斷那一輪還沒 commit 的內容，會另外保留在這台 Mac。`),
  instruction: t2(`The cloud agent is told to push only ${BRANCH}, open no pull request and merge nothing. This is an instruction, not something the provider enforces: Studio checks it when you take the work back.`, `已指示雲端只推 ${BRANCH}、不開 PR、不 merge。這是指示，provider 不會強制；Studio 收回時會檢查。`),
  quota: t2("Uses your claude.ai subscription usage. There is no way to estimate the cost beforehand.", "用的是船長的 claude.ai 訂閱額度，無法事先估價。"),
  cloudDoes: "Build round", after: ["Review request", "CI", "Fresh reviewer", "UI change?", "Remote readiness", "Merge card", "Merge", "After merge", "Clean up", "Merged"], tests: ["bun test"],
  doneLines: ["percent(1999, 15) is 300 (test/percent.test.ts, planned fail-first)"],
  sessionUrlWarning: t2("This repository's committed .claude/settings.json does not set attribution.sessionUrl: false, so the cloud agent may put a session link and a Claude-Session trailer in its commits. Studio flags them at take-back.", "這個 repo 已 commit 的 .claude/settings.json 沒有設 attribution.sessionUrl: false，雲端 agent 可能在 commit 帶 session 連結和 Claude-Session trailer。Studio 收回時會標出來。"),
  prompt: PROMPT, promptChars: PROMPT.length, promptSha256: "0".repeat(64) } };
const BLOCKED = { blockers: [{ code: "org-policy", ...t2("fixture/money-kit belongs to an organisation: add the line cloud_handoff: allow to data/policies/project-sandbox.yaml (once; off by default). The Doctor lists it under cloud hand-off.", "fixture/money-kit 屬於組織：請在 data/policies/project-sandbox.yaml 加上一行 cloud_handoff: allow（只要設一次，預設關閉）。Doctor 的「交給雲端接手」那一列也會列出來。") },
  { code: "profile", ...t2("This Task runs under the issue profile (work from untrusted text): it never leaves this Mac.", "這個任務用的是 issue profile（來自不可信的文字）：不會離開這台 Mac。") }], confirm: null };
const ACTIVE = { branch: BRANCH, baseHead: HEAD, sessionId: SID, sessionUrl: sessionUrl(SID), firedAt: Date.parse("2026-11-18T09:30:00Z"), repository: "fixture/money-kit",
  observed: { head: CLOUD, status: "done", reason: "the done line passes with bun test", commits: 3, at: "2026-11-18T10:00:00Z" },
  postcheck: { cloudHead: CLOUD, red: true, refused: false, findings: [{ class: "other-branches", ...t2("Other branches changed during the hand-off: crew/someone-else.", "交接期間有其他分支被更新：crew/someone-else。") }] } };
const REFUSED = { ...ACTIVE, postcheck: { cloudHead: CLOUD, red: true, refused: true, findings: [{ class: "session-trailer", ...t2("Commits carry a Claude-Session trailer or a session link: c0ffee00.", "有 commit 帶 Claude-Session trailer 或 session 連結：c0ffee00。") }] } };

const port = await freePort(); const base = `http://127.0.0.1:${port}`;
const fm = join(H.data, "..", `fm-ui-${port}`, "state"); mkdirSync(join(fm, "pending"), { recursive: true });
const env = { ...process.env }; for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete env[k];
const app = spawn("bun", ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, CREW_FM_STATE: fm, CREW_PORT: String(port), CREW_GH: "0", CREW_READONLY: "1", CREW_DATA: H.data,
  CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_GH_NO_CLI: "1", CREW_CLAUDE_BIN: "/nonexistent/claude", CREW_CODEX_BIN: "/nonexistent/codex",
  HOME: join(H.data, "..", `home-ui-${port}`), CREW_MAIN_PROJECT: join(H.data, "..", `proj-ui-${port}`) } });
let appLog = ""; app.stdout.on("data", (d) => (appLog += d)); app.stderr.on("data", (d) => (appLog += d));
const shots = process.env.CLOUD_HANDOFF_SHOTS || join(root, "tests/out/cloud-handoff"); mkdirSync(shots, { recursive: true });
const errors = [];
try {
  await waitUp(base, app);
  const browser = withSession(await chromium.launch(), base);
  // state: what the hand-off endpoints answer in this context (the server's own answers, as tests/cloud-handoff-flow.ts proves them)
  const page = async (width, scheme, st) => {
    const c = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: scheme }); await c.route(/^https?:\/\/(?!127\.0\.0\.1)/, (x) => x.abort());
    await c.route(new RegExp(`/api/tasks/${ID}(\\?.*)?$`), async (route) => { const res = await route.fetch(); const j = await res.json(); route.fulfill({ response: res, json: { ...j, handoff: st.taken ? { available: false, active: null, taken: st.taken, history: [] } : st.active ? { available: false, active: st.active, history: [] } : { available: true, active: null, history: [] } } }); });
    await c.route(new RegExp(`/api/wruns/${ID}/handoff(/.*)?$`), async (route) => {
      const u = new URL(route.request().url()); st.calls.push(`${route.request().method()} ${u.pathname}`);
      if (u.pathname.endsWith("/handoff")) return route.fulfill({ json: st.blocked ? BLOCKED : CONFIRM });
      if (u.pathname.endsWith("/fire")) return route.fulfill({ status: 429, json: { error: "The routine's hourly fire limit is reached (429). Studio does not retry on its own.", errorZh: "routine 每小時的送出次數用完了（429）。Studio 不會自動重試。", status: 429, retryAfter: "1800", retried: false } });
      return route.fulfill({ json: { observed: ACTIVE.observed } });
    });
    const p = await c.newPage(); p.on("pageerror", (e) => errors.push(`${width}/${scheme}: ${e}`)); return p;
  };
  const seen = (p, sel, timeout = 8000) => p.waitForSelector(sel, { timeout, state: "visible" }).then(() => true, () => false);
  const text = (p, sel) => p.textContent(sel).then((t) => (t || "").trim(), () => "");
  const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  // painted in the theme's --bad colour (a bare .bad class has no style of its own)
  const isRed = (p, sel) => p.$eval(sel, (el) => { const d = document.createElement("span"); d.style.color = "var(--bad)"; document.body.append(d); const bad = getComputedStyle(d).color; d.remove(); return getComputedStyle(el).color === bad; }).catch(() => false);
  for (const width of [1440, 390]) for (const scheme of ["light", "dark"]) for (const lang of ["en", "zh-TW"]) {
    const tag = `${width}-${scheme}-${lang}`, zh = lang === "zh-TW";
    // the confirm view, then a 429
    { const st = { calls: [] }, p = await page(width, scheme, st);
      await p.goto(`${base}/#/run/${ID}`); if (zh) { await p.evaluate(() => setLang("zh-TW")); }
      ok(await seen(p, `[data-cloud-handoff="${ID}"]`), `${tag}: the Task page offers the hand-off`);
      ok((await text(p, `[data-cloud-handoff="${ID}"]`)) === (zh ? "交給雲端接手…" : "Hand off to the cloud…"), `${tag}: its label`, await text(p, `[data-cloud-handoff="${ID}"]`));
      await p.click(`[data-cloud-handoff="${ID}"]`);
      ok(await seen(p, `[data-handoff-confirm="${ID}"]`), `${tag}: one confirm view opens`);
      const all = await text(p, `[data-handoff-confirm="${ID}"]`);
      ok((await text(p, "[data-handoff-branch]")) === BRANCH && all.includes("bun test") && all.includes("percent(1999, 15)"), `${tag}: it shows the branch and the completion condition`);
      ok(zh ? /這是指示，provider 不會強制/.test(all) && /無法事先估價/.test(all) : /an instruction, not something the provider enforces/.test(all) && /no way to estimate/.test(all), `${tag}: honest wording: an instruction, not enforced; no cost estimate`, all.slice(0, 300));
      ok(await seen(p, "[data-handoff-session-warning]") && await isRed(p, "[data-handoff-session-warning]"), `${tag}: the sessionUrl warning, in red`);
      ok((await p.$eval("[data-handoff-prompt]", (e) => e.textContent)) === PROMPT, `${tag}: the exact prompt is there to read`);
      ok((await overflow(p)) <= 0, `${tag}: no horizontal scroll`);
      await p.screenshot({ path: join(shots, `confirm-${tag}.png`), fullPage: true });
      await p.click(`[data-handoff-fire="${ID}"]`);
      ok(await seen(p, "[data-handoff-retry-at]"), `${tag}: a 429 says when to try again`);
      await p.waitForTimeout(300);
      const said = await text(p, "[data-handoff-retry-at]"), page429 = await text(p, `[data-runview="${ID}"]`);
      ok(zh ? /約 30 分鐘後（\d{1,2}:\d{2}）再試/.test(said) : /about 30 minutes \(\d{1,2}:\d{2}( [AP]M)?\)/.test(said), `${tag}: as minutes and a clock time, in the page's language`, said);
      ok(!/1800/.test(page429) && (page429.match(zh ? /再試/g : /Try again/g) ?? []).length === 1, `${tag}: said once, never as raw seconds`, page429.slice(0, 200));
      ok(await isRed(p, "[data-handoff-retry-at]"), `${tag}: the 429 message is red`);
      ok(await p.$eval(`[data-handoff-fire="${ID}"]`, (b) => b.disabled), `${tag}: the send button stays off until then`);
      ok(st.calls.filter((x) => x.endsWith("/fire")).length === 1, `${tag}: sent once, not retried`, JSON.stringify(st.calls));
      ok(zh ? /不會自動重試/.test(said) : /does not retry/.test(said), `${tag}: says Studio does not retry`);
      await p.screenshot({ path: join(shots, `rate-limited-${tag}.png`), fullPage: true });
      await p.context().close(); }
    // refused
    { const st = { calls: [], blocked: true }, p = await page(width, scheme, st);
      await p.goto(`${base}/#/run/${ID}`); if (zh) await p.evaluate(() => setLang("zh-TW"));
      await seen(p, `[data-cloud-handoff="${ID}"]`); await p.click(`[data-cloud-handoff="${ID}"]`);
      ok(await seen(p, `[data-handoff-blocked="${ID}"]`) && !(await p.$(`[data-handoff-fire="${ID}"]`)) && !!(await p.$('[data-handoff-blocker="org-policy"]')) && !!(await p.$('[data-handoff-blocker="profile"]')), `${tag}: a refused hand-off lists why, with nothing to send`);
      const panel = await text(p, ".rt-endpanel");
      ok(/data\/policies\/project-sandbox\.yaml/.test(await text(p, '[data-handoff-blocker="org-policy"]')) && (await p.getAttribute(`[data-handoff-doctor="${ID}"]`, "href")) === "#/doctor", `${tag}: the policy reason names its file and links the Doctor`);
      ok(!/確認後送出|then send/.test(panel) && (zh ? /還不能交接/ : /cannot hand this Task off yet/).test(panel), `${tag}: the subtitle says it is refused, not "check, then send"`, panel.slice(0, 160));
      await p.screenshot({ path: join(shots, `blocked-${tag}.png`), fullPage: true }); await p.context().close(); }
    // with the cloud: red flags with next steps; discard asks first
    { const st = { calls: [], active: ACTIVE }, p = await page(width, scheme, st);
      await p.goto(`${base}/#/run/${ID}`); if (zh) await p.evaluate(() => setLang("zh-TW"));
      ok(await seen(p, `[data-handoff-active="${ID}"]`), `${tag}: the waiting Task shows the hand-off`);
      const h3 = await text(p, `[data-handoff-active="${ID}"] h3`);
      ok((await p.getAttribute(`[data-handoff-session="${SID}"]`, "href")) === sessionUrl(SID) && !/waiting\(external\)/.test(h3) && (zh ? /交給雲端了/ : /With the cloud agent/).test(h3), `${tag}: plain words, and the session link`, h3);
      const fired = await text(p, "[data-handoff-fired]");
      ok(zh ? /2026年11月18日/.test(fired) : /Nov 18, 2026/.test(fired), `${tag}: the time in the page's language`, fired);
      ok((zh ? /完成/ : /done/).test(await text(p, "[data-handoff-observed]")) && (zh ? /未驗證/ : /unverified/).test(await text(p, "[data-handoff-reason]")), `${tag}: what the cloud says, from GitHub; its words marked unverified`);
      ok(!!(await p.$('[data-handoff-finding="other-branches"]')) && await isRed(p, '[data-handoff-finding="other-branches"]') && (zh ? /重跑建置檢查/ : /runs the build checks again/).test(await text(p, '[data-handoff-next="take-back"]')), `${tag}: the red flag, with what to do next`);
      ok(!!(await p.$(`[data-handoff-take-back="${ID}"]`)) && !(await p.$(`[data-handoff-discard="${ID}"]`)) && !!(await p.$(`[data-handoff-discard-open="${ID}"]`)), `${tag}: take back; discard is not one click`);
      ok(!(await p.$$eval(".phead .actions .btn", (bs) => bs.some((b) => /^(Pause|暫停)$/.test(b.textContent.trim())))), `${tag}: no Pause while the cloud has the build`);
      await p.waitForTimeout(300); ok(st.calls.some((x) => x.endsWith("/handoff/reconcile")), `${tag}: opening the Task reads GitHub once`);
      ok((await overflow(p)) <= 0, `${tag}: no horizontal scroll (waiting)`);
      await p.screenshot({ path: join(shots, `waiting-${tag}.png`), fullPage: true });
      await p.click(`[data-handoff-take-back="${ID}"]`);
      ok(await seen(p, `[data-handoff-take-confirm="${ID}"]`) && !!(await p.$(`[data-handoff-take-back-confirmed="${ID}"]`)) && !st.calls.some((x) => x.endsWith("/take-back")), `${tag}: with red flags, take back asks a second time before anything is sent`);
      await p.screenshot({ path: join(shots, `take-back-confirm-${tag}.png`), fullPage: true });
      await p.click(`[data-handoff-take-confirm="${ID}"] .btn.ghost`);
      await p.click(`[data-handoff-discard-open="${ID}"]`);
      const ask = await text(p, `[data-handoff-discard-confirm="${ID}"]`);
      ok(ask.includes(BRANCH) && ask.includes(HEAD.slice(0, 8)) && /claude\.ai/.test(ask) && !!(await p.$(`[data-handoff-discard="${ID}"]`)), `${tag}: discard asks first: the branch stays, stop the session on claude.ai, restart from the base`, ask);
      ok(!st.calls.some((x) => x.endsWith("/discard")), `${tag}: nothing is discarded before the second click`);
      await p.screenshot({ path: join(shots, `discard-${tag}.png`), fullPage: true }); await p.context().close(); }
    // taken back, and the cloud pushed again afterwards
    { const st = { calls: [], taken: { branch: BRANCH, cloudHead: CLOUD, moved: { branch: BRANCH, takenHead: CLOUD, head: "d00dfeed".repeat(5), at: "2026-11-18T11:00:00Z" } } }, p = await page(width, scheme, st);
      await p.goto(`${base}/#/run/${ID}`); if (zh) await p.evaluate(() => setLang("zh-TW"));
      ok(await seen(p, `[data-handoff-moved="${ID}"]`) && (await text(p, `[data-handoff-moved="${ID}"]`)).includes("d00dfeed") && (zh ? /不會把新的 commit 併進/ : /does not merge the new commits/).test(await text(p, `[data-handoff-moved="${ID}"]`)), `${tag}: a push after the take-back is flagged, not merged`);
      ok(await isRed(p, `[data-handoff-moved="${ID}"] h3`) && !(await isRed(p, `[data-handoff-moved="${ID}"] p`)), `${tag}: only the title is red; the body is in normal ink`);
      await p.waitForTimeout(300); ok(st.calls.some((x) => x.endsWith("/handoff/reconcile")), `${tag}: the Task page reads the branch after a take-back too`);
      await p.screenshot({ path: join(shots, `moved-${tag}.png`), fullPage: true }); await p.context().close(); }
    // refused take-back: a Claude-Session trailer
    { const st = { calls: [], active: REFUSED }, p = await page(width, scheme, st);
      await p.goto(`${base}/#/run/${ID}`); if (zh) await p.evaluate(() => setLang("zh-TW"));
      await seen(p, `[data-handoff-active="${ID}"]`);
      ok(!(await p.$(`[data-handoff-take-back="${ID}"]`)) && !!(await p.$(`[data-handoff-discard-open="${ID}"]`)) && (zh ? /不會收回/ : /will not take this back/).test(await text(p, '[data-handoff-next="discard"]')), `${tag}: a refused take-back hides Take it back, says why, keeps discard`);
      await p.screenshot({ path: join(shots, `refused-${tag}.png`), fullPage: true }); await p.context().close(); }
  }
  await browser.close();
  ok(!errors.length, "no page errors", errors.join("\n"));
} catch (e) { ok(false, "unexpected error", `${e?.stack}\n${appLog.slice(-2000)}`); }
finally { app.kill(); }
console.log(`\ncloud-handoff-ui: ${pass} passed, ${fail} failed (screenshots in ${shots})`);
process.exit(fail ? 1 : 0);
