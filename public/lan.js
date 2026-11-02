// Board-to-board work (docs/units/lan-relay.md): #/lan[/<thread>]. My address (fingerprint, device name, copy), the
// introduction (a window of a few minutes, the short code both screens show, typed in to confirm), introduced peers
// (petname, what they call themselves, fingerprint, unpair, revoke, a frozen author's two entries), the Studios nearby
// (seen, never contacted), dispatching work, the inbox of received items (approve, take with a workflow, reject), and
// each work thread's relay track: where it is now, who holds it, every hand-off with device and time, what comes next.
// Everything a peer wrote is drawn as text nodes (kit.js h()): never as HTML, never as SVG, never in a frame of this
// origin. The approver sees the full briefing and the exact prompt the agent will get. Loaded before backbone.js.
(() => {
const LN = { v: null, wf: null, err: null, sel: null, item: null, form: { title: "", briefing: "", acceptance: "", workflow: "", to: "" }, intro: { host: "", port: "" }, codes: {}, names: {}, take: {}, refine: {}, preview: {}, edits: {}, busy: false, insp: null, scrolled: {} };
window.crewLan = LN;
const getJ = async (u) => { const r = await fetch(u); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j; };
const postJ = async (u, b) => { const r = await fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b ?? {}) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { code: j.code }); return j; };
const onPage = () => S.route?.name === "lan";
const typing = () => { const a = document.activeElement; return !!a && a.closest?.("[data-lan]") && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName); };
async function load() {
  try { LN.v = await getJ("/api/lan"); LN.err = null; } catch (e) { LN.err = String(e.message || e); }
  if (onPage() && !LN.wf) { try { LN.wf = (await getJ("/api/lan/workflows")).workflows; } catch {} }
  badgeNav(); if (onPage() && !typing()) render();
}
const act = async (what, f) => { if (LN.busy) return; LN.busy = true; try { const r = await f(); await load(); return r; } catch (e) { toast(`${what}：${e.message || e}`); } finally { LN.busy = false; if (onPage() && !typing()) render(); } };
function badgeNav() {
  const item = document.querySelector('.nav-item[data-view="lan"]'); if (!item) return;
  let b = item.querySelector(".count"); if (!b) { b = h("span", { class: "count attn", "data-lan-count": "" }); item.append(b); }
  const n = (LN.v?.items || []).filter((i) => i.state === "open").length + (LN.v?.intros || []).length;
  b.textContent = n ? String(n) : ""; b.hidden = !n;
}
window.liveListen?.("lan", () => { clearTimeout(LN.t); LN.t = setTimeout(load, 120); });
setInterval(() => { if (onPage() && !typing()) load(); }, 4000);

// ---------- pieces ----------
const fp = (s) => h("span", { class: "lan-fp mono", title: T("Fingerprint: compare it in person", "指紋：當面比對") }, s);
const who = (w) => w ? h("span", { class: "lan-who" }, h("b", {}, w.me ? T("Me", "我") : w.name), " ", h("span", { class: "faint mono" }, (w.fp || "").split(" ").slice(0, 2).join(" "))) : h("span", { class: "faint" }, "—");
const when = (iso) => h("span", { class: "faint num", title: iso }, clock(iso));
const pre = (text, attrs = {}) => h("pre", { class: "lan-pre", ...attrs }, text ?? ""); // a text node: never parsed as HTML
const field = (label, input) => h("div", { class: "field" }, h("label", {}, label), input);
const inp = (o, key, attrs = {}) => { const el = h(attrs.rows ? "textarea" : "input", { ...attrs, oninput: (e) => { o[key] = e.target.value; } }); el.value = o[key] ?? ""; return el; };
const copy = (text) => { try { navigator.clipboard.writeText(text); toast(T("Copied", "已複製")); } catch { toast(text); } };
const KIND = { dispatch: ["派工", "Dispatch"], take: ["接下", "Take"], assign: ["指派", "Assign"], result: ["交回結果", "Result"], refine: ["再調整", "Refine"], done: ["結案", "Done"], revoke: ["撤回", "Withdraw"] };
const kindName = (k) => T(KIND[k]?.[1] ?? k, KIND[k]?.[0] ?? k);

function myAddress(v) {
  const addr = v.host && v.port ? `${v.host}:${v.port}` : null;
  return h("section", { class: "card lan-card", "data-lan-me": "" },
    h("div", { class: "card-h" }, icon("link"), h("b", {}, T("My address", "我的地址")), h("span", { class: `badge ${v.listening ? "ok" : ""}` }, h("span", { class: "d" }), v.listening ? T("Listening", "已開啟") : T("Off", "關閉"))),
    h("div", { class: "lan-body" },
      h("div", { class: "kv" }, T("Device name", "裝置名稱"), h("b", {}, v.me.name)),
      h("div", { class: "kv" }, T("Fingerprint", "指紋"), fp(v.me.fingerprint)),
      h("div", { class: "kv" }, T("Address", "位址"), h("b", { class: "mono" }, addr || T("not listening", "未開啟"))),
      h("div", { class: "kv" }, T("Key kept in", "金鑰存放"), h("b", {}, v.me.store === "keychain" ? T("the macOS Keychain", "macOS 鑰匙圈") : T("a 0600 file in Studio's data", "Studio 資料夾裡的 0600 檔案"))),
      h("div", { class: "lan-row" },
        h("button", { class: "btn", "data-lan-copy": "", onclick: () => copy(`${v.me.name} · ${addr ?? "—"} · ${v.me.fingerprint}`) }, icon("copy"), T("Copy", "複製")),
        h("button", { class: `btn ${v.listening ? "" : "primary"}`, "data-lan-toggle": "", onclick: () => act(T("Listener", "監聽"), () => postJ("/api/lan/settings", { enabled: !v.enabled })) }, v.listening ? T("Turn off", "關閉") : T("Turn on", "開啟"))),
      h("p", { class: "faint lan-note" }, T("Only introduced Studios can talk to this listener, over an encrypted channel bound to their full keys. Browsers cannot reach it.", "只有當面引介過的 Studio 能連這個監聽，通道以雙方完整公鑰加密並互相驗證；瀏覽器無法連入。"))));
}
function introductions(v) {
  const open = v.introOpenUntil && Date.parse(v.introOpenUntil) > Date.now();
  return h("section", { class: "card lan-card", "data-lan-intros": "" },
    h("div", { class: "card-h" }, icon("human"), h("b", {}, T("Introduce in person", "當面引介")), open ? h("span", { class: "badge human" }, T(`open until ${clock(v.introOpenUntil)}`, `開放到 ${clock(v.introOpenUntil)}`)) : null),
    h("div", { class: "lan-body" },
      h("p", { class: "faint" }, T("Seeing a Studio nearby is not trust. To exchange anything, sit together: one side opens its window, the other enters its address, and both type the code the other screen shows.", "看得到附近的 Studio 不代表信任。要交換任何東西，請坐在一起：一方開放引介，另一方輸入它的位址，雙方各自輸入對方螢幕上的短碼。")),
      h("div", { class: "lan-row" }, open ? h("button", { class: "btn", "data-lan-intro-close": "", onclick: () => act("", () => postJ("/api/lan/intro/close")) }, T("Close the window", "關閉引介"))
        : h("button", { class: "btn", "data-lan-intro-open": "", disabled: !v.listening, onclick: () => act("", () => postJ("/api/lan/intro/open", { minutes: 5 })) }, T("Open for 5 minutes", "開放引介 5 分鐘"))),
      h("div", { class: "lan-grid2" }, field(T("Their address (IP)", "對方位址（IP）"), inp(LN.intro, "host", { id: "lanIntroHost", placeholder: "192.168.1.23" })), field(T("Port", "埠"), inp(LN.intro, "port", { id: "lanIntroPort", placeholder: "7417", inputmode: "numeric" }))),
      h("button", { class: "btn primary", "data-lan-intro-start": "", disabled: !v.listening, onclick: () => act(T("Introduction", "引介"), () => postJ("/api/lan/intro/start", { host: LN.intro.host.trim(), port: Number(LN.intro.port) })) }, T("Introduce", "引介")),
      ...(v.intros || []).map((i) => h("div", { class: "lan-intro", "data-lan-intro": i.id },
        h("div", { class: "lan-sas", "aria-label": T(`This screen's code ${i.sas}`, `這個螢幕的短碼 ${i.sas}`) }, h("span", { class: "faint" }, T("This screen shows", "這個螢幕顯示")), h("b", { class: "num" }, `${i.sas.slice(0, 3)} ${i.sas.slice(3)}`)),
        h("div", { class: "kv" }, T("They call themselves", "自稱"), h("b", {}, i.claimed || "—")),
        i.similar?.length ? h("p", { class: "lan-warn" }, icon("alert", "ic sm"), T(`Looks like a peer you already know (${i.similar.join(", ")}): check the fingerprint.`, `和你已知的同事（${i.similar.join("、")}）名字相近：請比對指紋。`)) : null,
        h("div", { class: "kv" }, T("Their fingerprint", "對方指紋"), fp(i.fp)),
        h("div", { class: "lan-grid2" }, field(T("Code on their screen", "對方螢幕上的短碼"), inp(LN.codes, i.id, { "data-lan-code": i.id, inputmode: "numeric", autocomplete: "off", placeholder: "000 000" })), field(T("Your name for them", "你替對方取的名字"), inp(LN.names, i.id, { "data-lan-petname": i.id }))),
        h("div", { class: "lan-row" }, h("button", { class: "btn primary", "data-lan-confirm": i.id, onclick: () => act(T("Confirm", "確認"), () => postJ(`/api/lan/intro/${i.id}/confirm`, { code: LN.codes[i.id] || "", petname: LN.names[i.id] || "" })) }, T("Codes match: add", "短碼相符，加入")),
          h("button", { class: "btn ghost", onclick: () => act("", () => postJ(`/api/lan/intro/${i.id}/cancel`)) }, T("Cancel", "取消")))))));
}
function peers(v) {
  const list = (v.peers || []).filter((p) => p.state === "trusted" || p.frozen);
  return h("section", { class: "card lan-card", "data-lan-peers": "" },
    h("div", { class: "card-h" }, icon("crew"), h("b", {}, T("Introduced peers", "已引介的同事")), h("span", { class: "badge" }, String(list.length))),
    h("div", { class: "lan-body" }, list.length ? list.map((p) => h("div", { class: `lan-peer${p.frozen ? " frozen" : ""}`, "data-lan-peer": p.key },
      h("div", { class: "lan-row" }, h("b", {}, p.petname), p.claimed && p.claimed !== p.petname ? h("span", { class: "faint" }, T(`calls itself ${p.claimed}`, `自稱 ${p.claimed}`)) : null, p.state === "revoked" ? h("span", { class: "badge bad" }, T("revoked", "已撤銷")) : null),
      h("div", { class: "kv" }, T("Fingerprint", "指紋"), fp(p.fp)), h("div", { class: "kv" }, T("Address", "位址"), h("b", { class: "mono" }, `${p.host}:${p.port}`)),
      p.frozen ? h("div", { class: "lan-frozen", role: "alert", "data-lan-frozen": p.key },
        h("p", {}, icon("alert", "ic sm"), h("b", {}, T("Frozen: a fork in this peer's log", "已凍結：此同事的帳本出現分岔")), " ", T(`Two different entries carry sequence number ${p.frozen.seq}, and both signatures are valid. Studio cannot tell which one the peer meant: the key may be stolen or the peer may be acting against you. Check with them in person.`, `序號 ${p.frozen.seq} 上有兩筆不同的條目，兩筆的簽章都合法。Studio 無法判斷哪一筆是對方本意：金鑰可能被偷，或對方在對你做不同的陳述。請當面確認。`)),
        h("div", { class: "lan-fork" }, [p.frozen.a, p.frozen.b].map((e, n) => e ? h("button", { class: "lan-step", "data-lan-fork-entry": e.hash, onclick: () => inspect(e.hash) }, h("b", {}, T(`Entry ${n + 1}`, `條目 ${n + 1}`)), h("span", { class: "mono faint" }, e.hash.slice(0, 12)), h("span", {}, `${e.kind ?? "?"} · ${T("signature valid", "簽章合法")}`)) : null)),
        h("div", { class: "lan-row" }, h("button", { class: "btn danger", "data-lan-fork-revoke": p.key, onclick: () => act("", () => postJ(`/api/lan/peers/${p.key}/resolve`, { action: "revoke" })) }, T("Revoke this key", "撤銷這把金鑰")),
          h("button", { class: "btn", "data-lan-fork-unfreeze": p.key, onclick: () => { if (confirm(T("Unfreeze only after checking with them in person.", "請在當面確認後才解除凍結。"))) act("", () => postJ(`/api/lan/peers/${p.key}/resolve`, { action: "unfreeze" })); } }, T("Checked in person: unfreeze", "已當面確認，解除凍結")))) : null,
      p.state === "trusted" ? h("div", { class: "lan-row" },
        h("button", { class: "btn ghost", onclick: () => { const n = prompt(T("Your name for this peer", "你替這位同事取的名字"), p.petname); if (n) act("", () => postJ(`/api/lan/peers/${p.key}/rename`, { petname: n })); } }, T("Rename", "改名")),
        h("button", { class: "btn ghost", "data-lan-unpair": p.key, onclick: () => { if (confirm(T("Unpair? Its open items are withdrawn and its Tasks stop.", "解除配對？它的待處理項目會撤回，進行中的 Task 會停止。"))) act("", () => postJ(`/api/lan/peers/${p.key}/unpair`)); } }, T("Unpair", "解除配對")),
        h("button", { class: "btn danger", "data-lan-revoke": p.key, onclick: () => { if (confirm(T("Revoke this key for good?", "永久撤銷這把金鑰？"))) act("", () => postJ(`/api/lan/peers/${p.key}/revoke`)); } }, T("Revoke", "撤銷"))) : null))
      : h("p", { class: "faint" }, T("No one yet. Introduce a colleague in person to start.", "還沒有。先當面引介一位同事。"))),
    (v.nearby || []).length ? h("div", { class: "lan-body lan-nearby", "data-lan-nearby": "" }, h("p", { class: "faint" }, T(`${v.nearby.length} Studio(s) nearby, not introduced: you can see that they exist, nothing more. Studio never contacts them.`, `附近有 ${v.nearby.length} 台 Studio（未引介）：只看得到它們存在，Studio 不會連過去。`)),
      v.nearby.map((n) => h("span", { class: "chip mono" }, n.id))) : null);
}
function dispatchForm(v) {
  const peersOk = (v.peers || []).filter((p) => p.state === "trusted" && !p.frozen);
  if (!LN.form.to && peersOk[0]) LN.form.to = peersOk[0].key;
  const sel = h("select", { id: "lanTo", onchange: (e) => { LN.form.to = e.target.value; } }, peersOk.map((p) => h("option", { value: p.key, selected: p.key === LN.form.to }, `${p.petname} · ${p.fp.split(" ").slice(0, 2).join(" ")}`)));
  const wfs = h("select", { id: "lanWf", onchange: (e) => { LN.form.workflow = e.target.value; } }, h("option", { value: "" }, T("No suggestion", "不建議")), (LN.wf || []).map((w) => h("option", { value: w.id, selected: w.id === LN.form.workflow }, `${w.name} v${w.version}`)));
  return h("section", { class: "card lan-card", "data-lan-dispatch": "" },
    h("div", { class: "card-h" }, icon("send"), h("b", {}, T("Dispatch work", "派工"))),
    peersOk.length ? h("div", { class: "lan-body" }, field(T("To", "給"), sel), field(T("Title", "標題"), inp(LN.form, "title", { id: "lanTitle", maxlength: "120" })),
      field(T("Briefing (sealed to them; they see all of it)", "Briefing（只加密給對方；對方會看到全文）"), inp(LN.form, "briefing", { id: "lanBrief", rows: 5, maxlength: "5000" })),
      field(T("Acceptance criteria, one per line", "驗收條件，一行一條"), inp(LN.form, "acceptance", { id: "lanAcc", rows: 2 })), field(T("Suggested workflow (they choose their own)", "建議流程（對方用自己的流程）"), wfs),
      h("button", { class: "btn primary", "data-lan-send": "", onclick: () => act(T("Dispatch", "派工"), async () => { const t = await postJ("/api/lan/dispatch", { ...LN.form, acceptance: LN.form.acceptance.split("\n") }); LN.form.title = LN.form.briefing = LN.form.acceptance = ""; location.hash = `#/lan/${t.id}`; }) }, T("Dispatch", "派工")))
      : h("p", { class: "faint lan-body" }, T("Introduce a peer first.", "請先引介一位同事。")));
}

// ---------- the inbox ----------
function inbox(v) {
  const items = v.items || [];
  if (LN.item && !items.some((i) => i.id === LN.item)) LN.item = null;
  const cur = items.find((i) => i.id === LN.item) || items[0] || null;
  return h("section", { class: "card lan-card", "data-lan-inbox": "" },
    h("div", { class: "card-h" }, icon("inbox"), h("b", {}, T("Received", "收件匣")), h("span", { class: `badge ${items.length ? "human" : ""}` }, String(items.length)), h("span", { class: "faint" }, T("nothing starts until you approve it here", "在這裡核准之前，什麼都不會開始"))),
    items.length ? h("div", { class: "lan-ib" },
      h("div", { class: "lan-ib-list", role: "listbox", "aria-label": T("Received items", "收到的項目") }, items.map((i) => h("button", { class: `lan-ib-row${cur === i ? " on" : ""}`, role: "option", "aria-selected": String(cur === i), "data-lan-item": i.id, onclick: () => { LN.item = i.id; render(); } },
        h("span", { class: "vbadge", "data-kind": i.kind }, kindName(i.kind)), h("span", { class: "lan-ib-t" }, i.title), who(i.from), i.state === "frozen" ? h("span", { class: "badge bad" }, T("frozen", "凍結")) : null))),
      h("div", { class: "lan-ib-detail", "data-lan-detail": cur.id }, itemDetail(cur)))
    : h("div", { class: "empty" }, icon("inbox"), h("b", {}, T("Nothing received", "沒有收到東西")), T("Items from introduced peers wait here for you.", "已引介同事送來的項目會在這裡等你。")));
}
function scrollGate(id, box) {
  // a long content must be read to its end before it can be approved (the approve button waits for that)
  box.addEventListener("scroll", () => { if (box.scrollTop + box.clientHeight >= box.scrollHeight - 4 && !LN.scrolled[id]) { LN.scrolled[id] = true; const b = document.querySelector(`[data-lan-approve="${CSS.escape(id)}"]`); if (b) b.disabled = false; } });
  requestAnimationFrame(() => { if (box.isConnected && box.scrollHeight <= box.clientHeight + 4) { LN.scrolled[id] = true; const b = document.querySelector(`[data-lan-approve="${CSS.escape(id)}"]`); if (b && !b.dataset.blocked) b.disabled = false; } });
  return box;
}
function itemDetail(i) {
  const frozen = i.state === "frozen";
  const head = h("div", { class: "lan-row" }, h("b", {}, kindName(i.kind)), h("span", {}, i.title), who(i.from), when(i.at), h("button", { class: "btn ghost", "data-lan-inspect": i.entry, onclick: () => inspect(i.entry) }, T("Inspect entry", "檢視條目")));
  const reject = h("button", { class: "btn ghost", "data-lan-reject": i.id, onclick: () => act(T("Reject", "拒絕"), () => postJ(`/api/lan/items/${i.id}/reject`, {})) }, T("Reject", "拒絕"));
  const approve = (label, body, extra = {}) => h("button", { class: "btn primary", "data-lan-approve": i.id, disabled: frozen || !LN.scrolled[i.id], ...extra, onclick: () => act(label, () => postJ(`/api/lan/items/${i.id}/approve`, body())) }, label);
  if (i.kind === "dispatch" || i.kind === "refine") {
    const t = LN.take[i.id] ||= { workflow: (LN.wf || []).find((w) => w.eligible && w.id === i.suggested?.id)?.id || (LN.wf || []).find((w) => w.eligible)?.id || "", usd: "2", rounds: "6", provider: "", staffing: false };
    const w = (LN.wf || []).find((x) => x.id === t.workflow);
    const box = scrollGate(i.id, h("div", { class: "lan-content", tabindex: "0", "data-lan-content": i.id, "aria-label": T("The full briefing", "完整的 briefing") },
      i.invisible ? h("p", { class: "lan-warn" }, icon("alert", "ic sm"), T("This briefing hides characters (zero-width, bidi or control): they are shown as ⟦U+…⟧.", "這份 briefing 裡有隱藏字元（零寬、bidi 或控制字元），以 ⟦U+…⟧ 標出。")) : null,
      h("div", { class: "lbl" }, T("Briefing, as sent", "Briefing 原文")), pre(i.briefing, { "data-lan-briefing": i.id }),
      i.acceptance?.length ? h("div", {}, h("div", { class: "lbl" }, T("Acceptance criteria", "驗收條件")), h("ul", {}, i.acceptance.map((c) => h("li", {}, c)))) : null,
      i.note ? h("p", {}, h("span", { class: "lbl" }, T("Note", "附註")), " ", i.note) : null,
      h("details", { open: true }, h("summary", {}, T("Exactly what the agent will get", "agent 會拿到的完整內容")), pre(i.prompt, { "data-lan-prompt": i.id }))));
    return h("div", { class: "lan-detail" }, head,
      h("p", { class: "lan-warn" }, icon("alert", "ic sm"), T("From a colleague's Studio: treat it as untrusted. Do not paste commands from it into a terminal.", "來自同事的 Studio：請當作不可信的內容。不要把裡面的指令貼進終端機。")),
      i.suggested ? h("p", { class: "faint" }, T(`They suggest ${i.suggested.id} v${i.suggested.version} (${i.suggested.defHash.slice(0, 12)}); you run your own.`, `對方建議 ${i.suggested.id} v${i.suggested.version}（${i.suggested.defHash.slice(0, 12)}）；實際跑的是你自己的流程。`)) : null,
      box,
      h("div", { class: "lan-grid3" },
        field(T("Take with my workflow", "用我的流程接下"), h("select", { "data-lan-take-wf": i.id, onchange: (e) => { t.workflow = e.target.value; render(); } }, (LN.wf || []).map((x) => h("option", { value: x.id, disabled: !x.eligible, selected: x.id === t.workflow }, `${x.name} v${x.version}${x.eligible ? "" : ` — ${T("not on the LAN profile", "不符合受限 profile")}`}`)))),
        field(T("Spend cap ($)", "花費上限（$）"), inp(t, "usd", { "data-lan-usd": i.id, inputmode: "decimal" })), field(T("Agent rounds", "agent 輪數上限"), inp(t, "rounds", { "data-lan-rounds": i.id, inputmode: "numeric" }))),
      field(T("Provider", "供應商"), h("select", { "data-lan-provider": i.id, onchange: (e) => { t.provider = e.target.value; } }, [["", T("Studio's default", "Studio 預設")], ["codex", "Codex"], ["claude", "Claude"], ["cursor", "Cursor"]].map(([v, l]) => h("option", { value: v, selected: v === t.provider }, l)))),
      w && !w.eligible ? h("p", { class: "lan-warn" }, w.why.join(" · ")) : null,
      w?.notRun?.length ? h("p", { class: "faint" }, T(`These checks will not run on work from a peer: ${w.notRun.join(", ")}`, `這些檢查不會在同事的工作上執行：${w.notRun.join("、")}`)) : null,
      w?.staffing ? h("label", { class: "lan-row" }, h("input", { type: "checkbox", checked: t.staffing, onchange: (e) => { t.staffing = e.target.checked; } }), T("I confirm who works on each node of this workflow", "我確認這個流程每個節點的人員配置")) : null,
      h("p", { class: "faint" }, T("Runs in a fresh folder under the restricted profile: the OS sandbox, its provider only on the network, no push, no pull request, no tests that listen, no CI or hook edits.", "在新的資料夾、受限 profile 下執行：OS sandbox、網路只到 provider、不能 push 或開 PR、不跑會開監聽的測試、不能改 CI 或 hooks。")),
      h("div", { class: "lan-row" }, approve(T("Take with this workflow", "用這個流程接下"), () => ({ workflow: t.workflow, usd: Number(t.usd), rounds: Number(t.rounds), provider: t.provider || null, staffingConfirm: t.staffing ? w?.staffing?.hash : null })), reject));
  }
  LN.scrolled[i.id] ??= true;
  if (i.kind === "take") return h("div", { class: "lan-detail" }, head, h("p", {}, T(`${i.from.name} wants to take round ${i.round} with their ${i.workflow.id} v${i.workflow.version} (${i.workflow.defHash.slice(0, 12)}), capped at $${i.cap.usd} and ${i.cap.rounds} rounds.`, `${i.from.name} 要用他自己的 ${i.workflow.id} v${i.workflow.version}（${i.workflow.defHash.slice(0, 12)}）接第 ${i.round} 輪，上限 $${i.cap.usd}、${i.cap.rounds} 輪。`)),
    h("div", { class: "lan-row" }, approve(T(`Assign to ${i.from.name}`, `指派給 ${i.from.name}`), () => ({})), reject));
  if (i.kind === "assign") return h("div", { class: "lan-detail" }, head, h("p", {}, T("The dispatcher assigned this round to you. Start it on this Mac under the restricted profile?", "派工者把這一輪指派給你。要在這台 Mac 上以受限 profile 開工嗎？")),
    h("div", { class: "lan-row" }, approve(T("Start (restricted profile)", "開工（受限 profile）"), () => ({})), reject));
  if (i.kind === "result") return h("div", { class: "lan-detail" }, head,
    i.flags?.includes("workflow-mismatch") ? h("p", { class: "lan-warn", "data-lan-flag": "workflow-mismatch" }, icon("alert", "ic sm"), T(`The result names ${i.workflow.id} (${i.workflow.defHash.slice(0, 12)}), not the workflow its take named (${i.takeWorkflow?.defHash?.slice(0, 12) ?? "?"}).`, `結果宣稱用的流程是 ${i.workflow.id}（${i.workflow.defHash.slice(0, 12)}），和接下時說的（${i.takeWorkflow?.defHash?.slice(0, 12) ?? "?"}）不同。`)) : null,
    h("p", { class: "faint" }, T(`Their checks: ${i.checks.summary}. This is their own report; run your checks before relying on it.`, `對方的檢查：${i.checks.summary}。這是對方自己的報告，採用前請在你這邊重跑檢查。`)),
    (i.files || []).map((f) => h("div", { class: "lan-file" }, h("div", { class: "mono lbl" }, f.path), pre(f.text, { "data-lan-file": f.path }))),
    h("div", { class: "lan-row" }, approve(T("Accept the result", "收下結果"), () => ({})), reject));
  return h("div", { class: "lan-detail" }, head, h("div", { class: "lan-row" }, approve(T("Noted", "知道了"), () => ({}))));
}

// ---------- threads and the relay track ----------
function track(t) {
  const steps = t.steps.map((s) => h("li", {},
    h("button", { class: `lan-step${s.refused ? " bad" : ""}`, "data-lan-step": s.kind, onclick: () => inspect(s.entry) },
      h("span", { class: "vbadge", "data-kind": s.kind }, `r${s.round} ${kindName(s.kind)}`), who(s.who), when(s.at),
      s.refused ? h("span", { class: "badge bad", title: s.refused }, T("refused", "被拒")) : s.who.me && s.delivered === false ? h("span", { class: "badge" }, T("not delivered yet", "尚未送達")) : null)));
  // the run between an assignment and its result: the taker's own Task (on the taker's board), or the run its result names
  const out = [];
  t.steps.forEach((s, n) => { out.push(steps[n]); const r = t.rounds.find((x) => x.n === s.round);
    if (s.kind === "assign" && r && (r.run || r.result)) { const id = r.run?.id || r.result?.run, state = r.run?.state || T("their report", "對方的報告");
      out.push(h("li", {}, h("span", { class: "lan-step lan-run", "data-lan-run": id }, h("span", { class: "vbadge" }, `r${s.round} ${T("Run", "執行")}`),
        t.role === "taker" ? h("a", { class: "mono", href: `#/run/${encodeURIComponent(id)}` }, id) : h("span", { class: "mono" }, id), h("span", { class: "faint" }, state)))); } });
  return h("ol", { class: "lan-track", "data-lan-track": t.id, "aria-label": T("Every hand-off", "每一次交接") }, out);
}
function threadCard(t) {
  const r = t.rounds[t.rounds.length - 1], mine = t.role === "taker", run = r.run;
  const pv = LN.preview[t.id];
  return h("section", { class: "card lan-card", "data-lan-thread": t.id },
    h("div", { class: "card-h" }, icon("loop"), h("b", {}, t.title), h("span", { class: `badge ${t.state === "done" ? "ok" : t.now.mine ? "human" : "run"}` }, t.state === "done" ? T("Done", "已完成") : t.now.mine ? T("Your turn", "輪到你") : T("With them", "在對方那裡")),
      h("span", { class: "faint" }, mine ? T(`from ${t.owner.name}`, `來自 ${t.owner.name}`) : T(`to ${t.peer.name}`, `給 ${t.peer.name}`))),
    h("div", { class: "lan-body" },
      h("div", { class: "lan-now", "data-lan-now": t.id },
        h("div", { class: "kv" }, T("Where it is now", "現在在哪"), h("b", {}, T(t.now.where.en, t.now.where.zh))),
        h("div", { class: "kv" }, T("Who holds it", "誰拿著"), t.now.holder ? who(t.now.holder) : h("b", {}, "—")),
        h("div", { class: "kv" }, T("What's next", "下一步"), h("b", {}, T(t.now.next.en, t.now.next.zh)))),
      track(t),
      run ? h("p", { class: "faint" }, T("Task ", "Task "), h("a", { class: "mono", href: `#/run/${encodeURIComponent(run.id)}` }, run.id), ` · ${run.state}${run.stopped ? ` · ${run.stopped}` : ""}`) : null,
      // the taker: preview the exact bytes, then 交回
      mine && run?.state === "succeeded" && !r.result ? h("div", { class: "lan-handback", "data-lan-handback": t.id },
        h("button", { class: "btn", "data-lan-preview": t.id, onclick: () => act(T("Preview", "預覽"), async () => { LN.preview[t.id] = await postJ(`/api/lan/threads/${t.id}/handback/preview`, { edits: LN.edits[t.id] }); }) }, T("Preview what goes back", "預覽要交回的內容")),
        pv ? h("div", {}, h("p", { class: "faint" }, T(`${pv.files.length} file(s), ${pv.bytes} bytes, sealed to ${t.owner.name} only.`, `${pv.files.length} 個檔案、${pv.bytes} bytes，只加密給 ${t.owner.name}。`)),
          pv.protectedPaths.length ? h("p", { class: "lan-warn", "data-lan-protected": "" }, icon("alert", "ic sm"), T(`Refused: it changes ${pv.protectedPaths.join(", ")} (CI, git hooks or package scripts).`, `拒絕：它改了 ${pv.protectedPaths.join("、")}（CI、git hooks 或 package scripts）。`)) : null,
          pv.secrets.length ? h("p", { class: "lan-warn", "data-lan-secrets": "" }, icon("alert", "ic sm"), T(`Blocked: ${pv.secrets.length} secret or private hit(s): ${pv.secrets.map((s) => `${s.path}:${s.line}`).join(", ")}. Edit them out below and preview again.`, `擋下：${pv.secrets.length} 處 secret 或私人資訊：${pv.secrets.map((s) => `${s.path}:${s.line}`).join("、")}。請在下面刪掉後再預覽。`)) : null,
          pv.files.map((f) => { const e = ((LN.edits[t.id] ||= []).find((x) => x.path === f.path)); const box = { v: e ? e.text : f.text };
            return h("div", { class: "lan-file" }, h("div", { class: "mono lbl" }, f.path), h("textarea", { class: "lan-edit", rows: 6, "data-lan-edit": f.path, oninput: (ev) => { const list = (LN.edits[t.id] ||= []); const x = list.find((y) => y.path === f.path); if (x) x.text = ev.target.value; else list.push({ path: f.path, text: ev.target.value }); } }, box.v)); }),
          h("button", { class: "btn primary", "data-lan-handback-send": t.id, disabled: !pv.ok, onclick: () => act(T("Hand back", "交回"), async () => { await postJ(`/api/lan/threads/${t.id}/handback`, { confirm: pv.hash, edits: LN.edits[t.id] }); delete LN.preview[t.id]; delete LN.edits[t.id]; }) }, T("Hand back (交回)", "交回"))) : null) : null,
      // the dispatcher: refine or close once a result is in
      !mine && r.result && t.state === "open" ? h("div", { class: "lan-refine", "data-lan-refine": t.id },
        field(T("Refine: a new briefing for the next round", "再調整：下一輪的 briefing"), inp(LN.refine[t.id] ||= { text: "" }, "text", { rows: 3, "data-lan-refine-text": t.id })),
        h("div", { class: "lan-row" }, h("button", { class: "btn", "data-lan-refine-send": t.id, onclick: () => act(T("Refine", "再調整"), async () => { await postJ(`/api/lan/threads/${t.id}/refine`, { briefing: LN.refine[t.id].text }); LN.refine[t.id].text = ""; }) }, T("Send refinement", "送出調整")),
          h("button", { class: "btn primary", "data-lan-done": t.id, onclick: () => act(T("Done", "結案"), () => postJ(`/api/lan/threads/${t.id}/done`)) }, T("Mark done", "結案")))) : null,
      !mine && t.state === "open" && !r.result ? h("button", { class: "btn ghost", "data-lan-withdraw": t.id, onclick: () => { if (confirm(T("Withdraw this work? They cannot be forced to delete what they already have.", "撤回這件工作？對方已經拿到的內容無法強制刪除。"))) act("", () => postJ(`/api/lan/threads/${t.id}/withdraw`, {})); } }, T("Withdraw", "撤回")) : null));
}
async function inspect(hash) {
  try { LN.insp = await getJ(`/api/lan/entries/${hash}`); } catch (e) { toast(String(e.message || e)); return; }
  const e = LN.insp, row = (k, v) => h("div", { class: "kv" }, k, h("b", { class: "mono" }, v ?? "—"));
  const body = h("div", { class: "lan-insp", "data-lan-inspector": e.hash },
    row(T("Signed by", "簽章者"), `${e.signer.me ? T("Me", "我") : e.signer.name} · ${e.signer.fp}`), row(T("Signature", "簽章"), e.signature === "valid" ? T("valid", "合法") : T("invalid", "不合法")),
    row(T("Full key", "完整公鑰"), e.signerKey), row(T("Entry", "條目"), `${e.kind} · ${T("round", "第")} ${e.round} · seq ${e.seq}`), row(T("Previous", "前一筆"), e.prev), row(T("Entry hash", "條目雜湊"), e.hash),
    row(T("Briefing", "Briefing 雜湊"), e.briefing), row(T("Workflow", "流程"), e.workflow ? `${e.workflow.id}@v${e.workflow.version} · ${e.workflow.defHash}` : null),
    row(T("Time it claims", "對方宣稱的時間"), e.claimedTime), row(T("Sent to", "收件者"), e.to.map((x) => x.me ? T("me", "我") : x.name).join(", ")),
    e.forkNote ? h("p", { class: "lan-warn" }, e.forkNote) : null);
  const root = $("#modalRoot"), close = () => root.replaceChildren(), title = T("Entry inspector", "條目檢視");
  const ok = h("button", { class: "btn primary", "data-lan-inspector-close": "", onclick: close }, T("Close", "關閉"));
  const back = h("div", { class: "modal-back", onclick: (ev) => { if (ev.target === back) close(); } }, h("div", { class: "modal lan-modal", role: "dialog", "aria-modal": "true", "aria-label": title }, h("h2", {}, title), body, h("div", { class: "actions", style: "justify-content:flex-end" }, ok)));
  root.replaceChildren(back); ok.focus(); back.addEventListener("keydown", (ev) => { if (ev.key === "Escape") close(); });
}
function viewLan(arg) {
  const v = LN.v;
  if (!v) { load(); return h("div", { class: "page" }, h("div", { class: "skel", style: "height:180px" })); }
  if (!LN.wf) getJ("/api/lan/workflows").then((j) => { LN.wf = j.workflows; if (onPage() && !typing()) render(); }).catch(() => {});
  const threads = v.threads || [], focus = arg ? threads.find((t) => t.id === arg) : null;
  return h("div", { class: "page lan-page", "data-lan": "" },
    h("div", { class: "phead" }, h("div", {}, h("h1", {}, T("Peers", "區網同事")), h("p", {}, T("Work with colleagues' Studios on this network: introduced in person, encrypted to each of them, nothing starts or leaves without you.", "和同一個網路上同事的 Studio 協作：當面引介、只加密給對方，沒有你核准什麼都不會開始、也不會送出。")))),
    LN.err ? h("p", { class: "lan-warn" }, LN.err) : null,
    h("div", { class: "lan-top" }, myAddress(v), introductions(v), peers(v)),
    h("div", { class: "lan-col" }, inbox(v), focus ? threadCard(focus) : null, ...threads.filter((t) => t !== focus).map(threadCard), dispatchForm(v)));
}
routes.lan = viewLan;
load();
})();
