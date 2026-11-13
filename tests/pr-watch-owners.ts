import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Pull requests (docs/units/pr-watch.md "Follow-through"): an approve card that shrinks says why, on its own fictional
// GitHub (checkout-api#18, here with five approvals required): a smaller approval count is someone's approval, never a group
// that "left"; a team that approves is said with who; and a code owner GitHub reports as unknown (codeowners/errors) is
// left out as GitHub does, said as no longer required (never that they approved). English and Chinese, no arrows.
//   bun tests/pr-watch-owners.ts
import { harness, until, suite } from "./rt-harness";
import { bundledText } from "../src/bundled";
import { GitHubPoller } from "../src/github-poller";
import { createPrWatch, APPLY_WORKFLOW, FOLLOW_WORKFLOW } from "../src/pr-watch";
import { prWatchGitHub, fixtureSettings, sha } from "./lib/pr-watch-github";

const { ok, end } = suite("pr-watch-owners");
const gh = prWatchGitHub(), ca = "northwind/checkout-api", id18 = `${ca}#18`, p18 = gh.data.find(ca, 18)!, head = gh.data.head(p18);
gh.data.rules[ca].rulesets[0].parameters.required_approving_review_count = 5;
gh.data.rules[ca].codeowners += "/src/settings.ts @skipper\n"; // a file only the author owns
process.env.CREW_GITHUB_API = gh.origin; process.env.CREW_GITHUB_TOKEN = "fixture-token"; process.env.CREW_GH_NO_CLI = "1"; process.env.CREW_GH = "0"; delete process.env.CREW_PR_WATCH;
const H = await harness([bundledText(`workflows/v2/${APPLY_WORKFLOW}.wf.yaml`)!, bundledText(`workflows/v2/${FOLLOW_WORKFLOW}.wf.yaml`)!]), E = H.engine;
const poller = new GitHubPoller(), W = createPrWatch({ dataDir: H.data, poller }); W.install(E);
const call = async (path: string, body?: unknown) => { const url = new URL(`http://127.0.0.1${path}`), writing = body !== undefined;
  const r = await W.handle(new Request(url, writing ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}), url, { kind: "desktop" }, writing); return { status: r!.status, body: await r!.json() }; };
const row = async () => (await call("/api/prs")).body.rows.find((r: any) => r.id === id18);
const card = () => E.cards.list({}).find((c: any) => c.workflow === FOLLOW_WORKFLOW && c.status === "open" && c.follow?.pr === id18 && c.follow?.kind === "approve") as any;
const approve = (user: string, h: number) => p18.reviews!.push({ user, state: "APPROVED", commit: head, at: `2026-11-02T1${h}:00:00Z` });
const last = () => card()?.follow.history.at(-1) ?? { en: "", tw: "" };
const clean = (x: { en: string; tw: string }) => !x.en.includes("→") && !x.tw.includes("→") && !/\s[（；：，]|[）；：，]\s/.test(x.tw);
const step = async (n: number) => { const len = card()?.follow.history.length ?? 0; await call("/api/prs/refresh", {}); await until(() => (card()?.follow.history.length ?? 0) > len, 15000); };
try {
  await call("/api/prs/watch", { url: `https://github.com/${ca}` });
  await call("/api/prs/settings", { settings: { ...fixtureSettings, evidence: { accounts: [], checks: [], labels: [] }, environments: [], follow: { enabled: true } } });
  await call("/api/prs/refresh", {}); await until(() => !!card(), 15000);
  ok(card()?.follow.countGap === 4 && card().follow.groupsMissing.includes("@dana") && card().follow.groupsMissing.includes("@northwind/release") && !card().follow.groupsMissing.some((g: string) => /approval/.test(g)), "first: four more approvals (bo's older approval counts: these rules keep stale ones), @dana and the release team named apart from the count", JSON.stringify(card()?.follow));
  { const m = card().follow.missing.find((x: any) => x.en.includes("@skipper"));
    ok(m?.en === "✕ @skipper (only the author owns these files: GitHub needs another owner or an admin)" && m?.tw === "✕ @skipper（只有作者是這些檔案的 owner：GitHub 需要別的 owner 或 admin）", "a group only the author owns says so, in both languages", JSON.stringify(m)); }
  // a card raised before the count was followed (no countGap): the next refresh takes the count silently
  { const c = card(), n = c.follow.history.length, gap = c.follow.countGap; delete c.follow.countGap; E.cards.save(c);
    await call("/api/prs/refresh", {}); await until(() => card()?.follow.countGap !== undefined, 15000);
    ok(card().follow.countGap === gap && card().follow.history.length === n, "an older card gets its count on the next refresh without a line in its record"); }
  // a count drop alone: someone outside every group approves
  approve("zed", 1); await step(1); let h = last();
  ok(/^zed approved ✓; the card now asks for: .*3 more approvals/.test(h.en) && h.tw.startsWith("zed approve ✓；卡裡只留：") && h.tw.includes("還要 3 個 approve") && !/no longer required|不再需要/.test(h.en + h.tw) && clean(h), "a smaller count: who approved and what is left, never \"no longer required\"", JSON.stringify(h));
  // a count drop and a named group met: the release team approves
  approve("rel-ray", 2); await step(2); h = last();
  ok(h.en.startsWith("@northwind/release (rel-ray) approved ✓; the card now asks for:") && h.tw.startsWith("@northwind/release（rel-ray）approve ✓；卡裡只留：") && h.tw.includes("還要 2 個 approve") && !/; rel-ray approved/.test(h.en) && clean(h), "the team that approved, with who, said once; the count left in the same line", JSON.stringify(h));
  // a count drop and an unknown owner left out at once: kim approves; GitHub reports @dana as unknown
  approve("kim", 3); gh.data.rules[ca].codeownersErrors = [{ line: 3, column: 8, kind: "Unknown owner", source: "/docs/ @dana", suggestion: null, message: "Unknown owner on line 3", path: ".github/CODEOWNERS" }];
  await step(3); h = last(); const r = await row();
  ok(!r.approvals.missing.some((m: any) => m.kind === "owner" && m.who.includes("@dana")) && !(r.approvals.groups ?? []).some((g: any) => g.who.includes("@dana")), "an owner GitHub reports as unknown is left out, as GitHub does", JSON.stringify(r.approvals));
  ok(h.en.startsWith("kim approved ✓; @dana is no longer required (GitHub ignores an owner it reports as unknown") && h.tw.startsWith("kim approve ✓；@dana 不再需要（GitHub 會略過") && h.tw.includes("還要 1 個 approve") && !/@dana[^;]*approved/.test(h.en) && clean(h), "kim's approval and @dana no longer required, each said as it is", JSON.stringify(h));
  // why a card grows is told from what changed since it last looked, never guessed from the rules as they are now
  const grow = async (n: number) => { await step(n); return last(); };
  // (c) an approval dismissed on GitHub, the rules unchanged and keeping stale approvals
  p18.reviews!.push({ user: "zed", state: "DISMISSED", commit: head, at: "2026-11-02T15:00:00Z" }); h = await grow(4);
  ok(h.en.startsWith("zed's approval no longer counts (dismissed on GitHub); the card now asks for:") && h.tw.startsWith("zed 的 approve 不再算數（在 GitHub 上被 dismiss）；卡片現在要：") && clean(h), "an approval dismissed on GitHub, no rule change: said as dismissed", JSON.stringify(h));
  // stale dismissal turned on: bo's older approval stops counting
  gh.data.rules[ca].rulesets[0].parameters.dismiss_stale_reviews_on_push = true; h = await grow(5);
  ok(h.en.startsWith("bo's approval no longer counts (the rules now dismiss stale approvals); the card now asks for:") && h.tw.startsWith("bo 的 approve 不再算數（分支規則改為舊 approve 不算）；卡片現在要：") && clean(h), "stale dismissal turned on: said as that", JSON.stringify(h));
  // (a) the rules already dismiss stale approvals; the required count goes 5 → 6: said as the count, never as dismissal
  gh.data.rules[ca].rulesets[0].parameters.required_approving_review_count = 6; h = await grow(6);
  ok(h.en.startsWith("the rules now ask for 6 approvals, not 5; the card now asks for:") && h.tw.startsWith("分支規則要求的 approve 從 5 個改為 6 個；卡片現在要：") && !/dismiss|舊 approve/.test(h.en + h.tw) && clean(h), "a higher required count: said as the count", JSON.stringify(h));
  // (c) again, with the dismiss rules on: kim's approval dismissed
  p18.reviews!.push({ user: "kim", state: "DISMISSED", commit: head, at: "2026-11-02T16:00:00Z" }); h = await grow(7);
  ok(h.en.startsWith("kim's approval no longer counts (dismissed on GitHub)") && !/stale|舊 approve/.test(h.en + h.tw) && clean(h), "an approval dismissed with the dismiss rules on: still said as dismissed, not as the rules", JSON.stringify(h));
  // (b) a push: every approval on the old head stops counting; then a rule change says only the rule, not the old push
  approve("amy", 6); await step(8);
  const c3 = { sha: sha("ca18-3"), at: "2026-11-02T17:00:00Z", login: "skipper" }; p18.commits.push(c3 as any); h = await grow(9);
  ok(h.en.startsWith("the approvals of rel-ray and amy no longer count (new commits") && h.en.includes(` no longer count (new commits (head ${c3.sha.slice(0, 7)}))`) && h.tw.includes(`的 approve 不再算數（有新 commit（head ${c3.sha.slice(0, 7)}））`) && clean(h), "a push: the approvals it voids, plural, said as new commits", JSON.stringify(h));
  gh.data.rules[ca].rulesets[0].parameters.required_approving_review_count = 7; h = await grow(10);
  ok(h.en.startsWith("the rules now ask for 7 approvals, not 6") && !/new commits|新 commit/.test(h.en + h.tw) && clean(h), "after the push, a rule change says only the rule (the card follows the head)", JSON.stringify(h));
  { const keys = E.cards.list({}).filter((c: any) => c.workflow === FOLLOW_WORKFLOW && c.status === "open").map((c: any) => `${c.follow.pr}:${c.follow.kind}`); ok(new Set(keys).size === keys.length, "never two open cards of one kind for one pull request", JSON.stringify(keys)); }
  ok(gh.calls.some((c) => c.path.startsWith(`/repos/${ca}/codeowners/errors`)) && !gh.unknown.length, "codeowners/errors is read; every request was one the fixture knows", JSON.stringify(gh.unknown));
} catch (e: any) { ok(false, "the suite ran to its end", String(e?.stack || e)); }
finally { W.stop(); poller.stop(); gh.stop(); }
end();
