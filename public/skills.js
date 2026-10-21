// Skills (unit agent-skills): the skill library and the role skills, and the
// import form (a local folder, a skills home, a public https git URL). Routes:
// #/skills (primary page), #/library/skills (compatible alias), and
// #/skills/<id>[@v] (the read-only skill viewer over Skills). A row shows a skill's name,
// description, source, version and hash; Read opens the viewer with its exact text.
(() => {
const SK = { data: null, homes: null, kind: "folder", msg: null, busy: false, path: "", url: "", sub: "" };
window.crewSkills = SK; // the workflow editor reads the same library
const getJ = (u) => fetch(u).then((r) => r.json());
async function load() {
  try { const [d, hm] = await Promise.all([getJ("/api/skills"), getJ("/api/skills/homes")]); SK.data = d; SK.homes = hm.homes || []; } catch { SK.data = { skills: [], roles: [] }; SK.homes = []; }
  if (S.route?.name === "skills" || (S.route?.name === "library" && S.route.arg === "skills")) soft();
}
const KIND = { builtin: ["Built in", "內建"], folder: ["Folder", "資料夾"], home: ["Skills home", "技能目錄"], git: ["Git", "Git"], role: ["Role skill", "角色技能"] };
const kindLabel = (k) => T(...(KIND[k] || [k, k]));
const short = (h) => (h ? h.slice(0, 12) : "—");
/** "19 B" under a kilobyte, "7.4 KB" above; in a sentence, "9 bytes" */
// the one size format (src/runtime/defs.ts fmtSize): under 1 KB in bytes, under 10 KB with one decimal, else whole KB
const size = (n) => (n < 1024 ? `${n} B` : n < 10 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${Math.round(n / 1024)} KB`);
const sizeWords = (n) => (n < 1024 ? T(`${n} byte${n === 1 ? "" : "s"}`, `${n} 位元組`) : size(n));
/** "1 skill", "2 skills" */
const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const andList = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
/** what Studio says about the keys a skill asked for (allowed-tools, network …) and ignored */
const ignoredText = (keys) => T(`This skill asked for ${andList(keys)}. Studio ignored the request: a skill is text only and never changes tools, sandbox, network or credentials.`,
  `這個技能要求了 ${keys.join("、")}。Studio 忽略了這個要求：技能只是文字，不會改變工具、沙箱、網路或憑證。`);
window.crewSkillsSize = size; window.crewSkillsCount = count; window.crewSkillsIgnored = ignoredText;
/** How well a skill fits a node (src/skills.ts skillFit, the same rule): 0 not this kind of node, 1 may go here, 2+ suggested. */
window.crewSkillFit = (fits, n) => {
  if (!fits) return 1;
  if (fits.kinds?.length && !fits.kinds.includes(n.kind)) return 0;
  const words = [n.role?.id, n.role?.label, n.role?.skill, n.id].filter(Boolean).join(" ").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
  return 1 + (fits.roles || []).filter((r) => words.some((w) => w.startsWith(r) || r.startsWith(w))).length + (n.format && fits.formats?.includes(n.format) ? 1 : 0);
};
/** "For reviewer, judge · web output" — where a skill fits, in words */
const fitText = (fits) => { const r = fits?.roles || [], f = fits?.formats || []; if (!r.length && !f.length) return T("For any agent node", "適用：任何 agent 節點");
  return T(`For ${r.length ? r.join(", ") : "any role"}${f.length ? ` · ${f.join(", ")} output` : ""}`, `適用：${r.length ? r.join("、") : "任何角色"}${f.length ? `・產出 ${f.join("、")}` : ""}`); };
window.crewSkillFitText = fitText;
/** The workflow editor's Import skills: the same import form in a dialog, opened on the skills homes (~/.claude/skills);
 *  after each import onImported() reloads the editor's library. Closing returns focus to the button that opened it. */
window.crewSkillImport = (onImported, opener) => {
  const root = document.getElementById("modalRoot"); const was = SK.kind;
  SK.kind = "home"; SK.msg = null; SK.onImported = onImported;
  const box = h("div", { class: "sk-dialog-body" });
  const redraw = () => { box.replaceChildren(importCard(redraw)); hydrateIcons(box); };
  const close = () => { root.replaceChildren(); SK.kind = was; SK.msg = null; SK.onImported = null; opener?.focus?.(); };
  const back = h("div", { class: "modal-back", onclick: (e) => { if (e.target === back) close(); } },
    h("div", { class: "modal sk-dialog", role: "dialog", "aria-modal": "true", "aria-label": T("Import skills", "匯入技能"), "data-skill-import-dialog": "1" }, box,
      h("div", { class: "actions", style: "justify-content:flex-end" }, h("button", { class: "btn", type: "button", "data-skill-import-close": "1", onclick: close }, T("Done", "完成")))));
  back.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  root.replaceChildren(back); redraw(); back.querySelector("[data-import-kind]")?.focus();
  // the homes are read again on every open: a skill the captain just added to ~/.claude/skills is listed
  getJ("/api/skills/homes").then((hm) => { SK.homes = hm.homes || []; if (back.isConnected) redraw(); }).catch(() => {});
};

async function doImport(body, redraw = soft) {
  SK.busy = true; SK.msg = { state: "busy", text: T("Importing…", "匯入中…") }; redraw();
  const r = await postJ("/api/skills/import", body);
  SK.busy = false;
  if (r.error) SK.msg = { state: "error", text: r.error };
  else SK.msg = { state: "ok", text: r.created ? T(`${r.skill.id} v${r.version.n} imported`, `已匯入 ${r.skill.id} v${r.version.n}`) : T(`${r.skill.id} is unchanged: still v${r.version.n}`, `${r.skill.id} 沒有變更：仍是 v${r.version.n}`) };
  await load(); if (!r.error) await SK.onImported?.(); redraw();
}

/** The import form. redraw: the Skills page renders the route; the editor's Import skills dialog redraws only itself. */
function importCard(redraw = render) {
  const go = (body) => doImport(body, redraw === render ? soft : redraw);
  // the result (a refusal and its reason) sits right under the field it is about
  const msg = h("div", { class: `sk-msg ${SK.msg?.state || ""}`, role: "status", "aria-live": "polite", "data-import-msg": "1", "data-state": SK.msg?.state || "" }, SK.msg?.text || "");
  const seg = h("div", { class: "seg", role: "group", "aria-label": T("Import from", "匯入來源") },
    [["folder", "Folder", "資料夾"], ["home", "From your Claude skills", "從你的 Claude 技能"], ["git", "Git URL", "Git 網址"]].map(([k, en, tw]) =>
      h("button", { type: "button", "aria-pressed": String(SK.kind === k), "data-import-kind": k, onclick: () => { SK.kind = k; SK.msg = null; redraw(); } }, h("span", { class: "keep" }, T(en, tw)))));
  let body;
  if (SK.kind === "folder") {
    const path = h("input", { class: "input", placeholder: "/Users/you/skills/plain-writing", "aria-label": T("Folder path", "資料夾路徑"), "data-import-path": "1", value: SK.path, oninput: (e) => { SK.path = e.target.value; } });
    body = h("div", { class: "sk-form" }, h("label", { class: "sk-field" }, h("span", {}, T("A folder that holds a SKILL.md (absolute path)", "放著 SKILL.md 的資料夾（絕對路徑）")), path), msg,
      h("div", { class: "actions" }, h("button", { class: "btn primary", "data-import-go": "1", disabled: SK.busy || null, onclick: () => go({ kind: "folder", path: path.value.trim() }) }, icon("download", "ic sm"), T("Import", "匯入"))));
  } else if (SK.kind === "home") {
    body = h("div", { class: "sk-homes" }, (SK.homes || []).map((hm) => h("div", { class: "sk-home", "data-home": hm.id },
      h("div", { class: "sk-home-h" }, h("b", { class: "mono" }, hm.label), h("span", { class: "faint" }, hm.exists ? T(count(hm.skills.length, "skill"), `${hm.skills.length} 個技能`) : T("not on this Mac", "這台 Mac 上沒有"))),
      hm.skills.length ? h("div", { class: "sk-home-list" }, hm.skills.map((s) => h("div", { class: "sk-home-row" },
        h("div", { class: "sk-home-t" }, h("b", {}, s.name), s.description ? h("span", { class: "faint" }, s.description) : null),
        h("button", { class: "btn sm", "data-home-import": `${hm.id}/${s.dir}`, disabled: SK.busy || null, onclick: () => go({ kind: "home", home: hm.id, name: s.dir }) }, T("Import", "匯入"))))) : null)), msg);
  } else {
    const url = h("input", { class: "input", placeholder: "https://github.com/owner/skills", "aria-label": T("Repository URL", "儲存庫網址"), "data-import-url": "1", value: SK.url, oninput: (e) => { SK.url = e.target.value; } });
    const sub = h("input", { class: "input", placeholder: T("folder inside it (optional)", "裡面的資料夾（可留空）"), "aria-label": T("Folder in the repository", "儲存庫內的資料夾"), "data-import-sub": "1", value: SK.sub, oninput: (e) => { SK.sub = e.target.value; } });
    body = h("div", { class: "sk-form" }, h("label", { class: "sk-field" }, h("span", {}, T("A public repository over https. No credentials: Studio clones it read-only, with no hooks.", "公開的 https 儲存庫。不帶任何憑證：Studio 唯讀複製，不執行任何 hook。")), url),
      h("label", { class: "sk-field" }, h("span", {}, T("Folder that holds the SKILL.md", "放 SKILL.md 的資料夾")), sub), msg,
      h("div", { class: "actions" }, h("button", { class: "btn primary", "data-import-go": "1", disabled: SK.busy || null, onclick: () => go({ kind: "git", url: url.value.trim(), path: sub.value.trim() || undefined }) }, icon("download", "ic sm"), T("Import", "匯入"))));
  }
  return h("section", { class: "card sk-import", "aria-label": T("Import a skill", "匯入技能") },
    h("div", { class: "sk-import-h" }, h("h2", {}, T("Import a skill", "匯入技能")), seg),
    h("p", { class: "faint sk-note" }, T("Studio copies the skill as an immutable version with its hash. Nothing in it runs, links that leave the folder are refused, and a skill never changes an agent's tools, sandbox, network or credentials.",
      "Studio 把技能複製成不可變的版本並記下雜湊。裡面的東西都不會執行；指向資料夾外的連結會被拒絕；技能也永遠不會改變 agent 的工具、沙箱、網路或憑證。")),
    body);
}

function skillRow(s) {
  const used = s.usedBy || [];
  return h("article", { class: "sk-row", "data-skill": s.id },
    h("div", { class: "sk-row-h" }, h("b", { class: "sk-name" }, s.name), h("span", { class: "vbadge", "data-skill-version": "1" }, `v${s.current}`),
      h("span", { class: `badge ${s.sourceKind === "builtin" ? "run" : ""}`, "data-skill-source": "1" }, kindLabel(s.sourceKind)),
      skillButton({ kind: "lib", id: s.id, v: null, pinned: null, name: s.name }, s.name, { class: "btn sm sk-read", verb: ["Read", "查看內容"] }, icon("eye", "ic sm"), T("Read", "查看內容"))),
    s.description ? h("p", { class: "sk-desc" }, s.description) : null,
    h("dl", { class: "sk-meta" },
      h("dt", {}, T("Fits", "適用")), h("dd", { "data-skill-fits": "1" }, fitText(s.fits)),
      h("dt", {}, T("Source", "來源")), h("dd", { class: "mono" }, s.source),
      h("dt", {}, "sha256"), h("dd", { class: "mono", title: s.sha256, "data-skill-sha": "1" }, short(s.sha256)),
      h("dt", {}, T("Size", "大小")), h("dd", { "data-skill-size": "1" }, `${sizeWords(s.bytes)}${s.files?.length ? T(` · ${count(s.files.length, "supporting file")}`, ` · ${s.files.length} 個附加檔`) : ""}`),
      h("dt", {}, T("Used by", "使用中")), h("dd", {}, used.length ? used.map((u) => h("a", { class: "vbadge sk-use", href: `#/workflows/${u.workflow}` }, `${u.workflow} · ${u.node} · v${u.v}`)) : h("span", { class: "faint" }, T("no node yet", "還沒有節點")))),
    s.ignored?.length ? h("p", { class: "sk-ignored", "data-skill-ignored": "1" }, icon("shield", "ic sm"), h("span", {}, ignoredText(s.ignored))) : null);
}
function roleRow(r) {
  return h("div", { class: "sk-role", "data-role-skill": r.id },
    h("div", { class: "sk-row-h" }, h("b", {}, r.name),
      h("span", { class: "sk-role-id" }, h("span", { class: "faint mono" }, r.id), r.current ? h("span", { class: "vbadge" }, `v${r.current}`) : h("span", { class: "faint sk-plain", "data-role-unversioned": "1" }, T("not versioned", "沒有版本"))),
      r.current ? skillButton({ kind: "role", workflow: r.workflow, role: r.role, v: null, pinned: null, name: r.name }, r.name, { class: "btn sm sk-read", verb: ["Read", "查看內容"] }, icon("eye", "ic sm"), T("Read", "查看內容")) : null),
    h("div", { class: "sk-role-m" }, h("span", { class: "mono" }, r.source), r.sha256 ? h("span", { class: "mono faint", title: r.sha256 }, short(r.sha256)) : h("span", { class: "faint" }, T("its source is not on this Mac", "這台 Mac 上沒有它的來源"))));
}
function viewSkills() {
  if (!SK.data) load();
  const head = h("div", { class: "phead" }, h("div", {}, h("h1", {}, T("Skills", "技能")),
    h("p", {}, T("Skills agents can use: a role's own skill, plus library skills any agent node can turn on. Each version is pinned by its hash.", "agent 可用的技能：每個角色自己的技能，加上任何 agent 節點都能開啟的技能庫。每個版本以雜湊固定。"))),
    h("div", { class: "actions" }, h("button", { class: "btn ghost", onclick: () => { SK.data = null; render(); } }, icon("refresh", "ic sm"), T("Refresh", "重新整理"))));
  if (!SK.data) return h("div", { class: "page sk-page" }, head, h("div", { class: "skel", style: "height:240px" }));
  const lib = SK.data.skills || [], roles = SK.data.roles || [];
  return h("div", { class: "page sk-page", "data-skills-page": "1" }, head, importCard(),
    h("section", {}, h("div", { class: "sec-head" }, h("h2", {}, T("Skill library", "技能庫")), h("span", { class: "faint" }, String(lib.length))),
      lib.length ? h("div", { class: "card sk-list" }, lib.map(skillRow)) : h("div", { class: "card" }, h("div", { class: "empty" }, icon("library"), h("b", {}, T("No skills yet", "還沒有技能")), T("Import one above.", "從上面匯入一個。")))),
    h("section", {}, h("div", { class: "sec-head" }, h("h2", {}, T("Role skills", "角色技能")), h("span", { class: "faint" }, String(roles.length))),
      h("p", { class: "faint sk-note" }, T("Each workflow role's own skill. It always comes first in the agent's instructions, before the skills a node turns on.", "每個流程角色自己的技能。它在 agent 指示裡永遠排在節點開啟的技能之前。")),
      h("div", { class: "card sk-list" }, roles.map(roleRow))));
}

// ---------- the skill viewer (read-only) ----------
// Every skill chip (the Crew page's rows and seat editor, a staffing card) and every Library row opens this dialog: the
// skill's name, the version shown (the one the seat pins first; a switcher when there are several), source, what it fits
// and where it is used, then its SKILL.md as markdown made of text nodes (the chat's md(): links only to Studio pages or
// the GitHub repository) or as the exact stored text (原文), and its supporting files, each opened inline as text.
// #/skills/<id>[@v] opens it over the Library; a role skill is #/skills/role:<workflow>/<role>[@v].
// ref: { kind: "lib", id } | { kind: "role", workflow, role }, with v (the version to show) and pinned (the one in use there).
const SKV = { ref: null, d: null, v: null, raw: false, files: {}, err: null, opener: null, back: null, route: null, seq: 0 };
const refKey = (r) => (r.kind === "role" ? `role:${r.workflow}/${r.role}` : r.id);
const refHash = (r, v) => `#/skills/${refKey(r).split("/").map(encodeURIComponent).join("/")}${v ? `@${v}` : ""}`;
const parseRef = (arg) => { const m = /^(?:role:([a-z0-9][a-z0-9-]{0,40})\/([a-z0-9][a-z0-9-]{0,40})|([a-z0-9][a-z0-9-]{0,40}))(?:@([1-9]\d{0,5}))?$/.exec(arg || ""); if (!m) return null;
  const v = m[4] ? Number(m[4]) : null; return m[3] ? { kind: "lib", id: m[3], v, pinned: v } : { kind: "role", workflow: m[1], role: m[2], v, pinned: v }; };
/** A role skill as the viewer shows it, from the Improve page's route (the same versioned text rounds receive). */
const roleView = (r, j) => ({ name: r.name || `${r.workflow} · ${r.role}`, version: j.n, latest: j.current, versions: (j.versions || []).map((x) => ({ n: x.n, sha256: x.sha256, createdAt: x.createdAt, by: x.by })),
  sha256: j.sha256, text: j.text, source: j.source || `${r.workflow}/${r.role}`, sourceKind: "role", frontmatter: null, ignored: [], files: [], usedBy: [], usedBySeats: [], fits: null });
async function skvLoad(v) {
  const r = SKV.ref, seq = ++SKV.seq; SKV.err = null; SKV.files = {}; SKV.loading = true; skvDraw();
  try {
    const res = await fetch(r.kind === "role" ? `/api/improve/skills/${r.workflow}/${r.role}${v ? `?v=${v}` : ""}` : `/api/skills/${encodeURIComponent(r.id)}${v ? `?version=${v}` : ""}`);
    const j = await res.json().catch(() => ({})); if (seq !== SKV.seq) return;
    if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
    SKV.d = r.kind === "role" ? roleView(r, j) : j; SKV.v = SKV.d.version;
  } catch (e) { if (seq === SKV.seq) { SKV.err = String(e.message || e); SKV.d = null; } }
  if (seq === SKV.seq) { SKV.loading = false; skvDraw(); }
}
const FM = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
/** SKILL.md as blocks: headings, lists, quotes, fences and paragraphs; inline text through md() (text nodes, whitelisted links). */
function skillMarkdown(text) {
  const out = []; let para = [], fence = null;
  const end = () => { if (para.length) { out.push(h("div", { class: "skv-p" }, md(para.join("\n")))); para = []; } };
  for (const line of String(text).replace(/\r\n?/g, "\n").split("\n")) {
    let m;
    if (fence) { if (/^\s*(```|~~~)/.test(line)) { out.push(h("pre", { class: "skv-pre" }, h("code", {}, fence.join("\n")))); fence = null; } else fence.push(line); continue; }
    if (/^\s*(```|~~~)/.test(line)) { end(); fence = []; }
    else if ((m = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line))) { end(); out.push(h("div", { class: `skv-h skv-h${Math.min(m[1].length, 4)}`, role: "heading", "aria-level": String(Math.min(m[1].length + 2, 6)) }, md(m[2]))); }
    else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { end(); out.push(h("hr", { class: "skv-hr" })); }
    else if ((m = /^\s*>\s?(.*)$/.exec(line))) { end(); out.push(h("blockquote", { class: "skv-q" }, md(m[1]))); }
    else if ((m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line))) { end(); out.push(h("div", { class: "skv-li", style: `padding-left:${14 + Math.min(m[1].length, 8) * 6}px` }, h("span", { class: "skv-bullet", "aria-hidden": "true" }, /\d/.test(m[2]) ? m[2] : "•"), h("span", {}, md(m[3])))); }
    else if (!line.trim()) end();
    else para.push(line);
  }
  if (fence) out.push(h("pre", { class: "skv-pre" }, h("code", {}, fence.join("\n"))));
  end(); return out;
}
const fmValue = (v) => (v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
// a seat by its member's display name (Maker / 產出), as the Crew page names it
const useText = (u) => { if (u.workflow && u.node) return `${u.workflow} · ${u.node}`; const seat = u.label ? T(u.label.en, u.label.zh) : u.seat; return u.project ? `${u.project} · ${seat}` : seat; };
function skvFiles(d) {
  if (!d.files?.length) return null;
  return h("section", { class: "skv-files", "data-skv-files": "" }, h("h3", {}, T("Supporting files", "附加檔案")),
    h("ul", {}, d.files.map((f) => { const st = SKV.files[f.path];
      return h("li", { "data-skv-file-row": f.path },
        h("button", { type: "button", class: "skv-file", "data-skv-file": f.path, "aria-expanded": String(!!st), disabled: !f.viewable || null,
          onclick: () => skvFile(f.path) }, icon("doc", "ic sm"), h("span", { class: "mono" }, f.path), h("span", { class: "faint" }, size(f.bytes))),
        !f.viewable ? h("span", { class: "faint skv-file-why" }, f.bytes > (d.fileCap || Infinity) ? T("too large to show here", "太大，這裡不顯示") : T("not a text file", "不是文字檔")) : null,
        st ? st.error ? h("p", { class: "bad", role: "alert", "data-skv-file-error": f.path }, st.error) : st.text == null ? h("p", { class: "faint" }, T("Loading…", "載入中…"))
          : h("pre", { class: "skv-pre skv-raw", "data-skv-file-text": f.path, tabindex: "0", "aria-label": f.path }, st.text) : null); })));
}
async function skvFile(path) {
  if (SKV.files[path]) { delete SKV.files[path]; return skvDraw(); }
  SKV.files[path] = { text: null }; skvDraw(); const r = SKV.ref;
  try { const res = await fetch(`/api/skills/${encodeURIComponent(r.id)}/files/${path.split("/").map(encodeURIComponent).join("/")}?version=${SKV.v}`); const j = await res.json().catch(() => ({}));
    if (!SKV.files[path]) return; SKV.files[path] = res.ok && !j.error ? { text: j.text } : { error: j.error || `HTTP ${res.status}` }; }
  catch (e) { if (SKV.files[path]) SKV.files[path] = { error: String(e.message || e) }; }
  skvDraw();
}
function skvBody() {
  const d = SKV.d, r = SKV.ref;
  if (SKV.err) return [h("p", { class: "bad", role: "alert", "data-skv-error": "" }, SKV.err)];
  if (!d) return [h("p", { class: "faint", role: "status" }, T("Loading…", "載入中…"))];
  const pinned = r.pinned, older = pinned != null && pinned < d.latest;
  const ver = d.versions?.length > 1 ? h("select", { class: "select skv-ver", "aria-label": T("Version", "版本"), "data-skv-version": "", onchange: (e) => skvLoad(Number(e.target.value)) },
    [...d.versions].reverse().map((x) => h("option", { value: String(x.n) }, `v${x.n}${x.n === d.latest ? T(" · latest", " · 最新") : ""}${x.n === pinned ? T(" · used here", " · 這裡用的") : ""}`)))
    : h("span", { class: "vbadge", "data-skv-version": "" }, `v${d.version}`);
  if (ver.tagName === "SELECT") ver.value = String(d.version);
  const used = [...(d.usedBy || []), ...(d.usedBySeats || [])];
  const body = d.text.replace(FM, "");
  return [
    h("dl", { class: "sk-meta skv-meta" },
      h("dt", {}, T("Version", "版本")), h("dd", {}, ver, ver.tagName !== "SELECT" && d.version === pinned ? h("span", { class: "faint" }, T("used here", "這裡用的")) : null, ver.tagName !== "SELECT" && d.version === d.latest ? h("span", { class: "faint" }, T("latest", "最新")) : null),
      h("dt", {}, T("Source", "來源")), h("dd", {}, h("span", { class: `badge ${d.sourceKind === "builtin" ? "run" : ""}`, "data-skv-source": d.sourceKind }, d.sourceKind === "role" || d.sourceKind === "builtin" ? kindLabel(d.sourceKind) : T(`Imported · ${kindLabel(d.sourceKind)}`, `匯入 · ${kindLabel(d.sourceKind)}`)), h("span", { class: "mono" }, d.source)),
      r.kind === "lib" ? [h("dt", {}, T("Fits", "適用")), h("dd", { "data-skv-fits": "" }, fitText(d.fits))] : null,
      h("dt", {}, "sha256"), h("dd", { class: "mono", title: d.sha256 || "", "data-skv-sha": d.sha256 || "" }, short(d.sha256)),
      // a script skill: its scripts, the hosts approving it allows, and whether it is approved and ready here (src/skillpkg)
      r.kind === "lib" && d.scripts ? [h("dt", {}, T("Scripts", "Script")), h("dd", { "data-skv-scripts": d.scripts.state, title: (d.scripts.reasons || []).map((x) => T(x.en, x.zh)).join("\n") }, T(d.scripts.en, d.scripts.zh))] : null,
      r.kind === "lib" ? [h("dt", {}, T("Used by", "使用中")), h("dd", { "data-skv-used": String(used.length) }, used.length ? used.map((u) => h("span", { class: "vbadge" }, `${useText(u)} · v${u.v}`)) : h("span", { class: "faint" }, T("no node or seat yet", "還沒有節點或位置")))] : null),
    older ? h("p", { class: "skv-pinned", role: "note", "data-skv-pinned": String(pinned) },
      d.version === pinned ? T(`This seat uses v${pinned}, an older version. The latest is v${d.latest}.`, `這個位置用的是 v${pinned}（舊版）。最新是 v${d.latest}。`) : T(`Showing v${d.version}. This seat uses v${pinned}.`, `正在看 v${d.version}。這個位置用的是 v${pinned}。`),
      d.version === pinned ? h("button", { type: "button", class: "btn sm", "data-skv-latest": "", onclick: () => skvLoad(d.latest) }, T(`View the latest (v${d.latest})`, `看最新版（v${d.latest}）`))
        : h("button", { type: "button", class: "btn sm", "data-skv-back": "", onclick: () => skvLoad(pinned) }, T(`Back to v${pinned} (used here)`, `回到 v${pinned}（這裡用的）`))) : null,
    d.ignored?.length ? h("p", { class: "sk-ignored" }, icon("shield", "ic sm"), h("span", {}, ignoredText(d.ignored))) : null,
    h("div", { class: "skv-bar" }, h("b", {}, "SKILL.md"), h("span", { class: "faint" }, sizeWords(new TextEncoder().encode(d.text).length)),
      h("button", { type: "button", class: "btn sm", "aria-pressed": String(SKV.raw), "data-skv-raw": "", onclick: () => { SKV.raw = !SKV.raw; skvDraw(); } }, T("Raw text", "原文"))),
    SKV.raw ? h("pre", { class: "skv-pre skv-raw", "data-skv-raw-text": "", tabindex: "0", "aria-label": T("SKILL.md, exact text", "SKILL.md 原文") }, d.text)
      : h("div", { class: "skv-doc", "data-skv-rendered": "" },
        d.frontmatter && Object.keys(d.frontmatter).length ? h("dl", { class: "sk-meta skv-fm", "data-skv-frontmatter": "" }, Object.entries(d.frontmatter).flatMap(([k, v]) => [h("dt", { class: "mono" }, k), h("dd", {}, fmValue(v))])) : null,
        skillMarkdown(body)),
    skvFiles(d)];
}
const FOCUSABLE = 'button:not([disabled]), select:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';
function skvDraw() {
  const dlg = SKV.back?.querySelector("[data-skill-viewer]"); if (!dlg) return;
  // the control that had the focus keeps it across the redraw (the version switcher, 原文, a file)
  const a = document.activeElement, key = a && dlg.contains(a) ? [...a.attributes].find((x) => x.name.startsWith("data-skv")) : null;
  const name = SKV.d?.name || SKV.ref.name || refKey(SKV.ref);
  dlg.setAttribute("data-skill-viewer", refKey(SKV.ref)); dlg.setAttribute("data-skv-shown", SKV.d ? String(SKV.d.version) : "");
  // replaceChildren would write a null as the text "null": only the parts that exist
  dlg.replaceChildren(...[
    h("div", { class: "skv-head" }, h("div", { class: "skv-title" }, h("span", { class: "tm-rk" }, SKV.ref.kind === "role" ? T("Role skill", "角色技能") : T("Skill", "技能")), h("h2", { id: "skvTitle" }, name)),
      h("button", { type: "button", class: "btn ghost skv-x", "aria-label": T("Close", "關閉"), "data-skv-close": "", onclick: () => skvClose() }, icon("x", "ic sm"))),
    SKV.d?.description ? h("p", { class: "sk-desc" }, SKV.d.description) : null,
    ...skvBody()].filter(Boolean));
  hydrateIcons(dlg);
  if (key) (dlg.querySelector(`[${key.name}="${CSS.escape(key.value)}"]`) || dlg.querySelector("[data-skv-close]"))?.focus();
}
/** Where the focus goes back: the chip that opened the dialog, or, after the page drew it anew, the same chip in the same row. */
function openerKey(el) {
  if (!el?.closest) return null;
  const scope = el.closest("[data-team-row],[data-seat-editor],[data-skill],[data-role-skill-row],[data-staffing-role],[data-staffing-node]");
  const sa = scope && [...scope.attributes].find((x) => ["data-team-row", "data-seat-editor", "data-skill", "data-role-skill-row", "data-staffing-role", "data-staffing-node"].includes(x.name));
  return { el, sel: `${sa ? `[${sa.name}="${CSS.escape(sa.value)}"] ` : ""}[data-skill-view="${CSS.escape(el.getAttribute("data-skill-view") || "")}"]` };
}
function skvOpen(ref, opener) {
  if (SKV.back?.isConnected) skvClose(false);
  Object.assign(SKV, { route: null, ref: { ...ref }, d: null, raw: false, files: {}, err: null, opener: openerKey(opener) });
  const root = document.getElementById("modalRoot");
  const dlg = h("div", { class: "modal wide skv", role: "dialog", "aria-modal": "true", "aria-labelledby": "skvTitle", "data-skill-viewer": refKey(ref) });
  // a link in the skill's text (a Studio page) leaves the dialog for that page
  // data-no-unsent: the viewer only reads; its version switcher is never unsent input that would hold a release reload
  const back = h("div", { class: "modal-back", "data-skv-back-drop": "", "data-no-unsent": "", onclick: (e) => { if (e.target === back) skvClose(); else if (e.target.closest?.("a[href^='#/']")) skvClose(false); } }, dlg);
  back.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); return skvClose(); }
    if (e.key !== "Tab") return;
    // the focus stays in the dialog: Tab from the last control goes to the first, Shift+Tab from the first to the last
    const f = [...dlg.querySelectorAll(FOCUSABLE)].filter((x) => x.getClientRects().length); if (!f.length) return;
    if (e.shiftKey && (document.activeElement === f[0] || !dlg.contains(document.activeElement))) { e.preventDefault(); f.at(-1).focus(); }
    else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
  });
  SKV.back = back; root.replaceChildren(back); skvDraw(); dlg.querySelector("[data-skv-close]")?.focus();
  skvLoad(ref.v);
}
function skvClose(restore = true) {
  const back = SKV.back; if (!back) return; SKV.back = null; SKV.seq++; back.remove();
  // however it closes, a deep link that opened it is done: Back to the same #/skills link opens it again
  const fromRoute = SKV.route; SKV.route = null;
  if (!restore) return;
  const o = SKV.opener;
  if (fromRoute && /^#\/skills\//.test(location.hash)) { location.hash = "#/skills"; requestAnimationFrame(() => document.querySelector(`[data-skill-view="${CSS.escape(refKey(SKV.ref))}"]`)?.focus()); return; }
  const el = o?.el?.isConnected ? o.el : o?.sel ? document.querySelector(o.sel) : null; el?.focus();
}
/** A skill chip as a button that opens the viewer (the chip's own look stays its class). Clicking it changes nothing on the page. */
// verb: [en, zh] when the button shows a word of its own (Read / 查看內容): its accessible name starts with that word (WCAG 2.5.3)
function skillButton(ref, label, { verb = null, ...attrs } = {}, ...kids) {
  return h("button", { type: "button", ...attrs, class: `skv-open ${attrs.class || ""}`.trim(), "data-skill-view": refKey(ref), "data-skill-pinned": ref.pinned ?? null,
    "aria-label": verb ? T(`${verb[0]}: ${label}`, `${verb[1]}：${label}`) : T(`View skill: ${label}`, `查看技能：${label}`), "aria-haspopup": "dialog", onclick: (e) => { e.stopPropagation(); skvOpen(ref, e.currentTarget); } }, ...kids);
}
window.crewSkillView = { open: skvOpen, button: skillButton, close: skvClose, hash: refHash };
// a hash that leaves the viewer's deep link (Back) closes it; the Crew page never changes the hash, so its dialog stays
addEventListener("hashchange", () => { if (SKV.back && SKV.route && !/^#\/skills\//.test(location.hash)) { SKV.route = null; skvClose(false); } });
routes.skills = (arg) => {
  const ref = parseRef(arg);
  if (ref && SKV.route !== arg) { SKV.route = arg; requestAnimationFrame(() => { skvOpen(ref, null); SKV.route = arg; }); }
  return viewSkills();
};

const base = routes.library;
routes.library = (arg) => {
  if (arg === "skills") return viewSkills();
  const page = base(arg);
  // Skills now has its own primary navigation entry; legacy deep links still resolve.
  return page;
};
addEventListener("hashchange", () => { if ((S.route?.name === "skills" || (S.route?.name === "library" && S.route.arg === "skills")) && SK.data && Date.now() - (SK.t || 0) > 30_000) { SK.t = Date.now(); load(); } });
})();
