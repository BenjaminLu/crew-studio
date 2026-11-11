// Pull requests (#/prs, docs/units/pr-watch.md): one list of every open pull request the captain is on, across projects
// and repositories, what each waits for and who. Data from GET /api/prs (the last refresh; the server reads GitHub, never
// this page). The page asks for a refresh when it opens and on Refresh; the server also refreshes every 5 minutes and
// tells the page (live event "prs"). No read/unread state: a row that changed in the latest refresh carries a left bar
// and what changed until it changes again. Every text from GitHub is set as text (h() text nodes), never as HTML.
// Writes: the watch list, settings, order, dependencies and groups (Studio's own record); the dependency block on GitHub
// only through the captain-only card POST /api/prs/apply starts. Loaded before backbone.js.
(() => {
P.grip ??= '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>';
const PW = { data: null, err: null, busy: false, tab: "all", onPage: false, adding: false, addErr: null, drag: null };
const getJ = async (u) => { const r = await fetch(u); let j = {}; try { j = await r.json(); } catch {} if (!r.ok) throw new Error(T(j.error || `HTTP ${r.status}`, j.tw || j.error || `HTTP ${r.status}`)); return j; };
const postJ = async (u, b) => { const r = await fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b ?? {}) }); let j = {}; try { j = await r.json(); } catch {} if (!r.ok || j.error && typeof j.error === "string") throw new Error(T(j.error || `HTTP ${r.status}`, j.tw || j.error || `HTTP ${r.status}`)); return j; };
const LX = (o) => (o ? T(o.en ?? "", o.tw ?? o.en ?? "") : "");
const ID = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)#([1-9]\d{0,9})$/;
// addresses are built here from validated parts; nothing GitHub returned is used as an address
const ghPr = (id) => { const m = ID.exec(String(id || "")); return m ? `https://github.com/${m[1]}/${m[2]}/pull/${m[3]}` : null; };
const ghIssue = (ref) => { const m = ID.exec(String(ref || "")); return m ? `https://github.com/${m[1]}/${m[2]}/issues/${m[3]}` : null; };
const ghRepo = (repo) => (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(repo || "")) ? `https://github.com/${repo}` : null);
// a pull request named compactly: "#n" in the row's own repository, "repo#n" elsewhere (the full name is the title)
const short = (id, repo) => { const m = ID.exec(String(id || "")); if (!m) return String(id || ""); return repo && `${m[1]}/${m[2]}`.toLowerCase() === String(repo).toLowerCase() ? `#${m[3]}` : `${m[2]}#${m[3]}`; };
const extLink = (href, text, attrs = {}) => href ? h("a", { href, target: "_blank", rel: "noopener noreferrer", ...attrs }, text) : h("span", attrs, text);
const MARKS = ["", "p2", "p3", "p6"];
const markClass = (s) => { let x = 0; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) >>> 0; return MARKS[x % MARKS.length]; };
const pmark = (project) => project ? h("span", { class: `pmark ${markClass(project.id)}`.trim(), title: T(`Project ${project.name}`, `專案 ${project.name}`) }, String(project.name || project.id).slice(0, 1).toUpperCase())
  : h("span", { class: "pmark pw-unreg", title: T("Not a registered Studio project", "沒有註冊成 Studio 專案的 repo") }, "·");
const ago = (iso) => { const t = Date.parse(iso || ""); if (!t) return ""; const m = Math.max(0, Math.round((Date.now() - t) / 60000)); return m === 0 ? T("just now", "剛剛") : m < 60 ? T(`${m} min ago`, `${m} 分鐘前`) : T(`${Math.round(m / 60)} h ago`, `${Math.round(m / 60)} 小時前`); };
const day = (iso) => { const d = new Date(iso || ""); return isNaN(d) ? "" : `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, "0")}`; };
// one toast at a time: a new one replaces the last instead of stacking on it
function flash(msg, link) { document.querySelectorAll("body > .toast").forEach((t) => t.remove()); toast(link ? h("span", {}, msg, " ", h("a", { href: link.href, class: "pw-toastlink" }, link.text)) : msg); }
async function copy(text) { try { await navigator.clipboard.writeText(text); return true; } catch {
  const ta = h("textarea", { style: "position:fixed;left:-9999px" }); ta.value = text; document.body.append(ta); ta.select(); let ok = false; try { ok = document.execCommand("copy"); } catch {} ta.remove(); return ok; } }

// ---------- words ----------
const whoWord = (w) => w === "captain" ? T("you", "你") : w === "(rules unreadable)" ? T("rules unreadable", "讀不到規則") : w === "(no evidence source set)" ? T("no evidence source set", "未設定證據來源") : w;
const missWord = (m) => m.kind === "count" ? T(`${m.n} more approval${m.n === 1 ? "" : "s"}`, `還要 ${m.n} 個 approve`) : m.kind === "owner" ? m.who.join(T(" or ", " 或 ")) : m.kind === "team" ? m.who : T("rules unreadable", "讀不到規則");
const TONE = { hold: "", fix: "bad", review: "", dependency: "warn", deploy: "warn", test: "warn", approve: "human", merge: "ok" };
function nextWord(n) {
  if (n.rule === "draft") return T("On hold (draft)", "暫緩（draft）");
  if (n.rule === "changes") return T("Fix the review comments", "修正 reviewer 意見");
  if (n.rule === "failed") return T("Fix the failing tests", "修正失敗的測試");
  if (n.rule === "required") return T("Wait for the review", "等 review");
  if (n.rule === "dependency") return T("Wait for the dependency", "等依賴");
  if (n.rule === "environment") return T("Deploy for testing", "部署去測");
  if (n.rule === "evidence") return n.reason === "unknown-commit" ? T("Test (the evidence names no commit)", "測試（證據沒指明 commit）") : n.since ? T(`Test only the change since ${n.since}`, `只驗 ${n.since} 之後的改動`) : n.reason === "unclassified" ? T("Confirm the test verdict", "確認測試結論") : n.reason === "code-only" ? T("Test (code review only so far)", "測試（目前只審了 code）") : T("Test", "測試");
  if (n.rule === "approvals") return T("Approve", "等 approve");
  return T("Ready to merge", "可合併");
}
const TABS = [["all", "All", "全部"], ["approve", "Approve", "等 approve"], ["test", "Test", "等測試"], ["fix", "Fix", "等修正"], ["dependency", "Dependency", "等依賴"], ["merge", "Mergeable", "可合併"], ["hold", "On hold", "暫緩"]];
const reviewWord = (s) => s === "APPROVED" ? T("approved", "approve") : s === "CHANGES_REQUESTED" ? T("changes requested", "要求修改") : s === "DISMISSED" ? T("dismissed", "撤銷") : T("commented", "留言");
const verdictWord = (v) => ({ pass: T("pass", "通過"), conditional: T("conditional pass", "有條件通過"), fail: T("fail", "不通過"), "code-only": T("code review only", "只審 code"), unclassified: T("unclassified", "無法分類") })[v] || v;
function changeWord(w) {
  switch (w.k) {
    case "new": return T("joined the list", "加入清單");
    case "head": return T(`new commits (head ${w.sha})`, `有新 commit（head ${w.sha}）`);
    case "title": return T("title changed", "標題改了");
    case "draft": return w.draft ? T("back to draft", "改回 draft") : T("ready for review", "轉為 ready");
    case "review": return T(`${w.login} ${reviewWord(w.state.split(":")[0])}`, `${w.login} ${reviewWord(w.state.split(":")[0])}`);
    case "evidence": return T(`test evidence: ${verdictWord(String(w.verdict).split(":")[0])}`, `測試證據：${verdictWord(String(w.verdict).split(":")[0])}`);
    case "env": return w.on ? T(`runs on ${w.name}`, `${w.name} 跑著它`) : T(`left ${w.name}`, `${w.name} 不再跑它`);
    case "next": return T(`next step ${w.from} → ${w.to}`, `下一步 ${w.from} → ${w.to}`);
  }
  return "";
}

// ---------- data ----------
function setCount(n) { const c = document.getElementById("navPrs"); if (!c) return; c.hidden = !n; c.textContent = n ? String(n) : ""; }
// a live update never redraws the list under a drag: it waits for the drop
// a live update never redraws the list under a drag, and gives the keyboard focus back to the row that had it
const redraw = () => { if (S.route?.name !== "prs") return; if (PW.drag) { PW.later = true; return; }
  const had = document.activeElement?.closest?.("[data-prs-row]")?.dataset.prsRow; render();
  if (had && document.activeElement === document.body) document.querySelector(`[data-prs-row="${CSS.escape(had)}"]`)?.focus({ preventScroll: true }); };
async function load() {
  try { PW.data = await getJ("/api/prs"); PW.err = null; setCount(PW.data.count); } catch (e) { PW.err = e.message; }
  redraw();
}
async function refresh() {
  if (PW.busy) return; PW.busy = true; redraw();
  try { PW.data = await postJ("/api/prs/refresh", {}); PW.err = null; setCount(PW.data.count); } catch (e) { PW.err = e.message; } finally { PW.busy = false; }
  redraw();
}
async function act(u, b, done) {
  try { PW.data = await postJ(u, b); setCount(PW.data.count); if (done) flash(done); } catch (e) { flash(e.message); }
  redraw();
}
const enter = () => { const on = S.route?.name === "prs"; if (on && !PW.onPage) { PW.onPage = true; load().then(refresh); } else if (!on) PW.onPage = false; };
addEventListener("hashchange", () => setTimeout(enter, 0)); setTimeout(enter, 0);
fetch("/api/prs/count").then((r) => (r.ok ? r.json() : null)).then((j) => j && setCount(j.count)).catch(() => {});
window.liveListen?.("prs", (m) => { let d = {}; try { d = JSON.parse(m.data); } catch {} if (typeof d.count === "number") setCount(d.count); if (S.route?.name === "prs" && !d.refreshing) load(); });
setInterval(() => { const el = document.querySelector("[data-prs-refreshed]"); if (el && PW.data) el.textContent = refreshedText(PW.data); }, 30000);
const refreshedText = (d) => d.refreshedAt ? T(`refreshed ${ago(d.refreshedAt)} · every ${Math.round(d.intervalMs / 60000) || 1} min`, `${ago(d.refreshedAt)}刷新 · 每 ${Math.round(d.intervalMs / 60000) || 1} 分鐘`) : T("not refreshed yet", "還沒刷新");

// ---------- the page ----------
function view() {
  const d = PW.data;
  const head = h("div", { class: "phead" }, h("div", {}, h("h1", {}, T("Pull requests", "Pull requests")),
    h("p", {}, T("One list across projects and repositories. Paste a repository address to watch the pull requests you opened or are assigned to there; paste a pull request address to watch just that one.", "一份清單，跨專案、跨 repo。貼上 repo 網址就追蹤你在那個 repo 開的或被指派的 PR；貼上 PR 網址就只追蹤那一個。"))));
  if (!d) return h("div", { class: "page pw-page", "data-prs-page": "", "data-loading": "1" }, head, PW.err ? h("div", { class: "card x-pad pw-loaderr", role: "alert", "data-prs-load-error": "" }, h("span", {}, PW.err),
    h("button", { class: "btn", "data-prs-retry": "", onclick: () => { PW.err = null; render(); load().then(refresh); } }, icon("refresh"), T("Try again", "再試一次"))) : h("div", { class: "skel", style: "height:180px" }));
  const rows = d.rows || [], counts = {}; for (const r of rows) counts[r.next.kind] = (counts[r.next.kind] || 0) + 1;
  const shown = rows.filter((r) => PW.tab === "all" || r.next.kind === PW.tab);
  return h("div", { class: "page pw-page", "data-prs-page": "" }, head,
    h("section", { "aria-labelledby": "pwListH" },
      h("div", { class: "sec-head" }, h("h2", { id: "pwListH", class: "sr" }, T("The list", "清單")), h("span", { class: "x-grow" }),
        h("span", { class: "faint", "data-prs-refreshed": "" }, PW.busy || d.refreshing ? T("reading GitHub…", "讀取 GitHub 中…") : refreshedText(d)),
        h("button", { class: "btn", "data-prs-refresh": "", disabled: PW.busy, onclick: refresh }, icon("refresh"), PW.busy ? T("Reading…", "讀取中…") : T("Refresh", "重新整理")),
        h("button", { class: "btn ghost", "data-prs-md": "", title: T("Copy the rows this tab shows as Markdown", "把這個分頁的列複製成 Markdown"), onclick: async () => { flash(await copy(markdown(visibleRows())) ? T("Copied as Markdown", "已複製成 Markdown") : T("Could not copy", "無法複製")); } }, icon("copy"), T("Copy as Markdown", "複製成 Markdown")),
        h("button", { class: "btn ghost icon", "data-prs-settings": "", "aria-label": T("Settings", "設定"), title: T("Settings", "設定"), onclick: settingsModal }, icon("tool"))),
      statusLine(d),
      watchCard(d),
      proposalCard(d),
      h("div", { class: "tb-tabs pw-tabs", role: "group", "aria-label": T("Filter by next step", "依下一步篩選") }, TABS.map(([k, en, tw]) =>
        h("button", { class: "tb-tab", "aria-pressed": String(PW.tab === k), "aria-selected": String(PW.tab === k), "data-prs-tab": k, onclick: () => { PW.tab = k; render(); } }, T(en, tw), h("span", { class: "tb-count num" }, String(k === "all" ? rows.length : counts[k] || 0))))),
      h("div", { class: "card pw-tbl", role: "table", "aria-label": T("Pull requests", "Pull requests"), "data-prs-table": "" },
        h("div", { class: "pw-row h", role: "row" }, ...["", "#", T("Pull request", "Pull request"), T("Next step · waits on", "下一步 · 等誰"), T("Missing", "還缺"), T("Depends on", "依賴"), T("Test evidence", "測試證據"), T("Environments", "環境"), T("Reviews", "Reviews"), T("Issues", "Issue"), T("Group", "組")].map((t) => h("span", { role: "columnheader" }, t))),
        shown.length ? shown.map((r) => rowView(r, d)) : h("div", { class: "pj-empty-row", "data-prs-empty": "" }, rows.length ? T("No pull request under this filter.", "這個篩選下沒有 pull request。") : T("Nothing watched yet, or nothing open: paste a repository or pull request address above.", "還沒有追蹤任何東西，或沒有開著的 PR：在上方貼上 repo 或 PR 網址。"))),
      h("p", { class: "pw-foot faint" }, T("Hover a row and press × to drop it (a pull request that came in through its repository is recorded as excluded, and can be restored). Drag the handle (or Alt+↑/↓) to reorder; click a row for its details. The next step is the first matching rule, top to bottom; no model decides it.",
        "滑過一列按 × 從清單移除（從 repo 帶進來的 PR 會記成「已排除」，可還原）。拖拉把手（或 Alt+↑/↓）調整順序；點一列看細節。下一步由固定規則從上往下取第一條符合的，不靠模型。"))));
}
function statusLine(d) {
  const lines = [];
  if (!d.enabled) lines.push(T("GitHub polling is off in this Studio (CREW_GH=0).", "這個 Studio 關閉了 GitHub 輪詢（CREW_GH=0）。"));
  else if (!d.connected && (d.watch.repos.length || d.watch.prs.length)) lines.push(T("GitHub is not connected: Studio has no token (CREW_GITHUB_TOKEN, a token saved in Studio, or gh auth token).", "GitHub 尚未連線：Studio 沒有權杖（CREW_GITHUB_TOKEN、存在 Studio 的權杖，或 gh auth token）。"));
  if (d.error) lines.push(LX(d.error) + (d.backoffUntil ? T(` Next try after ${new Date(d.backoffUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`, ` ${new Date(d.backoffUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} 之後再試。`) : ""));
  for (const e of d.errors || []) lines.push(`${e.target}: ${LX(e)}`);
  if (PW.err) lines.push(PW.err);
  return lines.length ? h("div", { class: "pw-status", role: "status", "data-prs-status": "" }, lines.map((l) => h("div", {}, icon("alert", "ic sm"), h("span", {}, l)))) : null;
}
function watchCard(d) {
  const input = h("input", { class: "input", id: "pwAdd", type: "url", maxlength: 300, autocomplete: "off", "aria-label": T("GitHub repository or pull request address", "GitHub repo 或 pull request 網址"),
    placeholder: T("Paste a GitHub repository or pull request address: https://github.com/<owner>/<repo> or …/pull/<n>", "貼上 GitHub repo 或 PR 網址：https://github.com/<owner>/<repo> 或 …/pull/<n>") });
  const add = async (e) => { e.preventDefault(); const url = input.value.trim(); if (!url || PW.adding) return; PW.adding = true; PW.addErr = null; let added = false;
    try { PW.data = await postJ("/api/prs/watch", { url }); setCount(PW.data.count); const a = PW.data.added;
      flash(a?.kind === "pr" ? T(`Watching ${a.repo}#${a.number}`, `開始追蹤 ${a.repo}#${a.number}`) : T(`Watching ${a?.repo}: the pull requests you opened or are assigned to, read on the next refresh`, `開始追蹤 ${a?.repo}：你開的或被指派的 PR，下一次刷新讀取`));
      input.value = ""; added = true; setTimeout(load, 1500); }
    catch (err) { PW.addErr = err.message; } finally { PW.adding = false; render();
      // a live redraw while the request ran may have carried the address into a new field: clear the one on the page now
      if (added) { const cur = document.getElementById("pwAdd"); if (cur) cur.value = ""; } } };
  const chips = [
    ...d.watch.repos.map((w) => h("span", { class: "chip", "data-prs-repo": w.repo }, pmark(w.project), extLink(ghRepo(w.repo), w.repo), h("span", { class: "faint num" }, String(w.count)),
      h("button", { class: "pw-x", "data-prs-unwatch-repo": w.repo, "aria-label": T(`Stop watching ${w.repo}`, `不再追蹤 ${w.repo}`), title: T("Stop watching this repository", "不再追蹤這個 repo"), onclick: () => act("/api/prs/unwatch", { repo: w.repo }, T(`Stopped watching ${w.repo}`, `不再追蹤 ${w.repo}`)) }, icon("x")))),
    ...d.watch.prs.map((w) => h("span", { class: "chip", "data-prs-single": w.id }, icon("pr", "ic sm"), extLink(ghPr(w.id), w.id), w.state && w.state !== "open" ? h("span", { class: "faint" }, w.state === "merged" ? T("merged", "已合併") : T("closed", "已關閉")) : null,
      h("button", { class: "pw-x", "data-prs-unwatch-pr": w.id, "aria-label": T(`Stop watching ${w.id}`, `不再追蹤 ${w.id}`), title: T("Stop watching this pull request", "不再追蹤這個 PR"), onclick: () => act("/api/prs/unwatch", { pr: w.id }, T(`Stopped watching ${w.id}`, `不再追蹤 ${w.id}`)) }, icon("x")))),
    d.watch.excluded.length ? h("button", { class: "chip", "data-prs-restore": "", title: d.watch.excluded.join(", "), onclick: () => act("/api/prs/restore", {}, T("Excluded pull requests restored", "已還原排除的 PR")) },
      T(`excluded ${d.watch.excluded.length} · restore`, `已排除 ${d.watch.excluded.length} 個 · 還原`)) : null];
  return h("div", { class: "card pw-watch" },
    h("form", { class: "pw-add", "data-prs-add": "", onsubmit: add }, icon("link"), input, h("button", { class: "btn primary", type: "submit", disabled: PW.adding }, PW.adding ? T("Adding…", "加入中…") : T("Add", "加入"))),
    PW.addErr ? h("p", { class: "pw-err", role: "alert", "data-prs-add-error": "" }, PW.addErr) : null,
    chips.filter(Boolean).length ? h("div", { class: "chips" }, chips) : null);
}
function proposalCard(d) {
  const p = d.proposal; if (!p?.pending || !d.rows.length) return null;
  const deps = p.deps.flatMap((x) => x.on.map((o) => ({ pr: x.pr, on: o.on, why: o.why })));
  return h("div", { class: "card pw-prop", "data-prs-proposal": "" },
    h("span", { class: "need-ic pw-prop-ic" }, icon("wand")),
    h("div", {}, h("b", {}, deps.length ? T(`Proposed order and ${deps.length} dependenc${deps.length === 1 ? "y" : "ies"}, not accepted yet`, `建議的順序與 ${deps.length} 個依賴，尚未確認`) : T("Proposed order, not accepted yet", "建議的順序，尚未確認")),
      h("ul", { class: "pw-why" }, deps.map((x) => h("li", { "data-prs-proposed-dep": `${x.pr}>${x.on}` }, h("b", {}, x.pr), T(" depends on ", " 依賴 "), h("b", {}, x.on), ": ", x.why)),
        h("li", { class: "faint" }, T("The order puts every dependency first, then pull requests that change the same files or link the same issue, older first. These come from the pull requests themselves, not from a model.", "順序先排依賴，再排改到同樣檔案或連到同一個 issue 的，舊的先。這些都來自 PR 本身，不是模型猜的。")))),
    h("div", { class: "pw-acts" }, h("button", { class: "btn primary", "data-prs-accept": "", onclick: () => act("/api/prs/accept", {}, T("Accepted: the order and dependencies are Studio's record; nothing was written to GitHub", "已接受：順序與依賴存在 Studio，尚未寫入 GitHub")) }, T("Accept", "接受")),
      deps.length ? h("button", { class: "btn", "data-prs-accept-apply": "", onclick: async () => { await act("/api/prs/accept", {}); const ids = [...new Set(deps.map((x) => x.pr))]; applyModal(ids); } }, T("Accept and apply to the pull requests…", "接受並套用到 PR…")) : null));
}
function rowView(r, d) {
  const c = r.changed, n = r.next, miss = r.approvals?.missing || [];
  const el = h("div", { class: `pw-row${c ? " chg" : ""}`, role: "row", tabindex: "0", draggable: "true", "data-prs-row": r.id, "data-next": n.kind, "aria-label": `${r.id} ${r.title}`,
    onclick: (e) => { if (e.target.closest("button,a,select,input")) return; detail(r); },
    onkeydown: (e) => { if (e.target !== el) return; if (e.key === "Enter") { e.preventDefault(); detail(r); } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) { e.preventDefault(); move(r.id, e.key === "ArrowUp" ? -1 : 1); } },
    ondragstart: (e) => { PW.drag = r.id; e.dataTransfer.setData("text/plain", r.id); el.classList.add("dragging"); },
    ondragend: () => { PW.drag = null; el.classList.remove("dragging"); if (PW.later) { PW.later = false; redraw(); } },
    ondragover: (e) => { if (!PW.drag) return; e.preventDefault(); el.classList.add("over"); },
    ondragleave: () => el.classList.remove("over"),
    ondrop: (e) => { e.preventDefault(); el.classList.remove("over"); const from = PW.drag || e.dataTransfer.getData("text/plain"); PW.drag = null; PW.later = false; if (from && from !== r.id) dropOn(from, r.id); } },
    h("span", { class: "pw-grip", title: T("Drag to reorder", "拖拉排序"), "aria-hidden": "true" }, icon("grip")),
    h("span", { class: `tid${r.proposedPosition ? " pw-proposed-pos" : ""}`, title: r.proposedPosition ? T("Proposed position", "建議的位置") : "" }, String(r.position)),
    h("span", { class: "pw-pr", role: "cell" },
      h("button", { class: "pw-x pw-unw", "data-prs-drop": r.id, title: T("Remove from the list", "從清單移除"), "aria-label": T(`Remove ${r.id} from the list`, `從清單移除 ${r.id}`), onclick: () => act("/api/prs/unwatch", { pr: r.id }, T(`${r.id} removed from the list`, `${r.id} 已從清單移除`)) }, icon("x")),
      h("span", { class: "pw-pid" }, pmark(r.project), extLink(ghPr(r.id), short(r.id, null), { "data-prs-link": "", title: r.id }), r.single ? h("span", { class: "badge", title: T("Added by its own address", "用 PR 網址單獨加入") }, T("single", "單獨")) : null, r.draft ? h("span", { class: "badge" }, "draft") : null),
      h("small", { class: "pw-title" }, r.title),
      c ? h("small", { class: "pw-chg", "data-prs-changed": "" }, T(`changed ${ago(c.at)}: `, `${ago(c.at)}變更：`), c.what.map(changeWord).filter(Boolean).join(T("; ", "；"))) : null),
    h("span", { class: "pw-next", role: "cell" }, h("b", { class: `t-${TONE[n.kind] || ""}`, "data-prs-next": n.rule }, nextWord(n)),
      n.rule === "approvals" && !r.approvals?.readable ? h("small", {}, T("approval rules could not be read", "讀不到 approve 規則")) : h("small", {}, T("waits on ", "等 "), waitsOn(r).join(T(", ", "、")))),
    h("span", { role: "cell", class: "pw-misscell" }, miss.length && !r.draft ? (() => { const label = miss[0].kind === "unreadable" ? T("rules unreadable", "讀不到規則") : miss.map(missWord).join(" · ");
      return h("button", { class: "badge human pw-cta", "data-prs-cta": r.id, "aria-haspopup": "true", title: miss[0].kind === "unreadable" ? LX({ en: miss[0].reason, tw: miss[0].tw }) : label, onclick: (e) => { e.stopPropagation(); ctaMenu(e.currentTarget, r); } },
        h("span", { class: "pw-ctat" }, label), h("span", { "aria-hidden": "true" }, " ▾")); })() : h("span", { class: "faint" }, "—")),
    h("span", { role: "cell" }, depCell(r)),
    h("span", { role: "cell" }, evBadge(r.evidence)),
    h("span", { class: "pw-envs", role: "cell" }, r.envs.length ? r.envs.map((e) => h("span", { class: `pw-env${e.on ? " on" : ""}${e.on === null ? " unk" : ""}`, title: e.on ? T(`${e.name}: runs this head`, `${e.name}：跑著這個 head`) : e.on === null ? T(`${e.name}: could not be read`, `${e.name}：讀不到`) : T(`${e.name}: not this head`, `${e.name}：沒有`) }, e.name)) : h("span", { class: "faint" }, "—")),
    h("span", { class: "pw-revs", role: "cell" }, r.reviews.length ? r.reviews.map((x) => h("span", { class: `badge ${x.state === "APPROVED" && !x.stale ? "ok" : x.state === "CHANGES_REQUESTED" ? "bad" : ""}`, title: `${reviewWord(x.state)}${x.stale ? T(" (an older head)", "（較舊的 head）") : ""}${x.author ? T(" (the author: does not count)", "（作者本人：不算）") : ""}` },
      x.login, x.state === "CHANGES_REQUESTED" ? " ✕" : x.stale ? T(" (stale)", "（舊）") : "")) : h("span", { class: "faint" }, "—")),
    h("span", { class: "pw-iss", role: "cell" }, r.issues.length ? r.issues.map((i) => h("span", { class: "pw-iss1" }, extLink(ghIssue(i.ref), short(i.ref, null), { title: `${i.ref} ${i.title || ""}${i.state ? ` (${i.state})` : ""}${i.external ? T(" · outside the watched repositories, read only", " · 不在監控的 repo，只讀") : ""}` }), i.external ? h("small", {}, T("external", "外部")) : null)) : h("span", { class: "faint" }, "—")),
    h("span", { role: "cell" }, groupCell(r, d)));
  return el;
}
const waitsOn = (r) => r.next.rule === "dependency" ? r.next.who.map((x) => short(x, r.repo)) : r.next.rule === "approvals" && r.approvals?.readable ? r.approvals.missing.map(missWord) : r.next.who.map(whoWord);
function evBadge(e) {
  if (!e) return h("span", { class: "faint", "data-prs-ev": "none" }, "—");
  const when = e.at ? ` · ${day(e.at)}` : "";
  if (e.verdict === "fail") return h("span", { class: "badge bad", "data-prs-ev": "fail" }, T("fail", "不通過"), when);
  if (e.verdict === "unclassified") return h("span", { class: "badge", "data-prs-ev": "unclassified" }, T("unclassified", "無法分類"));
  if (e.verdict === "code-only") return h("span", { class: "badge warn", "data-prs-ev": "code-only" }, T("code review only", "只審 code"));
  if (e.covers === "unknown") return h("span", { class: "badge warn", "data-prs-ev": "unknown", title: T("The evidence names no commit, and Studio did not see this head before it", "證據沒指明 commit，Studio 也沒在它之前看過這個 head") }, T("commit not named", "沒指明 commit"));
  if (e.covers === "older") return h("span", { class: "badge warn", "data-prs-ev": "older", title: e.since ? T(`tested ${e.since}`, `驗的是 ${e.since}`) : "" }, T("older head", "舊 head"));
  return h("span", { class: "badge ok", "data-prs-ev": e.verdict }, e.verdict === "conditional" ? T("conditional", "有條件") : T("pass", "通過"), when);
}
function depCell(r) {
  const dp = r.deps;
  if (dp.drift) return h("button", { class: "badge warn pw-depbtn", "data-prs-drift": r.id, onclick: (e) => { e.stopPropagation(); driftModal(r); } }, icon("alert", "ic sm"), T("the hint on GitHub changed", "GitHub 上的提示被改了"));
  const kids = [...dp.on.filter(() => dp.source !== "proposal").map((x) => h("span", { class: `badge ${x.done ? "ok" : ""}`, title: `${x.id} · ${x.state}` }, short(x.id, r.repo))),
    ...dp.proposed.map((x) => h("span", { class: "pw-propdep", title: `${x.on}: ${x.why}` }, h("span", { class: "badge pw-dashed" }, short(x.on, r.repo)), h("span", { class: "pw-prop-tag" }, T("proposed", "建議"))))];
  return h("button", { class: "pw-depbtn", "data-prs-deps": r.id, title: T("Edit the dependencies", "編輯依賴"), onclick: (e) => { e.stopPropagation(); depModal(r); } },
    kids.length ? kids : h("span", { class: "faint" }, T("none", "無")), dp.applied ? h("span", { class: "pw-applied", title: T("Written into the pull request body", "已寫入 PR body") }, T("applied", "已套用")) : null);
}
function groupCell(r, d) {
  const gs = d.settings.groups || [];
  if (!gs.length) return r.group ? h("span", { class: "vbadge" }, r.group) : h("span", { class: "faint" }, "—");
  return h("select", { class: "pw-grp", "data-prs-group": r.id, "aria-label": T(`Release group of ${r.id}`, `${r.id} 的上線分組`), onclick: (e) => e.stopPropagation(),
    onchange: (e) => act("/api/prs/group", { pr: r.id, group: e.target.value }) }, h("option", { value: "" }, "—"), gs.map((g) => h("option", { value: g, selected: r.group === g }, g)));
}
// ---------- order ----------
const allIds = () => (PW.data?.rows || []).map((r) => r.id);
function dropOn(from, to) { const ids = allIds().filter((x) => x !== from), i = ids.indexOf(to); ids.splice(i < 0 ? ids.length : i, 0, from); act("/api/prs/order", { order: ids }, T("Order saved in Studio (not written to GitHub)", "順序已存在 Studio（沒有寫入 GitHub）")); }
function move(id, by) { const ids = allIds(), i = ids.indexOf(id), j = i + by; if (i < 0 || j < 0 || j >= ids.length) return; [ids[i], ids[j]] = [ids[j], ids[i]];
  act("/api/prs/order", { order: ids }).then(() => document.querySelector(`[data-prs-row="${CSS.escape(id)}"]`)?.focus()); }

// ---------- dialogs ----------
function pwModal(title, kids, o = {}) {
  const root = document.getElementById("modalRoot"), prev = document.activeElement;
  const close = () => { root.replaceChildren(); prev?.focus?.(); };
  const box = h("div", { class: `modal pw-modal${o.wide ? " wide" : ""}`, role: "dialog", "aria-modal": "true", "aria-label": title, "data-prs-dialog": o.id || "" },
    h("div", { class: "pw-mh" }, h("h2", {}, title), h("span", { class: "x-grow" }), h("button", { class: "btn ghost icon", "aria-label": T("Close", "關閉"), "data-prs-close": "", onclick: close }, icon("x"))), ...kids);
  const back = h("div", { class: "modal-back", onclick: (e) => { if (e.target === back) close(); }, onkeydown: (e) => { if (e.key === "Escape") close(); } }, box);
  root.replaceChildren(back); hydrateIcons(back); (box.querySelector("[autofocus]") || box.querySelector("button.primary") || box.querySelector("button"))?.focus(); return close;
}
const foot = (...kids) => h("div", { class: "pw-mf" }, ...kids);
function detail(r) {
  const n = r.next, rules = PW.data?.rules || [];
  pwModal(r.id, [
    h("p", { class: "muted pw-dtitle" }, r.title || "", " · ", extLink(ghPr(r.id), T("on GitHub", "在 GitHub 上看"))),
    h("div", { class: "pw-cols" },
      h("div", { class: "card x-pad pw-dl" },
        h("h3", {}, T("Issues", "Issue")), r.issues.length ? r.issues.map((i) => h("div", { class: "kv" }, h("span", {}, extLink(ghIssue(i.ref), i.ref), i.title ? ` ${i.title}` : "", i.external ? T(" (external, read only)", "（外部，只讀）") : ""), h("span", {}, i.state || "?"))) : h("span", { class: "faint" }, T("none", "無")),
        h("h3", {}, T("Reviews", "Reviews")), r.reviews.length ? r.reviews.map((x) => h("div", { class: "kv" }, h("span", {}, x.login, x.author ? T(" (author)", "（作者）") : ""), h("span", {}, reviewWord(x.state), x.stale ? T(" · stale", " · 舊 head") : ""))) : h("span", { class: "faint" }, T("none", "無")),
        h("h3", {}, T("Test evidence", "測試證據")), r.evidence ? [h("div", { class: "kv" }, h("span", {}, `${r.evidence.by}${r.evidence.at ? ` · ${day(r.evidence.at)}` : ""} (${r.evidence.source})`), h("span", {}, verdictWord(r.evidence.verdict))),
          h("div", { class: "kv" }, h("span", {}, T("Covers the current head", "涵蓋目前的 head")), h("span", {}, r.evidence.covers === "head" ? T("yes", "是") : r.evidence.covers === "older" ? T(`no, it tested ${r.evidence.since || "an older head"}`, `否，驗的是 ${r.evidence.since || "較舊的 head"}`) : r.evidence.covers === "unknown" ? T("unknown: it names no commit", "不確定：沒指明 commit") : T("not tied to a commit", "沒有綁定 commit")))] : h("span", { class: "faint" }, T("none", "沒有")),
        h("h3", {}, T("Environments", "環境")), r.envs.length ? r.envs.map((e) => h("div", { class: "kv" }, h("span", {}, e.name, e.production ? T(" (production)", "（正式）") : ""), h("span", {}, e.on ? T("runs this head", "跑著這個 head") : e.on === null ? T("could not be read", "讀不到") : T("no", "沒有")))) : h("span", { class: "faint" }, T("none set", "未設定"))),
      h("div", { class: "card x-pad pw-dl" },
        h("h3", {}, T("How the next step was found", "下一步怎麼算出來的")),
        h("ol", { class: "pw-rules", "data-prs-rules": "" }, rules.map((x, i) => h("li", { class: x.id === n.rule ? "hit" : n.matched?.[i] ? "" : "no", "data-rule": x.id }, T(x.en, x.tw), x.id === n.rule ? T(" ← this one", " ← 這條") : ""))),
        h("h3", {}, T("Missing approvals", "還缺的 approve")), h("div", {}, (r.approvals?.missing || []).length ? r.approvals.missing.map((m) => m.kind === "unreadable" ? LX({ en: m.reason, tw: m.tw }) : missWord(m)).join(T("; ", "；")) : "—"),
        r.approvals?.readable ? h("p", { class: "faint pw-small" }, T(`Rules: ${r.approvals.required} approval${r.approvals.required === 1 ? "" : "s"}${r.approvals.codeOwners ? ", code owners" : ""}${r.approvals.lastPush ? ", approval after the last push" : ""}${r.approvals.dismissStale ? ", stale approvals dismissed" : ""} (${(r.approvals.sources || []).join(", ") || "no rule"}).`,
          `規則：${r.approvals.required} 個 approve${r.approvals.codeOwners ? "、code owner" : ""}${r.approvals.lastPush ? "、最後一次 push 之後的 approve" : ""}${r.approvals.dismissStale ? "、舊 approve 失效" : ""}（${(r.approvals.sources || []).join("、") || "沒有規則"}）。`)) : null,
        h("h3", {}, T("Order", "順序")), h("ul", { class: "pw-why" }, (r.orderWhy || []).map((w) => h("li", {}, w))),
        r.partial?.length ? h("p", { class: "faint pw-small" }, T(`Not read this time: ${r.partial.join(", ")}.`, `這次沒讀到：${r.partial.join("、")}。`)) : null)),
  ], { wide: true, id: "detail" });
}
function ctaMenu(anchor, r) {
  document.querySelectorAll(".pw-menu").forEach((m) => m.remove());
  const close = () => { m.remove(); document.removeEventListener("click", off, true); document.removeEventListener("keydown", esc, true); };
  const item = (k, ic, en, tw, f) => h("button", { class: "btn ghost", "data-prs-action": k, onclick: () => { close(); f(); } }, icon(ic), T(en, tw));
  const m = h("div", { class: "pop pw-menu", role: "group", "aria-label": T(`Actions for ${r.id}`, `${r.id} 的動作`), "data-prs-menu": r.id },
    h("div", { class: "tgt" }, `${r.id} · `, (r.approvals?.missing || []).map(missWord).join(", ")),
    item("ask", "message", "Ask for review: draft a message", "請人審：產生訊息", () => askModal(r)),
    item("room", "monitor", "Open in the review room", "在審查室打開", () => openRoom(r)),
    item("report", "doc", "Handoff report…", "交接報告…", () => reportModal([r])),
    item("md", "copy", "Copy this row as Markdown", "把這一列複製成 Markdown", async () => { flash(await copy(markdown([r])) ? T("Copied as Markdown", "已複製成 Markdown") : T("Could not copy", "無法複製")); }));
  document.body.append(m);
  const b = anchor.getBoundingClientRect(); m.style.position = "fixed"; m.style.left = `${Math.max(8, Math.min(b.left, innerWidth - 290))}px`; m.style.top = `${Math.min(b.bottom + 6, innerHeight - 220)}px`;
  const off = (e) => { if (!m.contains(e.target)) close(); }, esc = (e) => { if (e.key === "Escape") { close(); anchor.focus(); } };
  setTimeout(() => { document.addEventListener("click", off, true); document.addEventListener("keydown", esc, true); }, 0);
  m.querySelector("button")?.focus();
}
const visibleRows = () => (PW.data?.rows || []).filter((r) => PW.tab === "all" || r.next.kind === PW.tab);
function draft(r, lang) {
  const P = (en, tw) => window.crewI18n.pick(lang, en, tw), miss = (r.approvals?.missing || []).map(missWord).join(P(", ", "、"));
  const ev = r.evidence ? (r.evidence.verdict === "pass" || r.evidence.verdict === "conditional") && (r.evidence.covers === "head" || r.evidence.covers === "unbound") ? P(`${r.evidence.by} passed it${r.evidence.at ? ` on ${day(r.evidence.at)}` : ""}, on the current head`, `${r.evidence.by}${r.evidence.at ? ` ${day(r.evidence.at)}` : ""} 驗過，驗的是目前的 head`)
    : P(`${verdictWord(r.evidence.verdict)}${r.evidence.covers === "older" ? ` (an older head: ${r.evidence.since || ""})` : ""}`, `${verdictWord(r.evidence.verdict)}${r.evidence.covers === "older" ? `（舊 head：${r.evidence.since || ""}）` : ""}`) : P("not tested yet", "還沒測");
  const envs = r.envs.filter((e) => e.on).map((e) => e.name).join(", ") || P("not deployed yet", "尚未部署");
  const deps = r.deps.on.map((x) => `${x.id}${x.done ? P(" (merged)", "（已合併）") : ""}`).join(", ") || P("none", "無");
  return [P(`Hi, could you review ${r.id} "${r.title}"?`, `嗨，想請你幫忙 review ${r.id}「${r.title}」。`),
    `• ${P("Tests", "測試")}: ${ev}`, `• ${P("Environments", "環境")}: ${envs}`, `• ${P("Depends on", "依賴")}: ${deps}`,
    P(`Still missing: ${miss} approval`, `還缺：${miss} approve`), ghPr(r.id) || ""].join("\n");
}
function askModal(r) {
  const langs = window.crewI18n.LANGS, start = PW.data?.settings?.messageLang || document.documentElement.lang || "en";
  let lang = langs.includes(start) ? start : "en";
  const ta = h("textarea", { class: "pw-msg", rows: 9, "data-prs-message": "", "aria-label": T("Message", "訊息") }); ta.value = draft(r, lang);
  const sel = h("select", { class: "pw-lang", "aria-label": T("Language", "語言"), onchange: (e) => { lang = e.target.value; ta.value = draft(r, lang); } }, langs.map((l) => h("option", { value: l, selected: l === lang }, window.crewI18n.NAMES[l])));
  const con = PW.data?.connector || {};
  const close = pwModal(T(`Ask for review: ${r.id}`, `請人審：${r.id}`), [
    h("p", { class: "muted" }, T("Studio never sends this by itself. Copy it into your chat, or send it through a messaging connector with your own click.", "Studio 不會自己送出。複製後貼到你的聊天工具，或接上訊息 connector 後由你按送出。")),
    ta,
    foot(sel, h("span", { class: "x-grow" }), h("span", { class: "faint pw-small", "data-prs-connector": "" }, con.available ? "" : LX(con)),
      h("button", { class: "btn", disabled: !con.available, title: con.available ? "" : LX(con), "data-prs-send": "" }, T("Send via connector", "透過 connector 送出")),
      h("button", { class: "btn primary", "data-prs-copy": "", onclick: async () => { const ok = await copy(ta.value); close(); flash(ok ? T("Message copied", "訊息已複製") : T("Could not copy", "無法複製")); } }, T("Copy", "複製")))], { id: "ask" });
}
async function openRoom(r) {
  const url = ghPr(r.id); if (!url) return;
  try { const out = await postJ("/api/review-room/open-pr", { url, lang: ["zh-TW", "zh-CN"].includes(document.documentElement.lang) ? document.documentElement.lang : "en" }); if (out.href) location.hash = out.href; }
  catch (e) { flash(T(`The review room could not open it: ${e.message}`, `審查室打不開它：${e.message}`)); }
}
function markdown(rows) {
  const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
  return [`| # | ${T("Pull request", "Pull request")} | ${T("Next step", "下一步")} | ${T("Waits on", "等誰")} | ${T("Missing", "還缺")} | ${T("Test evidence", "測試證據")} | ${T("Environments", "環境")} | ${T("Depends on", "依賴")} |`, "|---|---|---|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.position} | [${r.id}](${ghPr(r.id)}) ${esc(r.title)} | ${esc(nextWord(r.next))} | ${esc(r.next.who.map(whoWord).join(", "))} | ${esc((r.approvals?.missing || []).map(missWord).join(", ") || "—")} | ${esc(r.evidence ? verdictWord(r.evidence.verdict) + (r.evidence.covers === "older" ? ` (${r.evidence.since || "older"})` : "") : "—")} | ${esc(r.envs.filter((e) => e.on).map((e) => e.name).join(", ") || "—")} | ${esc(r.deps.on.map((x) => x.id).join(", ") || "—")} |`)].join("\n");
}
function reportModal(rows) {
  const who = h("input", { class: "input", "data-prs-reader": "", value: T("the approvers", "approver"), "aria-label": T("For whom", "給誰看") });
  const close = pwModal(T("Handoff report", "交接報告"), [
    h("p", { class: "muted" }, T(`A one-page report of ${rows.map((r) => r.id).join(", ")}: the pull requests, their evidence, what is asked. Copy it as Markdown for the reader you name. (A Task that writes it from its dispatch card is a follow-up: docs/units/pr-watch.md.)`,
      `${rows.map((r) => r.id).join("、")} 的一頁報告：PR、測試證據、要對方做什麼。複製成 Markdown 給你指定的讀者。（從派工卡開任務來寫是後續項目：docs/units/pr-watch.md。）`)),
    h("label", { class: "field" }, h("span", { class: "lbl" }, T("For whom", "給誰看")), who),
    foot(h("span", { class: "x-grow" }), h("button", { class: "btn primary", "data-prs-report-copy": "", onclick: async () => {
      const text = [`# ${T("Handoff", "交接")}: ${rows.map((r) => r.id).join(", ")}`, `${T("For", "給")}: ${who.value.trim() || "—"}`, "", markdown(rows), "",
        ...rows.flatMap((r) => [`## ${r.id} ${r.title}`, `- ${T("Next step", "下一步")}: ${nextWord(r.next)} (${r.next.who.map(whoWord).join(", ")})`, `- ${T("Asked", "請求")}: ${(r.approvals?.missing || []).length ? T(`approve (${r.approvals.missing.map(missWord).join(", ")})`, `approve（${r.approvals.missing.map(missWord).join("、")}）`) : "—"}`,
          `- ${T("Issues", "Issue")}: ${r.issues.map((i) => i.external ? ghIssue(i.ref) || i.ref : `${i.ref}${i.title ? ` ${i.title}` : ""} (${i.state || "?"})`).join("; ") || "—"}`, ""])].join("\n");
      const ok = await copy(text); close(); flash(ok ? T("Report copied as Markdown", "報告已複製成 Markdown") : T("Could not copy", "無法複製")); } }, T("Copy the report", "複製報告")))], { id: "report" });
}
function blockOf(on, repo, short) { const lines = ["<!-- crew-studio:depends -->", ...on.map((id) => `Depends-on: ${ghPr(id)}`)];
  if (short) for (const id of on) { const m = ID.exec(id); if (m && `${m[1]}/${m[2]}`.toLowerCase() === String(repo).toLowerCase()) lines.push(`Depends-on: #${m[3]}`); }
  return [...lines, "<!-- /crew-studio:depends -->"].join("\n"); }
function applyModal(ids) {
  const rows = (PW.data?.rows || []).filter((r) => ids.includes(r.id) && r.deps.on.length);
  if (!rows.length) { flash(T("No dependency to apply", "沒有依賴可以套用")); return; }
  let short = !!PW.data?.settings?.shortForm;
  const pres = () => rows.map((r) => h("div", { class: "card x-pad pw-target", "data-prs-target": r.id }, h("b", {}, r.id, " ", h("span", { class: "faint" }, r.title)), h("pre", { class: "pw-pre" }, blockOf(r.deps.on.map((x) => x.id), r.repo, short))));
  const list = h("div", { class: "pw-targets" }, pres());
  const close = pwModal(T("Apply the dependencies to the pull requests", "套用依賴到 pull request"), [
    h("p", { class: "muted" }, T("Studio adds one marked block at the end of each pull request body and changes nothing else. It writes only after you approve the card this sends to your Inbox; every refresh afterwards checks whether the block was edited.", "Studio 會在每個 PR 的 body 尾端寫入一段帶標記的區塊，其他內容不動。要等你核准這裡送到收件匣的卡片才會寫入；之後每次刷新都會比對它有沒有被改。")),
    list,
    h("label", { class: "pw-check" }, h("input", { type: "checkbox", "data-prs-short": "", checked: short, onchange: (e) => { short = e.target.checked; list.replaceChildren(...pres()); } }), T(" Also write the same-repository short form ", " 另外寫同 repo 簡寫 "), h("code", {}, "Depends-on: #N"), T(" (for tools that read only that form)", "（給只讀這種格式的工具）")),
    foot(h("span", { class: "x-grow" }), h("button", { class: "btn", "data-prs-close": "", onclick: () => close() }, T("Cancel", "取消")),
      h("button", { class: "btn primary", "data-prs-apply-send": "", onclick: async (e) => { e.currentTarget.disabled = true;
        try { const out = await postJ("/api/prs/apply", { prs: rows.map((r) => r.id), shortForm: short }); close(); flash(T("The card is in your Inbox: approve it there to write.", "卡片已送到收件匣：在那裡核准才會寫入。"), { href: "#/inbox", text: T("Open the Inbox", "打開收件匣") }); }
        catch (err) { e.currentTarget.disabled = false; flash(err.message); } } }, T(`Send the card for ${rows.length} pull request${rows.length === 1 ? "" : "s"}`, `送出 ${rows.length} 個 PR 的卡片`)))], { id: "apply" });
}
function depModal(r) {
  const cur = r.deps.source === "proposal" ? [] : r.deps.on.map((x) => x.id), others = (PW.data?.rows || []).map((x) => x.id).filter((x) => x !== r.id && !cur.includes(x));
  const save = (on) => act("/api/prs/deps", { pr: r.id, on }, T("Dependencies saved in Studio (not written to GitHub)", "依賴已存在 Studio（沒有寫入 GitHub）")).then(() => { const nr = PW.data?.rows?.find((x) => x.id === r.id); if (nr) depModal(nr); });
  const typed = h("input", { class: "input", placeholder: "owner/repo#123", "data-prs-dep-typed": "", "aria-label": T("Another pull request", "其他 pull request") });
  pwModal(T(`Dependencies of ${r.id}`, `${r.id} 的依賴`), [
    h("p", { class: "muted" }, r.title),
    r.deps.proposed.length ? h("div", { class: "pw-propbox" }, h("b", {}, T("Proposed", "建議")), h("ul", { class: "pw-why" }, r.deps.proposed.map((p) => h("li", {}, h("b", {}, p.on), ": ", p.why))),
      h("button", { class: "btn", "data-prs-take-proposed": "", onclick: () => save(r.deps.proposed.map((p) => p.on)) }, T("Take the proposal", "採用建議"))) : null,
    h("div", { class: "chips", "data-prs-dep-list": "" }, cur.length ? cur.map((d) => h("span", { class: "chip" }, d, h("button", { class: "pw-x", "data-prs-dep-rm": d, "aria-label": T(`Remove ${d}`, `移除 ${d}`), onclick: () => save(cur.filter((x) => x !== d)) }, icon("x")))) : h("span", { class: "faint" }, T("No dependency recorded", "沒有記錄依賴"))),
    h("div", { class: "pw-depadd" }, h("select", { class: "input", "data-prs-dep-add": "", "aria-label": T("Add a dependency", "加入依賴"), onchange: (e) => { if (e.target.value) save([...cur, e.target.value]); } }, h("option", { value: "" }, T("Add a dependency from the list…", "從清單加入依賴…")), others.map((x) => h("option", { value: x }, x))),
      typed, h("button", { class: "btn", onclick: () => { const v = typed.value.trim(); if (!ID.test(v)) { flash(T("Write owner/repo#number", "請寫 owner/repo#number")); return; } save([...cur, v]); } }, T("Add", "加入"))),
    foot(h("span", { class: "x-grow" }), h("button", { class: "btn primary", "data-prs-dep-apply": "", disabled: !cur.length, onclick: () => applyModal([r.id]) }, T("Apply to the pull request…", "套用到 PR…")))], { id: "deps" });
}
function driftModal(r) {
  const dr = r.deps.drift;
  const close = pwModal(T(`${r.id}: the dependency hint on GitHub changed`, `${r.id}：GitHub 上的依賴提示被改了`), [
    h("p", { class: "muted" }, T("The latest refresh found the marked block in the pull request body different from Studio's record.", "最近一次刷新發現 PR body 裡的標記區塊和 Studio 的紀錄不同。")),
    h("div", { class: "pw-cols" }, h("div", { class: "card x-pad" }, h("small", { class: "faint" }, T("Studio's record", "Studio 的紀錄")), h("pre", { class: "pw-pre", "data-prs-drift-studio": "" }, dr.studio)),
      h("div", { class: "card x-pad pw-driftgh" }, h("small", { class: "faint" }, T("On GitHub now", "GitHub 上現在")), h("pre", { class: "pw-pre", "data-prs-drift-github": "" }, dr.github ?? T("(the block was removed)", "（區塊被移除了）")))),
    foot(h("span", { class: "x-grow" }), h("button", { class: "btn", "data-prs-drift-take": "", onclick: () => { close(); act("/api/prs/drift/take", { pr: r.id }, T("Studio's record now follows GitHub", "Studio 的紀錄改以 GitHub 為準")); } }, T("Take GitHub's version", "以 GitHub 上的為準")),
      h("button", { class: "btn primary", "data-prs-drift-reapply": "", onclick: () => { close(); applyModal([r.id]); } }, T("Apply Studio's record again…", "重新套用 Studio 的紀錄…")))], { id: "drift" });
}
function settingsModal() {
  const s = structuredClone(PW.data?.settings || {}), envs = s.environments || [];
  const cb = (k, en, tw) => h("label", { class: "pw-check" }, h("input", { type: "checkbox", "data-prs-which": k, checked: !!s.which?.[k], onchange: (e) => { s.which[k] = e.target.checked; } }), " ", T(en, tw));
  const csv = (key, label, get, set) => h("label", { class: "field" }, h("span", { class: "lbl" }, label), h("input", { class: "input", "data-prs-set": key, value: get().join(", "), oninput: (e) => set(e.target.value.split(",").map((x) => x.trim()).filter(Boolean)) }));
  const envBox = h("div", { class: "pw-envset", "data-prs-envs": "" });
  const KINDS = [["deployment", T("GitHub Deployment to an environment", "GitHub Deployment 到某個環境")], ["check", T("A check run by name on the head", "head 上某個名稱的 check run")], ["branch", T("The latest deployment of a branch containing the head", "某個 branch 最新的部署包含這個 head")], ["file", T("An image tag in a file in a repository", "某個 repo 的檔案裡的 image tag")]];
  const FIELDS = { deployment: [["environment", T("environment", "環境名稱")]], check: [["name", T("check run name", "check run 名稱")]], branch: [["branch", "branch"], ["environment", T("environment (optional)", "環境名稱（可省略）")]], file: [["repository", "owner/repo"], ["path", T("path", "路徑")], ["pattern", T("pattern (group 1 = commit)", "pattern（第 1 組＝commit）")], ["ref", T("ref (optional)", "ref（可省略）")]] };
  const drawEnvs = () => envBox.replaceChildren(...envs.map((e, i) => h("div", { class: "pw-envrow", "data-prs-env": String(i) },
    h("input", { class: "input pw-envname", value: e.name || "", placeholder: T("name", "名稱"), "aria-label": T("Environment name", "環境名稱"), oninput: (ev) => { e.name = ev.target.value; } }),
    h("label", { class: "pw-check" }, h("input", { type: "checkbox", checked: !!e.production, onchange: (ev) => { e.production = ev.target.checked; } }), T(" production", " 正式")),
    h("select", { class: "input", "aria-label": T("How it is detected", "怎麼偵測"), onchange: (ev) => { e.detect = { kind: ev.target.value }; drawEnvs(); } }, KINDS.map(([k, l]) => h("option", { value: k, selected: e.detect?.kind === k }, l))),
    ...(FIELDS[e.detect?.kind] || []).map(([f, l]) => h("input", { class: "input", value: e.detect?.[f] || "", placeholder: l, "aria-label": l, oninput: (ev) => { e.detect[f] = ev.target.value; } })),
    h("input", { class: "input", value: (e.repos || []).join(", "), placeholder: T("only these repositories (optional)", "只用在這些 repo（可省略）"), "aria-label": T("Repositories", "repo"), oninput: (ev) => { e.repos = ev.target.value.split(",").map((x) => x.trim()).filter(Boolean); } }),
    h("button", { class: "pw-x", "aria-label": T("Remove this environment", "移除這個環境"), onclick: () => { envs.splice(i, 1); drawEnvs(); } }, icon("x")))));
  drawEnvs();
  const err = h("p", { class: "pw-err", role: "alert", hidden: true });
  const close = pwModal(T("Pull requests settings", "Pull requests 設定"), [
    h("p", { class: "muted" }, T("Repositories and pull requests are added by pasting their address above the list, and removed with ×.", "要追蹤的 repo 和 PR 直接在清單上方貼網址加入、按 × 移除。")),
    h("div", { class: "pw-dl" },
      h("h3", {}, T("For a watched repository, which pull requests", "貼 repo 網址時，追蹤這個 repo 裡的哪些 PR")), cb("mine", "opened by me", "我開的"), cb("assigned", "assigned to me", "指派給我的"), cb("reviewRequested", "review requested from me", "請我 review 的"),
      h("h3", {}, T("Test evidence", "測試證據來源")),
      csv("accounts", T("Accounts whose comments count (comma separated)", "留言算數的帳號（逗號分隔）"), () => s.evidence.accounts, (v) => { s.evidence.accounts = v; }),
      csv("checks", T("Check runs that count", "算數的 check run"), () => s.evidence.checks, (v) => { s.evidence.checks = v; }),
      csv("labels", T("Labels that count", "算數的 label"), () => s.evidence.labels, (v) => { s.evidence.labels = v; }),
      csv("required", T("Reviewers who must review every pull request (for example a review bot)", "每個 PR 都要 review 的人（例如 review bot）"), () => s.requiredReviewers, (v) => { s.requiredReviewers = v; }),
      h("h3", {}, T("Environments, in order", "環境（依順序）")), envBox,
      h("button", { class: "btn", "data-prs-env-add": "", onclick: () => { envs.push({ name: "", production: false, repos: [], detect: { kind: "deployment", environment: "" } }); drawEnvs(); } }, icon("plus"), T("Add an environment", "加入環境")),
      h("h3", {}, T("Release groups", "上線分組")), csv("groups", T("Group names (comma separated)", "分組名稱（逗號分隔）"), () => s.groups, (v) => { s.groups = v; }),
      h("label", { class: "pw-check" }, h("input", { type: "checkbox", checked: !!s.shortForm, onchange: (e) => { s.shortForm = e.target.checked; } }), T(" Also write the short same-repository form Depends-on: #N", " 另外寫同 repo 簡寫 Depends-on: #N"))),
    err,
    foot(h("span", { class: "x-grow" }), h("button", { class: "btn", onclick: () => close() }, T("Cancel", "取消")), h("button", { class: "btn primary", "data-prs-settings-save": "", onclick: async () => {
      s.environments = envs;
      try { PW.data = await postJ("/api/prs/settings", { settings: s }); setCount(PW.data.count); close(); render(); flash(T("Settings saved", "設定已儲存")); } catch (e) { err.hidden = false; err.textContent = e.message; } } }, T("Save", "儲存")))], { wide: true, id: "settings" });
}

// opening the page (a link, a reload, the sidebar) loads it and asks for a refresh; a redraw while it is open does not
routes.prs = () => { if (!PW.onPage) setTimeout(enter, 0); return view(); };
window.crewPrs = { reload: load, state: PW };
})();
