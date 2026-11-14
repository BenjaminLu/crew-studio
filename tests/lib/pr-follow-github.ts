// The follow-through fixture (docs/units/pr-watch.md "Follow-through"): the fictional GitHub of tests/lib/pr-watch-github.ts
// plus northwind/gateway, whose rules ask for @northwind/security and @northwind/release-approvers after the last push:
// 212 (a reviewer asks for staging evidence), 215 (QA passed the head, the reviewers are on an older one), 216 (only
// security still missing). Every name is invented.
import { fixtureData, ME, sha } from "./pr-watch-github";
export function followFixture() {
  const data = fixtureData(), gw = "northwind/gateway", T = (h: number) => new Date(Date.parse("2026-11-03T08:00:00Z") + h * 3600_000).toISOString();
  const two = (n: string) => [{ sha: sha(`${n}-1`), at: T(0), login: ME }, { sha: sha(`${n}-2`), at: T(1), login: ME }];
  const add = (p: any) => { data.prs.push({ created: T(0), base: "main", headRef: `topic-${p.number}`, checks: [{ name: "deploy/staging", conclusion: "success", at: T(1.5) }], ...p }); return p; };
  // 212: the reviewer asks for staging evidence (a change request, on the head); the diff adds POST /v1/orders
  const c212 = two("gw212"); add({ repo: gw, number: 212, title: "Rate limit per account", user: ME, commits: c212, files: ["src/routes.ts"],
    patches: { "src/routes.ts": '@@ -1,0 +1,1 @@\n+router.post("/v1/orders", limitPerAccount(20), createOrder)' },
    reviews: [{ user: "review-bot-a", state: "CHANGES_REQUESTED", commit: c212[1].sha, at: T(2), body: "Please attach a staging run that shows the 429 for the 21st request." }] });
  // 215: QA passed the head; both reviewers' verdicts are on the older head
  const c215 = two("gw215"); add({ repo: gw, number: 215, title: "Order status updates use CAS", user: ME, commits: c215, files: ["src/orders.ts"],
    reviews: [{ user: "review-bot-a", state: "CHANGES_REQUESTED", commit: c215[0].sha, at: T(0.5), body: "需要 staging 上的實測證據" }, { user: "review-bot-b", state: "COMMENTED", commit: c215[0].sha, at: T(0.6), body: "Missing a concurrency test. Please add one." }],
    comments: [{ user: "qa-lead", body: `結論：通過\n測的是 ${c215[1].sha.slice(0, 7)}`, at: T(3) }] });
  // 216: bots and QA done, release-approvers approved on the head; the rules still ask for @northwind/security
  const c216 = two("gw216"); add({ repo: gw, number: 216, title: "Signature check uses the new algorithm", user: ME, commits: c216, files: ["auth/signature.go"],
    reviews: [{ user: "review-bot-a", state: "APPROVED", commit: c216[1].sha, at: T(2) }, { user: "rel-dan", state: "APPROVED", commit: c216[1].sha, at: T(2.5) }],
    comments: [{ user: "qa-lead", body: `## Verdict: PASS\nTested ${c216[1].sha.slice(0, 8)}`, at: T(3) }] });
  data.rules[gw] = { rulesets: [{ type: "pull_request", parameters: { required_approving_review_count: 1, require_code_owner_review: false, require_last_push_approval: true, dismiss_stale_reviews_on_push: true,
    required_reviewers: [{ reviewer: { type: "Team", slug: "security" } }, { reviewer: { type: "Team", slug: "release-approvers" } }] } }], protection: { status: 404, body: { message: "Branch not protected" } } };
  data.teams["northwind/security"] = ["sec-alice", "sec-bob", "sec-carol"]; data.teams["northwind/release-approvers"] = ["rel-dan", "rel-erin"];
  return { data, gw, T, c212, c215, c216 };
}
