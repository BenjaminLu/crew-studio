import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Pull requests (docs/units/pr-watch.md "Follow-through"): the approval of the latest push is followed apart from the
// approval count, on its own fictional GitHub (checkout-api#18: two approvals, approval of the most recent push on, stale
// approvals kept). A push that re-opens it, an approval that meets it and a re-approval on a new head are each said on their
// own; the count is never said met when it already was; the heading, the message and its short form name every missing item
// once, in both languages; and a push asks first, saying the new head will need an approval (none voided).
//   bun tests/pr-watch-lastpush.ts
import { harness, until, suite } from "./rt-harness";
import { bundledText } from "../src/bundled";
import { GitHubPoller } from "../src/github-poller";
import { createPrWatch, APPLY_WORKFLOW, FOLLOW_WORKFLOW } from "../src/pr-watch";
import { prWatchGitHub, fixtureSettings, sha } from "./lib/pr-watch-github";

const { ok, end } = suite("pr-watch-lastpush");
const gh = prWatchGitHub(), ca = "northwind/checkout-api", id18 = `${ca}#18`, p18: any = gh.data.find(ca, 18)!;
const P: any = gh.data.rules[ca].rulesets[0].parameters; P.required_approving_review_count = 2; P.require_last_push_approval = true; P.dismiss_stale_reviews_on_push = false;
process.env.CREW_GITHUB_API = gh.origin; process.env.CREW_GITHUB_TOKEN = "fixture-token"; process.env.CREW_GH_NO_CLI = "1"; process.env.CREW_GH = "0"; delete process.env.CREW_PR_WATCH;
const H = await harness([bundledText(`workflows/v2/${APPLY_WORKFLOW}.wf.yaml`)!, bundledText(`workflows/v2/${FOLLOW_WORKFLOW}.wf.yaml`)!]), E: any = H.engine;
const poller = new GitHubPoller(), W: any = createPrWatch({ dataDir: H.data, poller }); W.install(E);
const call = async (path: string, body?: unknown) => { const url = new URL(`http://127.0.0.1${path}`), writing = body !== undefined;
  const r = await W.handle(new Request(url, writing ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}), url, { kind: "desktop" }, writing); return { status: r!.status, body: await r!.json() }; };
const card = () => E.cards.list({}).find((c: any) => c.workflow === FOLLOW_WORKFLOW && c.status === "open" && c.follow?.pr === id18 && c.follow?.kind === "approve") as any;
const pushCard = () => E.cards.list({}).find((c: any) => c.workflow === FOLLOW_WORKFLOW && c.status === "open" && c.follow?.pr === id18 && c.follow?.kind === "push") as any;
const head = () => p18.commits.at(-1).sha as string, h7 = () => head().slice(0, 7);
const approve = (user: string, n: number) => p18.reviews.push({ user, state: "APPROVED", commit: head(), at: `2026-11-02T1${n}:00:00Z` });
// a new head pushed by someone; the evidence and the bot's review follow it, so only the approvals are left to ask for
const push = (k: string, by = "dev") => { p18.commits.push({ sha: sha("ca18-" + k), at: "2026-11-02T15:00:00Z", login: by });
  p18.comments.push({ user: "qa-lin", body: `# PASS\nhead ${sha("ca18-" + k).slice(0, 8)}`, at: "2026-11-02T16:00:00Z" }); p18.reviews.find((v: any) => v.user === "review-bot").commit = sha("ca18-" + k); };
const grow = async () => { const n = card()?.follow.history.length ?? 0; await call("/api/prs/refresh", {}); await until(() => (card()?.follow.history.length ?? 0) > n, 15000); return card().follow.history.at(-1) as { en: string; tw: string }; };
const LP = "an approval of the latest push by someone other than the pusher", LPtw = "最後一次 push 要由推的人以外的人 approve";
// every missing item named once: heading (both languages), message and short form; the short form never doubles a word
const named = (what: string) => { const f = card().follow, n = (s: string, x: string) => s.split(x).length - 1;
  ok(f.missing.every((m: any) => f.heading.en.includes(m.en.replace(/^✕ /, "")) && f.heading.tw.includes(m.tw.replace(/^✕ /, ""))), `${what}: the heading names every missing item, in both languages`, JSON.stringify({ heading: f.heading, missing: f.missing }));
  ok(n(f.message.en, "latest push") === 1 && n(f.message.tw, "最後一次 push") === 1 && !/approve 的 approve/.test(f.short.tw) && !/還差 還要|還缺 還要/.test(f.short.tw), `${what}: the message says the latest push once; the short form reads once`, JSON.stringify({ msg: f.message.en, short: f.short.tw })); };
try {
  await call("/api/prs/watch", { url: `https://github.com/${ca}` });
  await call("/api/prs/settings", { settings: { ...fixtureSettings, follow: { enabled: true } } });
  await call("/api/prs/refresh", {}); await until(() => !!card(), 15000);
  // bo's older approval counts (stale approvals kept), one more is needed, and the latest push has none: two items
  { const f = card().follow;
    ok(f.countGap === 1 && f.seen.needsLatestPush === true && f.missing.some((m: any) => m.en === `✕ ${LP}`) && f.missing.some((m: any) => m.en === "✕ 1 more approval"), "first: one more approval and the latest push's own approval, apart", JSON.stringify(f.missing));
    ok(f.heading.tw.includes("還要 1 個 approve") && f.heading.tw.includes(LPtw), "the Chinese heading names both the count and the latest push", f.heading.tw);
    ok(f.short.tw.includes("1 個 approve、推的人以外的人對最後一次 push 的 approve") && !/approve 的 approve/.test(f.short.tw), "the short form names each once", f.short.tw);
    named("first"); }
  // zed and kim approve the head: the count and the latest push met together, each said once
  approve("zed", 1); approve("kim", 1); let h = await grow();
  ok(h.en.startsWith("zed, kim approved ✓, so the latest-push approval is met; the approval count is met; the card now asks for:") && h.tw.startsWith("zed、kim approve ✓，最後一次 push 的 approve 有了；approve 人數已夠；") && card().follow.countGap === 0 && card().follow.seen.needsLatestPush === false, "both met by the same approvals: said together", JSON.stringify(h));
  ok(card().follow.message.en.includes("The branch rules ask for the approval after the last push") && !card().follow.missing.some((m: any) => m.en.includes("latest push")), "met: the message keeps the note that another push needs it again");
  // dev pushes: the approvals keep counting (nothing dismissed), only the latest push needs one again — the head moved
  push("c3"); h = await grow();
  ok(h.en.startsWith(`a new push needs an approval on the head ${h7()} by someone other than the pusher; the card now asks for:`) && h.en.endsWith(`${LP}.`) && h.tw.startsWith(`新的 push 要由推的人以外的人在 head ${h7()} 上 approve；卡片現在要：`) && !/counted approvals changed|count is met/.test(h.en), "a push re-opens the latest push: said as the push, never as the counted approvals changing", JSON.stringify(h));
  ok(card().follow.countGap === 0 && card().follow.approvedBy.join() === "bo,zed,kim", "the count holds: every approval still counts", JSON.stringify(card().follow.approvedBy));
  named("after a push");
  // kim approves the new head: kim already counted, the re-approval is said, and it meets the latest push (not the count)
  approve("kim", 5); h = await grow();
  ok(h.en.startsWith(`kim approved again on the head ${h7()} ✓, so the latest-push approval is met; the card now asks for:`) && !h.en.includes("count is met") && h.tw.startsWith(`kim 在 head ${h7()} 上重新 approve ✓，最後一次 push 的 approve 有了；卡裡只留：`), "a re-approval on the new head is said, and meets the latest push; the count was already met", JSON.stringify(h));
  // kim pushes and approves the own head: counted already, said again, but the latest push still needs someone else
  push("c4", "kim"); approve("kim", 6); h = await grow();
  ok(h.en.startsWith(`kim approved again on the head ${h7()} ✓; a new push needs an approval on the head ${h7()} by someone other than the pusher; the card now asks for:`), "the pusher's own re-approval is said, and the latest push still needs another person", JSON.stringify(h));
  // lee approves: a new approval that meets the latest push; the count was met all along
  approve("lee", 7); h = await grow();
  ok(h.en.startsWith("lee approved ✓, so the latest-push approval is met; the card now asks for:") && !h.en.includes("count is met"), "a new approval meets the latest push; the count is never said met twice", JSON.stringify(h));
  // a push and more approvals required in one refresh: the count and the latest push each said, the gap counts only approvals
  P.required_approving_review_count = 7; push("c5"); h = await grow();
  ok(h.en.startsWith(`the rules now ask for 7 approvals, not 2; a new push needs an approval on the head ${h7()} by someone other than the pusher; the card now asks for:`) && h.en.includes("3 more approvals") && card().follow.countGap === 3, "rules and push together: both said, and the gap is the count alone", JSON.stringify({ h, gap: card().follow.countGap }));
  ok(card().follow.heading.tw.includes("還要 3 個 approve") && card().follow.heading.tw.includes(LPtw) && card().follow.heading.en.includes("3 more approvals") && card().follow.heading.en.includes(LP), "both missing: the heading names both, in English and in Chinese", JSON.stringify(card().follow.heading));
  named("both missing");
  // nothing changes: no line
  { const n = card().follow.history.length; await call("/api/prs/refresh", {}); await new Promise((r) => setTimeout(r, 800)); ok(card().follow.history.length === n, "a refresh with nothing new adds no line"); }
  // a push with stale approvals kept voids none, but the new head will need an approval: the captain is asked first
  { const a = await call("/api/prs/push-check", { pr: id18 }); await until(() => !!pushCard(), 10000); const c = pushCard().follow;
    ok(a.body.card === true && a.body.voids === 0 && a.body.latestPush === true, "push-check: none voided, the latest push needs an approval, a card", JSON.stringify(a.body));
    ok(c.heading.en === "This push needs a new approval of its head: push?" && c.heading.tw === "這次 push 之後新的 head 要有人 approve，要推嗎？" && c.lead.en.includes("no approval is voided") && c.opts.map((o: any) => o.id).join() === "push,no-push,follow-up" && c.opts[0].label.en === "Push, then ask for an approval of the new head", "the push card says the new head needs an approval by someone other than the pusher, with the push card's options", JSON.stringify({ heading: c.heading, lead: c.lead.en })); }
  ok(!gh.calls.some((c) => c.method !== "GET" && c.path !== "/graphql") && !gh.unknown.length, "nothing was written to GitHub; every request was one the fixture knows", JSON.stringify(gh.unknown));
} catch (e: any) { ok(false, "the suite ran to its end", String(e?.stack || e)); }
finally { W.stop(); poller.stop(); gh.stop(); }
end();
