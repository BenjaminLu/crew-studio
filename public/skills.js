// Library → Skills (unit agent-skills): the skill library and the role skills, and the
// import form (a local folder, a skills home, a public https git URL). Routes:
// #/library (Artifacts, the existing page, with the tabs above it) and #/library/skills.
// The page shows a skill's name, description, source, version and hash, never its text:
// skill text goes only into a run's provider prompt.
(() => {
const SK = { data: null, homes: null, kind: "folder", msg: null, busy: false, path: "", url: "", sub: "" };
window.crewSkills = SK; // the workflow editor reads the same library
const getJ = (u) => fetch(u).then((r) => r.json());
async function load() {
  try { const [d, hm] = await Promise.all([getJ("/api/skills"), getJ("/api/skills/homes")]); SK.data = d; SK.homes = hm.homes || []; } catch { SK.data = { skills: [], roles: [] }; SK.homes = []; }
  if (S.route?.name === "library" && S.route.arg === "skills") soft();
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

function tabs(cur) {
  return h("div", { class: "seg sk-tabs", role: "group", "aria-label": T("Library section", "成品庫分區") },
    [["artifacts", "Artifacts", "成品", "#/library"], ["skills", "Skills", "技能", "#/library/skills"]].map(([k, en, tw, href]) =>
      h("button", { type: "button", "aria-pressed": String(cur === k), "data-lib-tab": k, onclick: () => { location.hash = href; } }, h("span", { class: "keep" }, T(en, tw)))));
}

async function doImport(body) {
  SK.busy = true; SK.msg = { state: "busy", text: T("Importing…", "匯入中…") }; soft();
  const r = await postJ("/api/skills/import", body);
  SK.busy = false;
  if (r.error) SK.msg = { state: "error", text: r.error };
  else SK.msg = { state: "ok", text: r.created ? T(`${r.skill.id} v${r.version.n} imported`, `已匯入 ${r.skill.id} v${r.version.n}`) : T(`${r.skill.id} is unchanged: still v${r.version.n}`, `${r.skill.id} 沒有變更：仍是 v${r.version.n}`) };
  await load(); soft();
}

function importCard() {
  // the result (a refusal and its reason) sits right under the field it is about
  const msg = h("div", { class: `sk-msg ${SK.msg?.state || ""}`, role: "status", "aria-live": "polite", "data-import-msg": "1", "data-state": SK.msg?.state || "" }, SK.msg?.text || "");
  const seg = h("div", { class: "seg", role: "group", "aria-label": T("Import from", "匯入來源") },
    [["folder", "Folder", "資料夾"], ["home", "Skills home", "技能目錄"], ["git", "Git URL", "Git 網址"]].map(([k, en, tw]) =>
      h("button", { type: "button", "aria-pressed": String(SK.kind === k), "data-import-kind": k, onclick: () => { SK.kind = k; SK.msg = null; render(); } }, h("span", { class: "keep" }, T(en, tw)))));
  let body;
  if (SK.kind === "folder") {
    const path = h("input", { class: "input", placeholder: "/Users/you/skills/plain-writing", "aria-label": T("Folder path", "資料夾路徑"), "data-import-path": "1", value: SK.path, oninput: (e) => { SK.path = e.target.value; } });
    body = h("div", { class: "sk-form" }, h("label", { class: "sk-field" }, h("span", {}, T("A folder that holds a SKILL.md (absolute path)", "放著 SKILL.md 的資料夾（絕對路徑）")), path), msg,
      h("div", { class: "actions" }, h("button", { class: "btn primary", "data-import-go": "1", disabled: SK.busy || null, onclick: () => doImport({ kind: "folder", path: path.value.trim() }) }, icon("download", "ic sm"), T("Import", "匯入"))));
  } else if (SK.kind === "home") {
    body = h("div", { class: "sk-homes" }, (SK.homes || []).map((hm) => h("div", { class: "sk-home", "data-home": hm.id },
      h("div", { class: "sk-home-h" }, h("b", { class: "mono" }, hm.label), h("span", { class: "faint" }, hm.exists ? T(count(hm.skills.length, "skill"), `${hm.skills.length} 個技能`) : T("not on this Mac", "這台 Mac 上沒有"))),
      hm.skills.length ? h("div", { class: "sk-home-list" }, hm.skills.map((s) => h("div", { class: "sk-home-row" },
        h("div", { class: "sk-home-t" }, h("b", {}, s.name), s.description ? h("span", { class: "faint" }, s.description) : null),
        h("button", { class: "btn sm", "data-home-import": `${hm.id}/${s.dir}`, disabled: SK.busy || null, onclick: () => doImport({ kind: "home", home: hm.id, name: s.dir }) }, T("Import", "匯入"))))) : null)), msg);
  } else {
    const url = h("input", { class: "input", placeholder: "https://github.com/owner/skills", "aria-label": T("Repository URL", "儲存庫網址"), "data-import-url": "1", value: SK.url, oninput: (e) => { SK.url = e.target.value; } });
    const sub = h("input", { class: "input", placeholder: T("folder inside it (optional)", "裡面的資料夾（可留空）"), "aria-label": T("Folder in the repository", "儲存庫內的資料夾"), "data-import-sub": "1", value: SK.sub, oninput: (e) => { SK.sub = e.target.value; } });
    body = h("div", { class: "sk-form" }, h("label", { class: "sk-field" }, h("span", {}, T("A public repository over https. No credentials: Studio clones it read-only, with no hooks.", "公開的 https 儲存庫。不帶任何憑證：Studio 唯讀複製，不執行任何 hook。")), url),
      h("label", { class: "sk-field" }, h("span", {}, T("Folder that holds the SKILL.md", "放 SKILL.md 的資料夾")), sub), msg,
      h("div", { class: "actions" }, h("button", { class: "btn primary", "data-import-go": "1", disabled: SK.busy || null, onclick: () => doImport({ kind: "git", url: url.value.trim(), path: sub.value.trim() || undefined }) }, icon("download", "ic sm"), T("Import", "匯入"))));
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
      h("span", { class: `badge ${s.sourceKind === "builtin" ? "run" : ""}`, "data-skill-source": "1" }, kindLabel(s.sourceKind))),
    s.description ? h("p", { class: "sk-desc" }, s.description) : null,
    h("dl", { class: "sk-meta" },
      h("dt", {}, T("Source", "來源")), h("dd", { class: "mono" }, s.source),
      h("dt", {}, "sha256"), h("dd", { class: "mono", title: s.sha256, "data-skill-sha": "1" }, short(s.sha256)),
      h("dt", {}, T("Size", "大小")), h("dd", { "data-skill-size": "1" }, `${sizeWords(s.bytes)}${s.files?.length ? T(` · ${count(s.files.length, "supporting file")}`, ` · ${s.files.length} 個附加檔`) : ""}`),
      h("dt", {}, T("Used by", "使用中")), h("dd", {}, used.length ? used.map((u) => h("a", { class: "vbadge sk-use", href: `#/workflows/${u.workflow}` }, `${u.workflow} · ${u.node} · v${u.v}`)) : h("span", { class: "faint" }, T("no node yet", "還沒有節點")))),
    s.ignored?.length ? h("p", { class: "sk-ignored", "data-skill-ignored": "1" }, icon("shield", "ic sm"), h("span", {}, ignoredText(s.ignored))) : null);
}
function roleRow(r) {
  return h("div", { class: "sk-role", "data-role-skill": r.id },
    h("div", { class: "sk-row-h" }, h("b", {}, r.name),
      h("span", { class: "sk-role-id" }, h("span", { class: "faint mono" }, r.id), r.current ? h("span", { class: "vbadge" }, `v${r.current}`) : h("span", { class: "faint sk-plain", "data-role-unversioned": "1" }, T("not versioned", "沒有版本")))),
    h("div", { class: "sk-role-m" }, h("span", { class: "mono" }, r.source), r.sha256 ? h("span", { class: "mono faint", title: r.sha256 }, short(r.sha256)) : h("span", { class: "faint" }, T("its source is not on this Mac", "這台 Mac 上沒有它的來源"))));
}
function viewSkills() {
  if (!SK.data) load();
  const head = h("div", { class: "phead" }, h("div", {}, h("h1", {}, T("Library", "成品庫")),
    h("p", {}, T("Skills agents can use: a role's own skill, plus library skills any agent node can turn on. Each version is pinned by its hash.", "agent 可用的技能：每個角色自己的技能，加上任何 agent 節點都能開啟的技能庫。每個版本以雜湊固定。"))),
    h("div", { class: "actions" }, h("button", { class: "btn ghost", onclick: () => { SK.data = null; render(); } }, icon("refresh", "ic sm"), T("Refresh", "重新整理"))));
  if (!SK.data) return h("div", { class: "page sk-page" }, head, tabs("skills"), h("div", { class: "skel", style: "height:240px" }));
  const lib = SK.data.skills || [], roles = SK.data.roles || [];
  return h("div", { class: "page sk-page", "data-skills-page": "1" }, head, tabs("skills"), importCard(),
    h("section", {}, h("div", { class: "sec-head" }, h("h2", {}, T("Skill library", "技能庫")), h("span", { class: "faint" }, String(lib.length))),
      lib.length ? h("div", { class: "card sk-list" }, lib.map(skillRow)) : h("div", { class: "card" }, h("div", { class: "empty" }, icon("library"), h("b", {}, T("No skills yet", "還沒有技能")), T("Import one above.", "從上面匯入一個。")))),
    h("section", {}, h("div", { class: "sec-head" }, h("h2", {}, T("Role skills", "角色技能")), h("span", { class: "faint" }, String(roles.length))),
      h("p", { class: "faint sk-note" }, T("Each workflow role's own skill. It always comes first in the agent's instructions, before the skills a node turns on.", "每個流程角色自己的技能。它在 agent 指示裡永遠排在節點開啟的技能之前。")),
      h("div", { class: "card sk-list" }, roles.map(roleRow))));
}

const base = routes.library;
routes.library = (arg) => {
  if (arg === "skills") return viewSkills();
  const page = base(arg);
  const el = Array.isArray(page) ? page[0] : page;
  const ph = el?.querySelector?.(":scope > .phead");
  if (ph) ph.after(tabs("artifacts"));
  return page;
};
addEventListener("hashchange", () => { if (S.route?.name === "library" && S.route.arg === "skills" && SK.data && Date.now() - (SK.t || 0) > 30_000) { SK.t = Date.now(); load(); } });
})();
