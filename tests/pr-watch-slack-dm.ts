import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Pull requests (docs/units/pr-watch.md "Sending", "Slack bot") against the fictional GitHub and a fake Slack Web API
// (tests/lib/fake-slack.ts), both on loopback: the optional bot token is kept like a webhook (masked, never in the page's
// views, cleared on an empty field, never set by an agent CLI); Check contacts reads each Slack contact and fails another
// workspace, a deactivated account, a bot, an external account and an API error; a follow card's Slack DM goes through
// a confirm step that sends nothing, then a send that checks the member again and refuses when anything changed; the
// member id comes only from the contacts; links that are not https, or carry user:pass@, are refused everywhere.
//   bun tests/pr-watch-slack-dm.ts
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { harness, until, suite } from "./rt-harness";
import { bundledText } from "../src/bundled";
import { GitHubPoller } from "../src/github-poller";
import { createPrWatch, APPLY_WORKFLOW, FOLLOW_WORKFLOW } from "../src/pr-watch";
import { messageProblem } from "../src/pr-watch-follow";
import { slackApiBase, SLACK_API } from "../src/pr-watch-slack";
import { prWatchGitHub } from "./lib/pr-watch-github";
import { followFixture } from "./lib/pr-follow-github";
import { fakeSlack } from "./lib/fake-slack";

const { ok, end } = suite("pr-watch-slack-dm");
const TOKEN = "fake-bot-token-0001", TEAM = "T0TEST0001";
const { data, gw } = followFixture();
const gh = prWatchGitHub(data), slack = fakeSlack(TOKEN);
const person = (id: string, real: string, display: string, more: Record<string, unknown> = {}) => slack.users.set(id, { id, team_id: TEAM, name: display, real_name: real, profile: { real_name: real, display_name: display }, ...more } as any);
person("U0TEST0001", "Quinn Lead", "qlead");                              // qa-lead: passes
person("U0TEST0002", "Avery Bot Reviewer", "avery");                      // review-bot-a: passes, deactivated before a send
person("U0TEST0003", "Blake Reviewer", "blake");                          // review-bot-b: passes, renamed before a send
person("U0TEST0004", "Alex Other", "alex", { team_id: "T0TEST0999" });     // sec-alice: another workspace
person("U0TEST0005", "Bo Gone", "bo", { deleted: true });                 // sec-bob: deactivated
person("U0TEST0006", "Deploy Bot", "deploybot", { is_bot: true });        // sec-carol: a bot
person("U0TEST0007", "Ext Dev", "ext", { is_stranger: true });            // ext-dev: Slack Connect
slack.errors.set("U0TEST0008", "ratelimited");                           // gone-dev: Slack answers an error
const posted: any[] = []; const hook = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(req) { posted.push(await req.json()); return new Response("ok"); } });
const posted2: any[] = []; const hook2 = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(req) { posted2.push(await req.json()); return new Response("ok"); } });
process.env.CREW_GITHUB_API = gh.origin; process.env.CREW_GITHUB_TOKEN = "fixture-token"; process.env.CREW_GH_NO_CLI = "1"; process.env.CREW_GH = "0"; delete process.env.CREW_PR_WATCH; process.env.CREW_WEBHOOK_LOOPBACK = "1";
process.env.CREW_SLACK_API = slack.origin;
const H = await harness([bundledText(`workflows/v2/${APPLY_WORKFLOW}.wf.yaml`)!, bundledText(`workflows/v2/${FOLLOW_WORKFLOW}.wf.yaml`)!]), E = H.engine;
const poller = new GitHubPoller(), W = createPrWatch({ dataDir: H.data, poller }); W.install(E);
const call = async (path: string, body?: unknown) => { const url = new URL(`http://127.0.0.1${path}`), writing = body !== undefined;
  const r = await W.handle(new Request(url, writing ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}), url, { kind: "desktop" }, writing); return { status: r!.status, body: await r!.json() }; };
const open = () => E.cards.list({}).filter((c: any) => c.workflow === FOLLOW_WORKFLOW && c.status === "open");
const cardOf = (pr: string, kind: string) => open().find((c: any) => c.follow?.pr === pr && c.follow?.kind === kind) as any;
const hist = (id: string) => (E.cards.get(id)!.follow!.history as any[]).map((x) => x.en);
const sends = () => slack.calls.filter((c) => c.path === "/chat.postMessage" || c.path === "/conversations.open");
try {
  // ---------- the message guard (pure) ----------
  ok(messageProblem("please test https://github.com/owner/api-gateway/pull/12 and ping <@U0TEST0001>\ndata: none, file: x") === null, "https links, Slack mentions and plain words with a colon pass the guard");
  ok(!!messageProblem("see http://example.com/x") && !!messageProblem("click javascript:alert(1)") && !!messageProblem("<slack://user?team=T0&id=U0|here>") && !!messageProblem("ftp://example.com/f") && !!messageProblem("<mailto:a@example.com|mail>") && !!messageProblem("see .http://example.com") && !!messageProblem("1http://example.com") && !!messageProblem("-http://example.com") && !!messageProblem("x.javascript:alert(1)"), "a link that is not https is refused: http, javascript:, slack:, ftp, Slack's <mailto:…>, also glued to punctuation or digits");
  ok(!!messageProblem("https://user:secret@example.com/x") && !!messageProblem("https://user@example.com/x") && messageProblem("https://example.com/@user") === null, "a URL with user:pass@ (or user@) before its host is refused; @ in the path is not");
  // ---------- the Slack host ----------
  ok(slackApiBase() === slack.origin, "under the tests a loopback fake Slack may stand in");
  { const mark = process.env.CREW_TEST_ENV_ISOLATED; delete process.env.CREW_TEST_ENV_ISOLATED; let e1 = "", e2 = "";
    try { slackApiBase(); } catch (e: any) { e1 = e.message; } process.env.CREW_SLACK_API = ""; e2 = slackApiBase(); process.env.CREW_TEST_ENV_ISOLATED = mark; process.env.CREW_SLACK_API = "https://evil.example.com/api";
    let e3 = ""; try { slackApiBase(); } catch (e: any) { e3 = e.message; } process.env.CREW_SLACK_API = slack.origin;
    ok(/only under Studio's tests/.test(e1) && e2 === SLACK_API && /loopback/.test(e3), "outside the tests CREW_SLACK_API is refused and Slack's own host is used; a non-loopback override is refused", `${e1} | ${e2} | ${e3}`); }

  await call("/api/prs/watch", { url: `https://github.com/${gw}` });
  const contacts = [["qa-lead", "U0TEST0001"], ["review-bot-a", "U0TEST0002"], ["review-bot-b", "U0TEST0003"], ["sec-alice", "U0TEST0004"], ["sec-bob", "U0TEST0005"], ["sec-carol", "U0TEST0006"], ["ext-dev", "U0TEST0007"], ["gone-dev", "U0TEST0008"]].map(([gh, id]) => ({ gh, tool: "slack", id }));
  const settings: any = { which: { mine: true, assigned: true, reviewRequested: false }, evidence: { accounts: ["qa-lead"], checks: [], labels: [] }, requiredReviewers: [], environments: [{ name: "staging", production: false, repos: [], detect: { kind: "check", name: "deploy/staging" } }], groups: [], shortForm: false, messageLang: null,
    follow: { enabled: true }, sending: { targets: [{ id: "qa", name: "#qa-requests", tool: "slack", use: "qa", url: `http://127.0.0.1:${hook.port}/services/T0/B0/x` }], contacts, slackTeam: TEAM, botToken: TOKEN } };
  // ---------- the token ----------
  let r = await call("/api/prs/settings", { settings });
  ok(r.status === 200 && W.state.botToken === TOKEN && r.body.sending.bot.set === true && !r.body.sending.bot.masked.includes(TOKEN.slice(0, 8)), "a bot token typed in the settings is kept; the page learns only that it is set", JSON.stringify(r.body.sending?.bot));
  ok(!JSON.stringify(r.body).includes(TOKEN) && !JSON.stringify((await call("/api/prs")).body).includes(TOKEN) && !JSON.stringify((await call("/api/prs/sending")).body).includes(TOKEN) && !JSON.stringify(W.state.settings).includes(TOKEN), "the token never reaches the browser: not in the list, the sending view, or the settings");
  { const f = join(H.data, "pr-watch", "state.json"); ok((statSync(f).mode & 0o777) === 0o600 && readFileSync(f, "utf8").includes(TOKEN), "it lives in Studio's own state file (0600)"); }
  settings.sending.botToken = r.body.sending.bot.masked; r = await call("/api/prs/settings", { settings }); ok(r.status === 200 && W.state.botToken === TOKEN, "saving the masked form keeps the token");
  delete settings.sending.botToken; r = await call("/api/prs/settings", { settings }); ok(r.status === 200 && W.state.botToken === TOKEN, "settings without the field keep it");
  { const t1 = await W.tools.call("prs_settings", { settings: { shortForm: true } }) as any, t2 = await W.tools.call("prs_settings", { settings: { sending: { botToken: "x-injected-token-01" } } }) as any;
    ok(!t1.error && W.state.botToken === TOKEN && /does not know sending/.test(String(t2.error)) && !JSON.stringify(t1).includes(TOKEN), "an agent CLI's settings keep the token and cannot set one", JSON.stringify(t2)); }
  ok((await call("/api/prs/settings", { settings: { ...settings, sending: { ...settings.sending, botToken: "has spaces in it" } } })).status === 400 && W.state.botToken === TOKEN, "a token that is not one line of token characters is refused");
  await call("/api/prs/refresh", {}); await until(() => open().length >= 3, 15000);
  const qa = cardOf(`${gw}#212`, "qa"), nudge = cardOf(`${gw}#215`, "nudge"), ap = cardOf(`${gw}#216`, "approve");
  ok(!!qa && !!nudge && !!ap, "the follow cards are up: QA (qa-lead), reviewers again (review-bot-a, review-bot-b), approve (security members)");
  // ---------- before the check ----------
  let a = await call("/api/prs/follow/dm-preview", { card: qa.id, login: "qa-lead", text: "please test" });
  ok(a.status === 400 && /Check contacts first/.test(a.body.error), "no Slack DM before the contact passed the check", JSON.stringify(a.body));
  // ---------- Check contacts ----------
  r = await call("/api/prs/sending/check", {}); const ck = r.body.checks ?? {};
  ok(r.status === 200 && ck["qa-lead"]?.ready && ck["qa-lead"].name === "Quinn Lead (qlead)" && ck["qa-lead"].id === "U0TEST0001" && !!ck["qa-lead"].at, "a member of the workspace passes, with the name Slack reports", JSON.stringify(ck["qa-lead"]));
  ok(!ck["sec-alice"]?.ok && /another Slack workspace \(T0TEST0999\)/.test(ck["sec-alice"]?.problem?.en), "a member of another workspace fails", JSON.stringify(ck["sec-alice"]));
  ok(!ck["sec-bob"]?.ok && /deactivated/.test(ck["sec-bob"]?.problem?.en), "a deactivated account fails");
  ok(!ck["sec-carol"]?.ok && /bot/.test(ck["sec-carol"]?.problem?.en), "a bot fails");
  ok(!ck["ext-dev"]?.ok && /external/.test(ck["ext-dev"]?.problem?.en), "an external (Slack Connect) account fails");
  ok(!ck["gone-dev"]?.ok && /ratelimited/.test(ck["gone-dev"]?.problem?.en), "an API error fails, with what Slack said", JSON.stringify(ck["gone-dev"]));
  ok(W.state.settings.sending.contacts.length === 8 && W.state.settings.sending.contacts.every((c, i) => c.id === contacts[i].id), "nothing is corrected: the contacts table stays as the captain wrote it");
  ok(slack.calls.length > 0 && slack.calls.every((c) => c.auth === `Bearer ${TOKEN}` && !c.url.includes(TOKEN)), "every Slack request carries the token in the Authorization header, never in the address");
  ok(!JSON.stringify(r.body).includes(TOKEN), "the check's answer has no token");
  // ---------- the confirm step sends nothing ----------
  a = await call("/api/prs/follow/dm-preview", { card: qa.id, login: "qa-lead", text: "please test https://github.com/owner/api-gateway/pull/12" });
  ok(a.status === 200 && a.body.login === "qa-lead" && a.body.name === "Quinn Lead (qlead)" && a.body.id === "U0TEST0001", "the confirm step: GitHub login → the Slack name last verified → the member id", JSON.stringify(a.body));
  await call("/api/prs/follow/dm", { card: qa.id, login: "qa-lead", text: "please test" }); await call("/api/prs/follow/copy", { card: qa.id });
  ok(sends().length === 0, "the confirm step, Copy and copy-and-DM send nothing through Slack");
  a = await call("/api/prs/follow/slack-dm", { card: qa.id, login: "qa-lead", text: "please test" });
  ok(a.status === 400 && sends().length === 0 && hist(qa.id).some((x) => x.startsWith("did not send the Slack DM to qa-lead (U0TEST0001)")), "a send without the name the confirm showed is refused, nothing posted, the reason in the history", JSON.stringify(a.body));
  a = await call("/api/prs/follow/slack-dm", { card: qa.id, login: "ext-dev", text: "x", name: "Ext Dev (ext)" });
  ok(a.status === 400 && /someone this card is for/.test(a.body.error) && sends().length === 0, "only someone the card is for");
  // ---------- the recipient cannot be injected ----------
  a = await call("/api/prs/follow/slack-dm", { card: qa.id, login: "qa-lead", text: "please test https://github.com/owner/api-gateway/pull/12 <@U0TEST0009>", name: "Quinn Lead (qlead)", id: "U0TEST0009", user: "U0TEST0009", users: "U0TEST0009", channel: "D0TEST0009", member: "U0TEST0009", contact: { gh: "qa-lead", tool: "slack", id: "U0TEST0009" } });
  const opened = slack.calls.filter((c) => c.path === "/conversations.open");
  ok(a.status === 200 && a.body.id === "U0TEST0001" && opened.length === 1 && opened[0].body.users === "U0TEST0001" && slack.posted.length === 1 && slack.posted[0].channel === "D0TEST0001", "a confirmed DM goes to the contact's member id only: ids, users, channels in the request are ignored", JSON.stringify({ a: a.body, opened: opened.map((c) => c.body), posted: slack.posted }));
  ok(slack.calls.filter((c) => c.path === "/users.info" && c.url.includes("U0TEST0001")).length === 2, "the member was asked again right before the send");
  ok(hist(qa.id).at(-1) === "sent a Slack DM to qa-lead → Quinn Lead (qlead) (U0TEST0001)", "the history says who it went to", JSON.stringify(hist(qa.id).slice(-2)));
  // ---------- the name changes between the confirm and the send ----------
  a = await call("/api/prs/follow/dm-preview", { card: nudge.id, login: "review-bot-b", text: "x" }); const shown = a.body.name;
  person("U0TEST0003", "Morgan Someone", "morgan"); const before = slack.posted.length;
  a = await call("/api/prs/follow/slack-dm", { card: nudge.id, login: "review-bot-b", text: "could you look again?", name: shown });
  ok(shown === "Blake Reviewer (blake)" && a.status === 400 && slack.posted.length === before && /Morgan Someone/.test(a.body.error) && hist(nudge.id).some((x) => x.includes("did not send the Slack DM to review-bot-b") && x.includes("Morgan Someone (morgan)")), "the name changed after the confirm: refused, nothing posted, the history says why", JSON.stringify(a.body));
  ok((await call("/api/prs/follow/dm-preview", { card: nudge.id, login: "review-bot-b", text: "x" })).body.name === "Morgan Someone (morgan)", "the next confirm shows the name Slack reports now");
  // ---------- deactivated between the check and the send ----------
  person("U0TEST0002", "Avery Bot Reviewer", "avery", { deleted: true });
  a = await call("/api/prs/follow/slack-dm", { card: nudge.id, login: "review-bot-a", text: "x", name: "Avery Bot Reviewer (avery)" });
  ok(a.status === 400 && slack.posted.length === before && /deactivated/.test(a.body.error) && !(await call("/api/prs/sending")).body.checks["review-bot-a"].ready, "deactivated since the check: refused, and the contact no longer passes", JSON.stringify(a.body));
  // ---------- the message guard on every path ----------
  for (const [text, what] of [["see http://example.com/x", "an http link"], ["https://user:secret@example.com/x", "user:pass@"], ["javascript:alert(1)", "javascript:"]]) {
    const n = slack.posted.length, d = await call("/api/prs/follow/slack-dm", { card: qa.id, login: "qa-lead", text, name: "Quinn Lead (qlead)" }), c = await call("/api/prs/follow/dm", { card: qa.id, login: "qa-lead", text }), s = await call("/api/prs/follow/send", { card: qa.id, target: "qa", text });
    ok(d.status === 400 && c.status === 400 && s.status === 400 && slack.posted.length === n && posted.length === 0, `${what}: refused for the Slack DM, copy and DM, and the channel`, JSON.stringify([d.body, c.body, s.body])); }
  a = await call("/api/prs/follow/send", { card: qa.id, target: "qa", text: "@qa-lead please test https://github.com/owner/api-gateway/pull/12" });
  ok(a.status === 200 && posted.length === 1, "an https link still goes to the channel");
  // ---------- a changed contact needs a new check; clearing the token ----------
  settings.sending.contacts[0].id = "U0TEST0010"; r = await call("/api/prs/settings", { settings });
  ok(!r.body.sending.checks["qa-lead"]?.ready && (await call("/api/prs/follow/dm-preview", { card: qa.id, login: "qa-lead", text: "x" })).status === 400, "a contact whose member id changed needs checking again");
  settings.sending.contacts[0].id = "U0TEST0001"; settings.sending.botToken = ""; r = await call("/api/prs/settings", { settings });
  ok(r.status === 200 && W.state.botToken === null && r.body.sending.bot.set === false && /bot token/.test((await call("/api/prs/sending/check", {})).body.error), "an empty token field clears it; nothing can be checked or sent then");
  ok(slack.posted.length === 1, "one Slack message in all: the one confirmed");
  ok(!gh.calls.some((c) => c.method !== "GET" && c.path !== "/graphql"), "nothing was written to GitHub");
  // ---------- Send test and Send test DM: the value in the field, saved or not, never kept ----------
  { const hooksBefore = JSON.stringify(W.state.hooks), settingsBefore = JSON.stringify(W.state.settings), n = posted.length;
    const typedHook = `http://127.0.0.1:${hook2.port}/services/T0/B9/typed`;
    a = await call("/api/prs/sending/test", { target: "t-new", tool: "slack", url: typedHook, name: "#typed", text: "ignored https://example.com" });
    ok(a.status === 200 && a.body.target === "#typed" && a.body.unsaved === true && posted2.length === 1 && posted2[0].text.startsWith("Crew Studio: a test message") && posted.length === n, "Send test on an unsaved webhook posts the fixed test text to that address only", JSON.stringify(a.body));
    ok(JSON.stringify(W.state.hooks) === hooksBefore && JSON.stringify(W.state.settings) === settingsBefore && !readFileSync(join(H.data, "pr-watch", "state.json"), "utf8").includes("B9/typed"), "the typed webhook is not kept anywhere");
    a = await call("/api/prs/sending/test", { target: "qa", tool: "slack", url: "••••" }); ok(a.status === 200 && a.body.unsaved === false && posted.length === n + 1, "the masked field tests the saved webhook");
    for (const [url, why] of [["https://example.com/services/x", /not a slack webhook/], ["http://example.com/services/x", /must be https/], ["https://u:p@hooks.slack.com/services/x", /not accepted/], ["", /Paste the webhook/]] as const) {
      a = await call("/api/prs/sending/test", { target: "qa", tool: "slack", url }); ok(a.status === 400 && why.test(a.body.error) && posted.length === n + 1 && posted2.length === 1, `Send test refuses "${url}" with the reason`, JSON.stringify(a.body)); }
    const p0 = slack.posted.length;
    a = await call("/api/prs/sending/test-dm", { id: "U0TEST0001" }); ok(a.status === 400 && /bot token/.test(a.body.error) && slack.posted.length === p0, "no test DM without a bot token, saved or typed");
    { const before = sends().length; a = await call("/api/prs/sending/test-dm", { id: "U0TEST0001", token: TOKEN, team: TEAM });
      ok(a.status === 200 && a.body.confirm === true && a.body.name === "Quinn Lead (qlead)" && sends().length === before && slack.posted.length === p0, "the first step of a test DM only says who the id is: no conversations.open, no chat.postMessage", JSON.stringify(a.body));
      a = await call("/api/prs/sending/test-dm", { id: "U0TEST0001", token: TOKEN, team: TEAM, name: "Someone Else (else)" });
      ok(a.status === 400 && /Slack now says "Quinn Lead \(qlead\)"/.test(a.body.error) && sends().length === before, "a second step with a name other than Slack's is refused, nothing sent", JSON.stringify(a.body)); }
    a = await call("/api/prs/sending/test-dm", { id: "U0TEST0001", token: TOKEN, team: TEAM, name: "Quinn Lead (qlead)", text: "injected", channel: "D0TEST0009" });
    ok(a.status === 200 && a.body.channel === "D0TEST0001" && a.body.name === "Quinn Lead (qlead)" && slack.posted.length === p0 + 1 && slack.posted.at(-1)!.channel === "D0TEST0001" && slack.posted.at(-1)!.text.startsWith("Crew Studio: a test message"), "a test DM with a typed token: the fixed text, to the DM Slack opened, answered with who Slack says it is", JSON.stringify(a.body));
    ok(W.state.botToken === null && !readFileSync(join(H.data, "pr-watch", "state.json"), "utf8").includes(TOKEN), "the typed token is used for the test only, never kept");
    a = await call("/api/prs/sending/test-dm", { id: "U0TEST0001", token: TOKEN, team: "nope" }); ok(a.status === 400 && /workspace id/.test(a.body.error) && slack.posted.length === p0 + 1, "a typed workspace id that is not one is refused");
    settings.sending.botToken = TOKEN; await call("/api/prs/settings", { settings });
    a = await call("/api/prs/sending/test-dm", { id: "U0TEST0001", token: "" }); ok(a.status === 400 && /bot token/.test(a.body.error) && slack.posted.length === p0 + 1, "an emptied token field is empty: the saved token is not used behind it");
    a = await call("/api/prs/sending/test-dm", { id: "U0TEST0001", team: "" }); ok(a.status === 400 && /workspace id first/.test(a.body.error) && slack.posted.length === p0 + 1, "an emptied workspace id field is empty too");
    a = await call("/api/prs/sending/test-dm", { id: "U0TEST0001", name: "Quinn Lead (qlead)" }); ok(a.status === 200 && slack.posted.length === p0 + 2, "an untouched token field uses the saved token");
    const p1 = slack.posted.length;
    for (const [id, why] of [["U0TEST0005", /deactivated/], ["U0TEST0004", /another Slack workspace/], ["U0TEST0006", /bot/], ["U0TEST0099", /user_not_found/], ["not-an-id", /member id/]] as const) {
      a = await call("/api/prs/sending/test-dm", { id, token: TOKEN, team: TEAM }); ok(a.status === 400 && why.test(a.body.error) && slack.posted.length === p1, `a test DM to ${id} is refused with the reason, nothing posted`, JSON.stringify(a.body)); } }
} catch (e: any) { ok(false, "the suite ran to its end", String(e?.stack || e)); }
finally { W.stop(); poller.stop(); gh.stop(); slack.stop(); hook.stop(true); hook2.stop(true); }
end();
