// The review room's page and its questions (docs/units/review-room.md, src/domain/review-explain.ts): the room presented by a
// skill, baton (built in) by default; the header's picker chooses another. A skill's run is paid and confirmed (the model, who
// pays, the cost so far and an estimate, the materials, the expected time, the safety limit, the isolation); it runs in the
// background with live progress and a Stop, and Studio says when it ends; every generation is a version in the menu on the
// output's one-line bar. The chat on the right asks the room's tutor about the page shown: the answer is in the chat only, never
// a new version (a question asked while the first page is still being made waits for it).
// An output page lives in a sandboxed iframe (allow-scripts only: an opaque origin) on a page Studio serves with a CSP that allows
// no network. The frame sits in a layer of its own over the stage, so a redraw of the room never reloads it. Model text only ever
// goes into text nodes here. A generation carries the captain's own instructions ("What should it produce?", prefilled with what
// this skill was last asked for, part of the confirmed offer); every version shows what it was made from. The output fills the
// screen (the Fullscreen API on its layer, a picture or a video natively; a fixed full-window layer when fullscreen is refused)
// and opens in a tab of its own (a fresh capability, framed exactly as here).
(() => {
const X = { st: new Map(), loading: new Set(), err: new Map(), poll: new Map(), pick: null, confirm: null, shown: new Map(), draft: new Map(), caps: new Map(),
  posting: new Set(), autoPosted: new Set(), autoErr: new Map(), ask: null, consent: new Set(), logOpen: new Set(), queue: new Map(), pend: new Map(), returnTo: null, more: new Set(), madeOpen: new Set(), verMenu: null, news: new Set() };
const enc = encodeURIComponent;
/** Studio's built-in baton (src/domain/review-baton.ts BATON_PIN.id): the room's default skill */
const BUILTIN = "studio-baton";
const api = async (u) => { const r = await fetch(u); let j = {}; try { j = await r.json(); } catch {} if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { code: j.code }); return j; };
const postJ = async (u, b) => { const r = await fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b ?? {}) }); let j = {}; try { j = await r.json(); } catch {} if (!r.ok || j.error) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { code: j.code, offer: j.offer }); return j; };
const onRoom = (id) => S.route?.name === "room" && S.route.arg === id;
const base = (id) => `/api/review-room/${enc(id)}/explain`;
const state = (id) => X.st.get(id) || null;
const zh = () => /^zh/.test(document.documentElement.lang || "");
/** Studio's refusals come as "English / 中文": the captain's half only */
const bi = (m) => { const s = String(m ?? ""), i = s.indexOf(" / "); return i < 0 ? s : zh() ? s.slice(i + 3) : s.slice(0, i); };
const fmtMin = (ms) => { const m = Math.max(0, Math.round(ms / 60000)); return m < 1 ? T("under a minute", "不到一分鐘") : T(`${m} min`, `${m} 分鐘`); };
const money = (c) => (c && typeof c.usd === "number" ? `$${c.usd.toFixed(c.usd < 1 ? 3 : 2)}` : null);
const usd = (n) => (typeof n === "number" ? `$${n.toFixed(n < 1 ? 3 : 2)}` : null);
const hhmm = (t) => String(t || "").slice(11, 16);
const ts = (s) => { const t = Math.max(0, Math.floor(s || 0)); return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };
const skillName = (st, sid) => sid === BUILTIN ? T("baton (built in)", "baton（內建）") : st?.skills?.find((s) => s.id === sid)?.name || sid;
const latest = (st) => st?.versions?.at(-1) || null;
/** the version shown: the one picked in the version menu, else the newest of the selected skill, else the newest */
const shownVersion = (id) => { const st = state(id); if (!st) return null; const n = X.shown.get(id), sid = st.selected?.id;
  return st.versions.find((v) => v.n === n) || [...st.versions].reverse().find((v) => v.skill.id === sid) || latest(st); };
/** the skill the room is explained with now: the shown version's (what a follow-up runs), else the selected one */
/** a skill as the captain reads its name: the built-in baton in their language */
const sk = (s) => s?.id === BUILTIN ? T("baton (built in)", "baton（內建）") : (s?.name ?? "");
const shownSkill = (id) => { const st = state(id), v = shownVersion(id); return v ? { id: v.skill.id, name: sk(v.skill) } : st?.selected ? { id: st.selected.id, name: skillName(st, st.selected.id) } : null; };
/** the run that made a version (its model, cost and head) */
const runOf = (st, v) => st?.runs?.find((r) => r.n === v?.run) || null;
const short = (h) => String(h || "").slice(0, 7);
/** who runs it and who pays, in a line: the run's provider and model, billed to that provider's account on this Mac */
const whoPays = (run) => T(`On ${run.provider} · ${run.model || "default model"} · billed to the ${run.provider} account Studio runs it with on this Mac`,
  `用 ${run.provider} · ${run.model || "預設模型"} · 由這台 Mac 上 Studio 使用的 ${run.provider} 帳號付費`);
const liveRun = (st) => (st?.running != null ? st.runs.find((r) => r.n === st.running) : null);
const readOnly = () => !!window.crewRemote?.token?.(); // a paired phone: Studio runs paid work only from the Mac
const KIND = { html: ["HTML page", "HTML 頁"], markdown: ["Markdown", "Markdown"], image: ["picture", "圖片"], video: ["video", "影片"], text: ["text", "文字"] };
/** why a run stopped or failed, in the captain's words (the server's code; its English detail only where it adds something) */
const WHY = { captain: () => T("You stopped it.", "你按了停止。"), cancelled: () => T("It was cancelled.", "已取消。"), limit: (r) => T(`It ran past the safety limit of ${r.limitMin} min, so Studio stopped it.`, `超過 ${r.limitMin} 分鐘的安全時限，Studio 停下了它。`),
  interrupted: () => T("Studio stopped while it ran.", "執行到一半時 Studio 停止了。"), closed: () => T("The room stopped taking paid runs: its card was answered or its pull request closed.", "這間審查室不再接受付費執行：卡片已回覆，或 PR 已關閉。"),
  admission: () => T("A round could not be admitted.", "有一輪無法開始。"), provider: () => T("The model's provider reported an error.", "模型供應商回報錯誤。"), outputLimit: () => T("The model's reply hit its output limit twice in a row, so Studio stopped it.", "模型的回覆連續兩次碰到輸出上限，Studio 停下了它。"), stalled: (r) => r.stalled ? T(`The output did not change for ${r.stalled} rounds in a row, so Studio stopped it.`, `產出連續 ${r.stalled} 輪都沒有變，Studio 停下了它。`) : T("The output stopped changing, so Studio stopped it.", "產出不再變化，Studio 停下了它。"),
  entry: () => T("The skill named an output file that is not there.", "skill 說的產出檔案不存在。"), error: () => T("It could not run.", "無法執行。"), start: () => T("It could not start.", "無法開始。"),
  prepare: () => T("Studio could not install the skill's dependencies, so no round ran.", "Studio 沒辦法安裝 skill 的依賴，所以沒有開始任何一輪。") };
const DETAIL = new Set(["admission", "provider", "outputLimit", "error", "start", "entry", "prepare"]);
// a provider's message repeats the headline before its reason: only the reason is shown ("Reason: …" / "原因：…")
const detailOf = (r) => { const d = bi(r.error || r.stop || ""), m = r.why === "provider" ? /(?:Reason: |原因：)[\s\S]*$/.exec(d) : null; return m ? m[0] : d; };
const whyOf = (r) => { const f = WHY[r.why]; return { text: f ? f(r) : r.status === "stopped" ? T("It was stopped.", "已停止。") : T("It did not finish.", "沒有完成。"), detail: !f || DETAIL.has(r.why) ? detailOf(r) : "" }; };

async function load(id) {
  if (X.loading.has(id)) return; X.loading.add(id); const was = state(id)?.running;
  try { X.st.set(id, await api(base(id))); X.err.delete(id); settled(id); } catch (e) { X.err.set(id, bi(e.message)); }
  finally { X.loading.delete(id); ended(id, was); flushQueue(id); refresh(id); schedule(id); autoStart(id); }
}
/** Opening a room explained with the default skill (baton) starts its generation for this head by itself: no paid confirmation
 *  (the captain's standing decision), once per room and head on this page; Studio keeps the same rule (a reload, a second tab or
 *  a revisit starts nothing more), and a generation that did not finish waits for "Try again". A paired phone never starts one. */
function autoStart(id, retry = false) {
  const st = state(id), a = st?.auto; if (!onRoom(id) || readOnly() || !a || (!retry && !a.due)) return;
  const r = window.crewReviewRoomData?.(id); if (!r || r.snapshot || !r.open) return;
  const key = `${id}@${a.head}${retry ? `#retry-${Date.now()}` : ""}`; if (X.autoPosted.has(key) || X.posting.has(`${id}/auto`)) return; X.autoPosted.add(key);
  X.posting.add(`${id}/auto`); X.autoErr.delete(id); refresh(id);
  // a POST that did not reach Studio (or that Studio refused) may be sent again: the stage then says why, with Try again
  postJ(`${base(id)}/auto`, retry ? { retry: true } : {}).then((v) => { X.st.set(id, v); X.err.delete(id); }).catch((e) => { X.autoPosted.delete(key); X.autoErr.set(id, bi(e.message)); })
    .finally(() => { X.posting.delete(`${id}/auto`); refresh(id); schedule(id); });
}
/** the default skill's generation for the room's head, when Studio started it (or tried to) and it did not finish: why, and "Try again" */
function autoFailed(st, id) {
  const a = st?.auto; if (!a?.head || !a.skill) return null;
  const run = [...st.runs].reverse().find((x) => x.kind === "generate" && x.skill.id === a.skill && x.head === a.head);
  if (run) return run.opened && (run.status === "failed" || run.status === "stopped") ? { run, ...whyOf(run) } : null;
  if (a.tried?.error) return { run: null, text: T("Studio could not start it.", "Studio 沒辦法開始。"), detail: bi(a.tried.error), code: a.tried.code };
  // the page could not reach Studio to start it: say so, with Try again
  const pe = X.autoErr.get(id); return pe && a.due ? { run: null, text: T("Studio could not start it.", "Studio 沒辦法開始。"), detail: pe, code: null, page: true } : null;
}
function schedule(id) { clearTimeout(X.poll.get(id)); X.poll.delete(id); if (state(id)?.running != null && onRoom(id)) X.poll.set(id, setTimeout(() => load(id), 2500)); }
/** a run ended: say so when the captain is not watching it; a question asked while the first output was being made goes now */
function ended(id, was) {
  const st = state(id); if (was == null || st?.running != null) return; const r = st?.runs.find((x) => x.n === was); if (!r) return;
  const watching = onRoom(id) && active(id) && !document.hidden;
  if (!watching) { const msg = r.status === "done" ? (r.version ? T(`${sk(r.skill)}: v${r.version} is ready`, `${sk(r.skill)}：v${r.version} 好了`) : T(`${sk(r.skill)} answered your question`, `${sk(r.skill)} 回答了你的問題`)) : `${sk(r.skill)}: ${whyOf(r).text}`;
    try { toast(h("span", { "data-explain-toast": id }, msg, " ", h("a", { href: `#/room/${enc(id)}` }, T("Open the room", "打開審查室")))); } catch {} }
  const q = X.queue.get(id); if (q && r.kind === "generate" && r.status === "done" && onRoom(id) && active(id)) { X.queue.delete(id); X.shown.delete(id); queueMicrotask(() => send(id, q)); }
  // the generation stopped or failed: the waiting question goes back into the ask box (nothing is asked, nothing is lost)
  else if (q && r.kind === "generate" && r.status !== "done") { X.queue.delete(id); if (!X.draft.get(id)) X.draft.set(id, q); const ta = document.querySelector("[data-explain-q]"); if (ta && !ta.value) ta.value = q; }
}
/** a question that waited for the first output, its run finished while the captain was away: asked on coming back to the room
 *  (the paid confirmation still comes first, in the chat) */
function flushQueue(id) { const q = X.queue.get(id), st = state(id); if (!q || !onRoom(id) || !active(id) || !st || st.running != null || !latest(st)) return;
  X.queue.delete(id); X.shown.delete(id); queueMicrotask(() => send(id, q)); }
window.liveListen?.("review-explain", (e) => { let d = {}; try { d = JSON.parse(e.data); } catch {} if (!d.card || !X.st.has(d.card)) return;
  // on the room, or a run it knew of still going elsewhere: read it (so its end is told even off the room)
  if (onRoom(d.card) || state(d.card)?.running != null) load(d.card); });
/** a redraw of only the explainer's parts when they are on the page (the output's line, the stage, the chat's messages, the ask box's
 *  state); the output's frame (in its layer) and the question being written stay as they are */
function refresh(id) {
  if (!onRoom(id)) return; const el = document.querySelector(`[data-explain-room="${CSS.escape(id)}"]`);
  const r = window.crewReviewRoomData?.(id);
  if (!el || !r || !active(id)) { render(); return; }
  const st = state(id); tickStart();
  // a poll redraws the output's line, the open version menu with it: the control that had the focus there gets it back
  const kept = focusIn(el.querySelector("[data-x-line]"));
  for (const [sel, make] of [["[data-x-line]", () => bar(r, st)], ["[data-x-stage]", () => stage(r, st)], ["[data-x-scope]", () => scope(r, st)], ["[data-x-askrow]", () => askRow(r, st)]]) { const old = el.querySelector(sel); if (old) old.replaceWith(make()); }
  // the chat's messages are patched in place, never drawn again: the place the captain reads at stays where it is
  const om = el.querySelector("[data-x-msgs]"); if (om) patchMsgs(id, om, msgs(r, st));
  applyKeep(id);
  if (kept) { const back = el.querySelector(kept); if (back) back.focus({ preventScroll: true }); else if (kept.includes("data-explain-version=")) el.querySelector("[data-explain-versions]")?.focus({ preventScroll: true }); }
  syncAsk(r, st);
  const pk = document.querySelector("[data-explain-picker]"); if (pk) pk.replaceWith(picker(r));
  focusLater();
}
// the room is always presented by a skill now (the board is gone): the explainer's view as soon as its state is read
const active = (id) => !!state(id);
function ensure(id) { if (!X.st.has(id) && !X.loading.has(id) && !X.err.has(id)) load(id); }

// ---------- focus: a dialog takes it, keeps it (Tab), and gives it back when it closes ----------
let want = null;
const focusLater = (sel) => { if (sel) want = sel; requestAnimationFrame(() => {
  const m = document.querySelector(".rx-modal");
  if (m) { if (!m.contains(document.activeElement)) (m.querySelector("[data-explain-autofocus]") || m.querySelector("button,input,a[href]"))?.focus(); return; }
  // the control that opened it, else (gone or folded away) the stage's own: the version's line, Generate, the picker
  if (want) { const e = document.querySelector(want); want = null; e?.focus({ preventScroll: true });
    if (!e || document.activeElement !== e) for (const f of ["[data-explain-made] > summary", "[data-explain-again]", "[data-explain-open]"]) { const x = document.querySelector(f); if (x && x.getClientRects().length) { x.focus({ preventScroll: true }); if (document.activeElement === x) break; } } } }); };
// a paid run being started is not dismissed (Esc, Cancel, the backdrop): the server is starting it whatever the dialog does
const closeDialog = () => { if (X.confirm?.starting) return; X.pick = null; X.confirm = null; const back = X.returnTo || "[data-explain-open]"; X.returnTo = null; render(); focusLater(back); };
addEventListener("keydown", (e) => {
  const m = document.querySelector(".rx-modal"); if (!m || e.key !== "Tab") return;
  const f = [...m.querySelectorAll("button:not([disabled]),input:not([disabled]),textarea:not([disabled]),a[href],summary,[tabindex='0']")].filter((x) => x.getClientRects().length); if (!f.length) return;
  const i = f.indexOf(document.activeElement);
  if (e.shiftKey && i <= 0) { e.preventDefault(); f.at(-1).focus(); } else if (!e.shiftKey && (i === f.length - 1 || i < 0)) { e.preventDefault(); f[0].focus(); }
}, true);

// ---------- the header's picker: the built-in baton, or one of the captain's skills ----------
function picker(r) {
  const id = r.card.id, st = state(id), sel = st?.selected;
  if (!st || r.snapshot) return null;
  return h("span", { class: "rx-pick", "data-explain-picker": sel?.id || "none" },
    h("span", { class: "faint" }, T("Explain with", "解釋用")),
    h("button", { type: "button", class: "rx-pickbtn", "aria-haspopup": "dialog", "data-explain-open": "", disabled: readOnly() ? true : null, onclick: () => { X.pick = id; X.returnTo = "[data-explain-open]"; render(); focusLater(); } },
      sel ? skillName(st, sel.id) : T("Pick a skill", "選一個 skill"), " ▾"));
}
/** what a skill makes, as far as this room knows: the kind of its outputs here */
const outKind = (st, sid) => { const vs = st.versions.filter((v) => v.skill.id === sid); if (!vs.length) return null; const k = KIND[vs.at(-1).kind] || KIND.text;
  return T(`${k[0]} · ${vs.length} here`, `${k[1]} · 這裡 ${vs.length} 版`); };
function pickerDialog(r) {
  const id = r.card.id, st = state(id); if (X.pick !== id || !st) return null;
  const choose = async (sid) => {
    X.pick = null;
    // a skill that already has an output here: switching is free
    if (st.versions.some((v) => v.skill.id === sid)) { try { X.st.set(id, await postJ(`${base(id)}/select`, { skill: sid })); X.shown.delete(id); } catch (e) { X.err.set(id, bi(e.message)); } closeDialog(); return; }
    openConfirm(r, sid, "generate", "[data-explain-open]");
  };
  const cur = st.selected?.id ?? null, first = st.skills.find((s) => s.own)?.id ?? null;
  const opt = (sid, name, desc, out, own) => h("button", { type: "button", class: `rx-opt${cur === sid ? " on" : ""}`, "data-explain-skill": sid, "aria-pressed": String(cur === sid),
      "data-explain-autofocus": (cur === sid) ? "" : null, onclick: () => choose(sid) },
    h("span", { class: "rx-optname" }, h("b", {}, name), h("span", { class: "faint" }, own ? T(" · your skill", " · 你的 skill") : sid === BUILTIN ? T(" · built in", " · 內建") : T(" · Studio's library", " · Studio 技能庫"))), h("small", {}, desc), out ? h("span", { class: "rx-optout" }, out) : null);
  // Studio's built-in baton first (the room's default), then the captain's own skills, then the rest of Studio's library, folded
  const builtin = st.skills.find((s) => s.id === BUILTIN), own = st.skills.filter((s) => s.own), lib = st.skills.filter((s) => !s.own && s.id !== BUILTIN), libOpen = X.more.has(id) || lib.some((s) => s.id === cur);
  return h("div", { class: "rx-modalbg", onclick: (e) => { if (e.target === e.currentTarget) closeDialog(); } },
    h("div", { class: "rx-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "rx-pick-h", "data-explain-menu": "" },
      h("h2", { id: "rx-pick-h" }, T("Explain this change with", "用什麼解釋這個改動")),
      h("p", { class: "rx-sub" }, T("A skill makes this room's page (an interactive page, Markdown, pictures, a video). Questions about it are answered by the room's tutor, in the chat.", "skill 負責做出這間審查室的頁面（互動頁、Markdown、圖片、影片）。對頁面的提問由審查室的導師在對話框回答。")),
      builtin ? opt(builtin.id, skillName(st, builtin.id), T("Studio's default: one page with diagrams and the change's whole context, for you and your own agent.", "Studio 預設：一頁有圖、帶著這個改動完整脈絡的頁面，給你也給你自己的 agent。"), outKind(st, builtin.id), false) : null,
      own.length ? own.map((s) => opt(s.id, s.name, s.description || s.id, outKind(st, s.id), true))
        : h("p", { class: "faint", "data-explain-noskills": "" }, T("None of your own skills is in Studio yet: add one on the Skills page (for example from ~/.claude/skills).", "Studio 裡還沒有你自己的 skill：到技能頁加入（例如從 ~/.claude/skills）。")),
      lib.length ? h("details", { class: "rx-more", "data-explain-more": "", open: libOpen ? true : null, ontoggle: (e) => { if (e.target.open) X.more.add(id); else X.more.delete(id); } },
        h("summary", {}, T(`More from Studio's library (${lib.length})`, `更多 Studio 技能庫的 skill（${lib.length}）`)),
        h("p", { class: "faint rx-note" }, T("Studio ships these for its own workflows; they are not written for explaining a change.", "這些是 Studio 給自己的流程用的，不是為了解釋改動寫的。")),
        lib.map((s) => opt(s.id, s.name, s.description || s.id, outKind(st, s.id), false))) : null,
      h("div", { class: "rx-foot" }, h("a", { href: "#/skills", class: "btn" }, T("Skills page", "技能頁")), h("button", { type: "button", class: "btn", "data-explain-autofocus": cur === null && !first ? "" : null, onclick: closeDialog }, T("Cancel", "取消")))));
}
/** the paid run's confirmation; prompt: the instructions to start from (a version's, to generate again), else the server's
 *  prefill (the skill's default instructions, else what it was last run with) */
async function openConfirm(r, sid, kind, back, prompt) {
  if (X.confirm?.starting) return;
  const id = r.card.id; X.pick = null; X.returnTo = back || X.returnTo; const mine = X.confirm = { id, sid, kind, offer: null, loading: true, prompt: typeof prompt === "string" ? prompt : null }; render(); focusLater();
  let next; try { const o = await readOffer(id, sid, kind, mine.prompt); next = { ...mine, offer: o, loading: false, prompt: o.prompt ? o.prompt.text : mine.prompt ?? "", def: o.prompt?.default ?? null }; } catch (e) { next = { ...mine, offer: { error: e.message }, loading: false }; }
  // closed or replaced while the offer was read: a late offer opens nothing
  if (X.confirm !== mine) return; X.confirm = next;
  render(); focusLater();
}
const PROMPT_MAX = 2000;
/** a generation's offer for exactly this text (a POST: 2000 characters of CJK do not fit a URL); none: the server's prefill */
const readOffer = (id, sid, kind, prompt) => postJ(`${base(id)}/offer`, { skill: sid, kind, ...(typeof prompt === "string" ? { prompt } : {}) });
/** the instructions changed in the confirmation: the offer (and its hash) is read again for exactly that text; Confirm waits,
 *  and stays off when that read fails (the earlier offer is for another text) */
let promptTimer = null;
function promptEdited(id, value) {
  const c = X.confirm; if (!c || c.id !== id || c.starting) return; c.prompt = value; c.pending = true; promptUi(c);
  clearTimeout(promptTimer); promptTimer = setTimeout(async () => {
    const want = c.prompt; let o = null, note = null; try { o = await readOffer(id, c.sid, c.kind, want); } catch (e) { note = bi(e.message); }
    if (X.confirm !== c || c.prompt !== want) return;
    if (o && !o.error) { Object.assign(c, withOffer(c, o)); c.note = null; c.stale = false; } else { c.note = note || bi(o?.error || ""); c.stale = true; }
    c.pending = false; promptUi(c); }, 250);
}
/** the field's own parts, kept in step without redrawing it (the caret stays): counter, where the text came from, the buttons, Confirm */
function promptUi(c) {
  const v = c.prompt ?? "", q = (s) => document.querySelector(s);
  const n = q("[data-explain-promptcount]"); if (n) { n.textContent = `${v.length} / ${PROMPT_MAX}`; n.classList.toggle("over", v.length > PROMPT_MAX * 0.9); }
  const src = q("[data-explain-promptsource]"); if (src) { const w = promptSource(c); src.textContent = w.text; src.dataset.explainPromptsource = w.key; }
  const exb = q("[data-explain-promptexample]"); if (exb) exb.disabled = hasExample(v, c.offer?.prompt?.example);
  const sv = q("[data-explain-promptsave]"); if (sv) sv.disabled = (v.trim() || null) === (c.def ?? null) || v.length > PROMPT_MAX;
  const rs = q("[data-explain-promptreset]"); if (rs) rs.hidden = c.def == null || v === c.def;
  const nt = q("[data-explain-promptnote]"); if (nt) nt.textContent = c.note || "";
  const ph = q("[data-explain-pickhint]"); if (ph) ph.hidden = !needsPick(c) || !!c.starting;
  const go = q("[data-explain-start]"); if (go) go.disabled = !!(c.pending || c.stale || c.loading || c.starting || c.offer?.error || needsPick(c) || X.posting.has(`${c.id}/gen`));
}
/** the built-in checklist is already in the text (either language): inserting it again would only repeat it */
const hasExample = (v, ex) => !!ex && [ex.en, ex.zh].some((t) => t && String(v || "").includes(t));
/** where the field's text comes from, said under it */
function promptSource(c) {
  const v = (c.prompt ?? "").trim(), o = c.offer?.prompt || {}, def = c.def ?? null;
  if (def != null && v === def) return { key: "default", text: T("Your default for this skill.", "這個 skill 的預設指示。") };
  if (!v) return { key: "none", text: def != null ? T("Empty: the skill's own default this time (your saved default is not used).", "留空：這次照 skill 自己的預設（不用你存的預設指示）。") : T("Empty: the skill's own default.", "留空：照 skill 自己的預設。") };
  if (def == null && o.last && v === o.last && o.source === "last") return { key: "last", text: T("What you last asked this skill for (no default saved yet).", "上次給這個 skill 的指示（還沒存預設）。") };
  return { key: "edited", text: def != null ? T("Edited for this run (your default is unchanged).", "這次改過（預設指示不變）。") : T("For this run.", "只用在這一次。") };
}
async function saveDefault(c) {
  const text = (c.prompt ?? "").trim();
  let def = c.def, note = null; try { const j = await postJ("/api/review-room/explain/prompts", { skill: c.sid, text }); def = j.default ?? null; } catch (e) { note = bi(e.message); }
  // the dialog it was saved from is gone (closed, another skill or room): the open one keeps its own text, and learns the default
  const now = X.confirm; if (now !== c) { if (now && now.sid === c.sid && !note) { now.def = def; redrawPrompt(now); } return; }
  c.def = def; c.note = note; c.saved = !note; redrawPrompt(c);
}
/** rebuild the field (after Save, Reset, Insert) and put the caret back at the end of the text */
function redrawPrompt(c) { const old = document.querySelector("[data-explain-promptfield]"); if (!old) return; old.replaceWith(promptField(c, c.offer)); promptUi(c);
  const ta = document.querySelector("[data-explain-prompt]"); if (ta) { ta.focus({ preventScroll: true }); ta.setSelectionRange(ta.value.length, ta.value.length); } }
const setPrompt = (c, text) => { c.saved = false; const ta = document.querySelector("[data-explain-prompt]"); if (ta) ta.value = text; promptEdited(c.id, text); redrawPrompt(c); };
/** the skill's scripts in a confirmation: a head line, then one row each (credentials and endpoints as chips by name), and a
 *  version the Skills page never approved as its own warning line */
const chips = (names) => h("span", { class: "rx-chips" }, names.map((n) => h("code", { class: "rx-chipname" }, n)));
function scriptRows(s, row, pending) {
  if (!s) return [];
  if (!s.run) return [row(T("The skill's scripts", "skill 的腳本"), h("span", { "data-explain-scripts": "off" }, h("b", {}, T("Do not run", "不會執行")), " — ", T(s.en, s.zh)))];
  const R = s.rows || {}, w = (x) => (x ? T(x.en, x.zh) : "");
  // an undecided version: whether its scripts run, and where they connect, is the decision below (its facts list the hosts)
  const below = T("Depends on your decision below", "看你在下面的決定");
  return [
    row(T("The skill's scripts", "skill 的腳本"), h("span", { "data-explain-scripts": pending ? "pending" : "run" }, pending
      ? [h("b", {}, below), T(": approved, they run sandboxed; text only, they never run", "：核准就在沙盒裡執行；只當文字就不執行")]
      : [h("b", {}, T(`Run, sandboxed, ${s.network ? "with network" : "no network here"}`, `會執行，在沙盒裡、${s.network ? "可以連網" : "這裡不能連網"}`)), ` · ${(s.interpreters || []).join(T(", ", "、"))}`],
      R.approval ? h("span", { class: "rx-warn", "data-explain-unapproved": "" }, w(R.approval)) : null)),
    row(T("Network", "網路"), h("span", { "data-explain-srow": "network" }, pending ? T(`${below}: approved, the hosts it lists there; text only, none`, `${below}：核准就是那裡列的主機；只當文字就不連網`) : w(R.network))),
    row(T("Credentials", "憑證"), h("span", { "data-explain-srow": "credentials" }, (s.keys || []).length ? chips(s.keys) : T("none", "沒有"), h("small", { class: "faint" }, T(" from the environment Studio started with (the same values Studio sees); never a key Studio stores, its GitHub token or its session keys", "（來自 Studio 啟動時的環境，和 Studio 看到的同一份；絕不會拿到 Studio 保存的金鑰、GitHub token 或 session 金鑰）")))),
    ...((s.endpoints || []).length ? [row(T("Endpoints", "端點"), h("span", { "data-explain-srow": "endpoints" }, chips(s.endpoints)))] : []),
    row(T("Files", "檔案"), h("span", { "data-explain-srow": "access" }, w(R.access))),
    row(T("Per-call limits", "每次呼叫上限"), h("span", { "data-explain-srow": "limits" }, w(R.limits))),
    row(T("Browser", "瀏覽器"), h("span", { "data-explain-srow": "browser" }, w(R.browser))),
    ...(R.missing ? [row(T("Missing here", "這裡缺"), h("span", { "data-explain-srow": "missing" }, w(R.missing)))] : [])];
}
/** one line for a follow-up's confirmation: its scripts run too */
function scriptSummary(s) {
  if (!s) return null;
  if (!s.run) return h("p", { class: "faint", "data-explain-askscripts": "off" }, T("The skill's scripts do not run.", "skill 的腳本不會執行。"));
  const keys = s.keys || [];
  return h("p", { "data-explain-askscripts": "run" }, T(`Its scripts run in this follow-up too: sandboxed, ${s.network ? "with network" : "no network here"}`, `這次追問也會執行它的腳本：在沙盒裡、${s.network ? "可以連網" : "這裡不能連網"}`),
    keys.length ? [T(" · credentials ", " · 憑證 "), chips(keys)] : T(" · no credential", " · 沒有憑證"),
    !s.approved ? h("span", { class: "rx-warn", "data-explain-unapproved": "" }, T("This version has no decision yet: choose below.", "這個版本還沒決定：請在下面選。")) : null);
}
/** The captain's decision on a script version (docs/units/skill-packages.md §3), shown as the team-change card shows it: pending,
 *  its scripts with their flags, the hosts approving it allows, its lockfiles and programs, and the pick made with this
 *  confirmation (recorded Studio-wide for exactly this version); decided, the decision. */
/** the confirmation with a new offer: a pick made for one version's decision is never carried to another's (or to a decision
 *  no longer pending) — the captain picks again */
const pickKey = (o) => { const d = o?.decide; return d?.state === "pending" ? `${o.skill?.id}@${o.skill?.v}:${d.facts?.sha256}:${d.facts?.filesSha256}` : null; };
const withOffer = (c, o) => ({ ...c, offer: o, ...(pickKey(o) !== pickKey(c.offer) ? { decision: null } : {}) });
const needsPick = (c) => c?.offer?.decide?.state === "pending" && c.decision !== "scripts" && c.decision !== "text-only";
const viaWords = (via) => via === "review-room" ? T("in the review room", "在審查室") : /^page/.test(via || "") ? T("on the Crew page", "在團隊頁") : via === "card" || /card/.test(via || "") ? T("on the team-change card", "在團隊變更卡上") : T("earlier", "之前");
function decideFacts(f) {
  return [h("div", { class: "faint mono" }, `${f.id}@v${f.v} · ${String(f.sha256).slice(0, 12)} / ${String(f.filesSha256).slice(0, 12)}`),
    h("ul", { class: "rx-dscripts" }, f.scripts.slice(0, 12).map((sc) => h("li", { class: "mono" }, sc.path, sc.flags?.length ? h("span", { class: "faint" }, ` · ${sc.flags.join(", ")}`) : null)), f.scripts.length > 12 ? h("li", { class: "faint" }, T(`… ${f.scripts.length - 12} more`, `… 還有 ${f.scripts.length - 12} 個`)) : null),
    h("div", { "data-explain-dfact": "hosts" }, T("Network when it runs: ", "執行時可連："), f.hosts?.length ? f.hosts.join(", ") : T("none", "不連網")),
    f.locks?.length ? h("div", { "data-explain-dfact": "locks" }, T("Dependencies from its lockfiles, installed by Studio before it runs: ", "依賴照它的 lockfile，由 Studio 事先安裝："), f.locks.join(", ")) : null,
    f.bins?.length ? h("div", { "data-explain-dfact": "bins" }, T(`Programs it uses: ${f.bins.join(", ")}`, `會用到的程式：${f.bins.join("、")}`)) : null];
}
function decideRows(c, row) {
  const d = c.offer?.decide; if (!d) return [];
  if (d.state !== "pending") return [row(T("Decision", "決定"), h("span", { "data-explain-decision": d.state }, h("b", {}, d.state === "approved" ? T("Approved with scripts", "已核准（含 script）") : T("Text only", "只當文字")), ` · ${T("decided", "決定於")} ${viaWords(d.via)}`,
    d.state === "approved" && d.ready && d.ready !== "ready" ? h("small", { class: "faint" }, T(" · Studio installs its dependencies before the first round", " · Studio 會在第一輪之前安裝它的依賴")) : null))];
  const f = d.facts, radio = (v, label) => h("label", { class: "rx-pickopt" }, h("input", { type: "radio", name: "rx-decide", value: v, "data-explain-decide": v, checked: c.decision === v ? true : null, onchange: () => { c.decision = v; promptUi(c); } }), " ", label);
  return [row(T("Decision", "決定"), h("div", { "data-explain-decidebox": "" },
    h("p", {}, T(`This version has ${f.scripts.length} script${f.scripts.length === 1 ? "" : "s"} and no decision yet. Choose once, for exactly this version, Studio-wide:`, `這個版本有 ${f.scripts.length} 個 script，還沒決定。只決定這個版本，全 Studio 生效：`)),
    ...decideFacts(f),
    h("div", { class: "rx-decidepick", role: "radiogroup", "aria-label": T("Its scripts", "它的 script") },
      radio("scripts", T("Approve with scripts", "核准（含 script）")), radio("text-only", T("Text only", "只當文字"))),
    h("small", { class: "faint" }, T("Text only: the skill gets its text and never runs its scripts. A new version asks again.", "只當文字：skill 只拿到文字，不跑 script。新版本會再問。"))))];
}
/** the footer's line while Confirm waits for the pick (the decision sits at the end of the dialog), with a way to it */
function pickHint(c) {
  if (c.offer?.decide?.state !== "pending") return null;
  const go = () => { const g = document.querySelector("[data-explain-decidebox] .rx-decidepick"), still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    g?.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" }); g?.querySelector("input[data-explain-decide]")?.focus({ preventScroll: true }); };
  return h("p", { class: "rx-state rx-footmsg", role: "status", "data-explain-pickhint": "", hidden: needsPick(c) ? null : true },
    T("Choose “Approve with scripts” or “Text only” below to start.", "請在下面選「核准（含 script）」或「只當文字」才能開始。"), " ",
    h("button", { type: "button", class: "btn sm", "data-explain-gopick": "", onclick: go }, T("Go to the choice", "前往選擇")));
}
/** a script call in the progress list, in the captain's language: the result first, then the time and the hosts; it opens to
 *  its stderr tail and every host it reached or was refused */
function scriptLine(c) {
  // a refused call shows its path as the skill wrote it (it is not one of the package's scripts); a run one, its file name
  const L = c.limits || {}, name = c.outcome === "refused" ? String(c.script || "") : String(c.script || "").split("/").pop();
  const wall = Number(L.wallS) || 0, span = wall < 120 ? T(`${wall} s`, `${wall} 秒`) : T(`${Math.round(wall / 60)} min`, `${Math.round(wall / 60)} 分鐘`);
  const why = { "not-script": T("not a script of this skill", "不是這個 skill 的腳本"), count: T(`the ${L.calls ?? ""} calls of this round are used`, `這一輪的 ${L.calls ?? ""} 次呼叫已用完`),
    full: T(`the output folder is over ${(L.diskMB || 120) / 2} MB`, `產出資料夾超過 ${(L.diskMB || 120) / 2} MB`), args: T("its arguments were not accepted", "參數不被接受"), other: T("Studio could not run it", "Studio 沒辦法執行它") }[c.refusalCode || "other"];
  const how = c.outcome === "refused" ? T(`refused: ${why}`, `被拒：${why}`)
    : c.limit === "cpu" ? T(`hit the CPU limit (${L.cpuS} s)`, `碰到 CPU 上限（${L.cpuS} 秒）`)
    : c.limit === "file" ? T(`hit the file-size limit (${L.fileMB} MB)`, `碰到檔案大小上限（${L.fileMB} MB）`)
    : c.limit === "time" ? T(`hit the time limit (${span})`, `碰到時間上限（${span}）`)
    : c.limit === "disk" ? T(`hit the disk limit (${L.diskMB} MB)`, `碰到磁碟上限（${L.diskMB} MB）`)
    : c.signal ? T(`stopped by ${c.signal}`, `被 ${c.signal} 停止`) : c.exit === 0 ? T("done", "完成") : T(`failed, exit ${c.exit}`, `失敗，exit ${c.exit}`);
  const bits = [c.outcome === "refused" ? null : `${((c.ms || 0) / 1000).toFixed(1)} s`, (c.hosts || []).length ? T(`reached ${c.hosts.join(", ")}`, `連到 ${c.hosts.join("、")}`) : null,
    (c.refused || []).length ? T(`refused ${c.refused.map((x) => x.host).join(", ")}`, `被擋 ${c.refused.map((x) => x.host).join("、")}`) : null].filter(Boolean);
  const mark = c.outcome === "ok" && !(c.refused || []).length ? "✓" : c.outcome === "limit" || (c.outcome === "ok" && (c.refused || []).length) ? "⚠" : "✗";
  const cls = mark === "✓" ? "done" : mark === "⚠" ? "warn" : "bad";
  const detail = [c.outcome === "refused" && c.refusal ? `${T("Studio said", "Studio 的說明")}: ${c.refusal}` : null, c.args ? `${T("args", "參數")}: ${c.args}` : null, ...(c.hosts || []).map((x) => `${T("reached", "連到")} ${x}`), ...(c.refused || []).map((x) => `${T("refused", "被擋")} ${x.host} (${x.why})`), c.stderr ? `stderr:\n${c.stderr}` : null].filter(Boolean).join("\n");
  return { cls, mark, body: h("details", { class: "rx-call", "data-explain-call": c.outcome, "data-explain-limit": c.limit || "" }, h("summary", {}, h("b", {}, name), ` — ${how}`, bits.length ? h("span", { class: "faint" }, ` · ${bits.join(" · ")}`) : null),
    h("pre", { class: "rx-calldetail" }, detail || T("(nothing more)", "（沒有更多）"))) };
}
function confirmDialog(r) {
  const c = X.confirm; if (!c || c.id !== r.card.id) return null; const o = c.offer, id = c.id;
  const row = (k, ...v) => [h("span", {}, k), h("span", {}, ...v)];
  // the server answers once the run is admitted (a model it verifies again can take a minute): until then the dialog says it is
  // starting and cannot be dismissed or sent twice. Its answer acts on this dialog only: the run started, it closes (and a redraw
  // never brings it back); refused, this dialog shows why with Confirm on again. A redraw that throws is not a refusal.
  const start = async () => { if (c.pending || c.stale || c.starting || needsPick(c) || X.confirm !== c) return; c.starting = true; c.note = null; X.posting.add(`${id}/gen`);
    let view = null, err = null;
    try { render(); view = await postJ(`${base(id)}/generate`, { skill: c.sid, confirm: c.offer.hash, ...(c.kind === "generate" ? { prompt: c.prompt ?? "" } : {}), ...(c.offer.decide?.state === "pending" && !needsPick(c) ? { skillDecision: c.decision } : {}) }); } catch (e) { err = e; }
    finally { X.posting.delete(`${id}/gen`); c.starting = false; }
    if (view) { X.st.set(id, view); X.err.delete(id); if (X.confirm === c) { X.confirm = null; X.returnTo = null; } X.shown.delete(id); schedule(id); render(); focusLater("[data-explain-stop]"); return; }
    // the dialog is gone (the captain went to another page meanwhile): the room says why instead (a read would clear it)
    const why = bi(err?.message || T("Studio gave no answer: the run did not start", "Studio 沒有回應：沒有開始執行"));
    if (X.confirm !== c) { X.err.set(id, why); render(); return; }
    X.confirm = { ...(err?.offer ? withOffer(c, err.offer) : c), note: why }; render(); focusLater(); load(id); };
  const setLimit = async (v) => { try { await postJ("/api/review-room/explain/settings", { limitMin: Number(v) }); if (X.confirm === c) await openConfirm(r, c.sid, c.kind, undefined, c.kind === "generate" ? c.prompt ?? "" : undefined); } catch (e) { if (X.confirm === c) { X.confirm = { ...c, note: bi(e.message) }; render(); } } };
  const cost = o?.cost || {};
  return h("div", { class: "rx-modalbg", onclick: (e) => { if (e.target === e.currentTarget) closeDialog(); } },
    h("div", { class: "rx-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "rx-conf-h", "data-explain-confirm": c.sid },
      h("h2", { id: "rx-conf-h" }, T(`Explain with ${sk(o?.skill) || c.sid}`, `用 ${sk(o?.skill) || c.sid} 解釋`)),
      c.loading ? h("p", { class: "faint" }, T("Reading the offer…", "讀取中…"))
      : o?.error ? h("p", { class: "rx-state err", role: "alert" }, h("span", { class: "rx-ic", "aria-hidden": "true" }, "✕"), bi(o.error))
      : [h("p", { class: "rx-sub" }, T("A paid run on the room's tutor model. Nothing starts until you confirm.", "用審查室導師的模型付費執行。按確認之前什麼都不會開始。")),
        c.kind === "generate" ? promptField(c, o) : null,
        h("div", { class: "rx-cost" },
          row(T("Model", "模型"), h("b", { "data-explain-model": `${o.provider}/${o.model}` }, `${o.provider} · ${o.model ?? T("default model", "預設模型")}${o.effort ? ` · ${o.effort}` : ""}`), o.independence?.en ? h("small", { class: "faint" }, ` — ${T(o.independence.en, o.independence.zh)}`) : null),
          row(T("Who pays", "誰付費"), h("span", { "data-explain-billing": "" }, o.billing ? T(o.billing.en, o.billing.zh) : "")),
          row(T("Cost", "費用"), h("span", { "data-explain-costrow": "" },
            cost.estimate != null ? T(`about ${usd(cost.estimate)} a run (the median of earlier runs here)`, `每次約 ${usd(cost.estimate)}（這裡之前幾次的中位數）`) : T("no estimate yet: billed by the tokens the skill uses, more rounds cost more", "還沒有估計：依 skill 用掉的 token 計費，輪數越多越貴"),
            cost.runs ? T(` · this room so far ${usd(cost.spent)} over ${cost.runs} run${cost.runs === 1 ? "" : "s"}`, ` · 這間審查室目前共 ${usd(cost.spent)}（${cost.runs} 次）`) : "")),
          row(T("Skill", "Skill"), `${sk(o.skill)} (v${o.skill.v})`),
          row(T("Materials (read-only)", "給 skill 的材料（唯讀）"), T(o.materials.en.join(", "), o.materials.zh.join("、"))),
          row(T("Rounds", "輪數"), T(o.rounds.en, o.rounds.zh)),
          row(T("Expected time", "預計時間"), o.expected ? T(`about ${o.expected.minutes} min (from ${o.expected.from} earlier run${o.expected.from === 1 ? "" : "s"})`, `約 ${o.expected.minutes} 分鐘（依之前 ${o.expected.from} 次）`) : T("not known yet: the first run of this skill here (often 10–30 min)", "還不知道：這是這個 skill 在這裡第一次跑（常見 10–30 分鐘）")),
          row(h("label", { for: "rx-limit" }, T("Safety limit", "安全時限")), h("span", { class: "rx-limit" }, h("input", { id: "rx-limit", type: "number", min: "1", max: "1440", value: String(o.limitMin), "data-explain-limit": "", disabled: c.starting ? true : null, onchange: (e) => setLimit(e.target.value) }),
            T(" min of wall clock, then Studio stops it · applies to every room", " 分鐘，到了 Studio 會停下 · 所有審查室共用"))),
          row(T("Output frame", "產出顯示框"), T(o.isolation.en, o.isolation.zh)),
          ...scriptRows(o.scripts, row, o.decide?.state === "pending"), ...decideRows(c, row))],
      // the footer sticks to the dialog's bottom: what is happening (starting, or why it was refused) is said there, beside Confirm,
      // in view however far the dialog is scrolled
      h("div", { class: "rx-foot" },
        c.starting ? h("p", { class: "rx-state rx-footmsg", role: "status", "data-explain-starting": "" }, T("Studio is checking the model and starting the run. This can take a minute; you can wait here, it closes once it runs.", "Studio 正在確認模型並開始執行，可能要一分鐘左右；在這裡等就好，開始執行後這個視窗就會關閉。"))
        : c.note ? h("p", { class: "rx-state err rx-footmsg", role: "alert", "data-explain-note": "" }, h("span", { class: "rx-ic", "aria-hidden": "true" }, "✕"), c.note) : pickHint(c),
        h("button", { type: "button", class: "btn", disabled: c.starting ? true : null, onclick: closeDialog }, T("Cancel", "取消")),
        h("button", { type: "button", class: "btn primary", "data-explain-start": "", "data-explain-autofocus": "", "aria-busy": c.starting ? "true" : null, disabled: c.loading || c.pending || c.stale || c.starting || o?.error || needsPick(c) || X.posting.has(`${id}/gen`) ? true : null, onclick: start },
          c.starting ? T("Starting…", "開始中…") : T("Confirm and start", "確認並開始")))));
}

/** "What should it produce?": the captain's own instructions for this generation (trusted, sent apart from the pull request's
 *  material); prefilled, editable, empty for the skill's default; the confirmed offer is for exactly this text */
function promptField(c, o) {
  const v = c.prompt ?? "", w = promptSource(c), ex = o?.prompt?.example;
  // a redraw of the whole room while the captain types keeps the caret where it was
  const was = document.activeElement?.matches?.("[data-explain-prompt]") ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
  if (was) requestAnimationFrame(() => { const ta = document.querySelector("[data-explain-prompt]"); if (ta && document.activeElement !== ta) { ta.focus({ preventScroll: true }); try { ta.setSelectionRange(was[0], was[1]); } catch {} } });
  return h("div", { class: "rx-prompt", "data-explain-promptfield": "" },
    h("label", { for: "rx-prompt" }, h("b", {}, T("What should it produce?", "要產出什麼？")), " ", h("span", { class: "faint" }, T("(optional)", "（選填）"))),
    h("textarea", { id: "rx-prompt", rows: "5", disabled: c.starting ? true : null, maxlength: String(PROMPT_MAX), "data-explain-prompt": "", spellcheck: "false",
      placeholder: T("Empty: the skill's own default. For example: include an error-code table and an ops runbook; write it in Traditional Chinese.", "留空就照 skill 預設。例如：加上錯誤碼表和維運手冊；用繁體中文寫。"),
      oninput: (e) => { c.saved = false; promptEdited(c.id, e.target.value); } }, v),
    h("div", { class: "rx-promptfoot" },
      h("small", { class: "faint", "data-explain-promptsource": w.key, "aria-live": "polite" }, w.text),
      h("small", { class: `rx-count${v.length > PROMPT_MAX * 0.9 ? " over" : ""}`, "data-explain-promptcount": "", "aria-live": "polite" }, `${v.length} / ${PROMPT_MAX}`)),
    h("div", { class: "rx-promptacts" },
      h("button", { type: "button", class: "btn sm", "data-explain-promptsave": "", disabled: c.starting || (v.trim() || null) === (c.def ?? null) ? true : null, onclick: () => saveDefault(c) },
        c.def != null && !v.trim() ? T("Clear the default for this skill", "清除這個 skill 的預設") : T("Save as default for this skill", "存成這個 skill 的預設")),
      h("button", { type: "button", class: "btn sm", "data-explain-promptreset": "", disabled: c.starting ? true : null, hidden: c.def == null || v === c.def ? true : null, onclick: () => setPrompt(c, c.def) }, T("Reset to default", "還原成預設")),
      ex ? h("button", { type: "button", class: "btn sm", "data-explain-promptexample": "", title: T(ex.en, ex.zh), disabled: c.starting || hasExample(v, ex) ? true : null, onclick: () => { const t = T(ex.en, ex.zh), cur = (c.prompt ?? "").trimEnd(); setPrompt(c, cur ? `${cur}\n\n${t}` : t); } },
        T("Insert a review checklist", "插入審查清單範例")) : null,
      c.saved ? h("small", { class: "rx-saved", "data-explain-promptsaved": "", role: "status" }, T("Saved: the next run of this skill starts from it.", "已存：這個 skill 下次就從這段開始。")) : null),
    h("small", { class: "faint" }, T("Your instructions go to the skill as yours, apart from the pull request's text. A changed text is a new confirmation.", "你的指示會以你的名義交給 skill，和 PR 的內容分開。改了內容就要重新確認。"),
      " ", h("a", { href: "/#/skills", target: "_blank", rel: "noopener", "data-explain-skillslink": "" }, T("Defaults of every skill: Skills page ↗", "所有 skill 的預設：技能頁 ↗"))),
    h("small", { class: "rx-promptnote", "data-explain-promptnote": "", role: "status" }, c.note && c.stale ? c.note : ""));
}
/** the picker's menu and the paid run's confirmation, over whichever way the room is shown */
const dialogs = (r) => { if (X.pick || X.confirm) focusLater(); return [pickerDialog(r), confirmDialog(r)]; };
// ---------- the room: the output under its line (the switch, the versions), the chat on the right ----------
function view(r) {
  const id = r.card.id, st = state(id);
  if (!st) return h("div", { class: "card x-pad faint" }, T("Loading…", "載入中…"));
  // shown with its skill: a question that waited for this room's first output goes now (once; behind its confirmation)
  queueMicrotask(() => { tickStart(); syncAsk(r, st); flushQueue(id); applyKeep(id); });
  return h("div", { class: "rx-body", "data-explain-room": id, "data-x-keep": "body" }, h("main", { class: "rx-stage" }, bar(r, st), stage(r, st)), window.crewRoomPane?.handle("explain") ?? null, chat(r, st), dialogs(r));
}
/** show a version; one made by another skill switches the room to that skill (so the header, the chat and Generate agree) */
/** show a version: only what the stage shows changes. The room's selected skill stays (a version another skill made is read,
 *  never a switch of the skill the room generates with: that is the picker's) */
function showVersion(r, v) {
  const id = r.card.id; X.shown.set(id, v.n); X.err.delete(id);
  render();
}
/** the focused control inside a part about to be redrawn, as a selector that finds its replacement */
function focusIn(part) {
  const a = document.activeElement; if (!part || !a || !part.contains(a)) return null;
  if (a.dataset.explainVersion) return `[data-explain-version="${CSS.escape(a.dataset.explainVersion)}"]`;
  if (a.matches("[data-explain-made] > summary")) return "[data-explain-made] > summary";
  const k = ["explainVersions", "explainAgain", "explainTutor", "explainOutput", "explainReuse"].find((x) => x in a.dataset);
  return k ? `[data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}]` : null;
}
/** the output's own line over the stage: the switch, the version menu (every version, a run in progress, Generate again) and
 *  what the shown version was made from; one line, so the output has the room's whole width */
function bar(r, st) {
  const id = r.card.id, run = liveRun(st), cur = shownVersion(id), gen = run && run.kind === "generate";
  return h("div", { class: "rx-line", "data-x-line": "" },
    st.versions.length || gen ? h("button", { type: "button", class: "rx-verbtn", "data-explain-versions": "", "aria-controls": "rx-vermenu", "aria-expanded": String(X.verMenu === id),
        title: T("Every version of this room's output", "這間審查室產出的每一版"), onclick: () => { X.verMenu = X.verMenu === id ? null : id; forget("vermenu"); refresh(id); if (X.verMenu) focusLater("[data-explain-vermenu] [aria-current]"); } },
      // a long skill name is cut, never the version, the count or "generating"
      h("span", { class: "rx-vername" }, gen ? sk(run.skill) : cur ? skillName(st, cur.skill.id) : T("Versions", "版本")), gen ? " · " : " ", gen ? h("span", { class: "rx-vergen" }, T("generating…", "產生中…")) : cur ? `v${cur.n}` : null,
      h("span", { class: "rx-vercount", "aria-label": T(`${st.versions.length} versions`, `${st.versions.length} 版`) }, `${st.versions.length}`), " ▾") : null,
    cur && !gen ? versionHead(r, st, cur) : h("span", { class: "rx-linefill" }),
    cur && !gen && runOf(st, cur) ? h("span", { class: "rx-vfacts faint", "data-explain-vfacts": cur.n, title: whoPays(runOf(st, cur)) },
      [runOf(st, cur).head ? `head ${short(runOf(st, cur).head)}` : null, money(runOf(st, cur).cost), runOf(st, cur).model || null].filter(Boolean).join(" · ")) : null,
    cur && !gen ? autoNote(r, st) : null,
    cur ? lineTools(r, st, cur) : null,
    // under the menu, a clear layer over the page (and the output's frame, which keeps its own clicks): a click there closes it
    X.verMenu === id ? [h("div", { class: "rx-verscrim", "data-explain-verscrim": "", onpointerdown: (e) => { e.preventDefault(); closeVerMenu(); } }), verMenu(r, st)] : null);
}
/** the line's own tools: Generate again, full screen, a tab of its own; Stop is on the progress while a run works */
function lineTools(r, st, v) {
  const id = r.card.id, run = liveRun(st), sid = st.selected?.id, page = v.kind === "html" || v.kind === "markdown" || v.kind === "text", media = v.kind === "video" || v.kind === "image";
  return h("span", { class: "rx-linetools", "data-x-linetools": "" },
    sid && !run && r.open && !readOnly() ? h("button", { type: "button", class: "rr-chip", "data-explain-regen": "", title: T("A new version of this page, with the skill's instructions (confirmed)", "用 skill 的指示產生這頁的新版本（要確認）"),
      onclick: () => openConfirm(r, sid, "generate", "[data-explain-regen]", v.skill.id === sid && typeof v.prompt === "string" ? v.prompt : undefined) }, "↻ ", T("Generate again", "重新產生")) : null,
    h("button", { type: "button", class: "rr-chip", "data-explain-full": "", title: T("Full screen (F)", "全螢幕（F）"), "aria-label": T("Full screen", "全螢幕"), "aria-keyshortcuts": "F", onclick: () => enterFull(id, v) }, "⛶ ", h("span", { class: "rx-tl" }, T("Full screen", "全螢幕"))),
    page ? h("button", { type: "button", class: "rr-chip", "data-explain-newtab": "", title: T("Opens this version alone in a new tab, isolated as here", "在新分頁單獨開這一版，一樣隔離"), "aria-label": T("Open in a new tab", "在新分頁開啟"), onclick: () => openTab(id, v) }, "↗ ", h("span", { class: "rx-tl" }, T("New tab", "新分頁"))) : null,
    h("span", { class: "rx-tag", "data-explain-isolation": "", title: media ? "" : T("The page runs in an isolated frame: no network, it cannot read Studio, storage kept by Studio in memory", "頁面在隔離框裡執行：不能連網、不能讀 Studio，儲存由 Studio 在記憶體代管") }, media ? T("Shown by Studio", "由 Studio 顯示") : T("Isolated", "隔離")));
}
/** on the line, with an older version shown: the generation Studio started for the new head did not finish (why, Try again) */
function autoNote(r, st) {
  const id = r.card.id, fa = autoFailed(st, id); if (!fa) return null;
  return h("span", { class: "rx-autonote", role: "alert", "data-explain-autofail": fa.run ? fa.run.why || fa.run.status : "start", title: fa.detail || "" },
    "⚠ ", T("The new head's explanation did not finish: ", "新 head 的說明沒有完成："), fa.text,
    fa.code !== "confirm_required" && r.open && !readOnly() ? [" ", h("button", { type: "button", class: "btn sm", "data-explain-retry": "", disabled: X.posting.has(`${id}/auto`) ? true : null, onclick: () => autoStart(id, !fa.page) }, T("Try again", "再試一次"))] : null);
}
function verMenu(r, st) {
  const id = r.card.id, run = liveRun(st), cur = shownVersion(id), sid = st.selected?.id;
  const keys = (e) => { const items = [...e.currentTarget.querySelectorAll("button:not([disabled])")], i = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus(); }
    else if (e.key === "Home" || e.key === "End") { e.preventDefault(); (e.key === "Home" ? items[0] : items.at(-1))?.focus(); } };
  return h("div", { class: "rx-vermenu", id: "rx-vermenu", "data-x-keep": "vermenu", role: "group", "aria-label": T("Versions", "版本"), "data-explain-vermenu": "", onkeydown: keys,
      onfocusout: (e) => { if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget) && !e.relatedTarget.closest("[data-explain-versions]")) closeVerMenu(); } },
    h("h6", {}, T("Outputs", "產出")),
    run && run.kind === "generate" ? h("div", { class: "rx-ver gen", "data-explain-generating": "", role: "status" }, h("span", { class: "k" }, sk(run.skill)), T("Generating…", "產生中…"), h("small", {}, T(`started ${hhmm(run.at)}`, `開始於 ${hhmm(run.at)}`))) : null,
    [...st.versions].reverse().map((v) => h("button", { type: "button", class: `rx-ver${cur?.n === v.n ? " on" : ""}`, "data-explain-version": v.n, "data-skill": v.skill.id, "aria-current": cur?.n === v.n ? "true" : null,
        onclick: () => { X.verMenu = null; showVersion(r, v); focusLater("[data-explain-versions]"); } },
      h("span", { class: "k" }, `${skillName(st, v.skill.id)} v${v.n}`), v.summary || v.entry, h("small", { "data-explain-verfacts": v.n }, `${hhmm(v.at)} · ${T(...(KIND[v.kind] || KIND.text))}${runOf(st, v)?.head ? ` · ${T("head", "head")} ${short(runOf(st, v).head)}` : ""}${money(runOf(st, v)?.cost) ? ` · ${money(runOf(st, v).cost)}` : ""}${v.from ? T(` · from v${v.from}, a follow-up`, ` · 由 v${v.from} 追問改的`) : ""}`),
      madeFrom(v) ? h("small", { class: "rx-verprompt", "data-explain-verprompt": v.n, title: madeFrom(v).full }, madeFrom(v).short) : null)),
    // one Generate: here once an output exists; before that the stage has it
    sid && !run && r.open && !readOnly() && cur ? h("button", { type: "button", class: "btn sm rx-again", "data-explain-again": "", onclick: () => { X.verMenu = null; openConfirm(r, sid, "generate", "[data-explain-versions]", cur.skill.id === sid && typeof cur.prompt === "string" ? cur.prompt : undefined); } }, T("Generate a new version", "重新產生一版")) : null,
    h("p", { class: "faint rx-note" }, T("Every generation is kept as a version (a question never changes one): pick an older one to compare.", "每次產生都留一版（提問不會改任何一版）；點舊版可以對照。")));
}
/** what a version was made from, in a line: a generation's instructions (or the skill's default), a follow-up's question */
function madeFrom(v) {
  if (typeof v.prompt === "string") return v.prompt ? { kind: "prompt", short: T(`✎ ${v.prompt.slice(0, 60)}${v.prompt.length > 60 ? "…" : ""}`, `✎ ${v.prompt.slice(0, 40)}${v.prompt.length > 40 ? "…" : ""}`), full: v.prompt }
    : { kind: "default", short: T("✎ the skill's default", "✎ skill 預設"), full: "" };
  if (v.question) return { kind: "question", short: `? ${v.question.slice(0, 60)}${v.question.length > 60 ? "…" : ""}`, full: v.question };
  return null;
}
/** the version view's own line: which instructions (or question) produced it, opened to the whole text, and Generate again */
function versionHead(r, st, v) {
  const m = madeFrom(v), sid = st.selected?.id, can = r.open && !readOnly() && !liveRun(st) && sid === v.skill.id;
  const key = `${r.card.id}/${v.n}`;
  return h("details", { class: "rx-vhead", "data-explain-made": m?.kind || "none", open: X.madeOpen.has(key) ? true : null, ontoggle: (e) => { if (e.target.open) X.madeOpen.add(key); else X.madeOpen.delete(key); } },
    // the version's name is on the menu's button beside it
    h("summary", {},
      !m ? T("made before instructions were kept", "這版沒有留下指示")
      : m.kind === "prompt" ? [T("Made with your instructions: ", "依你的指示產生："), h("span", { class: "rx-vprompt" }, m.short.replace(/^✎ /, ""))]
      : m.kind === "default" ? T("Made with the skill's default (no instructions)", "照 skill 預設產生（沒有額外指示）")
      : [T(`From a follow-up on v${v.from}: `, `由 v${v.from} 的追問產生：`), h("span", { class: "rx-vprompt" }, m.full.slice(0, 80))]),
    h("div", { class: "rx-vbody" },
      m?.full ? h("pre", { class: "rx-vfull", "data-explain-promptfull": v.n }, m.full) : null,
      can ? h("button", { type: "button", class: "btn sm", "data-explain-reuse": v.n, onclick: () => openConfirm(r, sid, "generate", `[data-explain-reuse="${v.n}"]`, m?.kind === "prompt" ? v.prompt : m?.kind === "default" ? "" : undefined) },
        m?.kind === "prompt" ? T("Generate again with these instructions…", "用這些指示再產生一版…") : T("Generate again…", "再產生一版…")) : null));
}
function stage(r, st) {
  const id = r.card.id, run = liveRun(st), v = shownVersion(id), sid = st.selected?.id, lastGen = [...st.runs].reverse().find((x) => x.kind === "generate" && x.skill.id === sid);
  if (run && run.kind === "generate" && !v) return progressCard(r, st, run);
  // no skill for this room (Studio's default turned off): the picker is the way in
  if (!sid && !v) return h("div", { class: "rx-empty", "data-x-stage": "", "data-explain-empty": "", "data-explain-noskill": "" },
    h("p", {}, T("Pick the skill that explains this room.", "選一個 skill 來說明這間審查室。")),
    r.open && !readOnly() ? h("button", { type: "button", class: "btn primary", "data-explain-again": "", onclick: () => { X.pick = id; X.returnTo = "[data-explain-again]"; render(); focusLater(); } }, T("Explain with…", "解釋用…")) : null);
  // "Starting" only while the page is starting it, or is about to (due, not sent yet): never a state nothing will end
  const starting = !run && (X.posting.has(`${id}/auto`) || (st.auto?.due && r.open && !readOnly() && !X.autoErr.has(id) && !X.autoPosted.has(`${id}@${st.auto.head}`)));
  if (!v && starting) return h("div", { class: "rx-gen", "data-x-stage": "", "data-explain-starting": "" }, h("div", { class: "rx-gencard", role: "status" },
    h("h3", {}, T(`Starting ${skillName(st, sid)}…`, `正在開始 ${skillName(st, sid)}…`)),
    h("p", { class: "faint" }, T("Opening the room starts its explanation for this head by itself, on the room's tutor model. It runs in the background; Stop is on the next screen.", "打開審查室就會自動替這個 head 產生說明，用審查室導師的模型。在背景跑；下一個畫面有停止。"))));
  const fa = autoFailed(st, id), retryBtn = () => fa && fa.code !== "confirm_required" && r.open && !readOnly() ? h("button", { type: "button", class: "btn primary", "data-explain-retry": "", disabled: X.posting.has(`${id}/auto`) ? true : null, onclick: () => autoStart(id, !fa.page) }, T("Try again", "再試一次")) : null;
  if (!v && fa && !fa.run) return h("div", { class: "rx-empty", "data-x-stage": "", "data-explain-empty": "" },
    h("div", { class: "rx-state err", role: "alert", "data-explain-ended": "start" }, h("span", { class: "rx-ic", "aria-hidden": "true" }, "✕"),
      h("div", {}, h("b", {}, T(`${skillName(st, sid)} did not start`, `${skillName(st, sid)} 沒有開始`)), h("p", {}, fa.text), fa.detail ? h("small", { class: "faint" }, fa.detail) : null)),
    retryBtn() ?? (r.open && !readOnly() ? h("button", { type: "button", class: "btn primary", "data-explain-again": "", onclick: () => openConfirm(r, sid, "generate", "[data-explain-again]") }, T("Generate", "產生")) : null));
  if (!v) { const bad = lastGen && lastGen.status !== "done" && lastGen.status !== "running", w = bad ? whyOf(lastGen) : null;
    return h("div", { class: "rx-empty", "data-x-stage": "", "data-explain-empty": "" },
      bad ? h("div", { class: `rx-state ${lastGen.status === "stopped" ? "warn" : "err"}`, role: "alert", "data-explain-ended": lastGen.why || lastGen.status },
        h("span", { class: "rx-ic", "aria-hidden": "true" }, lastGen.status === "stopped" ? "⚠" : "✕"),
        h("div", {}, h("b", {}, lastGen.status === "stopped" ? T(`${sk(lastGen.skill)} stopped`, `${sk(lastGen.skill)} 已停止`) : T(`${sk(lastGen.skill)} did not finish`, `${sk(lastGen.skill)} 沒有完成`)), h("p", {}, w.text), w.detail ? h("small", { class: "faint" }, w.detail) : null))
        : h("p", {}, T(`Nothing made with ${skillName(st, sid)} yet in this room.`, `這間審查室還沒有用 ${skillName(st, sid)} 產生過。`)),
      (bad && fa?.run === lastGen ? retryBtn() : null) ?? (r.open && !readOnly() ? h("button", { type: "button", class: "btn primary", "data-explain-again": "", onclick: () => openConfirm(r, sid, "generate", "[data-explain-again]") }, bad ? T("Try again", "再試一次") : T("Generate", "產生")) : null)); }
  const gen = run && run.kind === "generate" ? run : null;
  return h("div", { class: `rx-stagein${gen ? " gen" : ""}`, "data-x-stage": "" },
    // a new version being made (a new head): the one shown stays, the progress is one strip above it, with Stop
    gen ? genStrip(r, st, gen) : null,
    // the layer with the output is placed over this slot (it is not part of the page's redraws)
    h("div", { class: "rx-slot", "data-x-slot": `${id}/${v.n}` }));
}
function genStrip(r, st, run) {
  const id = r.card.id, ms = Date.now() - Date.parse(run.at), last = (run.progress || []).at(-1);
  return h("div", { class: "rx-genstrip", role: "status", "data-explain-genstrip": run.n },
    h("b", {}, T(`${sk(run.skill)} is making a new version${run.head ? ` for ${short(run.head)}` : ""}`, `${sk(run.skill)} 正在產生新的一版${run.head ? `（${short(run.head)}）` : ""}`)),
    h("span", { class: "faint" }, `${fmtMin(ms)} · ${T(`round ${run.rounds.length || 1}`, `第 ${run.rounds.length || 1} 輪`)}${money(run.cost) ? ` · ${money(run.cost)}` : ""}`),
    h("span", { class: "faint", "data-explain-model": "" }, whoPays(run)),
    last ? h("span", { class: "faint" }, last.text) : null, h("span", { class: "rx-genstrip-fill" }),
    readOnly() ? null : h("button", { type: "button", class: "btn sm", "data-explain-stop": "", disabled: X.posting.has(`${id}/stop`) ? true : null, onclick: () => stop(id) }, T("Stop", "停止")));
}
function progressCard(r, st, run) {
  const id = r.card.id, ms = Date.now() - Date.parse(run.at), rounds = run.rounds.length, prog = run.progress || [], prep = run.prepare || null, read = prog.length > 1 || rounds > 0 || !!prep;
  const pct = Math.max(2, Math.min(100, Math.round((ms / (run.limitMin * 60000)) * 100)));
  const step = (cls, mark, text, kids) => h("li", { class: cls }, h("span", { class: "d", "aria-hidden": "true" }, mark), h("div", {}, text, kids || null));
  return h("div", { class: "rx-gen", "data-x-stage": "", "data-x-keep": "gen", "data-explain-progress": run.n },
    h("div", { class: "rx-gencard" },
      h("h3", {}, T(`${sk(run.skill)} is making the explanation`, `${sk(run.skill)} 正在產生說明`)),
      h("div", { class: "faint", "data-explain-model": "" }, whoPays(run)),
      h("div", { class: "faint" }, T(`${fmtMin(ms)} so far · round ${rounds || 1} · it runs in the background: you can leave, Studio tells you when it is done`, `已跑 ${fmtMin(ms)} · 第 ${rounds || 1} 輪 · 在背景跑：可以先離開，做好了 Studio 會通知`), money(run.cost) ? ` · ${money(run.cost)}` : ""),
      h("ol", { class: "rx-steps", "data-explain-steps": "" },
        step(read ? "done" : "now", read ? "✓" : "●", T("Studio reads the materials (read-only)", "Studio 讀材料（唯讀）")),
        // a version approved with scripts: its dependencies from its lockfiles, in Studio's sandbox, before the first round
        prep ? h("li", { class: prep.state === "running" ? "now" : prep.state === "done" ? "done" : "bad", "data-explain-prepare": prep.state }, h("span", { class: "d", "aria-hidden": "true" }, prep.state === "running" ? "●" : prep.state === "done" ? "✓" : "✕"),
          h("div", {}, prep.state === "running" ? T("Studio is installing the skill's dependencies from its lockfiles (sandboxed)…", "Studio 正在照 skill 的 lockfile 安裝依賴（在沙盒裡）…") : prep.state === "done" ? T("Studio installed the skill's dependencies", "Studio 已安裝 skill 的依賴") : T("Studio could not install the skill's dependencies", "Studio 沒辦法安裝 skill 的依賴"),
            (prep.reasons || []).length ? h("small", { class: "faint" }, ` · ${(prep.reasons || []).map((x) => T(x.en, x.zh)).join(T("; ", "；"))}`) : null)) : null,
        step(read && !(prep && prep.state === "running") ? "now" : "todo", read && !(prep && prep.state === "running") ? "●" : "○", T(`The skill works, round by round (round ${rounds || 1})`, `skill 一輪輪地做（第 ${rounds || 1} 輪）`),
          // the skill's own lines, and each script call with its outcome (✓ ⚠ ✗), worded here in the captain's language
          prog.length > 1 ? h("ul", { class: "rx-sub-steps" }, prog.slice(1).slice(-12).map((p) => { if (!p.script) return h("li", {}, p.text); const s = scriptLine(p.script); return h("li", { class: `rx-callrow ${s.cls}` }, h("span", { class: "d" }, s.mark), " ", s.body); })) : null),
        step("todo", "○", T("It checks its own output, then says it is done", "它自己檢查產出，滿意了才說完成")),
        step("todo", "○", T("Studio shows it in the isolated frame", "Studio 放進隔離框顯示"))),
      h("div", { class: "rx-bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(run.limitMin), "aria-valuenow": String(Math.round(ms / 60000)), "aria-label": T("Time used of the safety limit", "安全時限已用掉的時間") }, h("i", { style: `width:${pct}%` })),
      h("small", { class: "faint" }, T(`${fmtMin(ms)} of the ${run.limitMin} min safety limit`, `安全時限 ${run.limitMin} 分鐘，已用 ${fmtMin(ms)}`)),
      h("div", { class: "rx-foot" },
        h("button", { type: "button", class: "btn sm", "data-explain-log": "", "aria-expanded": String(X.logOpen.has(id)), onclick: () => { if (X.logOpen.has(id)) X.logOpen.delete(id); else X.logOpen.add(id); refresh(id); } }, T("The skill's live log", "skill 的即時紀錄")),
        readOnly() ? null : h("button", { type: "button", class: "btn sm", "data-explain-stop": "", disabled: X.posting.has(`${id}/stop`) ? true : null, onclick: () => stop(id) }, T("Stop", "停止"))),
      X.logOpen.has(id) ? h("pre", { class: "rx-log", "data-explain-logtext": "", "data-x-keep": "log" }, (st.log || []).map((l) => `${hhmm(l.ts)} ${l.kind} ${l.text}`).join("\n") || T("(nothing yet)", "（還沒有）")) : null));
}
async function stop(id) { const was = state(id)?.running; X.posting.add(`${id}/stop`); refresh(id); try { X.st.set(id, await postJ(`${base(id)}/stop`, {})); ended(id, was); } catch (e) { X.err.set(id, bi(e.message)); } finally { X.posting.delete(`${id}/stop`); load(id); } }

// ---------- the chat: the room's own questions, answered by its tutor about the page shown; never a change to the page ----------
/** what the ask box can do now: ask; wait for the first output (the question waits for it); wait for an answer; nothing */
const askMode = (r, st) => { const id = r.card.id, v = shownVersion(id), run = liveRun(st);
  if (!r.open || r.snapshot || readOnly()) return "closed"; if (run?.kind === "ask") return "answering"; if (run?.kind === "generate" && !v) return "queue"; if (run) return "busy"; return v ? "ask" : "none"; };
function syncAsk(r, st) {
  const ta = document.querySelector("[data-explain-q]"); if (!ta) return; const m = askMode(r, st);
  ta.disabled = m === "closed" || m === "none";
  ta.placeholder = m === "queue" ? T("Ask now: it is sent once the output is ready", "現在就可以問：產出好了就送出") : m === "none" ? T("Generate an output first", "先產生一份產出") : T("Ask about this explanation…", "問這份說明…");
}
/** the question being sent (X.pend): shown in the chat at once, before the server answers. Sending, then Starting (a confirmed
 *  follow-up is admitted first: a model Studio verifies again can take a minute), waiting for the paid confirmation, or refused
 *  with why and Retry. The server's run takes its place: when /ask answers, or when a push or poll brings that run first. */
const PEND_STARTING_MS = 400;
/** the run that is this question, once the server has it: an ask run newer than the pending one began after, with its text */
const pendRun = (id, st) => { const p = X.pend.get(id); return p && st ? st.runs.find((x) => x.kind === "ask" && x.n > p.after && x.question === p.q) || null : null; };
function settled(id) { const p = X.pend.get(id); if (p && (p.phase === "sending" || p.phase === "starting") && pendRun(id, state(id))) { clearTimeout(p.timer); X.pend.delete(id); } }
const pendInView = () => requestAnimationFrame(() => document.querySelector("[data-explain-pending]")?.scrollIntoView({ block: "nearest" }));
/** Ask in room id: its own state, version and draft, only while that room is the one shown and explained by a skill
 *  (a question never goes to another room's /ask, whatever was drawn last). The paid confirmation comes back as an offer. */
async function send(id, q, confirm, consent, decision) {
  const r = window.crewReviewRoomData?.(id); if (!r || !onRoom(id) || !active(id)) return;
  const text = String(q ?? X.draft.get(id) ?? "").trim(); if (!text) return; const m = askMode(r, state(id));
  if (L.full) exitFull(); // the follow-up's confirmation and its answer are in the chat
  // the first output is still being made: the question waits for it (sent when the run ends with a version)
  if (m === "queue") { if (X.pend.get(id)?.q === text) unpend(id, true); X.queue.set(id, text); X.draft.delete(id); const ta = document.querySelector(`[data-explain-room="${CSS.escape(id)}"] [data-explain-q]`); if (ta) ta.value = ""; refresh(id); return; }
  if (m !== "ask" || X.posting.has(`${id}/ask`)) return;
  const v = shownVersion(id), st0 = state(id); X.posting.add(`${id}/ask`); X.ask = null;
  // the question is in the chat now and out of the ask box (Cancel or a refusal gives it back: nothing is lost)
  clearTimeout(X.pend.get(id)?.timer);
  const p = { q: text, v: v.n, phase: "sending", why: null, after: st0?.runs.at(-1)?.n ?? 0, timer: null }; X.pend.set(id, p);
  p.timer = setTimeout(() => { if (X.pend.get(id) === p && p.phase === "sending") { p.phase = "starting"; refresh(id); } }, PEND_STARTING_MS);
  X.draft.delete(id); const ta0 = document.querySelector(`[data-explain-room="${CSS.escape(id)}"] [data-explain-q]`); if (ta0) ta0.value = "";
  refresh(id); pendInView();
  try { X.st.set(id, await postJ(`${base(id)}/ask`, { question: text, version: v.n, ...(confirm ? { confirm, consent: !!consent } : {}), ...(decision ? { skillDecision: decision } : {}) }));
    clearTimeout(p.timer); if (X.pend.get(id) === p) X.pend.delete(id); schedule(id); }
  catch (e) { clearTimeout(p.timer); const mine = X.pend.get(id) === p;
    if (e.code === "confirm_required" && e.offer) { X.ask = { id, q: text, offer: e.offer }; if (mine) p.phase = "confirm"; want = "[data-explain-askok]"; }
    else if (mine) { p.phase = "refused"; p.why = bi(e.message); } else X.err.set(id, bi(e.message)); }
  finally { X.posting.delete(`${id}/ask`); refresh(id); if (X.pend.get(id) === p && p.phase === "refused") pendInView(); }
}
/** the pending question set aside: back into the ask box when the box is empty (Cancel on the confirmation, or on a refusal) */
function unpend(id, drop) { const p = X.pend.get(id); if (!p) return; clearTimeout(p.timer); X.pend.delete(id);
  if (!drop && !X.draft.get(id)) { X.draft.set(id, p.q); const ta = document.querySelector(`[data-explain-room="${CSS.escape(id)}"] [data-explain-q]`); if (ta && !ta.value) ta.value = p.q; } }
/** Retry a refused question: the same text, about the version shown now */
function retry(id) { const p = X.pend.get(id); if (!p || p.phase !== "refused") return; send(id, p.q); }
function chat(r, st) {
  const id = r.card.id;
  if (readOnly()) return h("aside", { class: "rx-chat", "data-x-chat": "" }, msgs(r, st), h("p", { class: "rx-ro faint", "data-explain-readonly": "" }, T("Read only here: ask and run the skill on the Mac.", "這裡只能看：在 Mac 上追問和執行 skill。")));
  return h("aside", { class: "rx-chat", "data-x-chat": "" }, msgs(r, st),
    h("div", { class: "rx-ask" },
      h("textarea", { "data-explain-q": "", rows: "3", "aria-label": T("Your question", "你的問題"), oninput: (e) => X.draft.set(id, e.target.value), onkeydown: (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(id); } } }, X.draft.get(id) || ""),
      scope(r, st), askRow(r, st)));
}
function askRow(r, st) {
  const id = r.card.id, m = askMode(r, st), o = r.offer;
  const why = m === "answering" ? T("Wait for the answer to this question", "等這個問題回答完") : m === "busy" ? T("Wait for the page to be made", "等頁面產生完") : m === "none" ? T("Generate an output first", "先產生一份產出") : "";
  return h("div", { class: "rx-row", "data-x-askrow": "" }, h("span", { class: "grow faint" }, why), h("span", { class: "faint", "data-explain-answerer": "" }, T("answered by the room's tutor", "由審查室的導師回答"), o?.provider ? ` · ${o.provider} · ${o.model ?? T("default model", "預設模型")}` : ""),
    h("button", { type: "button", class: "rr-chip lead", "data-explain-send": "", disabled: (m === "ask" || m === "queue") && !X.posting.has(`${id}/ask`) ? null : true, title: why, onclick: () => send(id) }, m === "queue" ? T("Ask when ready", "好了再問") : T("Ask", "問")));
}
function scope(r, st) {
  const id = r.card.id, v = shownVersion(id);
  return h("div", { class: "rx-scope", "data-x-scope": "" }, h("span", { "data-explain-scope": "page" }, v ? T(`About: the page shown (v${v.n})`, `對象：目前這一版頁面（v${v.n}）`) : T("About: the page, once it is made", "對象：頁面產生之後")));
}
/** an answer's Markdown as the chat shows it, built from text nodes only (never HTML from the model): paragraphs, lists,
 *  tables, headings, **bold** and `code` */
const mdInline = (t) => { const out = [], re = /\*\*([^*\n]+?)\*\*|`([^`\n]+)`/g; let i = 0, m; const s = String(t);
  while ((m = re.exec(s))) { if (m.index > i) out.push(s.slice(i, m.index)); out.push(m[1] != null ? h("b", {}, m[1]) : h("code", {}, m[2])); i = m.index + m[0].length; }
  if (i < s.length) out.push(s.slice(i)); return out; };
function answerView(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n"), out = []; let i = 0;
  const cells = (l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, "|").trim());
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    if (/^\s*\|/.test(l)) { const rows = []; while (i < lines.length && /^\s*\|/.test(lines[i])) { if (!/^\s*\|?\s*:?-{2,}/.test(lines[i])) rows.push(cells(lines[i])); i++; }
      out.push(h("div", { class: "rx-tablewrap" }, h("table", { class: "rx-table" }, rows.map((r, k) => h("tr", {}, r.map((c) => h(k ? "td" : "th", {}, mdInline(c)))))))); continue; }
    if (/^\s*([-*+]|\d+\.)\s+/.test(l)) { const ord = /^\s*\d+\./.test(l), items = []; while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, "")); i++; }
      out.push(h(ord ? "ol" : "ul", {}, items.map((x) => h("li", {}, mdInline(x))))); continue; }
    const hd = /^\s*#{1,6}\s+(.*)$/.exec(l); if (hd) { out.push(h("h4", {}, mdInline(hd[1]))); i++; continue; }
    const para = []; while (i < lines.length && lines[i].trim() && !/^\s*(\||[-*+]\s|\d+\.\s|#{1,6}\s)/.test(lines[i])) { para.push(lines[i].trim()); i++; }
    out.push(h("p", {}, mdInline(para.join(" "))));
  }
  return h("div", { class: "rx-md", "data-explain-md": "" }, out);
}
function msgs(r, st) {
  const id = r.card.id, a = X.ask && X.ask.id === id ? X.ask : null, out = [];
  // every message has a key (data-k) the in-place patch finds it by (patchMsgs)
  const put = (k, e) => { e.dataset.k = k; out.push(e); };
  put("intro", h("div", { class: "rx-m sys" }, T("Ask about this page: the room's tutor answers here, from the page shown and the change's code. It never changes the page; Generate again does.", "問這一頁：審查室的導師在這裡回答，依據目前這一版頁面和改動的程式碼。它不會改頁面；要改頁面請按重新產生。")));
  for (const run of st.runs) {
    const spent = [run.ended ? fmtMin(Date.parse(run.ended) - Date.parse(run.at)) : null, money(run.cost)].filter(Boolean).join(" · ");
    if (run.kind === "generate") {
      if (run.status === "done" || run.status === "running") put(`g${run.n}`, h("div", { class: "rx-m sys", "data-explain-run": run.n, "data-status": run.status }, run.status === "running" ? T(`${sk(run.skill)}: generating…`, `${sk(run.skill)}：產生中…`) : T(`${sk(run.skill)} v${run.version} made · ${spent}`, `${sk(run.skill)} v${run.version} 完成 · ${spent}`)));
      else { const w = whyOf(run); put(`g${run.n}`, h("div", { class: `rx-m ${run.status === "stopped" ? "warn" : "err"}`, "data-explain-run": run.n, "data-status": run.status }, h("span", { class: "rx-ic", "aria-hidden": "true" }, run.status === "stopped" ? "⚠" : "✕"), h("b", {}, sk(run.skill)), " ", w.text, spent ? h("small", { class: "faint" }, ` · ${spent}`) : null)); }
      continue; }
    put(`q${run.n}`, h("div", { class: "rx-m me", "data-explain-q-run": run.n }, run.from ? h("span", { class: "rx-thumb", "data-explain-about": run.from }, T(`about v${run.from}`, `關於 v${run.from}`)) : null, run.question));
    put(`a${run.n}`, h("div", { class: `rx-m ${run.status === "done" || run.status === "running" ? "ai" : run.status === "stopped" ? "warn" : "err"}`, "data-explain-answer": run.n, "data-status": run.status },
      run.status === "running" ? [h("span", { class: "faint" }, T("Working on it…", "處理中…")), ...(run.progress || []).slice(-3).map((p) => { if (p.script) { const s = scriptLine(p.script); return h("div", { class: `rx-callrow ${s.cls}` }, h("span", { class: "d" }, s.mark), " ", s.body); } return h("div", { class: "faint" }, `· ${p.text}`); }),
        readOnly() ? null : h("div", {}, h("button", { type: "button", class: "btn sm", "data-explain-stop": "", onclick: () => stop(id) }, T("Stop", "停止")))]
      : run.status === "done" ? [answerView(run.answer),
        run.cites?.length ? h("div", { class: "rx-cites" }, run.cites.map((c) => h("span", { class: "rx-cite", "data-explain-cite": "" }, c))) : null,
        spent ? h("small", { class: "faint" }, spent) : null]
      : (() => { const w = whyOf(run); return [h("span", { class: "rx-ic", "aria-hidden": "true" }, run.status === "stopped" ? "⚠" : "✕"), w.text, w.detail ? h("small", { class: "faint" }, ` ${w.detail}`) : null]; })()));
  }
  const q = X.queue.get(id);
  if (q) put("queued", h("div", { class: "rx-m me rx-queued", "data-explain-queued": "" }, h("span", { class: "rx-thumb" }, T("waits for the output", "等產出好了再問")), q,
    h("button", { type: "button", class: "rx-x", "aria-label": T("Do not ask it", "不問了"), onclick: () => { X.queue.delete(id); refresh(id); } }, "✕")));
  // the question being sent, until the server's run (above) is it
  const p = X.pend.get(id);
  if (p && !pendRun(id, st)) { const PH = { sending: T("Sending…", "送出中…"), starting: T("Starting…", "開始中…"), confirm: T("Waits for your confirmation", "等你確認"), refused: T("Not asked", "沒有送出") };
    put("pending", h("div", { class: `rx-m me rx-pending${p.phase === "refused" ? " refused" : ""}`, "data-explain-pending": p.phase, "aria-busy": p.phase === "sending" || p.phase === "starting" ? "true" : null }, h("span", { class: "rx-thumb" }, T(`about v${p.v}`, `關於 v${p.v}`)), p.q,
      h("small", { class: "rx-pendstate", role: "status", "data-explain-pendstate": "" }, PH[p.phase])));
    if (p.phase === "refused") put("refused", h("div", { class: "rx-m err", role: "alert", "data-explain-error": "" }, h("span", { class: "rx-ic", "aria-hidden": "true" }, "✕"), p.why,
      h("div", { class: "rx-foot" }, h("button", { type: "button", class: "btn sm", "data-explain-pendx": "", onclick: () => { unpend(id); refresh(id); focusLater("[data-explain-q]"); } }, T("Back to the ask box", "放回輸入框")),
        h("button", { type: "button", class: "btn sm primary", "data-explain-retry": "", disabled: askMode(r, st) === "ask" ? null : true, title: askMode(r, st) === "ask" ? "" : T("Wait for the skill to finish", "等 skill 做完"), onclick: () => retry(id) }, T("Retry", "重試"))))); }
  if (a) put(`confirm:${a.offer.hash}:${a.q}`, h("div", { class: "rx-m ai rx-askconfirm", "data-explain-askconfirm": "", role: "group", "aria-label": T("Confirm the paid question", "確認付費提問") },
    h("p", {}, T(`The room's tutor answers this question: a paid run on ${a.offer.provider} · ${a.offer.model ?? "default model"}. It reads the page shown and the change's code, and never changes the page.`, `審查室的導師回答這個問題：用 ${a.offer.provider} · ${a.offer.model ?? "預設模型"} 付費執行。它讀目前這一版頁面和改動的程式碼，不會改頁面。`), a.offer.billing ? h("small", { class: "faint" }, ` ${T(a.offer.billing.en, a.offer.billing.zh)}`) : null),
    h("label", {}, h("input", { type: "checkbox", "data-explain-consent": "", onchange: (e) => { if (e.target.checked) X.consent.add(id); else X.consent.delete(id); } }),
      T(" Ask the next questions here on this tutor without confirming each", " 之後在這裡問同一位導師時不用再確認")),
    h("div", { class: "rx-foot" }, h("button", { type: "button", class: "btn sm", onclick: () => { X.ask = null; if (X.pend.get(id)?.phase === "confirm") unpend(id); refresh(id); focusLater("[data-explain-q]"); } }, T("Cancel", "取消")),
      h("button", { type: "button", class: "btn sm primary", "data-explain-askok": "", onclick: () => send(id, a.q, a.offer.hash, X.consent.has(id)) }, T("Confirm and ask", "確認並提問")))));

  const err = X.err.get(id); if (err) put("err", h("div", { class: "rx-m err", role: "alert", "data-explain-error": "" }, h("span", { class: "rx-ic", "aria-hidden": "true" }, "✕"), err));
  // what the patch compares: the message as drawn (a message whose markup did not change is kept, never drawn again)
  for (const e of out) e._sig = e.outerHTML;
  // a new answer while the captain reads further up: a button to the end, never a jump (shown by patchMsgs)
  const more = h("button", { type: "button", class: "rx-new", "data-explain-new": "", "data-k": "new", hidden: !X.news.has(id), onclick: () => toEnd(id) }, "↓ ", T("New messages", "新訊息"));
  return h("div", { class: "rx-msgs", "data-x-msgs": "", "data-x-keep": "msgs" }, out, more);
}
// ---------- the chat's place: a redraw never moves what the captain reads ----------
/** within this many pixels of the end counts as reading the end: new content keeps it there */
const NEAR = 48;
const atEnd = (e) => e.scrollHeight - e.scrollTop - e.clientHeight <= NEAR;
/** the last place of each part that scrolls (data-x-keep), per room: kept from the captain's own scrolling, so a part drawn anew
 *  (a poll's redraw of the line or the stage, a whole-page redraw) is put back where it was */
const KEEP = new Map();
const PIN = new Set(["msgs", "body", "log"]);
const forget = (k) => { for (const key of [...KEEP.keys()]) if (key.endsWith(`|${k}`)) KEEP.delete(key); };
/** what scrolls the chat: its list beside the output, the whole room on a narrow screen (one column) */
const chatScroller = (m) => (/(auto|scroll)/.test(getComputedStyle(m).overflowY) ? m : m.closest(".rx-body") || m);
const newsShown = (id) => { const b = document.querySelector(`[data-explain-room="${CSS.escape(id)}"] [data-explain-new]`); if (b) b.hidden = !X.news.has(id); };
function toEnd(id) { const m = document.querySelector(`[data-explain-room="${CSS.escape(id)}"] [data-x-msgs]`); X.news.delete(id); newsShown(id); if (m) pin(chatScroller(m)); }
/** to the end, and kept there while what was just drawn settles (its fonts, its layout): unless the captain scrolls away first */
function pin(e) { const at = () => { e.scrollTop = e.scrollHeight; e._pinTop = e.scrollTop; }; at();
  const again = () => { if (e.isConnected && e._pinTop != null && Math.abs(e.scrollTop - e._pinTop) <= 1) at(); };
  requestAnimationFrame(() => { again(); requestAnimationFrame(again); }); setTimeout(again, 300); document.fonts?.ready.then(again); }
addEventListener("scroll", (ev) => { const e = ev.target; if (!(e instanceof Element) || !e.dataset.xKeep) return; const id = e.closest("[data-explain-room]")?.dataset.explainRoom; if (id == null) return;
  // a scroll Studio made to keep the end (pin) is the end, even when what it was drawing grew before the event came
  if (e._pinTop != null && Math.abs(e.scrollTop - e._pinTop) > 1) e._pinTop = null;
  const end = e._pinTop != null || atEnd(e); KEEP.set(`${id}|${e.dataset.xKeep}`, { top: e.scrollTop, end });
  if (end && X.news.has(id) && (e.dataset.xKeep === "msgs" || e.dataset.xKeep === "body")) { X.news.delete(id); newsShown(id); } }, true);
/** the scrolling parts back where the captain left them: one drawn anew to its last place, one at the end (the chat, the log)
 *  kept at the end; the chat opens at its newest message where it scrolls by itself (beside the output) */
function applyKeep(id) {
  const room = document.querySelector(`[data-explain-room="${CSS.escape(id)}"]`); if (!room) return;
  for (const e of [room, ...room.querySelectorAll("[data-x-keep]")]) { const k = e.dataset.xKeep, m = KEEP.get(`${id}|${k}`), fresh = !e._kept; e._kept = true;
    if (m?.end && PIN.has(k)) pin(e);
    else if (m && fresh) e.scrollTop = m.top;
    else if (!m && fresh && (k === "log" || (k === "msgs" && chatScroller(e) === e))) pin(e); }
}
/** a poll's chat patched in place by each message's key: a message whose markup is the same is kept as it is (its place, its
 *  focus, a box ticked in it), a changed one is swapped, a new one added. At the end it stays at the end; further up nothing
 *  moves, and a new message shows the button to the end */
function patchMsgs(id, old, fresh) {
  const s = chatScroller(old), end = atEnd(s), prev = new Map([...old.children].map((c) => [c.dataset.k, c]));
  let news = false;
  const next = [...fresh.children].map((n) => { const k = n.dataset.k, o = prev.get(k);
    if (k === "new") return o || n;
    if (o && o._sig === n._sig) return o;
    if (!o || (o.dataset.status !== n.dataset.status && n.dataset.status !== "running")) news = true;
    return n; });
  for (const c of [...old.children]) if (!next.includes(c)) c.remove();
  next.forEach((n, i) => { if (old.children[i] !== n) old.insertBefore(n, old.children[i] || null); });
  if (end) { X.news.delete(id); pin(s); } else if (news) X.news.add(id);
  newsShown(id);
}

// ---------- the output's layer: placed over the stage's slot, rebuilt only when the version shown changes ----------
const L = { el: null, key: null, frame: null, video: null, on: false, full: null, saved: null };
function layerEl() { if (!L.el) { L.el = h("div", { class: "rx-layer", "data-x-layer": "", hidden: true }); document.body.append(L.el); } return L.el; }
// ---------- full screen: the output fills the screen, and Esc (or ✕) brings the room back where it was ----------
/** the scroll positions of everything the stage sits in, put back once the room is back */
const scrollers = (el) => { const out = []; for (let e = el; e; e = e.parentElement) if (e.scrollTop || e.scrollLeft) out.push([e, e.scrollTop, e.scrollLeft]); return { out, x: scrollX, y: scrollY }; };
function fullBar(id, v) {
  return h("div", { class: "rx-fullbar", "data-explain-fullbar": "" }, h("span", { class: "rx-fulltitle" }, `${sk(v.skill)} v${v.n}`),
    h("button", { type: "button", class: "rx-fullx", "data-explain-fullclose": "", "aria-label": T("Exit full screen (Esc)", "離開全螢幕（Esc）"), onclick: () => exitFull() }, "✕ ", T("Exit full screen", "離開全螢幕"), h("kbd", {}, "Esc")));
}
/** native fullscreen of the output's layer (a picture or a video: of that element, natively); refused, a fixed full-window layer */
async function enterFull(id, v) {
  if (L.full || !L.el) return; const slot = document.querySelector("[data-x-slot]"); L.saved = scrollers(slot);
  const el = layerEl();
  const media = v.kind === "video" ? L.video : v.kind === "image" ? el.querySelector("[data-explain-image]") : null, target = media || el;
  el.querySelector("[data-explain-fullbar]")?.remove(); el.append(fullBar(id, v));
  Object.assign(el.style, { clipPath: "" }); el.hidden = false; L.full = "native";
  try { if (!target.requestFullscreen) throw new Error("no Fullscreen API"); await target.requestFullscreen({ navigationUI: "hide" }); if (document.fullscreenElement !== target) throw new Error("not full screen"); }
  catch { L.full = "fallback"; el.classList.add("full"); document.documentElement.classList.add("rx-fullon"); }
  el.dataset.full = L.full; requestAnimationFrame(() => (el.querySelector("[data-explain-fullclose]"))?.focus({ preventScroll: true }));
}
function exitFull() {
  if (!L.full) return; const was = L.full; L.full = null;
  if (was === "native" && document.fullscreenElement) { document.exitFullscreen?.().catch(() => {}); }
  const el = L.el; if (el) { el.classList.remove("full"); delete el.dataset.full; el.querySelector("[data-explain-fullbar]")?.remove(); }
  // the same output, its overlays drawn again on the stage (a kept box at its place there)
  if (L.key) L.key = `${L.key.split("/").slice(0, 2).join("/")}/~`;
  document.documentElement.classList.remove("rx-fullon");
  const s = L.saved; L.saved = null;
  const back = () => { if (s) { for (const [e, t, l] of s.out) { e.scrollTop = t; e.scrollLeft = l; } scrollTo(s.x, s.y); } document.querySelector("[data-explain-full]")?.focus({ preventScroll: true }); };
  back(); requestAnimationFrame(() => requestAnimationFrame(back));
}
addEventListener("fullscreenchange", () => { if (L.full === "native" && !document.fullscreenElement) exitFull(); });
/** F on the stage (or on the output's layer): full screen; never while typing or with a modifier */
addEventListener("keydown", (e) => {
  if (e.key !== "f" && e.key !== "F" || e.metaKey || e.ctrlKey || e.altKey || L.full || document.querySelector(".rx-modal")) return;
  const t = e.target; if (!t?.closest || t.closest("textarea,input,select,[contenteditable=''],[contenteditable='true']")) return;
  if (!t.closest("[data-x-stage]") && !t.closest("[data-x-line]") && !(L.el && L.el.contains(t))) return;
  const slot = document.querySelector("[data-x-slot]"); if (!slot) return; const [id, n] = [slot.dataset.xSlot.split("/").slice(0, -1).join("/"), Number(slot.dataset.xSlot.split("/").at(-1))];
  const v = state(id)?.versions.find((x) => x.n === n); if (!v) return; e.preventDefault(); enterFull(id, v); });
/** "Open in new tab": a fresh capability, Studio's page that frames the version exactly as here (sandbox allow-scripts, the output CSP) */
async function openTab(id, v) {
  try { const j = await api(`${base(id)}/cap?v=${v.n}`); window.open(`/rrxt/${enc(j.cap)}/${enc(id)}/${v.n}`, "_blank", "noopener,noreferrer"); }
  catch (e) { X.err.set(id, bi(e.message)); refresh(id); }
}
async function capFor(id, v) { const k = `${id}/${v.n}`, had = X.caps.get(k); if (had && had.exp > Date.now()) return had.src;
  const j = await api(`${base(id)}/cap?v=${v.n}`); const src = `${j.base}${v.entry.split("/").map(enc).join("/")}`; X.caps.set(k, { src, exp: Date.now() + 20 * 60_000 }); return src; }
function mount(id, v) {
  const key = `${id}/${v.n}/`, el = layerEl(); if (L.key === key) return;
  const sameOutput = L.key && L.key.split("/").slice(0, 2).join("/") === `${id}/${v.n}`; L.key = key;
  if (!sameOutput) {
    el.replaceChildren(); L.frame = null; L.video = null;
    if (v.kind === "html" || v.kind === "markdown" || v.kind === "text") {
      // allow-scripts only: an opaque origin (no allow-same-origin, no popups, no forms, no top navigation)
      L.frame = h("iframe", { class: "rx-frame", sandbox: "allow-scripts", referrerpolicy: "no-referrer", title: `${sk(v.skill)} v${v.n}`, "data-explain-frame": `${v.n}` });
      el.append(L.frame); capFor(id, v).then((src) => { if (L.frame && L.key?.startsWith(`${id}/${v.n}/`)) L.frame.src = src; }).catch((e) => { X.err.set(id, bi(e.message)); refresh(id); });
    } else if (v.kind === "video") { L.video = h("video", { class: "rx-media", controls: true, preload: "metadata", src: `${base(id)}/media/${v.n}/${v.entry.split("/").map(enc).join("/")}`, "data-explain-video": "" }); el.append(L.video); }
    else el.append(h("img", { class: "rx-media", alt: v.summary || v.entry, src: `${base(id)}/media/${v.n}/${v.entry.split("/").map(enc).join("/")}`, "data-explain-image": "" }));
  }
}
function tick() {
  const slot = document.querySelector("[data-x-slot]"), modal = document.querySelector(".rx-modalbg");
  // off the room (or on the tutor's board): the output is unloaded, so its scripts stop
  if (!slot) { if (L.full) exitFull(); if (L.el) { L.el.hidden = true; L.el.replaceChildren(); L.key = null; L.frame = null; L.video = null; } L.on = false; return; }
  const [id, n] = [slot.dataset.xSlot.split("/").slice(0, -1).join("/"), Number(slot.dataset.xSlot.split("/").at(-1))], v = state(id)?.versions.find((x) => x.n === n);
  // another version on the stage (or none): full screen ends first
  if (L.full && (!v || (L.key && !L.key.startsWith(`${id}/${n}/`)))) exitFull();
  if (v && !L.full) mount(id, v);
  // full screen: the layer is the screen (or the window); the stage's geometry and clipping wait until the room is back
  if (L.full) { const el = layerEl(); el.hidden = false; el.style.clipPath = ""; requestAnimationFrame(tick); return; }
  // the layer only ever draws (and takes clicks) where its slot is visible inside the room's scrolling body: clipped to the
  // body's rect, below the room's header and inside the window; hidden once nothing of it is in view
  const b = slot.getBoundingClientRect(), el = layerEl(), body = slot.closest(".rx-body")?.getBoundingClientRect(), head = document.querySelector(".rr-head")?.getBoundingClientRect();
  const top = Math.max(b.top, body?.top ?? b.top, head?.bottom ?? 0, 0), bottom = Math.min(b.bottom, body?.bottom ?? b.bottom, innerHeight), shown = bottom - top >= 4;
  Object.assign(el.style, { left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px`,
    clipPath: shown && (top > b.top || bottom < b.bottom) ? `inset(${top - b.top}px 0 ${b.bottom - bottom}px 0)` : "" });
  el.hidden = !!modal || !v || b.height < 4 || !shown;
  requestAnimationFrame(tick);
}
function tickStart() { if (!L.on) { L.on = true; requestAnimationFrame(tick); } }
addEventListener("keydown", (e) => { if (e.key !== "Escape") return; const id = S.route?.name === "room" ? S.route.arg : null; if (!id) return;
  if (X.confirm || X.pick) { e.preventDefault(); e.stopPropagation(); closeDialog(); }
  else if (X.verMenu === id) { closeVerMenu(); document.querySelector("[data-explain-versions]")?.focus(); e.preventDefault(); }
  else if (L.full) { exitFull(); e.preventDefault(); } }, true);
/** the version menu closes in place (no redraw: the control the focus went to stays the same element) */
function closeVerMenu() {
  X.verMenu = null; forget("vermenu"); document.querySelectorAll("[data-explain-vermenu],[data-explain-verscrim]").forEach((e) => e.remove());
  if (want?.includes("[data-explain-vermenu]")) want = null; // a focus still on its way into the menu does not land elsewhere
  document.querySelector("[data-explain-versions]")?.setAttribute("aria-expanded", "false");
}
addEventListener("hashchange", () => { if (L.full) exitFull(); X.verMenu = null; X.pick = null; X.confirm = null; const id = S.route?.name === "room" ? S.route.arg : null; if (id && !id.startsWith("lib:")) load(id); });

window.crewRoomExplain = { ensure, state, active, picker, view, load, dialogs, full: () => L.full };
})();
