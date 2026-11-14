import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Pull requests (docs/units/pr-watch.md "Merged, until production"): a merged pull request stays on the list until it is
// in every production environment, then 14 days more. Against the fictional GitHub (tests/lib/pr-watch-github.ts): which
// merged pull requests are followed, each environment read against the merge commit (it is on when the commit it runs
// contains the merge commit), the merged and live tabs, the day a pull request is dropped, and that it never comes back.
//   bun tests/pr-watch-merged.ts
import { mkdtempSync, rmSync } from "node:fs";
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
  // unwatching the repository drops its merged rows too
  await call("/api/prs/unwatch", { repo: "northwind/checkout-api" }); v = (await call("/api/prs")).body;
  ok(!v.merged.length, "unwatching a repository drops its merged rows");
} catch (e: any) { ok(false, "the suite ran to its end", String(e?.stack || e)); }
finally { W.stop(); poller.stop(); gh.stop(); rmSync(dir, { recursive: true, force: true }); }
end();
