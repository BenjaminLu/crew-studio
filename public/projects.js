// Projects, phase 1 (read only; projects design §2): the sidebar's Projects section, the projects index
// (#/projects) and one project's page (#/project/<id>), ported from the approved prototype. Data comes from
// GET /api/projects/overview and GET /api/projects/<id>/overview. The only writes are the existing sensitive-path
// routes (propose, approve, decline); answering a card, changing the crew and the Tasks list are links.
// Freshness (§3.4): the page's one stream. A wrun for this project or any scard refetches the page after 300 ms;
// the sidebar refetches at most every 2 s; health (no event) refetches on (re)connect, on focus, after the page's
// own writes and every 60 s while visible. Loaded before backbone.js.
(() => {
const PJ = { side: null, sideErr: null, sideAt: 0, sideBusy: false, sideNext: null, pages: new Map(), pageTimer: null, proposing: null };
const MARK_CLASS = { local: "", external: "p2", builtin: "p6", studio: "p3" };
const LX = (o) => (o ? T(o.en ?? "", o.tw ?? o["zh-TW"] ?? o.en ?? "") : "");
const getJ = async (u) => { const r = await fetch(u); let j = {}; try { j = await r.json(); } catch {} if (!r.ok) { const e = new Error(T(j.error || `HTTP ${r.status}`, j.tw || j.error || `HTTP ${r.status}`)); e.status = r.status; throw e; } return j; };
const postJ = async (u, b) => { const r = await fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b ?? {}) }); let j = {}; try { j = await r.json(); } catch {} if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`); return j; };
const markOf = (p) => h("span", { class: `pmark ${MARK_CLASS[p.kind] ?? ""}`.trim(), "aria-hidden": p.kind === "studio" ? "true" : null }, p.kind === "studio" ? "·" : (nameOf(p) || "?").slice(0, 1).toUpperCase());
const nameOf = (p) => (p.kind === "builtin" && p.id === "sandbox" ? T("Sandbox", "沙箱") : p.name || p.id);
const hrefOf = (p) => (p.kind === "studio" ? "#/runs?project=studio" : `#/project/${encodeURIComponent(p.id)}`);
const curId = () => (S.route?.name === "project" && S.route.arg ? S.route.arg : null);
const dateOf = (iso) => { if (!iso) return ""; const d = new Date(iso); if (isNaN(d)) return ""; return zh() ? `${d.getMonth() + 1} 月 ${d.getDate()} 日` : d.toLocaleDateString("en-US", { month: "short", day: "numeric" }); };
const readAgo = (at) => { const s = Math.max(0, Math.round((Date.now() - at) / 1000)); return s < 60 ? T(`read ${s} s ago`, `${s} 秒前讀取`) : T(`read ${Math.round(s / 60)} min ago`, `${Math.round(s / 60)} 分鐘前讀取`); };
async function copyPath(path) {
  let done = false;
  try { await navigator.clipboard.writeText(path); done = true; } catch {}
  if (!done) { const t = h("textarea", { style: "position:fixed;left:-9999px" }); t.value = path; document.body.append(t); t.select(); try { done = document.execCommand("copy"); } catch {} t.remove(); }
  toast(done ? T("Path copied", "已複製路徑") : T("Copy failed. Select the path and copy it.", "複製失敗，請選取路徑後複製。"));
}
const copyBtn = (path, cls = "btn ghost icon") => h("button", { class: cls, type: "button", "data-copy": path, "aria-label": T("Copy path", "複製路徑"), title: T("Copy path", "複製路徑"), onclick: (e) => { e.preventDefault(); copyPath(path); } }, icon("copy", "ic sm"));

// ---------- the sidebar section ----------
function sideRow(p) {
  const cur = curId() === p.id || (p.kind === "studio" && S.route?.name === "runs" && S.route.query?.get("project") === "studio");
  const attn = p.attention ? h("span", { class: "count attn", title: T(`${p.attention} cards wait for you`, `${p.attention} 張卡片等你處理`) }, String(p.attention)) : h("span", { class: "count" });
  return h("a", { class: `pj-item${p.enabled === false ? " off" : ""}`, href: hrefOf(p), "data-project-row": p.id, "data-tip": nameOf(p), "aria-current": cur ? "page" : null },
    markOf(p), h("span", { class: "pn" }, nameOf(p)), attn,
    h("span", { class: "ps" }, h("i", { class: `sdot ${p.status?.tone || ""}`.trim() }), h("span", { "data-project-status": p.id }, LX(p.status))));
}
function drawSide() {
  const side = $(".side"), nav = $(".nav"); if (!side || !nav) return;
  let sec = side.querySelector("[data-projects-nav]");
  if (!sec) { sec = h("section", { class: "nav-proj", "data-projects-nav": "1", "aria-labelledby": "projH" }); nav.after(sec); }
  const head = h("div", { class: "nav-proj-h" }, h("a", { id: "projH", href: "#/projects" }, T("Projects", "專案")));
  let body;
  if (PJ.side === null && !PJ.sideErr) body = [0, 1, 2].map(() => h("div", { class: "skel pj-side-skel", "data-projects-skel": "1" }));
  else if (PJ.sideErr && !PJ.side) body = [h("div", { class: "pj-side-msg bad", role: "status" }, T("Registry unreadable", "無法讀取登錄資料"))];
  else {
    const list = PJ.side.projects || [], real = list.filter((p) => p.kind !== "studio");
    body = [PJ.side.error ? h("div", { class: "pj-side-msg bad", role: "status" }, LX(PJ.side.error)) : !real.length ? h("div", { class: "pj-side-msg", "data-projects-empty": "1" }, T("No project yet", "還沒有專案")) : null, ...list.map(sideRow)];
  }
  sec.replaceChildren(head, ...body.filter(Boolean));
  hydrateIcons(sec);
  // the phone's top-bar item carries the open-card count
  const n = (PJ.side?.projects || []).reduce((a, p) => a + (p.attention || 0), 0);
  const ph = document.querySelector('.nav-item[data-view="projects"]');
  if (ph) { let c = ph.querySelector(".count"); if (!c) { c = h("span", { class: "count attn" }); ph.append(c); } c.hidden = !n; c.textContent = n ? String(n) : ""; }
}
async function loadSide(force = false) {
  const wait = 2000 - (Date.now() - PJ.sideAt);
  if (!force && wait > 0) { if (!PJ.sideNext) PJ.sideNext = setTimeout(() => { PJ.sideNext = null; loadSide(true); }, wait); return; }
  if (PJ.sideBusy) { PJ.sideAgain = true; return; }
  PJ.sideBusy = true; PJ.sideAt = Date.now();
  try { PJ.side = await getJ("/api/projects/overview"); PJ.sideErr = null; } catch (e) { PJ.sideErr = e; }
  finally { PJ.sideBusy = false; }
  drawSide();
  if (S.route?.name === "projects" || (S.route?.name === "project" && !S.route.arg)) soft();
  if (PJ.sideAgain) { PJ.sideAgain = false; loadSide(); }
}

// ---------- the projects index ----------
function pipe(segs, cls = "pipe") { return h("div", { class: cls }, (segs || []).map((s) => h("i", { class: s || null }))); }
function viewIndex() {
  if (PJ.side === null && !PJ.sideErr) { loadSide(true); }
  const head = h("div", { class: "phead" }, h("div", {}, h("h1", {}, T("Projects", "專案")), h("p", {}, T("Every project Studio can work in, and what each one is doing now.", "Studio 能工作的每個專案，以及它們現在在做什麼。"))));
  if (PJ.side === null && !PJ.sideErr) return h("div", { class: "page", "data-projects-index": "1" }, head, h("div", { class: "pj-states" }, [0, 1, 2].map(() => h("div", { class: "card x-pad x-stack" }, h("div", { class: "skel", style: "height:22px;width:60%" }), h("div", { class: "skel", style: "height:14px" }), h("div", { class: "skel", style: "height:14px;width:80%" })))));
  if (PJ.sideErr && !PJ.side) return h("div", { class: "page", "data-projects-index": "1" }, head, h("div", { class: "card x-pad x-stack" }, h("div", { class: "err" }, icon("alert", "ic sm"), h("span", {}, T("The project registry cannot be read. Nothing was changed.", "無法讀取專案登錄資料。沒有任何變更。"))), h("div", {}, h("button", { class: "btn", onclick: () => loadSide(true) }, T("Try again", "重試")))));
  const list = PJ.side.projects || [];
  const real = list.filter((p) => p.kind !== "studio");
  const cardOf = (p) => {
    const badge = p.kind === "external" ? h("span", { class: "badge warn" }, h("span", { class: "d" }), T("External", "外部"))
      : p.enabled === false ? h("span", { class: "badge" }, T("Disabled", "已停用"))
      : p.folderMissing ? h("span", { class: "badge warn" }, h("span", { class: "d" }), T("Folder missing", "資料夾不見了"))
      : p.attention ? h("span", { class: "badge human" }, h("span", { class: "d" }), String(p.attention))
      : p.running ? h("span", { class: "badge run" }, h("span", { class: "d pulse" }), String(p.running))
      : p.kind === "builtin" ? h("span", { class: "badge" }, T("Built-in", "內建")) : null;
    // the prototype's line: "2 wait for you · 2 running · 1 held"; the sandbox and Studio say what they are
    const en = [], tw = [];
    if (p.attention) { en.push(`${p.attention} wait for you`); tw.push(`${p.attention} 等你處理`); }
    if (p.running) { en.push(`${p.running} running`); tw.push(`${p.running} 進行中`); }
    if (p.held) { en.push(`${p.held} held`); tw.push(`${p.held} 暫緩`); }
    const counts = en.length ? { en: en.join(" · "), tw: tw.join(" · ") } : null;
    const line = p.kind === "external" ? T("External project: cannot dispatch yet. Its GitHub grant cannot be verified on this build.", "外部專案：暫時無法派工。目前版本無法驗證它的 GitHub 授權。")
      : p.enabled === false ? T("Disabled. New tasks and rounds will not start.", "已停用。不會開始新任務或新的一輪。")
      : p.folderMissing ? T("Folder missing. The registered folder is gone or is not a Git repository.", "資料夾不見了。登錄的資料夾不見了，或不是 Git 儲存庫。")
      : p.kind !== "studio" && p.kind !== "external" && p.canStart === false ? T("No task can start. The project page says why.", "無法開始任何任務。專案頁會說明原因。")
      : p.kind === "studio" ? T(`Tasks that belong to no project (artifact work, proposals).${counts ? ` ${counts.en}.` : ""}`, `不屬於任何專案的任務（成品工作、提案）。${counts ? `${counts.tw}。` : ""}`)
      : p.kind === "builtin" && !counts ? T("No tasks yet. Studio's own practice repository.", "還沒有任務。Studio 內建的練習用儲存庫。")
      : counts ? T(counts.en, counts.tw) + (p.failed24h ? T(` · ${p.failed24h} failed in the last 24 h`, ` · 近 24 小時 ${p.failed24h} 個失敗`) : "")
      : p.failed24h ? LX(p.status) : T("No tasks running.", "目前沒有進行中的任務。");
    return h("a", { class: "card x-pad x-stack", href: hrefOf(p), "data-project-card": p.id },
      h("div", { class: "x-row" }, markOf(p), h("b", {}, nameOf(p)), h("span", { class: "x-grow" }), badge),
      h("div", { class: "faint", style: "font-size:13px" }, line), (p.mini || []).length ? pipe(p.mini) : null);
  };
  return h("div", { class: "page", "data-projects-index": "1" }, head,
    PJ.side.error ? h("div", { class: "err" }, icon("alert", "ic sm"), h("span", {}, T("The project registry cannot be read. Nothing was changed.", "無法讀取專案登錄資料。沒有任何變更。"))) : null,
    !real.length && !PJ.side.error ? h("div", { class: "card" }, h("div", { class: "empty", "data-projects-empty": "1" }, icon("folder"), h("b", {}, T("No project yet", "還沒有專案")), h("span", {}, T("Register a folder you already have, or make an empty one.", "登錄你已有的資料夾，或建立一個空專案。")))) : null,
    h("div", { class: "pj-states" }, list.map(cardOf)));
}

// ---------- one project's page ----------
async function loadPage(id) {
  const cur = PJ.pages.get(id) || {}; if (cur.busy) { cur.again = true; return; }
  cur.busy = true; PJ.pages.set(id, cur);
  try { cur.data = await getJ(`/api/projects/${encodeURIComponent(id)}/overview`); cur.err = null; cur.at = Date.now(); } catch (e) { cur.err = e; cur.at = Date.now(); }
  finally { cur.busy = false; }
  if (curId() === id) soft();
  if (cur.again) { cur.again = false; loadPage(id); }
}
function pageSoon(id, ms = 300) { clearTimeout(PJ.pageTimer); PJ.pageTimer = setTimeout(() => loadPage(id), ms); }
/** a worktree path shortened at its start, keeping the task folder: …/work/wt/<project>/<task> (Copy takes the whole path) */
const shortPath = (path) => { const s = String(path || ""), i = s.indexOf("/work/wt/"); if (i > 0) return `…${s.slice(i)}`; const parts = s.split("/"); return parts.length > 4 ? `…/${parts.slice(-3).join("/")}` : s; };
const failed = (x) => x && typeof x === "object" && !Array.isArray(x) && typeof x.error === "string";
const sectionErr = (en, tw) => h("div", { class: "err", role: "status", "data-section-error": "1" }, icon("alert", "ic sm"), h("span", {}, T(`${en} could not be read. Nothing was changed.`, `無法讀取${tw}。沒有任何變更。`)));
const scrollTo = (id) => (e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ block: "start", behavior: "smooth" }); };
const HEALTH_IC = { enabled: "check", "enabled-bad": "x", registered: "shield", base: "branch", crew: "crew", test: "tool", rules: "clock", gitconfig: "clock" };

function waitBadge(t) {
  const w = t.waitsOn || {};
  if (w.kind === "captain" || w.kind === "hold") return h("span", { class: "badge human", "data-run-state": "waiting" }, h("span", { class: "d" }), T("Waiting for you", "等你處理"));
  if (w.kind === "queue") return h("span", { class: "badge warn", "data-run-state": "held" }, h("span", { class: "d" }), T("Held", "暫緩"));
  return window.runStateBadge ? window.runStateBadge(t) : h("span", { class: "badge" }, t.status);
}
function taskRow(t) {
  const roundsTxt = t.rounds ? (t.waitsOn?.kind === "agent" ? T(`round ${t.rounds}`, `第 ${t.rounds} 輪`) : T(`${t.rounds} ${t.rounds === 1 ? "round" : "rounds"}`, `${t.rounds} 輪`)) : T("0 rounds", "0 輪");
  const door = t.door ? h("span", { class: `door ${t.door === "one-way" ? "one" : "two"}` }, t.door === "one-way" ? T("one-way", "單向門") : t.door === "two-way" ? T("two-way", "雙向門") : t.door) : null;
  const detail = LX(t.waitsOn?.detail ? { en: t.waitsOn.detail.en, tw: t.waitsOn.detail["zh-TW"] } : null);
  return h("div", { class: "pj-task", "data-project-task": t.id },
    h("div", {}, h("div", { class: "run-t" }, h("span", { class: "tid" }, t.id), h("a", { href: t.href }, h("span", {}, t.title || t.id))),
      pipe(t.pipe),
      h("div", { class: "run-s" }, h("span", { class: "vbadge" }, `${t.workflow}${t.version ? ` v${t.version}` : ""}`), door, h("span", {}, roundsTxt))),
    h("div", { class: "pj-wait", "data-waits-on": t.waitsOn?.kind || "none" }, waitBadge(t), detail ? h("span", { class: "faint" }, detail) : null));
}
const KIND_WORD = { merge: ["merge card", "合併卡"], scope: ["scope card", "範圍卡"], dispatch: ["dispatch card", "派工卡"], permission: ["permission card", "權限卡"], plan: ["plan card", "計畫卡"], question: ["question card", "問題卡"], acceptance: ["acceptance card", "驗收卡"], "round-budget": ["round budget card", "回合預算卡"], "step-back": ["step-back card", "退一步卡"], promote: ["promote card", "升級卡"], retro: ["retro card", "回顧卡"] };
function cardRow(c) {
  const kw = KIND_WORD[c.kind] || [`${c.kind} card`, `${c.kind} 卡`];
  const bits = [T(kw[0], kw[1]), c.captainOnly ? T("captain only", "只限船長") : null, c.door ? (c.door === "one-way" ? T("one-way", "單向門") : c.door === "two-way" ? T("two-way", "雙向門") : c.door) : null, c.run].filter(Boolean);
  return h("div", { class: "pj-card", "data-project-card-row": c.id },
    h("span", { class: "need-ic" }, icon(c.kind === "merge" ? "pr" : c.kind === "scope" || c.kind === "permission" ? "crew" : "human")),
    h("div", {}, h("div", { class: "need-t" }, LX(c.title)), h("div", { class: "need-d" }, bits.join(" · "))),
    h("a", { class: "btn primary", href: c.href, "data-card-link": c.id }, T("Open card", "開啟卡片")));
}
function crewSection(d) {
  const p = d.project, crew = d.crew;
  // the crew link only where tasks can start (the staffing check passes); otherwise the panel could not staff it
  const canLink = p.kind !== "studio" && p.canStart === true;
  const head = h("div", { class: "sec-head" }, h("h2", { id: "hCrew" }, T("Crew", "船員")), h("span", { class: "faint" }, T("read only", "唯讀")), h("span", { class: "x-grow" }),
    canLink ? h("a", { class: "btn", href: `#/firstmate?staffing=${encodeURIComponent(p.id)}`, "data-crew-link": p.id }, icon("message", "ic sm"), h("span", {}, T("Choose your crew together", "一起決定代理配置"))) : null);
  let body;
  const plain = (en, tw, attr) => h("div", { class: "pj-empty-row", "data-crew-state": attr }, T(en, tw));
  if (p.enabled === false) body = plain("Crew not checked: the project is disabled.", "未檢查船員：專案已停用。", "disabled");
  else if (failed(crew)) body = crew.error === "refused" ? plain(`No task can start: ${crew.detail?.en ?? ""}`, `無法開始任何任務：${crew.detail?.tw ?? ""}`, "refused")
    : sectionErr("The crew", "船員配置");
  else if (p.kind === "external") body = h("div", { class: "pj-empty-row" }, T("External project: cannot dispatch yet. Its GitHub grant cannot be verified on this build.", "外部專案：暫時無法派工。目前版本無法驗證它的 GitHub 授權。"));
  else if (!crew) body = h("div", { class: "pj-empty-row", "data-crew-empty": "1" }, T("No crew approved yet. Tasks here will wait at their first round.", "還沒有核准的船員。這裡的任務會停在第一輪。"));
  else body = h("div", { class: "pj-crew-wf", "data-crew": crew.workflow },
    h("div", { class: "x-row wrap" }, h("b", {}, `${crew.workflow} v${crew.version}`), h("span", { class: "badge ok" }, h("span", { class: "d" }), T(`Approved · config v${crew.config}`, `已核准 · 配置 v${crew.config}`)),
      h("span", { class: "faint" }, [crew.approvedAt ? dateOf(crew.approvedAt) : null, crew.signed ? T("signed", "已簽章") : null].filter(Boolean).join(" · "))),
    h("div", { class: "pj-roles" }, crew.roles.map((r) => h("div", { class: "pj-role" }, h("span", { class: "rn" }, r.role),
      h("span", { class: "rc" }, [r.provider, r.model, r.effort].filter(Boolean).map((x) => h("span", { class: "vbadge" }, x))), h("span", { class: "pj-src" }, r.skill)))),
    h("div", { class: "faint", style: "font-size:12px" }, T("One approved crew covers the project. To change it, use Choose your crew together on the Firstmate page.", "一份核准的船員配置涵蓋整個專案。要修改，請到 Firstmate 頁的「一起決定代理配置」。")));
  return h("section", { id: "s-crew", "aria-labelledby": "hCrew" }, head, h("div", { class: "card" }, body));
}
function sensitiveSection(d, id) {
  const s = d.sensitive;
  const act = async (what, body) => { try { await postJ(`/api/projects/${encodeURIComponent(id)}/${what}`, body); PJ.proposing = null; toast(what === "approve" ? T("Approved: the lines are in force.", "已核准：這些規則已生效。") : what === "decline" ? T("Declined.", "已拒絕。") : T("Proposed. Approve it to put it in force.", "已提議。核准後才生效。")); } catch (e) { toast(e.message); } loadPage(id); loadSide(true); };
  const head = h("div", { class: "sec-head" }, h("h2", { id: "hSens" }, T("Sensitive paths", "敏感路徑")), h("span", { class: "faint" }, T("one-way door", "單向門")), h("span", { class: "x-grow" }),
    failed(s) ? null : h("button", { class: "btn ghost", type: "button", "data-propose-open": "1", onclick: () => { PJ.proposing = PJ.proposing === null ? "" : null; soft(); } }, T("Propose", "提議")));
  if (failed(s)) return h("section", { id: "s-paths", "aria-labelledby": "hSens" }, head, h("div", { class: "card x-pad" }, sectionErr("Sensitive paths", "敏感路徑")));
  const lines = (rules) => h("ul", { class: "x-reasons pj-sens" }, rules.map((r) => h("li", {}, h("code", {}, r.glob), r.why ? [" — ", h("span", {}, r.why)] : null)));
  const ta = PJ.proposing !== null ? h("textarea", { class: "input", "data-propose-text": "1", "aria-label": T("Proposed lines", "提議的規則"), placeholder: T("One per line: glob — why\nmigrations/** — schema changes", "每行一條：glob — 原因\nmigrations/** — schema 變更"), oninput: (e) => { PJ.proposing = e.target.value; } }) : null;
  if (ta) ta.value = PJ.proposing;
  return h("section", { id: "s-paths", "aria-labelledby": "hSens" }, head, h("div", { class: "card x-pad x-stack" },
    s.project.length ? lines(s.project) : h("div", { class: "faint", style: "font-size:13px" }, T("No project lines yet.", "還沒有專案自己的規則。")),
    ta ? h("div", { class: "pj-propose" }, ta, h("div", { class: "actions" },
      h("button", { class: "btn primary", type: "button", "data-propose-send": "1", onclick: () => { const rules = (PJ.proposing || "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [glob, ...why] = l.split(/\s+[—-]\s+/); return { glob: glob.trim(), why: why.join(" — ").trim() }; }); if (!rules.length) return; act("propose", { rules }); } }, T("Propose list", "提議清單")),
      h("button", { class: "btn ghost", type: "button", onclick: () => { PJ.proposing = null; soft(); } }, T("Cancel", "取消")))) : null,
    s.proposed ? h("div", { class: "card x-pad x-stack", style: "background:var(--human-soft);box-shadow:none", "data-proposed": "1" },
      h("b", { style: "font-size:13px" }, T("Proposed (not in force until you approve)", "提議中（核准前不生效）")), lines(s.proposed),
      h("div", { class: "actions" }, h("button", { class: "btn primary", type: "button", "data-approve-list": "1", onclick: () => act("approve") }, T("Approve list", "核准清單")),
        h("button", { class: "btn ghost", type: "button", "data-decline-list": "1", onclick: () => act("decline") }, T("Decline", "拒絕")))) : null,
    s.orgCount ? h("details", {}, h("summary", { class: "faint", style: "font-size:13px" }, T(`Plus ${s.orgCount} org defaults`, `另有 ${s.orgCount} 條組織預設`)),
      h("ul", { class: "x-reasons", style: "margin-top:6px" }, s.org.map((r) => h("li", {}, h("code", {}, r.glob))))) : null));
}
const OUT = { review: ["pr", "a1"], merge: ["check", "a2"], web: ["monitor", "a3"], doc: ["doc", "a5"], image: ["eye", "a4"], video: ["film", "a4"], audio: ["music", "a5"] };
function outputsSection(d) {
  const o = d.outputs;
  const body = failed(o) ? h("div", { class: "x-pad" }, sectionErr("Outputs", "成品")) : !o.length ? h("div", { class: "pj-empty-row", "data-outputs-empty": "1" }, T("No outputs yet.", "還沒有成品。"))
    : o.map((x) => { const [ic, tone] = OUT[x.kind] || OUT.doc;
      const link = x.kind === "web" && x.external ? h("a", { href: x.href, target: "_blank", rel: "noopener" }, T("Preview", "預覽"))
        : x.kind === "review" || x.kind === "merge" ? h("a", { href: x.href }, T("Task", "任務")) : h("a", { href: x.href }, T("Library", "成品庫"));
      return h("div", { class: "pj-li", "data-output": x.kind }, h("span", { class: "pj-thumb", style: `background:var(--${tone});color:var(--${tone}t)` }, icon(ic)),
        h("span", { class: "t" }, h("span", {}, LX(x.title)), h("small", {}, LX(x.sub))), link); });
  return h("section", { id: "s-out", "aria-labelledby": "hOut" }, h("div", { class: "sec-head" }, h("h2", { id: "hOut" }, T("Outputs", "成品"))), h("div", { class: "card pj-list" }, body));
}
function worktreesSection(d) {
  const w = d.worktrees;
  const body = failed(w) ? h("div", { class: "x-pad" }, sectionErr("Worktrees", " Worktree")) : !w.length ? h("div", { class: "pj-empty-row" }, T("No worktrees.", "沒有 worktree。"))
    : w.map((x) => h("div", { class: "pj-li", "data-worktree": x.task }, icon("branch"), h("span", { class: "t" }, h("code", {}, x.branch),
      h("small", { title: x.path, "data-worktree-path": x.path }, x.busy ? T(`${shortPath(x.path)} · an agent is working here`, `${shortPath(x.path)} · 代理正在這裡工作`) : shortPath(x.path))), copyBtn(x.path)));
  return h("section", { id: "s-wt", "aria-labelledby": "hWt" }, h("div", { class: "sec-head" }, h("h2", { id: "hWt" }, T("Worktrees", "Worktree")), failed(w) ? null : h("span", { class: "badge" }, String(w.length))), h("div", { class: "card pj-list" }, body));
}
function viewPage(id) {
  const st = PJ.pages.get(id);
  if (!st || (!st.data && !st.err)) { if (!st?.busy) loadPage(id); }
  const sideP = (PJ.side?.projects || []).find((p) => p.id === id);
  if (!st?.data) {
    if (st?.err) return h("div", { class: "page", "data-project-page": id }, h("div", { class: "card" }, h("div", { class: "empty", "data-project-missing": "1" }, icon("folder"),
      h("b", {}, st.err.status === 404 ? T("No such project", "沒有這個專案") : T("This project cannot be read. Nothing was changed.", "無法讀取這個專案。沒有任何變更。")),
      h("a", { class: "btn", href: "#/projects" }, T("All projects", "全部專案")))));
    // loading: the header from the sidebar data, three card skeletons
    return h("div", { class: "page", "data-project-page": id, "data-loading": "1" }, sideP ? h("header", { class: "pj-head" }, h("span", { class: `pmark lg ${MARK_CLASS[sideP.kind] ?? ""}` }, nameOf(sideP).slice(0, 1).toUpperCase()), h("div", { class: "pj-title" }, h("h1", {}, nameOf(sideP)))) : h("div", { class: "skel", style: "height:36px;width:240px" }),
      [0, 1, 2].map(() => h("div", { class: "card x-pad x-stack" }, h("div", { class: "skel", style: "height:22px;width:50%" }), h("div", { class: "skel", style: "height:14px" }), h("div", { class: "skel", style: "height:14px;width:70%" }))));
  }
  const d = st.data, p = d.project;
  const tasks = failed(d.tasks) ? null : d.tasks, cards = failed(d.cards) ? null : d.cards;
  const kindWord = p.kind === "external" ? T("External project", "外部專案") : p.kind === "builtin" ? T("Studio's own practice repository", "Studio 內建的練習用儲存庫") : T("Local repository", "本機儲存庫");
  const reg = failed(p.registeredAt) ? null : p.registeredAt;
  const idLine = [kindWord, p.repository ? p.repository : null, reg ? T(`registered ${dateOf(reg)}`, `${dateOf(reg)}註冊`) : null, `id ${p.id}`].filter(Boolean).join(" · ");
  const header = h("header", { class: "pj-head" }, h("span", { class: `pmark lg ${MARK_CLASS[p.kind] ?? ""}`.trim() }, p.kind === "studio" ? "·" : nameOf(p).slice(0, 1).toUpperCase()),
    h("div", { class: "pj-title" },
      h("h1", {}, nameOf(p), p.kind === "studio" ? null : p.enabled ? h("span", { class: "badge ok", "data-project-enabled": "1" }, h("span", { class: "d" }), T("Enabled", "已啟用")) : h("span", { class: "badge bad", "data-project-enabled": "0" }, h("span", { class: "d" }), T("Disabled", "已停用")),
        p.kind === "studio" ? null : p.folderMissing ? h("span", { class: "badge warn", "data-project-folder": "missing" }, icon("alert", "ic sm"), T("Folder missing", "資料夾不見了"))
          : p.kind === "builtin" ? h("span", { class: "badge", "data-project-registered": "builtin" }, T("Built-in", "內建"))
          : p.kind === "external" ? h("span", { class: "badge warn", "data-project-registered": "external" }, icon("alert", "ic sm"), T("External", "外部"))
          : h("span", { class: "badge", "data-project-registered": "registered" }, icon("check", "ic sm"), T("Registered", "已註冊"))),
      p.kind === "studio" ? h("div", { class: "pj-id" }, h("span", { class: "faint" }, T("Tasks that belong to no project.", "不屬於任何專案的任務。"))) : h("div", { class: "pj-id" },
        p.path ? h("span", {}, icon("folder", "ic sm"), h("code", { "data-project-path": "1" }, p.path), copyBtn(p.path, "btn ghost icon cp")) : null,
        p.base ? h("span", {}, icon("branch", "ic sm"), h("span", { class: "vbadge" }, p.base)) : null,
        h("span", { class: "faint" }, idLine))));
  const notice = p.kind === "external" ? h("div", { class: "note pj-notice", "data-project-notice": "external" }, h("b", {}, T("External project: cannot dispatch yet.", "外部專案：暫時無法派工。")), " ", T("Its GitHub grant cannot be verified on this build.", "目前版本無法驗證它的 GitHub 授權。"))
    : p.enabled !== false && p.folderMissing ? h("div", { class: "note pj-notice", "data-project-notice": "folder" }, h("b", {}, T("Folder missing.", "資料夾不見了。")), " ", T("The registered folder is gone or is not a Git repository. No task can start here.", "登錄的資料夾不見了，或不是 Git 儲存庫。這裡無法開始任何任務。"))
    : p.enabled === false ? h("div", { class: "note pj-notice", "data-project-notice": "disabled" }, h("b", {}, T("Disabled.", "已停用。")), " ", T("New tasks and rounds will not start.", "不會開始新任務或新的一輪。")) : null;
  const studio = p.kind === "studio";
  const chips = h("nav", { class: "pj-jump chips", "aria-label": T("Sections", "區段") },
    h("a", { class: "chip", href: "#s-tasks", onclick: scrollTo("s-tasks") }, tasks ? T(`Tasks · ${tasks.length}`, `任務 · ${tasks.length}`) : T("Tasks", "任務")),
    cards?.length ? h("a", { class: "chip", href: "#s-cards", onclick: scrollTo("s-cards") }, T(`Cards · ${cards.length}`, `卡片 · ${cards.length}`)) : null,
    studio ? null : [h("a", { class: "chip", href: "#s-crew", onclick: scrollTo("s-crew") }, T("Crew", "船員")), h("a", { class: "chip", href: "#s-paths", onclick: scrollTo("s-paths") }, T("Sensitive paths", "敏感路徑")),
      h("a", { class: "chip", href: "#s-out", onclick: scrollTo("s-out") }, T("Outputs", "成品")), h("a", { class: "chip", href: "#s-wt", onclick: scrollTo("s-wt") }, T("Worktrees", "Worktree"))]);
  const attn = cards?.length ? h("div", { class: "card pj-attn", role: "status", "data-project-attention": String(cards.length) }, h("span", { class: "need-ic" }, icon("human")),
    h("div", {}, h("b", {}, cards.length === 1 ? T("1 card waits for you", "1 張卡片等你處理") : T(`${cards.length} cards wait for you`, `${cards.length} 張卡片等你處理`)),
      h("div", { class: "need-d" }, cards.slice(0, 2).map((c) => `${c.run}: ${LX(c.title)}`).join(" · ") + (cards.length > 2 ? " …" : ""))),
    h("a", { class: "btn primary", href: "#s-cards", onclick: scrollTo("s-cards") }, T("Answer", "處理"))) : null;
  let health = null;
  if (!studio) {
    const hs = failed(d.health) ? null : d.health;
    const pass = hs ? hs.filter((x) => x.tone === "ok") : [];
    health = h("section", { "aria-labelledby": "hHealth", "data-project-health": "1" }, h("div", { class: "sec-head" }, h("h2", { id: "hHealth" }, T("Health", "健康狀態")), h("span", { class: "faint" }, readAgo(st.at))),
      !hs ? h("div", { class: "card x-pad" }, sectionErr("Health", "健康狀態")) : h("div", { class: "card pj-health" },
        pass.length ? h("div", { class: "pj-h pj-h-sum" }, icon("check"), h("b", {}, pass.length === 1 ? T("1 check passes", "1 項檢查通過") : T(`${pass.length} checks pass`, `${pass.length} 項檢查通過`)), h("span", {}, pass.map((x) => T(x.en, x.tw).toLowerCase()).join(T(", ", "、")))) : null,
        hs.map((x) => h("div", { class: `pj-h ${x.tone}`, "data-health": x.key }, icon(HEALTH_IC[x.tone === "bad" && HEALTH_IC[`${x.key}-bad`] ? `${x.key}-bad` : x.key] || "check"), h("b", {}, T(x.en, x.tw)),
          x.code ? h("span", {}, h("code", { class: "mono" }, x.code), x.detail ? [" · ", h("span", {}, LX(x.detail))] : null) : x.detail ? h("span", {}, LX(x.detail)) : null))));
  }
  const tasksSec = h("section", { id: "s-tasks", "aria-labelledby": "hTasks" },
    h("div", { class: "sec-head" }, h("h2", { id: "hTasks" }, T("Active tasks", "進行中的任務")), tasks ? h("span", { class: "badge run" }, String(tasks.length)) : null, h("span", { class: "x-grow" }),
      h("a", { class: "btn ghost", href: `#/runs?project=${encodeURIComponent(p.id)}` }, T("All tasks", "全部任務"))),
    h("div", { class: "card" }, !tasks ? h("div", { class: "x-pad" }, sectionErr("Tasks", "任務")) : tasks.length ? tasks.map(taskRow) : h("div", { class: "pj-empty-row", "data-tasks-empty": "1" }, T("Nothing running.", "目前沒有進行中的任務。"))));
  const cardsSec = cards?.length ? h("section", { id: "s-cards", "aria-labelledby": "hCards" }, h("div", { class: "sec-head" }, h("h2", { id: "hCards" }, T("Cards waiting for you", "等你處理的卡片")), h("span", { class: "badge human" }, String(cards.length))),
    h("div", { class: "card" }, cards.map(cardRow))) : !cards ? h("section", { id: "s-cards" }, sectionErr("Cards", "卡片")) : null;
  const left = h("div", { class: "pj-col" }, tasksSec, cardsSec, studio ? null : crewSection(d));
  const right = studio ? null : h("div", { class: "pj-col" }, sensitiveSection(d, p.id), outputsSection(d), worktreesSection(d));
  return h("div", { class: "page", "data-project-page": id }, header, notice, chips, attn, health, h("div", { class: "pj-cols" }, left, right));
}

routes.projects = viewIndex;
routes.project = (arg) => (arg ? viewPage(arg) : viewIndex());

// ---------- freshness ----------
// a wrun carries the run's project (projectOf); one that is not a registered project counts under the Studio row
const rowOf = (project) => (project && (PJ.side?.projects || []).some((p) => p.id === project && p.kind !== "studio") ? project : "studio");
window.liveListen?.("wrun", (m) => { let d = {}; try { d = JSON.parse(m.data); } catch {} loadSide(); const id = curId(); if (id && (d.deleted || !d.project || rowOf(d.project) === id)) pageSoon(id); });
window.liveListen?.("scard", () => { loadSide(); const id = curId(); if (id) pageSoon(id); });
for (const t of ["artifacts", "changes", "agent"]) window.liveListen?.(t, () => { const id = curId(); if (id) pageSoon(id, 600); });
addEventListener("crew:live", () => { loadSide(true); const id = curId(); if (id) loadPage(id); });
addEventListener("focus", () => { loadSide(true); const id = curId(); if (id) loadPage(id); });
setInterval(() => { if (document.hidden) return; loadSide(true); const id = curId(); if (id) loadPage(id); }, 60_000);
addEventListener("hashchange", () => { PJ.proposing = null; setTimeout(drawSide, 0); const id = curId(); if (id && PJ.pages.get(id)?.data) loadPage(id); });
{ const prev = window.onLang; window.onLang = () => { prev?.(); drawSide(); }; }
drawSide(); loadSide(true);
window.crewProjects = { reload: () => { loadSide(true); const id = curId(); if (id) loadPage(id); }, state: PJ };
})();
