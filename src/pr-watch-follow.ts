// Pull requests (docs/units/pr-watch.md "Follow-through"): the deterministic part of following a pull request after it
// opens. Which branch a pull request is on (PR 跟進: code change, needs evidence, evidence covers the head, missing
// approvals, mergeable, or a question for the captain), the reviewer comment that put it there (quoted, never guessed),
// the messages the four Inbox cards draft, the routes a QA request may cite (only those the diff has), whether a push
// would void approvals, and the links and webhook bodies Studio builds for sending. No model, no network, no clock.
import type { Approvals, Evidence, ReviewView, Step } from "./pr-watch-rules";

export type L = { en: string; tw: string };
/** a reviewer's sentence set inside quotation marks, without its own final full stop (the text around it adds one) */
export const unq = (q: string | null | undefined) => String(q ?? "").replace(/[.。]+\s*$/, "");
// ---------- a reviewer's comment ----------
export type NoteKind = "code-change" | "needs-evidence" | "question" | "non-blocking";
export type Note = { login: string; state: string; at: string; url: string | null; stale: boolean; kind: NoteKind | null; quote: string | null; confidence: "high" | "low"; quotes?: string[];
  /** the commits pushed after this review (short): what answered it */ fixedBy?: string[] };
const SENTENCES = (t: string) => String(t ?? "").replace(/\r/g, "").split(/(?<=[.!?。！？])\s+|\n+/).map((s) => s.replace(/^[\s>*#\-–•]+/, "").trim()).filter((s) => s.length > 2 && s.length <= 400);
const EVIDENCE = /\b(staging|prod(?:uction)?|e2e|end[- ]to[- ]end|manual(?:ly)? test|smoke test|load test|benchmark|repro(?:duce)?|screenshot|recording|test evidence|evidence|qa)\b|實測|实测|證據|证据|截圖|截图|驗證結果|验证结果|測試報告|测试报告|跑一下|測一下|测一下/i;
const ASKS = /\b(need|needs|please|show|provide|attach|post|share|run|verify|confirm|prove)\b|需要|請|请|麻煩|麻烦|補|补|貼|贴/i;
const NONBLOCK = /\b(nit|nitpick|optional|non[- ]?blocking|not blocking|minor|feel free|up to you|fyi)\b|可選|可选|不擋|不挡|小建議|小建议|隨意|随意/i;
const CODE = /\b(should|must|change|fix|rename|remove|add|replace|refactor|bug|wrong|incorrect|missing|leak|race|null|crash|handle|instead|don'?t|do not|never)\b|改成|改為|改为|應該|应该|需要改|要改|請改|请改|錯誤|错误|漏了|不要|拿掉|加上/i;
/**
 * A reviewer comment's kind, by rules, with the sentence that says it. The first sentence that names a kind decides,
 * in this order: evidence asked for, not blocking, a question (it ends in a question mark and asks for nothing), a code
 * change. Two kinds in the same comment, or none, is low confidence: the captain is asked. Never a guess without a quote.
 */
export function classifyNote(body: string): { kind: NoteKind | null; quote: string | null; confidence: "high" | "low"; quotes?: string[] } {
  const found: { kind: NoteKind; quote: string }[] = [];
  for (const s of SENTENCES(body)) {
    const k: NoteKind | null = EVIDENCE.test(s) && ASKS.test(s) ? "needs-evidence" : NONBLOCK.test(s) ? "non-blocking" : /[?？]\s*$/.test(s) && !ASKS.test(s) ? "question" : CODE.test(s) ? "code-change" : null;
    if (k && !found.some((f) => f.kind === k)) found.push({ kind: k, quote: s });
  }
  if (!found.length) return { kind: null, quote: null, confidence: "low" };
  // "nit:" next to a real change is still a change; evidence next to a code change is two asks: the captain decides
  const kinds = new Set(found.map((f) => f.kind)); if (kinds.size > 1 && kinds.has("non-blocking")) kinds.delete("non-blocking");
  const first = found.find((f) => kinds.has(f.kind))!;
  // a comment with two kinds of request: every sentence that asks, so the captain sees all of them
  return { kind: first.kind, quote: first.quote, confidence: kinds.size === 1 ? "high" : "low", ...(kinds.size > 1 ? { quotes: found.filter((f) => kinds.has(f.kind)).map((f) => f.quote) } : {}) };
}

// ---------- the branch ----------
export type Branch = "wait" | "code-change" | "needs-evidence" | "evidence-covers-head" | "missing-approvals" | "mergeable" | "ask";
export type ShepherdInput = { draft: boolean; author: string; next: Step; ci: string | null; evidence: Evidence | null; evidenceSet: boolean; reviews: ReviewView[]; approvals: Approvals; notes: Note[];
  /** the captain chose to skip the test for this head (the QA card's B) */ skipEvidence?: boolean };
export type Shepherd = { branch: Branch; why: L; note?: Note; stale?: string[] };
/**
 * Where a pull request goes next. State, evidence and CI by rules; a reviewer's change request by its quoted sentence
 * (a low-confidence one asks the captain). Mergeable is not built in: it is the next step "ready" (the base branch's own
 * rules all satisfied, the required reviewers, the evidence when a source is set) and CI passing (or none configured).
 * Rules that cannot be read stop and ask; they are never satisfied.
 */
export function shepherd(p: ShepherdInput): Shepherd {
  const r = p.next.rule;
  if (["draft", "unread", "required", "dependency", "environment", "blocked"].includes(r)) return { branch: "wait", why: { en: `waits: ${r}`, tw: `等待：${r}` } };
  const ev = p.evidence, evOk = !!ev && (ev.verdict === "pass" || ev.verdict === "conditional") && (ev.covers === "head" || ev.covers === "unbound");
  // the latest change request on any head: what its reviewer asked for
  const asks = p.notes.filter((n) => n.state === "CHANGES_REQUESTED");
  for (const n of asks) {
    if (n.confidence === "low" || !n.kind) return { branch: "ask", note: n, why: { en: `${n.login}'s comment could not be read as one kind of request`, tw: `${n.login} 的意見看不出是哪一種要求` } };
    if (n.kind === "question") return { branch: "ask", note: n, why: { en: `${n.login} asked a question`, tw: `${n.login} 問了問題` } };
    if (n.kind === "code-change") return { branch: "code-change", note: n, why: { en: `${n.login} asked for a code change`, tw: `${n.login} 要求改代碼` } };
    if (n.kind === "needs-evidence" && !evOk) return p.skipEvidence ? { branch: "ask", note: n, why: { en: "the test was skipped for this head; reply to the reviewer", tw: "這個 head 不做實測：回覆 reviewer" } } : { branch: "needs-evidence", note: n, why: { en: `${n.login} asked for evidence, not a code change`, tw: `${n.login} 要的是外部證據，不是代碼問題` } };
  }
  if (ev?.verdict === "fail") return { branch: "code-change", why: { en: `the test evidence says fail (${ev.by})`, tw: `測試證據是不通過（${ev.by}）` } };
  if (r === "evidence" && !p.skipEvidence) return { branch: "needs-evidence", why: { en: "no test evidence on the current head yet", tw: "目前的 head 還沒有測試證據" } };
  // evidence on the head while reviewers' latest verdicts sit on an older head: ask them again now, not hours later
  // (also one who asked for evidence on this head before it arrived: their verdict predates it)
  const before = (at: string) => !!ev?.at && Date.parse(at) < Date.parse(ev.at);
  // (an approval on an older head is the rules' business: it counts or not, and a missing one is asked for as an approval)
  const stale = p.reviews.filter((v) => !v.author && v.state !== "DISMISSED" && v.state !== "APPROVED" && (v.stale || asks.some((n) => n.login === v.login && n.kind === "needs-evidence" && before(n.at)))).map((v) => v.login);
  if (evOk && stale.length) return { branch: "evidence-covers-head", stale, why: { en: "the evidence covers the current head; the reviewers' verdicts are on an older one", tw: "證據已覆蓋目前的 head；reviewer 的意見還停在舊 head" } };
  if (asks.length) return { branch: "wait", why: { en: "a change request is waiting on its reviewer", tw: "要求修改的 reviewer 還沒重看" } };
  if (!p.approvals.readable) return { branch: "ask", why: { en: "the base branch's rules could not be read: Studio will not treat them as met", tw: "讀不到 base branch 的規則：Studio 不會當作已滿足" } };
  if (p.approvals.missing.length) return { branch: "missing-approvals", why: { en: "the base branch's rules still miss approvals", tw: "base branch 的規則還缺 approve" } };
  if (r !== "ready") return { branch: "wait", why: { en: `waits: ${r}`, tw: `等待：${r}` } };
  if (p.ci === "FAILURE" || p.ci === "ERROR") return { branch: "code-change", why: { en: "CI fails on the head", tw: "head 的 CI 失敗" } };
  if (p.ci !== "SUCCESS" && p.ci !== "NONE") return { branch: "wait", why: { en: "CI has not finished on the head", tw: "head 的 CI 還沒跑完" } };
  return { branch: "mergeable", why: { en: "the base branch's rules, the required reviewers, the evidence and CI are all satisfied", tw: "base branch 的規則、必要 reviewer、證據、CI 都滿足" } };
}

// ---------- a push that would void approvals ----------
/** How many approvals a push would void: those counted on the head now, when the rules dismiss stale approvals or ask for
 *  one after the last push. Unreadable rules: unknown (the card says so). */
export function pushVoids(a: Approvals, reviews: ReviewView[]): { voids: number | null; who: string[] } {
  if (!a.readable) return { voids: null, who: [] };
  if (!a.dismissStale && !a.lastPush) return { voids: 0, who: [] };
  // the approvals the rules count now (never the pusher's or the author's): those a push would void
  const who = a.approvers ?? reviews.filter((v) => v.state === "APPROVED" && !v.stale && !v.author).map((v) => v.login);
  return { voids: who.length, who };
}

// ---------- routes a QA request may cite ----------
export type Route = { method: string; path: string; file: string; line: number };
/** HTTP routes the added lines declare (Express-style, Go's HandleFunc and chi/gin/echo, Spring mappings, Flask/FastAPI).
 *  A QA request cites only these; anything else stays a placeholder. */
export function routesIn(file: string, added: { line: number; text: string }[]): Route[] {
  const out: Route[] = [], push = (method: string, path: string, line: number) => { if (/^\/[A-Za-z0-9_./:{}<>*-]{0,200}$/.test(path) && !out.some((r) => r.method === method && r.path === path)) out.push({ method: method.toUpperCase(), path, file, line }); };
  for (const a of added) { const t = a.text; let m: RegExpExecArray | null;
    if ((m = /\b(?:app|router|r|e|g|api|server|route|mux)\.(get|post|put|patch|delete|GET|POST|PUT|PATCH|DELETE)\(\s*["'`](\/[^"'`]*)["'`]/.exec(t))) push(m[1], m[2], a.line);
    else if ((m = /@(Get|Post|Put|Patch|Delete|Request)Mapping\(\s*(?:value\s*=\s*|path\s*=\s*)?"(\/[^"]*)"/.exec(t))) push(m[1] === "Request" ? "ANY" : m[1], m[2], a.line);
    else if ((m = /\bHandleFunc\(\s*"(?:(GET|POST|PUT|PATCH|DELETE) )?(\/[^"]*)"/.exec(t))) push(m[1] || "ANY", m[2], a.line);
    else if ((m = /@(?:app|router|bp|blueprint)\.(get|post|put|patch|delete|route)\(\s*["'](\/[^"']*)["']/.exec(t))) push(m[1] === "route" ? "ANY" : m[1], m[2], a.line); }
  return out.slice(0, 10);
}

// ---------- the messages ----------
export type MsgPr = { id: string; url: string; title: string; head: string; env: string | null };
const short = (sha: string) => String(sha ?? "").slice(0, 7);
/** "请 QA 测试": what changed, where to test, a command per route the diff has (placeholders for what Studio cannot know),
 *  and how to post the evidence back (a verdict line naming the commit). */
export function qaMessage(pr: MsgPr, routes: Route[], note: Note | null): { msg: L; short: L } {
  const env = pr.env ?? "<environment>", envZ = pr.env ?? "<環境>";
  const cmd = (r: Route) => `curl -s -o /dev/null -w "%{http_code}\\n" -X ${r.method === "ANY" ? "GET" : r.method} "$${(pr.env ?? "TEST").toUpperCase().replace(/[^A-Z0-9]/g, "_")}_URL${r.path}" -H "Authorization: Bearer <token>"${["POST", "PUT", "PATCH"].includes(r.method) ? " -d @<body.json>" : ""}`;
  const steps = routes.length ? routes.map((r, i) => `${i + 1}) ${r.method} ${r.path} (${r.file}:${r.line})\n${cmd(r)}\n`) : [];
  const stepsZ = routes.length ? routes.map((r, i) => `${i + 1}) ${r.method} ${r.path}（${r.file}:${r.line}）\n${cmd(r)}\n預期：<填預期結果>`) : [];
  const asked = note?.quote ? { en: `The reviewer asked: "${unq(note.quote)}"\n\n`, tw: `reviewer 的原話：「${unq(note.quote)}」\n\n` } : { en: "", tw: "" };
  return {
    msg: { en: `Could you test ${pr.id} on ${env} (head ${short(pr.head)})?\n${pr.url}\n\nWhat changed: ${pr.title}\n\n${asked.en}${steps.length ? `${steps.map((s) => `${s}Expected: <fill in the expected result>`).join("\n\n")}` : "What to test: <the diff names no route: fill in the entry point>"}\n\nPlease post the evidence on the pull request, first line "Verdict: pass / fail", and name the commit you tested (${short(pr.head)}).`,
      tw: `請幫忙在 ${envZ} 測 ${pr.id}（head ${short(pr.head)}）\n${pr.url}\n\n改了什麼：${pr.title}\n\n${asked.tw}${stepsZ.length ? stepsZ.join("\n\n") : "要測什麼：<diff 裡沒找到路由，請填入口>"}\n\n證據請貼回 PR，第一行寫「結論：通過 / 不通過」，並註明測的是 ${short(pr.head)}。` },
    short: { en: `A reminder about the test of ${pr.id} on ${env}:\n${pr.url}\nStill needed: the verdict on the pull request, naming ${short(pr.head)}. Thank you!`, tw: `再提醒一下 ${pr.id} 的 ${envZ} 實測：\n${pr.url}\n還差：結論貼回 PR，註明測的是 ${short(pr.head)}。謝謝！` } };
}
/** "请 reviewer 重验": the evidence, the commit it tested (the head), and each reviewer's last comment. */
export function nudgeMessage(pr: MsgPr, who: string[], ev: Evidence, notes: Note[]): { msg: L; short: L } {
  const at = who.map((w) => `@${w}`).join(" ");
  const said = notes.filter((n) => n.quote && who.some((w) => w.toLowerCase() === n.login.toLowerCase()));
  return {
    msg: { en: `${at} could you review ${pr.id} again?\n${pr.url}\n\nThe evidence you asked for is in: ${ev.by}, ${ev.verdict}, on ${short(pr.head)} = the current head${ev.url ? `\n${ev.url}` : ""}${said.length ? `\n\nYour last comments and what changed since:\n${said.map((n) => `- ${n.login}: "${unq(n.quote)}"${n.fixedBy?.length ? ` → ${n.fixedBy.join(", ")}` : ""}`).join("\n")}` : ""}`,
      tw: `${at} 麻煩重驗 ${pr.id}\n${pr.url}\n\n上次要求的證據已補齊：${ev.by}，結論 ${ev.verdict === "pass" ? "通過" : ev.verdict === "conditional" ? "有條件通過" : ev.verdict}，測的是 ${short(pr.head)} = 目前的 head${ev.url ? `\n${ev.url}` : ""}${said.length ? `\n\n上次的意見和對應修改：\n${said.map((n) => `- ${n.login}「${unq(n.quote)}」${n.fixedBy?.length ? ` → ${n.fixedBy.join("、")}` : ""}`).join("\n")}` : ""}` },
    short: { en: `${at} one more nudge on ${pr.id}, the evidence is here: ${ev.url ?? pr.url} (current head ${short(pr.head)})`, tw: `${at} 再麻煩一下 ${pr.id}，證據在這：${ev.url ?? pr.url}（目前 head ${short(pr.head)}）` } };
}
/** "请 approve": one block per group the rules still miss, what is already done, the files a code owner should look at. */
export function approveMessage(pr: MsgPr, missing: { who: string; whoTw?: string; files: string[]; count?: boolean }[], done: L[], lastPush: boolean): { msg: L; short: L } {
  const lines = (z: boolean) => missing.map((m) => `- ${z ? m.whoTw ?? m.who : m.who}${m.count ? "" : z ? "：1 人" : ": 1 approval"}${m.files.length ? z ? `（這次改了 ${m.files.slice(0, 4).join("、")}）` : ` (this changes ${m.files.slice(0, 4).join(", ")})` : ""}`).join("\n");
  return {
    msg: { en: `Could you approve ${pr.id}: ${pr.title}?\n${pr.url}\n\nDone: ${done.map((d) => d.en).join(", ") || "—"}\n\nStill missing:\n${lines(false)}${lastPush ? `\n\nThe branch rules ask for the approval after the last push (${short(pr.head)}); another push needs it again.` : ""}`,
      tw: `麻煩 approve ${pr.id}：${pr.title}\n${pr.url}\n\n已完成：${done.map((d) => d.tw).join("、") || "—"}\n\n還缺：\n${lines(true)}${lastPush ? `\n\n注意：分支規則要求在最後一次 push（${short(pr.head)}）之後 approve，之後若再 push 需要重新 approve。` : ""}` },
    short: { en: `A reminder: ${pr.id} still needs ${missing.map((m) => m.who).join(", ")}: ${pr.url}`, tw: `再提醒一下 ${pr.id} 還差 ${missing.map((m) => m.whoTw ?? m.who).join("、")} 的 approve：${pr.url}` } };
}

// ---------- sending ----------
export const TOOLS = ["slack", "lark", "dingtalk", "teams", "discord", "json"] as const;
export type Tool = (typeof TOOLS)[number];
export const CONTACT_TOOLS = ["slack", "teams", "email"] as const;
export type ContactTool = (typeof CONTACT_TOOLS)[number];
const HOOK_HOSTS: Record<Tool, RegExp> = { slack: /^hooks\.slack\.com$/, lark: /^open\.(?:feishu\.cn|larksuite\.com)$/, dingtalk: /^oapi\.dingtalk\.com$/, teams: /(?:^|\.)(?:webhook\.office\.com|logic\.azure\.com|office\.com)$/, discord: /^(?:discord\.com|discordapp\.com)$/, json: /./ };
/** An incoming-webhook address for a tool: https on that tool's own host (any host for generic JSON); a loopback http
 *  test server only when the caller allows it (tests). Returns the reason it is refused, or null. */
export function webhookProblem(tool: string, url: string, loopbackOk = false): string | null {
  if (!(TOOLS as readonly string[]).includes(tool)) return "choose the chat tool";
  let u: URL; try { u = new URL(String(url ?? "")); } catch { return "the webhook is not an address"; }
  if (u.username || u.password || String(url).length > 600) return "the webhook address is not accepted";
  if (loopbackOk && u.protocol === "http:" && ["127.0.0.1", "localhost"].includes(u.hostname)) return null;
  if (u.protocol !== "https:") return "the webhook must be https";
  if (!HOOK_HOSTS[tool as Tool].test(u.hostname.toLowerCase())) return `that is not a ${tool} webhook address`;
  return null;
}
/** What the browser sees of a webhook: its host and a masked path. */
export const maskHook = (url: string) => { try { const u = new URL(url), rest = `${u.pathname}${u.search}`.replace(/^\/+/, "");
  // nothing after the host is shown but its last four characters: a secret may sit in any path segment or the query
  const tail = rest.replace(/[^A-Za-z0-9]/g, ""); return `${u.protocol}//${u.host}/••••${tail.length > 12 ? tail.slice(-4) : ""}`; } catch { return "••••"; } };
/** The JSON body each tool's incoming webhook takes for plain text. */
export function webhookBody(tool: Tool, text: string): unknown {
  const t = String(text ?? "").slice(0, 3900);
  return tool === "lark" ? { msg_type: "text", content: { text: t } } : tool === "dingtalk" ? { msgtype: "text", text: { content: t } } : tool === "discord" ? { content: t.slice(0, 1900) } : { text: t };
}
/** GitHub @logins in a message, as the chat tool's mentions where a contact says who they are there (Slack only). */
export function chatMentions(text: string, tool: Tool, contacts: { gh: string; tool: ContactTool; id: string }[]): string {
  if (tool !== "slack") return text;
  return String(text ?? "").replace(/(^|[\s(])@([A-Za-z0-9-]{1,39})\b(?!\/)/g, (all, pre, login) => { const c = contacts.find((x) => x.tool === "slack" && x.gh.toLowerCase() === login.toLowerCase()); return c ? `${pre}<@${c.id}>` : all; });
}
export const contactProblem = (c: { gh: string; tool: string; id: string }): string | null => {
  if (!/^[A-Za-z0-9-]{1,39}$/.test(c.gh)) return `"${c.gh}" is not a GitHub account`;
  if (c.tool === "slack") return /^[UW][A-Z0-9]{2,20}$/.test(c.id) ? null : `${c.gh}: a Slack member id looks like U0123ABCD`;
  if (c.tool === "teams" || c.tool === "email") return /^[^\s@<>"',;]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/.test(c.id) ? null : `${c.gh}: write an email address`;
  return `${c.gh}: choose Slack, Microsoft Teams or Email`;
};
/** The address that opens a DM with a contact, built only from validated settings (never from a pull request, comment or
 *  message): Slack's app link (the message must be pasted), a Teams chat with the message filled in, or an email. */
export function dmLink(c: { tool: ContactTool; id: string } | null, text: string, subject: string, slackTeam: string | null): { href: string; prefilled: boolean } | null {
  if (!c) return null;
  const t = String(text ?? "");
  if (c.tool === "slack") return slackTeam && /^T[A-Z0-9]{2,20}$/.test(slackTeam) && /^[UW][A-Z0-9]{2,20}$/.test(c.id) ? { href: `slack://user?team=${slackTeam}&id=${c.id}`, prefilled: false } : null;
  if (contactProblem({ gh: "x", tool: c.tool, id: c.id })) return null;
  if (c.tool === "teams") return { href: `https://teams.microsoft.com/l/chat/0/0?users=${encodeURIComponent(c.id)}&message=${encodeURIComponent(t.slice(0, 1500))}`, prefilled: true };
  return { href: `mailto:${encodeURIComponent(c.id).replace(/%40/g, "@")}?subject=${encodeURIComponent(subject.slice(0, 200))}&body=${encodeURIComponent(t.slice(0, 1800))}`, prefilled: true };
}
