import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Pull requests (docs/units/pr-watch.md "Follow-through") end to end against the fictional GitHub: with follow-through
// on, each watched pull request's branch raises its Inbox card (ask QA, ask the reviewers again, ask for the approvals the
// repository's own rules miss), with recipients (a team's members read from GitHub, the pick remembered), the drafted
// message, DM links built only from the contacts, a channel send through a loopback webhook stub, snooze and history; a
// card closes by itself when GitHub shows what it waited for (an approve card first keeps only what is still missing);
// the merge card follows the rules, a push that would void approvals asks first; Firstmate cannot answer; nothing is
// written to GitHub and nothing is sent without a call from the page.
//   bun tests/pr-watch-follow-flow.ts
import { harness, until, suite } from "./rt-harness";
import { bundledText } from "../src/bundled";
import { GitHubPoller } from "../src/github-poller";
import { createPrWatch, APPLY_WORKFLOW, FOLLOW_WORKFLOW } from "../src/pr-watch";
import { prWatchGitHub } from "./lib/pr-watch-github";
import { followFixture } from "./lib/pr-follow-github";

const { ok, end } = suite("pr-watch-follow-flow");
const { data, gw, T, c212, c215, c216 } = followFixture();
const gh = prWatchGitHub(data);
// 216 starts with neither team: release-approvers comes in later, and the card shrinks to what is still missing
const p216 = gh.data.find(gw, 216)!, relDan = p216.reviews!.find((x: any) => x.user === "rel-dan")!; p216.reviews = p216.reviews!.filter((x: any) => x !== relDan);
// the chat's incoming webhook, a loopback stub
const posted: any[] = []; const hook = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(req) { posted.push({ path: new URL(req.url).pathname, body: await req.json() }); return new Response("ok"); } });
process.env.CREW_GITHUB_API = gh.origin; process.env.CREW_GITHUB_TOKEN = "fixture-token"; process.env.CREW_GH_NO_CLI = "1"; process.env.CREW_GH = "0"; delete process.env.CREW_PR_WATCH; process.env.CREW_WEBHOOK_LOOPBACK = "1";
const H = await harness([bundledText(`workflows/v2/${APPLY_WORKFLOW}.wf.yaml`)!, bundledText(`workflows/v2/${FOLLOW_WORKFLOW}.wf.yaml`)!]), E = H.engine;
const poller = new GitHubPoller(), W = createPrWatch({ dataDir: H.data, poller }); W.install(E);
const call = async (path: string, body?: unknown) => { const url = new URL(`http://127.0.0.1${path}`), writing = body !== undefined;
  const r = await W.handle(new Request(url, writing ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}), url, { kind: "desktop" }, writing); return { status: r!.status, body: await r!.json() }; };
const open = () => E.cards.list({}).filter((c: any) => c.workflow === FOLLOW_WORKFLOW && c.status === "open");
const cardOf = (pr: string, kind: string) => open().find((c: any) => c.follow?.pr === pr && c.follow?.kind === kind) as any;
const refresh = async () => { await call("/api/prs/refresh", {}); await new Promise((r) => setTimeout(r, 300)); };
try {
  await call("/api/prs/watch", { url: `https://github.com/${gw}` });
  const settings = { which: { mine: true, assigned: true, reviewRequested: false }, evidence: { accounts: ["qa-lead"], checks: [], labels: [] }, requiredReviewers: [], environments: [{ name: "dev", production: false, repos: [], detect: { kind: "check", name: "deploy/dev" } }, { name: "staging", production: false, repos: [], detect: { kind: "check", name: "deploy/staging" } }], groups: [], shortForm: false, messageLang: null,
    follow: { enabled: false }, sending: { targets: [{ id: "qa", name: "#qa-requests", tool: "slack", use: "qa", url: `http://127.0.0.1:${hook.port}/services/T0/B0/x` }], contacts: [{ gh: "qa-lead", tool: "slack", id: "U04QALEAD" }, { gh: "sec-bob", tool: "email", id: "bob@example.com" }, { gh: "rel-dan", tool: "teams", id: "dan@example.com" }], slackTeam: "T0TEAM" } };
  let r = await call("/api/prs/settings", { settings }); ok(r.status === 200, "settings with a send target and contacts", JSON.stringify(r.body).slice(0, 200));
  ok(r.body.sending.targets[0].masked && !JSON.stringify(r.body).includes("/services/T0/B0/x") && !JSON.stringify((await call("/api/prs/sending")).body).includes("/services/T0/B0/x"), "the webhook address never reaches the page unmasked");
  await refresh(); await new Promise((res) => setTimeout(res, 500));
  ok(!open().length, "follow-through off: no card");
  settings.follow.enabled = true; delete (settings.sending.targets[0] as any).url; (settings.sending.targets[0] as any).url = "https://hooks.slack.com/services/T0/B0/••••";
  r = await call("/api/prs/settings", { settings }); ok(r.status === 200 && W.state.hooks.qa?.includes(`127.0.0.1:${hook.port}`), "saving the masked address keeps the stored one");
  await refresh(); await until(() => open().length >= 3, 15000);
  { const v = (await call("/api/prs")).body, rule = (id: string) => v.rows.find((x: any) => x.id === id)?.next.rule;
    ok(rule(`${gw}#212`) === "evidence-asked" && rule(`${gw}#215`) === "re-review" && v.rows.find((x: any) => x.id === `${gw}#212`).follow.branch === "needs-evidence", "the list's next step is the follow-through's: 212 waits for the QA test, 215 asks the reviewers again (not \"fix\")", `${rule(`${gw}#212`)} ${rule(`${gw}#215`)}`);
    ok(v.rows.find((x: any) => x.id === `${gw}#212`).next.kind === "test" && v.rows.find((x: any) => x.id === `${gw}#215`).next.kind === "nudge", "so they sit under the Test and Re-review tabs"); }
  { const a0 = cardOf(`${gw}#216`, "approve"); ok([...(a0?.follow.groupsMissing ?? [])].sort().join() === "@northwind/release-approvers,@northwind/security", "216 first misses both teams", JSON.stringify(a0?.follow.groupsMissing));
    p216.reviews!.push(relDan); await refresh(); await until(() => cardOf(`${gw}#216`, "approve")?.follow.groupsMissing.length === 1, 15000);
    const a1 = cardOf(`${gw}#216`, "approve");
    ok(a1?.id === a0?.id && a1.follow.history.some((x: any) => x.tw.includes("rel-dan") && x.tw.includes("approve ✓ → 卡裡只留 @northwind/security")), "rel-dan approves: the same card keeps only security, and its record says so", JSON.stringify(a1?.follow.history)); }
  const qa = cardOf(`${gw}#212`, "qa"), nudge = cardOf(`${gw}#215`, "nudge"), ap = cardOf(`${gw}#216`, "approve");
  ok(!!qa && !!nudge && !!ap && open().length === 3, "three cards: ask QA (212), ask the reviewers again (215), ask for approval (216)", JSON.stringify(open().map((c: any) => `${c.follow.pr}:${c.follow.kind}`)));
  ok(qa.follow.lead.en.includes('review-bot-a\'s comment: "Please attach a staging run that shows the 429 for the 21st request". ') && qa.follow.recipients[0].who === "qa-lead" && qa.follow.recipients[0].via.en === "Slack DM", "the QA card quotes the reviewer and is for the evidence source, by Slack DM");
  ok(qa.follow.message.en.includes('POST /v1/orders (src/routes.ts:1)') && qa.follow.message.en.includes('-X POST "$STAGING_URL/v1/orders"') && qa.follow.message.en.includes(c212[1].sha.slice(0, 7)) && qa.follow.channel === "qa", "the request cites the route the diff adds, the head, and goes to the QA channel by default");
  ok(qa.follow.message.en.includes("on staging") && !qa.follow.message.en.includes("$DEV_URL"), "the QA request names the environment the reviewer named (and that runs the head), not the first one set");
  ok(nudge.follow.message.tw.includes(`→ ${c215[1].sha.slice(0, 7)}`) && nudge.follow.done.some((d: any) => d.tw === "上次 2 條意見都已修"), "the nudge lists each comment with the commit that answered it, and says both were fixed", nudge.follow.message.tw);
  ok(nudge.follow.recipients.map((x: any) => x.who).join() === "review-bot-a,review-bot-b" && nudge.follow.message.tw.includes("麻煩重驗") && nudge.follow.message.tw.includes("「需要 staging 上的實測證據」"), "the nudge card is for both reviewers, quoting their last comments", nudge.follow.message.tw);
  ok(ap.follow.groupsMissing.join() === "@northwind/security" && ap.follow.recipients[0].team && ap.follow.recipients[0].members.join() === "sec-alice,sec-bob,sec-carol" && ap.follow.done.some((d: any) => d.en.includes("@northwind/release-approvers (rel-dan)")), "the approve card: only the group the repository's rules still miss, its members read from GitHub");
  ok(ap.follow.message.tw.includes("最後一次 push") && ap.follow.message.en.includes("@northwind/security: 1 approval"), "its message names the missing group and the last-push rule");
  // the captain's actions on a card
  let a = await call("/api/prs/follow/pick", { card: ap.id, who: "@northwind/security", member: "sec-bob" });
  ok(a.status === 200 && W.state.follow.picks["@northwind/security"] === "sec-bob" && E.cards.get(ap.id)!.follow!.recipients[0].pick === "sec-bob", "picking a member is remembered for the team");
  a = await call("/api/prs/follow/dm", { card: ap.id, login: "sec-bob", text: "please approve" });
  ok(a.body.href === "mailto:bob@example.com?subject=northwind%2Fgateway%23216%3A%20Signature%20check%20uses%20the%20new%20algorithm&body=please%20approve" && a.body.prefilled, "DM by email: a mailto built from the contact, the message filled in", JSON.stringify(a.body));
  a = await call("/api/prs/follow/dm", { card: qa.id, login: "qa-lead", text: "x" }); ok(a.body.href === "slack://user?team=T0TEAM&id=U04QALEAD" && !a.body.prefilled, "DM on Slack: the app link to that member (paste needed)");
  a = await call("/api/prs/follow/dm", { card: nudge.id, login: "review-bot-a", text: "x" }); ok(a.status === 200 && a.body.href === null, "no contact: copy only");
  ok((await call("/api/prs/follow/dm", { card: qa.id, login: "someone-else", text: "x" })).status === 400, "a DM only to someone the card is for");
  a = await call("/api/prs/follow/send", { card: qa.id, target: "qa", text: "@qa-lead please test #212" });
  ok(a.status === 200 && posted.length === 1 && posted[0].body.text === "<@U04QALEAD> please test #212", "sending to the channel posts once through the webhook, the GitHub login as the chat's mention", JSON.stringify(posted));
  await call("/api/prs/follow/chase", { card: qa.id }); const until1 = new Date(Date.now() + 3600_000).toISOString(); await call("/api/prs/follow/snooze", { card: qa.id, until: until1 });
  const h = E.cards.get(qa.id)!.follow!; ok(h.snoozeUntil === until1 && h.chased === 1 && h.history.map((x: any) => x.en).join(" | ").includes("copied and opened a DM with qa-lead (slack) | sent to #qa-requests | nudged again with the short version | snoozed until"), "history: what was sent to whom and when; snooze and a second nudge recorded", h.history.map((x: any) => x.en).join(" | "));
  a = await call("/api/prs/follow/choose", { card: qa.id, option: "sent" }); ok(a.status === 200 && E.cards.get(qa.id)!.status === "open", "option A (sent, waiting) keeps the card open");
  ok((await call("/api/prs/follow/choose", { card: qa.id, option: "skip" })).status === 400, "an option that answers the card goes through the card's answer");
  let refused = ""; try { await E.answer(qa.id, { choice: "skip", by: "Firstmate" }); } catch (e: any) { refused = e.message; } ok(/Only the captain/.test(refused), "Firstmate cannot answer a follow-through card");
  // GitHub moves: QA posts evidence on 212's head, security approves 216
  gh.data.find(gw, 212)!.comments = [{ user: "qa-lead", body: `### PASS\non ${c212[1].sha}`, at: T(5) }];
  gh.data.find(gw, 216)!.reviews!.push({ user: "sec-bob", state: "APPROVED", commit: c216[1].sha, at: T(5) } as any);
  // the answer that closes a card is slow, and two settings saves land meanwhile: still one pass at a time
  const answer0 = E.answer.bind(E); (E as any).answer = async (...a: any[]) => { await new Promise((res) => setTimeout(res, 400)); return answer0(...(a as [any, any])); };
  await Promise.all([refresh(), call("/api/prs/settings", { settings }), call("/api/prs/settings", { settings })]);
  await until(() => E.cards.get(qa.id)!.status !== "open" && !!cardOf(`${gw}#216`, "merge"), 15000);
  ok(E.cards.get(qa.id)!.status === "answered" && E.cards.get(qa.id)!.answer!.by === "studio (GitHub)" && /^evidence from qa-lead \(pass\) covers the head$/.test(E.cards.get(qa.id)!.answer!.note ?? ""), "the QA card closes by itself when evidence on the head arrives", JSON.stringify(E.cards.get(qa.id)!.answer));
  ok(!!cardOf(`${gw}#212`, "nudge") && cardOf(`${gw}#212`, "nudge").follow.recipients[0].who === "review-bot-a", "and the reviewer who asked for it is asked to look again right away");
  (E as any).answer = answer0;
  ok(E.cards.get(qa.id)!.follow!.history.filter((x: any) => /^evidence from qa-lead/.test(x.en)).length === 1 && open().filter((c: any) => c.follow.pr === `${gw}#212`).length === 1, "a slow answer and saves meanwhile: one close line, one next card (one follow-through pass at a time)", JSON.stringify(E.cards.get(qa.id)!.follow!.history.map((x: any) => x.en)));
  ok(E.cards.get(ap.id)!.status === "answered" && !!cardOf(`${gw}#216`, "merge"), "the approve card closes when the rules are met, and the merge card follows");
  // a push that would void the approvals asks first
  // the reviewer's comment on the head, read as a code change: the push card names them and quotes it without being told
  gh.data.find(gw, 216)!.reviews!.push({ user: "review-bot-b", state: "COMMENTED", commit: c216[1].sha, at: T(6), body: "Please do not log the key id." } as any);
  await refresh(); await new Promise((res) => setTimeout(res, 300));
  a = await call("/api/prs/push-check", { pr: `${gw}#216`, tests: true });
  await until(() => !!cardOf(`${gw}#216`, "push"), 10000); const push = cardOf(`${gw}#216`, "push");
  const again = await call("/api/prs/push-check", { pr: `${gw}#216` }); await new Promise((res) => setTimeout(res, 500));
  ok(again.body.existing === true && again.body.task === a.body.task && open().filter((c: any) => c.follow.kind === "push").length === 1, "asking again for the same pull request and head shows the push card already waiting, never a second", JSON.stringify(again.body));
  ok(push.follow.lead.en.startsWith("review-bot-b left a comment: “Please do not log the key id”") && push.follow.done[0].en.includes("tests pass"), "the push card names who commented (read from the reviews) and that the tests pass", push.follow.lead.en);
  ok(a.body.voids === 3 && push.follow.heading.en === "This push voids 3 approvals: push?" && push.follow.opts.map((o: any) => o.id).join() === "push,no-push,follow-up", "a push that would void 3 approvals raises its card: push, don't push with a reason, follow-up", JSON.stringify(a.body));
  ok(!gh.calls.some((c) => c.method !== "GET" && c.path !== "/graphql") && !gh.unknown.length, "nothing was written to GitHub; every request was one the fixture knows", JSON.stringify(gh.unknown));
} catch (e: any) { ok(false, "the suite ran to its end", String(e?.stack || e)); }
finally { W.stop(); poller.stop(); gh.stop(); hook.stop(true); }
end();
