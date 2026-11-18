// The review room (#/room/<merge card | Task | pull request | directory>; docs/units/review-room.md, src/domain/review-room.ts):
// one change explained by a skill's page (baton by default, public/review-explain.js): its versions on one line, the page in an
// isolated frame, and the room's own Q&A on the right, answered by the room's tutor. Every paid run is the captain's (a
// generation by itself on opening, per the captain's decision; a question confirmed once). Model text only ever goes into text
// nodes. A room from before keeps its whiteboard on disk: the page says so and offers it as a JSON file; Studio no longer draws it.
(() => {
const RR = { tutorMenu: null, rooms: new Map(), loading: new Set(), posting: new Set(), err: new Map(), poll: null, list: null, other: new Map() };
const api = async (u) => { const r = await fetch(u); let j = {}; try { j = await r.json(); } catch {} if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { code: j.code }); return j; };
const postJ = async (u, b) => { const r = await fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b ?? {}) }); let j = {}; try { j = await r.json(); } catch {} if (!r.ok || j.error) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { code: j.code, offer: j.offer }); return j; };
const uiLang = () => (["zh-TW", "zh-CN"].includes(document.documentElement.lang) ? document.documentElement.lang : "en");
const onRoom = (id) => S.route?.name === "room" && S.route.arg === id;
const rerender = () => { if (S.route?.name === "room") render(); };
const redraw = (id) => { if (onRoom(id)) render(); };
const enc = encodeURIComponent;
const readOnly = () => !!window.crewRemote?.token?.(); // a paired phone reads only
const page = (title, sub, ...kids) => h("div", { class: "page rr-page" }, h("div", { class: "phead" }, h("div", {}, h("h1", {}, title), sub ? h("p", {}, sub) : null)), ...kids);
const SVGNS = "http://www.w3.org/2000/svg";
const sv = (tag, attrs = {}, ...kids) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v); for (const c of kids.flat()) if (c) e.append(c); return e; };
const ICO = { back: "M15 6l-6 6 6 6", msg: "M4 5h16v11H9l-5 4z", down: ["M12 4v11", "M7 10l5 5 5-5", "M5 20h14"] };
const ic = (n) => sv("svg", { viewBox: "0 0 24 24", class: "rr-ic", "aria-hidden": "true" }, ...[].concat(ICO[n]).map((d) => sv("path", { d })));
/** a saved room in the Library (#/room/lib:<artifact>[@n]): its pages as saved (each version, the skill, head and cost), or an
 *  old whiteboard snapshot, offered as its JSON file */
const snapRoom = (id, snap, url) => { const old = snap.kind !== "review-room-pages", turns = old ? (snap.view?.turns || []).filter((t) => t.status === "done" || t.status === "interrupted" || t.status === "failed").length : 0;
  return { ...snap.view, card: { ...snap.view.card, id }, open: false, offer: null, running: null, oldBoard: old ? { turns, items: (snap.view?.board || []).length } : null,
    snapshot: { artifact: snap.artifact, n: snap.n, versions: snap.versions, savedAt: snap.savedAt, reason: snap.reason, url, room: snap.room || snap.subject?.room || null, pages: old ? null : snap.pages || [], cost: snap.cost || null, integrity: snap.integrity ?? null } }; };
const readLater = new Set();
async function load(id, open = false) {
  if (RR.loading.has(id)) return; RR.loading.add(id); const was = RR.rooms.get(id)?.running;
  try { const lib = /^lib:(room-[a-z0-9-]+)(?:@(\d+))?$/.exec(id), u = lib ? `/api/review-room/library/${lib[1]}${lib[2] ? `?v=${lib[2]}` : ""}` : null;
    RR.rooms.set(id, lib ? snapRoom(id, await api(u), u) : await api(`/api/review-room/${enc(id)}${open ? "?open=1" : ""}`)); RR.err.delete(id); }
  catch (e) { if (!RR.rooms.has(id)) RR.rooms.set(id, { error: e.message }); else RR.err.set(id, e.message); }
  finally { RR.loading.delete(id); redraw(id); schedule();
    // a run that ends with the captain on the room is read as an arrival (it does not wait for the room list); hidden, once back
    if (was != null && RR.rooms.get(id)?.running == null && onRoom(id)) { if (document.hidden) readLater.add(id); else load(id, true); } }
}
document.addEventListener("visibilitychange", () => { const id = S.route?.name === "room" ? S.route.arg : null; if (!document.hidden && id && readLater.delete(id)) load(id, true); });
function schedule() { clearTimeout(RR.poll); RR.poll = null; const id = S.route?.name === "room" ? S.route.arg : null, r = id && RR.rooms.get(id); if (r && r.running != null && !r.snapshot) RR.poll = setTimeout(() => { RR.poll = null; load(id); }, 2500); }
window.liveListen?.("review-room", (e) => { let d = {}; try { d = JSON.parse(e.data); } catch {} if (d.card && RR.rooms.has(d.card)) load(d.card);
  if (RR.list && onList()) { clearTimeout(RR.listPoll); RR.listPoll = setTimeout(() => { if (onList()) readList(); }, 800); } });

// ---------- the tutor: the captain picks it (this room's, else Studio's default, else Automatic); independence is information ----------
const LEVEL = { vendor: ["another vendor than the author", "和作者不同供應商"], model: ["same vendor as the author", "和作者同一個供應商"], same: ["the author's own model", "和作者同一個模型"] };
const levelPill = (m) => h("span", { class: `rr-pill${m.level === "vendor" ? "" : " warn"}`, "data-tutor-level": m.level || "unknown" }, m.level ? T(...LEVEL[m.level]) : T("independence from the author unknown", "和作者的獨立程度未知"));
/** the header's tutor: who it is and how independent from the author (said, not enforced); a click opens the picker */
function tutorButton(r) {
  const id = r.card.id, o = r.offer, src = r.tutorChoice?.source || "auto", pick = r.tutorChoice?.room || (src === "studio" ? r.tutorChoice?.studio : null);
  const text = o?.error ? T(`Tutor: ${pick ? `${pick.provider} · ${pick.model}` : "none"} — cannot run now`, `導師：${pick ? `${pick.provider} · ${pick.model}` : "無"}：現在不能用`)
    : T(`Tutor: ${o?.provider} · ${o?.model ?? "default model"} — ${o?.independence?.en ?? ""}`, `導師：${o?.provider} · ${o?.model ?? "預設模型"}：${o?.independence?.zh ?? ""}`);
  return h("button", { type: "button", class: `rr-pill rr-tutor${o?.error ? " bad" : o?.independence?.level === "same" || o?.warning ? " warn" : ""}`, "data-tutor-open": id, "data-tutor-warning": o?.warning ? "" : null, "data-independence": o?.independence?.level ?? null, "data-tutor-source": src, "aria-expanded": String(RR.tutorMenu === id), "aria-haspopup": "dialog", title: o?.error || text,
    onclick: () => { const open = RR.tutorMenu !== id; RR.tutorMenu = open ? id : null; rerender();
      // the keyboard follows: into the picker when it opens, back to the tutor's button when it closes
      requestAnimationFrame(() => document.querySelector(open ? "[data-tutor-menu] [data-tutor-pick]:not([disabled])" : "[data-tutor-open]")?.focus({ preventScroll: true })); } }, text);
}
async function pickTutor(id, pick) {
  RR.posting.add(`${id}/tutor`); RR.err.delete(id); rerender();
  try { RR.rooms.set(id, await postJ(`/api/review-room/${enc(id)}/tutor`, { pick })); RR.tutorMenu = null; RR.other.delete(id); dropPasteOffers(); } catch (e) { RR.err.set(id, e.message); }
  finally { RR.posting.delete(`${id}/tutor`); redraw(id); if (!RR.tutorMenu) requestAnimationFrame(() => document.querySelector("[data-tutor-open]")?.focus({ preventScroll: true })); }
}
/** a model that may not run as it stands (held, not verified, not on this machine's list): its reason, a warning, never a lock */
const heldPill = (m, attr) => m.held ? h("span", { class: "rr-pill warn", [attr]: "" }, m.listed === false ? T(`not reported by ${m.provider} on this machine; the vendor decides`, `${m.provider} 在這台機器上沒有回報；由供應商決定`) : /not verified/.test(m.held) ? T("not verified on this machine yet", "這台機器還沒驗證") : T(`may not run: ${m.held}`, `可能跑不了：${m.held}`)) : null;
/** "Other model…": any model of a provider Studio runs, entered by hand (where: the room's id, or "default" for Studio's) */
function otherModel(where, providers, busy, use) {
  const d = { provider: providers[0] || "", model: "", ...RR.other.get(where) }, now = () => ({ ...d, ...RR.other.get(where) }), model = d.model.trim();
  return h("form", { class: "rr-othermodel", "data-tutor-other": where, onsubmit: (e) => { e.preventDefault(); const c = now(), m = c.model.trim(); if (m && c.provider && !busy) use({ provider: c.provider, model: m }); } },
    h("span", {}, T("Other model…", "其他模型…")),
    h("select", { class: "input", "data-tutor-other-provider": where, disabled: busy, "aria-label": T("Provider", "供應商"), onchange: (e) => RR.other.set(where, { ...now(), provider: e.target.value }) },
      providers.map((p) => h("option", { value: p, selected: p === d.provider }, p))),
    h("input", { class: "input", "data-tutor-other-model": where, disabled: busy, maxlength: 120, placeholder: T("model id", "模型代號"), value: d.model, "aria-label": T("Model id", "模型代號"),
      oninput: (e) => { RR.other.set(where, { ...now(), model: e.target.value }); const b = e.target.form?.querySelector("[data-tutor-other-use]"); if (b) b.disabled = busy || !e.target.value.trim(); } }),
    h("button", { type: "submit", class: "btn", "data-tutor-other-use": where, disabled: busy || !model || !d.provider }, T("Use it", "用這個")),
    h("p", { class: "faint" }, T("Studio passes the id to the vendor as given and does not check it first: the vendor decides, and if it rejects the id or is not signed in, the turn fails with its error.", "Studio 把代號原樣交給供應商，不會先檢查：由供應商決定；不接受這個代號或沒登入時，這一回合會失敗並顯示它的錯誤。")));
}
/** the picker: Studio's default (or Automatic), then every model this machine has, then any model entered by hand; one that
 *  is held or not verified can be picked, its reason said (never swapped for another by itself); each says how independent
 *  it is from the change's author */
function tutorMenu(r) {
  const id = r.card.id, c = r.tutorChoice || {}, busy = RR.posting.has(`${id}/tutor`), cur = c.room;
  const dflt = c.studio ? T(`Studio's default: ${c.studio.provider} · ${c.studio.model}`, `Studio 預設：${c.studio.provider} · ${c.studio.model}`) : T("Automatic: Studio picks the most independent model it can run", "自動：Studio 挑它能跑、最獨立的模型");
  return h("div", { class: "rr-regenlist rr-tutormenu", role: "dialog", "aria-label": T("The tutor for this room", "這間審查室的導師"), "data-tutor-menu": id },
    h("b", {}, T("The tutor for this room", "這間審查室的導師")),
    h("p", { class: "faint" }, T("Every answer in this room, the analysis on arrival, questions and regenerations run on it. Any model can be picked: how independent it is from the author and whether it may not run are shown, not enforced; one that cannot run fails with its vendor's error and is never swapped for another.", "這間房間的每個回答、進來時的分析、提問和重講都用它。任何模型都能選：和作者的獨立程度、可能跑不了的原因只是資訊，不會強制；跑不了時會顯示供應商的錯誤，不會被偷偷換掉。")),
    h("button", { type: "button", class: "rr-regenopt", "data-tutor-pick": "default", "aria-pressed": String(!cur), disabled: busy, onclick: () => pickTutor(id, null) }, h("b", {}, dflt), !cur ? h("span", { class: "rr-pill ok" }, T("current", "目前")) : null),
    (r.tutors || []).map((m) => h("button", { type: "button", class: "rr-regenopt", "data-tutor-pick": `${m.provider}|${m.model}`, "aria-pressed": String(!!cur && cur.provider === m.provider && cur.model === m.model), disabled: busy, title: m.held || "", onclick: () => pickTutor(id, { provider: m.provider, model: m.model }) },
      h("b", {}, `${m.provider} · ${m.model}`), cur && cur.provider === m.provider && cur.model === m.model ? h("span", { class: "rr-pill ok" }, T("this room", "這間房間")) : null, levelPill(m),
      heldPill(m, "data-tutor-held"))),
    (r.tutors || []).length ? null : h("p", { class: "faint", "data-tutor-none": "" }, T("Studio has no facts about this machine's models yet: the room uses its own pick.", "Studio 還沒有這台機器模型的資料：房間用自己的選擇。")),
    (r.tutorProviders || []).length ? otherModel(id, r.tutorProviders, busy, (p) => pickTutor(id, p)) : null);
}
function tutorDefault() {
  const list = RR.list?.tutors || [], cur = RR.list?.settings?.tutor || null, val = cur ? `${cur.provider}|${cur.model}` : "auto", busy = RR.posting.has("default/tutor");
  const set = async (tutor) => { RR.posting.add("default/tutor"); try { const st = await postJ("/api/review-room/settings", { tutor }); if (RR.list) { RR.list.settings = st; readList(); } RR.other.delete("default"); dropPasteOffers(); PR.err.delete("home");
      // every room kept on this page offered the old default: each is read again when it is next opened
      for (const [rid, rr] of [...RR.rooms]) if (!rr?.snapshot && rr?.running == null) RR.rooms.delete(rid); } catch (er) { PR.err.set("home", er.message); } finally { RR.posting.delete("default/tutor"); } rerenderAny(); };
  return h("div", { class: "rr-tutordefaults" }, h("label", { class: "rr-imgopt rr-tutordefault" }, h("span", {}, T("Studio's default tutor for every room (a room can pick its own):", "每間審查室的預設導師（房間可以自己選）：")),
    h("select", { class: "input", "data-tutor-default": "", disabled: busy, onchange: (e) => { const v = e.target.value; set(v === "auto" ? null : { provider: v.split("|")[0], model: v.split("|").slice(1).join("|") }); } },
      h("option", { value: "auto", selected: val === "auto" }, T("Automatic: the most independent model Studio can run", "自動：Studio 能跑、最獨立的模型")),
      list.map((m) => h("option", { value: `${m.provider}|${m.model}`, selected: val === `${m.provider}|${m.model}`, "data-tutor-option-held": m.held ? "" : null }, `${m.provider} · ${m.model}${m.held ? m.listed === false ? T(` (entered by hand: not reported by ${m.provider} on this machine; the vendor decides)`, `（手動輸入：${m.provider} 在這台機器上沒有回報；由供應商決定）`) : T(` (warning: ${m.held})`, `（注意：${m.held}）`) : ""}`)))),
    (RR.list?.providers || []).length ? otherModel("default", RR.list.providers, busy, set) : null);
}
// ---------- a pull request by its URL: Studio reads it on GitHub (GET only) for a project connected to GitHub ----------
const PR = { url: new Map(), busy: new Set(), err: new Map(), checking: new Set(), offer: new Map(), shown: new Map() };
/** a switch changed: what a paste starts is asked again */
const dropPasteOffers = () => { PR.offer.clear(); PR.shown.clear(); };
const PR_URL = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+\/?$/;
/** a GitHub directory's address: a repository's page, or …/tree/<branch, tag or commit>/<path> */
const DIR_URL = /^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+(?:\/tree\/[^?#\s]+)?\/?$/;
const pastable = (u) => PR_URL.test(u) || DIR_URL.test(u);
/** the paste box's line: what opening the room starts (the room's default skill, by itself, once per head) */
function pasteLine() {
  return h("p", { class: "rr-paste-offer", "data-paste-offer": "baton" }, T("Opening the room starts baton by itself: one paid run on the room's tutor model, once per head. Studio only reads GitHub; nothing is written there.",
    "打開審查室就會自動用 baton 產生說明：用審查室導師的模型付費跑一次，每個 head 只一次。Studio 只讀 GitHub，不寫任何東西上去。"));
}
function prBox(where, repository) {
  const busy = PR.busy.has(where), err = PR.err.get(where);
  const go = async () => { const url = (PR.url.get(where) || "").trim(); if (!url || busy) return; PR.busy.add(where); PR.err.delete(where); rerenderAny();
    // a pull request's address, or (the home's box) a GitHub directory's
    try { const out = await postJ(PR_URL.test(url) || repository ? "/api/review-room/open-pr" : "/api/review-room/open-dir", { url, lang: uiLang() }); RR.rooms.set(out.id, out.room);
      PR.url.delete(where); location.hash = out.href; }
    catch (e) { PR.err.set(where, e.message); } finally { PR.busy.delete(where); rerenderAny(); } };
  return h("form", { class: "rr-prbox", "data-pr-box": where, onsubmit: (e) => { e.preventDefault(); go(); } },
    h("label", { class: "rr-prlabel" }, h("span", {}, repository ? T(`Review a pull request of ${repository}`, `審查 ${repository} 的 pull request`) : T("Review a pull request, or learn a directory of any GitHub repository", "審查一個 pull request，或學習任何 GitHub 儲存庫的一個目錄")),
      h("input", { class: "input", type: "url", "data-pr-url": where, required: true, disabled: busy, maxlength: 800, placeholder: repository ? `https://github.com/${repository}/pull/123` : "https://github.com/<owner>/<repo>/pull/<number>  ·  …/tree/<branch>/<path>", value: PR.url.get(where) || "",
        oninput: (e) => PR.url.set(where, e.target.value), "aria-label": repository ? T("Pull request URL", "Pull request 網址") : T("Pull request or directory URL", "Pull request 或目錄的網址") })),
    pasteLine((PR.url.get(where) || "").trim()),
    h("button", { type: "submit", class: "btn primary", "data-pr-open": where, disabled: busy }, busy ? T("Reading it on GitHub…", "正在讀取 GitHub…") : T("Open its review room", "開啟它的審查室")),
    h("p", { class: "faint" }, repository ? T("Only a pull request of a registered project connected to GitHub. Studio only reads it on GitHub and copies its commits into its own folder; nothing is written to GitHub or to your checkout.", "只限已註冊且連到 GitHub 的專案的 pull request。Studio 只在 GitHub 上讀取，並把它的 commit 複製到 Studio 自己的資料夾；不寫任何東西到 GitHub 或你的本機儲存庫。")
      : T("A pull request of a registered project connected to GitHub; or a directory of any GitHub repository (a public one as it is, a private one through your gh login), read at one commit. Studio only reads GitHub and copies the commits into its own folder; nothing is written to GitHub or to your checkout.", "已註冊且連到 GitHub 的專案的 pull request；或任何 GitHub 儲存庫的一個目錄（公開的直接讀，私人的用你的 gh 登入），固定在一個 commit。Studio 只讀 GitHub，並把 commit 複製到 Studio 自己的資料夾；不寫任何東西到 GitHub 或你的本機儲存庫。")),
    err ? h("p", { class: "rr-err", role: "alert", "data-pr-error": where }, err) : null);
}
const rerenderAny = () => { if (S.route?.name === "room" || S.route?.name === "project") render(); };
window.crewReviewRoomPrBox = (project, repository) => h("section", { class: "card x-pad", "data-project-review-room": project }, prBox(`project:${project}`, repository));
async function checkNow(id) {
  if (PR.checking.has(id)) return; PR.checking.add(id); RR.err.delete(id); rerender();
  try { RR.rooms.set(id, await postJ(`/api/review-room/${enc(id)}/check`, {})); } catch (e) { RR.err.set(id, e.message); } finally { PR.checking.delete(id); redraw(id); }
}
/** The room's header: back, what the room is about (one line, cut), its state as pills (the pull request on GitHub, new
 *  commits since the captain last looked, the tutor and how independent it is), Check for new commits, GitHub, Firstmate */
function header(r) {
  const id = r.card.id, ps = r.prState, mv = r.moved, kind = r.subject?.kind || "merge", offer = r.offer, ds = r.diffstat?.total;
  const title = T(r.card.title?.en || r.card.id, r.card.title?.["zh-TW"] || r.card.title?.en || r.card.id);
  const sub = kind === "merge" ? T(`${r.task.title} · ${r.card.id}${r.pr?.id ? ` · PR #${r.pr.id}` : ""} · head ${String(r.head || "").slice(0, 8)}. The tutor reads only; the room never answers the merge card.`, `${r.task.title} · ${r.card.id}${r.pr?.id ? ` · PR #${r.pr.id}` : ""} · head ${String(r.head || "").slice(0, 8)}。導師只讀；審查室不會回覆合併卡。`)
    : kind === "branch" ? T(`${r.task?.title || r.card.id} · its branch · head ${String(r.head || "").slice(0, 8)}. The tutor reads only; the room changes nothing about the Task.`, `${r.task?.title || r.card.id} · 它的分支 · head ${String(r.head || "").slice(0, 8)}。導師只讀；審查室不改變任務的任何事。`)
    : kind === "dir" ? T(`${r.dir?.repository || r.subject?.repository || ""}${r.dir?.path ? `/${r.dir.path}` : ""} @ ${r.dir?.ref || ""} · pinned at ${String(r.dir?.sha || "").slice(0, 8)}. The tutor reads only; nothing is written to GitHub.`, `${r.dir?.repository || r.subject?.repository || ""}${r.dir?.path ? `/${r.dir.path}` : ""} @ ${r.dir?.ref || ""} · 固定在 ${String(r.dir?.sha || "").slice(0, 8)}。導師只讀；不寫任何東西到 GitHub。`)
    : T(`${r.subject?.repository || ""} #${r.subject?.number || ""} · head ${String(r.head || "").slice(0, 8)}. Studio only reads GitHub; the room never comments, reviews or merges.`, `${r.subject?.repository || ""} #${r.subject?.number || ""} · head ${String(r.head || "").slice(0, 8)}。Studio 只讀 GitHub；審查室不留言、不審查、不合併。`);
  const verdicts = ps?.verdicts?.length ? ps.verdicts.map((v) => `${v.author}: ${v.state === "APPROVED" ? T("approved", "核准") : v.state === "CHANGES_REQUESTED" ? T("changes requested", "要求修改") : T("dismissed", "撤銷")}${v.current ? "" : T(" (an older head)", "（較舊的 head）")}`).join(" · ") : null;
  const pill = (attrs, ...kids) => h("span", { ...attrs, class: `rr-pill ${attrs.class || ""}`, title: attrs.title ?? kids.flat().map((k) => typeof k === "string" ? k : k?.textContent || "").join("") }, ...kids);
  const back = r.snapshot ? h("a", { class: "rr-back", href: `#/artifact/${enc(r.snapshot.artifact)}` }, ic("back"), h("span", {}, T("Library", "成品庫"))) : r.task?.id ? h("a", { class: "rr-back", href: `#/run/${enc(r.task.id)}`, "data-room-task": "" }, ic("back"), h("span", {}, T("Task", "任務"))) : h("a", { class: "rr-back", href: "#/room" }, ic("back"), h("span", {}, T("Rooms", "審查室")));
  return h("header", { class: "rr-head", "data-room-subject": kind },
    back, kind === "merge" ? h("a", { class: "rr-back", href: `#/inbox/${enc(r.card.id)}` }, T("The merge card", "合併卡")) : null,
    h("div", { class: "rr-htitle" }, h("span", { class: "rr-crumb" }, h("a", { href: "#/room", "data-room-home": "" }, T("Review room", "審查室")), " › "), h("b", { title }, title), h("span", { title: sub }, sub)),
    h("div", { class: "rr-pills" },
      ps ? pill({ class: ps.state === "merged" ? "ok" : ps.state === "closed" ? "bad" : ps.approved ? "ok" : "", "data-pr-state": ps.state, "data-pr-approved": String(!!ps.approved) }, h("span", {}, ps.state === "merged" ? T("Merged on GitHub", "已在 GitHub 合併") : ps.state === "closed" ? T("Closed on GitHub", "已在 GitHub 關閉") : ps.approved ? T("Open · approved at this head", "開啟中 · 已在這個 head 核准") : ps.draft ? T("Open · draft", "開啟中 · 草稿") : T("Open", "開啟中")),
        " · ", ps.headRepo && r.subject?.repository && ps.headRepo.toLowerCase() !== r.subject.repository.toLowerCase() ? T(`from the fork ${ps.headRepo} · `, `來自 fork ${ps.headRepo} · `) : "", verdicts ? h("span", { "data-pr-verdicts": "" }, verdicts) : T("No reviewer verdict yet", "還沒有審查者的結論"),
        h("span", { class: "faint" }, T(` · read on GitHub ${String(ps.checkedAt || "").slice(0, 16).replace("T", " ")}`, ` · ${String(ps.checkedAt || "").slice(0, 16).replace("T", " ")} 讀取自 GitHub`))) : null,
      r.stale ? pill({ class: "bad", role: "status", "data-pr-stale": "" }, T(`GitHub shows newer commits (${String(r.stale.head).slice(0, 8)}) Studio could not fetch yet: ${r.stale.error}. The room shows the last head it has; check again before asking.`, `GitHub 上有較新的 commit（${String(r.stale.head).slice(0, 8)}），Studio 還沒抓到：${r.stale.error}。審查室顯示它手上最後的 head；提問前請再檢查一次。`)) : null,
      kind === "branch" ? pill({ class: r.reviewed ? "ok" : "", "data-branch-state": r.reviewed ? "reviewed" : "not-reviewed" }, r.reviewed ? T(`Reviewed by Studio at ${String(r.head || "").slice(0, 8)}${r.local ? " · ready on its local branch, not published" : ""}`, `Studio 已在 ${String(r.head || "").slice(0, 8)} 審查通過${r.local ? " · 在本機分支上就緒，不會發布" : ""}`) : T("Studio's review has not passed at this head yet.", "Studio 的審查還沒在這個 head 通過。")) : null,
      mv ? pill({ class: "warn", role: "status", "data-room-moved": mv.commits ?? "rewritten" }, mv.commits != null ? T(`${mv.commits} new commit${mv.commits === 1 ? "" : "s"} since the last page (${mv.from.slice(0, 8)} → ${mv.to.slice(0, 8)}).`, `上一頁之後有 ${mv.commits} 個新 commit（${mv.from.slice(0, 8)} → ${mv.to.slice(0, 8)}）。`)
        : T(`The branch was rewritten since the last page (${mv.from.slice(0, 8)} → ${mv.to.slice(0, 8)}).`, `上一頁之後分支被改寫了（${mv.from.slice(0, 8)} → ${mv.to.slice(0, 8)}）。`)) : null,
      // a directory: where it is pinned (its citations open that commit, it never moves), and whether it is private
      kind === "dir" && r.dir ? pill({ "data-dir-pin": r.dir.sha, title: T(`Read at ${r.dir.ref}, pinned at commit ${r.dir.sha}`, `讀的是 ${r.dir.ref}，固定在 commit ${r.dir.sha}`) }, T(`Pinned at ${String(r.dir.sha).slice(0, 8)} · ${r.dir.files} files`, `固定在 ${String(r.dir.sha).slice(0, 8)} · ${r.dir.files} 個檔案`), r.dir.private ? T(" · private", " · 私人") : "") : null,
      ds ? pill({ "data-room-diffstat": "" }, h("b", { class: "add" }, `+${ds.added}`), " ", h("b", { class: "del" }, `−${ds.removed}`), T(` · ${ds.files} file${ds.files === 1 ? "" : "s"}`, ` · ${ds.files} 個檔案`)) : null,
      // who the tutor is and how independent it is from the author (another vendor, another model of the same vendor, or the same model)
      // a room that takes turns: the pill is the tutor picker (this room's pick, Studio's default, or Automatic)
      r.open && !r.snapshot && !readOnly() ? tutorButton(r) : offer?.independence ? pill({ class: offer.independence.level === "same" ? "warn" : "", "data-independence": offer.independence.level }, T(`Tutor: ${offer.provider} · ${offer.model ?? "default model"} — ${offer.independence.en}`, `導師：${offer.provider} · ${offer.model ?? "預設模型"}：${offer.independence.zh}`)) : null),
    RR.tutorMenu === id && r.open && !r.snapshot ? tutorMenu(r) : null,
    kind === "pr" && !r.snapshot ? h("button", { type: "button", class: "rr-back", "data-room-check": id, disabled: PR.checking.has(id) || r.checking || null, onclick: () => checkNow(id) }, PR.checking.has(id) || r.checking ? T("Reading GitHub…", "正在讀取 GitHub…") : T("Check for new commits", "檢查新的 commit")) : null,
    kind === "pr" && /^https:\/\/github\.com\//.test(r.subject?.url || "") ? h("a", { class: "rr-back", href: r.subject.url, target: "_blank", rel: "noopener noreferrer", "data-room-github": "" }, T("Open on GitHub", "在 GitHub 開啟")) : null,
    kind === "dir" && r.dir?.sha && /^[\w.-]+\/[\w.-]+$/.test(r.dir.repository || "") ? h("a", { class: "rr-back", href: `https://github.com/${r.dir.repository}/tree/${r.dir.sha}${r.dir.path ? `/${r.dir.path.split("/").map(encodeURIComponent).join("/")}` : ""}`, target: "_blank", rel: "noopener noreferrer", "data-room-github": "" }, T("Open on GitHub", "在 GitHub 開啟")) : null,
    // the Library: save the room (any time; an ended room is saved by Studio), or, in a saved room, its versions
    r.snapshot ? h("span", { class: "rr-pill", "data-room-snapshot": `${r.snapshot.artifact}@${r.snapshot.n}`, title: r.snapshot.reason || "" }, T(`Saved ${String(r.snapshot.savedAt || "").slice(0, 16).replace("T", " ")} · read-only`, `存於 ${String(r.snapshot.savedAt || "").slice(0, 16).replace("T", " ")} · 唯讀`)) : null,
    r.snapshot && r.snapshot.versions?.length > 1 ? h("span", { class: "rr-vers", role: "group", "aria-label": T("Saved versions", "存過的版本") }, r.snapshot.versions.map((v) => h("a", { class: "rr-ver", href: `#/room/lib:${r.snapshot.artifact}@${v.n}`, "data-snapshot-version": v.n, "aria-current": v.n === r.snapshot.n ? "page" : null }, `v${v.n}`))) : null,
    r.library && !r.snapshot ? h("a", { class: "rr-back", href: `#/room/lib:${r.library.artifact}`, "data-room-library": r.library.artifact }, T(`Library v${r.library.versions.at(-1)?.n}`, `成品庫 v${r.library.versions.at(-1)?.n}`)) : null,
    // 封存: the room stays whole and keeps working; this only moves it on the room list
    !r.snapshot && r.archived ? pill({ "data-room-archived": "" }, T("Archived", "已封存")) : null,
    !r.snapshot ? archiveBtn({ id, zone: r.archived ? "archived" : null }) : null,
    // "Explain with": the built-in tutor or one of the captain's own skills (public/review-explain.js), at the header's right end
    !r.snapshot ? window.crewRoomExplain?.picker(r) : null,
    // Firstmate opens over the room as a sheet, never a column beside the board
    h("button", { type: "button", class: "rr-back", "data-room-firstmate": "", "aria-label": T("Firstmate (over the room)", "Firstmate（疊在審查室上）"), onclick: () => (document.body.classList.contains("chat-closed") ? document.getElementById("chatFab") : document.getElementById("chatClose"))?.click() }, ic("msg"), h("span", {}, "Firstmate")));
}
const onList = () => S.route?.name === "room" && !S.route.arg;
/** the list read again. Only the rows are drawn again when they are there (public/list-tools.js ltItems): the search box stays the
 *  same element, a composition in it unbroken */
function readList() { if (!RR.list) return; RR.list.fresh = true; api("/api/review-room").then((j) => { RR.list = { rooms: j.rooms || [], settings: j.settings || null, tutors: j.tutors || [], providers: j.providers || [], fresh: true }; if (!onList()) return;
  const list = document.querySelector('[data-lt="room"]'); if (!list?.ltItems || !RR.list.rooms.length) return render(); list.ltItems(RR.list.rooms); document.querySelector("[data-room-list]")?.setAttribute("data-room-list", RR.list.rooms.length); }).catch(() => {}); }
/** the room list's zones, in order (src/domain/review-room.ts ROOM_ZONES decides which one a room is in) */
const ZONES = [["waiting", "Waiting for me", "等我看"], ["reviewing", "In review", "審查中"], ["concluded", "Concluded", "已結論"], ["archived", "Archived", "封存"]];
/** a row's archive or restore button: the captain, on this Mac (a phone reads the list) */
function archiveBtn(x) { if (readOnly()) return null; const off = x.zone === "archived";
  return h("button", { type: "button", class: "rr-back rr-rowact", [off ? "data-room-restore" : "data-room-archive"]: x.id, disabled: RR.posting.has(`${x.id}/archive`), onclick: () => setArchived(x.id, !off) }, off ? T("Restore", "還原") : T("Archive", "封存")); }
async function setArchived(id, on) { RR.posting.add(`${id}/archive`); rerender();
  try { const out = await postJ(`/api/review-room/${enc(id)}/archive`, { archived: on });
    // restoring in the room is not arriving: the captain was never shown this plan, so nothing paid starts by itself ("Teach me" still does)
    if (out?.view?.card) RR.rooms.set(id, out.view);
    if (RR.list) { const x = RR.list.rooms.find((y) => y.id === id); if (x && out?.zone) x.zone = out.zone; RR.list.err = null; if (onList()) readList(); else RR.list.fresh = false; } }
  catch (e) { if (onRoom(id)) RR.err.set(id, e.message); else if (RR.list) RR.list.err = e.message; }
  finally { RR.posting.delete(`${id}/archive`); rerender(); } }
const roomRow = (x, mark = (t) => t) => h("li", { "data-room-row": x.id },
  h("a", { href: `#/room/${enc(x.id)}`, "data-room-link": x.id }, h("b", {}, mark(T(x.title, x.titleZh || x.title)))), " ",
  h("span", { class: `rr-pill${x.open ? " ok" : ""}` }, x.running ? T("generating", "產生中") : x.open ? T("open", "開啟中") : T("read-only", "唯讀")),
  h("span", { class: "faint" }, ` · ${T(`${x.turns} answer${x.turns === 1 ? "" : "s"}`, `${x.turns} 個回答`)} · ${String(x.updatedAt).slice(0, 16).replace("T", " ")}`), archiveBtn(x));
/** a zone's rooms under their repositories, by name; rooms with none last. A repository's letter case does not split it */
function repoGroups(rooms, mark) { const by = new Map(); for (const x of rooms) { const k = String(x.repository || "").toLowerCase(); if (!by.has(k)) by.set(k, { name: x.repository, rooms: [] }); by.get(k).rooms.push(x); }
  return [...by.entries()].sort(([a], [b]) => !a - !b || a.localeCompare(b)).map(([k, g]) => h("div", { class: "rr-repo", "data-room-repo": k },
    h("h4", {}, g.name || T("No repository", "沒有儲存庫")), h("ul", { class: "rr-roomlist" }, g.rooms.map((x) => roomRow(x, mark))))); }
const zoneOf = (x) => x.zone || "reviewing";
const repoKey = (x) => String(x.repository || "").toLowerCase();
/** the rooms under the list toolbar (public/list-tools.js). Its search covers all four zones, 封存 included (it opens while
 *  filtering). Sorted by zone (the default), a page of rooms is drawn in its zones and repositories, each zone counting
 *  all its matching rooms; sorted by time, as one list */
function roomsList(rooms) {
  const zi = (x) => ZONES.findIndex(([id]) => id === zoneOf(x));
  return window.crewListTools.list({ id: "room", route: "room", title: T("review rooms", "審查室"), noun: ["review room", "審查室"], items: rooms,
    placeholder: T("Search every zone: title, repository, room…  or type zone:waiting", "搜尋所有區：標題、儲存庫、審查室…  也可以打 zone:等我看"),
    inputAttrs: { "data-room-search": "", "aria-label": T("Search the review rooms", "搜尋審查室") }, emptyAttrs: { "data-room-nomatch": "" },
    text: (x) => [x.title, x.titleZh, x.repository, x.id],
    facets: [{ key: "zone", name: T("Zone", "區"), value: zoneOf, show: (z) => { const r = ZONES.find(([id]) => id === z); return r ? T(r[1], r[2]) : z; } },
      { key: "repo", name: T("Repository", "儲存庫"), value: (x) => x.repository || null },
      { key: "state", name: T("State", "狀態"), value: (x) => (x.running ? "running" : x.open ? "open" : "readonly"), show: (k) => ({ running: T("a turn is running", "有一回合在跑"), open: T("open", "開啟中"), readonly: T("read-only", "唯讀") })[k] || k }],
    sorts: [{ key: "zone", label: T("By zone", "按區"), cmp: (a, b) => zi(a) - zi(b) || (!repoKey(a) - !repoKey(b)) || repoKey(a).localeCompare(repoKey(b)) || String(b.updatedAt).localeCompare(String(a.updatedAt)) },
      { key: "new", label: T("Newest first", "最新的在上"), cmp: (a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)) }],
    rows: (page, ctx) => {
      if (ctx.sort !== "zone") return h("div", { "data-room-zones": "" }, h("ul", { class: "rr-roomlist" }, page.map((x) => roomRow(x, ctx.mark))));
      const zones = ZONES.map(([id, en, zh]) => { const inPage = page.filter((x) => zoneOf(x) === id), all = ctx.matched.filter((x) => zoneOf(x) === id).length;
        // a zone with nothing in it says so, on the first page of the unfiltered list; otherwise only the zones this page holds
        if (!inPage.length && (ctx.filtered || ctx.page > 1 || all)) return null;
        const head = [T(en, zh), h("span", { class: "rr-zonecount" }, String(all))];
        const body = inPage.length ? repoGroups(inPage, ctx.mark) : h("p", { class: "faint" }, T("Nothing here.", "這裡沒有審查室。"));
        if (id !== "archived") return h("section", { class: "rr-zone", "data-room-zone": id }, h("h3", {}, head), body);
        return h("details", { class: "rr-zone", "data-room-zone": id, open: ctx.filtered || !!RR.listArchived, ontoggle: (e) => { if (!ctx.filtered) RR.listArchived = e.target.open; } }, h("summary", {}, h("h3", {}, head)), body); });
      return h("div", { "data-room-zones": "" }, zones);
    } });
}
/** a room from before: its whiteboard turns stay on disk; Studio no longer draws them, and offers the whole record as a file
 *  (on this Mac only: a paired phone reads the notice, never the file) */
function oldBoard(r) {
  const ob = r.oldBoard; if (!ob || (!ob.turns && !ob.items)) return null; const turns = ob.turns || 0;
  const href = r.snapshot ? r.snapshot.url : `/api/review-room/${enc(r.card.id)}/export`;
  return h("div", { class: "rr-oldboard", role: "note", "data-old-board": turns },
    h("span", { class: "rr-oldboard-ic", "aria-hidden": "true" }, "▤"),
    h("div", {}, h("b", {}, r.snapshot ? T("A saved whiteboard", "存下來的舊白板") : T(`This room has ${turns} whiteboard turn${turns === 1 ? "" : "s"} from before`, `這間審查室有 ${turns} 個舊白板回合`)),
      h("p", {}, r.snapshot ? T("Studio no longer shows the board. The saved snapshot is kept as it was: download it as a file.", "Studio 已經不再顯示白板。存下來的快照原封不動保留，可以下載成檔案。")
        : T("Studio no longer shows the board: baton explains the room instead. Nothing was deleted; the old turns and drawings are in the room's record.", "Studio 已經不再顯示白板，改由 baton 說明這間審查室。什麼都沒刪：舊的回合和圖都還在房間的紀錄裡。"),
        readOnly() ? h("span", { class: "faint", "data-old-board-desktop": "" }, " ", T("The file downloads on the Mac running Studio.", "檔案要在執行 Studio 的 Mac 上下載。")) : null)),
    readOnly() ? null : h("a", { class: "btn sm", href, download: `${r.card.id.replace(/^lib:/, "")}.json`, "data-old-board-download": "" }, ic("down"), " ", T("Download the old board (JSON)", "下載舊白板（JSON）")));
}
/** a Library save of a room's pages: each version as saved (its skill, head, model and cost); the pages are read in the room */
function savedPages(r) {
  const sp = r.snapshot?.pages; if (!sp) return null; const room = r.snapshot.room;
  const usd = (c) => typeof c?.usd === "number" && c.usd > 0 ? ` · US$${c.usd.toFixed(2)}` : "";
  return h("section", { class: "card x-pad rr-saved", "data-saved-pages": sp.length },
    h("h2", {}, T(`${sp.length} page version${sp.length === 1 ? "" : "s"} saved${usd(r.snapshot.cost)}`, `存了 ${sp.length} 個頁面版本${usd(r.snapshot.cost)}`)),
    Array.isArray(r.snapshot.integrity) && r.snapshot.integrity.length ? h("p", { class: "rr-err", role: "alert", "data-saved-integrity": "bad" }, T("These files changed since they were saved.", "這些檔案存下來之後被改過。")) : null,
    h("ol", { class: "rr-saved-list" }, sp.map((v) => h("li", { "data-saved-page": v.n },
      h("b", {}, `v${v.n}`), " ", v.skill?.id === "studio-baton" ? T("baton (built in)", "baton（內建）") : (v.skill?.name || ""),
      h("span", { class: "faint" }, ` · ${String(v.at || "").slice(0, 16).replace("T", " ")}${v.head ? ` · ${String(v.head).slice(0, 8)}` : ""}${v.model ? ` · ${v.model}` : ""}${usd(v.cost)}`),
      v.summary ? h("div", { class: "faint" }, v.summary) : null))),
    room ? h("a", { class: "btn sm", href: `#/room/${enc(room)}`, "data-saved-open-room": room }, T("Read the pages in the review room", "到審查室看這些頁面")) : null);
}
routes.room = (arg) => {
  if (!arg) { if (!RR.list) { RR.list = { rooms: [], loading: true }; api("/api/review-room").then((j) => { RR.list = { rooms: j.rooms || [], settings: j.settings || null, tutors: j.tutors || [], providers: j.providers || [] }; }).catch((e) => { RR.list = { rooms: [], error: e.message }; }).finally(() => { if (onList()) render(); }); }
    else if (!RR.list.loading && !RR.list.fresh) readList();
    const rooms = RR.list.rooms || [];
    return page(T("Review room", "審查室"), T("Open a review room from a merge card, from a Task whose branch passed Studio's review, or paste a pull request's URL or a GitHub directory's.", "可以從合併卡、從通過 Studio 審查的任務分支開啟審查室，或貼上 pull request 或 GitHub 目錄的網址。"),
      h("section", { class: "card x-pad", "data-room-list": rooms.length, "data-room-list-loading": RR.list.loading ? "" : null }, h("h2", {}, T("Your review rooms", "你的審查室")),
        RR.list.loading ? h("p", { class: "faint" }, T("Loading…", "載入中…")) : rooms.length ? [
          RR.list.err ? h("p", { class: "rr-err", role: "alert", "data-room-list-err": "" }, RR.list.err) : null, roomsList(rooms)] : h("p", { class: "faint" }, T("No review room yet.", "還沒有審查室。"))),
      h("section", { class: "card x-pad", "data-review-home": "" }, prBox("home", null), tutorDefault())); }
  const r = RR.rooms.get(arg);
  if (!r) { load(arg, true); return page(T("Review room", "審查室"), "", h("div", { class: "card x-pad faint" }, T("Loading…", "載入中…"))); }
  if (r.error) return page(T("Review room", "審查室"), "", h("div", { class: "card x-pad rr-err", "data-room-error": "" }, r.error));
  const err = RR.err.get(arg), XP = window.crewRoomExplain;
  // a saved snapshot: read only, its pages listed (or an old board offered as its file)
  if (r.snapshot) return h("div", { class: "rr-room rx-room", "data-review-room": r.card.id }, header(r), savedPages(r), oldBoard(r));
  XP?.ensure(arg);
  return h("div", { class: "rr-room rx-room", "data-review-room": r.card.id }, header(r), oldBoard(r),
    err ? h("p", { class: "rr-err", role: "alert", "data-room-err": "" }, err) : null,
    XP ? XP.view(r) : h("div", { class: "card x-pad faint" }, T("Loading…", "載入中…")));
};
routes.room.focus = (arg) => (arg && RR.rooms.has(arg) && !RR.rooms.get(arg).error ? "room" : null);
window.crewReviewRoomData = (id) => RR.rooms.get(id) || null;
// the header's tutor picker closes on Escape, its button taking the focus back
addEventListener("keydown", (e) => { if (e.key !== "Escape" || S.route?.name !== "room" || !S.route.arg || RR.tutorMenu !== S.route.arg) return;
  RR.tutorMenu = null; e.preventDefault(); rerender(); requestAnimationFrame(() => document.querySelector("[data-tutor-open]")?.focus({ preventScroll: true })); });
// back in any live room (the room list, a link): read it again as an arrival (?open=1), so a head that moved since is seen
addEventListener("hashchange", () => { if (RR.list && !(S.route?.name === "room" && !S.route.arg)) RR.list.fresh = false;
  const id = S.route?.name === "room" ? S.route.arg : null, r = id && RR.rooms.get(id); if (r && !r.snapshot && !r.error) load(id, r.running == null); });
})();
// The splitter between the room's main area and its right-hand pane (the board's conversation, the skill's chat): dragged, or
// focused and moved with the arrow keys (Shift for bigger steps, Home and End for the bounds); a double-click or Enter goes back
// to the default width. The width is kept per view on this browser (localStorage) as a property on the page's root, so a redraw
// of the room keeps it; the CSS clamps it again to the room's width (review-room.css .rr-split).
// The separator's value is the main area's width (the panel before it): ← lowers it and widens the pane.
(() => {
const MIN = { explain: 320 }, MAX = 720, STEP = 16, root = document.documentElement;
const keepOf = () => 0;
const key = (v) => `crew.roomPane.${v}`, prop = (v) => `--rr-pane-${v}`;
const read = (v) => { try { const n = Number(localStorage.getItem(key(v))); return n > 0 ? n : null; } catch { return null; } };
const keep = (v, n) => { try { if (n == null) localStorage.removeItem(key(v)); else localStorage.setItem(key(v), String(n)); } catch {} };
const apply = (v, n) => { if (n == null) root.style.removeProperty(prop(v)); else root.style.setProperty(prop(v), `${n}px`); };
for (const v of Object.keys(MIN)) apply(v, read(v));
const box = () => document.querySelector(".rx-body");
const paneOf = (v) => box(v)?.querySelector(":scope > .rx-chat");
const mainOf = (v) => box(v)?.querySelector(":scope > .rx-stage");
const bounds = (v) => { const w = box(v)?.clientWidth || innerWidth; return [MIN[v], Math.max(MIN[v], Math.min(MAX, Math.floor(w * 0.55), keepOf(v) ? w - keepOf(v) : Infinity))]; };
const width = (v) => Math.round(paneOf(v)?.getBoundingClientRect().width || 0);
/** the pane's width when it is not on the page: the captain's, else the CSS default (review-room.css) */
const guess = (v) => read(v) ?? Math.round(Math.min(560, Math.max(360, innerWidth * 0.32)));
function sync(el) { const v = el.dataset.paneSplit, [lo, hi] = bounds(v), m = Math.round(mainOf(v)?.getBoundingClientRect().width || 0), all = m + width(v);
  el.setAttribute("aria-valuemin", String(all - hi)); el.setAttribute("aria-valuemax", String(all - lo)); el.setAttribute("aria-valuenow", String(m)); }
/** the pane's width, within its bounds (null: back to the default); kept unless a drag is still moving it */
function set(v, n, save = true) { const [lo, hi] = bounds(v), w = n == null ? null : Math.round(Math.min(hi, Math.max(lo, n))); apply(v, w);
  requestAnimationFrame(() => document.querySelectorAll(`[data-pane-split="${v}"]`).forEach(sync));
  if (save) keep(v, w); }
let drag = null;
// the grab's offset from the pane's edge, so the pane never jumps when the splitter is taken
function down(e) { if (e.button !== 0) return; e.preventDefault(); const el = e.currentTarget, v = el.dataset.paneSplit, b = box(v)?.getBoundingClientRect();
  drag = { v, off: b ? width(v) - (b.right - e.clientX) : 0, n: null }; el.classList.add("drag"); root.classList.add("rr-splitting"); el.focus({ preventScroll: true }); }
addEventListener("pointermove", (e) => { if (!drag) return; const b = box(drag.v)?.getBoundingClientRect(); if (b) { drag.n = b.right - e.clientX + drag.off; set(drag.v, drag.n, false); } });
const up = () => { if (!drag) return; const { v, n } = drag; drag = null; root.classList.remove("rr-splitting"); document.querySelectorAll(`[data-pane-split="${v}"]`).forEach((x) => x.classList.remove("drag")); if (n != null) set(v, n); };
addEventListener("resize", () => requestAnimationFrame(() => document.querySelectorAll("[data-pane-split]").forEach(sync)));
addEventListener("pointerup", up); addEventListener("pointercancel", up); addEventListener("blur", up);
function keydown(e) { const v = e.currentTarget.dataset.paneSplit, cur = width(v), d = e.shiftKey ? STEP * 4 : STEP, [lo, hi] = bounds(v);
  const n = { ArrowLeft: cur + d, ArrowRight: cur - d, Home: hi, End: lo }[e.key];
  if (n != null) { e.preventDefault(); set(v, n); } else if (e.key === "Enter") { e.preventDefault(); set(v, null); } }
/** the splitter between the output and the chat */
function handle(v) {
  const el = h("div", { class: "rr-split", role: "separator", tabindex: "0", "aria-orientation": "vertical", "data-pane-split": v,
    "aria-label": T("Resize the output and the chat", "調整產出和問答欄的寬度"),
    title: T("Drag, or use ← →, to resize · double-click to reset", "拖拉或用 ← → 調整寬度 · 雙擊回到預設"),
    onpointerdown: down, onkeydown: keydown, ondblclick: () => set(v, null) });
  // a redraw of the room replaces the splitter: one that had the keyboard (or a drag) keeps it
  const had = document.activeElement?.dataset?.paneSplit === v;
  if (drag?.v === v) el.classList.add("drag");
  if (had) { queueMicrotask(() => { if (el.isConnected) el.focus({ preventScroll: true }); }); requestAnimationFrame(() => { if (el.isConnected && document.activeElement !== el && (document.activeElement === document.body || !document.activeElement || document.activeElement.closest?.(".rx-stage"))) el.focus({ preventScroll: true }); }); }
  requestAnimationFrame(() => sync(el));
  return el;
}
window.crewRoomPane = { handle, set, width, guess };
})();
