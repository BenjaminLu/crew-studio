// A fictional GitHub for the Pull requests unit (docs/units/pr-watch.md): three repositories the captain watches
// (northwind/checkout-api, northwind/web-app, northwind/ledger), one it does not (northwind/platform-issues: issues only),
// an infrastructure repository holding the production image tag (northwind/infra), and a single watched pull request in
// northwind/mobile. Every name is invented. Only the GitHub REST/GraphQL shapes Studio reads are answered; anything else
// is a 404 and is recorded in `unknown`, every request in `calls`. One write is answered: PATCH of a pull request body.
import { createHash } from "node:crypto";

export const ME = "skipper";
export const sha = (s: string) => createHash("sha1").update(s).digest("hex");
const T0 = Date.parse("2026-11-01T08:00:00Z");
const at = (h: number) => new Date(T0 + h * 3600_000).toISOString();

type Pr = { repo: string; number: number; title: string; user: string; assignees?: string[]; draft?: boolean; state?: "open" | "closed"; merged?: boolean; base?: string; headRef?: string;
  body?: string; commits: { sha: string; at: string; login: string }[]; reviews?: { user: string; state: string; commit: string; at: string }[];
  comments?: { user: string; body: string; at: string }[]; files?: string[]; checks?: { name: string; conclusion: string; at: string }[]; labels?: string[];
  closing?: { repo: string; number: number; title: string; state: string }[]; timeline?: any[]; created: string;
  github?: { reviewDecision?: string | null; mergeState?: string; requested?: string[]; ci?: string; ciOnOlderHead?: boolean } };
const two = (n: string, h = 0) => [{ sha: sha(`${n}-1`), at: at(h), login: ME }, { sha: sha(`${n}-2`), at: at(h + 1), login: ME }];
const head = (p: Pr) => p.commits.at(-1)!.sha;

export function fixtureData() {
  const qa = (h: string) => ({ name: "deploy/qa", conclusion: "success", at: at(30) });
  const bot = (c: string) => ({ user: "review-bot", state: "COMMENTED", commit: c, at: at(20) });
  const prs: Pr[] = [];
  const add = (p: Omit<Pr, "created"> & { created?: string }) => { const q = { created: at(prs.length), base: "main", headRef: `topic-${p.number}`, ...p } as Pr; prs.push(q); return q; };
  const ca = "northwind/checkout-api";
  // 11 draft: on hold
  { const c = two("ca11"); add({ repo: ca, number: 11, title: "Draft: retry budget per tenant", user: ME, draft: true, commits: c, reviews: [bot(c[1].sha)], checks: [qa(c[1].sha)], files: ["src/retry.ts"] }); }
  // 12 changes requested by ana: fix
  { const c = two("ca12"); add({ repo: ca, number: 12, title: "Idempotency key on capture retries", user: ME, commits: c, reviews: [bot(c[1].sha), { user: "ana", state: "CHANGES_REQUESTED", commit: c[1].sha, at: at(21) }], checks: [qa(c[1].sha)], files: ["src/capture.ts"],
    body: "Fixes https://github.com/northwind/platform-issues/issues/7" }); }
  // 13 the required reviewer (review-bot) has not reviewed: wait for it
  { const c = two("ca13"); add({ repo: ca, number: 13, title: "Price impact field on quotes", user: ME, commits: c, reviews: [], checks: [qa(c[1].sha)], files: ["src/quote.ts"] }); }
  // 14 depends on 15 (a Depends-on line): wait for it
  { const c = two("ca14"); add({ repo: ca, number: 14, title: "Checkout page shows retry state", user: ME, commits: c, reviews: [bot(c[1].sha)], checks: [qa(c[1].sha)], files: ["web/retry.tsx"],
    body: "Shows the retry state.\n\nDepends-on: #15" }); }
  // 15 assigned to the captain, opened by lee; its head runs in no pre-production environment: deploy
  { const c = two("ca15"); add({ repo: ca, number: 15, title: "Order lock across replicas", user: "lee", assignees: [ME], commits: c, reviews: [bot(c[1].sha)], checks: [], files: ["src/lock.ts"] }); }
  // 16 evidence says FAIL: fix (never ready)
  { const c = two("ca16"); add({ repo: ca, number: 16, title: "Fee lookup returns an error instead of panicking", user: ME, commits: c, reviews: [bot(c[1].sha), { user: "ana", state: "APPROVED", commit: c[1].sha, at: at(22) }, { user: "rel-ray", state: "APPROVED", commit: c[1].sha, at: at(22) }],
    checks: [qa(c[1].sha)], files: ["src/fees.ts"], comments: [{ user: "qa-lin", body: `## Result: FAIL\n\nTested ${c[1].sha.slice(0, 7)}: the fee lookup still panics on an empty currency.`, at: at(25) }] }); }
  // 17 evidence for an older head: test only the change since that commit; on staging through the branch detector
  { const c = two("ca17"); add({ repo: ca, number: 17, title: "Ledger export adds the currency", user: ME, commits: c, reviews: [bot(c[1].sha)], checks: [qa(c[1].sha)], files: ["src/export.ts"],
    comments: [{ user: "qa-lin", body: `**PASS**\n\nVerified on ${c[0].sha.slice(0, 7)}.`, at: at(0.5) }] }); }
  // 18 evidence passes on the head; approvals missing: its author's own approval and a stale one; on qa and production (file)
  { const c = two("ca18"); add({ repo: ca, number: 18, title: "Settings page uses the new permission check", user: ME, commits: c,
    reviews: [bot(c[1].sha), { user: ME, state: "APPROVED", commit: c[1].sha, at: at(22) }, { user: "bo", state: "APPROVED", commit: c[0].sha, at: at(0.5) }],
    checks: [qa(c[1].sha)], files: ["docs/permissions.md", "src/settings.ts"], comments: [{ user: "qa-lin", body: "Result: PASS (conditional on the copy review)\n\nnothing else", at: at(26) }, { user: "qa-lin", body: `# PASS\nhead ${c[1].sha.slice(0, 8)}`, at: at(27) }],
    timeline: [{ event: "cross-referenced", source: { issue: { html_url: "https://github.com/northwind/platform-issues/issues/8", title: "Retry storms after deploys", state: "open" } } }] }); }
  // 19 everything satisfied: ready to merge; on dev through a deployment
  { const c = two("ca19"); add({ repo: ca, number: 19, title: "Capture retries back off", user: ME, commits: c,
    reviews: [bot(c[1].sha), { user: "ana", state: "APPROVED", commit: c[1].sha, at: at(22) }, { user: "rel-ray", state: "APPROVED", commit: c[1].sha, at: at(23) }],
    checks: [qa(c[1].sha)], files: ["src/capture.ts"], comments: [{ user: "qa-lin", body: `## Verdict: PASS\n\nTested ${c[1].sha.slice(0, 10)}.`, at: at(28) }],
    body: "Backs off. See https://github.com/northwind/platform-issues/issues/7", closing: [{ repo: "northwind/web-app", number: 2, title: "Retries hammer the API", state: "OPEN" }] }); }
  // 20 opened by someone else, not assigned: not in the set; 9 closed: not in the set
  { const c = two("ca20"); add({ repo: ca, number: 20, title: "Someone else's change", user: "lee", commits: c }); }
  { const c = two("ca9"); add({ repo: ca, number: 9, title: "Closed change", user: ME, state: "closed", commits: c }); }
  // web-app: classic protection dismisses stale approvals; ana's approval on the older head does not count
  { const c = two("wa30"); add({ repo: "northwind/web-app", number: 30, title: "Login copy rewrite", user: ME, commits: c, github: { ci: "FAILURE" }, reviews: [bot(c[1].sha), { user: "ana", state: "APPROVED", commit: c[0].sha, at: at(0.5) }],
    checks: [qa(c[1].sha)], files: ["src/login.tsx"], comments: [{ user: "qa-lin", body: "Looked at it, will finish tomorrow", at: at(29) }] }); }
  // ledger: its branch protection cannot be read without admin (404 "Not Found"); its ruleset asks for one approval and a
  // team named only by id (88), whose name Studio looks up
  { const c = two("lg40"); add({ repo: "northwind/ledger", number: 40, title: "Statements in the account currency", user: ME, commits: c, reviews: [bot(c[1].sha)], github: { reviewDecision: "REVIEW_REQUIRED", requested: ["northwind/finance"], ciOnOlderHead: true }, checks: [qa(c[1].sha)], files: ["src/statement.ts"],
    comments: [{ user: "qa-lin", body: `### PASS\non ${c[1].sha.slice(0, 7)}`, at: at(29) }] }); }
  // a single watched pull request by someone else, outside the watched repositories
  { const c = two("mb5"); add({ repo: "northwind/mobile", number: 5, title: "App checkout uses the new retry API", user: "lee", commits: c, reviews: [bot(c[1].sha)], checks: [qa(c[1].sha)], files: ["app/checkout.ts"] }); }

  const issues: Record<string, { title: string; state: string }> = { "northwind/platform-issues#7": { title: "Capture retries double-charge", state: "open" }, "northwind/web-app#2": { title: "Retries hammer the API", state: "open" } };
  const rules: Record<string, any> = {
    "northwind/checkout-api": { rulesets: [{ type: "pull_request", parameters: { required_approving_review_count: 2, require_code_owner_review: true, require_last_push_approval: false, dismiss_stale_reviews_on_push: false,
      required_reviewers: [{ reviewer: { type: "Team", id: 77, slug: "release" }, minimum_approvals: 1, file_patterns: ["*"] }] } }], protection: { status: 404, body: { message: "Branch not protected" } },
      codeowners: "# owners\n* @northwind/payments\n/docs/ @dana\n" },
    "northwind/web-app": { rulesets: [], protection: { status: 200, body: { required_pull_request_reviews: { required_approving_review_count: 1, dismiss_stale_reviews: true, require_code_owner_reviews: false } } } },
    "northwind/ledger": { rulesets: [{ type: "pull_request", parameters: { required_approving_review_count: 1, require_code_owner_review: false, require_last_push_approval: false, dismiss_stale_reviews_on_push: true,
      required_reviewers: [{ reviewer: { type: "Team", id: 88 }, minimum_approvals: 1, file_patterns: ["*"] }] } }], protection: { status: 404, body: { message: "Not Found" } } },
    "northwind/mobile": { rulesets: [], protection: { status: 404, body: { message: "Branch not protected" } } },
  };
  const teams: Record<string, string[]> = { "northwind/payments": ["ana", "bo"], "northwind/release": ["rel-ray"], "northwind/finance": ["fin-fay"] };
  const teamIds: Record<string, string> = { "88": "northwind/finance" };
  const find = (repo: string, n: number) => prs.find((p) => p.repo === repo && p.number === n);
  const deployments = [
    { id: 501, repo: ca, environment: "dev", ref: "topic-19", sha: head(find(ca, 19)!), state: "success" },
    { id: 502, repo: ca, environment: "staging", ref: "staging", sha: sha("staging-tip"), state: "success" },
    // a newer staging deployment from another ref that failed: the environment stays on what 502 deployed
    { id: 503, repo: ca, environment: "staging", ref: "hotfix", sha: sha("hotfix-tip"), state: "failure" },
    // "preproduction" is a test environment, not production
    { id: 504, repo: ca, environment: "preproduction", ref: "preprod", sha: sha("preprod-tip"), state: "success" },
  ];
  // the staging branch's tip contains #17's head (it was merged into staging)
  const contains: Record<string, string[]> = { [sha("staging-tip")]: [head(find(ca, 17)!)] };
  const files: Record<string, string> = { "northwind/infra/deploy/prod.yaml": `app:\n  image: registry.example/checkout:${head(find(ca, 18)!).slice(0, 12)}\n` };
  // the repositories' own GitHub environments (used when the settings name none)
  const envs: Record<string, string[]> = { [ca]: ["production", "dev", "staging", "preproduction"] };
  return { prs, issues, rules, teams, teamIds, deployments, contains, files, head, find, envs };
}

export function prWatchGitHub(data = fixtureData()) {
  const calls: { method: string; path: string; body?: any }[] = [], unknown: string[] = [];
  let rateLimited = false;
  const json = (v: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", ...headers } });
  const nf = () => json({ message: "Not Found" }, 404);
  const pullJson = (p: Pr) => ({ number: p.number, title: p.title, body: p.body ?? "", state: p.state ?? "open", draft: !!p.draft, merged_at: p.merged ? at(40) : null, user: { login: p.user }, assignees: (p.assignees ?? []).map((l) => ({ login: l })),
    requested_reviewers: [], labels: (p.labels ?? []).map((name) => ({ name })), base: { ref: p.base ?? "main", repo: { full_name: p.repo } }, head: { ref: p.headRef, sha: data.head(p) }, created_at: p.created, changed_files: (p.files ?? []).length, html_url: `https://github.com/${p.repo}/pull/${p.number}` });
  const page = (list: any[], q: URLSearchParams) => { const per = Number(q.get("per_page") ?? 30), pg = Number(q.get("page") ?? 1); return list.slice((pg - 1) * per, pg * per); };
  // GET answers carry an ETag; a matching If-None-Match gets a 304 (counted in notModified)
  let notModified = 0;
  // knobs: a PATCH whose kept body differs from what was sent, a slow GET of one pull request, an unreadable CODEOWNERS
  const knobs = { tamper: false, slowPull: null as null | { path: string; ms: number }, codeownersFail: false, normalizeOnPatch: false, reviewsFail: null as null | number };
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(req) {
    const res = await answer(req);
    if (req.method !== "GET" || res.status !== 200) return res;
    const text = await res.text(), etag = `"${sha(text)}"`;
    if (req.headers.get("if-none-match") === etag) { notModified++; return new Response(null, { status: 304, headers: { etag } }); }
    return new Response(text, { status: 200, headers: { "content-type": "application/json", etag } });
  } });
  async function answer(req: Request): Promise<Response> {
    const u = new URL(req.url), p = u.pathname, q = u.searchParams, method = req.method;
    let body: any; if (method !== "GET") { try { body = await req.json(); } catch {} }
    calls.push({ method, path: p + u.search, body });
    if (req.headers.get("authorization") !== "Bearer fixture-token") return json({ message: "Bad credentials" }, 401);
    if (rateLimited) return json({ message: "API rate limit exceeded" }, 403, { "x-ratelimit-remaining": "0" });
    if (method === "GET" && p === "/user") return json({ login: ME });
    if (method === "POST" && p === "/graphql") { const v = body?.variables ?? {}; const pr = data.find(`${v.o}/${v.r}`, v.n);
      return json({ data: { repository: { pullRequest: pr ? { commits: { nodes: [{ commit: { oid: pr.github?.ciOnOlderHead ? pr.commits[0].sha : data.head(pr), statusCheckRollup: pr.github?.ci ? { state: pr.github.ci } : pr.checks?.length ? { state: pr.checks.some((c) => c.conclusion === "failure") ? "FAILURE" : "SUCCESS" } : null } }] }, reviewDecision: pr.github?.reviewDecision ?? null, mergeStateStatus: pr.github?.mergeState ?? "BLOCKED",
        reviewRequests: { nodes: (pr.github?.requested ?? []).map((x: string) => x.includes("/") ? { requestedReviewer: { __typename: "Team", slug: x.split("/")[1], organization: { login: x.split("/")[0] } } } : { requestedReviewer: { __typename: "User", login: x } }) },
        closingIssuesReferences: { nodes: (pr.closing ?? []).map((c) => ({ number: c.number, title: c.title, state: c.state, url: `https://github.com/${c.repo}/issues/${c.number}`, repository: { nameWithOwner: c.repo } })) } } : null } } }); }
    let m = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(p); if (!m) { if ((m = /^\/teams\/(\d+)$/.exec(p))) { const t = data.teamIds[m[1]]; return t ? json({ slug: t.split("/")[1], organization: { login: t.split("/")[0] } }) : nf(); }
      if ((m = /^\/orgs\/([^/]+)\/teams\/([^/]+)\/members$/.exec(p))) { const t = data.teams[`${m[1]}/${m[2]}`]; return t ? json(page(t.map((login) => ({ login })), q)) : nf(); } unknown.push(`${method} ${p}`); return nf(); }
    const repo = `${m[1]}/${m[2]}`, rest = m[3] ?? "";
    if (method === "GET" && rest === "/pulls") return json(page(data.prs.filter((x) => x.repo === repo && (x.state ?? "open") === (q.get("state") ?? "open")).map(pullJson), q));
    let k: RegExpExecArray | null;
    if ((k = /^\/pulls\/(\d+)$/.exec(rest))) { const pr = data.find(repo, Number(k[1])); if (!pr) return nf();
      if (method === "PATCH") { if (typeof body?.body === "string") pr.body = knobs.tamper ? `${body.body}\nedited meanwhile` : knobs.normalizeOnPatch ? body.body.replace(/\r\n/g, "\n").split("\n").map((l: string) => l.trimEnd()).join("\n") : body.body; return json(pullJson(pr)); }
      if (method === "GET") { if (knobs.slowPull?.path === p) await new Promise((r) => setTimeout(r, knobs.slowPull!.ms)); return json(pullJson(pr)); } }
    if (method !== "GET") { unknown.push(`${method} ${p}`); return json({ message: "Not Found" }, 404); }
    if ((k = /^\/pulls\/(\d+)\/(reviews|commits|files)$/.exec(rest))) { const pr = data.find(repo, Number(k[1])); if (!pr) return nf();
      if (k[2] === "reviews" && knobs.reviewsFail === pr.number) return json({ message: "Server Error" }, 500);
      if (k[2] === "reviews") return json(page((pr.reviews ?? []).map((r, i) => ({ id: i + 1, user: { login: r.user }, state: r.state, commit_id: r.commit, submitted_at: r.at })), q));
      if (k[2] === "commits") return json(page(pr.commits.map((c: any) => ({ sha: c.sha, commit: { committer: { date: c.at } }, author: { login: c.login }, committer: { login: c.committer ?? c.login } })), q));
      return json(page((pr.files ?? []).map((filename) => ({ filename })), q)); }
    if ((k = /^\/issues\/(\d+)\/(comments|timeline)$/.exec(rest))) { const pr = data.find(repo, Number(k[1])); if (!pr) return nf();
      if (k[2] === "comments") return json(page((pr.comments ?? []).map((c, i) => ({ id: i + 1, user: { login: c.user }, body: c.body, created_at: c.at, html_url: `https://github.com/${repo}/pull/${pr.number}#issuecomment-${i + 1}` })), q));
      return json(page(pr.timeline ?? [], q)); }
    if ((k = /^\/issues\/(\d+)$/.exec(rest))) { const i = data.issues[`${repo}#${k[1]}`]; return i ? json({ number: Number(k[1]), ...i }) : nf(); }
    if ((k = /^\/commits\/([0-9a-f]{40})\/check-runs$/.exec(rest))) { const pr = data.prs.find((x) => data.head(x) === k![1]);
      return json({ total_count: pr?.checks?.length ?? 0, check_runs: (pr?.checks ?? []).map((c, i) => ({ id: i + 1, name: c.name, status: "completed", conclusion: c.conclusion, completed_at: c.at, html_url: `https://github.com/${repo}/runs/${i + 1}` })) }); }
    if ((k = /^\/rules\/branches\/(.+)$/.exec(rest))) { const r = data.rules[repo]; return r ? json(r.rulesets) : nf(); }
    if ((k = /^\/branches\/(.+)\/protection$/.exec(rest))) { const r = data.rules[repo]; return r ? json(r.protection.body, r.protection.status) : nf(); }
    if ((k = /^\/contents\/(.+)$/.exec(rest))) { const path = decodeURIComponent(k[1]);
      if (path.endsWith("CODEOWNERS") && knobs.codeownersFail) return json({ message: "Server Error" }, 500);
      const text = path.endsWith("CODEOWNERS") ? (path === ".github/CODEOWNERS" ? data.rules[repo]?.codeowners : undefined) : data.files[`${repo}/${path}`];
      return text == null ? nf() : json({ type: "file", encoding: "base64", size: text.length, content: Buffer.from(text).toString("base64") }); }
    if (rest === "/environments") return json({ environments: (data.envs[repo] ?? []).map((name) => ({ name })) });
    if (rest === "/deployments") { const list = data.deployments.filter((d) => d.repo === repo && (!q.get("environment") || d.environment === q.get("environment")) && (!q.get("ref") || d.ref === q.get("ref"))).reverse();
      return json(list.map((d) => ({ id: d.id, sha: d.sha, ref: d.ref, environment: d.environment }))); }
    if ((k = /^\/deployments\/(\d+)\/statuses$/.exec(rest))) { const d = data.deployments.find((x) => x.id === Number(k![1])); return d ? json([{ state: d.state }]) : nf(); }
    if ((k = /^\/compare\/([0-9a-f]{7,40})\.\.\.([0-9a-f]{7,40})$/.exec(rest))) { const [a, b] = [k[1], k[2]];
      const full = (s: string) => data.prs.map(data.head).find((h) => h.startsWith(s)) ?? Object.keys(data.contains).find((h) => h.startsWith(s)) ?? s;
      const A = full(a), B = full(b); return json({ status: A === B ? "identical" : (data.contains[B] ?? []).includes(A) ? "ahead" : "diverged" }); }
    unknown.push(`${method} ${p}`); return nf();
  }
  return { knobs, get notModified() { return notModified; }, origin: `http://127.0.0.1:${server.port}`, calls, unknown, data, setRateLimited: (v: boolean) => { rateLimited = v; }, stop: () => server.stop(true) };
}

/** The settings the suites use: every detector and source named here is invented. */
export const fixtureSettings = {
  which: { mine: true, assigned: true, reviewRequested: false },
  evidence: { accounts: ["qa-lin"], checks: [], labels: [] },
  requiredReviewers: ["review-bot"],
  environments: [
    { name: "dev", production: false, repos: [], detect: { kind: "deployment", environment: "dev" } },
    { name: "qa", production: false, repos: [], detect: { kind: "check", name: "deploy/qa" } },
    { name: "staging", production: false, repos: [], detect: { kind: "branch", branch: "staging" } },
    { name: "prod", production: true, repos: [], detect: { kind: "file", repository: "northwind/infra", path: "deploy/prod.yaml", template: "image: registry.example/checkout:{tag}" } },
  ],
  groups: ["A", "B"], shortForm: false, messageLang: null,
};
