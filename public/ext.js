// Shared helpers for the M6+ pages: fetch wrappers, nav items, a diff view,
// small status pills, and the live-update hook (window.onExt).
const X = (() => {
  window.onExt = window.onExt || [];
  const get = (u) => fetch(u).then(async (r) => ({ ...(await r.json().catch(() => ({}))), _http: r.status }));
  const getList = (u) => fetch(u).then((r) => r.json()).catch(() => []);
  const post = (u, b) => fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b || {}) }).then(async (r) => ({ ...(await r.json().catch(() => ({}))), _http: r.status }));
  const nav = (view, ic, en, tw, after, countId) => {
    if (document.querySelector(`.nav-item[data-view="${view}"]`)) return;
    const b = h("button", { class: "nav-item", "data-view": view, "data-tip": T(en, tw) }, icon(ic), h("span", { class: "nl" }, T(en, tw)), countId ? h("span", { class: "count attn", id: countId, hidden: true }) : null);
    const ref = document.querySelector(`.nav-item[data-view="${after}"]`) || [...document.querySelectorAll(".nav .nav-item")].at(-1);
    ref.after(b); b.addEventListener("click", () => { location.hash = `#/${view}`; });
    addEventListener("hashchange", () => setTimeout(() => mark(view), 0));
  };
  // sub-pages keep their section's nav item current
  const owners = {};
  const own = (view, ...subs) => { for (const s of subs) owners[s] = view; };
  const mark = () => { const n = S.route?.name; const o = owners[n]; if (o) document.querySelector(`.nav-item[data-view="${o}"]`)?.setAttribute("aria-current", "page"); };
  addEventListener("hashchange", () => setTimeout(mark, 0));
  const count = (id, n) => { const el = document.getElementById(id); if (el) { el.hidden = !n; el.textContent = n || ""; } };
  const pill = (cls, text) => h("span", { class: `badge ${cls}` }, h("span", { class: "d" }), text);
  const diff = (hunks) => h("div", { class: "x-diff", role: "region", "aria-label": T("Changes", "變更") }, hunks.length ? hunks.map((hk) => h("div", { class: "x-hunk" },
    hk.map((o) => h("div", { class: `x-dl ${o.op === "+" ? "add" : o.op === "-" ? "del" : ""}` }, h("span", { class: "x-ln" }, o.op === "+" ? "" : String(o.a ?? "")), h("span", { class: "x-ln" }, o.op === "-" ? "" : String(o.b ?? "")),
      h("span", { class: "x-op" }, o.op === "=" ? " " : o.op), h("span", { class: "x-tx" }, o.text))))) : h("div", { class: "faint", style: "padding:12px" }, T("No changes", "沒有變更")));
  const loading = () => h("div", { class: "page" }, h("div", { class: "skel", style: "height:28px;width:220px" }), h("div", { class: "skel", style: "height:240px" }));
  const notFound = (en, tw) => h("div", { class: "page" }, h("div", { class: "card" }, h("div", { class: "empty" }, icon("alert"), h("b", {}, T(en, tw)))));
  const refresh = (names) => { if (S.route && names.includes(S.route.name)) soft(); };
  const reroute = (re) => { if (re.test(location.hash)) route(); };
  const kv = (rows) => h("dl", { class: "x-kv" }, rows.filter(Boolean).map(([k, v]) => [h("dt", {}, k), h("dd", {}, v)]).flat());
  return { get, getList, post, nav, own, mark, count, pill, diff, loading, notFound, refresh, reroute, kv };
})();
