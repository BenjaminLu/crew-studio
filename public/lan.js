// Board-to-board work (docs/units/lan-relay.md): #/lan[/<thread>]. My address (fingerprint, device name, copy), the
// introduction (a window of a few minutes, the short code both screens show, typed in to confirm), introduced peers
// (petname, what they call themselves, fingerprint, where they say their identity is kept, unpair, remove, a frozen
// author's two entries, a peer that changed identity), this Studio's own identity (where it is kept, 作廢並換新身分, an
// identity that is gone), dispatching work, the inbox of received items (approve, take with a workflow, reject), and
// each work thread's relay track: where it is now, who holds it, every hand-off with device and time, what comes next.
// Everything a peer wrote is drawn as text nodes (kit.js h()): never as HTML, never as SVG, never in a frame of this
// origin. The approver sees the full briefing and the exact prompt the agent will get. Loaded before backbone.js.
(() => {
const LN = { applyTo: {}, projects: null, v: null, wf: null, err: null, sel: null, item: null, form: { title: "", briefing: "", acceptance: "", workflow: "", to: "", project: "" }, intro: { host: "", port: "" }, codes: {}, names: {}, replaces: {}, keepName: {}, take: {}, refine: {}, preview: {}, edits: {}, busy: false, insp: null, scrolled: {} };
window.crewLan = LN;
const getJ = async (u) => { const r = await fetch(u); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j; };
const postJ = async (u, b) => { const r = await fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b ?? {}) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { code: j.code }); return j; };
const onPage = () => S.route?.name === "lan";
const typing = () => { const a = document.activeElement; return !!a && a.closest?.("[data-lan]") && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName); };
async function load() {
  try { LN.v = await getJ("/api/lan"); LN.err = null; } catch (e) { LN.err = String(e.message || e); if (/區網協作啟動中/.test(LN.err)) setTimeout(() => { void load(); }, 2000); } // starting: the relay opens in the background
  if (onPage() && !LN.wf) { try { LN.wf = (await getJ("/api/lan/workflows")).workflows; } catch {} }
  if (onPage() && !LN.projects) { try { const p = await getJ("/api/projects"); LN.projects = (Array.isArray(p) ? p : p.projects || []).filter((x) => x.enabled !== false && x.path); } catch { LN.projects = []; } }
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

const STORE = { enclave: ["the Secure Enclave of this Mac (Touch ID for introductions and revocations)", "這台 Mac 的 Secure Enclave（引介與作廢需 Touch ID）"], "soft-enclave": ["a test stand-in for the Secure Enclave", "Secure Enclave 的測試替身"], file: ["files in Studio's data folder", "Studio 資料夾裡的檔案"] };
const storeName = (k) => T(STORE[k]?.[0] ?? k, STORE[k]?.[1] ?? k);
/** this Studio's identity cannot be used (fail closed): replace it */
function lostIdentity(v) {
  return h("section", { class: "card lan-card", "data-lan-lost": "" },
    h("div", { class: "card-h" }, icon("alert"), h("b", {}, T("This Studio's identity is gone", "這台 Studio 的身分已遺失"))),
    h("div", { class: "lan-body" },
      h("p", { class: "lan-warn", role: "alert" }, icon("alert", "ic sm"), T(`Board-to-board work is off: ${v.lost}. Nothing is signed or sent until you replace it.`, `區網協作已停止：${v.lost}。換新身分之前不會簽署或傳送任何東西。`)),
      h("p", { class: "faint" }, T("Replacing it makes a new identity and sets the old store aside. Your peers cannot be told (the old keys are gone): each of them replaces you in person, with the short code.", "換新身分會建立新的身分，舊的資料先放到一旁。舊金鑰已遺失，無法通知同事：每位同事都要當面用短碼重新引介並取代你。")),
      h("button", { class: "btn danger", "data-lan-replace-lost": "", onclick: () => { if (confirm(T("Make a new identity? Every peer introduces you again.", "建立新身分？每位同事都要重新引介你。"))) act("", () => postJ("/api/lan/identity/replace-lost", {})); } }, T("Retire it and make a new identity", "作廢並換新身分"))));
}
function myAddress(v) {
  if (v.lost) return lostIdentity(v);
  const addr = v.host && v.port ? `${v.host}:${v.port}` : null;
  return h("section", { class: "card lan-card", "data-lan-me": "" },
    h("div", { class: "card-h" }, icon("link"), h("b", {}, T("My address", "我的地址")), h("span", { class: `badge ${v.listening ? "ok" : ""}` }, h("span", { class: "d" }), v.listening ? T("Listening", "已開啟") : T("Off", "關閉"))),
    h("div", { class: "lan-body" },
      h("div", { class: "kv" }, T("Device name", "裝置名稱"), h("b", {}, v.me.name)),
      h("div", { class: "kv" }, T("Fingerprint", "指紋"), fp(v.me.fingerprint)),
      h("div", { class: "kv" }, T("Address", "位址"), h("b", { class: "mono" }, addr || T("not listening", "未開啟"))),
      h("div", { class: "kv" }, T("Identity kept in", "身分存放"), h("b", { "data-lan-store": v.me.store }, storeName(v.me.store))),
      v.me.warning ? h("p", { class: "lan-warn", "data-lan-store-warning": "" }, icon("alert", "ic sm"), T(v.me.warning.en, v.me.warning.zh)) : null,
      v.me.adminGuard === "biometry" ? h("p", { class: "faint" }, T("The admin key works only with the fingerprints enrolled now: a change of fingerprints makes it unusable, and the identity must then be replaced in person.", "管理金鑰只認目前登錄的指紋：指紋一變更就無法使用，身分必須當面重新引介取代。")) : null,
      v.me.residual ? h("p", { class: "faint", "data-lan-residual": "" }, T(v.me.residual.en, v.me.residual.zh)) : null,
      v.me.fallback ? h("p", { class: "faint" }, v.me.fallback) : null,
      (v.retired || []).filter((r) => r.pending.length).map((r) => h("p", { class: "faint", "data-lan-retiring": r.key }, T(`The old identity's revocation still waits for ${r.pending.map((x) => x.to.name).join(", ")} (its keys are deleted once it reached them).`, `舊身分的作廢通知還在等 ${r.pending.map((x) => x.to.name).join("、")}（送達後才刪除舊金鑰）。`),
        " ", h("button", { class: "btn ghost", onclick: () => { if (confirm(T("Stop trying and delete the old keys now?", "不再嘗試，現在刪除舊金鑰？"))) act("", () => postJ("/api/lan/identity/drop-retired", { key: r.key })); } }, T("Delete the old keys now", "現在刪除舊金鑰")))),
      h("div", { class: "lan-row" },
        h("button", { class: "btn", "data-lan-copy": "", onclick: () => copy(`${v.me.name} · ${addr ?? "—"} · ${v.me.fingerprint}`) }, icon("copy"), T("Copy", "複製")),
        h("button", { class: `btn ${v.listening ? "" : "primary"}`, "data-lan-toggle": "", onclick: () => act(T("Listener", "監聽"), () => postJ("/api/lan/settings", { enabled: !v.enabled })) }, v.listening ? T("Turn off", "關閉") : T("Turn on", "開啟")),
        h("button", { class: "btn ghost", "data-lan-ceilings": "", onclick: () => { const c = v.ceilings; const usd = prompt(T("Daily dollar ceiling over all work from peers (empty: off)", "所有同事工作的每日金額上限（空白：關閉）"), c.dailyUsd === null ? "" : String(c.dailyUsd)); if (usd === null) return; const rounds = prompt(T("Daily round ceiling", "每日輪數上限"), String(c.dailyRounds)); if (rounds === null) return;
          act("", () => postJ("/api/lan/settings", { ceilings: { dailyUsd: usd.trim() === "" ? null : Number(usd), dailyRounds: Number(rounds) } })); } }, T(`Daily ceilings: ${v.ceilings?.dailyUsd === null ? "no $" : `$${v.ceilings?.dailyUsd}`} · ${v.ceilings?.dailyRounds} rounds`, `每日上限：${v.ceilings?.dailyUsd === null ? "不限金額" : `$${v.ceilings?.dailyUsd}`} · ${v.ceilings?.dailyRounds} 輪`)),
        v.me.store === "file" ? h("button", { class: "btn", "data-lan-upgrade": "", onclick: () => { if (confirm(T("Move this Studio's identity into the Secure Enclave? This is a new identity: the old one is revoked and every peer introduces you again.", "把身分移到 Secure Enclave？這是一個新身分：舊身分會作廢，每位同事都要重新引介你。"))) { const bio = confirm(T("Biometry only? The admin key then works only with the fingerprints enrolled now: a change of fingerprints makes it unusable for good. Cancel keeps Touch ID or your password.", "只用生物辨識？管理金鑰之後只認目前登錄的指紋：指紋一變更就永久無法使用。按取消則保留 Touch ID 或密碼。")); act("", () => postJ("/api/lan/identity/retire", { kind: "enclave", biometry: bio })); } } }, T("Upgrade to the Secure Enclave", "升級到 Secure Enclave")) : null,
        h("button", { class: "btn danger", "data-lan-retire": "", onclick: () => { if (confirm(T("Retire this identity and make a new one? Your peers are told (signed by this Mac's admin key), they freeze the old one, and each introduces the new one in person. Open threads close.", "作廢這個身分並換新？會通知同事（由這台的管理金鑰簽署），他們會凍結舊身分，並各自當面引介新身分。進行中的工作串會關閉。"))) act("", () => postJ("/api/lan/identity/retire", {})); } }, T("Retire and make a new identity", "作廢並換新身分"))),
      h("p", { class: "faint lan-note" }, T("Only introduced Studios can talk to this listener, over an encrypted channel bound to their full keys. Browsers cannot reach it.", "只有當面引介過的 Studio 能連這個監聽，通道以雙方完整公鑰加密並互相驗證；瀏覽器無法連入。"))));
}
function introductions(v) {
  const open = v.introOpenUntil && Date.parse(v.introOpenUntil) > Date.now();
  return h("section", { class: "card lan-card", "data-lan-intros": "" },
    h("div", { class: "card-h" }, icon("human"), h("b", {}, T("Introduce in person", "當面引介")), open ? h("span", { class: "badge human" }, T(`open until ${clock(v.introOpenUntil)}`, `開放到 ${clock(v.introOpenUntil)}`)) : null),
    h("div", { class: "lan-body" },
      h("p", { class: "faint" }, T("To exchange anything, sit together: one side opens its window, the other enters its address, and both type the code the other screen shows.", "要交換任何東西，請坐在一起：一方開放引介，另一方輸入它的位址，雙方各自輸入對方螢幕上的短碼。")),
      h("div", { class: "lan-row" }, open ? h("button", { class: "btn", "data-lan-intro-close": "", onclick: () => act("", () => postJ("/api/lan/intro/close")) }, T("Close the window", "關閉引介"))
        : h("button", { class: "btn", "data-lan-intro-open": "", disabled: !v.listening, onclick: () => act("", () => postJ("/api/lan/intro/open", { minutes: 5 })) }, T("Open for 5 minutes", "開放引介 5 分鐘"))),
      h("div", { class: "lan-grid2" }, field(T("Their address (IP)", "對方位址（IP）"), inp(LN.intro, "host", { id: "lanIntroHost", placeholder: "192.168.1.23" })), field(T("Port", "埠"), inp(LN.intro, "port", { id: "lanIntroPort", placeholder: "7417", inputmode: "numeric" }))),
      h("button", { class: "btn primary", "data-lan-intro-start": "", disabled: !v.listening, onclick: () => act(T("Introduction", "引介"), () => postJ("/api/lan/intro/start", { host: LN.intro.host.trim(), port: Number(LN.intro.port) })) }, T("Introduce", "引介")),
      (v.introFailures || []).length ? h("div", { class: "lan-warn", role: "alert", "data-lan-intro-failures": "" }, icon("alert", "ic sm"), T(`${v.introFailures.length} introduction(s) failed (${v.introFailures.map((f) => `${f.ip}: ${f.why}`).join("; ")}). Someone may be trying to match your short code; three close the window.`, `有 ${v.introFailures.length} 次引介失敗（${v.introFailures.map((f) => `${f.ip}：${f.why}`).join("；")}）。可能有人在試著配出你的短碼；失敗三次會關閉引介。`)) : null,
      ...(v.intros || []).map((i) => h("div", { class: "lan-intro", "data-lan-intro": i.id },
        h("div", { class: "lan-sas", "aria-label": T(`This screen's code ${i.sas}`, `這個螢幕的短碼 ${i.sas}`) }, h("span", { class: "faint" }, T("This screen shows", "這個螢幕顯示")), h("b", { class: "num" }, `${i.sas.slice(0, 3)} ${i.sas.slice(3)}`)),
        h("div", { class: "kv" }, T("They call themselves", "自稱"), h("b", {}, i.claimed || "—")),
        h("div", { class: "kv" }, T("They say their identity is kept in", "對方自稱身分存放"), h("b", { class: "faint" }, i.storage === "secure-enclave" ? "Secure Enclave" : i.storage === "file" ? T("files (no Touch ID protection)", "檔案（沒有 Touch ID 保護）") : i.storage || "—")),
        (i.successorOf || []).map((o) => h("p", { class: o.certified ? "faint" : "lan-warn", "data-lan-successor": o.key }, o.certified ? T(`Certified successor of ${o.petname} (its old identity named this one when it retired). Still confirm the code in person.`, `${o.petname} 的認證繼任身分（舊身分作廢時指名了它）。仍請當面確認短碼。`) : T(`Says it replaces ${o.petname}, but it is not certified by the old identity: confirm in person.`, `自稱取代 ${o.petname}，但沒有舊身分的認證：請當面確認。`))),
        i.similar?.length ? h("p", { class: "lan-warn" }, icon("alert", "ic sm"), T(`Looks like a peer you already know (${i.similar.join(", ")}): check the fingerprint.`, `和你已知的同事（${i.similar.join("、")}）名字相近：請比對指紋。`)) : null,
        h("div", { class: "kv" }, T("Their fingerprint", "對方指紋"), fp(i.fp)),
        h("div", { class: "lan-grid2" }, field(T("Code on their screen", "對方螢幕上的短碼"), inp(LN.codes, i.id, { "data-lan-code": i.id, inputmode: "numeric", autocomplete: "off", placeholder: "000 000" })), field(T("Your name for them", "你替對方取的名字"), inp(LN.names, i.id, { "data-lan-petname": i.id }))),
        // replacing a peer (a lost or stolen Mac, a new identity) happens only here, at the code, in person
        (v.peers || []).some((p) => p.state === "trusted" || p.state === "retired") ? field(T("This identity replaces (only after checking in person)", "這個身分取代（當面確認後才選）"), h("select", { "data-lan-replaces": i.id, onchange: (e) => { LN.replaces[i.id] = e.target.value; } }, h("option", { value: "" }, T("no one: a new peer", "沒有：新同事")),
          (v.peers || []).filter((p) => p.state === "trusted" || p.state === "retired").map((p) => h("option", { value: p.key, selected: LN.replaces[i.id] === p.key }, `${p.petname} · ${p.fp.split(" ").slice(0, 2).join(" ")}${p.state === "retired" ? T(" (retired)", "（已作廢）") : ""}`)))) : null,
        LN.replaces[i.id] ? h("p", { class: "lan-warn" }, icon("alert", "ic sm"), T("The replaced peer is revoked for good: its open items and Tasks stop, its threads close, and what it applied stays marked as from a replaced identity.", "被取代的同事會永久撤銷：待處理項目與 Task 停止、工作串關閉，它套用過的 commit 會標示為來自被取代的身分。")) : null,
        LN.replaces[i.id] ? h("label", { class: "lan-row" }, h("input", { type: "checkbox", "data-lan-keep-name": i.id, checked: !!LN.keepName[i.id], onchange: (e) => { LN.keepName[i.id] = e.target.checked; } }), T("Keep the name I gave the replaced peer", "沿用我替被取代同事取的名字")) : null,
        h("div", { class: "lan-row" }, h("button", { class: "btn primary", "data-lan-confirm": i.id, onclick: () => act(T("Confirm", "確認"), () => postJ(`/api/lan/intro/${i.id}/confirm`, { code: LN.codes[i.id] || "", petname: LN.names[i.id] || "", replaces: LN.replaces[i.id] || null, keepName: !!LN.keepName[i.id] })) }, T("Codes match: add", "短碼相符，加入")),
          h("button", { class: "btn ghost", onclick: () => act("", () => postJ(`/api/lan/intro/${i.id}/cancel`)) }, T("Cancel", "取消")))))));
}
function peers(v) {
  const list = (v.peers || []).filter((p) => p.state === "trusted" || p.state === "retired" || p.frozen);
  return h("section", { class: "card lan-card", "data-lan-peers": "" },
    h("div", { class: "card-h" }, icon("crew"), h("b", {}, T("Introduced peers", "已引介的同事")), h("span", { class: "badge" }, String(list.length))),
    h("div", { class: "lan-body" }, list.length ? list.map((p) => h("div", { class: `lan-peer${p.frozen ? " frozen" : ""}`, "data-lan-peer": p.key },
      h("div", { class: "lan-row" }, h("b", {}, p.petname), p.claimed && p.claimed !== p.petname ? h("span", { class: "faint" }, T(`calls itself ${p.claimed}`, `自稱 ${p.claimed}`)) : null, p.state === "revoked" ? h("span", { class: "badge bad" }, T("revoked", "已撤銷")) : null),
      p.notice ? h("p", { class: "lan-warn", role: "status", "data-lan-peer-notice": p.key }, icon("alert", "ic sm"), T(p.notice.en, p.notice.zh)) : null,
      p.state === "retired" && p.retired?.successor ? h("p", { class: "faint" }, T(`It names a successor ${p.retired.successor.fp} (${p.retired.successor.certified ? "certified by both keys" : "not certified"}). Introduce it in person to work together again.`, `它指名了繼任身分 ${p.retired.successor.fp}（${p.retired.successor.certified ? "新舊金鑰都已認證" : "未認證"}）。請當面引介後再合作。`)) : null,
      h("div", { class: "kv" }, T("Fingerprint", "指紋"), fp(p.fp)), h("div", { class: "kv" }, T("Address", "位址"), h("b", { class: "mono" }, `${p.host}:${p.port}`)),
      p.unreachableSince ? h("p", { class: "faint", "data-lan-unreachable": p.key }, T(`Unreachable since ${clock(p.unreachableSince)}: what is waiting is sent when it answers.`, `從 ${clock(p.unreachableSince)} 起連不上：等它回應時會送出等待中的內容。`)) : null,
      h("div", { class: "kv" }, T("They say their identity is kept in", "對方自稱身分存放"), h("b", { class: "faint" }, p.storage === "secure-enclave" ? "Secure Enclave" : p.storage === "file" ? T("files (no Touch ID protection)", "檔案（沒有 Touch ID 保護）") : p.storage || "—")),
      p.frozen ? h("div", { class: "lan-frozen", role: "alert", "data-lan-frozen": p.key },
        h("p", {}, icon("alert", "ic sm"), h("b", {}, T("Frozen: a fork in this peer's log", "已凍結：此同事的帳本出現分岔")), " ", T(`Two different entries carry sequence number ${p.frozen.seq}, and both signatures are valid. Studio cannot tell which one the peer meant: the key may be stolen or the peer may be acting against you. Check with them in person.`, `序號 ${p.frozen.seq} 上有兩筆不同的條目，兩筆的簽章都合法。Studio 無法判斷哪一筆是對方本意：金鑰可能被偷，或對方在對你做不同的陳述。請當面確認。`)),
        h("div", { class: "lan-fork" }, [p.frozen.a, p.frozen.b].map((e, n) => e ? h("button", { class: "lan-step", "data-lan-fork-entry": e.hash, onclick: () => inspect(e.hash) }, h("b", {}, T(`Entry ${n + 1}`, `條目 ${n + 1}`)), h("span", { class: "mono faint" }, e.hash.slice(0, 12)), h("span", {}, `${e.kind ?? "?"} · ${T("signature valid", "簽章合法")}`)) : null)),
        h("div", { class: "lan-row" }, h("button", { class: "btn danger", "data-lan-fork-revoke": p.key, onclick: () => act("", () => postJ(`/api/lan/peers/${p.key}/resolve`, { action: "revoke" })) }, T("Revoke this key", "撤銷這把金鑰")),
          h("button", { class: "btn", "data-lan-fork-unfreeze": p.key, onclick: () => { if (confirm(T("Unfreeze only after checking with them in person.", "請在當面確認後才解除凍結。"))) act("", () => postJ(`/api/lan/peers/${p.key}/resolve`, { action: "unfreeze" })); } }, T("Checked in person: unfreeze", "已當面確認，解除凍結")))) : null,
      p.state === "trusted" ? h("div", { class: "lan-row" },
        h("button", { class: "btn ghost", onclick: () => { const n = prompt(T("Your name for this peer", "你替這位同事取的名字"), p.petname); if (n) act("", () => postJ(`/api/lan/peers/${p.key}/rename`, { petname: n })); } }, T("Rename", "改名")),
        h("button", { class: "btn ghost", "data-lan-unpair": p.key, onclick: () => { if (confirm(T("Unpair? Its open items are withdrawn and its Tasks stop.", "解除配對？它的待處理項目會撤回，進行中的 Task 會停止。"))) act("", () => postJ(`/api/lan/peers/${p.key}/unpair`)); } }, T("Unpair", "解除配對")),
        h("button", { class: "btn danger", "data-lan-revoke": p.key, onclick: () => { if (confirm(T("Remove this colleague for good (a lost or stolen Mac)? Its open items and Tasks stop and it can never be introduced again.", "永久移除這個同事（Mac 遺失或被偷）？它的待處理項目與 Task 會停止，之後也不能再引介。"))) act("", () => postJ(`/api/lan/peers/${p.key}/revoke`)); } }, T("Remove this colleague", "移除這個同事"))) : null))
      : h("p", { class: "faint" }, T("No one yet. Introduce a colleague in person to start.", "還沒有。先當面引介一位同事。"))));
}
/** commits this Studio applied from a peer's work: nothing trusted starts from them or publishes them until reviewed */
function taints(v) {
  // one row per commit (it may be recorded in several folders: it is tainted in every repository that holds it)
  const list = [...new Map((v.taints || []).map((t) => [t.sha, t])).values()];
  if (v.taintProblem) return h("section", { class: "card lan-card", "data-lan-taints": "", "data-lan-taint-problem": "" },
    h("div", { class: "card-h" }, icon("alert"), h("b", {}, T("The list of commits from peers cannot be read", "讀不到來自同事的 commit 清單"))),
    h("div", { class: "lan-body" }, h("p", { class: "lan-warn" }, icon("alert", "ic sm"), T(`Studio refuses every trusted start, review, merge and push until it can: ${v.taintProblem}`, `在能讀到之前，Studio 拒絕所有受信任的開始、送審、合併與推送：${v.taintProblem}`))));
  if (!list.length) return null;
  return h("section", { class: "card lan-card", "data-lan-taints": "" },
    h("div", { class: "card-h" }, icon("alert"), h("b", {}, T("Commits from peers, not reviewed", "來自同事、尚未審查的 commit")), h("span", { class: "badge human" }, String(list.length))),
    h("div", { class: "lan-body" },
      h("p", { class: "lan-warn" }, icon("alert", "ic sm"), T("Studio starts no trusted Task from these commits or anything built on them, sends none for review, merges or pushes none. Do not check a lan-untrusted/ branch out in a terminal, and do not ask Firstmate to review it: read the diff yourself.", "Studio 不會從這些 commit（或建立在它們之上的任何 commit）開始受信任的 Task、送審、合併或推送。不要在終端機 checkout lan-untrusted/ 分支，也不要請 Firstmate 審查：請自己讀 diff。")),
      list.map((t) => h("div", { class: "lan-row", "data-lan-taint": t.sha },
        h("b", { class: "mono" }, t.sha.slice(0, 12)), h("span", { class: "faint" }, `${t.project} · ${t.peer.name} · ${t.why}`),
        v.taintClear ? h("span", { class: "lan-warn", "data-lan-taint-clear-why": t.sha }, T(v.taintClear.en, v.taintClear.zh)) : h("button", { class: "btn", "data-lan-taint-clear": t.sha, onclick: () => { if (confirm(T(`You read commit ${t.sha.slice(0, 12)} yourself and keep it? It leaves this list (audited).`, `你親自讀過 commit ${t.sha.slice(0, 12)} 並要保留它？它會離開這個清單（會記入稽核）。`))) act("", () => postJ("/api/lan/taint/clear", { sha: t.sha })); } }, T(`I reviewed commit ${t.sha.slice(0, 7)}`, `我審查過 commit ${t.sha.slice(0, 7)}`))))));
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
      field(T("Code work on your project (they work from its current commit; the patch applies there)", "程式工作的專案（對方從它目前的 commit 開始；patch 只會套用在那裡）"), h("select", { id: "lanProject", onchange: (e) => { LN.form.project = e.target.value; } }, h("option", { value: "" }, T("Not code work", "不是程式工作")), (LN.projects || []).map((p) => h("option", { value: p.id, selected: p.id === LN.form.project }, p.name || p.id)))),
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
  const approve = (label, body, extra = {}) => h("button", { class: "btn primary", "data-lan-approve": i.id, disabled: frozen || !LN.scrolled[i.id], ...extra, onclick: () => act(label, async () => postJ(`/api/lan/items/${i.id}/approve`, await body())) }, label);
  if (i.kind === "dispatch" || i.kind === "refine") {
    const t = LN.take[i.id] ||= { workflow: (LN.wf || []).find((w) => w.eligible && w.id === i.suggested?.id)?.id || (LN.wf || []).find((w) => w.eligible)?.id || "", usd: "2", rounds: "6", provider: "", staffing: false, project: "", roundsOnly: false, autoStart: false };
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
      w?.mayStop?.length ? h("p", { class: "faint", "data-lan-may-stop": i.id }, T(`It may stop at ${w.mayStop.join(", ")}: a Task from a peer never runs those steps.`, `它可能停在 ${w.mayStop.join("、")}：同事的工作不會執行這些步驟。`)) : null,
      w?.output ? h("p", { class: "faint" }, w.output === "patch" ? T("It hands back one patch of what its worktree changed.", "它交回一份 patch（worktree 的變更）。") : T("It hands back the text files it made.", "它交回它產生的文字檔。")) : null,
      w?.needsProject ? field(T("Project (a code workflow works in its own worktree of it)", "專案（程式流程在它自己的 worktree 裡工作）"), h("select", { "data-lan-project": i.id, onchange: (e) => { t.project = e.target.value; } }, h("option", { value: "" }, T("Choose a project", "選擇專案")), (LN.projects || []).map((p) => h("option", { value: p.id, selected: p.id === t.project }, p.name || p.id)))) : null,
      h("label", { class: "lan-row" }, h("input", { type: "checkbox", "data-lan-rounds-only": i.id, checked: t.roundsOnly, onchange: (e) => { t.roundsOnly = e.target.checked; render(); } }), T("Rounds only: no dollar cap; every paid round of this Task, on any provider and judges included, counts toward the rounds cap", "只限輪數：不設金額上限；這個 Task 的每一輪付費 agent（任何供應商，含評審）都算進輪數上限")),
      t.roundsOnly ? h("p", { class: "lan-warn", "data-lan-estimate": i.id }, icon("alert", "ic sm"), (() => { const c = LN.v?.ceilings || { unknownRoundUsd: 1, dailyUsd: 20 }, n = Number(t.rounds) || 6;
        // the estimate a running round reserves: what this provider's rounds cost on this Mac, else the figure set for a round of unknown cost
        const e = (LN.v?.estimates || {})[t.provider], known = typeof e === "number", est = known ? e : c.unknownRoundUsd, total = (n * est).toFixed(2);
        const basis = known ? T(`what ${t.provider} rounds cost on this Mac so far`, `${t.provider} 在這台 Mac 上每輪的平均花費`) : T("the figure set for a round of unknown cost: no round of this provider reported one here yet", "未知花費一輪的設定值：這個供應商在這裡還沒有回報過花費");
        return T(`No dollar limit on this item. Estimated $${est.toFixed(2)} per round (${basis}): about ${n} rounds × $${est.toFixed(2)} = $${total}, an estimate, not a limit; every round is at most 15 minutes and 60 tool calls, and the daily ceiling over all work from peers${c.dailyUsd === null ? " is off" : ` ($${c.dailyUsd.toFixed(2)})`} still applies.`, `這個項目沒有金額上限。估計每輪 $${est.toFixed(2)}（${basis}）：約 ${n} 輪 × $${est.toFixed(2)} = $${total}，這是估計、不是上限；每輪最多 15 分鐘、60 次工具呼叫，所有同事工作的每日上限${c.dailyUsd === null ? "已關閉" : `（$${c.dailyUsd.toFixed(2)}）`}仍然有效。`); })()) : null,
      h("p", { class: "faint" }, T(`The agent reads all of ${t.project || "its folder"}; anything it reads may be in the hand-back.`, `agent 會讀 ${t.project || "它的資料夾"} 的全部內容；它讀到的任何東西都可能出現在交回的內容裡。`)),
      h("label", { class: "lan-row" }, h("input", { type: "checkbox", "data-lan-auto-start": i.id, checked: t.autoStart, onchange: (e) => { t.autoStart = e.target.checked; } }), T("Start as soon as they assign it, with this exact cap (for 30 minutes; every check is made again then, and you get a notice and a stop button)", "對方一指派就開工，用這個上限（30 分鐘內有效；開工時會重新檢查，並通知你、附停止按鈕）")),
      w?.staffing ? h("label", { class: "lan-row" }, h("input", { type: "checkbox", checked: t.staffing, onchange: (e) => { t.staffing = e.target.checked; } }), T("I confirm who works on each node of this workflow", "我確認這個流程每個節點的人員配置")) : null,
      h("p", { class: "faint" }, T("Runs in a fresh folder under the restricted profile: the OS sandbox, its provider only on the network, no push, no pull request, no tests that listen, no CI or hook edits.", "在新的資料夾、受限 profile 下執行：OS sandbox、網路只到 provider、不能 push 或開 PR、不跑會開監聽的測試、不能改 CI 或 hooks。")),
      h("div", { class: "lan-row" }, approve(T("Take with this workflow", "用這個流程接下"), async () => ({ workflow: t.workflow, usd: Number(t.usd), roundsOnly: !!t.roundsOnly, rounds: Number(t.rounds), provider: t.provider || null, project: t.project || null, staffingConfirm: t.staffing ? w?.staffing?.hash : null, autoStart: !!t.autoStart, seen: await seenOf(i.prompt) })), reject));
  }
  LN.scrolled[i.id] ??= true;
  if (i.kind === "take") return h("div", { class: "lan-detail" }, head, h("p", {}, T(`${i.from.name} wants to take round ${i.round} with their ${i.workflow.id} v${i.workflow.version} (${i.workflow.defHash.slice(0, 12)}), capped at ${i.cap.usd === null ? "rounds only" : `$${i.cap.usd}`} and ${i.cap.rounds} rounds.`, `${i.from.name} 要用他自己的 ${i.workflow.id} v${i.workflow.version}（${i.workflow.defHash.slice(0, 12)}）接第 ${i.round} 輪，上限 ${i.cap.usd === null ? "只限輪數" : `$${i.cap.usd}`}、${i.cap.rounds} 輪。`)),
    h("div", { class: "lan-row" }, approve(T(`Assign to ${i.from.name}`, `指派給 ${i.from.name}`), () => ({})), reject));
  if (i.kind === "assign") return h("div", { class: "lan-detail" }, head, h("p", {}, T("The dispatcher assigned this round to you. Start it on this Mac under the restricted profile?", "派工者把這一輪指派給你。要在這台 Mac 上以受限 profile 開工嗎？")),
    // the start click shows what it starts
    h("div", { class: "kv" }, T("Prompt (SHA-256)", "Prompt（SHA-256）"), h("b", { class: "mono", "data-lan-start-hash": i.id }, i.promptHash ? i.promptHash.slice(0, 16) : "—")),
    i.cap ? h("div", { class: "kv" }, T("Cap", "上限"), h("b", {}, i.cap.usd === null ? T(`rounds only: ${i.cap.rounds} rounds, no dollar limit`, `只限輪數：${i.cap.rounds} 輪，沒有金額上限`) : T(`$${i.cap.usd} and ${i.cap.rounds} rounds`, `$${i.cap.usd}、${i.cap.rounds} 輪`))) : null,
    i.workflow ? h("div", { class: "kv" }, T("Workflow", "流程"), h("b", {}, `${i.workflow.id} v${i.workflow.version}`)) : null,
    h("div", { class: "kv" }, T("Project", "專案"), h("b", {}, i.project || T("its own new folder", "自己的新資料夾"))),
    h("div", { class: "lan-row" }, approve(T("Start (restricted profile)", "開工（受限 profile）"), () => ({})), reject));
  if (i.kind === "result") return h("div", { class: "lan-detail" }, head,
    i.flags?.includes("workflow-mismatch") ? h("p", { class: "lan-warn", "data-lan-flag": "workflow-mismatch" }, icon("alert", "ic sm"), T(`The result names ${i.workflow.id} (${i.workflow.defHash.slice(0, 12)}), not the workflow its take named (${i.takeWorkflow?.defHash?.slice(0, 12) ?? "?"}).`, `結果宣稱用的流程是 ${i.workflow.id}（${i.workflow.defHash.slice(0, 12)}），和接下時說的（${i.takeWorkflow?.defHash?.slice(0, 12) ?? "?"}）不同。`)) : null,
    h("p", { class: "faint" }, T(`Their checks: ${i.checks.summary}. This is their own report; run your checks before relying on it.`, `對方的檢查：${i.checks.summary}。這是對方自己的報告，採用前請在你這邊重跑檢查。`)),
    (i.files || []).map((f) => h("div", { class: "lan-file" }, h("div", { class: "mono lbl" }, f.path), pre(f.text, { "data-lan-file": f.path }))),
    h("div", { class: "lan-row" }, approve(T("Accept the result", "收下結果"), () => ({})), reject));
  return h("div", { class: "lan-detail" }, head, h("div", { class: "lan-row" }, approve(T("Noted", "知道了"), () => ({}))));
}
/** What an approval of a dispatch or a refinement names: the hash of the exact prompt this page showed (the server checks it). */
async function seenOf(prompt) { const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`lan-seen\0${prompt ?? ""}`)); return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
/** A code result on the dispatcher's side: apply its patch to one of this Studio's projects, on a branch of its own. */
function applyPatch(t, r) {
  const a = (LN.applyTo[t.id] ||= { project: "" });
  return h("div", { class: "lan-apply", "data-lan-apply": t.id },
    h("p", { class: "faint" }, T("A code result is a patch. Applying it makes a branch lan-untrusted/… in one of your projects; nothing is merged, built or tested. Review it like any untrusted change.", "程式結果是一份 patch。套用後會在你的專案裡開一條 lan-untrusted/… 分支；不會合併、建置或跑測試。請當作不受信任的變更來審查。")),
    h("div", { class: "lan-row" }, h("select", { "data-lan-apply-project": t.id, onchange: (e) => { a.project = e.target.value; } }, h("option", { value: "" }, T("Choose a project", "選擇專案")), (LN.projects || []).map((p) => h("option", { value: p.id, selected: p.id === a.project }, p.name || p.id))),
      h("button", { class: "btn", "data-lan-apply-send": t.id, "data-lan-approve": `patch-${t.id}-${r.n}`, ...(r.result.accepted ? {} : { "data-blocked": "1" }), disabled: !LN.scrolled[`patch-${t.id}-${r.n}`] || !r.result.accepted, onclick: () => act(T("Apply", "套用"), async () => { const d = await postJ(`/api/lan/threads/${t.id}/apply`, { project: a.project, round: r.n, seen: await sha256Hex(r.result.patch ?? "") }); toast(T(`Applied on ${d.branch}`, `已套用到 ${d.branch}`)); }) }, T("Apply the patch", "套用 patch"))),
    // the exact patch, read to its end before it can be applied (the apply names the hash of these bytes)
    r.result.patch !== null && r.result.patch !== undefined ? scrollGate(`patch-${t.id}-${r.n}`, h("pre", { class: "lan-patch", "data-lan-patch": t.id }, r.result.patch)) : null,
    !r.result.accepted ? h("p", { class: "faint" }, T("Accept the result in the inbox first.", "請先在收件匣接受這個結果。")) : null,
    t.base ? h("p", { class: "faint" }, T(`Based on your commit ${t.base.sha.slice(0, 12)}: it applies there, never onto another base.`, `基於你的 commit ${t.base.sha.slice(0, 12)}：只套用在那裡，不會套到別的基底。`)) : null);
}
async function sha256Hex(text) { const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)); return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join(""); }

// ---------- threads and the relay track ----------
function track(t) {
  const steps = t.steps.map((s) => h("li", {},
    h("button", { class: `lan-step${s.refused ? " bad" : ""}`, "data-lan-step": s.kind, onclick: () => inspect(s.entry) },
      h("span", { class: "vbadge", "data-kind": s.kind }, `r${s.round} ${kindName(s.kind)}`), who(s.who), when(s.at),
      s.refused ? h("span", { class: "badge bad", title: s.refused }, T("refused", "被拒")) : s.waiting ? h("span", { class: "badge", "data-lan-waiting": s.entry, title: s.waiting }, T(`waiting: ${s.waiting}`, `等待中：${s.waiting}`)) : s.who.me && s.delivered === false ? h("span", { class: "badge" }, T("not delivered yet", "尚未送達")) : null)));
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
      run && run.state === "gone" ? h("p", { class: "lan-warn", "data-lan-gone": t.id }, icon("alert", "ic sm"), T("This round's Task is gone (Studio stopped while it started, or the Task was removed). It is never started again from this round: the dispatcher refines, and you take the new round.", "這一輪的 Task 不見了（Studio 在開工時停止，或 Task 被移除）。這一輪不會再開工：請派工者再調整一輪，你再接。")) :
      run ? h("p", { class: "faint" }, T("Task ", "Task "), h("a", { class: "mono", href: `#/run/${encodeURIComponent(run.id)}` }, run.id), ` · ${run.state}${run.stopped ? ` · ${run.stopped}` : ""}`, run.spent ? ` · ${T(`spent $${run.spent.usd.toFixed(2)}, ${run.spent.rounds} round(s)`, `已花 $${run.spent.usd.toFixed(2)}、${run.spent.rounds} 輪`)}` : "", run.found ? h("span", { class: "badge", "data-lan-found": t.id }, T("found after restart", "重新啟動後找回")) : null) : null,
      run?.auto ? h("p", { class: "lan-warn", "data-lan-auto-started": t.id }, icon("alert", "ic sm"), T("Started by itself when it was assigned (you opted in at the take).", "對方指派後自動開工（你在接下時選了自動開工）。")) : null,
      mine && run && ["running", "waiting", "queued", "starting"].includes(run.state) && !run.id.startsWith("(") ? h("button", { class: "btn danger", "data-lan-stop": t.id, onclick: () => act(T("Stop", "停止"), () => postJ(`/api/lan/threads/${t.id}/stop`, {})) }, T("Stop this Task", "停止這個 Task")) : null,
      // the taker: preview the exact bytes, then 交回
      mine && run?.state === "succeeded" && !r.result ? h("div", { class: "lan-handback", "data-lan-handback": t.id },
        h("button", { class: "btn", "data-lan-preview": t.id, onclick: () => act(T("Preview", "預覽"), async () => { LN.preview[t.id] = await postJ(`/api/lan/threads/${t.id}/handback/preview`, { edits: LN.edits[t.id] }); }) }, T("Preview what goes back", "預覽要交回的內容")),
        pv ? h("div", {}, h("p", { class: "faint" }, T(`${pv.files.length} file(s), ${pv.bytes} bytes, sealed to ${t.owner.name} only.`, `${pv.files.length} 個檔案、${pv.bytes} bytes，只加密給 ${t.owner.name}。`)),
          h("p", { class: "faint", "data-lan-scan-note": "" }, T("The secret scan catches honest mistakes, not a determined agent: anything can be encoded past a scanner. Read what goes back.", "secret 掃描抓得到不小心的錯，擋不住刻意的 agent：任何內容都能編碼繞過掃描器。請親自讀過要交回的內容。")),
          pv.protectedPaths.length ? h("p", { class: "lan-warn", "data-lan-protected": "" }, icon("alert", "ic sm"), T(`Refused: it changes ${pv.protectedPaths.join(", ")} (CI, git hooks or package scripts).`, `拒絕：它改了 ${pv.protectedPaths.join("、")}（CI、git hooks 或 package scripts）。`)) : null,
          (pv.copies || []).length ? h("p", { class: "lan-warn", "data-lan-copies": "" }, icon("alert", "ic sm"), T(`What goes back copies files of your project it did not change: ${pv.copies.join(", ")}. Check that you mean to send them.`, `要交回的內容複製了你專案裡它沒改的檔案：${pv.copies.join("、")}。請確認你真的要送出。`)) : null,
          pv.tooMuchAdded ? h("p", { class: "lan-warn", "data-lan-added": "" }, icon("alert", "ic sm"), T(`Blocked: it adds ${pv.addedBytes} bytes, more than a round may hand back.`, `擋下：它新增了 ${pv.addedBytes} bytes，超過一輪可交回的量。`)) : null,
          (pv.binary || []).length ? h("p", { class: "lan-warn", "data-lan-binary": "" }, icon("alert", "ic sm"), T(`Refused: ${pv.binary.join(", ")} cannot go back (only text does).`, `拒絕：${pv.binary.join("、")} 無法交回（只能交回文字）。`)) : null,
          (pv.stats || []).length ? h("ul", { class: "faint", "data-lan-stats": "" }, pv.stats.map((x) => h("li", { class: "mono" }, `${x.path}  +${x.added} −${x.removed}  (${x.addedBytes} B)`))) : null,
          pv.secrets.length ? h("p", { class: "lan-warn", "data-lan-secrets": "" }, icon("alert", "ic sm"), T(`Blocked: ${pv.secrets.length} secret or private hit(s): ${pv.secrets.map((s) => `${s.path}:${s.line}`).join(", ")}. Edit them out below and preview again.`, `擋下：${pv.secrets.length} 處 secret 或私人資訊：${pv.secrets.map((s) => `${s.path}:${s.line}`).join("、")}。請在下面刪掉後再預覽。`)) : null,
          pv.files.map((f) => { const e = ((LN.edits[t.id] ||= []).find((x) => x.path === f.path)); const box = { v: e ? e.text : f.text };
            return h("div", { class: "lan-file" }, h("div", { class: "mono lbl" }, f.path), h("textarea", { class: "lan-edit", rows: 6, "data-lan-edit": f.path, oninput: (ev) => { const list = (LN.edits[t.id] ||= []); const x = list.find((y) => y.path === f.path); if (x) x.text = ev.target.value; else list.push({ path: f.path, text: ev.target.value }); } }, box.v)); }),
          h("button", { class: "btn primary", "data-lan-handback-send": t.id, disabled: !pv.ok, onclick: () => act(T("Hand back", "交回"), async () => { await postJ(`/api/lan/threads/${t.id}/handback`, { confirm: pv.hash, edits: LN.edits[t.id] }); delete LN.preview[t.id]; delete LN.edits[t.id]; }) }, T("Hand back (交回)", "交回"))) : null) : null,
      // the dispatcher: refine or close once a result is in
      !mine && r.result && r.result.output.files.some((f) => f.path === "changes.patch") ? applyPatch(t, r) : null,
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
    h("div", { class: "lan-top" }, myAddress(v), introductions(v), peers(v)), taints(v),
    h("div", { class: "lan-col" }, inbox(v), focus ? threadCard(focus) : null, ...threads.filter((t) => t !== focus).map(threadCard), dispatchForm(v)));
}
routes.lan = viewLan;
load();
})();
