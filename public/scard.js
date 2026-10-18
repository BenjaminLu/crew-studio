// One Studio card, self-contained (unit intent-merge-card): used by the run view, the
// Inbox and the Board's Needs you (public/board.js, which keeps each card's state across remounts).
//   window.crewCard.mountCard(el, card, { onAnswered, inbox, lang, state })
// It renders the card's sections (with a detail: intent, why, scope, done lines with
// their proof, before/after with the app's captures and the card's links such as Open the app, how, the walk of the diff, door and rollback, the
// reviewer's verdict and follow-ups, gates, cost and time), the intent ticks, the door
// confirmation, a note box (or a picker) for each option that needs text, the option buttons, and the
// server's answer or refusal inline.
// A card without a detail renders its sections and its text body. The server decides:
// a button that is not ready says what is missing (and still asks: the answer route enforces it).
// One answer is in flight per card (a second click does nothing); a card already answered with the
// same choice (another tab, a retried request) shows as answered, not refused. opts.state, when given,
// holds the card's ticks, note, door tick, refusal and in-flight answer, so a host that unmounts and
// mounts the card again (the Board's Close / Answer) keeps them.
(() => {
"use strict";
const interviewDrafts = new Map();
// Labels are a read-only projection of the pinned offer, including old open cards.
// Never infer producer binding from the acceptance node's name.
function artifactVersionLabel(r, multi, T) {
  return /^design-[a-z]$/.test(r.producer) ? T(`Direction ${r.producer.slice(-1).toUpperCase()} · v${r.n}`, `方向 ${r.producer.slice(-1).toUpperCase()} · 版本 ${r.n}`) : multi ? T(`${r.producer} · v${r.n}`, `${r.producer} · 版本 ${r.n}`) : T(`Version ${r.n}`, `版本 ${r.n}`);
}
function artifactOptionLabel(c, o, T) {
  const offers=c.detail?.artifactAcceptance?.offered;
  const r=Array.isArray(offers)&&offers.length>1&&offers.find(r=>r&&typeof r.producer==="string"&&o.id===`approve-${r.producer}`&&Number.isInteger(r.n)&&r.n>0);
  return r&&!/^design-[a-z]$/.test(r.producer) ? T(`Approve ${r.producer} v${r.n}`, `核准${r.producer} 版本 ${r.n}`) : T(o.label,o.labelZh||o.label);
}
const SCARD_CSS = `
.cc { display: grid; gap: 12px; min-width: 0; }
.cc * { min-width: 0; }
.cc-h { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.cc-note { display: grid; gap: 4px; }
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
.cc-part { border-top: 1px solid var(--border); }
.cc-part:first-child { border-top: 0; }
.cc-part > summary { cursor: pointer; padding: 8px 0; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; font-weight: 600; }
.cc-part > div { display: grid; gap: 8px; padding: 0 0 8px; }
.cc-md { display: grid; gap: 8px; font-size: 14px; line-height: 1.55; overflow-wrap: anywhere; }
.cc-md p { margin: 0; white-space: pre-wrap; }
.cc-md ul, .cc-md ol { margin: 0; padding-left: 22px; display: grid; gap: 3px; }
.cc-md li { white-space: pre-wrap; }
.cc-md li.cc-md-sub { margin-left: 18px; list-style-type: circle; }
.cc-md .cc-md-h { margin: 6px 0 0; font-weight: 650; font-size: 15px; line-height: 1.35; }
.cc-md .cc-md-h[aria-level="5"], .cc-md .cc-md-h[aria-level="6"] { font-size: 14px; }
.cc-md .cc-md-h[aria-level="7"], .cc-md .cc-md-h[aria-level="8"], .cc-md .cc-md-h[aria-level="9"] { font-size: 13.5px; color: var(--text-2); }
.cc-md code { font-family: var(--f-mono, ui-monospace, monospace); font-size: 12.5px; background: var(--surface-2); padding: 0 4px; border-radius: 4px; }
.cc-md blockquote { margin: 0; padding-left: 10px; border-left: 3px solid var(--border); color: var(--text-2); }
.cc-md hr { border: 0; border-top: 1px solid var(--border); margin: 4px 0; width: 100%; }
.cc-md .cc-pre { max-height: none; }
.cc-md-tw { overflow-x: auto; }
.cc-md table { border-collapse: collapse; width: 100%; font-size: 13px; }
.cc-md th, .cc-md td { border: 1px solid var(--border); padding: 4px 6px; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
.cc-md th { background: var(--surface-2); }
.cc-reply { border-left: 3px solid var(--accent, var(--border)); padding-left: 10px; }
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
.cc-sec ol.cc-qs { display: grid; gap: 10px; list-style: none; padding-left: 0; }
.cc-qs li { display: grid; gap: 6px; }
.cc-qchoices { display: flex; flex-wrap: wrap; gap: 6px; }
.cc-sec > [data-spec-clear] { justify-self: start; }
.cc-sec ul.cc-delta { list-style: none; padding-left: 0; gap: 2px; }
.cc-delta li { padding: 2px 6px; border-radius: 4px; overflow-wrap: anywhere; }
.cc-delta li.add { background: color-mix(in srgb, var(--ok) 10%, transparent); }
.cc-delta li.del { background: color-mix(in srgb, var(--bad) 8%, transparent); color: var(--text-2); }
.cc-delta .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.cc-qchoices .btn[aria-pressed="true"] { background: var(--accent-soft); border-color: var(--accent); color: var(--accent-text, var(--text)); }
.cc-dirs { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
.cc-dir { margin: 0; display: grid; gap: 8px; align-content: start; border: 1px solid var(--border); border-radius: 10px; padding: 10px; }
.cc-dir figcaption { font-weight: 600; font-size: 14px; }
.cc-dir-thumb { position: relative; aspect-ratio: 16 / 10; overflow: hidden; border-radius: 6px; border: 1px solid var(--border); background: #fff; }
.cc-dir-thumb iframe { position: absolute; inset: 0 auto auto 0; width: 1280px; height: 800px; border: 0; transform-origin: 0 0; transform: scale(var(--k, .2)); pointer-events: none; }
.cc-dir-none { display: grid; place-items: center; background: var(--surface-2); }
.cc-dir-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.cc-dir-actions .btn { white-space: normal; text-align: center; }
.cc-actions .btn { max-width: 100%; white-space: normal; overflow-wrap: anywhere; text-align: center; } /* "Save all answers · <Task>" wraps inside a phone-wide card instead of pushing the page sideways */
.cc-actions [data-ready="false"] { opacity: .55; }
.cc-msg:empty { display: none; }
.cc-sending:empty { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.cc-msg { font-size: 13px; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--bad); color: var(--bad); }
.cc-msg.ok { border-color: var(--ok); color: var(--ok); }
.cc-kv { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; font-size: 13px; }
.cc-kv dt { color: var(--text-3); }
.cc-table { border-collapse: collapse; font-size: 13px; width: 100%; }
.cc-table th, .cc-table td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--border); white-space: nowrap; }
.cc-table th { color: var(--text-3); font-weight: 600; }
.cc-fail { border: 1px solid var(--bad); border-radius: 10px; padding: 10px; display: grid; gap: 8px; background: color-mix(in srgb, var(--bad) 6%, transparent); }
.cc-fail[data-failure-class="ask"] { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 6%, transparent); }
.cc-fail[data-failure-class="transient"], .cc-fail[data-failure-class="environment"] { border-color: var(--warn); background: color-mix(in srgb, var(--warn) 6%, transparent); }
.cc-fail h4 { margin: 0; font-size: 12px; letter-spacing: .04em; text-transform: uppercase; color: var(--text-3); }
.cc-fail .cc-pre { max-height: 180px; }
.cc-kv dd { margin: 0; overflow-wrap: anywhere; }
.cc-meta { display: flex; gap: 8px; flex-wrap: wrap; font-size: 12px; color: var(--text-2); }
`;
function css() { if (document.getElementById("crew-card-css")) return; const s = document.createElement("style"); s.id = "crew-card-css"; s.textContent = SCARD_CSS; document.head.appendChild(s); }
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) { if (v == null || v === false) continue; if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v); else if (k === "checked" || k === "disabled" || k === "open") e[k] = !!v; else e.setAttribute(k, v === true ? "" : String(v)); }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) e.append(c instanceof Node ? c : String(c));
  return e;
}
// Model-written markdown read as text: headings, bold, inline code, lists, simple tables, quotes and
// paragraphs become elements whose content is text nodes only. No HTML is parsed and no link is made:
// "[x](url)" and bare URLs stay plain text.
function mdInline(s) {
  const out = [], re = /\*\*([^*\n]+?)\*\*|__([^_\n]+?)__|`([^`\n]+)`/g; let i = 0, m;
  while ((m = re.exec(s))) { if (m.index > i) out.push(s.slice(i, m.index)); out.push(m[3] != null ? h("code", {}, m[3]) : h("strong", {}, m[1] ?? m[2])); i = re.lastIndex; }
  if (i < s.length) out.push(s.slice(i)); return out;
}
function mdView(text, attrs = {}, depth = 0) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n"), out = []; let para = [], list = null;
  const flush = () => { if (para.length) out.push(h("p", {}, mdInline(para.join("\n")))); para = []; if (list) out.push(list); list = null; };
  const row = (l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  const sep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l || "");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]; let m;
    if (!l.trim()) { flush(); continue; }
    if (/^\s*```/.test(l)) { flush(); const code = []; for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i]); out.push(h("pre", { class: "cc-pre" }, code.join("\n"))); continue; }
    if ((m = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(l))) { flush(); let ht = m[2].trimEnd(); const hk = ht.replace(/#+$/, ""); if (hk === "" || /\s$/.test(hk)) ht = hk.trimEnd(); out.push(h("p", { class: "cc-md-h", role: "heading", "aria-level": String(m[1].length + 3) }, mdInline(ht))); continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { flush(); out.push(h("hr", {})); continue; }
    if (l.includes("|") && sep(lines[i + 1])) { flush(); const head = row(l), body = []; for (i += 2; i < lines.length && lines[i].includes("|") && lines[i].trim(); i++) body.push(row(lines[i])); i--;
      out.push(h("div", { class: "cc-md-tw" }, h("table", {}, h("thead", {}, h("tr", {}, head.map((c) => h("th", {}, mdInline(c))))), h("tbody", {}, body.map((r) => h("tr", {}, head.map((_, k) => h("td", {}, mdInline(r[k] ?? "")))))))));
      continue; }
    if ((m = /^\s*>\s?(.*)$/.exec(l))) { flush(); const q = [m[1]]; while (i + 1 < lines.length && (m = /^\s*>\s?(.*)$/.exec(lines[i + 1]))) { q.push(m[1]); i++; } out.push(h("blockquote", {}, depth < 3 ? mdView(q.join("\n"), {}, depth + 1) : h("p", {}, q.join("\n")))); continue; }
    const li = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(l);
    if (li) { const tag = li[1] ? "ul" : "ol"; if (para.length || (list && list.tagName.toLowerCase() !== tag)) flush(); if (!list) list = h(tag, li[2] && li[2] !== "1" ? { start: li[2] } : {}); list.append(h("li", /^\s{2,}/.test(l) ? { class: "cc-md-sub" } : {}, mdInline(li[3]))); continue; }
    if (list && /^\s{2,}\S/.test(l)) { list.lastChild.append("\n", ...mdInline(l.trim())); continue; }
    if (list) flush();
    para.push(l);
  }
  flush();
  return h("div", { class: "cc-md", ...attrs }, out);
}
async function get(u) { const r = await fetch(u); let j = {}; try { j = await r.json(); } catch {} if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j; }
async function post(u, body) {
  const r = await fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
  let j = {}; try { j = await r.json(); } catch {} if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { refusal: j.refusal || null }); return j;
}
const short = (s) => (s ? String(s).slice(0, 8) : "—");
const fmtUsd = (n) => (n == null ? "—" : `$${n.toFixed(n < 1 ? 3 : 2)}`);

// Language helpers from i18n.js. A page that loads this file on its own (no i18n.js) still gets English and zh-TW.
const cardI18n = () => window.crewI18n || { pick: (l, en, tw) => (l === "zh-TW" ? tw : en), deep: (l, o) => o?.[l] || o?.en,
  loc: (l, t) => (t == null ? "" : typeof t !== "object" ? String(t) : (l === "zh-TW" ? t["zh-TW"] || t.en : t.en) || ""), cardLangs: () => [["en", "EN"], ["zh-TW", "繁中"]] };
const pageLang = () => (["zh-TW", "zh-CN"].includes(document.documentElement.lang) ? document.documentElement.lang : "en");
let lastCardZh = "zh-TW";

// Shared by acceptance cards and Library version history. Text is rendered as text nodes.
window.crewImageRefinementSnapshot=(snapshot,{lang="en",review=null}={})=>{
 const T=(en,zh,cn)=>cardI18n().pick(lang,en,zh,cn),box=h("section",{"data-image-refinement":"1",style:"overflow-wrap:anywhere;min-width:0"},h("h4",{},T("Refinement evidence for this round","本回合修改依據")));
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
 * opts.lang ("en" | "zh-TW" | "zh-CN") picks the first language (default: the page's). Returns { el, update(card) }.
 */
let mountSeq = 0;
function mountCard(el, card, opts = {}) {
  css();
  const fresh = { lang: opts.lang || pageLang(), ticks: new Set(), opened: new Set(), folds: new Map(), confirm: false, ack: false, note: "", notes: {}, msg: "", ok: false, busy: false };
  const st = opts.state || {}; for (const [k, v] of Object.entries(fresh)) if (!(k in st)) st[k] = v;
  // a reload (a new release, app.js pageDirty) would lose what the captain set on this card and has not sent
  { const key = `scard:${++mountSeq}`, pd = window.pageDirty;
    pd?.provide(key, () => { if (!el.isConnected) { pd.drop(key); return false; } if (st.ok || (st.card || card).status !== "open") return false;
      return st.ticks.size > 0 || st.confirm || st.ack || !!String(st.note || "").trim() || Object.values(st.notes || {}).some((v) => String(v ?? "").trim())
        || Object.keys(st.specAnswers || {}).length > 0 || !!draft?.dirty; }); }
  const expectsInterview=card.workflow==='pack-genesis'&&card.node==='interview-answers';const form=card.interview;let draft=null;
  if(form?.schema===1&&/^[a-f0-9]{64}$/.test(form.batchHash)&&/^R-\d+$/.test(card.run)&&/^SC-\d+$/.test(card.id)&&form.visit===card.visit&&Array.isArray(form.questions)&&form.questions.length===6){
    draft=interviewDrafts.get(card.id);if(!draft||draft.hash!==form.batchHash){draft={hash:form.batchHash,revision:form.revision,answers:{...form.answers},dirty:false,timer:null,saving:Promise.resolve()};interviewDrafts.set(card.id,draft);}else if(!draft.dirty&&form.revision>draft.revision){draft.revision=form.revision;draft.answers={...form.answers};}
  }
  let composing = null, pendingRender = false, compositionTimer = null;
  const saveDraft=()=>{if(!draft||composing)return Promise.resolve();clearTimeout(draft.timer);draft.timer=null;draft.saving=draft.saving.catch(()=>{}).then(async()=>{if(composing||!draft.dirty)return;const answers={...draft.answers};const saved=await post(`/api/pack-genesis/${encodeURIComponent(card.run)}/interview-draft`,{schema:1,card:card.id,visit:card.visit,batchHash:draft.hash,revision:draft.revision,answers});draft.revision=saved.revision;draft.dirty=JSON.stringify(draft.answers)!==JSON.stringify(answers);});return draft.saving;};
  const composingField = e => e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement;
  el.addEventListener('compositionstart', e => { if(composingField(e)){ clearTimeout(compositionTimer); composing=e.target; } }, true);
  el.addEventListener('keydown', e => { if(composingField(e)&&(e.isComposing||e.keyCode===229||composing)){ if(e.key==='Enter'||e.keyCode===229)e.stopPropagation(); } }, true);
  el.addEventListener('compositionend', e => { if(e.target!==composing)return;const field=composing;composing=null;compositionTimer=setTimeout(()=>{if(composing)return;if(field.matches('[data-card-note]')){if(field.dataset.noteFor)st.notes[field.dataset.noteFor]=field.value;else st.note=field.value;}else if(draft&&field.dataset.interview){draft.answers[field.dataset.interview]=field.value;draft.dirty=true;}if(pendingRender){const how=pendingRender;pendingRender=false;how==="sync"?sync():render();}if(draft&&draft.dirty)saveDraft().catch(error=>{st.msg=error.message;st.draw();});},0); }, true);
  // opts.target (the Inbox: the card's Task) goes on its primary button, "Approve <Task> v1", so the captain sees
  // which Task the click answers; a card with no primary option names it on its first option
  const targetLabel = (c, o) => { const label = artifactOptionLabel(c, o, T); const target = String(opts.target || "").trim();
    if (!target || !(o.primary || (!c.options.some((x) => x.primary) && o === c.options[0]))) return label;
    const offers = c.detail?.artifactAcceptance?.offered; const v = Array.isArray(offers) && offers.length === 1 && Number.isInteger(offers[0]?.n) ? ` v${offers[0].n}` : "";
    return `${label} · ${target}${/(\bv|版本 )\d+$/.test(label) ? "" : v}`; }; // "Approve · <Task> v1", "Warm · <Task>"; "Approve design-b v2 · <Task>" names its version already
  st.card = card; st.draw = () => render(); // the newest mount draws: an answer that settles after a remount shows on the card that is on screen
  const zh = () => st.lang !== "en";
  // the card's own language: zh-CN derives from the zh-TW text (i18n.js) unless the card or call carries zh-CN
  const T = (en, tw, cn) => cardI18n().pick(st.lang, en, tw, cn);
  const L = (l) => cardI18n().loc(st.lang, l);
  // a localized line: the Chinese text, or the English with a mark when the coordinator could not translate it
  const LL = (l) => (zh() && l && l.untranslated ? [l.en, h("span", { class: "cc-untr", "data-untranslated": "" }, T("untranslated", "未翻譯"))] : L(l));
  const sec = (key, title, ...kids) => h("section", { class: "cc-sec", "data-sec": key }, h("h4", {}, title), ...kids);

  function detailView(d, c) {
    const out = [];
    if(d.remoteTarget){const r=d.remoteTarget;out.push(sec("remote-target",T("Remote merge target","遠端合併目標"),
      h("dl",{class:"cc-kv"},...[["repository",T("Repository / PR","儲存庫 / PR"),`${r.repository} #${r.pr}`],["branch",T("Branch","分支"),r.branch],["head",T("Exact head","確切版本"),r.head],["base",T("Base branch","目標分支"),r.base],["base-head",T("Verified base head","已驗證的目標版本"),r.baseHead],["method",T("Merge method","合併方式"),r.method],["grant",T("Authorization fingerprint","授權指紋"),r.grant]].flatMap(([key,label,value])=>[h("dt",{},label),h("dd",{class:"cc-mono","data-remote-target":key},value)])),
      h("p",{class:"cc-count"},T("This fingerprint identifies the captain-approved repository permissions; it is not a credential.","此指紋識別船長核准的儲存庫權限，不是憑證。"))));}
    out.push(sec("intent", T("Intent (the captain's words)", "意圖（船長的原話）"),
      h("p", { class: "cc-quote", "data-intent-text": "" }, d.intent.en),
      zh() && !d.intent.untranslated && d.intent["zh-TW"] !== d.intent.en ? h("p", { class: "cc-count" }, L(d.intent)) : null));
    out.push(sec("why", T("Why", "為什麼"), d.why.length ? h("ul", {}, d.why.map((w) => h("li", {}, LL(w)))) : h("p", { class: "cc-count" }, T("The spec gives no reason.", "spec 沒有寫原因。"))));
    out.push(sec("scope", T("Scope", "範圍"), h("dl", { class: "cc-kv" },
      h("dt", {}, T("In", "範圍內")), h("dd", { class: "cc-mono" }, d.scope.in.join(", ") || "—"),
      h("dt", {}, T("Out", "範圍外")), h("dd", { class: "cc-mono" }, d.scope.out.join(", ") || T("everything else (the scope gate checks it)", "其他一切（由 scope gate 檢查）")))));
    if (Array.isArray(d.amendments) && d.amendments.length) out.push(sec("amendments", T("The captain's binding changes (they outrank the done lines)", "船長的修改要求（優先於完成條件）"),
      h("ul", {}, d.amendments.map((m) => h("li", { "data-amendment": m.n }, h("b", {}, `A${m.n}. `), String(m.note ?? ""))))));
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
    // the designer round (src/domain/code-design.ts): not applicable and why, or its verdicts, what it saw, its gate and the last REJECT's findings
    if (d.design) { const g = d.design, last = g.verdicts[g.verdicts.length - 1];
      out.push(sec("design", T("Designer verdict", "設計審查結論"),
        !g.applicable ? h("p", { class: "cc-count", "data-design": "not-applicable" }, T("Not applicable: ", "不適用："), g.reason.replace(/^not applicable: /, ""))
          : h("p", { "data-design": last ? last.verdict : "none" }, g.verdicts.map((v) => h("span", { class: `cc-chip ${/approve/i.test(v.verdict) ? "ok" : "bad"}` }, `${v.verdict} · ${v.by}`)),
            !last ? h("span", { class: "cc-chip bad" }, T("no verdict", "沒有結論")) : null,
            // what it looked at: the pictures, no captures of a declared app (an env gap), or a diff-only review (no app declared)
            h("span", { class: `cc-chip ${g.captures === "seen" ? "" : g.captures === "none-env-gap" ? "bad" : "warn"}`, "data-design-captures": g.captures || "seen", "data-design-seen": g.seen },
              g.captures === "none-env-gap" ? T("no captures", "沒有截圖") : g.captures === "diff-only" ? T("diff-only, no pictures", "只看 diff，沒有截圖") : T(`saw ${g.seen} captures`, `看過 ${g.seen} 張截圖`))),
        g.gate ? h("p", { "data-design-gate": g.gate.verdict }, h("span", { class: `cc-chip ${g.gate.verdict === "pass" ? "ok" : "bad"}` }, g.gate.verdict), h("b", { class: "cc-mono" }, T(" design gate ", " 設計閘門 ")), g.gate.detail) : null,
        g.findings.length ? h("ol", {}, g.findings.map((f) => h("li", { "data-design-finding": "" }, h("b", { class: "cc-mono" }, `${f.page || ""}${f.element ? ` ${f.element}` : ""}`), " ", f.problem, h("div", { class: "cc-count" }, T("Change: ", "修改："), f.change)))) : null,
        g.compare && g.compare.warnings.length ? h("div", { class: "cc-eye", "data-design-compare": g.compare.verdict }, h("b", {}, T("Designer-compare warnings", "設計比對警告")), h("ul", {}, g.compare.warnings.map((w) => h("li", {}, w)))) : null)); }
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
  function linksView(c, shown = new Set()) {
    const same = (a, b) => { try { return decodeURIComponent(a) === decodeURIComponent(b); } catch { return a === b; } }, pinned = c.competition?.artifact?.href;
    const ls = (Array.isArray(c.links) ? c.links : []).filter((l) => l && typeof l.href === "string" && /^(\/|https?:|#\/)/.test(l.href) && !(pinned && same(l.href, pinned)) && !shown.has(l.href)); if (!ls.length) return null;
    const inApp = (href) => href.startsWith("#/");
    return h("div", { class: "cc-actions" }, ls.map((l) => h("a", { class: "btn", href: l.href, target: inApp(l.href) ? null : "_blank", rel: inApp(l.href) ? null : "noopener", "data-card-link": l.label }, l.label === "Open website in new tab"?T("Open website in new tab","在新分頁開啟網站"):l.label === "Open the full text" || l.label === "檢視完整文字紀錄" ? T("Open the full text", "檢視完整文字") : l.label === "Open the app" ? T("Open the app", "打開 app") : l.label)));
  }
  // a typed failure (src/runtime/failures.ts): its class, code, meaning, the exact message, what to fix and where,
  // what changed since it failed, the log link (or why there is none) and, for a Studio bug, the kept diagnostics
  const FCLASS = { ask: ["Question", "提問"], environment: ["Environment", "環境"], scope: ["Scope", "範圍"], transient: ["Transient", "暫時性"], deterministic: ["Deterministic", "確定性"], "invalid-input": ["Invalid input", "輸入無效"], internal: ["Studio bug", "Studio bug"] };
  const waitText = (ms, zhUnits) => ms >= 60000 ? (zhUnits ? `${Math.round(ms / 60000)} 分鐘` : `${Math.round(ms / 60000)} min`) : (zhUnits ? `${Math.round(ms / 1000)} 秒` : `${Math.round(ms / 1000)} s`);
  function failureView(c) {
    const f = c.failure; if (!f || typeof f.class !== "string" || typeof f.message !== "string" || !FCLASS[f.class]) return null;
    const kv = (k, label, v) => v ? [h("dt", {}, label), h("dd", { "data-failure-field": k }, v)] : [];
    const changed = Array.isArray(c.failureChanged) ? c.failureChanged : null;
    const log = f.log || {};
    return h("section", { class: "cc-fail", "data-failure-class": f.class, "data-failure-code": f.code },
      h("div", { class: "cc-h" }, h("span", { class: `cc-chip ${f.class === "ask" ? "" : f.class === "transient" || f.class === "environment" ? "warn" : "bad"}`, "data-failure-chip": f.class }, T(FCLASS[f.class][0], FCLASS[f.class][1])), h("span", { class: "cc-mono" }, f.code)),
      h("p", {}, L(f.meaning)),
      h("h4", {}, f.class === "ask" ? T("The question", "問題") : T("Exact message", "原始訊息")), h("pre", { class: "cc-pre", "data-failure-message": "" }, f.message),
      f.escalation ? h("p", { "data-failure-escalation": "" }, h("b", {}, T("Firstmate's reason: ", "Firstmate 的理由：")), f.escalation.reason || T("Firstmate gave no reason.", "Firstmate 沒有給理由。")) : null,
      (f.fix || f.where) ? h("dl", { class: "cc-kv" }, ...kv("fix", T("Fix", "要修什麼"), f.fix && L(f.fix)), ...kv("where", T("Where", "在哪裡"), f.where && L(f.where))) : null,
      f.retry ? h("p", { class: "cc-count", "data-failure-backoff": f.retry.backoffMs }, T(`Retry ${f.retry.attempt}: waits ${waitText(f.retry.backoffMs, false)} before it runs.`, `第 ${f.retry.attempt} 次重試：執行前先等 ${waitText(f.retry.backoffMs, true)}。`)) : null,
      f.class === "deterministic" && changed ? h("div", { "data-failure-changed": String(changed.length) }, h("h4", {}, T("Changed since the failure", "失敗後改變的輸入")),
        changed.length ? h("ul", {}, changed.map((x) => h("li", { class: "cc-mono" }, `${x.key}: ${x.before ?? "—"} → ${x.now ?? "—"}`))) : h("p", { class: "cc-count" }, T("Nothing changed yet: Retry is refused until an input changes.", "目前沒有任何輸入改變：輸入改變前，重試會被拒絕。"))) : null,
      h("p", { class: "cc-count", "data-failure-log": log.href ? "link" : "none" }, log.href ? h("a", { href: log.href }, T("Open the log", "打開日誌")) : [T("No log link: ", "沒有日誌連結："), L(log.reason) || "—"]),
      f.diagnostics ? h("details", { "data-failure-diagnostics": "" }, h("summary", { class: "cc-count" }, T("Diagnostics (kept with the task)", "診斷資料（和任務一起保留）")), h("pre", { class: "cc-pre" }, JSON.stringify(f.diagnostics, null, 1))) : null);
  }
  // A card's text body, readable: a staffing configuration (JSON) becomes a role table, a dispatch card's
  // parameters become key/value lines; Studio's internal pins (_-prefixed params, hashes) stay in a closed details.
  const raw = (label, text) => h("details", { class: "cc-sec", "data-card-raw": "" }, h("summary", { class: "cc-count" }, label), h("pre", { class: "cc-pre rt-card-body" }, text));
  // a skill named in the table opens Studio's skill viewer at the pinned version (public/skills.js), when the page has it
  const viewSkill = (ref, label, text) => window.crewSkillView ? window.crewSkillView.button(ref, label, { class: "tm-skill-open cc-mono" }, text) : text;
  function staffingView(cfg, body) {
    const roles = Object.entries(cfg.roles), worker = cfg.roles.worker;
    const same = worker ? roles.filter(([id, r]) => id !== "worker" && ["reviewer", "designer"].includes(id) && r.provider === worker.provider && r.model === worker.model).map(([id]) => id) : [];
    return [sec("staffing", T("Role configuration", "角色配置"),
      h("p", { class: "cc-count" }, `${cfg.project?.id ?? ""} · ${cfg.workflow?.id ?? ""} v${cfg.workflow?.version ?? "?"}`),
      h("div", { style: "overflow-x:auto" }, h("table", { class: "cc-table", "data-staffing-table": "" },
        h("thead", {}, h("tr", {}, [T("Role", "角色"), T("Provider", "供應商"), T("Model", "模型"), T("Effort", "推理強度"), T("Skill", "技能")].map((x) => h("th", {}, x)))),
        h("tbody", {}, roles.map(([id, r]) => h("tr", { "data-staffing-role": id }, h("td", {}, id), h("td", {}, r.provider), h("td", { class: "cc-mono" }, r.model), h("td", {}, r.effort ?? T("default", "預設")),
          // a role with several named skills lists each one as its pins name it (the same "name vN" a node's skills show)
          h("td", { class: "cc-mono" }, r.skill?.ref ? (() => { const text = (r.skills || []).length ? r.skills.map((p) => `${String(p.ref).replace(/^(pack|bundled):([^/]+\/)*/, "")} v${p.version}`).join(" + ") : `${r.skill.ref.replace(/^pack:[^/]+\/skills\//, "")} v${r.skill.version}`;
            return cfg.workflow?.id && r.skill.version != null ? viewSkill({ kind: "role", workflow: cfg.workflow.id, role: id, v: r.skill.version, pinned: r.skill.version, name: text }, text, text) : text; })() : "—"))),
          // per-node overrides: what differs from the node's role (an empty cell keeps the role's choice)
          Object.entries(cfg.nodes || {}).map(([id, n]) => h("tr", { "data-staffing-node": id }, h("td", {}, T(`node ${id}`, `節點 ${id}`)), h("td", {}, n.provider || T("role", "依角色")), h("td", { class: "cc-mono" }, n.model || T("role", "依角色")),
            h("td", {}, n.effort === undefined ? T("role", "依角色") : n.effort ?? T("default", "預設")), h("td", { class: "cc-mono" }, (n.skills || []).length ? (n.skills || []).flatMap((p, i) => { const name = String(p.ref).replace(/^skill:/, ""), text = `${name} v${p.version}`;
              return [i ? ", " : null, /^skill:[a-z0-9][a-z0-9-]{0,40}$/.test(String(p.ref)) ? viewSkill({ kind: "lib", id: name, v: p.version, pinned: p.version, name }, name, text) : text]; }) : T("role", "依角色"))))))),
      same.length ? h("p", { class: "cc-msg", "data-staffing-independence": "same" }, T(`Not independent: ${same.join(", ")} uses the same provider and model as the worker, because no other verified configuration is available. Its review is a fresh context, not a second opinion from another model.`,
        `不是獨立審查：${same.join("、")} 和 worker 用同一個供應商與模型，因為目前沒有其他已驗證的配置。它是新的對話脈絡，不是另一個模型的第二意見。`)) : null),
      raw(T("Configuration details (hashes)", "配置細節（雜湊）"), body)];
  }
  // the card shows its intent above, in the captain's words: a paragraph of the body that only repeats it is left out
  const flat = (x) => String(x ?? "").replace(/\s+/g, " ").trim();
  function notIntent(c, text) {
    const said = ["en", "zh-TW"].map((l) => flat(c.sections?.[l]?.intent)).filter(Boolean);
    if (!said.length) return text.trim();
    return text.split(/\n{2,}/).filter((para) => { const f = flat(para); return !f || !said.some((x) => x === f || (f.length >= 12 && x.includes(f))); }).join("\n\n").trim();
  }
  function bodyView(c, body) {
    let cfg = null, up = null; try { const j = JSON.parse(body); cfg = j?.configuration?.roles && typeof j.configuration.roles === "object" ? j.configuration : null; up = j?.upgrade ?? null; } catch {}
    // a workflow update that keeps the crew: what changed from the approved version, open, above the role table
    if (cfg && up) return [sec("staffing-upgrade", T(`Workflow updated: ${up.from} → ${up.to}`, `流程已更新：${up.from} → ${up.to}`),
      h("p", { class: "cc-count" }, T("Same roles, providers, models and efforts. What changed:", "角色、供應商、模型與推理強度都不變。變更如下：")), h("pre", { class: "cc-pre", "data-staffing-upgrade": "" }, String(up.changes ?? ""))), ...staffingView(cfg, body)];
    if (cfg) return staffingView(cfg, body);
    // a dispatch card: "Parameters / 參數:" carries the params, as JSON (older cards) or as "key: value" lines
    const pin = body.lastIndexOf("\n\nInternal pins / 內部鎖定:"), lines = (pin < 0 ? body : body.slice(0, pin)).split("\n"), at = lines.findIndex((l) => l.startsWith("Parameters / 參數:"));
    const pinsView = pin < 0 && at < 0 ? null : raw(T("Studio's internal pins and full text", "Studio 內部鎖定與全文"), body);
    let params = null; const inline = at < 0 ? "" : lines[at].slice("Parameters / 參數:".length).trim(), end = at < 0 ? at : inline ? at + 1 : (() => { let k = at + 1; while (k < lines.length && /^ {2}\S/.test(lines[k])) k++; return k; })();
    if (at >= 0 && /^[—-]?$/.test(inline) && end === at + 1) params = []; // "Parameters / 參數: —": none
    else if (at >= 0 && inline) { try { const j = JSON.parse(inline); if (j && typeof j === "object" && !Array.isArray(j)) params = Object.entries(j).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]); } catch {} }
    else if (at >= 0) params = lines.slice(at + 1, end).map((l) => { const i = l.indexOf(":"); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; });
    if (!params) { const text = notIntent(c, lines.join("\n")); return [text ? h("pre", { class: "cc-pre rt-card-body" }, text) : null, pin < 0 ? null : pinsView]; }
    const shown = params.filter(([k]) => !k.startsWith("_")), rest = notIntent(c, [...lines.slice(0, at), ...lines.slice(end)].join("\n"));
    return [shown.length ? sec("params", T("Parameters", "參數"), h("dl", { class: "cc-kv", "data-card-params": "" }, shown.flatMap(([k, v]) => [h("dt", {}, k), h("dd", { class: "cc-mono" }, v)]))) : null,
      rest ? h("pre", { class: "cc-pre rt-card-body" }, rest) : null, pinsView];
  }
  // a spec card carries its spec as data (cards.ts CardSpec): the scope, what it reads to verify, its open questions
  const specCard = (c) => c.kind === "dispatch" && !!c.spec && Array.isArray(c.spec.questions) && Array.isArray(c.spec.scope);
  // the answers to the spec's open questions become one block of the "Adjust the scope" note, between two marker lines:
  // the captain's own text before and after the block stays as written; only the block is replaced (or removed)
  const ANSWERS = "Scope answers / 範圍問題的回答:", ANSWERS_END = "(end of scope answers / 範圍回答結束)";
  const answeredCount = (c) => specCard(c) ? c.spec.questions.filter((_, i) => String(st.specAnswers?.[i] ?? "").trim()).length : 0;
  function answersNote(c) {
    const qs = c.spec.questions, a = st.specAnswers || {};
    const lines = qs.map((q, i) => String(a[i] ?? "").trim() ? `${i + 1}. ${q.q} → ${String(a[i]).trim()}` : null).filter(Boolean);
    const note = String(st.notes.rescope || ""), at = note.indexOf(ANSWERS), end = at < 0 ? -1 : note.indexOf(ANSWERS_END, at);
    const before = (at < 0 ? note : note.slice(0, at)).trim(), after = at < 0 ? "" : end < 0 ? "" : note.slice(end + ANSWERS_END.length).trim();
    return [before, lines.length ? `${ANSWERS}\n${lines.join("\n")}\n${ANSWERS_END}` : "", after].filter(Boolean).join("\n\n");
  }
  // the question block follows an answer in place (like sync): the pressed choice keeps the focus, the note box, the
  // count line and the clear control update, then sync() updates the buttons and the hint
  function specSync(c) {
    const root = el.querySelector(`[data-card-root="${CSS.escape(c.id)}"]`); if (!root) return;
    const box = root.querySelector('[data-note-for="rescope"]'); if (box && box.value !== (st.notes.rescope || "")) box.value = st.notes.rescope || "";
    for (const li of root.querySelectorAll("[data-spec-question]")) { const i = Number(li.dataset.specQuestion), v = st.specAnswers?.[i] ?? "";
      for (const b of li.querySelectorAll("[data-spec-choice]")) b.setAttribute("aria-pressed", String(b.dataset.specChoice === v));
      const input = li.querySelector("[data-spec-answer]"); if (input && document.activeElement !== input) input.value = c.spec.questions[i].choices.includes(v) ? "" : v; }
    const n = answeredCount(c), state = root.querySelector("[data-spec-questions-state]");
    if (state) { state.dataset.specQuestionsState = n ? "answered" : "open"; state.textContent = questionsLine(c, n); }
    const clear = root.querySelector("[data-spec-clear]"); if (clear) clear.hidden = !n;
  }
  const questionsLine = (c, n) => n
    ? T(`${n} of ${c.spec.questions.length} answered: the answers are in "Adjust the scope" below; choose it and the spec is rewritten with them. Unanswered ones stay out of scope.`, `已回答 ${n}/${c.spec.questions.length}：回答已放進下方「調整範圍」；選它就會照回答重寫規格。沒回答的不在範圍內。`)
    : T("Unanswered, these stay out of scope: approving the spec builds without them. Answer one to adjust the scope instead.", "沒回答的問題不在範圍內：核准規格就照不含它們的範圍做。要納入，就回答它再調整範圍。");
  function setAnswer(c, i, v) {
    const box = el.querySelector('[data-note-for="rescope"]'); if (box) st.notes.rescope = box.value; // what the captain typed there stays
    st.specAnswers = st.specAnswers || {}; st.specAnswers[i] = v; st.notes.rescope = answersNote(c); st.msg = ""; specSync(c); sync();
  }
  function clearAnswers(c) {
    const box = el.querySelector('[data-note-for="rescope"]'); if (box) st.notes.rescope = box.value;
    st.specAnswers = {}; st.notes.rescope = answersNote(c); st.msg = ""; specSync(c); sync();
    el.querySelector("[data-spec-question] [data-spec-choice], [data-spec-question] [data-spec-answer]")?.focus();
  }
  // a spec raised again: what changed since the last spec card, line by line (+ added, − removed)
  function changedView(ch) {
    const part = (key, en, zh) => { const d = ch[key] || { added: [], removed: [] }; if (!d.added?.length && !d.removed?.length) return null;
      return h("div", { "data-spec-changed": key }, h("b", {}, T(en, zh)), h("ul", { class: "cc-delta" }, (d.added || []).map((x) => h("li", { class: "add" }, h("span", { "aria-hidden": "true" }, "+ "), h("span", { class: "sr" }, T("Added: ", "新增：")), x)),
        (d.removed || []).map((x) => h("li", { class: "del" }, h("span", { "aria-hidden": "true" }, "− "), h("span", { class: "sr" }, T("Removed: ", "移除：")), h("s", {}, x))))); };
    const parts = [part("done", "Done lines", "完成條件"), part("scope", "Scope", "範圍"), part("verification", "Reads to verify", "只讀來驗證")].filter(Boolean);
    return sec("spec-changed", ch.approved ? T(`What changed since the spec you approved (v${ch.since})`, `和你核准的規格（v${ch.since}）相比改了什麼`) : T(`What changed since the last spec (v${ch.since})`, `和上一版規格（v${ch.since}）相比改了什麼`),
      parts.length ? parts : h("p", { class: "cc-count", "data-spec-changed": "none" }, T("Done lines, scope and verification are the same; only the wording changed.", "完成條件、範圍和驗證都一樣；只有文字改了。")));
  }
  function specView(c) {
    const sp = c.spec, out = [], open = c.status === "open";
    if (sp.scope.length || sp.verification.length) out.push(sec("spec-scope", T("Scope", "範圍"),
      sp.scope.length ? h("p", {}, h("span", { class: "cc-count" }, T("Changes: ", "會改：")), h("span", { class: "cc-mono" }, sp.scope.join(", "))) : null,
      sp.verification.length ? h("p", {}, h("span", { class: "cc-count" }, T("Reads to verify (no changes): ", "只讀來驗證（不改）：")), h("span", { class: "cc-mono" }, sp.verification.join(", "))) : null));
    if (!sp.questions.length) return out;
    st.specAnswers = st.specAnswers || {};
    out.push(sec("questions", T("Open scope questions", "範圍上的問題"), h("ol", { class: "cc-qs", "data-spec-questions": "" }, sp.questions.map((q, i) => h("li", { "data-spec-question": i },
      h("p", {}, `${i + 1}. ${q.q}`),
      open && q.choices.length ? h("div", { class: "cc-qchoices", role: "group", "aria-label": q.q }, q.choices.map((ch) => h("button", { type: "button", class: "btn sm", "data-spec-choice": ch, "aria-pressed": String(st.specAnswers[i] === ch), onclick: () => setAnswer(c, i, st.specAnswers[i] === ch ? "" : ch) }, ch))) : null,
      open ? h("input", { class: "input", type: "text", "data-spec-answer": i, value: q.choices.includes(st.specAnswers[i]) ? "" : st.specAnswers[i] || "", placeholder: q.choices.length ? T("Or write your own answer", "或寫你自己的回答") : T("Your answer", "你的回答"), "aria-label": `${i + 1}. ${q.q}`,
        oninput: (e) => setAnswer(c, i, e.target.value) }) : null))),
      h("p", { class: "cc-count", "data-spec-questions-state": answeredCount(c) ? "answered" : "open" }, questionsLine(c, answeredCount(c))),
      open ? h("button", { type: "button", class: "btn sm ghost", "data-spec-clear": "", hidden: !answeredCount(c), onclick: () => clearAnswers(c) }, T("Clear the answers", "清除回答")) : null));
    return out;
  }
  function plainView(c) {
    const s = cardI18n().deep(st.lang, c.sections); const out = [];
    // a spec card (code-firstmate's dispatch): what the captain approves is the done lines, so they come first
    if (specCard(c) && c.spec.changed) out.push(changedView(c.spec.changed));
    if (c.kind === "dispatch" && c.node === "dispatch" && Array.isArray(s?.done) && s.done.length && c.workflow !== "firstmate-proposal")
      out.push(sec("done", T("Done when", "完成條件"), h("ol", { "data-spec-done": "" }, s.done.map((x) => h("li", {}, x)))));
    if (s?.intent) out.push(sec("intent", T("Intent", "意圖"), h("p", { class: "cc-quote" }, s.intent)));
    if (s?.why) out.push(sec("why", T("Why", "為什麼"), h("p", {}, s.why)));
    if (s?.how) out.push(sec("how", T("How", "怎麼做"), h("p", {}, s.how)));
    if (specCard(c)) out.push(...specView(c));
    const caps = capturesView(c), links = linksView(c), ba = typeof s?.beforeAfter === "string" && s.beforeAfter.trim() ? h("p", { "data-before-after": "" }, s.beforeAfter) : null;
    if (caps || links || ba) out.push(sec("before-after", T("Before and after", "改動前後"), ba, caps, links));
    return out;
  }

  // the startup competition: a notice when its signed ledger does not verify; otherwise one collapsible
  // round each (the last one open), and inside it the proposal and the critique each collapsible
  // (the last round's proposal open), model text rendered as markdown made of text nodes only
  // "Open this pull request?": where it goes and the exact title and body, the body rendered as markdown made of text nodes
  function pullRequestView(c) {
    const p = c.pullRequest; if (!p) return null;
    return sec("pull-request", T("The pull request, exactly as it will open", "Pull request（開出去的樣子）"),
      h("p", { "data-pr-target": "" }, h("code", {}, p.repository), " · ", h("code", {}, p.branch), " → ", h("code", {}, p.base), " · ", h("code", { "data-pr-head": "" }, String(p.head).slice(0, 8)), " · ", p.draft ? T("draft", "草稿") : T("ready for review", "可審查")),
      h("h3", { "data-pr-title": "" }, p.title),
      h("div", { class: "cc-md", "data-pr-body": "" }, mdView(p.body)),
      p.proven?.length ? h("ul", { "data-pr-proofs": "" }, p.proven.map((t) => h("li", {}, `☑ ${t}`, p.proofs?.[t] ? h("span", { class: "faint" }, ` — ${p.proofs[t]}`) : null))) : null,
      p.unproven?.length ? h("p", { class: "cc-count", "data-pr-unproven": "" }, T(`Left unchecked (no evidence): ${p.unproven.join("; ")}`, `未勾選（沒有證據）：${p.unproven.join("；")}`)) : null);
  }
  function competitionView(c) {
    const m = c.competition; if (!m) return null;
    if (m.untrusted) return sec("competition", T("The competition, round by round", "比賽全文（逐輪）"),
      h("p", { class: "cc-msg", role: "alert", "data-competition-untrusted": "" }, T("Ledger did not verify — the rounds cannot be shown.", "帳本驗證失敗——無法顯示各輪內容。")));
    if (m.schema !== 1 || !Array.isArray(m.rounds)) return null;
    const who = (x) => h("span", { class: "cc-chip", style: "font-weight:400" }, `${x.provider} · ${x.model}`);
    const last = m.rounds.at(-1)?.round;
    const fold = (key, dflt, attrs, summary, ...kids) => h("details", { ...attrs, open: st.folds.has(key) ? st.folds.get(key) : dflt, ontoggle: (e) => { st.folds.set(key, e.target.open); } }, h("summary", {}, summary), ...kids);
    const verdict = (j, mark) => h("span", { class: `cc-chip ${j.verdict === "ready" ? "ok" : "warn"}`, "data-round-verdict": mark ? j.verdict ?? "" : null, style: "font-weight:400" }, T(`score ${j.score ?? "—"} · ${j.verdict ?? "—"}`, `評分 ${j.score ?? "—"} · 判定 ${j.verdict ?? "—"}`));
    return sec("competition", T("The competition, round by round", "比賽全文（逐輪）"),
      m.rounds.length ? m.rounds.map((r) => fold(`round-${r.round}`, r.round === last, { class: "cc-walk", "data-competition-round": r.round },
        [h("b", {}, T(`Round ${r.round}`, `第 ${r.round} 輪`)), r.judge ? h("span", {}, verdict(r.judge, true)) : h("span", { class: "cc-chip bad" }, T("no critique", "沒有評審"))],
        h("div", { style: "padding:0 10px" },
          r.founder ? fold(`founder-${r.round}`, r.round === last, { class: "cc-part", "data-round-founder": r.round }, [T("Proposal", "提案"), who(r.founder)],
            h("div", {}, r.founder.revision ? h("div", { class: "cc-reply", "data-round-revision": r.round }, h("b", {}, T("Response to the critique", "回應上輪銳評")), mdView(r.founder.revision)) : null, mdView(r.founder.text, { "data-round-proposal": r.round })))
            : h("p", { class: "cc-count" }, T("No proposal recorded.", "沒有提案紀錄。")),
          r.judge ? fold(`judge-${r.round}`, false, { class: "cc-part", "data-round-judge": r.round }, [T("Critique", "銳評"), who(r.judge), verdict(r.judge)], h("div", {}, mdView(r.judge.text, { "data-round-critique": r.round }))) : null)))
        : h("p", { class: "cc-msg" }, T("No signed round was recorded.", "沒有已簽署的回合紀錄。")),
      m.artifact ? h("p", { "data-competition-artifact": m.artifact.id }, h("a", { class: "btn", href: m.artifact.href }, T(`Open the full text · ${m.artifact.id} v${m.artifact.version}`, `檢視完整文字 · ${m.artifact.id} v${m.artifact.version}`)), " ", h("span", { class: `cc-chip ${m.artifact.intact ? "ok" : "bad"}` }, m.artifact.intact ? T("pinned, bytes match", "已釘選，內容相符") : T("pinned file changed or missing", "釘選的檔案已變更或遺失"))) : h("p", { class: "cc-msg" }, T("No artifact was pinned.", "沒有釘選產物。")));
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
  // two or more website directions side by side: each its label, a still thumbnail (scripts off), its interactive
  // preview, the website in a new tab, and the approve button for that direction (the card's own option, so its
  // ticks and note rules apply). The card's links these tiles already carry are not repeated under them.
  // the options a web A/B card shows on its direction tiles instead of in the options row
  const directionOptions = (c, d) => { const off = d?.artifactAcceptance?.offered; return Array.isArray(off) && off.length > 1 && off.every((r) => r && r.format === "web") ? off.map((r) => `approve-${r.producer}`).filter((id) => c.options.some((o) => o.id === id)) : []; };
  function directionsView(c, offered, shown) {
    const links = Array.isArray(c.links) ? c.links.filter((l) => l && typeof l.href === "string") : [];
    const sites = links.filter((l) => l.label === "Open website in new tab" && /^\//.test(l.href));
    // a link names the version it opens (for: "<artifact>@<n>"); an older card's links are in offer order, one per version
    const site = (r, i) => sites.find((l) => l.for === `${r.id}@${r.n}`)?.href ?? (!sites.some((l) => l.for) && sites.length === offered.length ? sites[i].href : null);
    return sec("artifact-versions", T("Directions to choose from", "可選的方向"), h("div", { class: "cc-dirs", "data-directions": "" }, offered.map((r, i) => {
      const href = site(r, i), own = `#/review/${encodeURIComponent(r.id)}/${r.n}`, review = links.find((l) => l.href === `/${own}`)?.href ?? own, opt = c.options.find((o) => o.id === `approve-${r.producer}`);
      if (href) shown.add(href);
      for (const l of links) if (l.for === `${r.id}@${r.n}` || l.href === review) shown.add(l.href);
      const thumb = href ? h("div", { class: "cc-dir-thumb", "aria-hidden": "true" }, h("iframe", { src: href, sandbox: "", tabindex: "-1", loading: "lazy", title: "" })) : h("div", { class: "cc-dir-thumb cc-dir-none" }, h("span", { class: "cc-count" }, T("No preview", "沒有預覽")));
      if (href && typeof ResizeObserver === "function") new ResizeObserver(() => thumb.style.setProperty("--k", String((thumb.clientWidth || 256) / 1280))).observe(thumb);
      return h("figure", { class: "cc-dir", "data-direction": r.producer },
        h("figcaption", {}, h("a", { href: review, "data-offered-version": r.n }, artifactVersionLabel(r, true, T))), thumb,
        h("div", { class: "cc-dir-actions" },
          href ? h("button", { class: "btn", type: "button", "data-direction-preview": r.producer, onclick: (e) => window.crewInteractivePreview ? window.crewInteractivePreview(href, e.currentTarget) : (location.hash = own) }, T("Interactive preview", "互動預覽")) : h("a", { class: "btn", href: review, "data-direction-preview": r.producer }, T("Review", "審閱")),
          href ? h("a", { class: "btn", href, target: "_blank", rel: "noopener", "data-direction-open": r.producer }, T("Open in new tab", "新分頁開啟")) : null,
          // this direction's approve is the card's own option, here only (the buttons below leave it out); sync() keeps its readiness
          opt && c.status === "open" ? (() => { const why = needs().missing(opt); return h("button", { class: "btn primary", type: "button", "data-option": opt.id, "data-direction-approve": r.producer, "data-ready": why ? "false" : "true", title: why || null, disabled: st.busy, onclick: () => answer(opt) }, artifactOptionLabel(c, opt, T)); })() : null));
    })));
  }
  function artifactDetailView(d, c) {
    const m = d.artifactAcceptance;
    const offered = arr(m?.offered, r => r && typeof r.id === "string" && Number.isInteger(r.n) && r.n > 0 && typeof r.producer === "string") ? m.offered : [];
    const lines = proved => d.done.filter(x => x.proved === proved).map(x => h("div", { class: "cc-done", "data-artifact-proved": String(proved) },
      h("p", {}, h("span", { class: `cc-chip ${proved ? "ok" : "warn"}` }, proved ? T("proved", "已證明") : T("needs your eye", "需要你看")), LL(x.text)),
      x.proofs.map(p => h("div", { class: "cc-proof" }, h("span", { class: "cc-mono" }, p.check), h("span", {}, `ledger #${p.seq}`)))));
    const shown = new Set(), web = offered.length > 1 && offered.every((r) => r.format === "web");
    return [sec("intent", T("Intent (the captain's words)", "意圖（船長的原話）"), h("p", { class: "cc-quote" }, d.intent.en)),
      web ? directionsView(c, offered, shown) : offered.length ? sec("artifact-versions", T("Versions to review", "待審閱版本"), offered.map(r => h("a", { href: `#/review/${encodeURIComponent(r.id)}/${r.n}`, "data-offered-version": r.n }, artifactVersionLabel(r, offered.length > 1, T)))) : null,
      ...(Array.isArray(m?.refinements)?m.refinements:offered.filter(r=>r.format==="image").map(r=>({snapshot:null}))).map(r=>window.crewImageRefinementSnapshot(r.snapshot,{lang:st.lang,review:m?.review})),
      sec("proved", T("Proved by checks", "由檢查證明"), lines(true).length ? lines(true) : h("p", {}, T("No check proves a condition yet.", "目前尚無完成條件通過檢查。"))),
      sec("needs-eye", T("Needs your eye", "需要你看"), lines(false)), linksView(c, shown)];
  }
  // what the card's buttons need, from the card and the captain's ticks and notes (no DOM): render, sync and answer share it
  function needs() {
    const c = st.card; const d = detailOk(c.detail) ? c.detail : null; const open = c.status === "open";
    const n = d?.intents?.length || 0; const one = c.confirmDoor && c.door === "one-way";
    // an acknowledgement the captain ticks for one option (the observed-policy merge): its id goes with that answer only
    const ackOk = !!(c.acknowledge && typeof c.acknowledge.id === "string" && typeof c.acknowledge.en === "string" && c.options.some((o) => o.id === c.acknowledge.option));
    // every option that needs text has its own note box (labelled with what to write) or a picker; the shared box is the intent-alignment note
    const noteOpts = expectsInterview ? [] : c.options.filter((o) => o.note || (Array.isArray(o.select) && o.select.length));
    const hasNote = !expectsInterview && n > 0;
    const noteLabel = (o) => o.noteLabel ? T(o.noteLabel, o.noteLabelZh || o.noteLabel) : o.select?.length ? T("Pick one", "請選一個") : T("What to change", "要改什麼");
    const noteOf = (o) => String(((o.note || o.select?.length) && st.notes[o.id]) || st.note || "").trim();
    // why option o cannot be sent yet, and the field the captain fills to fix it (null when it can be sent)
    const lack = (o) => { const why = (text, field) => ({ text, field }); if (!expectsInterview && (o.note || o.select?.length) && !noteOf(o)) return why(T(`${o.label}: ${o.noteLabel || (o.select?.length ? "pick one first" : "write it first")}`, `${o.labelZh || o.label}：${o.noteLabelZh || o.noteLabel || (o.select?.length ? "請先選一個" : "請先寫下來")}`), `[data-note-for="${CSS.escape(o.id)}"],[data-card-pick="${CSS.escape(o.id)}"]`);
      if (o.hold) return null;if(expectsInterview&&!draft)return why(T("This interview version is unavailable. Reload the card; no answer was submitted.","這個訪談版本無法使用。請重新載入卡片；尚未送出回答。"));if(draft&&form.questions.some(q=>!String(draft.answers[q.key]||" ").trim()))return why(T("Answer every question below", "請回答下方每個問題"),'[data-interview][aria-invalid="true"]'); if (n && st.ticks.size < n && !st.note.trim()) return why(T(`Tick every intent line (${st.ticks.size} of ${n}) or write a note`, `請勾完每一條意圖（${st.ticks.size}/${n}），或寫備註`), "[data-intent-tick]:not(:checked)");
      // answers on a spec card go with "Adjust the scope": approving the unchanged spec would drop them without a word
      if (o.id === "dispatch" && answeredCount(c)) { const k = answeredCount(c); return why(T(`You answered ${k} question${k === 1 ? "" : "s"}: press "Adjust the scope" so the spec takes your answers, or clear the answers and then approve.`, `你回答了 ${k} 題：按「調整範圍」讓規格帶入回答；或清除回答後再核准`), null); }
      if (one && !st.confirm) return why(T("Confirm the door first", "請先確認門"), "[data-confirm-door]");
      if (ackOk && c.acknowledge.option === o.id && !st.ack) return why(T("Tick the acknowledgement first", "請先勾選確認"), "[data-acknowledge]"); return null; };
    const missing = (o) => lack(o)?.text || null;
    const tickCount = () => d?.artifactAcceptance ? T(`${st.ticks.size} of ${n} ticked. Approval needs every line, or a note that says why not.`, `已勾 ${st.ticks.size}/${n}。核准需要每一條都勾，或寫備註說明原因。`) : T(`${st.ticks.size} of ${n} ticked. A merge needs every line, or a note that says why not.`, `已勾 ${st.ticks.size}/${n}。合併需要每一條都勾，或寫備註說明原因。`);
    return { c, d, open, n, one, ackOk, noteOpts, hasNote, noteLabel, noteOf, lack, missing, tickCount };
  }
  // Typing a note, ticking a line and confirming the door update the card in place: the fields and buttons the captain is
  // using stay the same elements. A rebuild here replaced every button under the captain's hand (a press that spans it
  // ends on a new element and makes no click) and left a reference held to the old button acting on nothing, so a
  // click went nowhere and said nothing.
  function sync() {
    if (composing) { if (!pendingRender) pendingRender = "sync"; return; } // a rebuild asked for meanwhile still wins
    const root = el.querySelector("[data-card-root]"); if (!root || root.getAttribute("data-card-root") !== st.card.id) return render();
    const { c, missing, tickCount } = needs();
    for (const b of root.querySelectorAll(".cc-actions [data-option], [data-direction-approve]")) { const o = c.options.find((x) => x.id === b.dataset.option); const why = o ? missing(o) : null;
      b.dataset.ready = why ? "false" : "true"; if (why) b.title = why; else b.removeAttribute("title"); }
    const count = root.querySelector("[data-tick-count]"); if (count) count.textContent = tickCount();
    const hint = root.querySelector("[data-card-hint]"); if (hint) { hint.textContent = st.msg ? "" : c.options.map(missing).find(Boolean) || ""; hint.hidden = !hint.textContent; }
    const msg = root.querySelector("[data-card-msg]"); if (msg) msg.textContent = st.msg;
    if (specCard(c)) specSync(c);
  }
  // One answer, for this card only: the note is read from this card's own fields when the button is pressed (what the
  // captain sees in the box is what is sent, even a value put there without an input event), and a click that cannot
  // send says why beside the buttons and moves the focus to what is missing. Nothing is queued: a refused or blocked
  // click is over, and only a later click on this card's own button sends anything.
  const answer = async (o) => {
    if (composing) return; // never submit an unfinished composition
    if (st.busy) { el.querySelector("[data-card-sending]")?.focus({ preventScroll: true }); return; } // one answer in flight: "Sending…" shows
    if (!expectsInterview) for (const f of el.querySelectorAll("textarea[data-card-note]")) { if (f.dataset.noteFor) st.notes[f.dataset.noteFor] = f.value; else st.note = f.value; }
    for (const f of el.querySelectorAll("select[data-card-pick]")) st.notes[f.dataset.cardPick] = f.value;
    const { c, n, ackOk, lack, noteOf } = needs();
    if (c.status !== "open" || !el.isConnected) return;
    const block = lack(o);
    if (block) { st.msg = block.text; if (expectsInterview) { st.interviewAttempted = true; render(); } else sync();
      const msg = el.querySelector("[data-card-msg]"); msg?.scrollIntoView({ block: "nearest" });
      ((block.field && el.querySelector(block.field)) || msg)?.focus(); return; }
    // in flight: the buttons are disabled in place and the status line, already on the card, says Sending… (a screen
    // reader announces a status whose text changes, not one inserted with its text)
    st.busy = true; st.msg = ""; const root = el.querySelector("[data-card-root]");
    if (root && root.getAttribute("data-card-root") === c.id) { for (const b of root.querySelectorAll(".cc-actions [data-option], [data-direction-approve]")) b.disabled = true;
      const s = root.querySelector("[data-card-sending]"); if (s) s.textContent = T("Sending…", "送出中…"); const m = root.querySelector("[data-card-msg]"); if (m) m.textContent = ""; } else render();
    const took = (got) => { st.card = got && got.id ? got : { ...c, status: "answered", answer: { choice: o.id } }; st.ok = true; st.msg = ""; window.pageDirty?.clean(); try { opts.onAnswered && opts.onAnswered(st.card); } catch {} };
    try {
      if(draft&&!o.hold)await saveDraft();else if(draft)clearTimeout(draft.timer);
      const note=draft&&!o.hold?JSON.stringify({schema:1,card:c.id,visit:c.visit,batchHash:draft.hash,answers:draft.answers}):noteOf(o)||null;
      took(await post(`/api/scards/${encodeURIComponent(c.id)}/answer`, { choice: o.id, note, confirm: st.confirm ? "one-way" : null, ...(ackOk && st.ack && c.acknowledge.option === o.id ? { ack: c.acknowledge.id } : {}), aligned: n ? [...st.ticks].sort((a, b) => a - b) : undefined, ...(o.id === "rescope" && c.localRescope ? {localRescope:c.localRescope} : {}), ...(c.crew && !o.hold && st.crew && Object.keys(st.crew).length ? { crew: { ...st.crew } } : {}) }));
    } catch (e) {
      // answered already with this very choice: that is the answer, not a refusal
      let same = null; if (/answered exactly once/.test(e.message || "")) { try { const now = await get(`/api/scards/${encodeURIComponent(c.id)}`); if (now?.answer?.choice === o.id) same = now; } catch {} }
      if (same) took(same); else { st.ok = false; const message=e.message || String(e);
        const alignment=/tick every intent line as met \((\d+) of (\d+)\), or write a note/.exec(message);
        st.msg=alignment?T(message,`尚未送出核准：請勾完每一條意圖（${alignment[1]}/${alignment[2]}），或填寫備註說明。`):e.refusal&&e.refusal["zh-TW"]?T(e.refusal.en||message,e.refusal["zh-TW"]):message;
      }
    }
    st.busy = false; st.draw();
    if(st.msg){const feedback=el.querySelector('[data-card-msg]');feedback?.scrollIntoView({block:'nearest'});feedback?.focus({preventScroll:true});}
  };
  function render() {
    if(composing){pendingRender=true;return;}
    const focused=document.activeElement;const keep=focused&&el.contains(focused)&&focused instanceof HTMLTextAreaElement?{key:focused.hasAttribute('data-card-note')?'data-card-note':focused.hasAttribute('data-interview')?'data-interview':null,value:focused.getAttribute('data-interview'),noteFor:focused.getAttribute('data-note-for'),start:focused.selectionStart,end:focused.selectionEnd,direction:focused.selectionDirection}:null;
    const { c, d, open, n, one, ackOk, noteOpts, hasNote, noteLabel, missing, tickCount } = needs();
    const lang = h("div", { class: "cc-lang", role: "group", "aria-label": "Language" }, cardI18n().cardLangs(st.lang !== "en" ? st.lang : pageLang() !== "en" ? pageLang() : lastCardZh).map(([k, lab]) =>
      h("button", { type: "button", "data-card-lang": k, "aria-pressed": String(st.lang === k), onclick: () => { st.lang = k; if (k !== "en") lastCardZh = k; render(); } }, lab)));
    const zhWhy = zh() && c.sections?.["zh-TW"]?.why ? cardI18n().deep(st.lang, c.sections)?.why : null;
    const body = !d && zhWhy && c.body === c.sections?.en?.why ? zhWhy : c.body;
    const kids = [
      h("div", { class: "cc-h rt-card-h" }, h("span", { class: "vbadge" }, c.kind), h("b", {}, L(c.title)), c.door ? h("span", { class: `vbadge door-${c.door}` }, c.door) : null, lang),
      opts.inbox ? h("div", { class: "cardmeta cc-meta", "data-scard-meta": c.id }, h("span", { class: "mono" }, c.id), h("a", { href: `#/run/${encodeURIComponent(c.run)}` }, c.run), h("span", {}, c.workflow), h("span", { class: "badge" }, c.node)) : null,
      failureView(c),
      ...(d ? (d.artifactAcceptance ? artifactDetailView(d, c) : detailView(d, c)) : plainView(c)),
      competitionView(c),
      pullRequestView(c),
      // the competition already shows every round; its card text would repeat them, so it is not shown again
      body && !c.competition ? (d || specCard(c) ? h("details", { class: "cc-sec", open: st.opened.has("#body"), ontoggle: (e) => { e.target.open ? st.opened.add("#body") : st.opened.delete("#body"); } }, h("summary", { class: "cc-count" }, T("Card text", "卡片全文")), h("pre", { class: "cc-pre rt-card-body" }, body)) : bodyView(c, body)) : null,
    ];
    if (open) {
      if (n) kids.push(h("section", { class: "cc-align", "data-align": c.id },
        h("b", {}, T("Does the change meet each intent line? Tick each one.", "改動有做到每一條意圖嗎？逐條勾選。")),
        d.intents.map((t, i) => h("label", { class: "cc-tick" }, h("input", { type: "checkbox", "data-intent-tick": i, checked: st.ticks.has(i), onchange: (e) => { e.target.checked ? st.ticks.add(i) : st.ticks.delete(i); st.msg=""; sync(); } }), h("span", {}, `${i + 1}. `, LL(t)))),
        h("span", { class: "cc-count", "data-tick-count": "" }, tickCount())));
      if(expectsInterview&&!draft)kids.push(h("p",{class:"cc-msg",role:"alert"},T("The current interview questions could not be verified. Reload this card before answering.","目前訪談問題尚未驗證。請重新載入這張卡片後再回答。")));
      if(draft)kids.push(h("section",{class:"cc-interview",'data-interview-batch':draft.hash},h("h3",{},T("Answer this interview batch","回答這批訪談問題")),h("p",{class:"cc-count"},T("All six answers are required. Drafts are saved on this Mac; saving a draft does not answer the card.","六題都需要回答。草稿會儲存在這台 Mac；儲存草稿不會回覆卡片。")),form.questions.map((q,i)=>{const invalid=st.interviewAttempted&&!String(draft.answers[q.key]||'').trim(),id=`interview-${c.id}-${q.key}`;return h("div",{class:"cc-interview-field"},h("label",{for:id},`${i+1}. ${T(q.en,q.zh)}`),h("textarea",{id,rows:3,maxLength:500,'data-interview':q.key,'aria-required':'true','aria-invalid':String(!!invalid),'aria-describedby':id+'-error',oninput:e=>{draft.answers[q.key]=e.target.value;draft.dirty=true;clearTimeout(draft.timer);draft.timer=setTimeout(()=>saveDraft().catch(error=>{st.msg=error.message;st.draw();}),250);if(e.target.value.trim()){e.target.setAttribute('aria-invalid','false');const error=el.querySelector('#'+id+'-error');if(error)error.textContent='';}},onblur:()=>saveDraft().catch(error=>{st.msg=error.message;st.draw();})},draft.answers[q.key]||''),h("span",{id:id+'-error',class:'cc-field-error',role:invalid?'alert':null},invalid?T("Please answer this question.","請回答這個問題。"):''));})));
      if (hasNote) kids.push(h("textarea", { class: "input", rows: 2, "data-card-note": c.id, placeholder: T("Note (what to change, or why a line is not met)", "備註（要改什麼，或哪一條沒做到、為什麼）"), "aria-label": T("Note", "備註"),
        oninput: (e) => { st.note = e.target.value; st.msg = ""; sync(); } }, st.note));
      for (const o of noteOpts) { const label = `${T(o.label, o.labelZh || o.label)}: ${noteLabel(o)}`;
        kids.push(h("label", { class: "cc-note", "data-note-box": o.id }, h("span", { class: "cc-count" }, label),
          o.select?.length ? h("select", { class: "input", "data-card-pick": o.id, "aria-label": label, onchange: (e) => { st.notes[o.id] = e.target.value; st.msg = ""; sync(); } },
              h("option", { value: "" }, T("Pick one…", "請選一個…")), o.select.map((x) => h("option", { value: x.value, selected: st.notes[o.id] === x.value }, x.label)))
            : h("textarea", { class: "input", rows: 2, "data-card-note": c.id, "data-note-for": o.id, placeholder: noteLabel(o), "aria-label": label,
              oninput: (e) => { st.notes[o.id] = e.target.value; st.msg = ""; sync(); } }, st.notes[o.id] || ""))); }
      // a dispatch card's crew (docs/design/crew-seats.md): one line; "adjust this run" opens each node's effort, for this run only
      if (c.crew && Array.isArray(c.crew.nodes)) { st.crew = st.crew || {}; const changed = Object.keys(st.crew).length;
        const tunable = c.crew.nodes.some((r) => Array.isArray(r.efforts) && r.efforts.length);
        kids.push(h("section", { class: "cc-crew", "data-card-crew": c.id },
          h("button", { type: "button", class: "btn ghost cc-crew-line", "aria-expanded": String(!!st.crewOpen), disabled: !tunable, onclick: () => { st.crewOpen = !st.crewOpen; render(); } },
            h("span", {}, T(`Crew: ${c.crew.summary.en}${changed ? ` · ${changed} changed for this run` : ""}`, `人員：${c.crew.summary.zh}${changed ? ` · 這次改了 ${changed} 項` : ""}`)),
            tunable ? h("span", { class: "cc-count" }, st.crewOpen ? T("Hide", "收起") : T("Adjust this run?", "這次要調整嗎？")) : null),
          st.crewOpen ? h("div", { class: "cc-crew-rows" }, c.crew.nodes.map((r) => h("label", { class: "cc-crew-row", "data-crew-node": r.node },
            h("span", {}, `${r.label} · ${T(r.seatLabel.en, r.seatLabel.zh)}`), h("span", { class: "cc-mono" }, `${r.provider} · ${r.model}`),
            r.efforts.length ? h("select", { class: "input", "aria-label": T(`${r.label} effort for this run`, `${r.label} 這次的 effort`), onchange: (e) => { const v = e.target.value === "default" ? null : e.target.value; if (v === r.effort) delete st.crew[r.node]; else st.crew[r.node] = v; render(); } },
              r.efforts.map((x) => h("option", { value: x ?? "default", selected: (Object.hasOwn(st.crew, r.node) ? st.crew[r.node] : r.effort) === x }, x ?? T("default", "預設")))) : h("span", { class: "cc-count" }, r.effort ?? T("default", "預設"))))
            .concat(h("p", { class: "cc-count" }, T("Changes here apply to this run only. To change it every time, customise the workflow on the Crew page.", "這裡改的只用在這一次。要每次都這樣，到船員頁自訂這個 workflow。")))) : null)); }
      if (one) kids.push(h("label", { class: "cc-tick rt-row", for: `conf-${c.id}` }, h("input", { type: "checkbox", id: `conf-${c.id}`, "data-confirm-door": c.id, checked: st.confirm, onchange: (e) => { st.confirm = e.target.checked; st.msg = ""; sync(); } }),
        h("span", {}, T("I confirm: this is one-way, a revert will not undo it", "我確認：這是單向門，revert 無法還原"))));
      if (ackOk) kids.push(h("label", { class: "cc-tick rt-row", for: `ack-${c.id}` }, h("input", { type: "checkbox", id: `ack-${c.id}`, "data-acknowledge": c.id, checked: st.ack, onchange: (e) => { st.ack = e.target.checked; st.msg = ""; sync(); } }),
        h("span", {}, T(c.acknowledge.en, c.acknowledge.zh || c.acknowledge.en))));
      const onTiles = new Set(directionOptions(c, d));
      kids.push(h("div", { class: "cc-actions actions" }, c.options.filter((o) => !onTiles.has(o.id)).map((o) => { const why = missing(o);
        return h("button", { class: `btn ${o.primary ? "primary" : ""}`, type: "button", "data-option": o.id, ...(draft&&o.id==="continue"?{"data-save-interview":""}:{}), "data-ready": why ? "false" : "true", title: why || null, disabled: st.busy, onclick: () => answer(o) }, targetLabel(c, o)); })));
      const hint = st.msg ? "" : c.options.map(missing).find(Boolean) || "";
      kids.push(h("p", { class: "cc-count", "data-card-hint": "", hidden: !hint }, hint));
      kids.push(h("p", { class: "cc-count cc-sending", role: "status", "aria-live": "polite", tabindex: "-1", "data-card-sending": "" }, st.busy ? T("Sending…", "送出中…") : ""));
    } else if (c.answer) {
      const byFirstmate = c.decidedBy === "firstmate" || c.answer.by === "firstmate";
      if (byFirstmate) kids.push(h("p", { class: "cc-count", "data-decided-by": "firstmate" }, T("Decided by Firstmate within the spec, not by the captain.", "由 Firstmate 在 spec 內決定，不是船長的決定。")));
      kids.push(h("p", { class: "cc-msg ok", "data-card-answered": c.answer.choice }, T(`Answered: ${c.answer.choice}${c.answer.by ? ` by ${c.answer.by}` : ""}${c.answer.aligned ? ` · ${c.answer.aligned.length} of ${n} intent lines ticked` : ""}${c.answer.note ? ` · note: ${c.answer.note}` : ""}`,
        `已回覆：${c.answer.choice}${c.answer.by ? `（${c.answer.by}）` : ""}${c.answer.aligned ? ` · 意圖勾了 ${c.answer.aligned.length}/${n}` : ""}${c.answer.note ? ` · 備註：${c.answer.note}` : ""}`)));
    }
    kids.push(h("div", { class: "cc-msg", role: "status", "aria-live": "polite", "data-card-msg": "", tabindex: "-1" }, st.msg));
    el.replaceChildren(h("div", { class: "cc", "data-card-root": c.id }, kids));
    if(keep?.key){const field=[...el.querySelectorAll(`[${keep.key}]`)].find(t=>keep.key==='data-interview'?t.getAttribute(keep.key)===keep.value:(t.getAttribute('data-note-for')||null)===(keep.noteFor||null));if(field){field.focus({preventScroll:true});field.setSelectionRange(keep.start,keep.end,keep.direction);}}
    el.classList.add("rt-card"); el.setAttribute("data-scard", c.id); el.setAttribute("data-card-status", c.status);
  }
  render();
  return { el, update(c) { st.card = c; render(); } };
}
const api = { mountCard };
(typeof globalThis !== "undefined" ? globalThis : window).crewCard = api;
window.mountCard = mountCard;
})();
