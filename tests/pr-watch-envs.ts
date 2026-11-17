import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Pull requests (docs/units/pr-watch.md "Find environments automatically"): proposing each watched repository's
// environments without typing, from its GitHub environments and a GitOps/config repository's manifests, against the
// fictional GitHub (tests/lib/pr-watch-github.ts, every name invented). The pure parts (environment names from GitHub
// and from paths, image names, manifest lines and their templates, the review table, the picks), one environment
// covering many repositories (each), old settings folded losslessly, then the module: discovery reads only, the
// ambiguous groups, the one Accept that saves, a refresh that uses what was accepted, the read budget and the rate limit.
//   bun tests/pr-watch-envs.ts
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { until, suite } from "./rt-harness";
import { GitHubPoller } from "../src/github-poller";
import { createPrWatch, cleanSettings, MAX_ENVS } from "../src/pr-watch";
import * as R from "../src/pr-watch-rules";
import * as E from "../src/pr-watch-envs";
import { prWatchGitHub, fixtureSettings, sha, addDeployConfig } from "./lib/pr-watch-github";

const { ok, end } = suite("pr-watch-envs");
const J = (v: unknown) => JSON.stringify(v);

// ---------- names: from GitHub environments and from paths ----------
{
  ok(E.envOfName("prod").name === "production" && E.envOfName("PRD").production && E.envOfName("production").name === "production", "prod, prd and production are one environment, production");
  ok(E.envOfName("stg").name === "staging" && !E.envOfName("stg").production && E.envOfName("preproduction").name === "preprod" && !E.envOfName("preproduction").production, "stg is staging; preproduction is preprod, not production");
  ok(E.envOfName("eu-west").name === "eu-west" && !E.envOfName("eu-west").production && E.envOfName("production-eu").production, "an unknown name stays as it is; a production- prefix is production");
  const p = (x: string) => E.envOfPath(x)?.name ?? null;
  ok(p("apps/shop/overlays/prod/deployment.yaml") === "production" && p("envs/stg/shop.yaml") === "staging" && p("charts/shop/values-dev.yaml") === "dev", "a directory or a file name part names the environment");
  ok(p("envs/pre-prod/shop.yaml") === "preprod" && p("envs/nonprod/shop.yaml") === null && p("apps/shop/base/deployment.yaml") === null, "pre-prod is not prod; nonprod and base name none");
  ok(p("prod/apps/shop/overlays/staging/x.yaml") === "staging", "the deepest segment that names an environment wins");
  ok(p("staging/live-feed/deployment.yaml") === "staging" && p("prod/test-runner/values.yaml") === "production" && p("envs/nonprod-staging/app.yaml") === "staging", "a name that is exactly an environment wins over a service named live-feed or test-runner; non-prod drops only itself");
  ok(E.envOfPath("apps/live-feed/overlays/x.yaml", ["acme/live-feed"]) === null && E.envOfPath("apps/live-feed/overlays/x.yaml")?.name === "production", "a directory named after a watched repository is no environment");
  ok(E.envOfPath("charts/shop-api/values-shop-api-prod.yaml", ["acme/shop-api"])?.name === "production" && E.envOfPath("envs/shop_api-staging.yaml", ["acme/shop-api"])?.name === "staging", "a repository's name is taken out of a name, the rest still names the environment");
  ok(E.envOfName("eu-prod").production && E.envOfName("eu-prod").name === "eu-prod" && E.envOfName("production-eu").production && !E.envOfName("eu-preprod").production && !E.envOfName("nonprod-eu").production && !E.envOfName("eu-west").production, "a GitHub environment's name is production as a path part would be: eu-prod is, eu-preprod and nonprod-eu are not");
}
// ---------- images ----------
{
  ok(E.imageMatch("registry.example/shop-api", "acme/shop-api") === "strong" && E.imageMatch("registry.example:5000/team/shop_api", "acme/Shop-API") === "strong", "the image's name is the repository's (case, - _ . ignored; the host is no name)");
  ok(E.imageMatch("registry.example/shop-api/server", "acme/shop-api") === "strong", "a path part naming the repository is a strong match");
  ok(E.imageMatch("registry.example/shop-api-worker", "acme/shop-api") === "weak" && E.imageMatch("registry.example/shop", "acme/shop-api") === "weak", "one name holding the other is weak");
  ok(E.imageMatch("registry.example/web", "acme/web-app") === null && E.imageMatch("registry.example/billing", "acme/shop-api") === null, "short or different names do not match");
}
// ---------- manifest lines and their templates ----------
{
  const c = sha("x").slice(0, 12);
  const a = E.scanManifest(`spec:\n  containers:\n    - name: app\n      image: "registry.example/shop-api:v1.4.0-${c}" # pinned\n    - image: registry.example/sidecar:1.0\n`, "acme/shop-api");
  ok(a.length === 1 && a[0].template === 'image: "registry.example/shop-api:{tag}"' && a[0].line === 4 && a[0].tag === `v1.4.0-${c}` && a[0].problem === null && a[0].strength === "strong", "an inline image: the template keeps the key and the closing quote, not the comment", J(a));
  ok(R.tagOf(`x\n      image: "registry.example/shop-api:v1.4.0-${c}" # pinned`, a[0].template) === `v1.4.0-${c}`, "and Studio's own reader finds the tag with it");
  const k = E.scanManifest(`images:\n  - name: registry.example/web-app\n    newTag: "${c}"\n  - name: registry.example/other\n    newTag: abc\n`, "acme/web-app");
  ok(k.length === 1 && k[0].template === 'newTag: "{tag}"' && k[0].line === 3 && !k[0].problem, "a kustomize images entry: the name on one line, newTag on the next", J(k));
  const second = E.scanManifest(`images:\n  - name: registry.example/other\n    newTag: ${sha("o").slice(0, 10)}\n  - name: registry.example/web-app\n    newTag: ${c}\n`, "acme/web-app");
  ok(second.length === 1 && second[0].problem === "not-first", "a template that would read another image's line first is never usable", J(second));
  const helm = E.scanManifest(`image:\n  repository: registry.example/ledger\n  tag: 1.2.0\n`, "acme/ledger");
  ok(helm.length === 1 && helm[0].template === "tag: {tag}" && helm[0].problem === "no-commit", "Helm values repository/tag: a tag that does not end in a commit cannot say which commit runs", J(helm));
  const tab = E.scanManifest(`image:\tregistry.example/shop-api:${c}\n`, "acme/shop-api");
  ok(tab.length === 1 && tab[0].problem === "control", "a line with a tab in its template cannot be picked (the settings would refuse it)", J(tab));
  ok(!E.scanManifest(`url: https://example.invalid/shop-api:8080\nname: shop-api\n`, "acme/shop-api").length && !E.scanManifest(`image: registry.example/shop-api@sha256:${"a".repeat(64)}\n`, "acme/shop-api").length, "an address or a digest is no tag template");
}
// ---------- one environment for many repositories (each), and old settings folded losslessly ----------
{
  const f = (path: string) => ({ kind: "file" as const, repository: "acme/deploy-config", path, template: "image: registry.example/x:{tag}" });
  const one: R.EnvSetting = { name: "production", production: true, repos: [], each: [{ repo: "acme/a", detect: f("a/prod.yaml") }, { repo: "acme/b", detect: { kind: "deployment", environment: "prod" } }] };
  ok(J(R.envsFor([one], "acme/a")[0].detect) === J(f("a/prod.yaml")) && R.envsFor([one], "acme/b")[0].detect.kind === "deployment" && !R.envsFor([one], "acme/c").length, "one environment, a detect per repository; a repository it does not name has none");
  const withDefault: R.EnvSetting = { ...one, detect: { kind: "check", name: "deploy/prod" } };
  ok(R.envsFor([withDefault], "acme/c")[0].detect.kind === "check" && R.envsFor([withDefault], "acme/a")[0].detect.kind === "file", "a repository's own detect wins over the environment's detect for the rest");
  const s = cleanSettings({ environments: [one] });
  ok(s.environments.length === 1 && s.environments[0].each!.length === 2 && !("detect" in s.environments[0]), "the settings take an environment with only per-repository detects", J(s.environments));
  let refused = 0; for (const bad of [{ name: "p", production: true, each: [{ repo: "acme/a", detect: f("a.yaml") }, { repo: "ACME/a", detect: f("b.yaml") }] },
    { name: "p", production: true, each: [{ repo: "nope", detect: f("a.yaml") }] }, { name: "p", production: true, each: [{ repo: "acme/a", detect: { kind: "file", repository: "acme/x", path: "../a", template: "a:{tag}" } }] },
    { name: "p", production: true, each: Array.from({ length: 61 }, (_, i) => ({ repo: `acme/r${i}`, detect: f("a.yaml") })) }, { name: "p", production: true }])
    try { cleanSettings({ environments: [bad] }); } catch { refused++; }
  ok(refused === 5, "refused: a repository twice, a bad repository, a bad path, over 60 repositories, no detect at all", String(refused));
  ok(cleanSettings({ environments: Array.from({ length: MAX_ENVS + 5 }, (_, i) => ({ name: `e${i}`, production: false, repos: [], detect: { kind: "check", name: `c${i}` } })) }).environments.length === MAX_ENVS && MAX_ENVS === 20, "at most 20 named environments (each covering many repositories)");

  // settings from before: one environment per repository
  const old: R.EnvSetting[] = [
    { name: "staging", production: false, repos: [], detect: { kind: "branch", branch: "staging" } },
    { name: "production", production: true, repos: ["acme/a"], detect: f("a/prod.yaml") },
    { name: "production", production: true, repos: ["acme/b", "acme/c"], detect: f("bc/prod.yaml") },
    { name: "canary", production: false, repos: ["acme/d"], detect: { kind: "check", name: "canary" } },
    // canary sits between these two for acme/d: folding would move production before canary for d, so it stays apart
    { name: "production", production: true, repos: ["acme/d"], detect: f("d/prod.yaml") },
    // a production that is not flagged production is another environment
    { name: "production", production: false, repos: ["acme/e"], detect: f("e/prod.yaml") },
  ];
  const merged = R.mergeEnvs(old);
  ok(merged.length === 5 && merged[1].name === "production" && J(merged[1].each!.map((x) => x.repo)) === J(["acme/a", "acme/b", "acme/c"]) && merged[1].repos.length === 0 && !merged[1].detect, "adjacent per-repository entries of one name fold into one environment with a detect per repository", J(merged));
  const view = (envs: R.EnvSetting[], repo: string) => J(R.envsFor(envs, repo).map((e) => [e.name, e.production, e.detect]));
  const oldView = (repo: string) => J(old.filter((e) => R.envApplies(e, repo)).map((e) => [e.name, e.production, e.detect]));
  ok(["acme/a", "acme/b", "acme/c", "acme/d", "acme/e", "acme/z"].every((r) => view(merged, r) === oldView(r)), "lossless: every repository sees the same environments, in the same order, with the same detects");
  ok(J(R.mergeEnvs(merged)) === J(merged) && J(cleanSettings({ environments: old }).environments) === J(merged), "folding twice changes nothing; the settings fold on the way in");
  // a repository listed twice in an old entry, and a fold past 60 repositories: what comes out passes the checks again
  const dup = cleanSettings({ environments: [{ name: "production", production: true, repos: ["acme/a", "ACME/a"], detect: f("a.yaml") }, { name: "production", production: true, repos: ["acme/b"], detect: f("b.yaml") }] });
  ok(J(cleanSettings(dup).environments) === J(dup.environments) && dup.environments[0].each!.length === 2, "a repository listed twice is kept once; the folded settings pass the checks again", J(dup.environments));
  const wide = Array.from({ length: 3 }, (_, k) => ({ name: "production", production: true, repos: Array.from({ length: 30 }, (_, i) => `acme/r${k}-${i}`), detect: f(`${k}.yaml`) }));
  const w = cleanSettings({ environments: wide });
  ok(w.environments.every((e) => (e.each?.length ?? 0) <= 60) && J(cleanSettings(w).environments) === J(w.environments) && w.environments.length === 2, "folding stops at 60 repositories in one environment", J(w.environments.map((e) => e.each?.length ?? e.repos.length)));
  const catchAll = R.mergeEnvs([{ name: "prod", production: true, repos: [], detect: { kind: "check", name: "a" } }, { name: "prod", production: true, repos: ["acme/a"], detect: { kind: "check", name: "b" } }]);
  ok(catchAll.length === 2, "an entry for every repository is never folded into (it would change what acme/a sees)");
}
// ---------- the review table and the picks ----------
{
  const c = sha("p").slice(0, 12), files: E.FileSeen[] = [
    { repository: "acme/deploy-config", ref: "main", path: "apps/shop-api/overlays/prod/deployment.yaml", text: `image: registry.example/shop-api:${c}\n` },
    { repository: "acme/deploy-config", ref: "main", path: "apps/shop-api/overlays/stg/deployment.yaml", text: `image: registry.example/shop-api:${c}\n` },
    { repository: "acme/deploy-config", ref: "main", path: "legacy/stg/shop-api.yaml", text: `  image: "registry.example/team/shop-api:${c}"\n` },
    { repository: "acme/deploy-config", ref: "main", path: "apps/shop-api/base/deployment.yaml", text: `image: registry.example/shop-api:${c}\n` }];
  const p = E.propose(["acme/shop-api"], [], [{ repo: "acme/shop-api", environment: "development", sha: sha("d"), ref: "main" }], files);
  const g = (env: string) => p.groups.find((x) => x.env === env)!;
  ok(g("production").state === "ok" && g("dev").state === "ok" && g("staging").state === "pick" && g("staging").candidates.length === 2, "one strong candidate: ticked; two files for staging: a pick", J(p.groups.map((x) => [x.env, x.state])));
  ok(p.envs.map((e) => e.name).join() === "dev,staging,production" && p.envs.find((e) => e.name === "production")!.production, "the environments in the usual order, production flagged");
  ok(p.skipped.length === 1 && p.skipped[0].path.endsWith("base/deployment.yaml"), "a file naming the image under no environment is listed as skipped");
  ok(g("production").candidates[0].evidence.url === "https://github.com/acme/deploy-config/blob/main/apps/shop-api/overlays/prod/deployment.yaml#L1", "the evidence links the very line on GitHub");
  const current: R.EnvSetting[] = [{ name: "production", production: true, repos: [], each: [{ repo: "acme/shop-api", detect: g("production").candidates[0].detect }] }, { name: "dev", production: false, repos: [], detect: { kind: "check", name: "dev" } }];
  const again = E.propose(["acme/shop-api"], current, [{ repo: "acme/shop-api", environment: "development", sha: null, ref: null }], files);
  ok(again.groups.find((x) => x.env === "production")!.state === "set" && again.groups.find((x) => x.env === "dev")!.state === "pick", "already detected that way: set; detected another way by hand: a pick (never replaced unasked)");

  // an environment already set as prod: the proposal uses that name, Accept adds no second production
  const asProd: R.EnvSetting[] = [{ name: "prod", production: true, repos: [], each: [{ repo: "acme/b", detect: { kind: "check", name: "b" } }] }];
  const pp = E.propose(["acme/a", "acme/b"], asProd, [{ repo: "acme/a", environment: "production", sha: null, ref: null }, { repo: "acme/b", environment: "prd", sha: null, ref: null }], []);
  const ga = pp.groups.find((x) => x.repo === "acme/a")!, gb = pp.groups.find((x) => x.repo === "acme/b")!;
  ok(ga.env === "prod" && ga.state === "ok" && gb.env === "prod" && gb.state === "pick" && gb.current?.kind === "check" && J(pp.envs.map((e) => [e.name, e.existing])) === J([["prod", true]]), "a GitHub production next to a set prod: proposed as prod (acme/b, set another way, needs a pick)", J(pp));
  const after = E.applyPicks(asProd, [{ repo: "acme/a", env: ga.env, detect: ga.candidates[0].detect }], { prod: true });
  ok(after.length === 1 && after[0].name === "prod" && after[0].each!.length === 2, "Accept puts it in prod: one production environment, not two", J(after));
  const catchAllProd = E.propose(["acme/a"], [{ name: "prod", production: true, repos: [], detect: { kind: "check", name: "p" } }], [{ repo: "acme/a", environment: "production", sha: null, ref: null }], []);
  ok(catchAllProd.groups[0].env === "prod" && catchAllProd.groups[0].state === "pick", "a prod that detects every repository one way: a pick, never a second environment");
  const envs: R.EnvSetting[] = [{ name: "dev", production: false, repos: [], detect: { kind: "check", name: "dev" } }, { name: "production", production: true, repos: [], each: [{ repo: "acme/a", detect: { kind: "check", name: "old" } }] }];
  const out = E.applyPicks(envs, [{ repo: "acme/a", env: "production", detect: { kind: "check", name: "new" } }, { repo: "acme/b", env: "production", detect: { kind: "check", name: "b" } }, { repo: "acme/a", env: "staging", detect: { kind: "check", name: "s" } }], { staging: false });
  ok(out.map((e) => e.name).join() === "dev,staging,production" && J(out[2].each) === J([{ repo: "acme/a", detect: { kind: "check", name: "new" } }, { repo: "acme/b", detect: { kind: "check", name: "b" } }]), "a pick replaces the repository's detect in that environment, adds another, and a new name goes in the usual order", J(out));
  ok(J(envs[1].each) === J([{ repo: "acme/a", detect: { kind: "check", name: "old" } }]), "the settings given are not changed in place");
  const two: R.EnvSetting[] = [{ name: "production", production: true, repos: [], each: [{ repo: "acme/a", detect: { kind: "check", name: "a" } }] }, { name: "production", production: false, repos: ["acme/e"], detect: { kind: "check", name: "e" } }];
  const t2 = E.applyPicks(two, [{ repo: "acme/b", env: "production", detect: { kind: "check", name: "b" } }], { production: true });
  ok(t2[0].each!.length === 2 && t2[1].production === false && !t2[1].each, "a second environment of the same name (another production flag) is left as it is");
}

// ---------- the module against the fictional GitHub ----------
const gh = prWatchGitHub(), D = gh.data, ca = "northwind/checkout-api", cfg = "northwind/deploy-config";
addDeployConfig(D);
process.env.CREW_GITHUB_API = gh.origin; process.env.CREW_GITHUB_TOKEN = "fixture-token"; process.env.CREW_GH_NO_CLI = "1"; process.env.CREW_GH = "0"; delete process.env.CREW_PR_WATCH;
const dir = mkdtempSync(join(tmpdir(), "pr-watch-envs-")), poller = new GitHubPoller();
const make = (dataDir: string, limits?: any) => createPrWatch({ dataDir, poller, ...(limits ? { limits } : {}) });
const W = make(dir);
const callOn = (w: ReturnType<typeof make>) => async (path: string, body?: unknown) => { const url = new URL(`http://127.0.0.1${path}`), writing = body !== undefined;
  const r = await w.handle(new Request(url, writing ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}), url, { kind: "desktop" }, writing); return { status: r!.status, body: await r!.json() }; };
const call = callOn(W);
const writes = () => gh.calls.filter((c) => c.method !== "GET" && c.path !== "/graphql");
try {
  for (const u of ["https://github.com/northwind/checkout-api", "https://github.com/northwind/web-app", "https://github.com/northwind/ledger"]) await call("/api/prs/watch", { url: u });
  await until(() => !!W.snapshot.at, 15000);
  const stateBefore = readFileSync(join(dir, "pr-watch", "state.json"), "utf8"), before = gh.calls.length;

  // no config repository named: GitHub environments only, and config repositories offered by name
  const bare = await call("/api/prs/envs/discover", {});
  ok(bare.status === 200 && bare.body.config === null && J(bare.body.configSuggestions) === J([cfg, "northwind/cluster-ops"]), "no config repository named: repositories that look like one are offered (not a watched one, not notes)", J(bare.body.configSuggestions));
  ok(J(bare.body.groups.map((g: any) => `${g.repo}|${g.env}|${g.state}`)) === J([`${ca}|dev|ok`, `${ca}|staging|ok`, `${ca}|preprod|ok`]), "checkout-api's GitHub environments with a deployment: dev, staging, preproduction (as preprod); production has none", J(bare.body.groups.map((g: any) => [g.repo, g.env, g.state])));

  // the config repository named
  const v = (await call("/api/prs/envs/discover", { config: cfg })).body, G = (repo: string, env: string) => v.groups.find((g: any) => g.repo === repo && g.env === env);
  ok(J(v.config) === J({ repository: cfg, ref: "main" }), "the config repository is read at its default branch");
  const prod = G(ca, "production");
  ok(prod?.state === "ok" && prod.candidates.length === 1 && J(prod.candidates[0].detect) === J({ kind: "file", repository: cfg, path: "apps/checkout-api/overlays/prod/deployment.yaml", template: "image: registry.example/checkout-api:{tag}" })
    && prod.candidates[0].evidence.line === 6 && prod.candidates[0].evidence.url === `https://github.com/${cfg}/blob/main/apps/checkout-api/overlays/prod/deployment.yaml#L6`, "checkout-api production: the manifest line, its template, its path and line, ticked", J(prod));
  ok(G(ca, "staging")?.state === "pick" && J(G(ca, "staging").candidates.map((c: any) => c.source)) === J(["deployment", "file"]), "checkout-api staging: a GitHub deployment and a manifest: the captain picks");
  ok(G(ca, "dev")?.state === "ok" && G(ca, "preprod")?.state === "ok", "dev and preprod from GitHub deployments only: ticked");
  ok(G("northwind/web-app", "production")?.state === "ok" && G("northwind/web-app", "production").candidates[0].detect.template === 'newTag: "{tag}"', "web-app production: a kustomize newTag");
  ok(G("northwind/web-app", "staging")?.state === "pick" && G("northwind/web-app", "staging").candidates.length === 2, "web-app staging: two manifests name it: a pick");
  const lg = G("northwind/ledger", "production");
  ok(lg?.state === "pick" && lg.candidates.some((c: any) => c.problem === "no-commit") && lg.candidates.some((c: any) => c.strength === "weak"), "ledger production: a tag with no commit and a weak match (ledger-tools): never ticked", J(lg));
  ok(v.skipped.some((x: any) => x.path === "apps/checkout-api/base/deployment.yaml") && !v.groups.some((g: any) => g.candidates.some((c: any) => c.evidence.path?.endsWith("README.md"))), "a base manifest is skipped (no environment); a README is not read");
  ok(J(v.envs.map((e: any) => [e.name, e.production])) === J([["dev", false], ["staging", false], ["preprod", false], ["production", true]]), "the environments, production flagged", J(v.envs));
  ok(!writes().length && readFileSync(join(dir, "pr-watch", "state.json"), "utf8") === stateBefore, "looking writes nothing: no GitHub write, the settings file unchanged");
  ok(gh.calls.slice(before).every((c) => c.method === "GET" || c.path === "/graphql"), "every discovery read is a GET (a refresh still running may query GraphQL)");
  ok(v.reads > 0 && v.reads <= v.budget && v.budget === 300, "the reads are counted against the budget", `${v.reads}/${v.budget}`);

  // Accept: the ticked ones and the picks, one environment per name
  const pick = (g: any, i = 0) => ({ repo: g.repo, env: g.env, detect: g.candidates[i].detect });
  const picks = [...v.groups.filter((g: any) => g.state === "ok").map((g: any) => pick(g)), pick(G(ca, "staging"), 1)];
  const base = W.view().settings;
  const stale = await call("/api/prs/envs/accept", { picks, production: { production: true }, config: { repository: cfg, ref: "" }, base: { ...base, groups: ["changed"] } });
  ok(stale.status === 400 && /changed while this dialog was open/.test(stale.body.error), "an Accept from a dialog opened before another change is refused", J(stale.body));
  const acc = await call("/api/prs/envs/accept", { picks, production: { production: true, preprod: false }, config: { repository: cfg, ref: "" }, base });
  ok(acc.status === 200, "Accept saves", J(acc.body).slice(0, 300));
  const envs = W.state.settings.environments;
  ok(J(envs.map((e) => e.name)) === J(["dev", "staging", "preprod", "production"]) && envs.every((e) => !e.detect && e.each?.length), "one environment per name, each with a detect per repository", J(envs.map((e) => [e.name, e.each?.length])));
  ok(J(envs.find((e) => e.name === "production")!.each!.map((x) => x.repo)) === J([ca, "northwind/web-app"]) && envs.find((e) => e.name === "production")!.production, "production covers checkout-api and web-app; ledger (unpicked) is left out");
  ok(R.envsFor(envs, ca).find((e) => e.name === "staging")!.detect.kind === "file", "the pick decides: checkout-api staging reads the manifest");
  ok(J(W.state.envConfig) === J({ repository: cfg, ref: null }) && W.view().envConfig?.repository === cfg, "the config repository is remembered for next time");
  ok(!writes().length, "accepting writes nothing to GitHub");

  // the next refresh uses them: #23's merge commit is in the production manifest's tag
  const at0 = W.snapshot.at; await call("/api/prs/refresh", {}); await until(() => W.snapshot.at !== at0, 15000);
  const r23 = W.view().merged.find((r: any) => r.id === `${ca}#23`), r18 = W.view().rows.find((r: any) => r.id === `${ca}#18`);
  ok(r23?.tab === "live" && r23.envs.find((e: any) => e.name === "production")?.on === true, "a refresh reads production from the accepted manifest: #23 is live", J(r23?.envs));
  ok(r18?.envs.find((e: any) => e.name === "production")?.on === true, "and an open row whose head the manifest's tag names runs in production", J(r18?.envs));
  const third = (await call("/api/prs/envs/discover", {})).body;
  ok(third.configSuggestions[0] === cfg, "the remembered config repository is offered first");
  const again = (await call("/api/prs/envs/discover", { config: cfg })).body;
  ok(again.groups.find((g: any) => g.repo === ca && g.env === "production")?.state === "set", "searching again: what is accepted reads as already set");

  // refused input
  ok((await call("/api/prs/envs/discover", { config: "not a repo" })).status === 400 && (await call("/api/prs/envs/discover", { config: cfg, ref: "../x" })).status === 400, "a config repository that is not owner/repo, or a ref with .., is refused");
  ok((await call("/api/prs/envs/accept", { picks: [], production: {}, base: W.view().settings })).status === 400, "nothing ticked: nothing to accept");
  ok((await call("/api/prs/envs/accept", { picks: [{ repo: ca, env: "production", detect: { kind: "file", repository: cfg, path: "a/../b", template: "x:{tag}" } }], base: W.view().settings })).status === 400, "a pick is checked like any setting");
  ok(W.tools.list().every((t: any) => !/env/.test(t.name)), "the board alone looks and accepts (no agent CLI tool for it)");

  // the budget: a search stops at its reads and says so; a rate limit fails it
  { const d2 = mkdtempSync(join(tmpdir(), "pr-watch-envs-budget-")), W2 = make(d2, { discoverReads: 6, discoverFiles: 2 }), c2 = callOn(W2);
    await c2("/api/prs/watch", { url: "https://github.com/northwind/checkout-api" }); await c2("/api/prs/watch", { url: "https://github.com/northwind/web-app" });
    await until(() => !!W2.snapshot.at && !W2.view().refreshing, 15000); // the refresh the watch started is over: every call after is the search's
    const n0 = gh.calls.length, b2 = (await c2("/api/prs/envs/discover", { config: cfg })).body;
    const used = gh.calls.length - n0;
    ok(b2.over === true && b2.reads === 6 && used === 6, "past its budget the search reads no more", `${b2.reads} reads, ${used} calls`);
    ok(b2.notes.some((n: any) => /stopped after 6 reads/.test(n.en)) && b2.notes.some((n: any) => /Studio read the 2 most likely/.test(n.en)), "and says so: the reads and the files left out", J(b2.notes));
    ok(Array.isArray(b2.groups) && b2.groups.some((g: any) => g.env === "production"), "what was read is still proposed (the most likely manifests first)", J(b2.groups.map((g: any) => [g.repo, g.env])));
    gh.knobs.treeTruncated = true;
    const W3 = make(d2), b3 = (await callOn(W3)("/api/prs/envs/discover", { config: cfg })).body; gh.knobs.treeTruncated = false;
    ok(b3.notes.some((n: any) => /folder by folder/.test(n.en)) && b3.groups.some((g: any) => g.repo === ca && g.env === "production"), "a tree GitHub truncated is walked folder by folder instead, and says so");
    W3.stop();
    gh.setRateLimited(true); const rl = await c2("/api/prs/envs/discover", { config: cfg }); gh.setRateLimited(false);
    ok(rl.status === 400 && /rate limit/i.test(rl.body.error), "a rate limit fails the search with a message", J(rl.body));
    W2.stop(); }
  // a config repository too large to list at once: walked folder by folder within the budget
  { const d5 = mkdtempSync(join(tmpdir(), "pr-watch-envs-big-")), W5 = createPrWatch({ dataDir: d5, poller: new GitHubPoller() }); await callOn(W5)("/api/prs/watch", { url: "https://github.com/northwind/checkout-api" }); await callOn(W5)("/api/prs/watch", { url: "https://github.com/northwind/web-app" });
    await until(() => !!W5.snapshot.at && !W5.view().refreshing, 15000);
    gh.knobs.treeTooBig = true; const n0 = gh.calls.length, b5 = (await callOn(W5)("/api/prs/envs/discover", { config: cfg })).body;
    const walks = gh.calls.slice(n0).filter((c) => c.path.includes("/git/trees/") && !c.path.includes("recursive"));
    ok(b5.groups.find((g: any) => g.repo === ca && g.env === "production")?.state === "ok" && b5.groups.find((g: any) => g.repo === "northwind/web-app" && g.env === "production")?.state === "ok", "over 1 MB: the same manifests are found by walking the folders", J(b5.groups.map((g: any) => [g.repo, g.env, g.state])));
    ok(walks.length > 1 && !walks.some((c) => c.path.includes("README")) && b5.notes.some((n: any) => /too large for GitHub to list at once, so Studio walked it folder by folder/.test(n.en)), "one read per folder, and it says so", J(b5.notes));
    const W6 = make(d5, { discoverDirs: 2 }), b6 = (await callOn(W6)("/api/prs/envs/discover", { config: cfg })).body; gh.knobs.treeTooBig = false;
    ok(b6.notes.some((n: any) => /\(2 folders, .*more were not looked at/.test(n.en)), "past its folder budget the walk stops and says how many were left", J(b6.notes));
    // a branch with a slash goes in a query; the tree is read at the commit it points at
    const n1 = gh.calls.length; await callOn(W5)("/api/prs/envs/discover", { config: cfg, ref: "release/v1" });
    const after = gh.calls.slice(n1).map((c) => c.path);
    ok(after.some((x) => x === `/repos/${cfg}/commits?sha=release%2Fv1&per_page=1`) && after.some((x) => new RegExp(`^/repos/${cfg}/git/trees/[0-9a-f]{40}\\?recursive=1$`).test(x)) && !after.some((x) => x.includes("%2F") && x.includes("/git/trees/")), "a branch named release/v1 is resolved to its commit first", J(after.filter((x) => x.includes(cfg))));
    // a folder layer that names neither a repository nor an environment (a region, a cluster) is still walked
    gh.knobs.treeTooBig = true; D.files["northwind/cluster-config/clusters/us-east-1/checkout-api/prod.yaml"] = `image: registry.example/checkout-api:${sha("cl").slice(0, 12)}\n`;
    const b7 = (await callOn(W5)("/api/prs/envs/discover", { config: "northwind/cluster-config", deployments: false })).body; gh.knobs.treeTooBig = false;
    ok(b7.groups?.find((g: any) => g.repo === ca && g.env === "production")?.candidates[0]?.evidence.path === "clusters/us-east-1/checkout-api/prod.yaml", "a region folder between clusters/ and the service is walked too", J(b7.groups ?? b7));
    // a config repository that cannot be read at all fails the search, as a rate limit does
    const bad = await callOn(W5)("/api/prs/envs/discover", { config: "northwind/no-such-config" });
    ok(bad.status === 400 && /northwind\/no-such-config/.test(bad.body.error), "a config repository that cannot be read fails the search with why", J(bad.body));
    // closing the dialog mid-scan cancels the search: the next one starts at once
    const first = callOn(W5)("/api/prs/envs/discover", { config: cfg }), cancel = await callOn(W5)("/api/prs/envs/cancel", {}), r1 = await first;
    const r2 = await callOn(W5)("/api/prs/envs/discover", { config: cfg });
    ok(cancel.body.running === true && r1.body.cancelled === true && r2.status === 200 && Array.isArray(r2.body.groups), "a cancelled search ends; the next one runs", J([cancel.body, r1.body.cancelled, r2.status]));
    // a branch the captain named is kept in the detect: Accept saves it, and a refresh reads that branch
    const rb = (await callOn(W5)("/api/prs/envs/discover", { config: cfg, ref: "release/v1" })).body, gp = rb.groups.find((g: any) => g.repo === ca && g.env === "production");
    ok(gp?.candidates[0]?.detect.ref === "release/v1" && rb.groups.find((g: any) => g.repo === ca && g.env === "dev")?.candidates[0]?.detect.ref === undefined, "a manifest found on a named branch keeps it in its detect", J(gp));
    const n5 = gh.calls.length; // Accept starts a refresh itself
    const acc5 = await callOn(W5)("/api/prs/envs/accept", { picks: [{ repo: ca, env: gp.env, detect: gp.candidates[0].detect }], base: W5.view().settings });
    ok(acc5.status === 200 && R.envsFor(W5.state.settings.environments, ca).find((e) => e.name === "production")?.detect.ref === "release/v1", "Accept saves the branch", J(acc5.body).slice(0, 200));
    await until(() => gh.calls.slice(n5).some((c) => c.path.includes("/contents/apps/checkout-api/overlays/prod/deployment.yaml?ref=")), 15000);
    ok(gh.calls.slice(n5).some((c) => c.path === `/repos/${cfg}/contents/apps/checkout-api/overlays/prod/deployment.yaml?ref=release%2Fv1`), "the next refresh reads the manifest on that branch");
    const again5 = (await callOn(W5)("/api/prs/envs/discover", { config: cfg, ref: "release/v1" })).body;
    ok(again5.groups.find((g: any) => g.repo === ca && g.env === "production")?.state === "set", "searching that branch again: already set");
    W5.stop(); W6.stop(); }

  // an old state.json (one environment per repository) loads folded, every repository seeing what it saw
  { const d4 = mkdtempSync(join(tmpdir(), "pr-watch-envs-old-")); mkdirSync(join(d4, "pr-watch"), { recursive: true });
    const oldEnvs = [...fixtureSettings.environments.slice(0, 3),
      { name: "prod", production: true, repos: [ca], detect: { kind: "file", repository: "northwind/infra", path: "deploy/prod.yaml", template: "image: registry.example/checkout:{tag}" } },
      { name: "prod", production: true, repos: ["northwind/web-app"], detect: { kind: "deployment", environment: "production" } }];
    writeFileSync(join(d4, "pr-watch", "state.json"), J({ schema: 1, settings: { ...fixtureSettings, environments: oldEnvs }, watch: { repos: [ca, "northwind/web-app"], prs: [], excluded: [] }, order: null, deps: {}, applied: {}, groups: {}, shipped: {}, retired: [] }));
    const W4 = make(d4), s4 = W4.state.settings.environments;
    ok(!W4.view().settingsWarning && s4.length === 4 && s4[3].name === "prod" && s4[3].each?.length === 2, "an old settings file loads with nothing dropped: the two prod entries are one environment", J(s4));
    ok([ca, "northwind/web-app", "northwind/ledger"].every((r) => J(R.envsFor(s4, r).map((e) => [e.name, e.detect])) === J(oldEnvs.filter((e: any) => R.envApplies(e, r)).map((e: any) => [e.name, e.detect]))), "every repository sees the environments it saw before");
    W4.stop(); }
} finally { W.stop(); poller.stop?.(); gh.stop(); }
end();
