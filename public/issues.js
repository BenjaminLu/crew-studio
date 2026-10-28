// The Board's Issues view (#/board/issues; docs/units/board.md, "Issues"): a project's open GitHub issues as the
// issue-triage workflow left them (src/domain/issue-triage.ts). Work packages first, each one person's work done in
// order; then what the two investigators did not agree on; then the issues nobody has investigated yet.
// Issue titles are untrusted text: they only ever go into text nodes and title attributes, never into markup.
(() => {
const IS = { projects: null, rec: new Map(), project: null, sel: null, tab: "packages", life: 0 };
const api = async (u) => { const r = await fetch(u); let j = {}; try { j = await r.json(); } catch {} if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j; };
const ghIssue = (repo, n) => `https://github.com/${repo}/issues/${n}`;
const STATUS = { proposed: ["Waiting for approval", "等核准", "you"], approved: ["Approved", "已核准", "run"], declined: ["Declined", "已退回", "all"], stale: ["An issue changed: triage again", "issue 已變更，需重新分類", "all"] };
const KIND = { ordered: ["In order", "照順序"], unordered: ["Owner picks the order", "負責人決定順序"], "one-change": ["One change", "一次改動"], single: ["One issue", "單張"], recheck: ["Recheck, maybe fixed", "可能已修，待複測"] };

async function load() {
  const life = ++IS.life;
  try {
    const l = await api("/api/issue-triage"); if (life !== IS.life) return;
    IS.projects = l.projects || [];
    IS.project = IS.projects.some((p) => p.project === IS.project) ? IS.project : IS.projects[0]?.project ?? null;
    if (IS.project) { const r = await api(`/api/issue-triage/${encodeURIComponent(IS.project)}`); if (life !== IS.life) return; IS.rec.set(IS.project, r); }
  } catch { IS.projects ??= []; }
  if (S.route?.name === "board" && S.route.arg === "issues") render();
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

const WORK = { open: ["In progress", "進行中"], merged: ["Merged", "已合併"], closed: ["Ended without a merge", "沒有合併就結束"] };
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
  return h("button", { type: "button", class: `is-row g-${st[2]}`, "aria-pressed": String(on), "data-pack": p.id, onclick: () => { IS.sel = p.id; render(); } },
    h("span", { class: "is-id mono" }, p.id),
    h("span", { class: "is-what" }, h("b", {}, tagOf(rec, p) || T("Work package", "工作包")), h("span", {}, area(rec, p))),
    h("span", { class: "is-n num" }, String(n)),
    h("span", { class: "is-kind" }, T(...(KIND[p.kind] || KIND.single))),
    h("span", { class: "is-status" }, h("i", { class: "tb-dot" }), T(st[0], st[1]), p.security ? h("span", { class: "is-sec" }, T("Security", "安全")) : null));
}

function packDetail(rec, p) {
  if (!p) return h("aside", { class: "tb-detail is-detail" }, h("p", { class: "faint" }, T("Pick a work package.", "選一個工作包。")));
  const order = p.order.length ? p.order : p.members;
  return h("aside", { class: "tb-detail is-detail", "data-detail": p.id },
    h("div", {}, h("span", { class: "faint" }, `${p.id} · ${T(...(KIND[p.kind] || KIND.single))}`), h("h2", {}, tagOf(rec, p) || T("Work package", "工作包")), h("p", { class: "faint mono" }, area(rec, p))),
    p.why ? h("p", { class: "is-why" }, p.why) : null,
    h("p", { class: "is-how" }, p.kind === "recheck"
      ? T("Do not change code. A person rechecks it with the issue's own input; only then is it closed.", "不改程式碼。由人用 issue 原本的輸入複測，通過後才關。")
      : T("One person works these in order, one pull request each. Each issue's repro becomes its test: it fails before the fix and passes after.", "同一個人照順序做，一張一個 PR。每張的重現方式就是它的測試：修之前失敗，修之後通過。") + (p.security ? T(" Security issues are referenced, not closed, by the pull request; they close after a recheck.", " 安全 issue 在 PR 裡只寫 Refs，合併後複測通過才關。") : "")),
    p.status === "approved" && p.kind !== "recheck" ? h("p", { class: "is-next" }, T(`To start the next issue, tell Firstmate: “work on ${p.id}”. You approve its Task on the dispatch card.`, `要開始下一張，跟 Firstmate 說：「做 ${p.id}」。任務會出 dispatch 卡給你核准。`)) : null,
    h("ol", { class: "is-list" }, order.map((n, i) => issueLine(rec, n, order.length > 1 && p.kind === "ordered" ? String(i + 1) : "·", p.id))),
    p.members.filter((n) => !order.includes(n)).length ? h("p", { class: "faint" }, T("Tracking issue: ", "總卡：") + p.members.filter((n) => !order.includes(n)).map((n) => `#${n}`).join(" ")) : null);
}

function humanList(rec) {
  return h("div", { class: "card is-human" }, rec.toHuman.length ? rec.toHuman.map((x) => h("div", { class: "is-hrow" },
    h("div", { class: "is-hissues" }, x.issues.map((n) => h("a", { href: ghIssue(rec.repository, n), target: "_blank", rel: "noopener noreferrer", class: "mono", title: rec.issues[n]?.title || "" }, `#${n}`))),
    h("span", {}, x.reason))) : h("p", { class: "faint" }, T("The investigators agreed on everything they looked at.", "兩位調查員看過的都有共識。")));
}

function pendingList(rec) {
  const rest = Object.entries(rec.issues).filter(([, i]) => !i.investigated).map(([n, i]) => [Number(n), i]).sort((a, b) => a[0] - b[0]);
  return h("div", { class: "card is-pending" }, rest.length ? h("ul", {}, rest.map(([n, i]) => h("li", {}, h("a", { href: ghIssue(rec.repository, n), target: "_blank", rel: "noopener noreferrer", class: "mono" }, `#${n}`), h("span", { class: "is-title", title: i.title }, i.title), i.security ? h("span", { class: "is-sec" }, T("Security", "安全")) : null)))
    : h("p", { class: "faint" }, T("Every open issue has been investigated.", "每張 open issue 都調查過了。")));
}

function viewIssues() {
  if (IS.projects === null) { void load(); }
  const rec = IS.project ? IS.rec.get(IS.project) : null;
  const head = h("div", { class: "phead" },
    h("div", {}, h("h1", {}, T("Board", "看板")), h("p", {}, rec && rec.schema ? T(`${rec.repository}: ${rec.open} open, ${rec.investigated.length} investigated, ${rec.packages.length} work packages`, `${rec.repository}：${rec.open} 張 open、已調查 ${rec.investigated.length} 張、${rec.packages.length} 個工作包`) : T("Open issues by work package", "依工作包看 open issue"))),
    h("div", { class: "actions" }, boardViews("issues"),
      IS.projects?.length > 1 ? h("select", { "aria-label": T("Project", "專案"), onchange: (e) => { IS.project = e.target.value; IS.sel = null; void load(); } }, IS.projects.map((p) => h("option", { value: p.project, selected: p.project === IS.project }, p.project))) : null));
  if (IS.projects === null) return h("div", { class: "page bd-page is-page" }, head, h("p", { class: "faint" }, T("Loading…", "載入中…")));
  if (!rec || !rec.schema) return h("div", { class: "page bd-page is-page" }, head, h("div", { class: "empty" }, h("b", {}, T("No issue triage yet", "還沒有 issue 分類")),
    h("span", {}, T("Ask Firstmate to triage a GitHub project's open issues: two investigators read the code, and the work packages they agree on appear here.", "請 Firstmate 分類一個 GitHub 專案的 open issue：兩位調查員會讀程式碼，他們有共識的工作包會出現在這裡。"))));
  const packs = rec.packages, pending = Object.values(rec.issues).filter((i) => !i.investigated).length;
  if (!packs.some((p) => p.id === IS.sel)) IS.sel = packs[0]?.id ?? null;
  const tabs = [["packages", "Work packages", "工作包", packs.length], ["human", "For you to judge", "要你判斷", rec.toHuman.length], ["pending", "Not investigated", "待調查", pending]];
  return h("div", { class: "page bd-page is-page", "data-issues": rec.project },
    head,
    h("p", { class: "faint" }, T(`Code read at ${rec.commit.slice(0, 7)} · issues read ${rec.snapshot.fetchedAt.slice(0, 16).replace("T", " ")}`, `程式碼版本 ${rec.commit.slice(0, 7)}・issue 讀取於 ${rec.snapshot.fetchedAt.slice(0, 16).replace("T", " ")}`)),
    h("div", { class: "tb-tabs", role: "tablist" }, tabs.map(([k, en, zh, n]) => h("button", { type: "button", role: "tab", class: "tb-tab", "aria-selected": String(IS.tab === k), "data-is-tab": k, onclick: () => { IS.tab = k; render(); } }, T(en, zh), h("span", { class: "tb-count num" }, String(n))))),
    IS.tab === "packages" ? h("div", { class: "tb-body is-body" },
      h("div", { class: "card is-packs", role: "list" }, packs.length ? packs.map((p) => packRow(rec, p, p.id === IS.sel)) : h("p", { class: "faint" }, T("No work package both investigators agree on yet.", "還沒有兩位調查員都同意的工作包。"))),
      packDetail(rec, packs.find((p) => p.id === IS.sel)))
    : IS.tab === "human" ? humanList(rec) : pendingList(rec));
}

// the Board's two views, Tasks and Issues: the same page, two lists
function boardViews(on) {
  return h("div", { class: "is-views", role: "group", "aria-label": T("Board view", "看板內容") },
    h("a", { href: "#/board", class: "btn", "aria-current": on === "tasks" ? "page" : null }, T("Tasks", "任務")),
    h("a", { href: "#/board/issues", class: "btn", "aria-current": on === "issues" ? "page" : null }, T("Issues", "Issues")));
}
window.crewBoardViews = boardViews;
{ const base = routes.board; routes.board = (arg) => (arg === "issues" ? viewIssues() : base(arg)); }
addEventListener("hashchange", () => { if (/^#\/board\/issues/.test(location.hash)) { IS.projects = null; void load(); } });
})();
