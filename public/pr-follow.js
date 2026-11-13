// A watched pull request's follow-through card in the Inbox (docs/units/pr-watch.md "Follow-through"): why (quoting the
// reviewer), what is done and what is missing, who to send it to (a GitHub team's members to pick from, remembered), the
// editable message, Copy / copy and DM / send to a channel, the history of what was sent and what happened on GitHub,
// nudge again (the short version) and snooze, and the options. Studio never sends anything without a click here; the
// card closes by itself when GitHub shows what it waits for. Every text from GitHub is set as text. Loaded before
// scard.js, which hands it any card that carries `follow`.
(() => {
const ST = new Map(); // per card: the edited message, the chosen option, the note; kept across live updates
const pj = async (u, b) => { const r = await fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b ?? {}) }); let j = {}; try { j = await r.json(); } catch {} if (!r.ok || typeof j.error === "string") throw new Error(j.error || `HTTP ${r.status}`); return j; };
let targets = null; const loadTargets = async () => { try { const r = await fetch("/api/prs/sending"); targets = (await r.json()).targets || []; } catch { targets = []; } return targets; };
const L = (o) => (o ? T(o.en ?? "", o.tw ?? o.en ?? "") : "");
const when = (iso) => { const d = new Date(iso || ""); if (isNaN(d)) return ""; const p = (n) => String(n).padStart(2, "0"); return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
async function copyText(text) { try { await navigator.clipboard.writeText(text); return true; } catch {
  const ta = document.createElement("textarea"); ta.value = text; ta.style.cssText = "position:fixed;left:-9999px"; document.body.append(ta); ta.select(); let ok = false; try { ok = document.execCommand("copy"); } catch {} ta.remove(); return ok; } }
// a DM opens only an address the server built from the contact settings, and only of these three kinds
const SAFE = /^(?:slack:\/\/user\?team=T[A-Z0-9]+&id=[UW][A-Z0-9]+$|https:\/\/teams\.microsoft\.com\/l\/chat\/0\/0\?|mailto:)/;
function openSafe(href) { if (!SAFE.test(String(href || ""))) return false; const a = document.createElement("a"); a.href = href; if (href.startsWith("https:")) { a.target = "_blank"; a.rel = "noopener noreferrer"; } document.body.append(a); a.click(); a.remove(); return true; }
function snoozeChoices() { const now = new Date(), at = (d, h) => { const x = new Date(now); x.setDate(x.getDate() + d); x.setHours(h, 0, 0, 0); return x; };
  const out = [["", T("No snooze", "不暫緩")]]; if (now.getHours() < 18) out.push([at(0, 18).toISOString(), T("Back today at 18:00", "今天 18:00 再出現")]); out.push([at(1, 10).toISOString(), T("Back tomorrow at 10:00", "明天 10:00 再出現")]); return out; }

function mount(el, card, opts = {}) {
  let c = card; const st = ST.get(c.id) || { msg: null, msgFor: null, pick: null, note: "", busy: false, flash: {} }; ST.set(c.id, st);
  const say = (msg) => { st.msgLine = msg; draw(); };
  const act = async (name, body) => { try { return await pj(`/api/prs/follow/${name}`, { card: c.id, ...body }); } catch (e) { say(e.message); return null; } };
  function draw() {
    const f = c.follow, open = c.status === "open", message = f.message ? (st.msgFor === `${f.chased}:${f.head}` && st.msg != null ? st.msg : L(f.chased ? f.short : f.message)) : "";
    const ta = f.message ? h("textarea", { class: "pw-msg", rows: 9, "aria-label": T("Message", "訊息"), "data-follow-msg": "", oninput: (e) => { st.msg = e.target.value; st.msgFor = `${f.chased}:${f.head}`; } }) : null; if (ta) ta.value = message;
    const text = () => (ta ? ta.value : "");
    const rcpt = (r) => { const pick = r.pick || r.who, k = `dm:${pick}`;
      return h("div", { class: "pw-check", "data-follow-rcpt": r.who }, h("span", { class: r.team ? "badge pw-agrp bad" : "badge" }, r.who),
        r.team ? [h("span", { class: "faint pw-small" }, "→"), h("select", { class: "pw-lang", "aria-label": T(`Pick a member of ${r.who}`, `選 ${r.who} 的成員`), "data-follow-pick": r.who, disabled: !open,
          onchange: async (e) => { await act("pick", { who: r.who, member: e.target.value }); } }, r.members.map((m) => h("option", { value: m, selected: m === r.pick }, m))),
          r.last ? h("span", { class: "faint pw-small" }, T(`last time: ${r.last}`, `上次找的是 ${r.last}`)) : null] : null,
        h("span", { class: "faint pw-small" }, L(r.via)), h("span", { class: "x-grow" }),
        h("button", { class: "btn sm", "data-follow-dm": pick, disabled: !open || !pick, onclick: async () => { const ok = await copyText(text()); const got = await act("dm", { login: pick, text: text() }); if (!got) return;
          st.flash[k] = got.href && openSafe(got.href) ? T("Copied, DM opened", "已複製，DM 已打開") : ok ? T("Copied (no contact: paste it yourself)", "已複製（沒有聯絡人：自己貼上）") : T("Could not copy", "無法複製"); draw(); } }, st.flash[k] || T(`Copy and DM ${pick}`, `複製並 DM ${pick}`))); };
    const tsel = h("select", { class: "pw-lang", "aria-label": T("Channel", "頻道"), "data-follow-target": "" }, (targets || []).length ? [f.channel ? null : h("option", { value: "", selected: true }, T("choose a channel", "選頻道")), ...targets.map((t) => h("option", { value: t.id, selected: t.id === f.channel }, t.name))] : h("option", { value: "" }, T("no channel set", "沒有設定頻道")));
    const picked = (f.opts || []).find((o) => o.id === st.pick);
    const kids = [
      h("div", { class: "cardmeta" }, h("span", { class: "mono" }, c.id), h("a", { href: f.url, target: "_blank", rel: "noopener noreferrer" }, f.pr.split("/")[1]), h("span", { class: "badge" }, L(f.kindLabel)), h("span", {}, ago(c.createdAt))),
      h("h3", { "data-follow-title": "" }, L(f.heading)),
      h("p", { class: "lead", "data-follow-lead": "" }, L(f.lead)),
      h("div", { class: "ba" }, h("div", {}, h("b", {}, T("Done", "已經好了")), (f.done || []).map((d) => h("div", {}, "✓ ", L(d))), !(f.done || []).length ? h("div", { class: "faint" }, "—") : null),
        h("div", { "data-follow-missing": "" }, h("b", {}, T("Missing", "還缺")), (f.missing || []).map((d) => h("div", {}, L(d))))),
      f.message ? h("div", { style: "display:grid;gap:8px" }, h("h2", { style: "margin:0;font-size:15px" }, L(f.msgHead)),
        f.recipients?.length ? h("div", { class: "pw-propbox" }, h("b", { class: "pw-small" }, T("To", "發給誰")), f.recipients.map(rcpt)) : null, ta,
        h("div", { class: "actions" }, h("button", { class: "btn sm", "data-follow-copy": "", disabled: !open, onclick: async () => { const ok = await copyText(text()); await act("copy", {}); st.flash.copy = ok ? T("Copied", "已複製") : T("Could not copy", "無法複製"); draw(); } }, st.flash.copy || T("Copy", "複製")),
          h("span", { class: "faint pw-small" }, T("or send to a channel", "或發到頻道")), tsel,
          h("button", { class: "btn sm", "data-follow-send": "", disabled: !open || !(targets || []).length, onclick: async () => { if (!tsel.value) { say(T("Choose a channel first", "先選頻道")); return; } const got = await act("send", { target: tsel.value, text: text() }); if (got) { st.flash.send = T(`Sent to ${got.target}`, `已發到 ${got.target}`); draw(); } } }, st.flash.send || T("Send", "發送")))) : null,
      h("div", { style: "display:grid;gap:6px" }, h("h2", { style: "margin:0;font-size:15px" }, T("Follow-up record", "跟進紀錄")),
        h("ol", { class: "pw-rules", "data-follow-history": "" }, (f.history || []).map((x) => h("li", { class: x.hit ? "hit" : "no" }, h("span", { class: "mono faint", style: "font-weight:400" }, when(x.at)), " ", L(x)))),
        f.message && open ? [h("div", { class: "actions" }, h("button", { class: "btn", "data-follow-chase": "", onclick: async () => { st.msg = null; await act("chase", {}); } }, T("Nudge again", "再催一次")),
            h("label", { class: "pw-check" }, h("span", { class: "faint pw-small" }, T("They said later", "對方說晚點")), h("select", { class: "pw-lang", "aria-label": T("Snooze until", "暫緩到"), "data-follow-snooze": "", onchange: (e) => act("snooze", { until: e.target.value || null }) },
              snoozeChoices().map(([v, l]) => h("option", { value: v }, l))))),
          h("div", { class: "note" }, T("Nudge again swaps in the short follow-up (only what is missing and the link), for the same person; pick another member above to change who. Studio never nudges by itself and has no timer: the card stays here, showing when you last nudged.", "「再催一次」會把訊息換成簡短的跟進版（只寫還缺什麼和連結），發給同一個人；要換人就在上面選別的成員。Studio 不會自己去催，也不用設定幾小時：卡一直在這裡，標著上次是什麼時候催的。"))] : null),
      open ? h("div", { class: "opts", role: "radiogroup", "aria-label": T("Options", "選項") }, (f.opts || []).map((o) => h("button", { class: "opt", role: "radio", "aria-pressed": String(st.pick === o.id), "aria-checked": String(st.pick === o.id), "data-follow-opt": o.id, onclick: () => { st.pick = o.id; draw(); } },
        h("span", { class: "letter" }, o.letter), h("b", {}, L(o.label)), h("span", { class: "pc" }, o.pro ? h("em", {}, "+ ", L(o.pro)) : null, o.con ? h("s", {}, "− ", L(o.con)) : null)))) : null,
      open && picked?.note ? h("textarea", { class: "input", rows: 2, "data-follow-note": "", placeholder: T("Why (it goes in the answer)", "理由（寫進回覆）"), oninput: (e) => { st.note = e.target.value; const b = el.querySelector("[data-follow-submit]"); if (b) b.disabled = st.busy || !st.note.trim(); } }, st.note) : null,
      open ? h("div", { class: "actions" }, h("button", { class: "btn primary", "data-follow-submit": "", disabled: !picked || st.busy || (picked.note && !st.note.trim()), onclick: submit },
        picked ? T(`Send ${picked.letter} · ${L(f.heading)}`, `送出 ${picked.letter} · ${L(f.heading)}`) : T("Pick an option first", "先選一個選項")), h("span", { class: "faint pw-small" }, L(f.autoClose)))
        : h("p", { class: "cc-msg ok", "data-follow-answered": "" }, c.answer ? T(`Answered: ${c.answer.choice} by ${c.answer.by}`, `已回覆：${c.answer.choice}（${c.answer.by}）`) : T("Closed", "已關閉")),
      st.msgLine ? h("p", { class: "cc-msg", role: "status" }, st.msgLine) : null,
    ];
    el.replaceChildren(h("div", { class: "icard", "data-follow-card": c.id, "data-follow-kind": f.kind }, kids));
  }
  async function submit() {
    const f = c.follow, o = (f.opts || []).find((x) => x.id === st.pick); if (!o) return; st.busy = true; draw();
    try { if (o.keep) await pj("/api/prs/follow/choose", { card: c.id, option: o.id });
      else { await pj(`/api/scards/${encodeURIComponent(c.id)}/answer`, { choice: o.id, note: st.note.trim() || null }); opts.onAnswered?.({ id: c.id }); }
      st.msgLine = o.keep ? T(`Recorded: ${L(o.label)}. The card stays until GitHub shows it.`, `已記下：${L(o.label)}。卡會留著，直到 GitHub 上有動靜。`) : ""; }
    catch (e) { st.msgLine = e.message; } finally { st.busy = false; draw(); }
  }
  if (!targets) loadTargets().then(draw);
  draw();
  return { el, update(n) { c = n; draw(); } };
}
window.crewFollowCard = { mount };
})();
