import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Pull requests (docs/units/pr-watch.md "Follow-through"): a code owner GitHub reports as unknown (codeowners/errors) is
// left out, as GitHub itself ignores it, end to end on its own fictional GitHub: the row stops asking for that owner, and
// the approve card that asked for it shrinks, its record saying the owner is no longer required (never that they approved).
//   bun tests/pr-watch-owners.ts
import { harness, until, suite } from "./rt-harness";
import { bundledText } from "../src/bundled";
import { GitHubPoller } from "../src/github-poller";
import { createPrWatch, APPLY_WORKFLOW, FOLLOW_WORKFLOW } from "../src/pr-watch";
import { prWatchGitHub, fixtureSettings } from "./lib/pr-watch-github";

const { ok, end } = suite("pr-watch-owners");
const gh = prWatchGitHub(), ca = "northwind/checkout-api", id18 = `${ca}#18`;
process.env.CREW_GITHUB_API = gh.origin; process.env.CREW_GITHUB_TOKEN = "fixture-token"; process.env.CREW_GH_NO_CLI = "1"; process.env.CREW_GH = "0"; delete process.env.CREW_PR_WATCH;
const H = await harness([bundledText(`workflows/v2/${APPLY_WORKFLOW}.wf.yaml`)!, bundledText(`workflows/v2/${FOLLOW_WORKFLOW}.wf.yaml`)!]), E = H.engine;
const poller = new GitHubPoller(), W = createPrWatch({ dataDir: H.data, poller }); W.install(E);
const call = async (path: string, body?: unknown) => { const url = new URL(`http://127.0.0.1${path}`), writing = body !== undefined;
  const r = await W.handle(new Request(url, writing ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}), url, { kind: "desktop" }, writing); return { status: r!.status, body: await r!.json() }; };
const row = async () => (await call("/api/prs")).body.rows.find((r: any) => r.id === id18);
const card = () => E.cards.list({}).find((c: any) => c.workflow === FOLLOW_WORKFLOW && c.status === "open" && c.follow?.pr === id18 && c.follow?.kind === "approve") as any;
try {
  await call("/api/prs/watch", { url: `https://github.com/${ca}` });
  // 18 waits only on approvals here: its evidence passes on the head and it runs on qa
  // (the release team has not approved either: the card keeps that group when @dana goes)
  await call("/api/prs/settings", { settings: { ...fixtureSettings, follow: { enabled: true } } });
  await call("/api/prs/refresh", {}); await until(() => !!card(), 15000);
  let r = await row();
  ok(r.approvals.missing.some((m: any) => m.kind === "owner" && m.who.includes("@dana")), "first: @dana owns docs/permissions.md and has not approved", JSON.stringify(r.approvals.missing));
  ok(!!card() && card().follow.groupsMissing.includes("@dana"), "the approve card asks for @dana", JSON.stringify(card()?.follow.groupsMissing));
  // GitHub now reports @dana as an unknown owner on line 3 of CODEOWNERS
  gh.data.rules[ca].codeownersErrors = [{ line: 3, column: 8, kind: "Unknown owner", source: "/docs/ @dana", suggestion: null, message: "Unknown owner on line 3", path: ".github/CODEOWNERS" }];
  await call("/api/prs/refresh", {}); await until(() => !card()?.follow.groupsMissing.includes("@dana"), 15000);
  r = await row();
  ok(!r.approvals.missing.some((m: any) => m.kind === "owner" && m.who.includes("@dana")) && !(r.approvals.groups ?? []).some((g: any) => g.who.includes("@dana")), "an owner GitHub reports as unknown is left out, as GitHub does", JSON.stringify(r.approvals));
  const h = (card()?.follow.history ?? []).map((x: any) => x.en).join(" | ");
  ok(/no longer required: @dana \(GitHub ignores an owner it reports as unknown/.test(h) && !/@dana.*approve|approved: @dana/i.test(h.replace(/no longer required: @dana[^|]*/, "")), "the card's record says @dana is no longer required, not that @dana approved", h);
  { const keys = E.cards.list({}).filter((c: any) => c.workflow === FOLLOW_WORKFLOW && c.status === "open").map((c: any) => `${c.follow.pr}:${c.follow.kind}`); ok(new Set(keys).size === keys.length, "never two open cards of one kind for one pull request", JSON.stringify(keys)); }
  ok(gh.calls.some((c) => c.path.startsWith(`/repos/${ca}/codeowners/errors`)) && !gh.unknown.length, "codeowners/errors is read; every request was one the fixture knows", JSON.stringify(gh.unknown));
} catch (e: any) { ok(false, "the suite ran to its end", String(e?.stack || e)); }
finally { W.stop(); poller.stop(); gh.stop(); }
end();
