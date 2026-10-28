// A project's GitHub issues, on its page (#/project/<id>; docs/units/board.md, "Issues"): start a triage of the next
// batch (how many issues, or which ones), see the two investigators' models, and the triage the issue-triage workflow
// left (src/domain/issue-triage.ts): work packages first, each one person's work done in order; then what the two
// investigators did not agree on; then the issues nobody has investigated yet.
// Issue titles are untrusted text: they only ever go into text nodes and title attributes, never into markup.
(() => {
const IS = { rec: new Map(), busy: new Set(), forms: new Map(), sel: null, tab: "packages" };
// each project's batch form: what was typed (kept as typed, checked when sent), whether it is sending, its last error
const formOf = (project) => { let f = IS.forms.get(project); if (!f) IS.forms.set(project, (f = { size: "15", numbers: "", starting: false, error: null, approving: null, note: null })); return f; };
const api = async (u) => { const r = await fetch(u); let j = {}; try { j = await r.json(); } catch {} if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j; };
const postJ = async (u, b) => { const r = await fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b ?? {}) }); let j = {}; try { j = await r.json(); } catch {} if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`); return j; };
const ghIssue = (repo, n) => `https://github.com/${repo}/issues/${n}`;
const STATUS = { proposed: ["Waiting for approval", "等核准", "you"], approved: ["Approved", "已核准", "run"], declined: ["Declined", "已退回", "all"], stale: ["An issue changed: triage again", "issue 已變更，需重新分診", "all"] };
const KIND = { ordered: ["In order", "照順序"], unordered: ["Owner picks the order", "負責人決定順序"], "one-change": ["One change", "一次改動"], single: ["One issue", "單張"], recheck: ["Recheck, maybe fixed", "可能已修，待複測"] };
const WORK = { open: ["In progress", "進行中"], merged: ["Merged", "已合併"], closed: ["Ended without a merge", "沒有合併就結束"] };
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
      i.repro && i.repro !== "none" ? h("div", { class: "is-repro" }, h("b", {}, T("Fails before the fix: ", "修之前應該失敗：")), i.repro) : null,
      w && WORK[w.state] ? h("div", { class: `is-work w-${w.state}` }, T(...WORK[w.state]), w.task ? h("a", { href: `#/run/${encodeURIComponent(w.task)}`, class: "mono" }, ` ${w.task}`) : null) : null,
      i.agree === false ? h("div", { class: "is-diff" }, T(`The investigators differ on: ${(i.diff || []).join(", ")}`, `兩位調查員在這些地方不同：${(i.diff || []).join("、")}`)) : null));
}

function packRow(rec, p, on) {
  const st = STATUS[p.status] || STATUS.proposed, n = realMembers(rec, p).length;
  return h("button", { type: "button", class: `is-row g-${st[2]}`, "aria-pressed": String(on), "data-pack": p.id, onclick: () => { IS.sel = p.id; rerender(); } },
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
function packDetail(rec, p) {
  if (!p) return h("aside", { class: "tb-detail is-detail" }, h("p", { class: "faint" }, T("Pick a work package.", "選一個工作包。")));
  const order = p.order.length ? p.order : p.members;
  return h("aside", { class: "tb-detail is-detail", "data-detail": p.id },
    h("div", {}, h("span", { class: "faint" }, `${p.id} · ${T(...(KIND[p.kind] || KIND.single))}`), h("h2", {}, tagOf(rec, p) || T("Work package", "工作包")), h("p", { class: "faint mono" }, area(rec, p))),
    p.match ? h("p", { class: "is-match note" }, T(`Cross-batch match: the same function as ${p.match.with} (${p.match.where}), whose work has started. Recheck whether that work fixed it before changing code.`, `跨批對照：和 ${p.match.with} 同一個函式（${p.match.where}），那包已經開工。先複測是不是已經被它修好，沒修好才改程式。`)) : p.why ? h("p", { class: "is-why" }, p.why) : null,
    h("p", { class: "is-how" }, p.kind === "recheck"
      ? T("Do not change code. A person rechecks it with the issue's own input; only then is it closed.", "不改程式碼。由人用 issue 原本的輸入複測，通過後才關。")
      : T("One person works these in order, one pull request each. Each issue's repro becomes its test: it fails before the fix and passes after.", "同一個人照順序做，一張一個 PR。每張的重現方式就是它的測試：修之前失敗，修之後通過。") + (p.security ? T(" Security issues are referenced, not closed, by the pull request; they close after a recheck.", " 安全 issue 在 PR 裡只寫 Refs，合併後複測通過才關。") : "")),
    p.status === "proposed" ? h("div", { class: "is-approve" },
      h("button", { type: "button", class: "btn primary", "data-approve": p.id, disabled: formOf(rec.project).approving ? true : null, onclick: () => approvePack(rec.project, p.id) }, T(`Approve ${p.id}`, `核准 ${p.id}`)),
      h("span", { class: "faint" }, (p.security ? T("It holds security issues: approve it once whoever owns security for this repository agrees. ", "含安全 issue：請先取得這個 repo 的安全負責人同意再核准。") : "") + T("Studio reads its issues again first.", "核准前 Studio 會再讀一次 issue。"))) : null,
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
function crossList(rec) {
  return (rec.cross || []).map((c) => h("div", { class: "is-hrow is-cross", "data-cross": c.id },
    h("div", { class: "is-hissues" }, h("span", { class: "is-sec" }, T("Match", "對照")), c.issues.map((n) => h("a", { href: ghIssue(rec.repository, n), target: "_blank", rel: "noopener noreferrer", class: "mono", title: rec.issues[n]?.title || "" }, `#${n}`))),
    h("span", {}, T(`The same function as ${c.with} (${c.where}), not started yet.`, `和 ${c.with} 同一個函式（${c.where}），那包還沒開工。`)),
    h("div", { class: "is-cross-acts" }, h("button", { type: "button", class: "btn primary", "data-cross-join": c.id, onclick: () => decideCross(rec.project, c.id, "join") }, T(`Join ${c.with}`, `併入 ${c.with}`)),
      h("button", { type: "button", class: "btn", "data-cross-apart": c.id, onclick: () => decideCross(rec.project, c.id, "apart") }, T("Keep apart", "分開做")))));
}
function humanList(rec) {
  const cross = crossList(rec);
  return h("div", { class: "card is-human" }, cross, rec.toHuman.length ? rec.toHuman.map((x) => h("div", { class: "is-hrow" },
    h("div", { class: "is-hissues" }, x.issues.map((n) => h("a", { href: ghIssue(rec.repository, n), target: "_blank", rel: "noopener noreferrer", class: "mono", title: rec.issues[n]?.title || "" }, `#${n}`))),
    h("span", {}, x.reason))) : cross.length ? null : h("p", { class: "faint" }, T("The investigators agreed on everything they looked at.", "兩位調查員看過的都有共識。")));
}

function pendingList(rec) {
  const rest = Object.entries(rec.issues).filter(([, i]) => !i.investigated && !i.closed).map(([n, i]) => [Number(n), i]).sort((a, b) => a[0] - b[0]);
  return h("div", { class: "card is-pending" }, rest.length ? h("ul", {}, rest.map(([n, i]) => h("li", {}, h("a", { href: ghIssue(rec.repository, n), target: "_blank", rel: "noopener noreferrer", class: "mono" }, `#${n}`), h("span", { class: "is-title", title: i.title }, i.title), i.security ? h("span", { class: "is-sec" }, T("Security", "安全")) : null)))
    : h("p", { class: "faint" }, T("Every open issue has been investigated.", "每張 open issue 都調查過了。")));
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

/** The project page's GitHub issues section (a connected project only): starting a triage, and its result. */
function projectIssues(project, repository) {
  const rec = IS.rec.get(project);
  if (!rec && !IS.busy.has(project)) void load(project);
  const has = !!rec?.schema;
  const head = h("div", { class: "sec-head" }, h("h2", { id: "hIssues" }, T("GitHub issues", "GitHub issues")),
    has ? h("span", { class: "faint" }, T(`${rec.open} open · ${rec.investigated.length} investigated · ${rec.packages.length} work packages`, `${rec.open} 張 open・已調查 ${rec.investigated.length} 張・${rec.packages.length} 個工作包`) + (rec.dedup ? T(` · ${rec.dedup} repeat fix${rec.dedup === 1 ? "" : "es"} avoided`, `・避免重工 ${rec.dedup} 張`) : "")) : null);
  if (!rec) return h("section", { id: "s-issues", "aria-labelledby": "hIssues", "data-project-issues": project }, head, h("div", { class: "card x-pad" }, h("p", { class: "faint" }, T("Loading…", "載入中…"))));
  const packs = has ? rec.packages : [], pending = has ? Object.values(rec.issues).filter((i) => !i.investigated && !i.closed).length : 0;
  if (!packs.some((p) => p.id === IS.sel)) IS.sel = packs[0]?.id ?? null;
  const tabs = [["packages", "Work packages", "工作包", packs.length], ["human", "For you to judge", "要你判斷", has ? rec.toHuman.length + (rec.cross || []).length : 0], ["pending", "Not investigated", "待調查", pending]];
  return h("section", { id: "s-issues", "aria-labelledby": "hIssues", "data-project-issues": project },
    head,
    h("div", { class: "card x-pad" }, startForm(project, rec)),
    formOf(project).note ? h("p", { class: "note", role: "status" }, formOf(project).note) : null,
    !has ? h("div", { class: "card x-pad" }, h("p", { class: "faint", "data-issues-empty": "1" }, T(`No triage of ${repository} yet. Triage a batch above: two investigators read the code, and the work packages they agree on appear here.`, `${repository} 還沒有分診。從上面開始分診一批：兩位調查員會讀程式碼，他們有共識的工作包會出現在這裡。`)))
      : [h("p", { class: "faint" }, T(`Code read at ${rec.commit.slice(0, 7)} · issues read ${rec.snapshot.fetchedAt.slice(0, 16).replace("T", " ")}`, `程式碼版本 ${rec.commit.slice(0, 7)}・issue 讀取於 ${rec.snapshot.fetchedAt.slice(0, 16).replace("T", " ")}`)),
        h("div", { class: "tb-tabs", role: "tablist" }, tabs.map(([k, en, zh, n]) => h("button", { type: "button", role: "tab", class: "tb-tab", "aria-selected": String(IS.tab === k), "data-is-tab": k, onclick: () => { IS.tab = k; rerender(); } }, T(en, zh), h("span", { class: "tb-count num" }, String(n))))),
        IS.tab === "packages" ? h("div", { class: "tb-body is-body" },
          h("div", { class: "card is-packs", role: "list" }, packs.length ? packs.map((p) => packRow(rec, p, p.id === IS.sel)) : h("p", { class: "faint" }, T("No work package both investigators agree on yet.", "還沒有兩位調查員都同意的工作包。"))),
          packDetail(rec, packs.find((p) => p.id === IS.sel)))
        : IS.tab === "human" ? humanList(rec) : pendingList(rec)]);
}
window.crewProjectIssues = projectIssues;
/** the project page refetched (a Task or a card changed): read the triage again with it */
window.crewProjectIssuesReload = (project) => { if (!IS.busy.has(project)) void load(project); };
})();
