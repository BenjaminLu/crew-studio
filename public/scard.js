// One Studio card, self-contained (unit intent-merge-card): used by the run view, the
// Inbox and the Board's Needs you (public/board.js, which keeps each card's state across remounts).
//   window.crewCard.mountCard(el, card, { onAnswered, inbox, lang, state })
// It renders the card's sections (with a detail: intent, why, scope, done lines with
// their proof, before/after with the app's captures and the card's links such as Open the app, how, the walk of the diff, door and rollback, the
// reviewer's verdict and follow-ups, gates, cost and time), the intent ticks, the door
// confirmation, a note, the option buttons, and the server's answer or refusal inline.
// A card without a detail renders its sections and its text body. The server decides:
// a button that is not ready says what is missing (and still asks: the answer route enforces it).
// One answer is in flight per card (a second click does nothing); a card already answered with the
// same choice (another tab, a retried request) shows as answered, not refused. opts.state, when given,
// holds the card's ticks, note, door tick, refusal and in-flight answer, so a host that unmounts and
// mounts the card again (the Board's Close / Answer) keeps them.
(() => {
"use strict";
const interviewDrafts = new Map();
const CSS = `
.cc { display: grid; gap: 12px; min-width: 0; }
.cc * { min-width: 0; }
.cc-h { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.cc-h b { font-size: 15px; flex: 1 1 200px; }
.cc-lang { display: inline-flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.cc-lang button { border: 0; background: transparent; color: var(--text-2); font: inherit; font-size: 12px; padding: 3px 9px; cursor: pointer; }
.cc-lang button[aria-pressed="true"] { background: var(--accent-soft); color: var(--accent-text, var(--text)); font-weight: 600; }
.cc-sec { border-top: 1px solid var(--border); padding-top: 10px; display: grid; gap: 6px; }
.cc-sec > h4 { margin: 0; font-size: 12px; letter-spacing: .04em; text-transform: uppercase; color: var(--text-3); }
.cc-sec p, .cc-sec li { margin: 0; line-height: 1.5; overflow-wrap: anywhere; }
.cc-sec ul, .cc-sec ol { margin: 0; padding-left: 20px; display: grid; gap: 4px; }
.cc-quote { border-left: 3px solid var(--accent); padding: 4px 10px; background: var(--surface-2); border-radius: 0 8px 8px 0; font-size: 14px; }
.cc-chip { display: inline-block; font-size: 11px; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--border); color: var(--text-2); margin-right: 4px; white-space: nowrap; }
.cc-chip.ok { border-color: var(--ok); color: var(--ok); }
.cc-chip.bad { border-color: var(--bad); color: var(--bad); }
.cc-chip.warn { border-color: var(--warn); color: var(--warn); }
.cc-untr { font-size: 10.5px; color: var(--warn); border: 1px dashed var(--warn); border-radius: 6px; padding: 0 5px; margin-left: 6px; white-space: nowrap; }
.cc-done { display: grid; gap: 4px; padding: 8px; border: 1px solid var(--border); border-radius: 8px; }
.cc-done.proved { border-color: color-mix(in srgb, var(--ok) 45%, var(--border)); }
.cc-proof { font-size: 12px; color: var(--text-2); display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: baseline; }
.cc-proof a { color: var(--accent); }
.cc-mono, .cc-pre, .cc-diff { font-family: var(--f-mono, ui-monospace, monospace); font-size: 12px; }
.cc .rt-card-body { min-width: 0; max-width: 100%; box-sizing: border-box; overflow-wrap: anywhere; }
.cc-pre { white-space: pre-wrap; background: var(--surface-2); padding: 8px; border-radius: 8px; margin: 0; max-height: 260px; overflow: auto; }
.cc-walk { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.cc-walk > summary { cursor: pointer; padding: 8px; display: grid; gap: 4px; list-style: none; }
.cc-walk > summary::-webkit-details-marker { display: none; }
.cc-walk[open] > summary { border-bottom: 1px solid var(--border); }
.cc-diff { margin: 0; padding: 6px 0; overflow-x: auto; background: var(--surface-2); }
.cc-diff div { padding: 0 8px; white-space: pre; }
.cc-diff .a { background: color-mix(in srgb, var(--ok) 16%, transparent); }
.cc-diff .d { background: color-mix(in srgb, var(--bad) 16%, transparent); }
.cc-caps { display: grid; gap: 12px; }
.cc-cap { margin: 0; display: grid; gap: 6px; }
.cc-cap figcaption { font-weight: 600; font-size: 13px; }
.cc-cap-pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.cc-cap-img { display: grid; gap: 4px; align-content: start; text-decoration: none; color: inherit; }
.cc-cap-img img { width: 100%; height: auto; border: 1px solid var(--border); border-radius: 8px; background: #fff; }
.cc-cap-none { padding: 18px 8px; border: 1px dashed var(--border); border-radius: 8px; text-align: center; }
.cc-cap-diff { margin: 0; font-size: 12.5px; overflow-wrap: anywhere; }
@media (max-width: 560px) { .cc-cap-pair { grid-template-columns: 1fr; } .cc-lang button,.cc-actions .btn { min-height:44px; min-width:44px; } }
.cc-imgs { display: flex; gap: 8px; flex-wrap: wrap; }
.cc-imgs img { max-width: min(100%, 420px); border: 1px solid var(--border); border-radius: 6px; }
.cc-align { background: var(--surface-2); border-radius: 10px; padding: 10px; display: grid; gap: 8px; }
.cc-tick { display: flex; gap: 8px; align-items: flex-start; line-height: 1.45; cursor: pointer; }
.cc-tick input { margin-top: 3px; flex: none; width: 16px; height: 16px; }
.cc-count { font-size: 12px; color: var(--text-2); }
.cc-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.cc-actions [data-ready="false"] { opacity: .55; }
.cc-msg:empty { display: none; }
.cc-msg { font-size: 13px; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--bad); color: var(--bad); }
.cc-msg.ok { border-color: var(--ok); color: var(--ok); }
.cc-kv { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; font-size: 13px; }
.cc-kv dt { color: var(--text-3); }
.cc-kv dd { margin: 0; overflow-wrap: anywhere; }
.cc-meta { display: flex; gap: 8px; flex-wrap: wrap; font-size: 12px; color: var(--text-2); }
`;
function css() { if (document.getElementById("crew-card-css")) return; const s = document.createElement("style"); s.id = "crew-card-css"; s.textContent = CSS; document.head.appendChild(s); }
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) { if (v == null || v === false) continue; if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v); else if (k === "checked" || k === "disabled" || k === "open") e[k] = !!v; else e.setAttribute(k, v === true ? "" : String(v)); }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) e.append(c instanceof Node ? c : String(c));
  return e;
}
async function get(u) { const r = await fetch(u); let j = {}; try { j = await r.json(); } catch {} if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j; }
async function post(u, body) {
  const r = await fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
  let j = {}; try { j = await r.json(); } catch {} if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j;
}
const short = (s) => (s ? String(s).slice(0, 8) : "—");
const fmtUsd = (n) => (n == null ? "—" : `$${n.toFixed(n < 1 ? 3 : 2)}`);

// Shared by acceptance cards and Library version history. Text is rendered as text nodes.
window.crewImageRefinementSnapshot=(snapshot,{lang="en",review=null}={})=>{
 const T=(en,zh)=>lang==="zh-TW"?zh:en,box=h("section",{"data-image-refinement":"1",style:"overflow-wrap:anywhere;min-width:0"},h("h4",{},T("Refinement evidence for this round","本回合修改依據")));
 if(!snapshot||snapshot.schema!==1||!Array.isArray(snapshot.history)||!Array.isArray(snapshot.active)){box.append(h("p",{"data-refinement-not-recorded":"1"},T("Not recorded for this historical round. Current notes cannot establish the original wording.","此歷史回合未記錄快照；目前的標註無法證明當時原話。")));return box;}
 const s=snapshot;
 box.append(h("p",{"data-refinement-round":"1"},review?T(`Acceptance round ${review.round} · attempt ${review.attempt}; `,`驗收第 ${review.round} 回合 · 第 ${review.attempt} 次嘗試； `):"",T(`Image generation round ${s.round} · attempt ${s.attempt}`,`圖片製作第 ${s.round} 回合 · 第 ${s.attempt} 次嘗試`)),h("p",{},T("Original intent: ","原始需求："),s.intent));
 if(s.reference)box.append(h("p",{"data-refinement-reference":s.reference.version},T(`Reference image v${s.reference.version} · SHA `,`參考圖片版本 ${s.reference.version} · SHA `),s.reference.sha256));
 const item=(n,history)=>h("li",{"data-requirement":n.key,"data-requirement-state":n.state,style:"margin:6px 0;white-space:pre-wrap"},h("b",{},`${n.key} · `),history?(n.state==="superseded"?T("Superseded · ","已明確取代 · "):T("Active · ","有效 · ")):"",n.comment,(n.bbox||n.box)?h("div",{},T("Selected region: ","圈選區域："),JSON.stringify(n.bbox||n.box)):null,n.t0!=null?h("div",{},T(`Time ${n.t0}–${n.t1}s`,`時間 ${n.t0}–${n.t1} 秒`)):null);
 box.append(h("h5",{},T("Cumulative active requirements (captain’s words)","累積有效修改要求（船長原話）")),s.active.length?h("ul",{"data-refinement-active":"1"},s.active.map(n=>item(n,false))):h("p",{},T("Initial version; no modification requests yet.","初始版本，尚無修改要求。")),h("details",{"data-refinement-history":"1"},h("summary",{},T("Original annotation history and target versions","原始標註歷程與指定版本")),h("ul",{},s.history.map(n=>item(n,true)))));
 return box;
};

/**
 * Mount one card into `el` (its content is replaced). `card` is a Studio card as /api/scards returns it.
 * opts.onAnswered(card) runs after the server took the answer; opts.inbox adds the run/workflow/node line;
 * opts.lang ("en" | "zh-TW") picks the first language (default: the page's). Returns { el, update(card) }.
 */
function mountCard(el, card, opts = {}) {
  css();
  const fresh = { lang: opts.lang || (document.documentElement.lang === "zh-TW" ? "zh-TW" : "en"), ticks: new Set(), opened: new Set(), confirm: false, note: "", msg: "", ok: false, busy: false };
  const st = opts.state || {}; for (const [k, v] of Object.entries(fresh)) if (!(k in st)) st[k] = v;
  const expectsInterview=card.workflow==='pack-genesis'&&card.node==='interview-answers';const form=card.interview;let draft=null;
  if(form?.schema===1&&/^[a-f0-9]{64}$/.test(form.batchHash)&&/^R-\d+$/.test(card.run)&&/^SC-\d+$/.test(card.id)&&form.visit===card.visit&&Array.isArray(form.questions)&&form.questions.length===6){
    draft=interviewDrafts.get(card.id);if(!draft||draft.hash!==form.batchHash){draft={hash:form.batchHash,revision:form.revision,answers:{...form.answers},dirty:false,timer:null,saving:Promise.resolve()};interviewDrafts.set(card.id,draft);}else if(!draft.dirty&&form.revision>draft.revision){draft.revision=form.revision;draft.answers={...form.answers};}
  }
  let composing = null, pendingRender = false, compositionTimer = null;
  const saveDraft=()=>{if(!draft||composing)return Promise.resolve();clearTimeout(draft.timer);draft.timer=null;draft.saving=draft.saving.catch(()=>{}).then(async()=>{if(composing||!draft.dirty)return;const answers={...draft.answers};const saved=await post(`/api/pack-genesis/${encodeURIComponent(card.run)}/interview-draft`,{schema:1,card:card.id,visit:card.visit,batchHash:draft.hash,revision:draft.revision,answers});draft.revision=saved.revision;draft.dirty=JSON.stringify(draft.answers)!==JSON.stringify(answers);});return draft.saving;};
  const composingField = e => e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement;
  el.addEventListener('compositionstart', e => { if(composingField(e)){ clearTimeout(compositionTimer); composing=e.target; } }, true);
  el.addEventListener('keydown', e => { if(composingField(e)&&(e.isComposing||e.keyCode===229||composing)){ if(e.key==='Enter'||e.keyCode===229)e.stopPropagation(); } }, true);
  el.addEventListener('compositionend', e => { if(e.target!==composing)return;const field=composing;composing=null;compositionTimer=setTimeout(()=>{if(composing)return;if(field.matches('[data-card-note]'))st.note=field.value;else if(draft&&field.dataset.interview){draft.answers[field.dataset.interview]=field.value;draft.dirty=true;}if(pendingRender){pendingRender=false;render();}if(draft&&draft.dirty)saveDraft().catch(error=>{st.msg=error.message;st.draw();});},0); }, true);
  st.card = card; st.draw = () => render(); // the newest mount draws: an answer that settles after a remount shows on the card that is on screen
  const zh = () => st.lang === "zh-TW";
  const T = (en, tw) => (zh() ? tw : en);
  const L = (l) => { if (l == null) return ""; if (typeof l === "string") return l; return zh() ? l["zh-TW"] || l.en || "" : l.en || ""; };
  // a localized line: the zh-TW text, or the English with a mark when the coordinator could not translate it
  const LL = (l) => (zh() && l && l.untranslated ? [l.en, h("span", { class: "cc-untr", "data-untranslated": "" }, "未翻譯")] : L(l));
  const sec = (key, title, ...kids) => h("section", { class: "cc-sec", "data-sec": key }, h("h4", {}, title), ...kids);

  function detailView(d, c) {
    const out = [];
    if(d.remoteTarget){const r=d.remoteTarget;out.push(sec("remote-target",T("Remote merge target","遠端合併目標"),
      h("dl",{class:"cc-kv"},...[["repository",T("Repository / PR","儲存庫 / PR"),`${r.repository} #${r.pr}`],["branch",T("Branch","分支"),r.branch],["head",T("Exact head","確切版本"),r.head],["base",T("Base branch","目標分支"),r.base],["base-head",T("Verified base head","已驗證的目標版本"),r.baseHead],["method",T("Merge method","合併方式"),r.method],["grant",T("Authorization fingerprint","授權指紋"),r.grant]].flatMap(([key,label,value])=>[h("dt",{},label),h("dd",{class:"cc-mono","data-remote-target":key},value)])),
      h("p",{class:"cc-count"},T("This fingerprint identifies the captain-approved repository permissions; it is not a credential.","此指紋識別船長核准的儲存庫權限，不是憑證。"))));}
    out.push(sec("intent", T("Intent (the captain's words)", "意圖（船長的原話）"),
      h("p", { class: "cc-quote", "data-intent-text": "" }, d.intent.en),
      zh() && !d.intent.untranslated && d.intent["zh-TW"] !== d.intent.en ? h("p", { class: "cc-count" }, d.intent["zh-TW"]) : null));
    out.push(sec("why", T("Why", "為什麼"), d.why.length ? h("ul", {}, d.why.map((w) => h("li", {}, LL(w)))) : h("p", { class: "cc-count" }, T("The spec gives no reason.", "spec 沒有寫原因。"))));
    out.push(sec("scope", T("Scope", "範圍"), h("dl", { class: "cc-kv" },
      h("dt", {}, T("In", "範圍內")), h("dd", { class: "cc-mono" }, d.scope.in.join(", ") || "—"),
      h("dt", {}, T("Out", "範圍外")), h("dd", { class: "cc-mono" }, d.scope.out.join(", ") || T("everything else (the scope gate checks it)", "其他一切（由 scope gate 檢查）")))));
    out.push(sec("done", T("Done lines and their proof", "完成條件與證明"), d.done.map((x, i) => h("div", { class: `cc-done ${x.proved ? "proved" : ""}`, "data-done": i },
      h("div", {}, h("span", { class: `cc-chip ${x.proved ? "ok" : "warn"}` }, x.proved ? T("proved", "已證明") : T("needs your eye", "需要你看")), h("b", {}, `${i + 1}. `), LL(x.text)),
      x.proofs.length ? x.proofs.map((p) => h("div", { class: "cc-proof", "data-proof": p.check },
        h("span", { class: `cc-chip ${p.verdict === "pass" ? "ok" : "bad"}` }, p.verdict), h("span", { class: "cc-mono" }, p.check), h("span", { class: "cc-mono" }, `ledger #${p.seq}`), h("span", { class: "cc-mono" }, `@ ${short(p.head)}`),
        p.detail ? h("span", {}, p.detail) : null, p.evidence.map((e) => h("a", { href: e.href, target: "_blank", rel: "noopener", "data-evidence": e.label }, e.label))))
        : h("div", { class: "cc-proof" }, T("No check proves this line.", "沒有檢查證明這一條。"))))));
    out.push(sec("before-after", T("Before and after", "改動前後"), h("p", {}, LL(d.beforeAfter.text)), capturesView(c), linksView(c),
      d.beforeAfter.images.length ? h("div", { class: "cc-imgs" }, d.beforeAfter.images.map((im) => h("figure", { style: "margin:0" }, h("img", { src: im.href, alt: im.label, loading: "lazy" }), h("figcaption", { class: "cc-count" }, im.label)))) : null,
      d.beforeAfter.stat ? h("pre", { class: "cc-pre" }, d.beforeAfter.stat) : null));
    out.push(sec("how", T("How", "怎麼做的"), d.how.length ? d.how.map((x) => h("p", {}, LL(x))) : h("p", { class: "cc-count" }, "—")));
    const intentChip = (n) => h("span", { class: "cc-chip", "data-serves-intent": n }, T(`intent ${n + 1}`, `意圖 ${n + 1}`));
    const doneChip = (n) => h("span", { class: "cc-chip ok", "data-serves-done": n }, T(`done ${n + 1}`, `完成 ${n + 1}`));
    out.push(sec("walk", T("Walk the diff", "逐段看 diff"), h("p", { class: "cc-count" }, T("Each key hunk, and the intent line or done line it serves. Open one to read it.", "每一段重點改動，以及它對應的意圖或完成條件。點開看內容。")),
      d.walk.map((w) => h("details", { class: "cc-walk", "data-walk": w.id, open: st.opened.has(w.id), ontoggle: (e) => { e.target.open ? st.opened.add(w.id) : st.opened.delete(w.id); } },
        h("summary", {}, h("span", { class: "cc-mono" }, `${w.file}:${w.start}`), h("span", {}, L(w.note)), h("span", {}, w.serves.intents.map(intentChip), w.serves.done.map(doneChip),
          !w.serves.intents.length && !w.serves.done.length ? h("span", { class: "cc-chip bad" }, T("serves nothing listed", "沒有對應")) : null)),
        h("div", { class: "cc-diff" }, w.lines.map((l) => h("div", { class: l[0] === "+" ? "a" : l[0] === "-" ? "d" : "" }, l)))))));
    if (d.door) out.push(sec("door", T("Door and rollback", "門與回滾"), h("p", {}, h("span", { class: `cc-chip ${d.door.kind === "one-way" ? "bad" : "ok"}` }, d.door.kind === "one-way" ? T("one-way", "單向門") : d.door.kind === "two-way" ? T("two-way", "雙向門") : d.door.kind || "?"), LL(d.door.reason)),
      h("p", {}, h("b", {}, T("Rollback: ", "回滾：")), LL(d.door.rollback))));
    if (d.review) out.push(sec("review", T("Reviewer verdict and follow-ups", "Reviewer 結論與後續"),
      h("p", {}, d.review.verdicts.map((v) => h("span", { class: `cc-chip ${/approve|pass/i.test(v.verdict) ? "ok" : "bad"}` }, `${v.verdict} · ${v.by}`)),
        d.review.mode ? h("span", { class: "cc-chip", "data-review-mode": d.review.mode }, d.review.mode === "run" ? T("Reviewed in run mode", "以 run 模式審查") : T("Reviewed in diff mode", "以 diff 模式審查")) : null),
      (d.review.notes || []).length ? h("div", { class: "cc-eye", "data-review-eye": "" }, h("b", {}, T("Needs your eye: the review did not cover", "需要你看：審查沒涵蓋")), h("ul", {}, d.review.notes.map((n) => h("li", {}, n)))) : null,
      d.review.followups.length ? h("ol", {}, d.review.followups.map((f) => h("li", { "data-followup": "" }, LL(f)))) : h("p", { class: "cc-count" }, T("No follow-ups.", "沒有後續事項。"))));
    if (d.gates.length) out.push(sec("gates", T("Gates", "Gates"), h("ul", {}, d.gates.map((g) => h("li", {}, h("span", { class: `cc-chip ${g.verdict === "pass" ? "ok" : "bad"}` }, g.verdict), h("b", { class: "cc-mono" }, g.name), " ", g.detail)))));
    if (d.cost) out.push(sec("cost", T("Cost and time", "花費與時間"), h("dl", { class: "cc-kv" },
      h("dt", {}, T("Model cost", "模型費用")), h("dd", {}, fmtUsd(d.cost.usd)),
      h("dt", {}, T("Rounds", "回合數")), h("dd", {}, String(d.cost.rounds)),
      h("dt", {}, T("Time to this card", "到這張卡的時間")), h("dd", {}, d.cost.minutes == null ? "—" : T(`${d.cost.minutes} min`, `${d.cost.minutes} 分鐘`)),
      h("dt", {}, T("Head", "Head")), h("dd", { class: "cc-mono" }, `${short(d.head)} (base ${short(d.base)})`))));
    if (d.writer === "fallback") out.push(h("p", { class: "cc-count", "data-writer": "fallback" }, T("The coordinator did not write this card's translations and walk notes; lines it could not translate are marked.", "協調者沒有寫出這張卡的翻譯和 diff 註解；沒翻譯的行有標記。")));
    return out;
  }
  // the app's before / after captures (a domain check fills card.captures): the two pictures side by side, the
  // visible text that changed under them; the card's links (such as "Open the app") beside them
  function capturesView(c) {
    const caps = Array.isArray(c.captures) ? c.captures : []; if (!caps.length) return null;
    return h("div", { class: "cc-caps", "data-captures": c.id }, caps.map((k) => h("figure", { class: "cc-cap", "data-capture": k.label },
      h("figcaption", {}, k.label),
      h("div", { class: "cc-cap-pair" }, ["before", "after"].map((side) => h(k[side] ? "a" : "div", { class: "cc-cap-img", href: k[side] || null, target: k[side] ? "_blank" : null, rel: k[side] ? "noopener" : null, "data-capture-side": side },
        h("span", { class: "cc-count" }, side === "before" ? T("Before", "改動前") : T("After", "改動後")),
        k[side] ? h("img", { src: k[side], alt: `${k.label}: ${side}`, loading: "lazy" }) : h("span", { class: "cc-count cc-cap-none" }, T("not captured", "沒有截圖"))))),
      k.changed && ((k.changed.removed || []).length || (k.changed.added || []).length)
        ? h("p", { class: "cc-cap-diff", "data-capture-changed": "" }, h("span", { class: "cc-count" }, T("Text that changed: ", "畫面上改變的文字：")), h("s", {}, (k.changed.removed || []).slice(0, 4).join(" · ") || "—"), " → ", h("b", {}, (k.changed.added || []).slice(0, 4).join(" · ") || "—"))
        : h("p", { class: "cc-count" }, T("No visible text changed.", "畫面上的文字沒有改變。")))));
  }
  function linksView(c) {
    const ls = (Array.isArray(c.links) ? c.links : []).filter((l) => l && typeof l.href === "string" && /^(\/|https?:)/.test(l.href)); if (!ls.length) return null;
    return h("div", { class: "cc-actions" }, ls.map((l) => h("a", { class: "btn", href: l.href, target: "_blank", rel: "noopener", "data-card-link": l.label }, l.label === "Open website in new tab"?T("Open website in new tab","在新分頁開啟網站"):l.label === "Open the app" ? T("Open the app", "打開 app") : l.label)));
  }
  function plainView(c) {
    const s = c.sections?.[st.lang] || c.sections?.en; const out = [];
    if (s?.intent) out.push(sec("intent", T("Intent", "意圖"), h("p", { class: "cc-quote" }, s.intent)));
    if (s?.why) out.push(sec("why", T("Why", "為什麼"), h("p", {}, s.why)));
    if (s?.how) out.push(sec("how", T("How", "怎麼做"), h("p", {}, s.how)));
    const caps = capturesView(c), links = linksView(c);
    if (caps || links) out.push(sec("before-after", T("Before and after", "改動前後"), caps, links));
    return out;
  }

  // Only a complete structured detail uses the merge renderer. Unknown legacy
  // metadata remains plain text; reading history must never require a migration.
  const locOk = x => typeof x === "string" || (!!x && typeof x.en === "string");
  const arr = (x, f) => Array.isArray(x) && x.every(f);
  const strings = x => arr(x, y => typeof y === "string");
  function detailOk(d) {
    return !!d && !!d.intent && typeof d.intent.en === "string" && arr(d.intents, locOk) && arr(d.why, locOk) && arr(d.how, locOk)
      && strings(d.scope?.in) && strings(d.scope?.out) && arr(d.done, x => x && locOk(x.text) && typeof x.proved === "boolean" && arr(x.proofs, p => p && typeof p.check === "string" && arr(p.evidence, e => e && typeof e.href === "string" && typeof e.label === "string")))
      && locOk(d.beforeAfter?.text) && arr(d.beforeAfter?.images, x => x && typeof x.href === "string" && typeof x.label === "string")
      && arr(d.walk, w => w && typeof w.file === "string" && strings(w.lines) && locOk(w.note) && arr(w.serves?.intents, Number.isInteger) && arr(w.serves?.done, Number.isInteger))
      && arr(d.gates, g => g && typeof g.name === "string" && typeof g.verdict === "string")
      && (!d.door || (locOk(d.door.reason) && locOk(d.door.rollback)))
      && (!d.review || (arr(d.review.verdicts, v => v && typeof v.by === "string" && typeof v.verdict === "string") && arr(d.review.followups, locOk) && (!d.review.notes || strings(d.review.notes))))
      && (!d.cost || d.cost.usd == null || typeof d.cost.usd === "number");
  }
  function artifactDetailView(d, c) {
    const m = d.artifactAcceptance;
    const offered = arr(m?.offered, r => r && typeof r.id === "string" && Number.isInteger(r.n) && r.n > 0 && typeof r.producer === "string") ? m.offered : [];
    const lines = proved => d.done.filter(x => x.proved === proved).map(x => h("div", { class: "cc-done", "data-artifact-proved": String(proved) },
      h("p", {}, h("span", { class: `cc-chip ${proved ? "ok" : "warn"}` }, proved ? T("proved", "已證明") : T("needs your eye", "需要你看")), LL(x.text)),
      x.proofs.map(p => h("div", { class: "cc-proof" }, h("span", { class: "cc-mono" }, p.check), h("span", {}, `ledger #${p.seq}`)))));
    return [sec("intent", T("Intent (the captain's words)", "意圖（船長的原話）"), h("p", { class: "cc-quote" }, d.intent.en)),
      offered.length ? sec("artifact-versions", T("Versions to review", "待審閱版本"), offered.map(r => h("a", { href: `#/review/${encodeURIComponent(r.id)}/${r.n}`, "data-offered-version": r.n }, r.producer.startsWith("design-") ? T(`Direction ${r.producer.slice(-1).toUpperCase()} · v${r.n}`, `方向 ${r.producer.slice(-1).toUpperCase()} · 版本 ${r.n}`) : T(`Version ${r.n}`, `版本 ${r.n}`)))) : null,
      ...(Array.isArray(m?.refinements)?m.refinements:offered.filter(r=>r.format==="image").map(r=>({snapshot:null}))).map(r=>window.crewImageRefinementSnapshot(r.snapshot,{lang:st.lang,review:m?.review})),
      sec("proved", T("Proved by checks", "由檢查證明"), lines(true).length ? lines(true) : h("p", {}, T("No check proves a condition yet.", "目前尚無完成條件通過檢查。"))),
      sec("needs-eye", T("Needs your eye", "需要你看"), lines(false)), linksView(c)];
  }
  function render() {
    if(composing){pendingRender=true;return;}
    const focused=document.activeElement;const keep=focused&&el.contains(focused)&&focused instanceof HTMLTextAreaElement?{key:focused.hasAttribute('data-card-note')?'data-card-note':focused.hasAttribute('data-interview')?'data-interview':null,value:focused.getAttribute('data-interview'),start:focused.selectionStart,end:focused.selectionEnd,direction:focused.selectionDirection}:null;
    const c = st.card; const d = detailOk(c.detail) ? c.detail : null; const open = c.status === "open";
    const n = d?.intents?.length || 0; const one = c.confirmDoor && c.door === "one-way";
    const hasNote = !expectsInterview && (c.options.some((o) => o.note) || n > 0);
    const missing = (o) => { if (o.hold) return null;if(expectsInterview&&!draft)return T("This interview version is unavailable. Reload the card; no answer was submitted.","這個訪談版本無法使用。請重新載入卡片；尚未送出回答。");if(draft&&form.questions.some(q=>!String(draft.answers[q.key]||" ").trim()))return T("Answer every question below", "請回答下方每個問題"); if (n && st.ticks.size < n && !st.note.trim()) return T(`Tick every intent line (${st.ticks.size} of ${n}) or write a note`, `請勾完每一條意圖（${st.ticks.size}/${n}），或寫備註`);
      if (one && !st.confirm) return T("Confirm the door first", "請先確認門"); return null; };
    const answer = async (o) => {
      if (st.busy || composing) return; // one answer in flight; never submit an unfinished composition
      const why=missing(o);if(expectsInterview&&why){st.msg=why;st.interviewAttempted=true;render();el.querySelector('[aria-invalid="true"]')?.focus();return;}
      st.busy = true; st.msg = ""; render();
      const took = (got) => { st.card = got && got.id ? got : { ...c, status: "answered", answer: { choice: o.id } }; st.ok = true; st.msg = ""; try { opts.onAnswered && opts.onAnswered(st.card); } catch {} };
      try {
        if(draft&&!o.hold)await saveDraft();else if(draft)clearTimeout(draft.timer);
        const note=draft&&!o.hold?JSON.stringify({schema:1,card:c.id,visit:c.visit,batchHash:draft.hash,answers:draft.answers}):st.note.trim()||null;
        took(await post(`/api/scards/${encodeURIComponent(c.id)}/answer`, { choice: o.id, note, confirm: st.confirm ? "one-way" : null, aligned: n ? [...st.ticks].sort((a, b) => a - b) : undefined, ...(o.id === "rescope" && c.localRescope ? {localRescope:c.localRescope} : {}) }));
      } catch (e) {
        // answered already with this very choice: that is the answer, not a refusal
        let same = null; if (/answered exactly once/.test(e.message || "")) { try { const now = await get(`/api/scards/${encodeURIComponent(c.id)}`); if (now?.answer?.choice === o.id) same = now; } catch {} }
        if (same) took(same); else { st.ok = false; const message=e.message || String(e);
          const alignment=/tick every intent line as met \((\d+) of (\d+)\), or write a note/.exec(message);
          st.msg=alignment?T(message,`尚未送出核准：請勾完每一條意圖（${alignment[1]}/${alignment[2]}），或填寫備註說明。`):message;
        }
      }
      st.busy = false; st.draw();
      if(st.msg){const feedback=el.querySelector('[data-card-msg]');feedback?.scrollIntoView({block:'nearest'});feedback?.focus({preventScroll:true});}
    };
    const lang = h("div", { class: "cc-lang", role: "group", "aria-label": "Language" }, [["en", "EN"], ["zh-TW", "繁中"]].map(([k, lab]) =>
      h("button", { type: "button", "data-card-lang": k, "aria-pressed": String(st.lang === k), onclick: () => { st.lang = k; render(); } }, lab)));
    const body = !d && zh() && c.body === c.sections?.en?.why && c.sections?.["zh-TW"]?.why ? c.sections["zh-TW"].why : c.body;
    const kids = [
      h("div", { class: "cc-h rt-card-h" }, h("span", { class: "vbadge" }, c.kind), h("b", {}, L(c.title)), c.door ? h("span", { class: `vbadge door-${c.door}` }, c.door) : null, lang),
      opts.inbox ? h("div", { class: "cardmeta cc-meta", "data-scard-meta": c.id }, h("span", { class: "mono" }, c.id), h("a", { href: `#/run/${encodeURIComponent(c.run)}` }, c.run), h("span", {}, c.workflow), h("span", { class: "badge" }, c.node)) : null,
      ...(d ? (d.artifactAcceptance ? artifactDetailView(d, c) : detailView(d, c)) : plainView(c)),
      body ? (d ? h("details", { class: "cc-sec", open: st.opened.has("#body"), ontoggle: (e) => { e.target.open ? st.opened.add("#body") : st.opened.delete("#body"); } }, h("summary", { class: "cc-count" }, T("Card text", "卡片全文")), h("pre", { class: "cc-pre rt-card-body" }, body)) : h("pre", { class: "cc-pre rt-card-body" }, body)) : null,
    ];
    if (open) {
      if (n) kids.push(h("section", { class: "cc-align", "data-align": c.id },
        h("b", {}, T("Does the change meet each intent line? Tick each one.", "改動有做到每一條意圖嗎？逐條勾選。")),
        d.intents.map((t, i) => h("label", { class: "cc-tick" }, h("input", { type: "checkbox", "data-intent-tick": i, checked: st.ticks.has(i), onchange: (e) => { e.target.checked ? st.ticks.add(i) : st.ticks.delete(i); st.msg=""; render(); } }), h("span", {}, `${i + 1}. `, LL(t)))),
        h("span", { class: "cc-count", "data-tick-count": "" }, d?.artifactAcceptance ? T(`${st.ticks.size} of ${n} ticked. Approval needs every line, or a note that says why not.`, `已勾 ${st.ticks.size}/${n}。核准需要每一條都勾，或寫備註說明原因。`) : T(`${st.ticks.size} of ${n} ticked. A merge needs every line, or a note that says why not.`, `已勾 ${st.ticks.size}/${n}。合併需要每一條都勾，或寫備註說明原因。`))));
      if(expectsInterview&&!draft)kids.push(h("p",{class:"cc-msg",role:"alert"},T("The current interview questions could not be verified. Reload this card before answering.","目前訪談問題尚未驗證。請重新載入這張卡片後再回答。")));
      if(draft)kids.push(h("section",{class:"cc-interview",'data-interview-batch':draft.hash},h("h3",{},T("Answer this interview batch","回答這批訪談問題")),h("p",{class:"cc-count"},T("All six answers are required. Drafts are saved on this Mac; saving a draft does not answer the card.","六題都需要回答。草稿會儲存在這台 Mac；儲存草稿不會回覆卡片。")),form.questions.map((q,i)=>{const invalid=st.interviewAttempted&&!String(draft.answers[q.key]||'').trim(),id=`interview-${c.id}-${q.key}`;return h("div",{class:"cc-interview-field"},h("label",{for:id},`${i+1}. ${T(q.en,q.zh)}`),h("textarea",{id,rows:3,maxLength:500,'data-interview':q.key,'aria-required':'true','aria-invalid':String(!!invalid),'aria-describedby':id+'-error',oninput:e=>{draft.answers[q.key]=e.target.value;draft.dirty=true;clearTimeout(draft.timer);draft.timer=setTimeout(()=>saveDraft().catch(error=>{st.msg=error.message;st.draw();}),250);if(e.target.value.trim()){e.target.setAttribute('aria-invalid','false');const error=el.querySelector('#'+id+'-error');if(error)error.textContent='';}},onblur:()=>saveDraft().catch(error=>{st.msg=error.message;st.draw();})},draft.answers[q.key]||''),h("span",{id:id+'-error',class:'cc-field-error',role:invalid?'alert':null},invalid?T("Please answer this question.","請回答這個問題。"):''));})));
      if (hasNote) kids.push(h("textarea", { class: "input", rows: 2, "data-card-note": c.id, placeholder: T("Note (what to change, or why a line is not met)", "備註（要改什麼，或哪一條沒做到、為什麼）"), "aria-label": T("Note", "備註"),
        oninput: (e) => { const had = !!st.note.trim(); st.note = e.target.value; if (had !== !!st.note.trim()) { const pos = e.target.selectionStart; render(); const t = el.querySelector("[data-card-note]"); if (t) { t.focus(); t.setSelectionRange(pos, pos); } } } }, st.note));
      if (one) kids.push(h("label", { class: "cc-tick rt-row", for: `conf-${c.id}` }, h("input", { type: "checkbox", id: `conf-${c.id}`, "data-confirm-door": c.id, checked: st.confirm, onchange: (e) => { st.confirm = e.target.checked; render(); } }),
        h("span", {}, T("I confirm: this is one-way, a revert will not undo it", "我確認：這是單向門，revert 無法還原"))));
      kids.push(h("div", { class: "cc-actions actions" }, c.options.map((o) => { const why = missing(o);
        return h("button", { class: `btn ${o.primary ? "primary" : ""}`, type: "button", "data-option": o.id, ...(draft&&o.id==="continue"?{"data-save-interview":""}:{}), "data-ready": why ? "false" : "true", title: why || null, disabled: st.busy, onclick: () => answer(o) }, T(o.label, o.labelZh || o.label)); })));
      const hint = c.options.map(missing).find(Boolean);
      if (hint && !st.msg) kids.push(h("p", { class: "cc-count", "data-card-hint": "" }, hint));
    } else if (c.answer) {
      kids.push(h("p", { class: "cc-msg ok", "data-card-answered": c.answer.choice }, T(`Answered: ${c.answer.choice}${c.answer.by ? ` by ${c.answer.by}` : ""}${c.answer.aligned ? ` · ${c.answer.aligned.length} of ${n} intent lines ticked` : ""}${c.answer.note ? ` · note: ${c.answer.note}` : ""}`,
        `已回覆：${c.answer.choice}${c.answer.by ? `（${c.answer.by}）` : ""}${c.answer.aligned ? ` · 意圖勾了 ${c.answer.aligned.length}/${n}` : ""}${c.answer.note ? ` · 備註：${c.answer.note}` : ""}`)));
    }
    kids.push(h("div", { class: "cc-msg", role: "status", "aria-live": "polite", "data-card-msg": "", tabindex: "-1" }, st.msg));
    el.replaceChildren(h("div", { class: "cc", "data-card-root": c.id }, kids));
    if(keep?.key){const field=[...el.querySelectorAll(`[${keep.key}]`)].find(t=>keep.key!=='data-interview'||t.getAttribute(keep.key)===keep.value);if(field){field.focus({preventScroll:true});field.setSelectionRange(keep.start,keep.end,keep.direction);}}
    el.classList.add("rt-card"); el.setAttribute("data-scard", c.id); el.setAttribute("data-card-status", c.status);
  }
  render();
  return { el, update(c) { st.card = c; render(); } };
}
const api = { mountCard };
(typeof globalThis !== "undefined" ? globalThis : window).crewCard = api;
window.mountCard = mountCard;
})();
