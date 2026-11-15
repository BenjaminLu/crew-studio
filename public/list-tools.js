// One search / filter / paging toolbar for every list page (docs/units/list-tools.md). A page hands list() its rows and
// how to read them (the text a search covers, its facets, its sorts) and gets back one element: the toolbar, the page of
// rows it draws itself, and the paging footer.
//   - Search filters as you type over the page's text, the same in both Chinese scripts (i18n.js toCN: opencc-js). The
//     first free word is marked in each row's title.
//   - key:value words in the box are facet filters (key: one of the page's facet keys; the value matches from its start);
//     typing "key:" lists that facet's values with their counts, a key's first letters list the keys.
//   - A facet button opens its checkboxes. Each count is the rows left if that box is ticked as well: every other filter
//     applied. More than six values: the popover has its own search.
//   - The state lives in the hash's query (#/runs?q=…&status=…&page=2): back, reload and a shared link keep it.
//     A change replaces the history entry and redraws the toolbar and rows only; the search box stays the same element,
//     so a composition in it (an input method) is never broken.
//   - "/" focuses the search (not while typing elsewhere); Escape closes a popover or the suggestions, then clears.
// A server list (cfg.server) is filtered and paged by the server: the toolbar sends its state and draws what comes back.
// compute() is the pure part (tests/list-tools.ts runs it without a browser).
(() => {
const I18N = window.crewI18n;
const tr = (en, tw) => (typeof T === "function" ? T(en, tw) : en);
const norm = (s) => { const t = String(s ?? ""); return (I18N?.toCN ? I18N.toCN(t) : t).toLowerCase(); };
const OWN = new Set(["q", "sort", "page", "size", "old"]);
const SIZES = [25, 50, 100];

/** the words of a query: free words and key:value tokens (a value with spaces in double quotes: key:"two words") */
function words(q) { return String(q || "").match(/[^\s:"]+:"[^"]*"?|"[^"]*"?|\S+/g) || []; }
function parse(q, keys) {
  const free = [], tok = {};
  for (const w of words(q)) {
    const m = /^([a-z][\w-]*):(.*)$/i.exec(w), k = m ? m[1].toLowerCase() : null;
    if (m && keys.includes(k)) { const v = m[2].replace(/^"|"$/g, ""); if (v) (tok[k] ||= []).push(norm(v)); continue; }
    const f = norm(w.replace(/^"|"$/g, "")).trim(); if (f) free.push(f);
  }
  return { free, tok };
}
const valuesOf = (f, x) => { const v = f.value(x); return (Array.isArray(v) ? v : [v]).filter((y) => y != null && y !== "").map(String); };
const showOf = (f, v) => String(f.show ? f.show(v) : v);
// a row's search text, kept for one list element only: a workflow rename or a language switch draws the page again (a new
// list), so its words are read again then, never from an older drawing
function hay(cfg, x) { const memo = (cfg._hay ||= new WeakMap()); if (x && typeof x === "object" && memo.has(x)) return memo.get(x);
  const s = norm((cfg.text?.(x) || []).filter((y) => y != null && y !== "").join("\n")); if (x && typeof x === "object") memo.set(x, s); return s; }

/** Everything the toolbar shows for a state over items: the matched rows in order, this page of them, each facet's
 *  values with counts, the chips, the suggestions for the last word, and the rows the recent window leaves out. */
function compute(cfg, st, items, now = Date.now()) {
  const facets = cfg.facets || [], keys = facets.map((f) => f.key);
  const { free, tok } = parse(st.q, keys);
  const sel = (k) => st.f?.[k] || [];
  const passOne = (f, x) => { const s = sel(f.key), t = tok[f.key] || []; if (!s.length && !t.length) return true; const vs = valuesOf(f, x);
    return vs.some((v) => s.includes(v)) || t.some((w) => vs.some((v) => norm(v).startsWith(w) || norm(showOf(f, v)).startsWith(w))); };
  const passFacets = (x, skip) => facets.every((f) => f.key === skip || passOne(f, x));
  const passText = (x) => !free.length || (() => { const s = hay(cfg, x); return free.every((w) => s.includes(w)); })();
  const recent = cfg.recent && !st.old ? now - cfg.recent.days * 86400e3 : null;
  const isRecent = (x) => { const t = Date.parse(cfg.recent.at(x) || ""); return !(t < recent); };
  const base = recent == null ? items : items.filter(isRecent);
  const matched = base.filter((x) => passFacets(x) && passText(x));
  const hiddenOld = recent == null ? 0 : items.filter((x) => !isRecent(x) && passFacets(x) && passText(x)).length;
  const sorts = cfg.sorts || [], sort = sorts.find((s) => s.key === st.sort) || sorts[0];
  const sorted = sort?.cmp ? matched.slice().sort(sort.cmp) : matched;
  const size = SIZES.includes(st.size) ? st.size : SIZES[0], pages = Math.max(1, Math.ceil(sorted.length / size)), page = Math.min(Math.max(1, st.page || 1), pages);
  const rows = sorted.slice((page - 1) * size, page * size);
  const facetViews = facets.map((f) => {
    const counts = new Map(); for (const x of base) if (passFacets(x, f.key) && passText(x)) for (const v of new Set(valuesOf(f, x))) counts.set(v, (counts.get(v) || 0) + 1);
    const all = new Set(); for (const x of items) for (const v of valuesOf(f, x)) all.add(v); for (const v of sel(f.key)) all.add(v);
    const opts = [...all].map((v) => ({ v, label: showOf(f, v), n: counts.get(v) || 0, on: sel(f.key).includes(v) }))
      .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
    return { key: f.key, name: f.name, opts, n: sel(f.key).length + (tok[f.key] || []).length };
  });
  const chips = facets.flatMap((f) => sel(f.key).map((v) => ({ key: f.key, v, label: tr(`${f.name}: ${showOf(f, v)}`, `${f.name}：${showOf(f, v)}`) })));
  return { free, tok, base, matched: sorted, rows, page, pages, size, sort: sort?.key || null, facets: facetViews, chips, hiddenOld,
    from: sorted.length ? (page - 1) * size + 1 : 0, to: Math.min(page * size, sorted.length), recentOnly: recent != null,
    suggest: suggest(cfg, st.q, facets, (f) => { const c = new Map(); for (const x of base) for (const v of new Set(valuesOf(f, x))) c.set(v, (c.get(v) || 0) + 1); return c; }) };
}
/** what the last word suggests: "key:" and a value's first letters list that facet's values; a key's first letters, keys */
function suggest(cfg, q, facets, countsOf) {
  const all = words(q); if (!all.length || /\s$/.test(q)) return [];
  const last = all.at(-1), m = /^([a-z][\w-]*)(:?)(.*)$/i.exec(last); if (!m) return [];
  const k0 = m[1].toLowerCase(), head = all.slice(0, -1);
  const f = facets.find((x) => x.key === k0);
  if (m[2] && f) { const w = norm(m[3].replace(/^"|"$/g, "")), c = countsOf(f);
    return [...c.entries()].filter(([v]) => !w || norm(v).startsWith(w) || norm(showOf(f, v)).startsWith(w)).sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([v, n]) => { const t = /\s|"/.test(v) ? `"${v.replace(/"/g, "")}"` : v; return { key: k0, val: showOf(f, v), n, q: [...head, `${k0}:${t}`].join(" ") + " " }; }); }
  if (!m[2] && !m[3]) return facets.filter((x) => x.key.startsWith(k0) && x.key !== k0).map((x) => ({ key: x.key, val: `（${x.name}）`, n: null, q: [...head, `${x.key}:`].join(" ") }));
  return [];
}
/** the page numbers shown: the first, the last, the current one and its neighbours; a gap is "…" */
function pageList(cur, n) { const out = []; for (let i = 1; i <= n; i++) { if (i === 1 || i === n || Math.abs(i - cur) <= 1) out.push(i); else if (out.at(-1) !== "…") out.push("…"); } return out; }

// ---------- the state in the URL ----------
const hashParts = () => { const raw = location.hash || "", i = raw.indexOf("?"); return { path: i < 0 ? raw : raw.slice(0, i), query: new URLSearchParams(i < 0 ? "" : raw.slice(i + 1)) }; };
const sizeKey = (id) => `crew.lt.size.${id}`;
const storedSize = (id) => { try { const n = Number(localStorage.getItem(sizeKey(id))); return SIZES.includes(n) ? n : null; } catch { return null; } };
/** the state a query says (facet keys from cfg) */
function readQuery(cfg, query) {
  const st = { q: query.get("q") || "", f: {}, sort: query.get("sort") || null, page: Math.max(1, parseInt(query.get("page") || "1", 10) || 1),
    size: SIZES.includes(Number(query.get("size"))) ? Number(query.get("size")) : storedSize(cfg.id) || SIZES[0], old: query.get("old") === "1" };
  for (const f of cfg.facets || []) { const v = query.getAll(f.key).filter(Boolean); if (v.length) st.f[f.key] = [...new Set(v)]; }
  return st;
}
/** the query for a state; parameters the toolbar does not own are kept */
function writeQuery(cfg, st, prev) {
  const keys = new Set([...OWN, ...(cfg.facets || []).map((f) => f.key)]), out = new URLSearchParams();
  for (const [k, v] of prev || []) if (!keys.has(k)) out.append(k, v);
  if (st.q) out.set("q", st.q);
  for (const f of cfg.facets || []) for (const v of st.f[f.key] || []) out.append(f.key, v);
  if (st.sort && st.sort !== cfg.sorts?.[0]?.key) out.set("sort", st.sort);
  if (st.old) out.set("old", "1");
  if (st.size !== (storedSize(cfg.id) || SIZES[0])) out.set("size", String(st.size));
  if (st.page > 1) out.set("page", String(st.page));
  return out;
}
const onRoute = (cfg) => !cfg.route || (typeof S !== "undefined" && S.route?.name === cfg.route && (window.crewHashRoute?.() ?? cfg.route) === cfg.route);

// ---------- the element ----------
const UI = new Map(); // per list id: what is open (a popover, its search), kept across the page's redraws
const ui = (id) => { if (!UI.has(id)) UI.set(id, { open: null, fq: {}, sug: true }); return UI.get(id); };

function list(cfg) {
  const u = ui(cfg.id), path = () => cfg.path || hashParts().path;
  let st = onRoute(cfg) ? readQuery(cfg, hashParts().query) : readQuery(cfg, new URLSearchParams());
  // the page's link without a query (the sidebar) comes back to what this tab last had there; "#/runs?" starts clean
  if (onRoute(cfg) && !location.hash.includes("?") && u.lastQuery) {
    st = readQuery(cfg, new URLSearchParams(u.lastQuery)); history.replaceState(history.state, "", `${path()}?${u.lastQuery}`);
    if (typeof S !== "undefined" && S.route) S.route.query = new URLSearchParams(u.lastQuery);
  }
  if (onRoute(cfg)) u.lastQuery = writeQuery(cfg, st).toString();
  let view = null, serverSeq = 0, serverT = null;
  const set = (patch, o = {}) => {
    st = { ...st, ...patch }; if (!("page" in patch)) st.page = 1;
    if (onRoute(cfg)) { const { query } = hashParts(), next = writeQuery(cfg, st, query), s = next.toString(), url = `${path()}${s ? `?${s}` : ""}`;
      if (url !== location.hash) history.replaceState(history.state, "", url);
      if (typeof S !== "undefined" && S.route) S.route.query = next; u.lastQuery = writeQuery(cfg, st).toString(); }
    draw(o);
  };
  const root = h("div", { class: "lt-list", "data-lt": cfg.id });
  const input = h("input", { class: "input", type: "search", "data-lt-q": cfg.id, autocomplete: "off", spellcheck: "false", placeholder: cfg.placeholder || tr("Search…", "搜尋…"), "aria-label": tr(`Search ${cfg.title}`, `搜尋${cfg.title}`), ...(cfg.inputAttrs || {}) });
  input.value = st.q;
  const sugBox = h("div", { class: "lt-sug card", role: "listbox", "aria-label": tr("Suggestions", "建議"), hidden: true });
  const qbox = h("div", { class: "lt-q" }, icon("search"), input, h("span", { class: "lt-kbd", "aria-hidden": "true" }, "/"), sugBox);
  const facetEls = new Map();
  for (const f of cfg.facets || []) {
    const btn = h("button", { type: "button", class: "btn sm", "aria-expanded": "false", "aria-haspopup": "true", "data-lt-facet": f.key, onclick: () => { u.open = u.open === f.key ? null : f.key; draw(); if (u.open) [...facetEls.get(f.key).pop.querySelectorAll("input")].find((x) => !x.hidden)?.focus(); } });
    const fq = h("input", { class: "input", type: "search", "data-lt-fq": f.key, placeholder: tr(`Find ${f.name}…`, `找${f.name}…`), "aria-label": tr(`Find ${f.name}`, `找${f.name}`), oninput: (e) => { if (e.isComposing || e.keyCode === 229) return; u.fq[f.key] = fq.value; drawOpts(f.key); }, oncompositionend: () => { u.fq[f.key] = fq.value; drawOpts(f.key); } });
    const opts = h("div", { class: "lt-opts" });
    const pop = h("div", { class: "lt-pop card", role: "group", "aria-label": f.name, "data-lt-pop": f.key }, fq, opts,
      h("div", { class: "actions", style: "justify-content:space-between" }, h("button", { type: "button", class: "btn ghost sm", "data-lt-clear": f.key, onclick: () => set({ f: { ...st.f, [f.key]: [] } }) }, tr("Clear", "清除")),
        h("button", { type: "button", class: "btn sm", "data-lt-done": f.key, onclick: () => { u.open = null; draw(); btn.focus(); } }, tr("Done", "完成"))));
    facetEls.set(f.key, { f, btn, pop, fq, opts, wrap: h("div", { class: "lt-facet" }, btn) });
  }
  const sortSel = (cfg.sorts || []).length > 1 ? h("select", { class: "select", "aria-label": tr("Sort", "排序"), "data-lt-sort": cfg.id, onchange: (e) => set({ sort: e.target.value, page: st.page }) },
    cfg.sorts.map((s) => h("option", { value: s.key }, s.label))) : null;
  const active = h("div", { class: "lt-active", "aria-live": "polite" });
  const bar = h("div", { class: "lt", "data-lt-bar": cfg.id, role: "search", "aria-label": tr(`Search and filter ${cfg.title}`, `${cfg.title}搜尋與篩選`) },
    h("div", { class: "lt-row" }, qbox, [...facetEls.values()].map((x) => x.wrap), sortSel ? h("label", { class: "lt-check" }, h("span", { class: "faint lt-small" }, tr("Sort", "排序")), sortSel) : null, cfg.extra ? h("span", { class: "lt-extra" }, cfg.extra) : null), active);
  const region = h("div", { class: "lt-region", "data-lt-region": cfg.id }), foot = h("div", { class: "lt-foot", "data-lt-foot": cfg.id, hidden: true });
  root.append(...(cfg.items == null && !cfg.server ? [] : [bar]), region, foot);

  // ---- typing ----
  const typed = () => { u.sug = true; set({ q: input.value }, { typing: true }); };
  // while an input method composes (compositionstart … compositionend) nothing filters, redraws or moves this box: the list
  // filters once, on compositionend, with the committed text; Enter, Escape and the arrows belong to the input method
  let composingNow = false; // this box's own: a page left mid-composition fires no compositionend, and a new box starts clean
  const composing = (e) => e.isComposing || e.keyCode === 229 || composingNow;
  input.addEventListener("compositionstart", () => { composingNow = true; });
  input.addEventListener("blur", () => { composingNow = false; });
  input.addEventListener("input", (e) => { if (!composing(e)) typed(); });
  input.addEventListener("compositionend", () => { composingNow = false; typed(); });
  input.addEventListener("keydown", (e) => {
    if (composing(e)) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (!sugBox.hidden) { u.sug = false; sugBox.hidden = true; return; } if (input.value) { input.value = ""; typed(); } else input.blur(); return; }
    if (e.key === "ArrowDown" && !sugBox.hidden) { e.preventDefault(); sugBox.querySelector("button")?.focus(); }
  });
  sugBox.addEventListener("keydown", (e) => { const bs = [...sugBox.querySelectorAll("button")], i = bs.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); bs[Math.min(bs.length - 1, i + 1)]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); (i <= 0 ? input : bs[i - 1]).focus(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); u.sug = false; sugBox.hidden = true; input.focus(); } });

  function drawOpts(key) {
    const el = facetEls.get(key), fv = view?.facets.find((x) => x.key === key); if (!el || !fv) return;
    const had = document.activeElement?.dataset?.ltOpt, w = norm(u.fq[key] || "");
    el.fq.hidden = fv.opts.length <= 6; if (document.activeElement !== el.fq && el.fq.value !== (u.fq[key] || "")) el.fq.value = u.fq[key] || "";
    const shown = fv.opts.filter((o) => !w || norm(o.label).includes(w) || norm(o.v).includes(w));
    el.opts.replaceChildren(...(shown.length ? shown.map((o) => h("label", {}, h("input", { type: "checkbox", "data-lt-opt": `${key}=${o.v}`, checked: o.on || null,
      onchange: () => { const cur = st.f[key] || []; set({ f: { ...st.f, [key]: o.on ? cur.filter((y) => y !== o.v) : [...cur, o.v] } }); } }), h("span", {}, o.label), h("span", { class: "num" }, String(o.n))))
      : [h("p", { class: "faint lt-small", style: "margin:4px" }, tr("No value matches.", "沒有符合的值。"))]));
    if (had) [...el.opts.querySelectorAll("[data-lt-opt]")].find((x) => x.dataset.ltOpt === had)?.focus();
  }

  function draw(o = {}) {
    if (cfg.server) return drawServer(o);
    const items = cfg.items || [];
    view = compute(cfg, st, items);
    paint(view, items.length);
  }
  function drawServer(o) {
    clearTimeout(serverT); const seq = ++serverSeq, ask = { ...st, f: { ...st.f }, ...parse(st.q, (cfg.facets || []).map((f) => f.key)) };
    const key = writeQuery(cfg, st).toString();
    if (!view) view = u.last?.key === key ? u.last.view : { rows: [], matched: [], facets: [], chips: [], suggest: [], loading: true };
    if (view.loaded && u.last?.key === key) paint(view, u.last.total);
    const go = async () => { let r; try { r = await cfg.server(ask); } catch (e) { r = { error: String(e?.message || e) }; } if (seq !== serverSeq || (!root.isConnected && view.loaded)) return;
      view = fromServer(r); u.last = { key, view, total: r.total ?? 0 }; paint(view, r.total ?? 0); };
    if (o.typing) serverT = setTimeout(go, 200); else go();
    if (!view.loaded) paint(view, 0); else paintBar(view);
  }
  function fromServer(r) {
    const facets = (cfg.facets || []).map((f) => { const counts = r.counts?.[f.key] || {}, sel = st.f[f.key] || [], all = new Set([...Object.keys(counts), ...sel]);
      return { key: f.key, name: f.name, n: sel.length + (parse(st.q, [f.key]).tok[f.key] || []).length,
        opts: [...all].map((v) => ({ v, label: showOf(f, v), n: counts[v] || 0, on: sel.includes(v) })).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label)) }; });
    const size = st.size, matched = r.matched ?? 0, pages = Math.max(1, Math.ceil(matched / size)), page = Math.min(st.page, pages);
    const sugFacets = (cfg.facets || []);
    return { loaded: true, error: r.error || null, rows: r.rows || [], matchedN: matched, page, pages, size, sort: st.sort || cfg.sorts?.[0]?.key || null, facets,
      chips: sugFacets.flatMap((f) => (st.f[f.key] || []).map((v) => ({ key: f.key, v, label: tr(`${f.name}: ${showOf(f, v)}`, `${f.name}：${showOf(f, v)}`) }))), hiddenOld: 0, free: parse(st.q, sugFacets.map((f) => f.key)).free,
      from: matched ? (page - 1) * size + 1 : 0, to: Math.min(page * size, matched),
      suggest: suggest(cfg, st.q, sugFacets, (f) => new Map(Object.entries(r.counts?.[f.key] || {}))) };
  }
  function paintBar(v) {
    for (const [key, el] of facetEls) { const fv = v.facets.find((x) => x.key === key), n = fv?.n || 0;
      el.wrap.hidden = !!fv && !fv.opts.length && !n; // a facet with no value in any row (and none selected) is left out
      const open = u.open === key && !el.wrap.hidden;
      el.btn.className = `btn sm${n ? " primary" : ""}`; el.btn.setAttribute("aria-expanded", String(open));
      el.btn.replaceChildren(`${el.f.name}${n ? ` · ${n}` : ""} ▾`);
      if (open && !el.pop.isConnected) el.wrap.append(el.pop); if (!open && el.pop.isConnected) el.pop.remove();
      if (open) { drawOpts(key); place(el.pop); requestAnimationFrame(() => place(el.pop)); } }
    if (sortSel && v.sort) sortSel.value = v.sort;
    if (input.value !== st.q && document.activeElement !== input) input.value = st.q;
    if (sugBox.contains(document.activeElement)) return; // the captain is choosing among them (↓): they stay as they are
    const sug = u.sug && document.activeElement === input ? v.suggest || [] : [];
    sugBox.hidden = !sug.length;
    sugBox.replaceChildren(...sug.map((g) => h("button", { type: "button", role: "option", "data-lt-sug": `${g.key}:${g.val}`, onclick: () => { input.value = g.q; input.focus(); u.sug = !g.q.endsWith(" "); set({ q: g.q }); } },
      h("span", {}, h("span", { class: "mono" }, `${g.key}:`), g.val), h("span", { class: "faint num" }, g.n == null ? "" : String(g.n)))));
  }
  function paint(v, total) {
    paintBar(v);
    const n = v.matchedN ?? v.matched.length, filtered = !!(st.q.trim() || v.chips.length || st.old);
    const count = v.loading ? tr("Loading…", "載入中…") : filtered ? tr(`${n} of ${total} match`, `${total} 條中 ${n} 條符合`) : v.recentOnly ? tr(`${n} in the last ${cfg.recent.days} days`, `近 ${cfg.recent.days} 天 ${n} 條`) : tr(`${n} in all`, `共 ${n} 條`);
    active.replaceChildren(...[h("span", { class: "faint", "data-lt-count": cfg.id }, count),
      ...v.chips.map((c) => h("span", { class: "chip", "data-lt-chip": `${c.key}=${c.v}` }, c.label, h("button", { type: "button", class: "lt-x", "aria-label": tr(`Remove ${c.label}`, `移除${c.label}`), onclick: () => set({ f: { ...st.f, [c.key]: (st.f[c.key] || []).filter((y) => y !== c.v) } }) }, icon("x")))),
      st.old ? h("span", { class: "chip", "data-lt-chip": "old" }, tr(`Including older than ${cfg.recent?.days} days`, `包含 ${cfg.recent?.days} 天以前`), h("button", { type: "button", class: "lt-x", "aria-label": tr("Remove", "移除"), onclick: () => set({ old: false }) }, icon("x"))) : null,
      filtered ? h("button", { type: "button", class: "btn ghost sm", "data-lt-clearall": cfg.id, onclick: clearAll }, tr("Clear all", "清除全部")) : null].filter(Boolean));
    // the rows
    const older = v.hiddenOld ? h("div", { class: "lt-hidden", "data-lt-older": String(v.hiddenOld) }, h("span", {}, tr(`${v.hiddenOld} more older than ${cfg.recent.days} days are not shown`, `另有 ${v.hiddenOld} 條超過 ${cfg.recent.days} 天的沒顯示`)),
      h("button", { type: "button", class: "btn sm", "data-lt-include-old": cfg.id, onclick: () => set({ old: true }) }, tr("Include them", "一起搜"))) : null;
    let body;
    if (v.loading) body = [h("div", { class: "skel", style: "height:120px" })];
    else if (v.error) body = [h("div", { class: "card x-pad err", role: "alert" }, v.error)];
    else if (!total && !filtered && cfg.none) body = [cfg.none()];
    else if (!n) body = [h("div", { class: "card", "data-lt-empty": cfg.id, ...(cfg.emptyAttrs || {}) }, h("div", { class: "empty" }, h("b", {}, tr(`No ${cfg.noun?.[0] || "row"} matches`, `沒有符合的${cfg.noun?.[1] || "項目"}`)),
      h("span", {}, v.hiddenOld ? tr(`None in the last ${cfg.recent.days} days; ${v.hiddenOld} older.`, `近 ${cfg.recent.days} 天沒有；更早的有 ${v.hiddenOld} 條。`) : tr("Try another word, or remove a filter.", "換個關鍵字，或拿掉一個篩選條件。")),
      h("div", { class: "actions", style: "justify-content:center" }, v.hiddenOld ? h("button", { type: "button", class: "btn", onclick: () => set({ old: true }) }, tr("Include older", "一起搜更早的")) : null,
        h("button", { type: "button", class: "btn", "data-lt-reset": cfg.id, onclick: clearAll }, tr("Clear search and filters", "清除搜尋和篩選")))))];
    else body = [cfg.rows(v.rows, { mark: (t) => mark(t, v.free[0]), older, sort: v.sort, matched: v.matched, filtered, page: v.page })].flat();
    if (n && older && !body.some((x) => x?.contains?.(older))) body.push(older);
    // a row (or its control) with the focus keeps it through the redraw: the same one drawn anew, by its key and place
    const had = region.contains(document.activeElement) ? keyOf(document.activeElement, region) : null;
    region.replaceChildren(...body.filter(Boolean));
    if (had && !region.contains(document.activeElement)) { const m = region.querySelectorAll(had.key), el = m.length === 1 ? m[0] : m[had.at]; if (el?.tagName === had.tag) el.focus({ preventScroll: true }); }
    if (typeof hydrateIcons === "function") hydrateIcons(region);
    // the footer
    foot.hidden = !n || v.loading;
    if (n) { const pages = pageList(v.page, v.pages);
      foot.replaceChildren(h("span", { class: "faint", "data-lt-range": cfg.id }, tr(`${v.from}–${v.to} of ${n}`, `第 ${v.from}–${v.to} 條，共 ${n} 條`)),
        h("nav", { class: "lt-pages", "aria-label": tr("Pages", "分頁") },
          h("button", { type: "button", class: "btn sm", disabled: v.page <= 1 || null, "aria-label": tr("Previous page", "上一頁"), "data-lt-prev": cfg.id, onclick: () => goPage(v.page - 1) }, "‹"),
          pages.map((p) => h("button", { type: "button", class: "btn sm", "aria-current": p === v.page ? "page" : null, disabled: p === "…" || null, "data-lt-page": String(p), onclick: () => goPage(p) }, String(p))),
          h("button", { type: "button", class: "btn sm", disabled: v.page >= v.pages || null, "aria-label": tr("Next page", "下一頁"), "data-lt-next": cfg.id, onclick: () => goPage(v.page + 1) }, "›")),
        h("label", { class: "lt-check" }, h("span", { class: "faint lt-small" }, tr("Per page", "每頁")),
          h("select", { class: "select", "aria-label": tr("Rows per page", "每頁條數"), "data-lt-size": cfg.id, onchange: (e) => { const s = Number(e.target.value); try { localStorage.setItem(sizeKey(cfg.id), String(s)); } catch {} set({ size: s }); } },
            SIZES.map((s) => h("option", { value: String(s), selected: s === v.size || null }, String(s)))))); }
    cfg.onChange?.(v, st);
  }
  const goPage = (p) => { if (typeof p !== "number") return; set({ page: p }); root.scrollIntoView?.({ block: "start", behavior: "instant" }); };
  const clearAll = () => { input.value = ""; u.open = null; set({ q: "", f: {}, old: false }); };
  root.ltRefresh = () => draw(); // a server list asks again (a live event)
  // the page that holds the first matching row that passes test is shown (no redraw when it already is)
  root.ltReveal = (test) => { if (cfg.server || !view) return; const i = view.matched.findIndex(test); if (i < 0) return; const p = Math.floor(i / view.size) + 1; if (p !== view.page) set({ page: p }); };
  root.ltItems = (items) => { cfg.items = items; cfg._hay = null; draw(); }; // new rows in place: the search box stays the same element
  draw();
  return root;
}
/** an open popover moved left as far as it must to stay inside the main column and the window (the last facet's would
 *  run off the right edge), and never past its left edge */
function place(pop) {
  pop.style.transform = ""; if (!pop.isConnected) return;
  const r = pop.getBoundingClientRect(), main = document.querySelector("#main")?.getBoundingClientRect();
  const right = Math.min(innerWidth, main ? main.right : innerWidth) - 8, left = Math.max(0, main ? main.left : 0) + 8;
  let dx = 0; if (r.right > right) dx = right - r.right; if (r.left + dx < left) dx = left - r.left;
  if (dx) pop.style.transform = `translateX(${Math.round(dx)}px)`;
}
/** a stable way to find an element again in a redrawn scope: its id, else its first data- attribute, else its link; and
 *  which one of several it was */
function keyOf(el, scope) {
  const d = [...el.attributes].find((x) => x.name.startsWith("data-")), href = el.getAttribute("href");
  const key = el.id ? `#${CSS.escape(el.id)}` : d ? `${el.tagName.toLowerCase()}[${d.name}="${CSS.escape(d.value)}"]` : href ? `${el.tagName.toLowerCase()}[href="${CSS.escape(href)}"]` : null;
  return key ? { key, tag: el.tagName, at: [...scope.querySelectorAll(key)].indexOf(el) } : null;
}
/** the title with the first free word marked, found the same way in both Chinese scripts */
function mark(text, w) {
  const t = String(text ?? ""); if (!w) return t;
  const n = norm(t), j = n.indexOf(w); if (j < 0 || n.length !== t.length) return t;
  const f = document.createDocumentFragment(); f.append(t.slice(0, j), h("mark", { class: "lt-mark" }, t.slice(j, j + w.length)), t.slice(j + w.length)); return f;
}

// ---------- the keyboard and the open popover ----------
const editable = (t) => t?.closest?.("input,textarea,select,[contenteditable=''],[contenteditable='true'],[role=dialog]");
addEventListener("keydown", (e) => {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.isComposing || e.keyCode === 229) return;
  if (e.key === "/" && !editable(e.target)) { const q = [...document.querySelectorAll("#view [data-lt-q]")].find((x) => x.getClientRects().length); if (q) { e.preventDefault(); q.focus(); q.select(); } return; }
  if (e.key === "Escape") { const pop = document.querySelector("#view .lt-pop"); if (pop) { e.preventDefault(); closePop(pop)?.focus(); } }
});
/** an open popover closed without redrawing the list (a press on a row goes on to its click); answers its button */
function closePop(pop) { const btn = pop.closest(".lt-facet")?.querySelector("[data-lt-facet]"), id = pop.closest("[data-lt-bar]")?.dataset.ltBar;
  if (id) ui(id).open = null; pop.remove(); btn?.setAttribute("aria-expanded", "false"); return btn; }
// a window that changes size keeps an open popover inside the page
addEventListener("resize", () => { for (const pop of document.querySelectorAll("#view .lt-pop")) place(pop); });
addEventListener("pointerdown", (e) => { const pop = document.querySelector("#view .lt-pop"); if (pop && !pop.closest(".lt-facet")?.contains(e.target)) closePop(pop); }, true);

/** New rows for list `id` drawn in place when a field of the page has the focus (app.js soft() would wait for its blur and
 *  the list would go stale while the captain types); true when it did, else the caller renders as usual */
function feed(id, items) { const root = document.querySelector(`#view [data-lt="${id}"]`), a = document.activeElement;
  if (!root?.ltItems || !a || !document.querySelector("#view")?.contains(a) || !/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return false;
  root.ltItems(items); return true; }
window.crewListTools = { list, feed, compute, parse, words, suggest, pageList, readQuery, writeQuery, norm, SIZES };
})();
