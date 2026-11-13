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
import { prWatchGitHub, fixtureSettings } from "./lib/pr-watch-github";

const { ok, end } = suite("pr-watch-owners");
const gh = prWatchGitHub(), ca = "northwind/checkout-api", id18 = `${ca}#18`, p18 = gh.data.find(ca, 18)!, head = gh.data.head(p18);
gh.data.rules[ca].rulesets[0].parameters.required_approving_review_count = 5;
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
  await call("/api/prs/settings", { settings: { ...fixtureSettings, follow: { enabled: true } } });
  await call("/api/prs/refresh", {}); await until(() => !!card(), 15000);
  ok(card()?.follow.countGap === 4 && card().follow.groupsMissing.includes("@dana") && card().follow.groupsMissing.includes("@northwind/release") && !card().follow.groupsMissing.some((g: string) => /approval/.test(g)), "first: four more approvals (bo's older approval counts: these rules keep stale ones), @dana and the release team named apart from the count", JSON.stringify(card()?.follow));
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
  { const keys = E.cards.list({}).filter((c: any) => c.workflow === FOLLOW_WORKFLOW && c.status === "open").map((c: any) => `${c.follow.pr}:${c.follow.kind}`); ok(new Set(keys).size === keys.length, "never two open cards of one kind for one pull request", JSON.stringify(keys)); }
  ok(gh.calls.some((c) => c.path.startsWith(`/repos/${ca}/codeowners/errors`)) && !gh.unknown.length, "codeowners/errors is read; every request was one the fixture knows", JSON.stringify(gh.unknown));
} catch (e: any) { ok(false, "the suite ran to its end", String(e?.stack || e)); }
finally { W.stop(); poller.stop(); gh.stop(); }
end();
