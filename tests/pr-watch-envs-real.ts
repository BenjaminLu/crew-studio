import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Pull requests (docs/units/pr-watch.md "Find environments automatically"), against a config repository laid out as real
// GitOps repositories often are (tests/lib/pr-watch-github.ts addRealLayout; every name invented): a folder narrowed to,
// <service>/overlays/<prefix>-<environment>/ folders, service and image names unlike the repositories', one repository
// deployed as three services, every tag shape (version-sha, branch-sha, bare sha, version-only), and who builds an image
// told by the commit in its tag, the repository's git tags and its CI config (Drone, GitHub Actions), together; proofs
// that disagree are a pick. Then live: every service's manifest must run a merge, and a version-only tag resolves
// through the repository's git tags.
//   bun tests/pr-watch-envs-real.ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { until, suite } from "./rt-harness";
import { GitHubPoller } from "../src/github-poller";
import { createPrWatch } from "../src/pr-watch";
import * as R from "../src/pr-watch-rules";
import * as E from "../src/pr-watch-envs";
import { prWatchGitHub, addRealLayout, ME, sha } from "./lib/pr-watch-github";

const { ok, end } = suite("pr-watch-envs-real");
const J = (v: unknown) => JSON.stringify(v);

// ---------- the pure parts ----------
{
  const p = (x: string) => E.envOfPath(x)?.name ?? null;
  ok(p("deploy/storefront/overlays/cluster-prod/flux-patch.yaml") === "production" && p("deploy/storefront/overlays/k8s-staging/flux-patch.yaml") === "staging" && p("deploy/storefront/overlays/gke-production/flux-patch.yaml") === "production" && p("deploy/storefront/overlays/gke-staging/flux-patch.yaml") === "staging" && p("deploy/x/overlays/gke-development/flux-patch.yaml") === "dev" && p("deploy/x/overlays/production-eu1/a.yaml") === "production",
    "an environment folder with a prefix or suffix (cluster-prod, k8s-staging, gke-production, production-eu1) names it; development is dev");
  const k = E.imagesIn("images:\n  - name: app\n    newName: registry.example/acme/go-shop\n    newTag: 1.2.3-abcdef0\n");
  ok(k.length === 1 && k[0].image === "registry.example/acme/go-shop" && k[0].template === "newTag: {tag}", "kustomize newName/newTag: the image is the newName", J(k));
  ok(J(E.imagesIn("image: registry.example/acme/weatherd:9.9.9\n").map((x) => [E.imageKey(x.image), x.tag])) === J([["acme/weatherd", "9.9.9"]]), "the registry host is not part of an image's key");
  ok(E.versionTag("9.9.9") && E.versionTag("v1.0.0") && !E.versionTag("1.2.3-abcdef0") && !E.versionTag("fedcba98") && J(E.tagNames("9.9.9")) === J(["9.9.9", "v9.9.9"]), "a version-only tag, looked up with or without v");
  ok(R.commitOfTag("1.2.3-abcdef0") === "abcdef0" && R.commitOfTag("main-0123abcd") === "0123abcd" && R.commitOfTag("fedcba98") === "fedcba98" && R.commitOfTag("v2.0.1-a1b2c3d") === "a1b2c3d" && !R.commitOfTag("9.9.9"), "the tag shapes: version-sha, branch-sha, bare sha carry a commit; version-only does not");
  // what a repository's build config publishes
  const drone = E.publishedImages(".drone.yml", "steps:\n- name: publish\n  image: plugins/docker\n  settings:\n    registry: registry.example\n    repo: registry.example/acme/weatherd\n    tags:\n      - ${DRONE_TAG}\n      - latest\n");
  ok(J(drone.map((x) => [x.image, x.line])) === J([["registry.example/acme/weatherd", 6]]), "Drone: the docker plugin's repo (the plugin's own image and the tags are no image)", J(drone));
  const gha = E.publishedImages(".github/workflows/release.yml", "      - uses: docker/build-push-action@v5\n        with:\n          tags: |\n            ${{ env.REGISTRY }}/acme/shop-aggregator:${{ github.sha }}\n            ghcr.io/acme/shop-aggregator:latest\n      - uses: docker/metadata-action@v5\n        with:\n          images: registry.example/acme/shop-tools\n");
  ok(J(gha.map((x) => x.image)) === J(["acme/shop-aggregator", "ghcr.io/acme/shop-aggregator", "registry.example/acme/shop-tools"]), "GitHub Actions: build-push-action tags (a block, templated parts taken out) and metadata-action images", J(gha));
  const sh = E.publishedImages(".github/workflows/ci.yml", "      - run: |\n          docker build -t registry.example/acme/api:${GITHUB_SHA} -t registry.example/acme/api-worker:${GITHUB_SHA} .\n          docker push registry.example/acme/api:${GITHUB_SHA}\n");
  ok(J(sh.map((x) => x.image)) === J(["registry.example/acme/api", "registry.example/acme/api-worker"]), "docker build with two -t: a repository publishing several images", J(sh));
  ok(J(E.publishedImages("Dockerfile", 'FROM alpine\nLABEL org.opencontainers.image.title="weatherd"\n')) === J([{ image: "weatherd", line: 2, kind: "label" }]), "a Dockerfile's title label is kept as supporting evidence only");
  // a CI variable that stands for the repository is its name, not a hole
  ok(J(E.publishedImages(".github/workflows/b.yml", "      - run: docker build -t ghcr.io/${{ github.repository }}:${{ github.sha }} .\n      - run: docker push registry.example/acme/${{ github.event.repository.name }}-worker:latest\n", "acme/Tide-Api").map((x) => x.image)) === J(["ghcr.io/acme/tide-api", "registry.example/acme/tide-api-worker"])
    && J(E.publishedImages(".drone.yml", "    repo: registry.example/${DRONE_REPO}\n- run: docker build -t registry.example/acme/$DRONE_REPO_NAME:x .\n", "acme/tide").map((x) => x.image)) === J(["registry.example/acme/tide"]), "${{ github.repository }}, ${{ github.event.repository.name }}, ${DRONE_REPO} and $DRONE_REPO_NAME become the repository's name");
  // a manifest already set for one repository is not proposed for another; it is listed as left out, and why
  const setOne: R.EnvSetting[] = [{ name: "production", production: true, repos: [], each: [{ repo: "acme/a", detect: { kind: "file", repository: "acme/deploy", path: "deploy/x/overlays/cluster-prod/p.yaml", template: "image: registry.example/acme/x:{tag}" } }] }];
  const ps = E.propose(["acme/a", "acme/b"], setOne, [], [{ repository: "acme/deploy", ref: "main", path: "deploy/x/overlays/cluster-prod/p.yaml", text: "image: registry.example/acme/x:1.2.3-abcdef0\n" }], { owner: () => [{ repo: "acme/b", strength: "strong", signals: [] }], tagOk: () => true });
  ok(!ps.groups.length && J(ps.skipped) === J([{ path: "deploy/x/overlays/cluster-prod/p.yaml", why: "set-for", repos: ["acme/a"] }]), "a manifest already set for acme/a is not proposed for acme/b: left out, saying for whom", J(ps));
  ok(E.sameImage("registry.example/acme/go-shop", "other.example/acme/go-shop") && E.sameImage("acme/go-shop", "go-shop") && !E.sameImage("acme/go-shop", "acme/go-shops"), "the same image across registries, by path or its last segment");
  ok(E.nameScore("registry.example/acme/shop-aggregator", "acme/shop-router") > E.nameScore("registry.example/acme/shop-aggregator", "acme/weather-api") && E.nameScore("x/weather-server", "acme/weather-api") > 0, "names alike only order the repositories checked");
  // one repository in several manifests of one environment: one candidate that needs them all
  const files: E.FileSeen[] = ["storefront", "checkout-server"].map((s) => ({ repository: "acme/deploy", ref: "main", path: `deploy/${s}/overlays/gke-production/flux-patch.yaml`, text: `image: registry.example/acme/go-shop:1.2.3-abcdef0\n` }));
  const pr = E.propose(["acme/shop-monorepo"], [], [], files, { owner: () => [{ repo: "acme/shop-monorepo", strength: "strong", signals: [{ kind: "commit", sha: "abcdef0" }] }], tagOk: () => true });
  const g0 = pr.groups[0];
  ok(pr.groups.length === 1 && g0.state === "ok" && g0.candidates.length === 1 && g0.candidates[0].detect.kind === "files" && R.filesOf(g0.candidates[0].detect).length === 2 && g0.candidates[0].evidence.more?.length === 1, "a repository deployed as two services: one candidate reading both manifests", J(pr));
}

// ---------- the module ----------
const gh = prWatchGitHub(), D = gh.data, L = addRealLayout(D);
process.env.CREW_GITHUB_API = gh.origin; process.env.CREW_GITHUB_TOKEN = "fixture-token"; process.env.CREW_GH_NO_CLI = "1"; process.env.CREW_GH = "0"; delete process.env.CREW_PR_WATCH;
const dir = mkdtempSync(join(tmpdir(), "pr-watch-envs-real-")), W = createPrWatch({ dataDir: dir, poller: new GitHubPoller() });
const call = async (path: string, body?: unknown) => { const url = new URL(`http://127.0.0.1${path}`), writing = body !== undefined;
  const r = await W.handle(new Request(url, writing ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}), url, { kind: "desktop" }, writing); return { status: r!.status, body: await r!.json() }; };
try {
  for (const r of L.repos) await call("/api/prs/watch", { url: `https://github.com/${r}` });
  await until(() => !!W.snapshot.at && !W.view().refreshing, 15000);
  const n0 = gh.calls.length;
  const v = (await call("/api/prs/envs/discover", { config: L.cfg, path: "deploy", deployments: false })).body;
  const calls = gh.calls.slice(n0), G = (repo: string, env: string) => v.groups?.find((g: any) => g.repo === repo && g.env === env);
  ok(J(v.config) === J({ repository: L.cfg, ref: "main", path: "deploy" }), "the folder named narrows the scan", J(v.config ?? v));
  const mono = G("northwind/shop-monorepo", "production");
  ok(mono?.state === "ok" && mono.candidates[0].detect.kind === "files" && J(R.filesOf(mono.candidates[0].detect).map((f) => f.path.split("/")[1]).sort()) === J(["checkout-server", "profile-service", "storefront"]),
    "a monorepo whose image (go-shop) runs as three services: production reads all three manifests", J(mono));
  ok(mono?.candidates[0].evidence.signals?.some((s: any) => s.kind === "commit"), "proven by the commit in its tag, found in the repository");
  const router = G("northwind/shop-router", "production");
  ok(router?.state === "ok" && router.candidates[0].detect.path === "deploy/aggregator/overlays/cluster-prod/flux-patch.yaml" && router.candidates[0].evidence.signals?.some((s: any) => s.kind === "build" && s.path === ".github/workflows/build.yml") && router.candidates[0].evidence.signals?.some((s: any) => s.kind === "commit"),
    "an image named unlike its repository (shop-aggregator from shop-router): its GitHub Actions build-push tags and the branch-sha tag's commit", J(router));
  const mm = G("northwind/weather-api", "production");
  ok(mm?.state === "ok" && !mm.candidates[0].problem && mm.candidates[0].evidence.signals?.some((s: any) => s.kind === "tag" && s.tag === "2.4.1") && mm.candidates[0].evidence.signals?.some((s: any) => s.kind === "build" && s.path === ".drone.yml") && mm.candidates[0].evidence.signals?.some((s: any) => s.kind === "label"),
    "a version-only tag (2.4.1): the repository's git tag v2.4.1, its Drone config and its Dockerfile label, together", J(mm));
  ok(mono?.candidates.length === 2 && mono.candidates[1].problem === "not-first", "a second line naming the same image (an init container) is shown but does not make it a pick", J(mono?.candidates.map((c: any) => [c.detect.kind, c.problem])));
  ok(!mm?.candidates[0].evidence.signals?.some((s: any) => s.repo) && !G("northwind/orders", "production")?.candidates.some((c: any) => /weatherd/.test(c.evidence.text)), "a version number another repository also tags (orders has 2.4.1) is no proof against weather-api's CI config");
  ok(G("northwind/orders", "production")?.state === "ok" && G("northwind/orders-notifier", "production")?.state === "ok" && G("northwind/orders-notifier", "staging")?.state === "ok" && G("northwind/orders-notifier", "dev")?.state === "ok",
    "a version-sha tag (orders-server from orders) and a bare sha tag (orders-notifier) in production, staging and dev", J(v.groups?.map((g: any) => [g.repo, g.env, g.state])));
  const st = G("northwind/orders-notifier", "staging")?.candidates[0].evidence.signals ?? [], pd = G("northwind/orders-notifier", "production")?.candidates[0].evidence.signals ?? [];
  ok(J(st.filter((s: any) => s.kind === "commit").map((s: any) => s.sha)) === J([L.relay[1].slice(0, 8)]) && J(pd.filter((s: any) => s.kind === "commit").map((s: any) => s.sha)) === J([L.relay[0].slice(0, 8)]), "each cell shows the proof of its own tag only (staging's commit, not production's)", J([st, pd]));
  const mono0 = G("northwind/shop-monorepo", "production")?.candidates[0].evidence;
  ok([mono0, ...(mono0?.more ?? [])].every((e: any) => e.signals?.some((s: any) => s.kind === "commit")) && mono0?.more?.some((e: any) => e.signals.some((s: any) => s.sha === L.mono[1].slice(0, 7))), "in a several-service cell each manifest carries its own commit", J(mono0));
  const ws = [G("northwind/shop-router", "staging"), G("northwind/orders", "staging")];
  ok(ws[0]?.candidates[0].evidence.alsoFor?.[0] === "northwind/orders" && ws[1]?.candidates[0].evidence.alsoFor?.[0] === "northwind/shop-router", "the same line proposed for two repositories says so in each", J(ws.map((g) => g?.candidates[0].evidence.alsoFor)));
  ok(ws.every((g) => g?.state === "pick" && g.candidates[0].strength === "weak"), "an image the CI of one repository publishes but whose commit is in another: both a pick, never ticked", J(ws));
  ok(!v.groups?.some((g: any) => g.candidates.some((c: any) => /redis/.test(c.evidence.text))) && !v.groups?.some((g: any) => g.candidates.some((c: any) => /base\//.test(c.evidence.path ?? ""))), "a sidecar nobody watched builds, and a base manifest under no environment, are not proposed");
  ok(calls.every((c) => c.method === "GET" || c.path === "/graphql") && calls.filter((c) => c.path === "/graphql").length <= 10 && v.reads <= v.budget && v.budget === 600, "reads only; manifests and build configs come a few GraphQL reads at a time", `${calls.filter((c) => c.path === "/graphql").length} graphql, ${v.reads}/${v.budget}`);
  ok(!v.notes.length, "the folder's tree fits one answer: nothing to say", J(v.notes));

  // the whole repository is too large for one answer: walked folder by folder, and still found
  gh.knobs.treeTooBig = true;
  const big = (await call("/api/prs/envs/discover", { config: L.cfg, deployments: false })).body;
  const bigFolder = (await call("/api/prs/envs/discover", { config: L.cfg, path: "deploy", deployments: false })).body; gh.knobs.treeTooBig = false;
  ok(big.notes?.some((n: any) => /too large for GitHub to list at once, so Studio walked it folder by folder/.test(n.en)) && big.groups?.find((g: any) => g.repo === "northwind/shop-monorepo" && g.env === "production")?.state === "ok", "the whole tree over 1 MB: walked folder by folder (every folder), the same production found", J(big.notes));
  ok(!bigFolder.notes?.length && bigFolder.groups?.find((g: any) => g.repo === "northwind/shop-monorepo" && g.env === "production")?.state === "ok", "naming the folder reads it in one answer");
  // an answer over 1 MB is asked again in halves: nothing is lost
  gh.knobs.graphqlMaxObjects = 3; const split = (await call("/api/prs/envs/discover", { config: L.cfg, path: "deploy", deployments: false })).body; gh.knobs.graphqlMaxObjects = 0;
  ok(J(split.groups?.map((g: any) => [g.repo, g.env, g.state])) === J(v.groups.map((g: any) => [g.repo, g.env, g.state])) && !split.notes?.length, "GraphQL answers too large for one read are split in halves: the same table, nothing left out", J(split.notes));
  const tight = createPrWatch({ dataDir: dir, poller: new GitHubPoller(), limits: { discoverReads: 5 } }), tb = await tight.handle(new Request("http://127.0.0.1/api/prs/envs/discover", { method: "POST", body: J({ config: L.cfg, path: "deploy" }) }), new URL("http://127.0.0.1/api/prs/envs/discover"), { kind: "desktop" }, true).then((r) => r!.json());
  ok(tb.over && tb.reads === 5 && tb.notes.some((n: any) => /stopped after 5 reads/.test(n.en)), "a tight budget stops the search and says where", J(tb.notes));
  tight.stop();

  // Accept, then live: a merge is in production when every service's manifest runs it; a version-only tag resolves
  const picks = v.groups.filter((g: any) => g.state === "ok").map((g: any) => ({ repo: g.repo, env: g.env, detect: g.candidates[0].detect }));
  const pA = D.more("northwind/shop-monorepo", 7, "Order book cache", ME, { merged: true }), pB = D.more("northwind/weather-api", 3, "Faster quotes", ME, { merged: true });
  D.contains[L.mono[0]] = [D.merge(pA)]; D.contains[sha("weather-v2.4.1")] = [D.merge(pB)];
  const acc = await call("/api/prs/envs/accept", { picks, production: { production: true }, config: { repository: L.cfg, ref: "", path: "deploy" }, base: W.view().settings });
  ok(acc.status === 200 && W.state.envConfig?.path === "deploy", "Accept saves, the folder remembered", J(acc.body).slice(0, 200));
  const merged = async (id: string) => { const at = W.snapshot.at; await call("/api/prs/refresh", {}); await until(() => W.snapshot.at !== at && !W.view().refreshing, 15000); return W.view().merged.find((r: any) => r.id === id); };
  const a1 = await merged("northwind/shop-monorepo#7");
  ok(a1?.envs.find((e: any) => e.name === "production")?.on === false && a1.tab === "merged", "two of three services run the merge, profile-service does not yet: not live", J(a1?.envs));
  D.files[`${L.cfg}/deploy/profile-service/overlays/cluster-prod/flux-patch.yaml`] = D.files[`${L.cfg}/deploy/checkout-server/overlays/cluster-prod/flux-patch.yaml`];
  const a2 = await merged("northwind/shop-monorepo#7");
  ok(a2?.envs.find((e: any) => e.name === "production")?.on === true && a2.tab === "live", "all three run it: live", J(a2?.envs));
  const b1 = W.view().merged.find((r: any) => r.id === "northwind/weather-api#3");
  ok(b1?.envs.find((e: any) => e.name === "production")?.on === true && gh.calls.some((c) => c.path.startsWith("/repos/northwind/weather-api/tags")), "a version-only tag (2.4.1) is resolved through the git tag v2.4.1 to the commit that contains the merge", J(b1?.envs));
  // a tag that names no commit and no git tag (latest): the environment reads "not read", never off, with at most three
  // pages of git tags read for it a refresh
  const pC = D.more("northwind/orders", 9, "Order export", ME, { merged: true });
  D.files[`${L.cfg}/deploy/orders-server/overlays/cluster-prod/flux-patch.yaml`] = D.files[`${L.cfg}/deploy/orders-server/overlays/cluster-prod/flux-patch.yaml`].replace(/orders-server:\S+/, "orders-server:latest");
  const n9 = gh.calls.length, c1 = await merged("northwind/orders#9");
  ok(c1?.envs.find((e: any) => e.name === "production")?.on === null && gh.calls.slice(n9).filter((c) => c.path.startsWith("/repos/northwind/orders/tags")).length <= 3, "a tag like latest: production is not read (unknown), not off; the git tags read at most three pages", J(c1?.envs));
  ok(!gh.calls.some((c) => c.method !== "GET" && c.path !== "/graphql"), "nothing written to GitHub");
} finally { W.stop(); gh.stop(); }
end();
