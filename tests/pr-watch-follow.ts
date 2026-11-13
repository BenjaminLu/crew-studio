import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Pull requests (docs/units/pr-watch.md "Follow-through"), the pure part: a reviewer comment's kind with its quote (low
// confidence asks the captain), the branch a pull request is on (mergeable from the repository's own rules, never built
// in), a push that would void approvals, the routes a QA request may cite, the drafted messages, and the webhook and DM
// links Studio builds only from validated settings.
//   bun tests/pr-watch-follow.ts
import { suite } from "./rt-harness";
import * as F from "../src/pr-watch-follow";
import type { Approvals, Step, ReviewView, Evidence } from "../src/pr-watch-rules";

const { ok, end } = suite("pr-watch-follow");

// ---------- a reviewer's comment ----------
{
  const c = (t: string) => F.classifyNote(t);
  ok(c("Please attach a staging run showing the 429 for the 21st request.").kind === "needs-evidence" && c("需要 staging 上 429 的實測證據").kind === "needs-evidence", "asking for a staging run or evidence: needs evidence");
  ok(c("The counter is not initialised to 0, so the first failure is missed. Please fix it.").kind === "code-change" && c("log 裡不要印出 key id").kind === "code-change", "a change to the code: code change");
  ok(c("Why does the lock expire after 30 seconds?").kind === "question" && c("nit: maybe rename this, optional").kind === "non-blocking", "a question; a nit");
  const both = c("Please add a test for the timeout. Also show a staging run with real traffic.");
  ok(both.confidence === "low" && !!both.quote, "two kinds of request in one comment: low confidence, the captain decides");
  ok(c("👍").kind === null && c("👍").confidence === "low" && c("👍").quote === null, "nothing to quote: no kind, low confidence, never a guess");
  ok(c("Please fix the null check.").quote === "Please fix the null check.", "the quote is the reviewer's own sentence");
}
// ---------- the branch ----------
{
  const ap = (o: Partial<Approvals> = {}): Approvals => ({ readable: true, required: 1, counted: 1, codeOwners: false, lastPush: false, dismissStale: false, missing: [], sources: ["ruleset"], ...o });
  const step = (rule: string): Step => ({ rule, kind: "merge", who: [], matched: [] }) as any;
  const pass: Evidence = { verdict: "pass", source: "comment", by: "qa-lead", at: "2026-11-01T00:00:00Z", url: "https://github.com/o/r/pull/1#issuecomment-1", covers: "head", since: null, shas: [] };
  const rv = (login: string, state: string, stale = false): ReviewView => ({ login, state: state as any, stale, at: "2026-11-01T00:00:00Z", author: false });
  const note = (state: string, body: string, stale = false): F.Note => ({ login: "review-bot-a", state, at: "x", url: null, stale, ...F.classifyNote(body) });
  const base: F.ShepherdInput = { draft: false, author: "dev", next: step("ready"), ci: "SUCCESS", evidence: pass, evidenceSet: true, reviews: [rv("review-bot-a", "APPROVED")], approvals: ap(), notes: [] };
  const s = (o: Partial<F.ShepherdInput>) => F.shepherd({ ...base, ...o });
  ok(s({}).branch === "mergeable", "rules met, required reviewers, evidence and CI: mergeable");
  ok(s({ ci: "PENDING" }).branch === "wait" && s({ ci: "FAILURE" }).branch === "code-change" && s({ ci: "NONE" }).branch === "mergeable", "CI running waits, failing is a code change, none configured does not hold it");
  ok(s({ approvals: ap({ missing: [{ kind: "team", who: "@owner/security" }] }), next: step("approvals") }).branch === "missing-approvals", "the repository's rules still miss a team: missing approvals");
  ok(s({ approvals: { readable: false, required: 0, counted: 0, codeOwners: false, lastPush: false, dismissStale: false, missing: [{ kind: "unreadable", reason: "x", tw: "x" }], sources: [] }, next: step("approvals") }).branch === "ask", "rules that cannot be read stop and ask, never satisfied");
  const ce = note("CHANGES_REQUESTED", "Please attach a staging run that shows the 429.");
  ok(s({ notes: [ce], evidence: null, next: step("changes"), reviews: [rv("review-bot-a", "CHANGES_REQUESTED")] }).branch === "needs-evidence" && s({ notes: [ce], evidence: null, next: step("changes") }).note?.quote === "Please attach a staging run that shows the 429.", "a change request asking for evidence goes to QA, quoting it");
  const st = s({ notes: [{ ...ce, stale: true }], next: step("changes"), reviews: [rv("review-bot-a", "CHANGES_REQUESTED", true), rv("review-bot-b", "COMMENTED", true)] });
  ok(st.branch === "evidence-covers-head" && st.stale?.join() === "review-bot-a,review-bot-b", "evidence on the head while the reviewers' verdicts are on an older head: ask them again right away", JSON.stringify(st));
  ok(s({ next: step("approvals"), approvals: ap({ missing: [{ kind: "count", n: 1 }] }), reviews: [rv("bo", "APPROVED", true)] }).branch === "missing-approvals", "an approval on an older head is a missing approval (the rules decide), not a re-review");
  ok(s({ notes: [note("CHANGES_REQUESTED", "Please fix the null check.")], next: step("changes") }).branch === "code-change", "a code change goes back to the worker");
  ok(s({ notes: [note("CHANGES_REQUESTED", "Please add a test. Also show a staging run.")], next: step("changes") }).branch === "ask", "a low-confidence comment asks the captain");
  ok(s({ next: step("evidence"), evidence: null }).branch === "needs-evidence" && s({ next: step("evidence"), evidence: null, skipEvidence: true }).branch !== "needs-evidence", "no evidence on the head: QA, unless the captain skipped the test for this head");
  ok(s({ next: step("draft") }).branch === "wait" && s({ next: step("required") }).branch === "wait", "a draft, or a required reviewer not there yet: wait, no card");
}
// ---------- a push that voids approvals ----------
{
  const reviews: ReviewView[] = [{ login: "rel-dan", state: "APPROVED", stale: false, at: "", author: false }, { login: "old", state: "APPROVED", stale: true, at: "", author: false }];
  const a = { readable: true, required: 1, counted: 1, codeOwners: false, lastPush: false, dismissStale: true, missing: [], sources: [] } as Approvals;
  ok(F.pushVoids(a, reviews).voids === 1 && F.pushVoids(a, reviews).who.join() === "rel-dan", "stale approvals dismissed: a push voids the approvals on the head");
  ok(F.pushVoids({ ...a, dismissStale: false }, reviews).voids === 0 && F.pushVoids({ ...a, readable: false } as any, reviews).voids === null, "rules that keep stale approvals: none; unreadable rules: unknown");
}
// ---------- routes and messages ----------
{
  const r = F.routesIn("src/orders.ts", [{ line: 4, text: 'router.post("/v1/orders", limit(20), create)' }, { line: 9, text: "const x = 1" }, { line: 12, text: '@GetMapping("/v1/orders/{id}")' }]);
  ok(r.map((x) => `${x.method} ${x.path}:${x.line}`).join() === "POST /v1/orders:4,GET /v1/orders/{id}:12", "routes the added lines declare", JSON.stringify(r));
  const pr = { id: "owner/api-gateway#212", url: "https://github.com/owner/api-gateway/pull/212", title: "Rate limit per account", head: "a41f9c2deadbeef", env: "staging" };
  const q = F.qaMessage(pr, r, { login: "review-bot-a", state: "CHANGES_REQUESTED", at: "", url: null, stale: false, kind: "needs-evidence", quote: "需要 staging 上 429 的實測證據", confidence: "high" });
  ok(q.msg.tw.includes("請幫忙在 staging 測 owner/api-gateway#212（head a41f9c2）") && q.msg.tw.includes('-X POST "$STAGING_URL/v1/orders"') && q.msg.tw.includes("<token>") && q.msg.tw.includes("「需要 staging 上 429 的實測證據」") && q.msg.tw.includes("註明測的是 a41f9c2"), "the QA request: only the diff's routes, placeholders for the rest, the reviewer's words, how to post back", q.msg.tw);
  ok(F.qaMessage({ ...pr, env: null }, [], null).msg.en.includes("<the diff names no route: fill in the entry point>"), "no route in the diff: a placeholder, never an invented one");
  const ap = F.approveMessage(pr, [{ who: "@owner/security", files: ["auth/signature.go"] }], [{ en: "CI passes", tw: "CI 通過" }], true);
  ok(ap.msg.tw.includes("@owner/security：1 人（這次改了 auth/signature.go）") && ap.msg.tw.includes("最後一次 push（a41f9c2）之後") && ap.short.en.includes("@owner/security"), "the approve request names each missing group and the last-push rule");
}
// ---------- sending ----------
{
  ok(F.webhookProblem("slack", "https://hooks.slack.com/services/T0/B0/x") === null && !!F.webhookProblem("slack", "https://evil.example/services/x") && !!F.webhookProblem("slack", "http://hooks.slack.com/x") && !!F.webhookProblem("json", "http://127.0.0.1:9/x") && F.webhookProblem("json", "http://127.0.0.1:9/x", true) === null, "a webhook: https on the tool's own host; loopback only when tests allow it");
  ok(F.maskHook("https://hooks.slack.com/services/T0AAA/B0BBB/secretpart") === "https://hooks.slack.com/services/T0AAA/…/••••", "the browser sees a masked webhook");
  ok(JSON.stringify(F.webhookBody("lark", "hi")) === '{"msg_type":"text","content":{"text":"hi"}}' && JSON.stringify(F.webhookBody("slack", "hi")) === '{"text":"hi"}', "each tool's body");
  ok(F.chatMentions("@qa-lead please, and @owner/security", "slack", [{ gh: "qa-lead", tool: "slack", id: "U04QA" }]) === "<@U04QA> please, and @owner/security", "a GitHub login becomes the chat's @ where a contact says who they are");
  ok(F.dmLink({ tool: "slack", id: "U04QA" }, "hi", "s", "T0TEAM")?.href === "slack://user?team=T0TEAM&id=U04QA" && F.dmLink({ tool: "slack", id: "U04QA" }, "hi", "s", null) === null, "Slack: the app link to that member (the message is pasted)");
  ok(F.dmLink({ tool: "teams", id: "dan@example.com" }, "a b", "s", null)?.href === "https://teams.microsoft.com/l/chat/0/0?users=dan%40example.com&message=a%20b", "Teams: a chat with the message filled in");
  ok(F.dmLink({ tool: "email", id: "alice@example.com" }, "body", "subj", null)?.href === "mailto:alice@example.com?subject=subj&body=body" && F.dmLink(null, "x", "s", null) === null && F.dmLink({ tool: "email", id: "javascript:alert(1)" }, "x", "s", null) === null, "Email: mailto; no contact or a bad one: no link (copy only)");
  ok(!!F.contactProblem({ gh: "a", tool: "discord", id: "x" }) && F.contactProblem({ gh: "qa-lead", tool: "slack", id: "U04QA12" }) === null, "contacts: Slack, Microsoft Teams or Email only");
}
end();
