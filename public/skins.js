// Skins (M4/M5): #/skins lists the skins with their permissions, pins and the
// compatibility kit's checks; "Use" puts one on screen. The skin runs in a
// sandboxed iframe (scripts only) under Studio's own bar: it gets a read-only
// snapshot and events by postMessage and may only ask to OPEN a card, which the
// host shows in pro mode. Anything else it posts is ignored and counted.
// Pro mode always works: the bar's button, Escape, /#/pro, and a 5-second
// fallback when a skin never says it is ready.
(() => {
const K = { list: null, kit: null, active: null, frame: null, ready: false, ignored: 0, es: null, timer: 0, perms: [] };
let feedSequence = 0;
const getSaved = () => { try { return localStorage.getItem("crew.skin"); } catch { return null; } };
const setSaved = (v) => { try { v ? localStorage.setItem("crew.skin", v) : localStorage.removeItem("crew.skin"); } catch {} };
const load = async () => { const r = await X.get("/api/skins"); K.list = r.skins || []; K.kit = r.kit; X.refresh(["skins"]); return K.list; };
const theme = () => document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

/** Every message to a skin's frame goes through here (a test can watch it: window.__skinPosts). */
function post(frame, skinId, msg) { window.__skinPosts?.push({ frame: frame.dataset.skin, for: skinId, type: msg.type }); frame.contentWindow?.postMessage(msg, "*"); }
async function feed() {
  // the skin and frame this snapshot is for: after the await, it is posted only if they are still the ones showing
  const skin = K.active, frame = K.frame;
  if (!skin || !frame?.contentWindow) return;
  const sequence = ++feedSequence;
  const s = await X.get(`/api/skins/${skin.id}/snapshot`);
  if (sequence !== feedSequence || K.active !== skin || K.frame !== frame || !frame.contentWindow) return; // drop late snapshots and skin switches
  if (s._http !== 200) return pro(T("The skin failed its checks; back in pro mode.", "外觀沒通過檢查，已回到專業模式。"));
  delete s._http;
  K.pending = s.pending || [];
  post(frame, skin.id, { type: "crew:snapshot", snapshot: { ...s, lang, theme: theme() } });
}
function onMessage(e) {
  if (!K.frame || e.source !== K.frame.contentWindow) return;
  const m = e.data || {};
  if (m.type === "crew:ready") { K.ready = true; clearTimeout(K.timer); bar(); return; }
  if (m.type === "crew:openCard" && K.perms.includes("openCard")) {
    const id = String(m.id || ""); const card = (K.pending || []).find((c) => c.id === id);
    if (!card) { toast(T(`The skin asked for card ${id}, which is not waiting.`, `外觀要求打開 ${id}，但這張卡不在待處理中。`)); return; }
    pro(); location.hash = `#/inbox/${encodeURIComponent(id)}`; toast(T(`Opened ${id} for the ${K.lastName} skin. Answer it here.`, `替 ${K.lastName} 外觀打開了 ${id}，請在這裡回答。`)); return;
  }
  K.ignored++; bar(); // a skin cannot answer, dispatch or write anything: other requests are dropped
}
addEventListener("message", onMessage);
function bar() {
  const b = $("#skinBar"); if (!b || !K.active) return;
  b.querySelector(".x-skinstat").textContent = K.ready ? T(`${K.active.manifest.name} · read-only`, `${K.active.manifest.name}・唯讀`) : T(`Loading ${K.active.manifest.name}…`, `載入 ${K.active.manifest.name}…`);
  const ig = b.querySelector(".x-ignored"); ig.hidden = !K.ignored; ig.textContent = T(`${K.ignored} request${K.ignored === 1 ? "" : "s"} ignored`, `已忽略 ${K.ignored} 個要求`);
}
function use(id, quiet) {
  const sk = K.list?.find((x) => x.id === id);
  if (!sk || !sk.ok) { setSaved(null); if (!quiet) toast(T("That skin fails its checks.", "這個外觀沒通過檢查。")); return; }
  pro(null, true);
  K.active = sk; K.lastName = sk.manifest.name; K.perms = sk.manifest.permissions || []; K.ready = false; K.ignored = 0; setSaved(id);
  const frame = h("iframe", { "data-skin": sk.id, sandbox: "allow-scripts", src: `/skin/${sk.id}/${sk.manifest.entry}`, title: sk.manifest.name, referrerpolicy: "no-referrer" });
  K.frame = frame;
  frame.addEventListener("load", () => feed());
  const layer = h("div", { id: "skinLayer", class: "x-skinlayer", role: "region", "aria-label": T("Skin", "外觀") },
    h("div", { id: "skinBar", class: "x-skinbar2" }, icon("eye", "ic sm"), h("span", { class: "x-skinstat" }), h("span", { class: "x-ignored faint", hidden: true }), h("span", { class: "x-grow" }),
      h("a", { class: "btn ghost", href: "#/skins", onclick: () => pro() }, T("Skins", "外觀")), h("button", { class: "btn primary", id: "proBtn", onclick: () => pro() }, icon("board", "ic sm"), T("Pro mode", "專業模式"))),
    frame);
  document.body.append(layer); document.body.classList.add("skin-on"); bar();
  K.timer = setTimeout(() => { if (!K.ready) pro(T("The skin did not start; back in pro mode.", "外觀沒有啟動，已回到專業模式。")); }, 5000);
}
// on the page's one event stream (app.js), registered once; a skin that is not showing ignores them
window.liveListen("events", (m) => { const frame = K.frame, skin = K.active; if (!frame || !skin) return; const d = JSON.parse(m.data); if (K.perms.includes("events")) for (const e of (d.events || []).slice(-20)) post(frame, skin.id, { type: "crew:event", event: { seq: e.seq, ts: e.ts, type: e.type, task: e.task, actor: e.actor, summary: e.summary?.en || "" } }); feed(); });
for (const t of ["pending", "crew"]) window.liveListen(t, () => { if (K.frame) feed(); });
for (const t of ["wrun", "scard", "agent"]) window.liveListen(t, (m) => {
  const frame = K.frame, skin = K.active; if (!frame || !skin) return;
  const d = JSON.parse(m.data);
  if (t === "wrun" && d.event && K.perms.includes("events")) post(frame, skin.id, { type: "crew:event", event: { seq: d.event.seq, ts: d.event.ts, type: d.event.type, task: d.id, summary: d.event.summary || d.status } });
  feed();
});
/** Back to pro mode: always possible, whatever the skin does. */
function pro(msg, keepSaved) {
  clearTimeout(K.timer);
  $("#skinLayer")?.remove(); document.body.classList.remove("skin-on");
  K.active = null; K.frame = null; K.ready = false; K.pending = []; feedSequence++;
  if (!keepSaved) setSaved(null);
  if (msg) toast(msg);
}
window.crewPro = pro;
addEventListener("keydown", (e) => { if (e.key === "Escape" && K.active) pro(); });
addEventListener("hashchange", () => { if (location.hash === "#/pro") { pro(); location.hash = "#/board"; } });

function installModal() {
  const path = h("input", { placeholder: "/Users/you/my-skin", "aria-label": T("Folder", "資料夾") }); const grant = h("input", { type: "checkbox" });
  modal(T("Install a skin", "安裝外觀"), h("div", { class: "form" }, h("p", { class: "faint" }, T("Studio copies the folder, runs the compatibility checks and pins every file by sha256. A skin has no network unless you grant the origins its manifest lists.", "Studio 會複製資料夾、跑相容性檢查，並以 sha256 鎖定每個檔案。除非你授權 manifest 列出的來源，外觀沒有網路。")),
    h("label", { class: "field" }, h("span", { class: "lbl" }, T("Skin folder (absolute path)", "外觀資料夾（絕對路徑）")), path),
    h("label", { class: "x-row" }, grant, h("span", {}, T("Grant the network origins it lists (only if you trust it)", "授權它列出的網路來源（只在你信任時）")))),
    async (close, btn) => { btn.disabled = true; const r = await X.post("/api/skins/install", { path: path.value.trim(), grantNetwork: grant.checked }); btn.disabled = false; if (r.error) return toast(r.error); close(); load(); });
  $(".modal .btn.primary").textContent = T("Install", "安裝");
}
function viewSkins() {
  if (!K.list) { load(); return X.loading(); }
  return h("div", { class: "page" },
    h("div", { class: "phead" }, h("div", {}, h("h1", {}, T("Skins", "外觀")),
      h("p", {}, T("Another face for Studio, never more power: a skin sees a read-only snapshot and may only ask to open a card. It runs sandboxed with no network, every file pinned. Pro mode is always one click away.", "Studio 的另一張臉，但不會多任何權限：外觀只看得到唯讀快照，只能要求打開一張卡。它在沙盒裡、沒有網路、每個檔案都被鎖定。專業模式永遠一鍵就回得來。"))),
      h("div", { class: "actions" }, h("button", { class: "btn", onclick: installModal }, icon("plus", "ic sm"), T("Install from a folder", "從資料夾安裝")))),
    h("div", { class: "x-grid" }, K.list.map((s) => h("div", { class: "card x-prop", "data-skin": s.id },
      h("div", { class: "x-row wrap" }, s.ok ? X.pill("ok", s.kind === "builtin" ? T("Built in", "內建") : T("Installed", "已安裝")) : X.pill("bad", T("Refused", "拒用")), h("b", {}, s.manifest?.name || s.id), h("span", { class: "vbadge" }, s.manifest?.version || "?"),
        h("span", { class: "x-grow" }), s.sha256 ? h("code", { class: "faint", title: T("sha256 of the pinned file list", "鎖定檔案清單的 sha256") }, `sha ${s.sha256.slice(0, 10)}`) : null),
      h("div", { class: "x-req" }, s.manifest?.description || ""),
      h("div", { class: "run-s", style: "font-size:12.5px" }, icon("lock", "ic sm"), (s.manifest?.permissions || []).join(", ") || T("no permission", "沒有權限"), h("span", {}, s.network.length ? T(`network: ${s.network.join(", ")}`, `網路：${s.network.join(", ")}`) : T("no network", "沒有網路"))),
      h("ul", { class: "x-gates" }, s.checks.map((c) => h("li", {}, h("span", { class: `x-gk ${c.ok ? "ok" : "bad"}` }, c.ok ? "✓" : "✗"), h("span", {}, c.label), h("span", { class: "faint" }, c.detail)))),
      h("div", { class: "actions" }, h("button", { class: "btn primary", disabled: !s.ok, onclick: () => use(s.id) }, icon("eye", "ic sm"), T("Use this skin", "使用這個外觀")),
        s.kind === "installed" ? h("button", { class: "btn ghost", onclick: async () => { const r = await X.post(`/api/skins/${s.id}/uninstall`); if (r.error) return toast(r.error); load(); } }, T("Uninstall", "解除安裝")) : null)))),
    h("details", { class: "card x-pad" }, h("summary", {}, T("Compatibility kit: how to build a skin", "相容性套件：如何做外觀")), h("pre", { class: "x-skilltext", style: "padding:10px 0 0" }, K.kit || "")));
}
Object.assign(routes, { skins: viewSkins, pro: () => { pro(); return routes.board(); } });
X.nav("skins", "eye", "Skins", "外觀", "remote");
X.reroute(/^#\/skins/);
// a saved skin comes back on load, unless the URL asks for pro mode
(async () => { const list = await load(); const saved = getSaved();
  if (/[?&]pro=1/.test(location.search) || location.hash === "#/pro") { setSaved(null); return; }
  if (saved && !K.active && list.some((x) => x.id === saved)) use(saved, true); })();
})();
