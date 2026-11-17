// "Explain with" in the review room (docs/units/review-room.md, src/domain/review-explain.ts): the room presented by one of the
// captain's own skills instead of the built-in tutor's board. The header's picker chooses; a skill's run is paid and confirmed
// (the model, the materials, the expected time, the safety limit, the isolation); it runs in the background with live progress
// and a Stop; every generation and every follow-up that changes the output is a version in the left rail; the chat on the right
// asks follow-ups, about the whole output or a region boxed on it (or a paused video frame).
// An output page lives in a sandboxed iframe (allow-scripts only: an opaque origin) on a page Studio serves with a CSP that allows
// no network. The frame sits in a layer of its own over the stage, so a redraw of the room never reloads it; its helper answers
// "what lies in this rectangle" through postMessage, and only the frame Studio made is listened to. Model text only ever goes
// into text nodes here.
(() => {
const X = { st: new Map(), loading: new Set(), err: new Map(), poll: new Map(), pick: null, confirm: null, shown: new Map(), sel: new Map(), draft: new Map(), caps: new Map(),
  posting: new Set(), ask: null, consent: new Set(), boxing: null, logOpen: new Set() };
const enc = encodeURIComponent;
const api = async (u) => { const r = await fetch(u); let j = {}; try { j = await r.json(); } catch {} if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { code: j.code }); return j; };
const postJ = async (u, b) => { const r = await fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b ?? {}) }); let j = {}; try { j = await r.json(); } catch {} if (!r.ok || j.error) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { code: j.code, offer: j.offer }); return j; };
const onRoom = (id) => S.route?.name === "room" && S.route.arg === id;
const base = (id) => `/api/review-room/${enc(id)}/explain`;
const state = (id) => X.st.get(id) || null;
const fmtMin = (ms) => { const m = Math.max(0, Math.round(ms / 60000)); return m < 1 ? T("under a minute", "不到一分鐘") : T(`${m} min`, `${m} 分鐘`); };
const money = (c) => (c && typeof c.usd === "number" ? `$${c.usd.toFixed(c.usd < 1 ? 3 : 2)}` : null);
const hhmm = (t) => String(t || "").slice(11, 16);
const ts = (s) => { const t = Math.max(0, Math.floor(s || 0)); return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`; };
const skillName = (st, sid) => st?.skills?.find((s) => s.id === sid)?.name || sid;
const latest = (st) => st?.versions?.at(-1) || null;
const shownVersion = (id) => { const st = state(id); if (!st) return null; const n = X.shown.get(id); return st.versions.find((v) => v.n === n) || latest(st); };
const liveRun = (st) => (st?.running != null ? st.runs.find((r) => r.n === st.running) : null);

async function load(id) {
  if (X.loading.has(id)) return; X.loading.add(id);
  try { X.st.set(id, await api(base(id))); X.err.delete(id); } catch (e) { X.err.set(id, e.message); }
  finally { X.loading.delete(id); refresh(id); schedule(id); }
}
function schedule(id) { clearTimeout(X.poll.get(id)); X.poll.delete(id); if (state(id)?.running != null && onRoom(id)) X.poll.set(id, setTimeout(() => load(id), 2500)); }
window.liveListen?.("review-explain", (e) => { let d = {}; try { d = JSON.parse(e.data); } catch {} if (d.card && X.st.has(d.card) && onRoom(d.card)) load(d.card); });
/** a redraw of only the explainer's parts when they are on the page (the rail, the stage's toolbar, the chat's messages); the
 *  output's frame (in its layer) and the question being written stay as they are */
function refresh(id) {
  if (!onRoom(id)) return; const el = document.querySelector(`[data-explain-room="${CSS.escape(id)}"]`);
  const r = window.crewReviewRoomData?.(id);
  if (!el || !r || !active(id)) { render(); return; }
  const st = state(id); tickStart();
  for (const [sel, make] of [["[data-x-rail]", () => rail(r, st)], ["[data-x-stage]", () => stage(r, st)], ["[data-x-msgs]", () => msgs(r, st)], ["[data-x-scope]", () => scope(r, st)]]) { const old = el.querySelector(sel); if (old) old.replaceWith(make()); }
  const pk = document.querySelector("[data-explain-picker]"); if (pk) pk.replaceWith(picker(r));
}
const active = (id) => !!state(id)?.selected;
function ensure(id) { if (!X.st.has(id) && !X.loading.has(id) && !X.err.has(id)) load(id); }

// ---------- the header's picker: the built-in tutor, or one of the captain's skills ----------
function picker(r) {
  const id = r.card.id, st = state(id), sel = st?.selected;
  if (!st) return null;
  return h("span", { class: "rx-pick", "data-explain-picker": sel?.id || "tutor" },
    h("span", { class: "faint" }, T("Explain with", "解釋用")),
    h("button", { type: "button", class: "rr-pill rx-pickbtn", "aria-haspopup": "dialog", "data-explain-open": "", disabled: r.snapshot ? true : null, onclick: () => { X.pick = id; render(); } },
      sel ? skillName(st, sel.id) : T("Studio tutor", "Studio 導師"), " ▾"));
}
function pickerDialog(r) {
  const id = r.card.id, st = state(id); if (X.pick !== id || !st) return null;
  const close = () => { X.pick = null; render(); };
  const choose = async (sid) => {
    X.pick = null;
    // the tutor, or a skill that already has an output here: switching is free
    if (sid === null || st.versions.some((v) => v.skill.id === sid)) { try { X.st.set(id, await postJ(`${base(id)}/select`, { skill: sid })); } catch (e) { X.err.set(id, e.message); } render(); return; }
    openConfirm(r, sid, "generate");
  };
  const opt = (sid, name, desc, out, cur, own) => h("button", { type: "button", class: `rx-opt${cur ? " on" : ""}`, "data-explain-skill": sid ?? "tutor", "aria-pressed": String(!!cur), onclick: () => choose(sid) },
    h("span", { class: "rx-optname" }, h("b", {}, name), sid ? h("span", { class: "faint" }, own ? T(" · your skill", " · 你的 skill") : T(" · in Studio's library", " · Studio 技能庫")) : null), h("small", {}, desc), h("span", { class: "rx-optout" }, out));
  return h("div", { class: "rx-modalbg", onclick: (e) => { if (e.target === e.currentTarget) close(); } },
    h("div", { class: "rx-modal", role: "dialog", "aria-modal": "true", "aria-label": T("Explain this change with", "用什麼解釋這個改動"), "data-explain-menu": "" },
      h("h2", {}, T("Explain this change with", "用什麼解釋這個改動")),
      h("p", { class: "rx-sub" }, T("Studio's tutor draws on the board step by step. A skill from your Skills page makes its own kind of output: an interactive page, Markdown, pictures or a video, and you keep asking about it.", "Studio 導師在白板上一步步畫。技能頁裡你的 skill 會做出它自己的產出：互動頁、Markdown、圖片或影片，做好後一樣可以追問。")),
      opt(null, T("Studio tutor", "Studio 導師"), T("The board, as it is today: every sentence can be asked about.", "現在的白板：每句話都能點開問。"), T("board", "白板"), !st.selected),
      st.skills.length ? st.skills.map((s) => opt(s.id, s.name, s.description || s.id, st.versions.some((v) => v.skill.id === s.id) ? T(`${st.versions.filter((v) => v.skill.id === s.id).length} version(s) here`, `這裡已有 ${st.versions.filter((v) => v.skill.id === s.id).length} 版`) : T("new run", "新產生"), st.selected?.id === s.id, s.own))
        : h("p", { class: "faint", "data-explain-noskills": "" }, T("No skill in your library yet: add one on the Skills page (for example from ~/.claude/skills).", "技能庫裡還沒有 skill：到技能頁加入（例如從 ~/.claude/skills）。")),
      h("div", { class: "rx-foot" }, h("a", { href: "#/skills", class: "btn" }, T("Skills page", "技能頁")), h("button", { type: "button", class: "btn", onclick: close }, T("Cancel", "取消")))));
}
async function openConfirm(r, sid, kind) {
  const id = r.card.id; X.confirm = { id, sid, kind, offer: null, loading: true }; render();
  try { const o = await api(`${base(id)}/offer?skill=${enc(sid)}&kind=${kind}`); X.confirm = { ...X.confirm, offer: o, loading: false }; } catch (e) { X.confirm = { ...X.confirm, offer: { error: e.message }, loading: false }; }
  render();
}
function confirmDialog(r) {
  const c = X.confirm; if (!c || c.id !== r.card.id) return null; const o = c.offer, id = c.id;
  const close = () => { X.confirm = null; render(); };
  const row = (k, ...v) => [h("span", {}, k), h("span", {}, ...v)];
  const start = async () => { X.posting.add(`${id}/gen`); render();
    try { X.st.set(id, await postJ(`${base(id)}/generate`, { skill: c.sid, confirm: o.hash })); X.confirm = null; X.shown.delete(id); schedule(id); }
    catch (e) { if (e.offer) X.confirm = { ...c, offer: e.offer, note: e.message }; else X.confirm = { ...c, note: e.message }; }
    finally { X.posting.delete(`${id}/gen`); render(); } };
  const setLimit = async (v) => { try { await postJ("/api/review-room/explain/settings", { limitMin: Number(v) }); await openConfirm(r, c.sid, c.kind); } catch (e) { X.confirm = { ...c, note: e.message }; render(); } };
  return h("div", { class: "rx-modalbg", onclick: (e) => { if (e.target === e.currentTarget) close(); } },
    h("div", { class: "rx-modal", role: "dialog", "aria-modal": "true", "aria-label": T("Confirm the paid run", "確認付費執行"), "data-explain-confirm": c.sid },
      h("h2", {}, T(`Explain with ${o?.skill?.name || c.sid}`, `用 ${o?.skill?.name || c.sid} 解釋`)),
      c.loading ? h("p", { class: "faint" }, T("Reading the offer…", "讀取中…"))
      : o?.error ? h("p", { class: "rr-err", role: "alert" }, o.error)
      : [h("p", { class: "rx-sub" }, T("A paid run on the room's tutor model. Nothing starts until you confirm.", "用審查室導師的模型付費執行。按確認之前什麼都不會開始。")),
        h("div", { class: "rx-cost" },
          row(T("Model", "模型"), h("b", { "data-explain-model": `${o.provider}/${o.model}` }, `${o.provider} · ${o.model ?? T("default model", "預設模型")}${o.effort ? ` · ${o.effort}` : ""}`), o.independence?.en ? h("small", { class: "faint" }, ` — ${T(o.independence.en, o.independence.zh)}`) : null),
          row(T("Skill", "Skill"), `${o.skill.name} (v${o.skill.v})`),
          row(T("Materials (read-only)", "給 skill 的材料（唯讀）"), T(o.materials.en.join(", "), o.materials.zh.join("、"))),
          row(T("Rounds", "輪數"), T(o.rounds.en, o.rounds.zh)),
          row(T("Expected time", "預計時間"), o.expected ? T(`about ${o.expected.minutes} min (from ${o.expected.from} earlier run${o.expected.from === 1 ? "" : "s"})`, `約 ${o.expected.minutes} 分鐘（依之前 ${o.expected.from} 次）`) : T("not known yet: the first run of this skill here (often 10–30 min)", "還不知道：這是這個 skill 在這裡第一次跑（常見 10–30 分鐘）")),
          row(T("Safety limit", "安全時限"), h("span", { class: "rx-limit" }, h("input", { type: "number", min: "1", max: "1440", value: String(o.limitMin), "data-explain-limit": "", "aria-label": T("Safety limit in minutes", "安全時限（分鐘）"), onchange: (e) => setLimit(e.target.value) }), T(" min of wall clock, then Studio stops it", " 分鐘，到了 Studio 會停下"))),
          row(T("Isolation", "安全"), T(o.isolation.en, o.isolation.zh))),
        c.note ? h("p", { class: "rr-err", role: "alert" }, c.note) : null],
      h("div", { class: "rx-foot" }, h("button", { type: "button", class: "btn", onclick: close }, T("Cancel", "取消")),
        h("button", { type: "button", class: "btn primary", "data-explain-start": "", disabled: c.loading || o?.error || X.posting.has(`${id}/gen`) ? true : null, onclick: start }, T("Confirm and start", "確認並開始")))));
}

/** the picker's menu and the paid run's confirmation, over whichever way the room is shown */
const dialogs = (r) => [pickerDialog(r), confirmDialog(r)];
// ---------- the room: versions on the left, the output in the middle, the chat on the right ----------
function view(r) {
  const id = r.card.id, st = state(id);
  if (!st) return h("div", { class: "card x-pad faint" }, T("Loading…", "載入中…"));
  queueMicrotask(tickStart);
  return h("div", { class: "rx-body", "data-explain-room": id }, rail(r, st), h("main", { class: "rx-stage" }, stage(r, st)), chat(r, st), dialogs(r));
}
function rail(r, st) {
  const id = r.card.id, run = liveRun(st), cur = shownVersion(id), sid = st.selected?.id;
  return h("aside", { class: "rx-rail", "data-x-rail": "" },
    h("h6", {}, T("Outputs", "產出")),
    h("button", { type: "button", class: "rx-ver", "data-explain-tutor": "", onclick: async () => { try { X.st.set(id, await postJ(`${base(id)}/select`, { skill: null })); } catch (e) { X.err.set(id, e.message); } render(); } },
      h("span", { class: "k" }, T("Tutor", "導師")), T("The board", "原本的白板"), h("small", {}, T("Studio's own", "Studio 內建"))),
    st.versions.map((v) => h("button", { type: "button", class: `rx-ver${cur?.n === v.n ? " on" : ""}`, "data-explain-version": v.n, "aria-current": cur?.n === v.n ? "true" : null, onclick: () => { X.shown.set(id, v.n); X.sel.delete(id); X.boxing = null; render(); } },
      h("span", { class: "k" }, `${v.skill.name} v${v.n}`), v.summary || v.entry, h("small", {}, `${hhmm(v.at)}${v.from ? T(` · from v${v.from}, a follow-up`, ` · 由 v${v.from} 追問改的`) : ""}`))),
    run && run.kind === "generate" ? h("div", { class: "rx-ver on", "data-explain-generating": "" }, h("span", { class: "k" }, run.skill.name), T("Generating…", "產生中…"), h("small", {}, T(`started ${hhmm(run.at)}`, `開始於 ${hhmm(run.at)}`))) : null,
    sid && !run && r.open ? h("button", { type: "button", class: "btn sm rx-again", "data-explain-again": "", onclick: () => openConfirm(r, sid, "generate") }, latest(st) ? T("Generate a new version", "重新產生一版") : T("Generate", "產生")) : null,
    h("p", { class: "faint rx-note" }, T("Every generation, and every follow-up that changes the output, is kept as a version: pick an older one to compare.", "每次產生、每次追問改了產出，都留一版；點舊版可以對照。")));
}
function stage(r, st) {
  const id = r.card.id, run = liveRun(st), v = shownVersion(id), lastGen = [...st.runs].reverse().find((x) => x.kind === "generate");
  if (run && run.kind === "generate") return progressCard(r, st, run);
  if (!v) return h("div", { class: "rx-empty", "data-x-stage": "", "data-explain-empty": "" },
    lastGen && lastGen.status !== "done" ? h("div", { role: "alert" }, h("b", {}, lastGen.status === "stopped" ? T("Stopped", "已停止") : T("It did not finish", "沒有完成")), h("p", {}, lastGen.stop || lastGen.error || "")) : null,
    h("p", {}, T(`Nothing made with ${skillName(st, st.selected?.id)} yet in this room.`, `這間審查室還沒有用 ${skillName(st, st.selected?.id)} 產生過。`)),
    r.open ? h("button", { type: "button", class: "btn primary", "data-explain-again": "", onclick: () => openConfirm(r, st.selected.id, "generate") }, T("Generate", "產生")) : null);
  const media = v.kind === "video" || v.kind === "image";
  return h("div", { class: "rx-stagein", "data-x-stage": "" },
    // the layer with the output is placed over this slot (it is not part of the page's redraws)
    h("div", { class: "rx-slot", "data-x-slot": `${id}/${v.n}` }),
    h("div", { class: "rx-tools" },
      v.kind === "video" ? h("button", { type: "button", class: "rr-chip", "data-explain-pause": "", onclick: () => pauseAsk(id, v) }, "⏸ ", T("Pause here and ask", "停在這一格問"))
        : h("button", { type: "button", class: `rr-chip${X.boxing === id ? " on" : ""}`, "data-explain-box": "", "aria-pressed": String(X.boxing === id), onclick: () => { X.boxing = X.boxing === id ? null : id; L.key = null; render(); } }, "▭ ", X.boxing === id ? T("Drag over the output… (Esc cancels)", "在產出上拖出一塊…（Esc 取消）") : T("Box a region to ask", "框一塊問")),
      h("span", { class: "rx-tag", "data-explain-isolation": "" }, media ? T("Shown by Studio", "由 Studio 顯示") : T("Isolated frame · no network · cannot read Studio · storage kept by Studio in memory", "隔離框 · 不能連網 · 不能讀 Studio · 儲存由 Studio 代管"))));
}
function progressCard(r, st, run) {
  const id = r.card.id, ms = Date.now() - Date.parse(run.at), rounds = run.rounds.length, prog = run.progress || [];
  return h("div", { class: "rx-gen", "data-x-stage": "", "data-explain-progress": run.n },
    h("div", { class: "rx-gencard" },
      h("h3", {}, T(`${run.skill.name} is making the explanation`, `${run.skill.name} 正在產生說明`)),
      h("div", { class: "faint" }, T(`${fmtMin(ms)} so far · round ${rounds || 1} · it runs in the background: you can leave the room · safety limit ${run.limitMin} min`, `已跑 ${fmtMin(ms)} · 第 ${rounds || 1} 輪 · 在背景跑，可以先離開 · 安全時限 ${run.limitMin} 分鐘`), money(run.cost) ? ` · ${money(run.cost)}` : ""),
      h("ol", { class: "rx-steps" }, prog.length ? prog.slice(-12).map((p, i, a) => h("li", { class: i === a.length - 1 ? "now" : "done" }, h("span", { class: "d" }, i === a.length - 1 ? "●" : "✓"), p.text)) : h("li", { class: "now" }, h("span", { class: "d" }, "●"), T("Starting…", "開始中…"))),
      h("div", { class: "rx-foot" },
        h("button", { type: "button", class: "btn sm", "data-explain-log": "", "aria-expanded": String(X.logOpen.has(id)), onclick: () => { if (X.logOpen.has(id)) X.logOpen.delete(id); else X.logOpen.add(id); refresh(id); } }, T("The skill's live log", "skill 的即時紀錄")),
        h("button", { type: "button", class: "btn sm", "data-explain-stop": "", disabled: X.posting.has(`${id}/stop`) ? true : null, onclick: () => stop(id) }, T("Stop", "停止"))),
      X.logOpen.has(id) ? h("pre", { class: "rx-log", "data-explain-logtext": "" }, (st.log || []).map((l) => `${hhmm(l.ts)} ${l.kind} ${l.text}`).join("\n") || T("(nothing yet)", "（還沒有）")) : null));
}
async function stop(id) { X.posting.add(`${id}/stop`); refresh(id); try { X.st.set(id, await postJ(`${base(id)}/stop`, {})); } catch (e) { X.err.set(id, e.message); } finally { X.posting.delete(`${id}/stop`); load(id); } }

// ---------- the chat: follow-ups, about the whole output or a boxed region ----------
function chat(r, st) {
  const id = r.card.id, v = shownVersion(id), run = liveRun(st), can = r.open && !!v && !run && !r.snapshot;
  const send = async (q, confirm, consent) => { const text = String(q ?? X.draft.get(id) ?? "").trim(); if (!text) return; X.posting.add(`${id}/ask`); X.ask = null; refresh(id);
    const s = X.sel.get(id);
    try { X.st.set(id, await postJ(`${base(id)}/ask`, { question: text, version: v.n, selection: s ? { ...s, version: v.n } : null, ...(confirm ? { confirm, consent: !!consent } : {}) })); X.draft.delete(id); X.sel.delete(id); X.boxing = null;
      const ta = document.querySelector("[data-explain-q]"); if (ta) ta.value = ""; schedule(id); }
    catch (e) { if (e.code === "confirm_required" && e.offer) X.ask = { id, q: text, offer: e.offer }; else X.err.set(id, e.message); }
    finally { X.posting.delete(`${id}/ask`); refresh(id); } };
  X.send = send;
  return h("aside", { class: "rx-chat", "data-x-chat": "" }, msgs(r, st),
    h("div", { class: "rx-ask" },
      h("textarea", { "data-explain-q": "", placeholder: v ? T("Ask about this explanation…", "問這份說明…") : T("Ask once there is an output", "有產出之後才能問"), disabled: can ? null : true, rows: "3",
        oninput: (e) => X.draft.set(id, e.target.value), onkeydown: (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } } }, X.draft.get(id) || ""),
      scope(r, st),
      h("div", { class: "rx-row" }, h("span", { class: "grow" }), h("span", { class: "faint" }, T("skill: ", "skill："), h("b", {}, skillName(st, st.selected?.id))),
        h("button", { type: "button", class: "rr-chip lead", "data-explain-send": "", disabled: can && !X.posting.has(`${id}/ask`) ? null : true, onclick: () => send() }, T("Ask", "問")))));
}
function scope(r, st) {
  const id = r.card.id, s = X.sel.get(id), v = shownVersion(id), quick = [[T("What does this show?", "這塊在說什麼？")], [T("Why is it designed this way?", "為什麼這樣設計？")], [T("What could go wrong here?", "哪裡有風險？")], [T("Draw this in more detail", "畫得更細")]];
  return h("div", { class: "rx-scope", "data-x-scope": "" },
    h("span", { "data-explain-scope": s ? (s.time != null ? "frame" : "region") : "all" }, s ? (s.time != null ? T(`About: the frame at ${ts(s.time)}`, `對象：停在 ${ts(s.time)} 的這一格`) : T(`About: the boxed region${s.headings?.length ? ` (${s.headings.slice(-2).join(" › ")})` : ""}`, `對象：框起來的這塊${s.headings?.length ? `（${s.headings.slice(-2).join(" › ")}）` : ""}`)) : T(`About: the whole output${v ? ` (v${v.n})` : ""}`, `對象：整份產出${v ? `（v${v.n}）` : ""}`)),
    s ? h("button", { type: "button", class: "rr-chip", "data-explain-clear": "", onclick: () => { X.sel.delete(id); refresh(id); } }, "✕") : null,
    s && s.time == null ? h("div", { class: "rx-quick" }, quick.map(([q]) => h("button", { type: "button", class: "rr-chip", "data-explain-quick": "", onclick: () => X.send?.(q) }, q))) : null,
    s?.text ? h("small", { class: "faint rx-seltext", "data-explain-seltext": "" }, `“${s.text.slice(0, 140)}${s.text.length > 140 ? "…" : ""}”`) : null);
}
function msgs(r, st) {
  const id = r.card.id, a = X.ask && X.ask.id === id ? X.ask : null, out = [];
  out.push(h("div", { class: "rx-m sys" }, T("Follow-up: type a question, or box a region of the output first.", "追問：直接打字問，或先在產出上框一塊再問。")));
  for (const run of st.runs) {
    const spent = [run.ended ? fmtMin(Date.parse(run.ended) - Date.parse(run.at)) : null, money(run.cost)].filter(Boolean).join(" · ");
    if (run.kind === "generate") { out.push(h("div", { class: "rx-m sys", "data-explain-run": run.n, "data-status": run.status },
      run.status === "running" ? T(`${run.skill.name}: generating…`, `${run.skill.name}：產生中…`) : run.status === "done" ? T(`${run.skill.name} v${run.version} made · ${spent}`, `${run.skill.name} v${run.version} 完成 · ${spent}`)
        : `${run.skill.name}: ${run.status === "stopped" ? T("stopped", "已停止") : T("failed", "失敗")} — ${run.stop || run.error || ""}${spent ? ` · ${spent}` : ""}`)); continue; }
    const sel = run.selection;
    out.push(h("div", { class: "rx-m me", "data-explain-q-run": run.n }, sel ? h("span", { class: "rx-thumb" }, sel.time != null ? `⏸ ${ts(sel.time)}` : `▭ ${sel.headings?.slice(-1)[0] || T("boxed region", "框選的區域")}`) : null, run.question));
    out.push(h("div", { class: "rx-m ai", "data-explain-answer": run.n, "data-status": run.status },
      run.status === "running" ? [h("span", { class: "faint" }, T("Working on it…", "處理中…")), ...(run.progress || []).slice(-3).map((p) => h("div", { class: "faint" }, `· ${p.text}`)),
        h("div", {}, h("button", { type: "button", class: "btn sm", "data-explain-stop": "", onclick: () => stop(id) }, T("Stop", "停止")))]
      : run.status === "done" ? [...String(run.answer || "").split(/\n{2,}/).map((p) => h("p", {}, p)),
        run.cites?.length ? h("div", { class: "rx-cites" }, run.cites.map((c) => h("span", { class: "rx-cite", "data-explain-cite": "" }, c))) : null,
        run.version ? h("div", { class: "rx-upd", "data-explain-updated": run.version }, T(`↻ The output is now v${run.version}${run.summary ? `: ${run.summary}` : ""}`, `↻ 產出已更新為 v${run.version}${run.summary ? `：${run.summary}` : ""}`)) : null,
        spent ? h("small", { class: "faint" }, spent) : null]
      : h("span", { class: "rr-err" }, `${run.status === "stopped" ? T("Stopped", "已停止") : T("Failed", "失敗")}: ${run.stop || run.error || ""}`)));
  }
  if (a) out.push(h("div", { class: "rx-m ai rx-askconfirm", "data-explain-askconfirm": "" },
    h("p", {}, T(`This follow-up is a paid run on ${a.offer.provider} · ${a.offer.model ?? "default model"} with ${a.offer.skill.name}.`, `這個追問會用 ${a.offer.provider} · ${a.offer.model ?? "預設模型"} 和 ${a.offer.skill.name} 付費執行。`)),
    h("label", {}, h("input", { type: "checkbox", "data-explain-consent": "", onchange: (e) => { if (e.target.checked) X.consent.add(id); else X.consent.delete(id); } }), T(" Ask the next follow-ups here on this plan without confirming each", " 之後在這裡用同樣的設定追問時不用再確認")),
    h("div", { class: "rx-foot" }, h("button", { type: "button", class: "btn sm", onclick: () => { X.ask = null; refresh(id); } }, T("Cancel", "取消")),
      h("button", { type: "button", class: "btn sm primary", "data-explain-askok": "", onclick: () => X.send?.(a.q, a.offer.hash, X.consent.has(id)) }, T("Confirm and ask", "確認並追問")))));
  const err = X.err.get(id); if (err) out.push(h("div", { class: "rx-m sys rr-err", role: "alert" }, err));
  return h("div", { class: "rx-msgs", "data-x-msgs": "" }, out);
}

// ---------- the output's layer: placed over the stage's slot, rebuilt only when the version shown changes ----------
const L = { el: null, key: null, frame: null, video: null, pending: null, on: false };
function layerEl() { if (!L.el) { L.el = h("div", { class: "rx-layer", "data-x-layer": "", hidden: true }); document.body.append(L.el); } return L.el; }
async function capFor(id, v) { const k = `${id}/${v.n}`, had = X.caps.get(k); if (had && had.exp > Date.now()) return had.src;
  const j = await api(`${base(id)}/cap?v=${v.n}`); const src = `${j.base}${v.entry.split("/").map(enc).join("/")}`; X.caps.set(k, { src, exp: Date.now() + 20 * 60_000 }); return src; }
function mount(id, v) {
  const el = layerEl(), key = `${id}/${v.n}/${X.boxing === id ? "box" : ""}`; if (L.key === key) return; const sameOutput = L.key && L.key.split("/").slice(0, 2).join("/") === `${id}/${v.n}`; L.key = key;
  if (!sameOutput) {
    el.replaceChildren(); L.frame = null; L.video = null;
    if (v.kind === "html" || v.kind === "markdown" || v.kind === "text") {
      // allow-scripts only: an opaque origin (no allow-same-origin, no popups, no forms, no top navigation)
      L.frame = h("iframe", { class: "rx-frame", sandbox: "allow-scripts", referrerpolicy: "no-referrer", title: T(`${v.skill.name} v${v.n}`, `${v.skill.name} v${v.n}`), "data-explain-frame": `${v.n}` });
      el.append(L.frame); capFor(id, v).then((src) => { if (L.frame && L.key?.startsWith(`${id}/${v.n}/`)) L.frame.src = src; }).catch((e) => { X.err.set(id, e.message); refresh(id); });
    } else if (v.kind === "video") { L.video = h("video", { class: "rx-media", controls: true, preload: "metadata", src: `${base(id)}/media/${v.n}/${v.entry.split("/").map(enc).join("/")}`, "data-explain-video": "" }); el.append(L.video); }
    else el.append(h("img", { class: "rx-media", alt: v.summary || v.entry, src: `${base(id)}/media/${v.n}/${v.entry.split("/").map(enc).join("/")}`, "data-explain-image": "" }));
  }
  el.querySelector(".rx-over")?.remove();
  if (X.boxing === id) el.append(boxOverlay(id, v));
}
/** drag a rectangle over the output; the frame's helper says what lies there (text only) */
function boxOverlay(id, v) {
  const over = h("div", { class: "rx-over", "data-explain-overlay": "" }), box = h("div", { class: "rx-selbox" }); over.append(box); let from = null;
  over.addEventListener("pointerdown", (e) => { const b = over.getBoundingClientRect(); from = [e.clientX - b.left, e.clientY - b.top]; Object.assign(box.style, { display: "block", left: `${from[0]}px`, top: `${from[1]}px`, width: "0px", height: "0px" }); over.setPointerCapture?.(e.pointerId); });
  over.addEventListener("pointermove", (e) => { if (!from) return; const b = over.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top; Object.assign(box.style, { left: `${Math.min(x, from[0])}px`, top: `${Math.min(y, from[1])}px`, width: `${Math.abs(x - from[0])}px`, height: `${Math.abs(y - from[1])}px` }); });
  over.addEventListener("pointerup", async (e) => { if (!from) return; const b = over.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top, rect = { x: Math.min(x, from[0]), y: Math.min(y, from[1]), w: Math.abs(x - from[0]), h: Math.abs(y - from[1]) }; from = null;
    if (rect.w < 6 || rect.h < 6) return; const got = await readRegion(rect); X.sel.set(id, { rect, ...got }); X.boxing = null; L.key = null; refresh(id); requestAnimationFrame(() => document.querySelector("[data-explain-q]")?.focus()); });
  return over;
}
function readRegion(rect) {
  const f = L.frame; if (!f?.contentWindow) return Promise.resolve({ text: "", headings: [], nodes: [] });
  const nonce = Math.random().toString(36).slice(2);
  return new Promise((res) => {
    const done = (v) => { removeEventListener("message", on); clearTimeout(t); res(v); };
    // only the frame Studio made, answering this very request; what it says is page text, kept as text
    const on = (e) => { const d = e.data; if (e.source !== f.contentWindow || !d || d.type !== "crew-room-selection" || d.id !== nonce) return;
      const words = (a, n, each) => (Array.isArray(a) ? a : []).map((x) => String(x ?? "").slice(0, each)).filter(Boolean).slice(0, n);
      done({ text: String(d.text ?? "").slice(0, 4000), headings: words(d.headings, 8, 160), nodes: words(d.nodes, 40, 80), title: String(d.title ?? "").slice(0, 200) }); };
    const t = setTimeout(() => done({ text: "", headings: [], nodes: [] }), 1500);
    addEventListener("message", on); f.contentWindow.postMessage({ type: "crew-room-select", id: nonce, rect }, "*");
  });
}
function pauseAsk(id, v) { const vid = L.video; if (!vid) return; try { vid.pause(); } catch {} X.sel.set(id, { time: Math.round((vid.currentTime || 0) * 100) / 100, text: "", headings: [], nodes: [] }); refresh(id); requestAnimationFrame(() => document.querySelector("[data-explain-q]")?.focus()); }
function tick() {
  const slot = document.querySelector("[data-x-slot]"), modal = document.querySelector(".rx-modalbg");
  if (!slot) { if (L.el) { L.el.hidden = true; } L.on = false; return; }
  const [id, n] = [slot.dataset.xSlot.split("/").slice(0, -1).join("/"), Number(slot.dataset.xSlot.split("/").at(-1))], v = state(id)?.versions.find((x) => x.n === n);
  if (v) mount(id, v);
  const b = slot.getBoundingClientRect(), el = layerEl();
  Object.assign(el.style, { left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px` }); el.hidden = !!modal || !v;
  requestAnimationFrame(tick);
}
function tickStart() { if (!L.on) { L.on = true; requestAnimationFrame(tick); } }
addEventListener("keydown", (e) => { if (e.key !== "Escape") return; const id = S.route?.name === "room" ? S.route.arg : null; if (!id) return;
  if (X.confirm) { X.confirm = null; render(); e.preventDefault(); } else if (X.pick) { X.pick = null; render(); e.preventDefault(); } else if (X.boxing === id) { X.boxing = null; L.key = null; refresh(id); e.preventDefault(); } }, true);
addEventListener("hashchange", () => { X.boxing = null; X.pick = null; X.confirm = null; const id = S.route?.name === "room" ? S.route.arg : null; if (id) load(id); });

window.crewRoomExplain = { ensure, state, active, picker, view, load, dialogs };
})();
