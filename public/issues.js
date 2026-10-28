// A project's GitHub issues, on its page (#/project/<id>; docs/units/board.md, "Issues"): the categories they are filed in,
// and inside each category the triage the issue-triage workflow left for its issues (src/domain/issue-triage.ts): work
// packages, each one person's work done in order, and what the two investigators did not agree on. Triage of issues no
// category holds, and the batch form, are in one card after the categories.
// Issue titles are untrusted text: they only ever go into text nodes and title attributes, never into markup.
(() => {
// sel: the package open, and the block (a category, or "other") it was opened in
const IS = { rec: new Map(), busy: new Set(), forms: new Map(), sel: null, selIn: null };
// each project's batch form: what was typed (kept as typed, checked when sent), whether it is sending, its last error
const formOf = (project) => { let f = IS.forms.get(project); if (!f) IS.forms.set(project, (f = { size: "15", numbers: "", starting: false, error: null, approving: null, note: null })); return f; };
const api = async (u) => { const r = await fetch(u); let j = {}; try { j = await r.json(); } catch {} if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j; };
const postJ = async (u, b) => { const r = await fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b ?? {}) }); let j = {}; try { j = await r.json(); } catch {} if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`); return j; };
const ghIssue = (repo, n) => `https://github.com/${repo}/issues/${n}`;
const STATUS = { proposed: ["Waiting for approval", "等核准", "you"], approved: ["Approved", "已核准", "run"], declined: ["Declined", "已退回", "all"], stale: ["An issue changed: triage again", "issue 已變更，需重新分診", "all"] };
const KIND = { ordered: ["In order", "照順序"], unordered: ["Owner picks the order", "負責人決定順序"], "one-change": ["One change", "一次改動"], single: ["One issue", "單張"], recheck: ["Recheck, maybe fixed", "可能已修，待複測"] };
const WORK = { open: ["In progress", "進行中"], merged: ["Merged", "已合併"], ready: ["Ready on its local branch, not published", "已在本機分支完成，未發布"], closed: ["Ended without a merge", "沒有合併就結束"] };
const rerender = () => { if (S.route?.name === "project") render(); };

async function load(project) {
  if (IS.busy.has(project)) return; IS.busy.add(project);
  try { IS.rec.set(project, await api(`/api/issue-triage/${encodeURIComponent(project)}`)); }
  catch (e) { IS.rec.set(project, { state: "error", error: e.message }); }
  finally { IS.busy.delete(project); rerender(); }
}

// the area a package works in: the folder its members' files share
function area(rec, p) {
  const files = p.members.flatMap((n) => (rec.issues[n]?.locus || []).map((l) => l.file));
  if (!files.length) return "";
  const parts = files.map((f) => f.split("/").slice(0, -1));
  let i = 0; while (parts.every((x) => x[i] && x[i] === parts[0][i])) i++;
  return i ? parts[0].slice(0, i).join("/") : [...new Set(files.map((f) => f.split("/").slice(0, 2).join("/")))].slice(0, 2).join(" · ");
}
const realMembers = (rec, p) => p.members.filter((n) => rec.issues[n]?.state !== "not-code");
const tagOf = (rec, p) => { const tags = p.members.map((n) => rec.issues[n]?.tag).filter(Boolean); const top = tags.sort((a, b) => tags.filter((t) => t === b).length - tags.filter((t) => t === a).length)[0]; return top || ""; };

function issueLine(rec, n, step, pid) {
  const i = rec.issues[n] || {}, loc = (i.locus || [])[0], w = rec.progress?.[pid]?.[n];
  return h("li", { class: "is-issue", "data-issue": String(n) },
    h("span", { class: "is-step num" }, step),
    h("div", { class: "is-main" },
      h("div", { class: "is-head" }, h("a", { href: ghIssue(rec.repository, n), target: "_blank", rel: "noopener noreferrer", class: "mono" }, `#${n}`), h("span", { class: "is-title", title: i.title || "" }, i.title || ""), i.security ? h("span", { class: "is-sec" }, T("Security", "安全")) : null),
      loc ? h("div", { class: "is-loc mono" }, `${loc.file} · ${loc.symbol}`) : null,
      i.repro && i.repro !== "none" ? h("div", { class: "is-repro" }, h("b", {}, T("Investigator's repro (for you; not sent to the worker): ", "調查員的重現方式（給你看，不交給 worker）：")), i.repro) : null,
      w && WORK[w.state] ? h("div", { class: `is-work w-${w.state}` }, T(...WORK[w.state]), w.task ? h("a", { href: `#/run/${encodeURIComponent(w.task)}`, class: "mono" }, ` ${w.task}`) : null) : null,
      i.agree === false ? h("div", { class: "is-diff" }, T(`The investigators differ on: ${(i.diff || []).join(", ")}`, `兩位調查員在這些地方不同：${(i.diff || []).join("、")}`)) : null));
}

function packRow(rec, p, on, key) {
  const st = STATUS[p.status] || STATUS.proposed, n = realMembers(rec, p).length;
  return h("button", { type: "button", class: `is-row g-${st[2]}`, "aria-pressed": String(on), "data-pack": p.id, onclick: () => { const again = IS.sel === p.id && IS.selIn === key; IS.sel = again ? null : p.id; IS.selIn = again ? null : key; rerender(); } },
    h("span", { class: "is-id mono" }, p.id),
    h("span", { class: "is-what" }, h("b", {}, tagOf(rec, p) || T("Work package", "工作包")), h("span", {}, area(rec, p))),
    h("span", { class: "is-n num" }, String(n)),
    h("span", { class: "is-kind" }, T(...(KIND[p.kind] || KIND.single))),
    h("span", { class: "is-status" }, h("i", { class: "tb-dot" }), T(st[0], st[1]), p.security ? h("span", { class: "is-sec" }, T("Security", "安全")) : null));
}

// a package kept as a proposal, approved later here: Studio reads its issues again first (one that changed: stale)
async function approvePack(project, id) {
  const f = formOf(project); f.approving = id; f.note = null; rerender();
  try { const r = await postJ(`/api/issue-triage/${encodeURIComponent(project)}/approve`, { packages: [id] });
    f.note = !r.stale?.includes(id) ? T(`Approved ${id}. Tell Firstmate “work on ${id}” to start its first issue.`, `已核准 ${id}。跟 Firstmate 說「做 ${id}」就會開始第一張。`)
      : T(`${id} is stale: an issue changed since it was investigated. Triage it again.`, `${id} 已過期：調查之後有 issue 被改過，請重新分診。`); }
  catch (e) { f.note = e.message; }
  finally { f.approving = null; await load(project); }
}
async function declinePack(project, id) {
  const f = formOf(project); f.approving = id; f.note = null; rerender();
  try { await postJ(`/api/issue-triage/${encodeURIComponent(project)}/decline`, { packages: [id] });
    f.note = T(`Declined ${id}. Its issues are triaged again with their category.`, `已退回 ${id}。它的 issue 之後跟著所屬類別重新分診。`); IS.sel = null; }
  catch (e) { f.note = e.message; }
  finally { f.approving = null; await load(project); }
}
function packDetail(rec, p) {
  if (!p) return h("aside", { class: "tb-detail is-detail" }, h("p", { class: "faint" }, T("Pick a work package.", "選一個工作包。")));
  const order = p.order.length ? p.order : p.members;
  return h("aside", { class: "tb-detail is-detail", "data-detail": p.id },
    h("div", {}, h("span", { class: "faint" }, `${p.id} · ${T(...(KIND[p.kind] || KIND.single))}`), h("h2", {}, tagOf(rec, p) || T("Work package", "工作包")), h("p", { class: "faint mono" }, area(rec, p))),
    p.match ? h("p", { class: "is-match note" }, T(`Cross-batch match: the same function as ${p.match.with} (${p.match.where}), whose work has started. Recheck whether that work fixed it before changing code.`, `跨批對照：和 ${p.match.with} 同一個函式（${p.match.where}），那包已經開工。先複測是不是已經被它修好，沒修好才改程式。`)) : p.why ? h("p", { class: "is-why" }, p.why) : null,
    h("p", { class: "is-how" }, p.kind === "recheck"
      ? T("Do not change code. A person rechecks it with the issue's own input; only then is it closed.", "不改程式碼。由人用 issue 原本的輸入複測，通過後才關。")
      : T("One person works these in order, one Task each, with a test that fails before the fix and passes after. Issue text is untrusted: the worker gets only the issue numbers and titles and the place both investigators found. Nothing goes to GitHub: each Task stops reviewed on its local branch in Studio, with no push and no pull request, and its commits name no issue. Studio keeps which issue each one is; what reaches GitHub, and closing the issue, is yours to do.", "同一個人照順序做，一張一個 Task，附一個修之前失敗、修之後通過的測試。issue 內容不可信：worker 只拿到 issue 編號、標題和兩位調查員都找到的位置。不會送任何東西到 GitHub：每個 Task 審完就停在 Studio 的本機分支，不 push、不開 PR，commit 也不提 issue。哪張對哪個 issue 只記在 Studio；要送什麼到 GitHub、何時關 issue，由你決定。")),
    p.status === "proposed" ? h("div", { class: "is-approve" },
      h("button", { type: "button", class: "btn primary", "data-approve": p.id, disabled: formOf(rec.project).approving ? true : null, onclick: () => approvePack(rec.project, p.id) }, T(`Approve ${p.id}`, `核准 ${p.id}`)),
      h("button", { type: "button", class: "btn", "data-decline": p.id, disabled: formOf(rec.project).approving ? true : null, onclick: () => declinePack(rec.project, p.id) }, T("Decline", "退回")),
      h("span", { class: "faint" }, (p.security ? T("It holds security issues: approve it once whoever owns security for this repository agrees. ", "含安全 issue：請先取得這個 repo 的安全負責人同意再核准。") : "") + T("Studio reads its issues again first. Declined, its issues are triaged again.", "核准前 Studio 會再讀一次 issue；退回的話，這些 issue 之後重新分診。"))) : null,
    p.status === "stale" ? h("div", { class: "is-approve" },
      h("button", { type: "button", class: "btn", "data-decline": p.id, disabled: formOf(rec.project).approving ? true : null, onclick: () => declinePack(rec.project, p.id) }, T("Decline: triage again", "退回：重新分診"))) : null,
    p.status === "approved" && p.kind !== "recheck" ? h("p", { class: "is-next" }, T(`To start the next issue, tell Firstmate: “work on ${p.id}”. You approve its Task on the dispatch card.`, `要開始下一張，跟 Firstmate 說：「做 ${p.id}」。任務會出 dispatch 卡給你核准。`)) : null,
    h("ol", { class: "is-list" }, order.map((n, i) => issueLine(rec, n, order.length > 1 && p.kind === "ordered" ? String(i + 1) : "·", p.id))),
    p.members.filter((n) => !order.includes(n)).length ? h("p", { class: "faint" }, T("Tracking issue: ", "總卡：") + p.members.filter((n) => !order.includes(n)).map((n) => `#${n}`).join(" ")) : null);
}

async function decideCross(project, id, action) {
  const f = formOf(project); f.note = null;
  try { const r = await postJ(`/api/issue-triage/${encodeURIComponent(project)}/cross`, { id, action });
    f.note = action === "join" ? T(`Joined to ${r.joined}: one person fixes that root cause once. ${r.joined} waits for approval again.`, `已併入 ${r.joined}：同一個根因由同一個人一次修好。${r.joined} 需要重新核准。`) : T(`Kept apart as ${r.package}, waiting for approval.`, `分開成 ${r.package}，等你核准。`); }
  catch (e) { f.note = e.message; }
  await load(project);
}
function crossList(rec, cross) {
  return cross.map((c) => h("div", { class: "is-hrow is-cross", "data-cross": c.id },
    h("div", { class: "is-hissues" }, h("span", { class: "is-sec" }, T("Match", "對照")), c.issues.map((n) => h("a", { href: ghIssue(rec.repository, n), target: "_blank", rel: "noopener noreferrer", class: "mono", title: rec.issues[n]?.title || "" }, `#${n}`))),
    h("span", {}, T(`The same function as ${c.with} (${c.where}), not started yet.`, `和 ${c.with} 同一個函式（${c.where}），那包還沒開工。`)),
    h("div", { class: "is-cross-acts" }, h("button", { type: "button", class: "btn primary", "data-cross-join": c.id, onclick: () => decideCross(rec.project, c.id, "join") }, T(`Join ${c.with}`, `併入 ${c.with}`)),
      h("button", { type: "button", class: "btn", "data-cross-apart": c.id, onclick: () => decideCross(rec.project, c.id, "apart") }, T("Keep apart", "分開做")))));
}
// why an issue was set aside before packaging (src/domain/issue-triage.ts Human): a person's work, a duplicate, work in progress
const FIT = { "needs-info": ["needs information", "資訊不足"], "product-decision": ["a product decision", "要產品決定"], "too-large": ["too large", "太大"], "external-dependency": ["an outside dependency", "依賴外部"], "security-owner": ["for the security owner", "安全負責人處理"], other: ["other", "其他"] };
const ghPull = (repo, n) => `https://github.com/${repo}/pull/${n}`;
function asideLine(rec, x) {
  if (x.kind === "human-fit") return T(`A person's work, not an agent's: ${(x.fit || []).map((f) => (FIT[f] || [f])[0]).join(", ")}.`, `適合人做，不適合交給 agent：${(x.fit || []).map((f) => (FIT[f] || [f, f])[1]).join("、")}。`);
  if (x.kind === "duplicate") return [T("Both investigators find it a duplicate of ", "兩位調查員都認為它和這張重複："), h("a", { href: ghIssue(rec.repository, x.duplicateOf), target: "_blank", rel: "noopener noreferrer", class: "mono" }, `#${x.duplicateOf}`), T(", quoting the same symptom from both. Close it or keep it on GitHub yourself.", "，兩張都引用了同一個症狀。要不要關掉，由你自己到 GitHub 處理。")];
  if (x.kind === "in-progress") return [T("An open pull request names it: ", "已有開著的 PR 提到它："), ...(x.pulls || []).map((n) => h("a", { href: ghPull(rec.repository, n), target: "_blank", rel: "noopener noreferrer", class: "mono" }, `#${n} `)), T("Check it before anyone starts.", "開工前先看那個 PR。")];
  return x.reason;
}
function humanList(rec, cross, toHuman) {
  return h("div", { class: "card is-human" }, crossList(rec, cross), toHuman.map((x) => h("div", { class: "is-hrow", ...(x.kind ? { "data-human-kind": x.kind } : {}) },
    h("div", { class: "is-hissues" }, x.kind ? h("span", { class: "is-sec" }, T(...({ "human-fit": ["Person", "人做"], duplicate: ["Duplicate", "重複"], "in-progress": ["In progress", "進行中"] }[x.kind] || [x.kind, x.kind]))) : null,
      x.issues.map((n) => h("a", { href: ghIssue(rec.repository, n), target: "_blank", rel: "noopener noreferrer", class: "mono", title: rec.issues[n]?.title || "" }, `#${n}`))),
    h("span", {}, asideLine(rec, x)))));
}
/** The triage of some issues (a category's, or those no category holds): its packages, the open one's detail, and what
 *  waits for the captain's judgement. Nothing when none of them was triaged. */
function triageOf(rec, issues, key) {
  if (!rec?.schema) return null;
  const set = new Set(issues), hit = (ns) => ns.some((n) => set.has(n));
  const packs = rec.packages.filter((p) => hit(p.members)), cross = (rec.cross || []).filter((c) => hit(c.issues)), human = rec.toHuman.filter((x) => hit(x.issues));
  // agreed, with nothing in the code to change: not a disagreement, not a package
  const none = (rec.noCode || []).map((x) => ({ ...x, issues: x.issues.filter((n) => set.has(n)) })).filter((x) => x.issues.length);
  if (!packs.length && !cross.length && !human.length && !none.length) return null;
  const open = IS.selIn === key ? packs.find((p) => p.id === IS.sel) : null;
  return h("div", { class: "is-tri", "data-tri": key },
    packs.length ? h("div", { class: "card is-packs", role: "list" }, packs.map((p) => packRow(rec, p, p === open, key))) : null,
    open ? packDetail(rec, open) : null,
    cross.length || human.length ? [h("h4", { class: "is-tri-h" }, T("For you to judge", "要你判斷")), humanList(rec, cross, human)] : null,
    none.length ? [h("h4", { class: "is-tri-h" }, T("Agreed: nothing to change in the code", "有共識：程式碼沒有要改的")), noCodeList(rec, none)] : null);
}
const NO_CODE = { "needs-info": ["Both investigators find it lacks what is needed to locate it. Ask the reporter yourself if you want: these questions are kept here only, nothing is posted to GitHub.", "兩位調查員都認為資訊不足，找不到位置。要問回報者請自己去問：這些問題只存在這裡，不會貼到 GitHub。"],
  "not-found": ["Both investigators could not find it in the code: it needs more information (a stack trace, a URL, steps).", "兩位調查員都在程式碼裡找不到：需要更多資訊（stack trace、網址、重現步驟）。"],
  "not-code": ["Both investigators say it is not a code change (research, design, process or tracking).", "兩位調查員都認為這不是改程式碼的事（研究、設計、流程或追蹤）。"] };
function noCodeList(rec, none) {
  return h("div", { class: "card is-nocode", "data-no-code": "1" }, none.map((x) => h("div", { class: "is-hrow", "data-no-code-state": x.state },
    h("div", { class: "is-hissues" }, x.issues.map((n) => h("a", { href: ghIssue(rec.repository, n), target: "_blank", rel: "noopener noreferrer", class: "mono", title: rec.issues[n]?.title || "" }, `#${n}`))),
    h("span", {}, T(...(NO_CODE[x.state] || [x.reason, x.reason]))),
    // the questions for the reporter: untrusted text an investigator wrote, only ever in text nodes
    x.state === "needs-info" ? x.issues.filter((n) => x.questions?.[n]?.length).map((n) => h("div", { class: "is-questions" }, h("span", { class: "faint mono" }, `#${n}`),
      h("ul", { "data-questions": String(n) }, x.questions[n].map((q) => h("li", {}, q))))) : null)));
}

const who = (x) => (x?.provider ? `${x.provider} ${x.model || T("(default model)", "（預設模型）")}${x.effort ? ` · ${x.effort}` : ""}` : T("no model", "沒有模型"));
// how many issues (or which ones) the next triage takes; it opens a captain card before any model runs
function startForm(project, rec) {
  const inv = rec?.investigators, same = !!inv?.a?.provider && inv.a.provider === inv.b?.provider && (inv.a.model || null) === (inv.b.model || null);
  const f = formOf(project);
  const go = async () => {
    const numbers = f.numbers.split(/[\s,#]+/).filter(Boolean).map(Number), size = Number(f.size);
    if (numbers.some((n) => !Number.isSafeInteger(n) || n < 1)) { f.error = T("Issue numbers are whole numbers, like 6459, 6460.", "issue 編號要是整數，例如 6459, 6460。"); rerender(); return; }
    if (!numbers.length && (!Number.isSafeInteger(size) || size < 1 || size > 50)) { f.error = T("A batch is 1 to 50 issues.", "一批是 1 到 50 張。"); rerender(); return; }
    f.starting = true; f.error = null; rerender();
    try { const b = await postJ(`/api/issue-triage/${encodeURIComponent(project)}/start`, { size: numbers.length ? Math.min(50, Math.max(1, size || 15)) : size, issues: numbers }); f.numbers = ""; location.hash = b.href; }
    catch (e) { f.error = e.message; } finally { f.starting = false; rerender(); }
  };
  return h("div", { class: "is-start", "data-issue-start": project },
    h("label", { class: "is-field" }, h("span", {}, T("Issues in this batch", "這批要分診幾張")),
      h("input", { type: "number", min: "1", max: "50", value: f.size, "data-issue-size": "1", oninput: (e) => { f.size = e.target.value; } })),
    h("label", { class: "is-field grow" }, h("span", {}, T("Or these issue numbers (optional)", "或指定 issue 編號（選填）")),
      h("input", { type: "text", placeholder: "6459, 6460", value: f.numbers, "data-issue-numbers": "1", oninput: (e) => { f.numbers = e.target.value; } })),
    h("button", { type: "button", class: "btn primary", disabled: f.starting || same ? true : null, "data-issue-triage": project, onclick: go }, T("Triage issues…", "分診 issue…")),
    h("p", { class: "faint is-inv", "data-investigators": "1" }, same
      ? h("span", { class: "is-warn" }, T(`Both investigators would run on ${who(inv.a)}: give the maker and reviewer seats different models on the Crew page.`, `兩位調查員都會用 ${who(inv.a)}：請到 Crew 頁把 maker 和 reviewer 兩席設成不同模型。`))
      : inv ? T(`Investigators: ${who(inv.a)} and ${who(inv.b)}. Without numbers, the oldest open issues not yet investigated come first. A card shows the batch before any model runs.`, `調查員：${who(inv.a)}、${who(inv.b)}。沒填編號時，先分診最舊、還沒調查過的 open issue。開始前會先出卡片列出這批 issue，你按了才會跑模型。`) : null),
    f.error ? h("p", { class: "is-warn", role: "alert" }, f.error) : null);
}

// ---- the project's categories (src/issue-categories-workflow.ts): built once, new issues filed into them ----
const CAT = { data: new Map(), busy: new Set(), again: new Set(), editing: null, note: new Map(), open: new Set() };
// one read at a time per project; a read asked for meanwhile (after an edit) runs once the current one ends
async function loadCats(project) {
  if (CAT.busy.has(project)) { CAT.again.add(project); return; } CAT.busy.add(project);
  try { CAT.data.set(project, await api(`/api/issue-categories/${encodeURIComponent(project)}`)); }
  catch (e) { CAT.data.set(project, { state: "error", error: e.message }); }
  finally { CAT.busy.delete(project); if (CAT.again.delete(project)) void loadCats(project); else rerender(); }
}
const catPost = async (project, path, body, after) => {
  CAT.note.delete(project);
  try { const r = await postJ(`/api/${path}`, body); if (after) after(r); } catch (e) { CAT.note.set(project, e.message); }
  await loadCats(project);
};
function categoriesCard(project) {
  const c = CAT.data.get(project);
  if (!c && !CAT.busy.has(project)) void loadCats(project);
  const go = (r) => { location.hash = r.href; };
  const startBtn = (label) => h("button", { type: "button", class: "btn primary", "data-cat-start": project, onclick: () => catPost(project, `issue-categories/${encodeURIComponent(project)}/start`, {}, go) }, label);
  const note = CAT.note.get(project) ? h("p", { class: "is-warn", role: "alert" }, CAT.note.get(project)) : null;
  const head = (extra) => h("div", { class: "x-row wrap is-cat-head" }, h("h3", {}, T("Categories", "類別")), extra, h("span", { class: "x-grow" }));
  if (!c) return h("div", { class: "card x-pad", "data-categories": project }, head(null), h("p", { class: "faint" }, T("Loading…", "載入中…")));
  if (c.state === "none" || c.state === "error") return h("div", { class: "card x-pad", "data-categories": project },
    head(startBtn(T("Build categories…", "建立類別…"))),
    h("p", { class: "faint", "data-cat-empty": "1" }, T("No categories yet. A categorizer files every open issue into categories kept in Studio (not GitHub labels); once you approve the list it stays, and new issues are only filed into it, with a new category proposed when none fits.",
      "還沒有類別。分類員會把所有 open issue 分好類，類別只存在 Studio（不是 GitHub 標籤）；你核准後清單就固定，之後新 issue 只會歸進既有類別，放不進去才提新類別。")), note);
  const list = c.list || [], active = list.filter((x) => x.status === "active"), proposed = list.filter((x) => x.status === "proposed");
  const filed = list.reduce((a, x) => a + x.issues.length, 0), title = (n) => (c.titles || {})[n] || "";
  // a category's triage takes its issues not triaged yet (at most 50 at a time), so a large one is worked through in turns
  const tr = IS.rec.get(project), todo = (x) => x.issues.filter((n) => !tr?.issues?.[n]?.investigated).slice(0, 50);
  const packOf = (n) => (tr?.packages || []).find((p) => p.members.includes(n))?.id || "";
  const row = (x) => {
    const editing = CAT.editing === x.id, others = active.filter((o) => o.id !== x.id);
    // a category stays open across redraws (an edit, a refetch) until the captain closes it
    return h("details", { class: "is-cat", "data-cat": x.id, open: CAT.open.has(x.id) || editing ? true : null, ontoggle: (e) => { if (e.target.open) CAT.open.add(x.id); else CAT.open.delete(x.id); } },
      h("summary", {}, h("b", {}, x.name), x.status === "proposed" ? h("span", { class: "is-sec" }, T("Waiting for approval", "等核准")) : null, h("span", { class: "tb-count num" }, String(x.issues.length)), h("span", { class: "faint is-cat-scope" }, x.scope)),
      h("div", { class: "is-cat-body" },
        x.status === "proposed" ? h("div", { class: "is-cat-acts" },
          h("button", { type: "button", class: "btn primary", "data-cat-approve": x.id, onclick: () => catPost(project, `issue-categories/${encodeURIComponent(project)}/edit`, { op: "approve", ids: [x.id] }) }, T("Approve", "核准")),
          h("button", { type: "button", class: "btn", "data-cat-decline": x.id, onclick: () => catPost(project, `issue-categories/${encodeURIComponent(project)}/edit`, { op: "decline", ids: [x.id] }) }, T("Decline: file its issues again", "退回：這些 issue 重新歸類"))) : null,
        x.status === "active" ? h("div", { class: "is-cat-acts" },
          h("button", { type: "button", class: "btn primary", "data-cat-triage": x.id, disabled: todo(x).length ? null : true,
            onclick: () => catPost(project, `issue-triage/${encodeURIComponent(project)}/start`, { size: todo(x).length, issues: todo(x) }, go) },
            todo(x).length ? T(`Triage this category (${todo(x).length})…`, `分診這一類（${todo(x).length} 張）…`) : T("All of it is triaged", "這一類都分診過了")),
          editing ? [h("input", { type: "text", value: x.name, "data-cat-name": x.id, "aria-label": T("New name", "新名稱") }),
              h("button", { type: "button", class: "btn", "data-cat-save": x.id, onclick: () => { const v = document.querySelector(`[data-cat-name="${x.id}"]`)?.value || ""; CAT.editing = null; catPost(project, `issue-categories/${encodeURIComponent(project)}/edit`, { op: "rename", id: x.id, name: v }); } }, T("Save", "儲存"))]
            : h("button", { type: "button", class: "btn ghost", "data-cat-rename": x.id, onclick: () => { CAT.editing = x.id; rerender(); } }, T("Rename", "改名")),
          others.length ? h("select", { "aria-label": T("Merge into", "併入"), "data-cat-merge": x.id, onchange: (e) => { if (e.target.value) catPost(project, `issue-categories/${encodeURIComponent(project)}/edit`, { op: "merge", id: x.id, into: e.target.value }); } },
            h("option", { value: "" }, T("Merge into…", "併入…")), others.map((o) => h("option", { value: o.id }, o.name))) : null) : null,
        h("ul", { class: "is-cat-issues" }, x.issues.map((n) => h("li", { "data-cat-issue": String(n) },
          h("a", { href: `https://github.com/${c.repository}/issues/${n}`, target: "_blank", rel: "noopener noreferrer", class: "mono" }, `#${n}`), h("span", { class: "is-title", title: title(n) }, title(n)),
          packOf(n) ? h("span", { class: "tb-count mono", "data-cat-pack": packOf(n) }, packOf(n)) : null,
          // any listed issue can be tagged planned; moving into another category needs one that is active
          h("select", { "aria-label": T(`Move #${n}`, `移動 #${n}`), "data-cat-move": String(n), onchange: (e) => { if (e.target.value) catPost(project, `issue-categories/${encodeURIComponent(project)}/edit`, { op: "move", n, to: e.target.value }); } },
            h("option", { value: "" }, T("Move to…", "移到…")), others.map((o) => h("option", { value: o.id }, o.name)), h("option", { value: "PLANNED" }, T("Planned work", "規劃中")))))),
        triageOf(tr, x.issues, x.id)));
  };
  // planned work: tagged in Studio and set aside, not handed out by category; the captain takes an issue off it. What a run
  // proposes as planned waits for the captain (meanwhile it is in no category, shown here as waiting): set it aside, or file it
  const all = c.planned || [], plan = all.filter((x) => !x.pending), waiting = all.filter((x) => x.pending), planKey = "PLANNED";
  const plannedRow = all.length ? h("details", { class: "is-cat", "data-cat-planned": "1", open: CAT.open.has(planKey) || waiting.length ? true : null, ontoggle: (e) => { if (e.target.open) CAT.open.add(planKey); else CAT.open.delete(planKey); } },
    h("summary", {}, h("b", {}, T("Planned work", "規劃中")), h("span", { class: "tb-count num" }, String(plan.length)), waiting.length ? h("span", { class: "is-proposed", "data-cat-planned-waiting": String(waiting.length) }, T(`${waiting.length} wait${waiting.length === 1 ? "s" : ""} for approval`, `${waiting.length} 張等核准`)) : null,
      h("span", { class: "faint is-cat-scope" }, T("Roadmap and program tasks, plans, process work: set aside, not filed into a category. A security issue is never set aside.", "路線圖、計畫任務、流程類工作：先擱置，不歸類。安全 issue 不會被擱置。"))),
    h("div", { class: "is-cat-body" }, h("ul", { class: "is-cat-issues" }, all.map((x) => h("li", { "data-cat-issue": String(x.n), ...(x.pending ? { "data-cat-pending": "1" } : {}) },
      h("a", { href: `https://github.com/${c.repository}/issues/${x.n}`, target: "_blank", rel: "noopener noreferrer", class: "mono" }, `#${x.n}`), h("span", { class: "is-title", title: title(x.n) }, title(x.n)),
      x.pending ? h("span", { class: "is-proposed" }, T("Proposed: waiting for approval", "提議中：等核准")) : null,
      x.why ? h("span", { class: "faint" }, x.why) : null,
      x.pending ? h("button", { type: "button", class: "btn", "data-cat-plan": String(x.n), onclick: () => catPost(project, `issue-categories/${encodeURIComponent(project)}/edit`, { op: "move", n: x.n, to: "PLANNED" }) }, T("Set it aside", "擱置它")) : null,
      h("button", { type: "button", class: "btn ghost", "data-cat-unplan": String(x.n), onclick: () => catPost(project, `issue-categories/${encodeURIComponent(project)}/edit`, { op: "unplan", n: x.n }) }, T("Not planned: file it", "不是規劃：歸類它"))))))) : null;
  return h("div", { class: "card x-pad", "data-categories": project },
    head([h("span", { class: "faint" }, T(`${active.length} categories · ${filed} issues filed${plan.length ? ` · ${plan.length} planned` : ""}`, `${active.length} 個類別・已歸類 ${filed} 張${plan.length ? `・規劃中 ${plan.length} 張` : ""}`)), startBtn(T("File new issues…", "歸類新 issue…"))]),
    proposed.length ? h("p", { class: "note" }, T(`${proposed.length} new categor${proposed.length === 1 ? "y waits" : "ies wait"} for your approval: open it below, or answer its Task's card.`, `${proposed.length} 個新類別等你核准：在下面展開它，或在任務卡片上處理。`)) : null,
    note, h("div", { class: "is-cats" }, list.map(row), plannedRow));
}

/** The project page's GitHub issues section (a connected project only): the categories, each with its own triage; then
 *  the triage of issues no category holds, with the form that starts a batch by size or by number. */
function projectIssues(project, repository) {
  const rec = IS.rec.get(project);
  if (!rec && !IS.busy.has(project)) void load(project);
  const has = !!rec?.schema;
  const head = h("div", { class: "sec-head" }, h("h2", { id: "hIssues" }, T("GitHub issues", "GitHub issues")),
    has ? h("span", { class: "faint" }, T(`${rec.open} open · ${rec.packages.length} work packages`, `${rec.open} 張 open・${rec.packages.length} 個工作包`) + (rec.dedup ? T(` · ${rec.dedup} repeat fix${rec.dedup === 1 ? "" : "es"} avoided`, `・避免重工 ${rec.dedup} 張`) : "")) : null);
  if (!rec) return h("section", { id: "s-issues", "aria-labelledby": "hIssues", "data-project-issues": project }, head, h("div", { class: "card x-pad" }, h("p", { class: "faint" }, T("Loading…", "載入中…"))));
  // the issues a live category holds: their triage is shown in it; the rest here
  const cats = (CAT.data.get(project)?.list || []), inCat = new Set(cats.flatMap((x) => x.issues));
  const rest = has ? Object.keys(rec.issues).map(Number).filter((n) => !inCat.has(n)) : [];
  if (IS.sel && !(has && rec.packages.some((p) => p.id === IS.sel))) { IS.sel = null; IS.selIn = null; }
  return h("section", { id: "s-issues", "aria-labelledby": "hIssues", "data-project-issues": project },
    head,
    categoriesCard(project),
    formOf(project).note ? h("p", { class: "note", role: "status" }, formOf(project).note) : null,
    h("div", { class: "card x-pad is-other", "data-tri-other": "1" },
      h("h3", {}, inCat.size ? T("Triage outside the categories", "類別以外的分診") : T("Triage", "分診")),
      has ? h("p", { class: "faint" }, T(`Code read at ${rec.commit.slice(0, 7)} · issues read ${rec.snapshot.fetchedAt.slice(0, 16).replace("T", " ")}`, `程式碼版本 ${rec.commit.slice(0, 7)}・issue 讀取於 ${rec.snapshot.fetchedAt.slice(0, 16).replace("T", " ")}`)) : null,
      startForm(project, rec),
      !has ? h("p", { class: "faint", "data-issues-empty": "1" }, T(`No triage of ${repository} yet. Triage a category, or a batch here: two investigators read the code, and the work packages they agree on appear with their category.`, `${repository} 還沒有分診。分診一個類別，或在這裡分診一批：兩位調查員會讀程式碼，他們有共識的工作包會出現在所屬類別裡。`))
        : triageOf(rec, rest, "other")));
}
window.crewProjectIssues = projectIssues;
/** the project page refetched (a Task or a card changed): read the triage again with it */
window.crewProjectIssuesReload = (project) => { if (!IS.busy.has(project)) void load(project); void loadCats(project); };
})();
