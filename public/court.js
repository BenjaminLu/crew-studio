// The disagreement court of an issue triage (#/court/<project>/<task>; docs/units/board.md, "The disagreement court"):
// the cases the two investigators did not agree on, one per screen, each side's finding with the code Studio checked at
// the pinned commit; the captain rules each (keys 1 to 4, R for a reason, Z to undo) and sends the rulings once, which
// answers the Task's court card. A popup shows the issue as Studio's snapshot holds it, another the file at the pinned
// commit. Issue text, titles, model-written text and code only ever go into text nodes; the only links are to
// github.com/<repository> for this triage, built here from checked values. Nothing here writes to GitHub.
(() => {
const CT = { data: new Map(), busy: new Set(), state: new Map() };
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, SHA = /^[a-f0-9]{40}$/;
const getJ = async (u) => { const r = await fetch(u); let j = {}; try { j = await r.json(); } catch {} if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`); return j; };
const sendJ = async (u, b) => { const r = await fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }); let j = {}; try { j = await r.json(); } catch {} if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`); return j; };
const base = (project, run) => `/api/issue-triage/${encodeURIComponent(project)}/court/${encodeURIComponent(run)}`;
const redraw = () => { if (S.route?.name === "court") render(); };
// links to GitHub: only this triage's repository, only https
const ghIssue = (v, n) => REPO.test(v.repository || "") && Number.isSafeInteger(n) ? `https://github.com/${v.repository}/issues/${n}` : null;
const ghBlob = (v, path, a, b) => REPO.test(v.repository || "") && SHA.test(v.commit || "") ? `https://github.com/${v.repository}/blob/${v.commit}/${String(path).split("/").map(encodeURIComponent).join("/")}${a ? `#L${a}${b && b !== a ? `-L${b}` : ""}` : ""}` : null;
const extLink = (href, text) => href && /^https:\/\/github\.com\//.test(href) ? h("a", { href, target: "_blank", rel: "noopener noreferrer", "data-court-gh": "1" }, text) : null;

const STATE = { present: ["still there", "問題還在"], "fixed?": ["maybe fixed", "可能已修好"], "not-code": ["not a code change", "不是改程式碼的事"], "not-found": ["cannot find it in the code", "程式碼裡找不到"], "needs-info": ["needs information", "資訊不足"] };
const DIFF = { state: ["The state differs", "狀態不同"], location: ["The place differs", "位置不同"], locate: ["Can it be located?", "能不能定位"], missing: ["Only one report has it", "只有一份報告有"], check: ["Studio's check failed", "Studio 核對沒過"], duplicate: ["A duplicate?", "是不是重複"], package: ["How to group them", "工作包分法"], "in-progress": ["A pull request names it", "已有 PR 提到"], "human-fit": ["A person's work or an agent's?", "人做還是交給 agent"] };
const KIND = { single: ["alone", "單獨"], recheck: ["recheck", "複測"], ordered: ["in order", "照順序"], unordered: ["one package", "一包"], "one-change": ["one change", "一次改動"] };
const stateOf = (s) => (s ? T(...(STATE[s.state] || [s.state, s.state])) : T("did not report it", "沒有回報"));
/** the picks a case offers, in key order, each with what it does */
function picks(c) {
  const n = c.issues[0];
  if (c.kind === "package") return [["a", T("A's grouping", "A 的分法"), T("packages as A grouped them", "照 A 的分法成包")], ["b", T("B's grouping", "B 的分法"), T("packages as B grouped them", "照 B 的分法成包")], ["separate", T("All separate", "全部拆開"), T("one package each", "一張一包")], ["needs-info", T("Needs information", "缺資訊"), T("ask the reporter first", "先問回報者")]];
  if (c.kind === "duplicate") return [["confirm", T(`Duplicate of #${c.duplicateOf}`, `是 #${c.duplicateOf} 的重複`), T("recorded in Studio; nothing is closed on GitHub", "只記在 Studio，不會在 GitHub 關掉")], ["not-duplicate", T("Not a duplicate", "不是重複"), T("take what both reports agree on", "採用兩份報告的共識")], ["needs-info", T("Needs information", "缺資訊"), T("ask the reporter first", "先問回報者")]];
  if (c.kind === "in-progress") return [["wait", T("Wait for the pull request", "等那個 PR"), T("set aside, recorded", "先擱著，記下來")], ["take", T("Take it anyway", "照樣做"), T("take what both reports agree on", "採用兩份報告的共識")], ["needs-info", T("Needs information", "缺資訊"), T("ask the reporter first", "先問回報者")]];
  if (c.kind === "human-fit") return [["human", T("A person takes it", "交給人做"), T("set aside, recorded", "先擱著，記下來")], ["agent", T("Give it to an agent", "交給 agent"), T("take what both reports agree on", "採用兩份報告的共識")], ["needs-info", T("Needs information", "缺資訊"), T("ask the reporter first", "先問回報者")]];
  return [["a", T(`A is right: ${stateOf(c.a[n])}`, `A 對：${stateOf(c.a[n])}`), T("adopt A's finding", "採用 A 的發現")], ["b", T(`B is right: ${stateOf(c.b[n])}`, `B 對：${stateOf(c.b[n])}`), T("adopt B's finding", "採用 B 的發現")], ["neither", T("Neither", "都不對"), T("back to triage", "回去重新分診")], ["needs-info", T("Needs information", "缺資訊"), T("ask the reporter first", "先問回報者")]];
}
/** a finding side that cannot be adopted: not reported, or refused by Studio's check */
const blocked = (c, pick) => c.kind === "finding" && (pick === "a" || pick === "b") && !c[pick][c.issues[0]]?.ok;

function stateFor(key) {
  let s = CT.state.get(key);
  if (!s) { s = { rulings: [], reason: "", sending: false, error: null, done: null };
    try { const kept = JSON.parse(sessionStorage.getItem(`crew.court.${key}`) || "null"); if (Array.isArray(kept)) s.rulings = kept.filter((r) => r && typeof r.case === "string" && typeof r.pick === "string"); } catch {}
    CT.state.set(key, s); }
  return s;
}
const keep = (key, s) => { try { sessionStorage.setItem(`crew.court.${key}`, JSON.stringify(s.rulings)); } catch {} };
async function load(key, project, run) {
  if (CT.busy.has(key)) return; CT.busy.add(key);
  try { CT.data.set(key, await getJ(base(project, run))); } catch (e) { CT.data.set(key, { error: e.message }); }
  finally { CT.busy.delete(key); redraw(); }
}

// ---- popups: Escape, the backdrop or the close button closes; focus goes back where it was ----
function modal(title, sub, body, foot, scrollTo) {
  document.querySelector(".ct-modal")?.remove();
  // focus goes back to what opened the popup, or to its like when the page was drawn again meanwhile
  const back = document.activeElement, mark = back ? [...back.attributes].find((x) => x.name.startsWith("data-court")) : null;
  const close = () => { d.remove(); removeEventListener("keydown", onKey, true); const el = back?.isConnected ? back : mark ? document.querySelector(`[${mark.name}="${CSS.escape(mark.value)}"]`) : null; el?.focus(); };
  const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };
  const x = h("button", { type: "button", class: "btn ghost ct-x", "data-court-close": "1", "aria-label": T("Close", "關閉"), onclick: () => close() }, "×");
  const d = h("div", { class: "ct-modal", role: "dialog", "aria-modal": "true", "aria-label": title, onclick: (e) => { if (e.target === d) close(); } },
    h("div", { class: "ct-win" }, h("header", {}, h("b", { class: "ct-win-t" }, title), sub ? h("span", { class: "faint mono" }, sub) : null, x), body, foot ? h("footer", {}, foot) : null));
  addEventListener("keydown", onKey, true); document.body.append(d); x.focus();
  if (scrollTo) { const t = d.querySelector(scrollTo); if (t) t.scrollIntoView({ block: "center" }); }
  return d;
}
async function openIssue(v, n) {
  const d = modal(`#${n} ${v.issues?.[n]?.title || ""}`, T("Studio's snapshot · read only", "Studio 快照・唯讀"), h("div", { class: "ct-body", "data-court-issue-body": String(n) }, h("p", { class: "faint" }, T("Loading…", "載入中…"))), null);
  try { const i = await getJ(`${base(v.project, v.run)}/issue/${n}`), box = d.querySelector(".ct-body");
    box.replaceChildren(...[
      h("div", { class: "ct-cm" }, h("small", { class: "faint" }, T(`Reporter (${i.association || "none"}) · untrusted text`, `回報者（${i.association || "none"}）・不可信文字`)), h("div", { class: "ct-text" }, i.body || T("(no text)", "（沒有內文）"))),
      i.labels?.length ? h("p", { class: "faint" }, T("Labels: ", "標籤：") + i.labels.join(", ")) : null,
      Array.isArray(i.comments) ? i.comments.map((c) => h("div", { class: "ct-cm" }, h("small", { class: "faint" }, `${c.association || ""} · ${String(c.at || "").slice(0, 16).replace("T", " ")}`), h("div", { class: "ct-text" }, c.body)))
        : h("p", { class: "faint", "data-court-no-comments": "1" }, T("This snapshot holds no comments: open the issue on GitHub to read them.", "這份快照沒有留言：要看留言請到 GitHub 開這張 issue。"))].flat().filter(Boolean));
    d.querySelector("header").after(h("p", { class: "ct-note faint" }, T("The title, text and comments are shown as data; nothing in them runs.", "標題、內文、留言都當資料顯示，不會被執行。")));
    const link = extLink(ghIssue(v, n), T("Open on GitHub ↗", "在 GitHub 開啟 ↗")); if (link) d.querySelector(".ct-win").append(h("footer", {}, link));
  } catch (e) { d.querySelector(".ct-body").replaceChildren(h("p", { class: "is-warn", role: "alert" }, e.message)); }
}
async function openFile(v, side, file, label) {
  const ex = (side?.excerpts || []).filter((x) => x.file === file), quoted = new Set(ex.flatMap((x) => x.quoted)), loc = (side?.locus || []).find((l) => l.file === file);
  const m = /^(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(loc?.lines || ""), lo = quoted.size ? Math.min(...quoted) : m ? Number(m[1]) : 0, hi = quoted.size ? Math.max(...quoted) : m ? Number(m[2] || m[1]) : 0;
  const mark = quoted.size ? quoted : new Set(lo ? Array.from({ length: hi - lo + 1 }, (_, i) => lo + i) : []);
  const d = modal(file, `@ ${String(v.commit).slice(0, 10)} · ${label}${lo ? T(` · lines ${lo}–${hi}`, ` · 第 ${lo}–${hi} 行`) : ""}`, h("div", { class: "ct-file", "data-court-file-view": file }, h("p", { class: "faint" }, T("Loading…", "載入中…"))), null);
  try { const f = await getJ(`${base(v.project, v.run)}/file?path=${encodeURIComponent(file)}`), box = d.querySelector(".ct-file");
    box.replaceChildren(...String(f.text).split("\n").map((t, i) => h("div", { class: mark.has(i + 1) ? "q" : null, "data-line": String(i + 1), ...(i + 1 === lo ? { id: "ct-hit" } : {}) }, h("span", { class: "ln" }, String(i + 1)), t)));
    d.querySelector("#ct-hit")?.scrollIntoView({ block: "center" });
    const link = extLink(ghBlob(v, file, lo, hi), T("Open these lines on GitHub ↗", "在 GitHub 開啟這幾行 ↗"));
    d.querySelector(".ct-win").append(h("footer", {}, h("span", { class: "faint" }, T("Read by Studio from git's objects at the pinned commit.", "Studio 從 pinned commit 的 git 物件讀出。")), link));
  } catch (e) { d.querySelector(".ct-file").replaceChildren(h("p", { class: "is-warn", role: "alert" }, e.message)); }
}

// ---- one case ----
function excerptView(v, side, x, label) {
  const q = new Set(x.quoted);
  return h("pre", { class: "ct-code", tabindex: "0", role: "button", "data-court-excerpt": x.file, title: T("Open this file", "開啟這個檔案"), onclick: () => openFile(v, side, x.file, label), onkeydown: (e) => { if (e.key === "Enter") { e.preventDefault(); openFile(v, side, x.file, label); } } },
    x.lines.map((t, i) => h("span", { class: q.has(x.start + i) ? "q" : null }, h("span", { class: "ln" }, String(x.start + i)), t, "\n")));
}
function sideView(v, c, k) {
  const label = T(`Investigator ${k.toUpperCase()}`, `調查員 ${k.toUpperCase()}`), who = v.by?.[k] || "";
  const parts = c.kind === "package" ? c.groupings?.[k] || [] : [];
  return h("article", { class: `ct-side ct-${k}`, "data-court-side": k },
    h("div", { class: "ct-who" }, h("span", { class: "ct-badge" }, k.toUpperCase()), h("span", { class: "mono faint" }, `${label} · ${who}`)),
    parts.length ? h("div", { class: "ct-groups", "data-court-grouping": k }, parts.map((p) => h("div", { class: "ct-grp" }, h("span", { class: "faint" }, T(...(KIND[p.kind] || [p.kind, p.kind])) + "："), p.members.map((n) => h("span", { class: `ct-chip mono${c.issues.includes(n) ? " hot" : ""}` }, `#${n}`)), p.joins?.length ? h("span", { class: "faint" }, T(` joins ${p.joins.join(", ")}`, ` 併入 ${p.joins.join("、")}`)) : null))) : null,
    c.issues.map((n) => { const s = c[k][n];
      return h("div", { class: "ct-finding", "data-court-finding": `${k}:${n}` },
        c.issues.length > 1 ? h("b", { class: "mono" }, `#${n}`) : null,
        h("div", { class: "ct-claim" }, h("span", { class: "ct-state" }, stateOf(s)), s?.duplicateOf ? h("span", { class: "faint" }, T(` · a duplicate of #${s.duplicateOf}`, `・和 #${s.duplicateOf} 重複`)) : null),
        s?.repro && s.repro !== "none" ? h("p", { class: "ct-repro" }, h("small", { class: "faint" }, T("The investigator's words (model text): ", "調查員的說法（模型寫的）：")), s.repro) : null,
        (s?.locus || []).map((l) => h("button", { type: "button", class: "ct-loc mono", "data-court-file": l.file, onclick: () => openFile(v, s, l.file, label) }, `${l.file}${l.symbol ? ` · ${l.symbol}` : ""}${l.lines ? ` · ${l.lines}` : ""} ↗`)),
        (s?.excerpts || []).map((x) => excerptView(v, s, x, label)),
        s?.questions?.length ? h("div", {}, h("small", { class: "faint" }, T("Questions for the reporter (shown only in Studio)", "要問回報者的（只顯示在 Studio）")), h("ol", { class: "ct-qs" }, s.questions.map((q) => h("li", {}, q)))) : null,
        s ? h("div", { class: "ct-checks" }, s.ok ? (s.locus?.length ? [T("files ✓", "檔案 ✓"), T("line range ✓", "行號範圍 ✓"), T("symbol ✓", "symbol ✓"), T("quotes read this round ✓", "引用是這輪讀到的 ✓")] : [T("checked: no code needed", "已核對：不需引用程式碼")]).map((t) => h("span", { class: "ct-chk ok" }, t))
          : s.problems.map((p) => h("span", { class: "ct-chk bad" }, p))) : null); }));
}
function crux(v, c) {
  const sum = (k) => c.kind === "package" ? (c.groupings?.[k] || []).map((p) => p.members.map((n) => `#${n}`).join("+")).join(" | ")
    : c.issues.map((n) => { const s = c[k][n]; return `${stateOf(s)}${s?.locus?.[0] ? ` · ${s.locus[0].file}` : ""}`; }).join("; ");
  return h("div", { class: "ct-crux", "data-court-crux": "1", "aria-label": T("Where they disagree", "分歧點") }, h("span", { class: "ct-a-t" }, `A: ${sum("a")}`), h("span", { class: "faint" }, "vs"), h("span", { class: "ct-b-t" }, `B: ${sum("b")}`));
}
function caseView(v, key, s) {
  const c = v.cases[s.rulings.length], ps = picks(c);
  const rule = (i) => { const p = ps[i]; if (!p || blocked(c, p[0])) return; s.rulings.push({ case: c.id, pick: p[0], ...(s.reason.trim() ? { reason: s.reason.trim().slice(0, 200) } : {}) }); s.reason = ""; s.error = null; keep(key, s); redraw(); };
  CT.rule = rule;
  return [
    h("section", { class: "card ct-issue", "data-court-case": c.id },
      h("div", { class: "ct-row" }, c.issues.map((n) => h("button", { type: "button", class: "btn ct-n mono", "data-court-issue": String(n), title: T("Open the issue", "開啟 issue"), onclick: () => openIssue(v, n) }, `#${n} ↗`)),
        h("h2", { class: "ct-title" }, c.issues.map((n) => v.issues?.[n]?.title || "").join(" · ")),
        h("span", { class: "ct-kind", "data-court-diff": c.diff.join(" ") }, c.diff.map((x) => T(...(DIFF[x] || [x, x]))).join(" · "))),
      h("p", { class: "faint ct-reason" }, c.reason),
      c.pulls?.length ? h("p", { class: "faint" }, T("Open pull requests naming it: ", "提到它的 open PR：") + c.pulls.map((p) => `#${p}`).join(" ")) : null,
      c.fit?.length ? h("p", { class: "faint" }, T("Why a person: ", "為什麼要人做：") + c.fit.join(", ")) : null),
    crux(v, c),
    h("div", { class: "ct-sides" }, sideView(v, c, "a"), sideView(v, c, "b")),
    h("p", { class: "faint ct-note" }, T("Both sides' code was read by Studio at the pinned commit and checked. No suggestion is shown.", "兩邊的程式碼都由 Studio 從 pinned commit 取出、核對過；這裡不給建議。")),
    h("footer", { class: "ct-dock", "data-court-dock": "1" },
      h("div", { class: "ct-rul" }, ps.map((p, i) => h("button", { type: "button", class: `ct-pick${i === 0 ? " pa" : i === 1 ? " pb" : ""}`, "data-court-pick": p[0], disabled: blocked(c, p[0]) ? true : null, title: blocked(c, p[0]) ? T("Studio's check refused this finding", "Studio 核對沒過，不能採用") : null, onclick: () => rule(i) },
        h("kbd", {}, String(i + 1)), h("span", {}, p[1]), h("small", {}, p[2])))),
      h("div", { class: "ct-why" },
        h("input", { type: "text", maxlength: "200", "data-court-reason": "1", value: s.reason, placeholder: T("One-line reason (optional)", "一句理由（選填）"), "aria-label": T("Reason", "理由"), oninput: (e) => { s.reason = e.target.value; } }),
        h("span", { class: "faint ct-hint" }, T("1–4 rule · R reason · Z undo", "1–4 裁決・R 寫理由・Z 撤銷")),
        h("button", { type: "button", class: "btn", "data-court-undo": "1", disabled: s.rulings.length ? null : true, onclick: () => undo(key, s) }, T("Undo", "撤銷"))))];
}
function undo(key, s) { const r = s.rulings.pop(); if (!r) return; s.reason = r.reason || ""; s.error = null; s.done = null; keep(key, s); redraw(); }
function summary(v, key, s) {
  const by = new Map(v.cases.map((c) => [c.id, c])), label = (r) => { const c = by.get(r.case); return (c ? picks(c).find((p) => p[0] === r.pick)?.[1] : null) || r.pick; };
  const send = async () => { s.sending = true; s.error = null; redraw();
    try { s.done = await sendJ(base(v.project, v.run), { rulings: s.rulings }); try { sessionStorage.removeItem(`crew.court.${key}`); } catch {} }
    catch (e) { s.error = e.message; } finally { s.sending = false; redraw(); } };
  return h("section", { class: "card x-pad ct-sum", "data-court-summary": "1" },
    h("h2", {}, s.done ? T(`${s.rulings.length} ruling${s.rulings.length === 1 ? "" : "s"} sent`, `已送出 ${s.rulings.length} 件裁決`) : T(`${s.rulings.length} of ${v.cases.length} ruled`, `已裁決 ${s.rulings.length} / ${v.cases.length} 件`)),
    h("ol", { class: "ct-list" }, s.rulings.map((r) => h("li", { "data-court-ruled": r.case }, h("span", { class: "mono" }, `${r.case} ${(by.get(r.case)?.issues || []).map((n) => `#${n}`).join(" ")}`), " ", label(r), r.reason ? h("span", { class: "faint" }, ` — ${r.reason}`) : null))),
    s.done ? h("p", { class: "note", role: "status" }, T("Applied by the Task: packages it made wait for your approval on its next card. Nothing was written to GitHub.", "任務會套用這些裁決：成形的工作包在下一張卡等你核准。沒有寫任何東西到 GitHub。"), " ", h("a", { href: `#/run/${encodeURIComponent(v.run)}` }, T("Open the Task", "開啟任務")))
      : h("div", { class: "x-row wrap" }, h("button", { type: "button", class: "btn primary", "data-court-submit": "1", disabled: s.sending || !s.rulings.length ? true : null, onclick: send }, T(`Send ${s.rulings.length} ruling${s.rulings.length === 1 ? "" : "s"}`, `送出 ${s.rulings.length} 件裁決`)),
        h("button", { type: "button", class: "btn", "data-court-undo": "1", disabled: s.rulings.length ? null : true, onclick: () => undo(key, s) }, T("Undo the last", "撤銷上一件")),
        h("span", { class: "faint" }, T("Nothing is written to GitHub.", "不會寫任何東西到 GitHub。"))),
    s.error ? h("p", { class: "is-warn", role: "alert" }, s.error) : null);
}
function viewCourt(arg) {
  const [project, run] = String(arg || "").split("/"), key = `${project}/${run}`;
  const wrap = (...kids) => h("div", { class: "page ct-page", "data-court": key }, h("div", { class: "phead" }, h("div", {}, h("h1", {}, T("Disagreement court", "分歧法庭")), h("p", {}, T("Rule on what the two investigators did not agree on, one case at a time.", "兩位調查員沒有共識的地方，一次裁決一件。")))), ...kids);
  if (!project || !/^R-\d+$/.test(run || "")) return wrap(h("p", { class: "is-warn" }, T("Open the court from a triage Task's card.", "請從分診任務的卡片開啟法庭。")));
  const v = CT.data.get(key), s = stateFor(key);
  if (!v && !CT.busy.has(key)) void load(key, project, run);
  if (!v) return wrap(h("p", { class: "faint" }, T("Loading…", "載入中…")));
  if (v.error && !s.done) return wrap(h("p", { class: "is-warn", role: "alert" }, v.error));
  CT.rule = null;
  if (s.done || !v.waiting) {
    if (s.done) return wrap(summary({ ...v, project, run }, key, s));
    return wrap(h("div", { class: "card x-pad", "data-court-closed": "1" }, h("p", {}, T("This court is not waiting for rulings.", "這個法庭沒有在等裁決。")),
      v.ruled?.length ? h("ol", { class: "ct-list" }, v.ruled.map((r) => h("li", {}, h("span", { class: "mono" }, `${r.case} ${r.issues.map((n) => `#${n}`).join(" ")}`), ` ${r.pick}${r.packages?.length ? ` → ${r.packages.join(", ")}` : ""}${r.skipped ? T(" (not applied: the issue changed on GitHub)", "（沒套用：issue 在 GitHub 上改過了）") : ""}`, r.reason ? h("span", { class: "faint" }, ` — ${r.reason}`) : null))) : null,
      h("a", { href: `#/run/${encodeURIComponent(run)}` }, T("Open the Task", "開啟任務"))));
  }
  // a docket changed since (another case list): rulings kept for it are dropped
  if (s.rulings.some((r, i) => v.cases[i]?.id !== r.case)) { s.rulings = []; keep(key, s); }
  const prog = h("div", { class: "ct-prog", "aria-label": T(`${s.rulings.length} of ${v.cases.length} ruled`, `已裁決 ${s.rulings.length} / ${v.cases.length}`) }, v.cases.map((_, i) => h("i", { class: i < s.rulings.length ? "done" : i === s.rulings.length ? "cur" : null })),
    h("span", { class: "faint mono" }, `${Math.min(s.rulings.length + 1, v.cases.length)} / ${v.cases.length} · ${v.repository} @ ${String(v.commit).slice(0, 7)}`));
  return wrap(prog, s.rulings.length >= v.cases.length ? summary({ ...v, project, run }, key, s) : caseView({ ...v, project, run }, key, s));
}
routes.court = viewCourt;
// keys: 1–4 rule, R the reason, Z undo; inside the reason box Enter and Escape leave it; a popup takes its own keys
addEventListener("keydown", (e) => {
  if (S.route?.name !== "court" || e.ctrlKey || e.metaKey || e.altKey || document.querySelector(".ct-modal")) return;
  const t = e.target;
  if (t?.matches?.("[data-court-reason]")) { if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); t.blur(); } return; }
  if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
  const [project, run] = String(S.route.arg || "").split("/"), key = `${project}/${run}`, s = CT.state.get(key);
  if (/^[1-4]$/.test(e.key) && CT.rule) { e.preventDefault(); CT.rule(Number(e.key) - 1); }
  else if ((e.key === "r" || e.key === "R") && document.querySelector("[data-court-reason]")) { e.preventDefault(); document.querySelector("[data-court-reason]").focus(); }
  else if ((e.key === "z" || e.key === "Z") && s && !s.done) { e.preventDefault(); undo(key, s); }
});
})();
