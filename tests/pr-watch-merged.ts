import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Pull requests (docs/units/pr-watch.md "Merged, until production"): a merged pull request stays on the list until it is
// in every production environment, then 14 days more. Against the fictional GitHub (tests/lib/pr-watch-github.ts): which
// merged pull requests are followed, each environment read against the merge commit (it is on when the commit it runs
// contains the merge commit), the merged and live tabs, the day a pull request is dropped, and that it never comes back.
//   bun tests/pr-watch-merged.ts
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { until, suite } from "./rt-harness";
import { GitHubPoller } from "../src/github-poller";
import { createPrWatch } from "../src/pr-watch";
import * as R from "../src/pr-watch-rules";
import { prWatchGitHub, fixtureSettings } from "./lib/pr-watch-github";

const { ok, end } = suite("pr-watch-merged");

// ---------- the pure rule ----------
{
  const e = (name: string, on: boolean | null, production = false) => ({ name, on, production });
  ok(R.shipState([e("staging", true), e("prod", true, true)]).live, "in every production environment: live");
  ok(!R.shipState([e("staging", true), e("eu", true, true), e("us", false, true)]).live && R.shipState([e("staging", true), e("eu", true, true), e("us", false, true)]).waits === "us", "one production environment of two: not live, waits on the other");
  ok(R.shipState([e("dev", false), e("staging", true), e("prod", false, true)]).waits === "prod", "it waits on the environment after the furthest one that has it");
  ok(R.shipState([e("dev", false), e("staging", false), e("prod", false, true)]).waits === "dev", "nowhere yet: it waits on the first environment");
  ok(R.shipState([e("staging", null), e("prod", null, true)]).waits === "staging" && !R.shipState([e("prod", null, true)]).live, "an environment that could not be read is not on");
  ok(R.shipState([e("staging", true)]).noProduction && !R.shipState([e("staging", true)]).live, "no production environment set: never live, and it says so");
  // reverts: the newest merged revert of a chain decides
  const m = "2026-11-02T00:00:00Z", rv = (pulls: any[]) => JSON.stringify([...R.revertedBy("northwind/checkout-api", pulls)]);
  const a = { number: 1, title: "A", merged_at: m }, r1 = { number: 2, title: 'Revert "A"', body: "Reverts northwind/checkout-api#1", merged_at: m }, r2 = { number: 3, title: 'Revert "Revert "A""', merged_at: m };
  ok(rv([a, r1]) === "[[1,2]]" && rv([a, r1, r2]) === "[[2,3]]", "a revert drops its target; a merged revert of the revert gives it back (title only)", rv([a, r1, r2]));
  ok(rv([a, r1, r2, { number: 4, title: 'Revert "A"', merged_at: m }]) === "[[1,4],[2,3]]", "reverted again by a newer merged revert: dropped again");
  ok(rv([a, { ...r1, merged_at: null }]) === "[]" && rv([a, { ...r1, body: "Reverts northwind/web-app#1", title: "x" }]) === "[]", "an unmerged revert, or one naming another repository, cancels nothing");
}

// ---------- the module against the fictional GitHub ----------
const gh = prWatchGitHub();
process.env.CREW_GITHUB_API = gh.origin; process.env.CREW_GITHUB_TOKEN = "fixture-token"; process.env.CREW_GH_NO_CLI = "1"; process.env.CREW_GH = "0"; delete process.env.CREW_PR_WATCH;
const dir = mkdtempSync(join(tmpdir(), "pr-watch-merged-")), poller = new GitHubPoller();
let clock = Date.now();
const W = createPrWatch({ dataDir: dir, poller, now: () => clock });
const call = async (path: string, body?: unknown) => { const url = new URL(`http://127.0.0.1${path}`), writing = body !== undefined;
  const r = await W.handle(new Request(url, writing ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}), url, { kind: "desktop" }, writing); return { status: r!.status, body: await r!.json() }; };
const merged = (v: any, id: string) => v.merged.find((r: any) => r.id === id);
try {
  ok((await call("/api/prs/watch", { url: "https://github.com/northwind/checkout-api" })).status === 200, "watch the repository");
  ok((await call("/api/prs/settings", { settings: fixtureSettings })).status === 200, "the settings: dev (a deployment), qa (a check), staging (a branch), prod (an image tag in a file)");
  await call("/api/prs/refresh", {}); await until(() => !!W.snapshot.at, 15000);
  let v = (await call("/api/prs")).body;
  const ids = v.merged.map((r: any) => r.id);
  ok(ids.join() === "northwind/checkout-api#23,northwind/checkout-api#21,northwind/checkout-api#22", "the captain's merged pull requests, oldest merge first; someone else's and a closed one are not followed", ids.join());
  ok(!v.rows.some((r: any) => /#2[1-4]$/.test(r.id)), "merged pull requests are not open rows");
  const r21 = merged(v, "northwind/checkout-api#21"), r22 = merged(v, "northwind/checkout-api#22"), r23 = merged(v, "northwind/checkout-api#23");
  ok(r21.mergeSha === gh.data.merge(gh.data.find("northwind/checkout-api", 21)!) && r21.tab === "merged", "a merged row carries its merge commit", JSON.stringify(r21));
  const on = (r: any) => r.envs.filter((e: any) => e.on).map((e: any) => e.name).join();
  ok(on(r21) === "staging" && r21.ship.waits === "prod", "21: staging's branch deployment contains the merge commit; prod's image tag does not; it waits on prod", JSON.stringify(r21.envs));
  ok(on(r22) === "" && r22.ship.waits === "dev" && r22.deps.map((x: any) => x.id).join() === "northwind/checkout-api#21" && r22.deps[0].state === "merged", "22: nowhere yet; its Depends-on line names 21, merged and not live", JSON.stringify(r22));
  ok(on(r23) === "staging,prod" && r23.tab === "live" && r23.ship.live && r23.ship.liveAt === W.snapshot.at, "23: the production image tag's commit contains the merge commit: live since this refresh", JSON.stringify(r23));
  ok(Date.parse(r23.ship.dropAt) - Date.parse(r23.ship.liveAt) === 14 * 86400_000, "a live row is dropped 14 days after Studio first saw it live");
  ok(!gh.calls.some((c) => c.path.includes("/commits/") && c.path.includes(gh.data.head(gh.data.find("northwind/checkout-api", 21)!))), "a merged row's environments are read at its merge commit, never its old head");
  ok(gh.calls.some((c) => c.path.startsWith("/repos/northwind/checkout-api/pulls?state=closed")), "the closed pull requests are read from GitHub's first page");
  ok(!gh.unknown.length, "every GitHub request was one the fixture knows", JSON.stringify(gh.unknown));
  { // a page of closed pull requests larger than the 1 MB Studio reads: read again in pages of 5, never "could not be reached"
    gh.knobs.hugeClosed = true; const before = gh.calls.length; await call("/api/prs/refresh", {}); const h = (await call("/api/prs")).body; gh.knobs.hugeClosed = false;
    const fresh = gh.calls.slice(before).map((c) => c.path).filter((x) => x.startsWith("/repos/northwind/checkout-api/pulls?state=closed"));
    ok(h.merged.map((r: any) => r.id).join() === ids.join() && !W.snapshot.errors.some((e: any) => e.target === "northwind/checkout-api"), "a closed page over 1 MB: the merged rows are still read, no error for the repository", JSON.stringify(W.snapshot.errors));
    ok(fresh.some((x) => x.includes("per_page=20&page=1")) && fresh.some((x) => x.includes("per_page=5&page=1")), "the closed pull requests are asked in pages of 20, then of 5 when one is too large", fresh.join()); }
  // ---------- what each asks for before it goes live, and the release brief ----------
  const kinds = (r: any) => r.ops.map((o: any) => `${o.kind}${o.names?.length ? `:${o.names.join("|")}` : ""}${o.metric ? `:${o.metric.name}` : ""}`).join();
  ok(kinds(r21) === "secret:LIMITS_SECRET,metric:trades_rejected_total,rollout" && kinds(r22) === "migration", "a merged row carries its items: a newly read secret, a metric, its rollout section; a migration", `${kinds(r21)} / ${kinds(r22)}`);
  ok(r21.ops.every((o: any) => o.url.startsWith("https://github.com/northwind/checkout-api/")) && r21.ops.find((o: any) => o.kind === "metric").url.endsWith(`/blob/${r21.mergeSha}/src/metrics.go#L11`), "each item links to its file and line at the merge commit");
  let br = await call("/api/prs/brief", { prs: ["northwind/checkout-api#22"] });
  const tag18 = gh.data.head(gh.data.find("northwind/checkout-api", 18)!).slice(0, 12);
  ok(br.status === 200 && br.body.batches.length === 2 && br.body.batches[0].prs.map((p: any) => p.id).join() === "northwind/checkout-api#21" && br.body.batches[0].added[0]?.id === "northwind/checkout-api#21" && br.body.batches[0].added[0].for === "northwind/checkout-api#22", "selecting 22 alone: 21, which it depends on, is added to a first batch with the reason", JSON.stringify(br.body).slice(0, 400));
  const l1 = br.body.batches[0].units[0].lines[0], l2 = br.body.batches[1].units[0].lines[0];
  ok(l1.repository === "northwind/infra" && l1.path === "deploy/prod.yaml" && l1.before === `image: registry.example/checkout:${tag18}` && l1.after === "image: registry.example/checkout:v1.3.0", "batch 1: the line in the production file, old tag → the newest tag that has 21 and not 22 (22 goes later)", JSON.stringify(l1));
  ok(l2.before === "image: registry.example/checkout:v1.3.0" && l2.after === "image: registry.example/checkout:v1.4.0" && br.body.batches[1].forced[0]?.on === "northwind/checkout-api#21", "batch 2 starts from batch 1's tag; v1.4.1 is newer but its CI failed, so v1.4.0", JSON.stringify(l2));
  ok(br.body.batches[1].ops.some((o: any) => o.kind === "migration") && br.body.batches[0].ops.some((o: any) => o.kind === "metric"), "each batch carries its own pull requests' items");
  br = await call("/api/prs/brief", { prs: ["northwind/checkout-api#21"] });
  ok(br.body.batches.length === 1 && br.body.batches[0].units[0].lines[0].after.endsWith(":v1.4.0") && br.body.batches[0].units[0].carries.join() === "northwind/checkout-api#22", "21 alone: the newest green tag with 21 also carries 22, which was not selected: the brief says so", JSON.stringify(br.body.batches[0].units[0]));
  { // a pull request production already runs is not "carried": only what is new beside the old tag
    const prodHead = gh.data.head(gh.data.find("northwind/checkout-api", 18)!), m22 = gh.data.merge(gh.data.find("northwind/checkout-api", 22)!);
    gh.data.contains[prodHead].push(m22); const b = await call("/api/prs/brief", { prs: ["northwind/checkout-api#21"] }); gh.data.contains[prodHead].pop();
    ok(b.body.batches[0].units[0].carries.length === 0, "a tag's unselected pull request that production already runs is not listed as carried", JSON.stringify(b.body.batches[0].units[0])); }
  { // no tag between 21 and 22: the reason is the merge order, and batch 2 starts from "none built", never the old file tag
    const tags = gh.data.tags["northwind/checkout-api"], v130 = tags.pop()!; const b = await call("/api/prs/brief", { prs: ["northwind/checkout-api#22"] }); tags.push(v130);
    const l1 = b.body.batches[0].units[0].lines[0], l2 = b.body.batches[1].units[0].lines[0];
    ok(l1.after === null && l1.problem === "order" && l1.laterBy.join() === "northwind/checkout-api#22", "no tag for batch 1 because every tag with 21 also has 22: said as the merge order", JSON.stringify(l1));
    ok(l2.before === null && l2.problem === "previous" && l2.newTag === "v1.4.0", "batch 2's old tag is batch 1's (none built), not the file's", JSON.stringify(l2)); }
  { const b = await call("/api/prs/brief", { prs: ["northwind/checkout-api#21"] });
    ok(b.body.batches[0].units[0].lines[0].ci === "green", "a tag's CI is reported with its line (none ran: said in the brief)"); }
  ok((await call("/api/prs/brief", { prs: ["northwind/checkout-api#23"] })).status === 400 && (await call("/api/prs/brief", { prs: [] })).status === 400, "a live pull request, or none, is refused");
  ok(!gh.calls.some((c) => c.method !== "GET" && c.path !== "/graphql"), "a brief writes nothing to GitHub");
  // ---------- marked in production by hand (a captain who cannot read production's version) ----------
  { const id21 = "northwind/checkout-api#21", id22 = "northwind/checkout-api#22", k22 = id22.toLowerCase();
    ok((await call("/api/prs/ship/mark", { prs: ["northwind/checkout-api#23"] })).status === 400 && (await call("/api/prs/ship/mark", { prs: [] })).status === 400 && (await call("/api/prs/ship/mark", { prs: ["northwind/checkout-api#999"] })).status === 400, "marking a live row, none, or one not on the list is refused");
    const markedAt = new Date(clock).toISOString();
    let m = await call("/api/prs/ship/mark", { prs: [id22] }), r = merged(m.body, id22);
    ok(m.status === 200 && r.tab === "live" && r.ship.live && r.ship.waits === null && r.ship.manual?.at === markedAt && r.ship.liveAt === markedAt, "mark: 22 moves to Live, marked by hand at the mark time", JSON.stringify(r?.ship));
    ok(Date.parse(r.ship.dropAt) - Date.parse(markedAt) === 14 * 86400_000 && W.state.manual?.[k22]?.at === markedAt && W.state.shipped[k22]?.liveAt === markedAt, "a marked row is dropped 14 days after the mark, and the mark is in state.json", JSON.stringify(W.state.manual));
    ok(merged(m.body, id21).tab === "merged" && !merged(m.body, id21).ship.manual, "the other rows stay where they are");
    await call("/api/prs/refresh", {}); v = (await call("/api/prs")).body; r = merged(v, id22);
    ok(r.tab === "live" && r.ship.manual?.at === markedAt && r.ship.liveAt === markedAt && W.state.shipped[k22]?.liveAt === markedAt, "a marked row stays Live after a refresh, although production still does not show it", JSON.stringify(r.ship));
    ok((await call("/api/prs/brief", { prs: [id22] })).status === 400, "the release brief no longer offers a marked row as waiting to go live");
    { const b = await call("/api/prs/brief", { prs: [id21] });
      ok(b.status === 200 && b.body.batches.length === 1 && b.body.batches[0].units[0].carries.length === 0, "21 alone: 22 was marked as in production, so the brief no longer warns that the tag carries it", JSON.stringify(b.body.batches?.[0]?.units?.[0])); }
    { const W2 = createPrWatch({ dataDir: dir, poller, now: () => clock }); const r2 = W2.view().merged.find((x: any) => x.id === id22);
      ok(r2?.tab === "live" && r2.ship.manual?.at === markedAt, "the mark survives a restart (read back from state.json)", JSON.stringify(r2?.ship)); W2.stop(); }
    // undo: back to merged, also after a refresh; only a row marked by hand has an undo
    m = await call("/api/prs/ship/undo", { pr: id22 }); r = merged(m.body, id22);
    ok(m.status === 200 && r.tab === "merged" && !r.ship.manual && r.ship.waits === "dev" && !W.state.manual?.[k22] && W.state.shipped[k22]?.liveAt === null, "undo: 22 is back on Merged, not live, waiting on dev", JSON.stringify({ ship: r?.ship, manual: W.state.manual }));
    await call("/api/prs/refresh", {}); v = (await call("/api/prs")).body;
    ok(merged(v, id22).tab === "merged", "an undone row stays on Merged after a refresh");
    ok((await call("/api/prs/ship/undo", { pr: id22 })).status === 400 && (await call("/api/prs/ship/undo", { pr: "northwind/checkout-api#23" })).status === 400, "undo on a row not marked by hand, or one production shows, is refused");
    // the selected rows at once
    m = await call("/api/prs/ship/mark", { prs: [id21, id22] });
    ok(m.status === 200 && [id21, id22].every((id) => merged(m.body, id).tab === "live" && merged(m.body, id).ship.manual) && Object.keys(W.state.manual ?? {}).length === 2, "the selected rows are marked in one action", JSON.stringify(W.state.manual));
    ok(merged(m.body, id22).deps[0]?.state === "live", "a dependency marked by hand reads live on the row that depends on it", JSON.stringify(merged(m.body, id22).deps));
    for (const id of [id21, id22]) await call("/api/prs/ship/undo", { pr: id });
    // production confirms a marked row: an ordinary live row, still counted from the earlier mark time
    const prodHead = gh.data.head(gh.data.find("northwind/checkout-api", 18)!), m22 = gh.data.merge(gh.data.find("northwind/checkout-api", 22)!);
    clock += 3600_000; const markedAgain = new Date(clock).toISOString(); await call("/api/prs/ship/mark", { prs: [id22] });
    clock += 3600_000; gh.data.contains[prodHead].push(m22); await call("/api/prs/refresh", {}); v = (await call("/api/prs")).body; r = merged(v, id22);
    ok(r.tab === "live" && !r.ship.manual && r.ship.liveAt === markedAgain && !W.state.manual?.[k22] && W.state.shipped[k22]?.liveAt === markedAgain, "production confirms a marked row: the mark is dropped, and Live keeps the mark time (the earlier one)", JSON.stringify({ ship: r.ship, manual: W.state.manual }));
    ok((await call("/api/prs/ship/undo", { pr: id22 })).status === 400, "a row production confirms has no undo");
    gh.data.contains[prodHead].pop(); clock -= 2 * 3600_000; await call("/api/prs/refresh", {}); v = (await call("/api/prs")).body;
    ok(merged(v, id22).tab === "merged" && W.state.shipped[k22]?.liveAt === null, "production no longer shows it: back on Merged (nothing left from the mark)"); }
  // later: 23 stays live with the day Studio first saw it; 21 reaches production
  const firstLive = r23.ship.liveAt;
  gh.data.contains[gh.data.head(gh.data.find("northwind/checkout-api", 18)!)].push(gh.data.merge(gh.data.find("northwind/checkout-api", 21)!));
  clock += 3 * 86400_000; await call("/api/prs/refresh", {}); v = (await call("/api/prs")).body;
  ok(merged(v, "northwind/checkout-api#23").ship.liveAt === firstLive && merged(v, "northwind/checkout-api#21").tab === "live", "the live day is the first refresh that saw it live; 21 moves to live when production has it");
  // 15 days after 23 went live: dropped, and never picked up again although GitHub still lists it
  clock += 12 * 86400_000 + 60_000; await call("/api/prs/refresh", {}); v = (await call("/api/prs")).body;
  ok(!merged(v, "northwind/checkout-api#23") && W.state.retired.includes("northwind/checkout-api#23") && !W.state.shipped["northwind/checkout-api#23"], "14 days after production the row is dropped and recorded as such", JSON.stringify(v.merged.map((r: any) => r.id)));
  ok(!!merged(v, "northwind/checkout-api#21"), "a row that went live later stays until its own 14 days");
  await call("/api/prs/refresh", {}); v = (await call("/api/prs")).body;
  ok(!merged(v, "northwind/checkout-api#23"), "a dropped row does not come back on the next refresh");
  // ---------- a merged row a merged revert cancels is dropped (by anyone, GitHub's own Revert output) ----------
  { const ca = "northwind/checkout-api", id = (n: number) => `${ca}#${n}`, more = gh.data.more;
    more(ca, 50, "Cache quotes for a minute", "skipper", { merged: true });
    more(ca, 52, "Tighter rate limit", "skipper", { merged: true });
    more(ca, 54, "Longer session timeout", "skipper", { merged: true });
    more(ca, 57, "Webhook signature v2", "skipper", { merged: true });
    await call("/api/prs/refresh", {}); v = (await call("/api/prs")).body;
    ok([50, 52, 54, 57].every((n) => !!merged(v, id(n))), "four more merged rows are followed before any revert", JSON.stringify(v.merged.map((r: any) => r.id)));
    // 50: someone else's merged pull request whose body says "Reverts <owner>/<repo>#50" (any case); 52: only the title
    more(ca, 51, "Undo the quote cache", "lee", { merged: true, body: "Reverts Northwind/Checkout-API#50\n\nIt served stale prices." });
    more(ca, 53, 'Revert "Tighter rate limit"', "lee", { merged: true });
    // 54: an open revert, a closed unmerged one, and a merged one naming the same number in another repository: nothing
    more(ca, 55, 'Revert "Longer session timeout"', "lee", { body: `Reverts ${ca}#54` });
    more(ca, 56, 'Revert "Longer session timeout"', "lee", { state: "closed", body: `Reverts ${ca}#54` });
    more(ca, 60, "Unrelated revert", "lee", { merged: true, body: "Reverts northwind/web-app#54" });
    // 57: reverted, and the revert reverted in turn (merged): the original stands
    more(ca, 58, 'Revert "Webhook signature v2"', "lee", { merged: true, body: `Reverts ${ca}#57` });
    more(ca, 59, 'Revert "Revert "Webhook signature v2""', "lee", { merged: true, body: `Reverts ${ca}#58` });
    const before = gh.calls.length;
    await call("/api/prs/refresh", {}); v = (await call("/api/prs")).body;
    ok(!merged(v, id(50)) && W.state.retired.includes(id(50)) && W.state.reverted?.[id(50)] === id(51) && !W.state.shipped[id(50)], "a row someone else's merged \"Reverts …#50\" cancels is dropped and recorded with the revert", JSON.stringify({ merged: v.merged.map((r: any) => r.id), reverted: W.state.reverted }));
    ok(!merged(v, id(52)) && W.state.reverted?.[id(52)] === id(53), "a merged revert with only the title Revert \"<exact title>\" drops the row", JSON.stringify(W.state.reverted));
    ok(!!merged(v, id(54)) && !W.state.retired.includes(id(54)), "an open or closed-unmerged revert, or one naming another repository, leaves the row");
    ok(!!merged(v, id(57)) && !W.state.retired.includes(id(57)), "a row whose revert was itself reverted by a merged pull request stays", JSON.stringify(W.state.reverted));
    ok(!gh.calls.slice(before).some((c) => /\/pulls\/(5[0-9]|60)$/.test(c.path)), "reverts are read from the closed pull requests already listed: no read of their own");
    await call("/api/prs/refresh", {}); v = (await call("/api/prs")).body;
    ok(!merged(v, id(50)) && !merged(v, id(52)) && !!merged(v, id(57)), "a reverted row does not come back on the next refresh"); }
  // ---------- only a pull request merged into a release base is followed (not a sub-pull-request into its umbrella) ----------
  { const ca = "northwind/checkout-api", id = (n: number) => `${ca}#${n}`, more = gh.data.more, umbrella = "feature/payments-rework";
    more(ca, 70, "Umbrella: payments rework", "skipper", { headRef: umbrella });
    more(ca, 71, "Payments: split the ledger writes", "skipper", { merged: true, base: umbrella });
    more(ca, 72, "Payments: a table for retries", "skipper", { merged: true, base: umbrella });
    await call("/api/prs/refresh", {}); v = (await call("/api/prs")).body;
    ok(!merged(v, id(71)) && !merged(v, id(72)) && W.snapshot.offBase?.[id(71)] === umbrella && W.snapshot.offBase?.[id(72)] === umbrella, "a sub-pull-request merged into its umbrella's branch is not followed, on neither tab", JSON.stringify({ merged: v.merged.map((r: any) => r.id), offBase: W.snapshot.offBase }));
    ok(!W.state.shipped[id(71)] && !W.state.shipped[id(72)] && !v.rows.some((r: any) => r.id === id(71) || r.id === id(72)), "nor recorded in state.json, nor an open row");
    ok(!!merged(v, id(21)) && !!merged(v, id(22)) && !W.snapshot.offBase?.[id(21)], "the pull requests merged into the default branch are still followed");
    // the umbrella merges into the default branch: it is the one on its way to production
    const u = gh.data.find(ca, 70)!; Object.assign(u, { state: "closed", merged: true, mergedAt: new Date(clock - 3600_000).toISOString() });
    await call("/api/prs/refresh", {}); v = (await call("/api/prs")).body;
    ok(merged(v, id(70))?.tab === "merged" && merged(v, id(70)).base === "main" && !!W.state.shipped[id(70)] && !merged(v, id(71)), "the umbrella merged into the default branch is followed; its sub-pull-requests still are not", JSON.stringify(v.merged.map((r: any) => r.id)));
    { // GitHub's answer without base.repo.default_branch: the repository is read once a refresh, and the rule holds
      gh.knobs.noDefaultBranch = true; const before = gh.calls.length; await call("/api/prs/refresh", {}); v = (await call("/api/prs")).body; gh.knobs.noDefaultBranch = false;
      const reads = gh.calls.slice(before).filter((c) => c.method === "GET" && c.path === `/repos/${ca}`).length;
      ok(reads === 1 && !merged(v, id(71)) && !!merged(v, id(70)) && W.snapshot.offBase?.[id(71)] === umbrella, "no default branch in the pull request: read from the repository once, sub-pull-requests still left out", `reads ${reads}`); }
    { // a state.json and snapshot saved by an older Studio that followed the sub-pull-requests: gone on the next refresh,
      // nothing else in state.json lost
      const old = mkdtempSync(join(tmpdir(), "pr-watch-merged-subpr-")); mkdirSync(join(old, "pr-watch"));
      const st = JSON.parse(readFileSync(join(dir, "pr-watch", "state.json"), "utf8")), sn = JSON.parse(readFileSync(join(dir, "pr-watch", "snapshot.json"), "utf8"));
      const k71 = id(71).toLowerCase(), k72 = id(72).toLowerCase(), row70 = sn.merged.find((r: any) => r.id === id(70));
      st.shipped[k71] = { id: id(71), mergedAt: row70.mergedAt, liveAt: null }; st.shipped[k72] = { id: id(72), mergedAt: row70.mergedAt, liveAt: new Date(clock - 60_000).toISOString() };
      (st.manual ??= {})[k72] = { id: id(72), at: new Date(clock - 60_000).toISOString() };
      sn.merged.push({ ...row70, id: id(71), number: 71, url: `https://github.com/${ca}/pull/71`, base: umbrella }, { ...row70, id: id(72), number: 72, url: `https://github.com/${ca}/pull/72`, base: umbrella });
      delete sn.offBase;
      writeFileSync(join(old, "pr-watch", "state.json"), JSON.stringify(st)); writeFileSync(join(old, "pr-watch", "snapshot.json"), JSON.stringify(sn));
      const poller4 = new GitHubPoller(), W4 = createPrWatch({ dataDir: old, poller: poller4, now: () => clock });
      try { const tabs = (w: typeof W4) => Object.fromEntries(w.view().merged.map((r: any) => [r.id, r.tab]));
        const t0 = tabs(W4);
        ok(t0[id(71)] === "merged" && t0[id(72)] === "live", "the saved state shows the sub-pull-requests before a refresh (as an older Studio left it)", JSON.stringify(t0));
        const u4 = new URL("http://127.0.0.1/api/prs/refresh"); await W4.handle(new Request(u4, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), u4, { kind: "desktop" }, true);
        ok(await until(() => !W4.snapshot.merged?.some((r: any) => r.id === id(71)), 15000) && !!W4.snapshot.offBase?.[id(71)], "the older Studio's saved state is refreshed", JSON.stringify(W4.snapshot.errors));
        const t1 = tabs(W4), after = JSON.parse(readFileSync(join(old, "pr-watch", "state.json"), "utf8"));
        ok(!t1[id(71)] && !t1[id(72)] && !after.shipped[k71] && !after.shipped[k72] && !after.manual?.[k72], "the next refresh drops them from both tabs and from state.json (followed and marked by hand)", JSON.stringify({ t1, shipped: Object.keys(after.shipped), manual: after.manual }));
        const rest = (x: any) => { const y = structuredClone(x); delete y.shipped[k71]; delete y.shipped[k72]; delete y.manual?.[k72]; return y; };
        ok(JSON.stringify(Object.keys(after).sort()) === JSON.stringify(Object.keys(st).sort()) && ["watch", "settings", "order", "deps", "groups", "retired", "reverted", "follow", "hooks"].every((key) => JSON.stringify(after[key]) === JSON.stringify(st[key]))
          && JSON.stringify(Object.keys(after.shipped).sort()) === JSON.stringify(Object.keys(rest(st).shipped).sort()) && JSON.stringify(after.manual ?? {}) === JSON.stringify(rest(st).manual ?? {}),
          "nothing else in state.json is lost: the watch list, settings, the other followed rows, retired and reverted ones stay", JSON.stringify({ before: Object.keys(rest(st).shipped), after: Object.keys(after.shipped) }));
        ok(t1[id(70)] === "merged" && t1[id(21)] === t0[id(21)] && t1[id(22)] === t0[id(22)], "the other merged rows stay on their tabs", JSON.stringify(t1)); }
      finally { W4.stop(); poller4.stop(); rmSync(old, { recursive: true, force: true }); } }
    { // a repository whose default branch is not main; a branch a production environment deploys counts as a release base
      const lg = "northwind/ledger", lid = (n: number) => `${lg}#${n}`; gh.data.defaultBranch[lg] = "develop";
      more(lg, 80, "Ledger: round half to even", "skipper", { merged: true, base: "develop" });
      more(lg, 81, "Ledger: merged into a branch named main", "skipper", { merged: true, base: "main" });
      more(lg, 82, "Ledger: hotfix on the release branch", "skipper", { merged: true, base: "release" });
      await call("/api/prs/watch", { url: `https://github.com/${lg}` });
      await call("/api/prs/refresh", {}); v = (await call("/api/prs")).body;
      ok(!!merged(v, lid(80)) && !merged(v, lid(81)) && W.snapshot.offBase?.[lid(81)] === "main" && !merged(v, lid(82)), "default branch develop: the one merged into develop is followed, one into main (not the default here) or release is not", JSON.stringify({ merged: v.merged.map((r: any) => r.id), offBase: W.snapshot.offBase }));
      const prodRelease = { name: "ledger-prod", production: true, repos: [lg], detect: { kind: "branch", branch: "release" } };
      ok((await call("/api/prs/settings", { settings: { ...fixtureSettings, environments: [...fixtureSettings.environments, prodRelease] } })).status === 200, "a production environment that deploys the ledger's release branch");
      await call("/api/prs/refresh", {}); v = (await call("/api/prs")).body;
      ok(!!merged(v, lid(82)) && !!merged(v, lid(80)) && !merged(v, lid(81)), "merged into the branch a production environment deploys: followed", JSON.stringify(v.merged.map((r: any) => r.id)));
      await call("/api/prs/settings", { settings: fixtureSettings }); await call("/api/prs/unwatch", { repo: lg }); await call("/api/prs/refresh", {}); v = (await call("/api/prs")).body;
      ok(!v.merged.some((r: any) => r.repo === lg) && !!merged(v, id(21)), "the ledger unwatched again: its rows gone, the others kept"); } }
  // ---------- × on a merged row: excluded, not followed again, restored on request ----------
  { const id = "northwind/checkout-api#21";
    ok((await call("/api/prs/unwatch", { pr: id })).status === 200, "× on a merged row");
    v = (await call("/api/prs")).body;
    ok(!merged(v, id) && v.watch.excluded.includes(id), "the merged row is dropped and recorded as excluded", JSON.stringify(v.watch.excluded));
    await call("/api/prs/refresh", {}); v = (await call("/api/prs")).body;
    ok(!merged(v, id), "an excluded merged row is not followed again on the next refresh");
    await call("/api/prs/restore", { pr: id }); await call("/api/prs/refresh", {}); v = (await call("/api/prs")).body;
    ok(!!merged(v, id) && !v.watch.excluded.length, "restore brings the merged row back", JSON.stringify(v.merged.map((r: any) => r.id))); }
  // ---------- a row marked by hand is dropped 14 days after the mark ----------
  { const id = "northwind/checkout-api#22", k = id.toLowerCase(), at = new Date(clock).toISOString();
    await call("/api/prs/ship/mark", { prs: [id] });
    clock += 14 * 86400_000 - 60_000; await call("/api/prs/refresh", {}); v = (await call("/api/prs")).body;
    ok(merged(v, id)?.ship.manual?.at === at, "13 days 23 hours after the mark it is still on Live", JSON.stringify(merged(v, id)?.ship));
    clock += 2 * 60_000; await call("/api/prs/refresh", {}); v = (await call("/api/prs")).body;
    ok(!merged(v, id) && W.state.retired.includes(k) && !W.state.shipped[k] && !W.state.manual?.[k], "14 days after the mark it is dropped and recorded, and the mark is gone", JSON.stringify(W.state.manual));
    await call("/api/prs/refresh", {}); v = (await call("/api/prs")).body;
    ok(!merged(v, id), "a dropped marked row does not come back on the next refresh"); }
  // ---------- a state.json written before marks existed loads ----------
  { const old = mkdtempSync(join(tmpdir(), "pr-watch-merged-old-")); mkdirSync(join(old, "pr-watch"));
    const st = JSON.parse(readFileSync(join(dir, "pr-watch", "state.json"), "utf8")); delete st.manual; delete st.reverted;
    writeFileSync(join(old, "pr-watch", "state.json"), JSON.stringify(st)); copyFileSync(join(dir, "pr-watch", "snapshot.json"), join(old, "pr-watch", "snapshot.json"));
    const W3 = createPrWatch({ dataDir: old, poller, now: () => clock });
    try { const before = W3.view().merged.map((r: any) => `${r.id}:${r.tab}`).join();
      ok(!!before && JSON.stringify(W3.state.manual) === "{}" && W3.view().merged.every((r: any) => r.ship.manual === null), "a state.json without marks loads: no row is marked", before);
      const id = W3.view().merged.find((r: any) => r.tab === "merged")?.id; const u = new URL("http://127.0.0.1/api/prs/ship/mark");
      const res = await W3.handle(new Request(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prs: [id] }) }), u, { kind: "desktop" }, true);
      ok(res!.status === 200 && W3.view().merged.find((r: any) => r.id === id)?.ship.manual && JSON.parse(readFileSync(join(old, "pr-watch", "state.json"), "utf8")).manual?.[String(id).toLowerCase()], "and a row can be marked there", String(id)); }
    finally { W3.stop(); rmSync(old, { recursive: true, force: true }); } }
  // unwatching the repository drops its merged rows too
  await call("/api/prs/unwatch", { repo: "northwind/checkout-api" }); v = (await call("/api/prs")).body;
  ok(!v.merged.length, "unwatching a repository drops its merged rows");
} catch (e: any) { ok(false, "the suite ran to its end", String(e?.stack || e)); }
finally { W.stop(); poller.stop(); gh.stop(); rmSync(dir, { recursive: true, force: true }); }
end();
