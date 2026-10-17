// The Crew page, option C (#/team; docs/design/crew-seats.md): one card per workflow (its agent nodes as a mini pipeline,
// each dot the colour of the member who runs it, ★ for a node this workflow customised, red where a seat is empty) and the
// selected workflow's editable table: member, model, effort, skills (the member's in grey, the node's own removable,
// "+ skill" from the library) and where each value comes from. A model or effort change asks "only this workflow" or
// "the whole member"; the legend opens the member editor (model, effort, own skills, presets). The server is the only
// authority: every change is one POST /api/team/change with the version the page last read (compare-and-swap).
(() => {
const TM = { data: null, loading: false, sel: null, ask: null, editing: false, notes: [], err: null, busy: false };
const getJson = async (u) => { const r = await fetch(u); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j; };
// seat colours: the palette tokens (both themes)
const SEAT_COLOR = { coordinator: "var(--a6t)", maker: "var(--a1t)", "alt-maker": "var(--a2t)", reviewer: "var(--a5t)", "design-reviewer": "var(--a3t)" };
const seatColor = (id) => SEAT_COLOR[id] || "var(--a4t)";
const L = (o) => (o ? T(o.en, o.zh) : "");
const seatOf = (id) => TM.data?.seats.find((s) => s.id === id);
const seatName = (id) => L(seatOf(id)?.label) || id;
const SOURCE = { team: ["Team", "跟團隊"], workflow: ["★ Custom here", "★ 這裡自訂"], definition: ["Workflow sets it", "流程設定"], run: ["This run", "這次"], missing: ["Missing", "缺人"] };
async function load(facts) {
  if (TM.loading) return; TM.loading = true;
  try { TM.data = await getJson(`/api/team${facts ? "?facts=1" : ""}`); TM.err = null; if (!TM.sel || !TM.data.workflows.some((w) => w.id === TM.sel)) TM.sel = TM.data.workflows.find((w) => w.badge.state !== "team")?.id ?? TM.data.workflows[0]?.id ?? null; }
  catch (e) { TM.err = String(e.message || e); }
  finally { TM.loading = false; }
  if (S.route?.name === "team") soft();
}
async function change(c) {
  if (TM.busy) return; TM.busy = true;
  try {
    const r = await fetch("/api/team/change", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ change: c, expected: TM.data?.team?.hash ?? null }) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 409) { toast(T(j.error || "The team changed; reloaded.", j.tw || "團隊已經改了；已重新整理。")); TM.ask = null; TM.busy = false; return load(); }
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    TM.data = j; TM.ask = null; TM.notes = j.changed?.notes ?? [];
    const n = j.changed?.impact?.length ?? 0;
    toast(T(`Saved: ${n} node${n === 1 ? "" : "s"} changed.`, `已儲存：${n} 個節點有變動。`));
  } catch (e) { toast(T(`Not saved: ${e.message || e}`, `沒有儲存：${e.message || e}`)); }
  finally { TM.busy = false; if (S.route?.name === "team") render(); }
}
const modelKey = (p, m) => (p && m ? `${p}/${m}` : "");
function modelOptions(current) {
  const opts = [...(TM.data?.models ?? [])];
  if (current?.provider && current?.model && !opts.some((m) => m.provider === current.provider && m.model === current.model)) opts.unshift({ provider: current.provider, model: current.model, efforts: [] });
  return opts;
}
function modelSelect(label, cur, onchange, extra = {}) {
  const sel = h("select", { "aria-label": label, class: "tm-sel mono", onchange: (e) => onchange(e.target.value), ...extra },
    h("option", { value: "" }, T("— unassigned", "— 未指派")),
    modelOptions(cur).map((m) => h("option", { value: modelKey(m.provider, m.model) }, `${m.provider === "codex" ? "Codex" : m.provider === "claude" ? "Claude" : m.provider} · ${m.model}`)));
  sel.value = modelKey(cur?.provider, cur?.model); return sel;
}
function effortSelect(label, cur, provider, onchange, extra = {}) {
  const efforts = TM.data?.efforts ?? ["low", "medium", "high", "xhigh"];
  const sel = h("select", { "aria-label": label, class: "tm-sel", onchange: (e) => onchange(e.target.value === "default" ? null : e.target.value), ...extra },
    provider !== "codex" ? h("option", { value: "default" }, T("default", "預設")) : null, efforts.map((x) => h("option", { value: x }, x)));
  sel.value = cur ?? "default"; return sel;
}
function skillAdd(label, have, onpick) {
  const sel = h("select", { "aria-label": label, class: "tm-add", onchange: (e) => { const s = TM.data.library.find((x) => x.id === e.target.value); if (s) onpick({ id: s.id, v: s.v, sha256: s.sha256 }); } },
    h("option", { value: "" }, T("+ skill", "＋ skill")), (TM.data?.library ?? []).filter((s) => !have.includes(s.id)).map((s) => h("option", { value: s.id, title: s.description }, s.name || s.id)));
  sel.value = ""; return sel;
}
// ---------- the scope question ----------
function askPanel(wf, row) {
  const a = TM.ask; const what = a.field === "model" ? T("model", "模型") : "effort";
  const shown = a.field === "model" ? a.value.split("/").slice(1).join("/") || T("unassigned", "未指派") : a.value ?? T("default", "預設");
  const uses = seatOf(row.seat)?.uses ?? 0;
  const set = a.field === "model" ? (() => { const [provider, ...m] = a.value.split("/"); return { provider, model: m.join("/") }; })() : { effort: a.value };
  return h("div", { class: "tm-ask", role: "group", "aria-label": T("Where to apply this change", "這個改動要套用到哪裡"), "data-scope-ask": row.node },
    h("span", { class: "tm-ask-t" }, T(`Change ${row.label}'s ${what} to ${shown}:`, `把「${row.label}」的${what}改成 ${shown}：`)),
    h("button", { class: "btn primary", "data-scope-here": "", disabled: TM.busy, onclick: () => change({ kind: "node", workflow: wf.id, node: row.node, set }) }, T("Only this workflow", "只改這個 workflow")),
    h("button", { class: "btn", "data-scope-team": "", disabled: TM.busy || !seatOf(row.seat)?.member && a.field !== "model", onclick: () => change({ kind: "member", seat: row.seat, set }) },
      T(`The whole “${seatName(row.seat)}” (affects ${uses} node${uses === 1 ? "" : "s"})`, `改整個「${seatName(row.seat)}」（影響 ${uses} 個節點）`)),
    h("button", { class: "btn ghost", onclick: () => { TM.ask = null; render(); } }, T("Cancel", "取消")));
}
// ---------- one node row ----------
function nodeRow(wf, row) {
  const asking = TM.ask?.workflow === wf.id && TM.ask?.node === row.node ? TM.ask : null;
  const member = h("select", { "aria-label": T(`${row.label}'s member`, `${row.label} 的成員`), class: "tm-sel", onchange: (e) => change({ kind: "node", workflow: wf.id, node: row.node, set: { seat: e.target.value } }) },
    (TM.data.seats ?? []).map((s) => h("option", { value: s.id }, L(s.label))));
  member.value = row.seat;
  const cur = asking?.field === "model" ? (() => { const [provider, ...m] = asking.value.split("/"); return { provider, model: m.join("/") }; })() : { provider: row.provider, model: row.model };
  const model = modelSelect(T(`${row.label}'s model`, `${row.label} 的模型`), cur, (v) => { TM.ask = { workflow: wf.id, node: row.node, field: "model", value: v }; render(); }, { "data-custom": row.fields.model === "workflow" ? "1" : null });
  const effort = effortSelect(T(`${row.label}'s effort`, `${row.label} 的 effort`), asking?.field === "effort" ? asking.value : row.effort, row.provider, (v) => { TM.ask = { workflow: wf.id, node: row.node, field: "effort", value: v }; render(); }, { "data-custom": row.fields.effort === "workflow" || row.fields.effort === "run" ? "1" : null });
  const skills = h("div", { class: "tm-skills" },
    row.skills.filter((p) => p.from === "member").map((p) => h("span", { class: "tm-skill base", title: T(`Comes with ${seatName(row.seat)}`, `來自成員「${seatName(row.seat)}」`) }, `${p.name || p.id}`)),
    row.skills.filter((p) => p.from === "node").map((p) => h("span", { class: "tm-skill own" }, `${p.name || p.id}@v${p.v}`,
      h("button", { class: "tm-x", "aria-label": T(`Remove ${p.name || p.id}`, `移除 ${p.name || p.id}`), onclick: () => change({ kind: "node", workflow: wf.id, node: row.node, set: {}, removeSkill: p.id }) }, "×"))),
    skillAdd(T(`Add a skill to ${row.label}`, `${row.label} 加 skill`), row.skills.map((p) => p.id), (pin) => change({ kind: "node", workflow: wf.id, node: row.node, set: {}, addSkill: pin })));
  const src = SOURCE[row.source] || [row.source, row.source];
  return h("div", { class: `tm-row${row.source === "missing" ? " missing" : row.custom ? " custom" : ""}`, "data-team-row": row.node },
    h("div", { class: "tm-grid" },
      h("span", { class: "tm-node" }, h("b", {}, row.label), h("span", { class: "faint mono" }, row.node)),
      h("label", { class: "tm-cell" }, h("span", { class: "tm-k" }, T("Member", "成員")), member),
      h("label", { class: "tm-cell" }, h("span", { class: "tm-k" }, T("Model", "模型")), model),
      h("label", { class: "tm-cell" }, h("span", { class: "tm-k" }, "Effort"), effort),
      h("div", { class: "tm-cell tm-wide" }, h("span", { class: "tm-k" }, "Skills"), skills),
      h("span", { class: `tm-src ${row.source}`, "data-source": row.source }, T(...src))),
    row.notes.length ? h("ul", { class: "tm-notes" }, row.notes.map((n) => h("li", {}, L(n)))) : null,
    asking ? askPanel(wf, row) : null);
}
// ---------- the member editor ----------
function memberEditor() {
  const seats = TM.data.seats.filter((s) => s.builtin || s.member || s.declared);
  return h("section", { class: "card tm-members", "data-member-editor": "", "aria-label": T("Team members", "團隊成員") },
    h("div", { class: "tm-mhead" }, h("h2", {}, T("Team members", "團隊成員")),
      h("div", { class: "tm-presets", role: "group", "aria-label": T("Presets", "預設組合") }, (TM.data.presets ?? []).map((p) => h("button", { class: "btn", "data-preset": p.id, disabled: TM.busy || !TM.data.team, onclick: () => change({ kind: "preset", preset: p.id }) }, T(p.en, p.zh)))),
      h("button", { class: "btn ghost", onclick: () => load(true) }, T("Refresh models", "重新讀取模型")),
      h("button", { class: "btn ghost", onclick: () => { TM.editing = false; render(); } }, T("Close", "關閉"))),
    h("p", { class: "faint" }, T("A change here reaches every node that follows the team. A node a workflow customised keeps its own choice.", "這裡的改動會套用到所有跟團隊走的節點；workflow 自訂過的節點維持自己的選擇。")),
    seats.map((s) => {
      const m = s.member, specialist = !s.builtin;
      return h("div", { class: "tm-member", "data-seat-editor": s.id },
        h("span", { class: "tm-mname" }, h("i", { class: "tm-dot", style: `background:${seatColor(s.id)}` }), h("b", {}, L(s.label)), specialist ? h("span", { class: "faint" }, T(" · specialist", " · 專家")) : null,
          h("span", { class: "faint" }, T(` · ${s.uses} node${s.uses === 1 ? "" : "s"}`, ` · ${s.uses} 個節點`))),
        modelSelect(T(`${L(s.label)}'s model`, `${L(s.label)} 的模型`), m, (v) => { if (!v) return; const [provider, ...rest] = v.split("/");
          change(specialist && !m ? { kind: "seat", seat: s.declared, member: { provider, model: rest.join("/"), effort: provider === "codex" ? "medium" : null, skills: [] } } : { kind: "member", seat: s.id, set: { provider, model: rest.join("/"), ...(m ? {} : { effort: provider === "codex" ? "medium" : null }) } }); }),
        m ? effortSelect(T(`${L(s.label)}'s effort`, `${L(s.label)} 的 effort`), m.effort, m.provider, (v) => change({ kind: "member", seat: s.id, set: { effort: v } })) : h("span", { class: "tm-missing" }, T("Nobody yet", "還沒有人")),
        m ? h("div", { class: "tm-skills" }, m.skills.map((p) => h("span", { class: "tm-skill own" }, `${p.name || p.id}@v${p.v}`,
            h("button", { class: "tm-x", "aria-label": T(`Remove ${p.name || p.id} from ${L(s.label)}`, `從「${L(s.label)}」移除 ${p.name || p.id}`), onclick: () => change({ kind: "member", seat: s.id, set: { skills: m.skills.filter((q) => q.id !== p.id).map(({ id, v, sha256 }) => ({ id, v, sha256 })) } }) }, "×"))),
          skillAdd(T(`Add a skill to ${L(s.label)}`, `「${L(s.label)}」加 skill`), m.skills.map((p) => p.id), (pin) => change({ kind: "member", seat: s.id, set: { skills: [...m.skills.map(({ id, v, sha256 }) => ({ id, v, sha256 })), pin] } }))) : h("span"));
    }));
}
// ---------- the page ----------
function card(w) {
  const on = TM.sel === w.id, b = w.badge;
  const badge = b.state === "missing" ? T("Missing", "缺人") : b.state === "custom" ? T(`${b.count} custom`, `${b.count} 項自訂`) : T("Follows team", "跟團隊");
  return h("button", { class: `tm-card${on ? " on" : ""}`, "aria-pressed": String(on), "data-team-card": w.id, onclick: () => { TM.sel = w.id; TM.ask = null; render(); } },
    h("span", { class: "tm-card-h" }, h("b", {}, w.name), h("span", { class: `tm-badge ${b.state}` }, badge)),
    h("span", { class: "tm-steps" }, w.nodes.map((n) => h("span", { class: `tm-step${n.source === "missing" ? " missing" : n.custom ? " custom" : ""}`, title: `${n.label} · ${seatName(n.seat)}` },
      h("i", { class: "tm-dot", style: `background:${seatColor(n.seat)}` }), n.label, n.custom ? " ★" : ""))));
}
function legend() {
  return h("div", { class: "tm-legend", role: "group", "aria-label": T("Team members (open the member editor)", "團隊成員（打開成員編輯）") },
    TM.data.seats.filter((s) => s.builtin || s.member).map((s) => h("button", { class: `tm-leg${s.member ? "" : " empty"}`, "data-legend": s.id, onclick: () => { TM.editing = true; render(); requestAnimationFrame(() => document.querySelector(`[data-seat-editor="${s.id}"] select`)?.focus()); } },
      h("i", { class: "tm-dot", style: `background:${seatColor(s.id)}` }), L(s.label))),
    h("button", { class: "btn", "data-open-members": "", onclick: () => { TM.editing = !TM.editing; render(); } }, T("Edit team", "編輯團隊")));
}
function view() {
  if (!TM.data) { if (!TM.err) load(); return h("div", { class: "page tm" }, h("div", { class: "phead" }, h("div", {}, h("h1", {}, T("Who runs each workflow", "每個 workflow 由誰在做")))), TM.err ? h("div", { class: "card x-pad bad" }, TM.err) : h("div", { class: "skel", style: "height:180px" })); }
  const wf = TM.data.workflows.find((w) => w.id === TM.sel) ?? null;
  const custom = wf?.nodes.some((n) => n.custom);
  return h("div", { class: "page tm", "data-team-page": "" },
    h("div", { class: "phead" }, h("div", {}, h("span", { class: "tm-eyebrow" }, T("Crew · one team for every workflow", "船員 · 一個團隊負責所有 workflow")), h("h1", {}, T("Who runs each workflow", "每個 workflow 由誰在做")),
      h("p", {}, T("Pick a card, then change the model, effort or skills right in the table. Each change asks: only here, or the whole member.", "點一張卡，在下面直接改模型、effort、skills。每次改都會問：只改這裡，還是改整個成員。"))), legend()),
    !TM.data.team ? h("div", { class: "card x-pad tm-empty", "data-team-empty": "" }, T("No team yet: every workflow uses Studio's default model. Fill the seats in the member editor.", "還沒有團隊：每個 workflow 都用 Studio 的預設模型。請在成員編輯裡補上各個位置。")) : null,
    TM.editing ? memberEditor() : null,
    h("div", { class: "tm-cards" }, TM.data.workflows.map(card)),
    wf ? h("section", { class: "card tm-detail", "data-team-detail": wf.id, "aria-label": T(`${wf.name}: final crew`, `${wf.name}：最後的人員配置`) },
      h("div", { class: "tm-dhead" }, h("h2", {}, T(`${wf.name}: who finally runs it`, `${wf.name}：最後的人員配置`)),
        h("span", { class: "faint" }, T("Grey skills come with the member; white ones are this node's.", "灰色 skill＝成員本身帶的；白色＝這個節點加的")),
        custom ? h("button", { class: "btn", "data-restore": wf.id, disabled: TM.busy, onclick: () => change({ kind: "restore", workflow: wf.id }) }, T("Restore to team", "恢復成團隊設定")) : null),
      h("div", { class: "tm-grid tm-head", "aria-hidden": "true" }, [T("Node", "節點"), T("Member", "成員"), T("Model", "模型"), "Effort", "Skills", T("Source", "來源")].map((x) => h("span", {}, x))),
      wf.nodes.map((n) => nodeRow(wf, n)),
      TM.notes.length ? h("div", { class: "tm-adjust", role: "status", "data-team-notes": "" }, h("b", {}, T("Adjusted by the team rules:", "團隊規則自動調整：")), h("ul", {}, TM.notes.map((n) => h("li", {}, `${n.workflow} · ${n.node}: ${L(n)}`)))) : null) : null);
}
routes.team = view;
// the Crew page (live agents) links here: who runs each workflow is set up on this page
{ const base = routes.crew; routes.crew = (arg) => { const v = base(arg); const head = !arg && v?.querySelector?.(".phead");
  if (head && !head.querySelector("[data-team-link]")) head.append(h("a", { class: "btn", href: "#/team", "data-team-link": "" }, icon("crew", "ic sm"), T("Who runs each workflow", "每個 workflow 由誰在做"))); return v; }; }
// a team change elsewhere (a captain card answer) refreshes an open page
window.liveListen?.("team", () => { TM.data = null; if (S.route?.name === "team") load(); });
})();
