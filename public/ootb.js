// Out of the box: the Doctor page (what works, what is degraded, one-click
// official installs and vendor logins), GitHub without the gh CLI (paste a
// token), API keys for the status chat without any CLI, and built-in LAN phone
// mode. Loaded after app.js, m2.js and m25.js.
(() => {
const DOC = { data: null, job: null, poll: null,claude:null };
const STATUS = { ok: ["ok", "Works", "可用"], degraded: ["warn", "Degraded", "受限"], missing: ["bad", "Missing", "缺少"], info: ["", "Optional", "選用"] };
async function loadDoctor() { try { const [doctor,claude]=await Promise.all([getJ("/api/doctor"),getJ("/api/claude/native/status").catch(()=>null)]);DOC.data=doctor;DOC.claude=claude?.provider==='claude'?claude:null; } catch { DOC.data = null; } if (S.route?.name === "doctor") render(); updateDocBadge(); }
function updateDocBadge() {
  const b = $("#navDoctor"); if (!b || !DOC.data) return;
  const n = DOC.data.items.filter((i) => i.status === "missing" && i.id === "state" || i.status === "degraded" && ["chat", "board"].includes(i.id)).length;
  b.textContent = n || ""; b.hidden = !n;
}

function actionButton(it) {
  const a = it.action || {};
  if((it.id==='claude'||a.item==='claude')&&DOC.claude?.quota==='exhausted')return h('span',{'data-claude-wait-reset':true},T('Wait for quota reset; signing in again will not restore quota.','請等待額度重設；重新登入不會恢復額度。'));
  if (a.kind === "install") return h("button", { class: "btn primary", "data-install": a.item, onclick: () => openInstall(a.item) }, icon("download", "ic sm"), T("Install…", "安裝…"));
  if (a.kind === "login") return h("button", { class: "btn", "data-login": a.item, onclick: () => startLogin(a.item) }, icon("link", "ic sm"), T("Log in…", "登入…"));
  if (a.kind === "github") return h("button", { class: "btn", "data-gh": "connect", onclick: openGithub }, icon("pr", "ic sm"), S.github?.connected ? T("Change token…", "更換 token…") : T("Connect GitHub…", "連接 GitHub…"));
  if (a.kind === "keys") return h("button", { class: "btn", "data-keys": "open", onclick: openKeys }, icon("tool", "ic sm"), T("API keys…", "API 金鑰…"));
  if (a.kind === "phone") return h("a", { class: "btn", href: "#/remote" }, icon("monitor", "ic sm"), T("Phone page", "手機頁"));
  return null;
}

// The notice the Doctor and the Board show while the operator's .env sets CREW_LOCAL_UNRESTRICTED=1 (src/local-execution.ts):
// every agent round, check and test then runs as the captain with no OS sandbox and no egress proxy
function unrestrictedNotice() {
  return h("div", { class: "rich", role: "alert", "data-execution": "local-unrestricted", style: "border-color:var(--warn);background:var(--warn-soft)" },
    h("div", { class: "rt" }, icon("alert", "ic sm"), " ", T("Sandbox off: local unrestricted mode", "沙箱已關閉：本機無限制模式")),
    h("div", {}, T("CREW_LOCAL_UNRESTRICTED=1 is set for this Studio. Agent rounds, checks and tests run as you, with no OS sandbox and no egress proxy; captain approvals, task scope and the signed ledger still hold.",
      "這個 Studio 設定了 CREW_LOCAL_UNRESTRICTED=1。代理回合、檢查與測試都以你的身分執行，沒有 OS 沙箱，也沒有對外網路代理；船長核准、任務範圍與簽章帳本照樣有效。")),
    h("div", { class: "rk" }, T("Unset it in the operator .env and restart Studio to turn the sandbox back on.", "在 operator .env 移除這個設定並重新啟動 Studio，沙箱就會回來。")));
}
window.crewUnrestrictedNotice = unrestrictedNotice;

function viewDoctor() {
  if (!DOC.data) { loadDoctor(); return h("div", { class: "page" }, h("div", { class: "skel", style: "height:240px" })); }
  const items = DOC.data.items;
  const bad = items.filter((i) => i.status === "missing" || i.status === "degraded").length;
  return h("div", { class: "page", "data-page": "doctor" },
    h("div", { class: "phead" }, h("div", {}, h("h1", {}, T("Doctor", "健康檢查")),
      h("p", {}, T("Basic Studio web pages use only Studio’s own data. Coding, checks and optional integrations list their additional requirements below.",
        "Studio 基本網頁只使用自己的資料。程式碼、檢查與選用整合的額外需求列在下方。"))),
      h("div", { class: "actions" }, h("button", { class: "btn", id: "docRecheck", onclick: () => { DOC.data = null; render(); loadDoctor(); } }, icon("refresh", "ic sm"), T("Check again", "重新檢查")))),
    DOC.data.execution === "local-unrestricted" ? unrestrictedNotice() : null,
    DOC.data.installer === "mock" ? h("div", { class: "rich", "data-installer": "mock" }, h("div", { class: "rk" }, icon("alert", "ic sm"), T("Test mode: installs are recorded, never run.", "測試模式：只記錄安裝，不會真的執行。"))) : null,
    DOC.job ? jobBox(DOC.job) : null,
    window.crewCodexAccountPanel?.(),
    window.crewClaudeAccountPanel?.(),
    h("div", { class: "faint", style: "font-size:13px" }, bad ? T(`${bad} item(s) need attention.`, `${bad} 項需要處理。`) : T("Listed dependencies are detected. Logins and actual tool execution need separate verification.", "已偵測到列出的依賴；登入與實際工具執行仍需分別驗證。")),
    ["basic","coding","optional"].map(group=>h("section", { "data-doc-group":group },
      h("h2", {}, group==="basic"?T("Basic web readiness","基本網頁功能"):group==="coding"?T("Coding and checks","程式碼與檢查"):T("Optional integrations","選用整合")),
      h("div", { class: "card", style: "padding:0" }, items.filter(it=>(it.group||"coding")===group).map((it) => {
      const cliStatus = { available: ["ok", "Available", "可用"], missing: ["bad", "Not installed", "未安裝"], unusable: ["warn", "Cannot run", "無法執行"] };
      const executableStatus = it.availability === "available" && it.authenticated === true ? ["ok", "Logged in", "已登入"] : it.availability === "available" && it.authenticated === false ? ["warn", "Not signed in", "尚未登入"] : cliStatus[it.availability];
      const detectedStatus = ["codex", "claude"].includes(it.id) && it.status === "ok" ? ["", "Detected", "已偵測"] : null;
      const [cls, en, zh] = executableStatus || detectedStatus || STATUS[it.status] || STATUS.info;
      return h("div", { class: "doc-row", "data-item": it.id, "data-status": it.status },
        h("div", { class: "doc-main" },
          h("div", { class: "doc-t" }, h("b", {}, T(it.title,it.titleZh||it.title)), h("span", { class: `badge ${cls}` }, T(en, zh))),
          h("div", { class: "doc-d mono" }, T(it.detail, it.detailZh || it.detail)),
          h("div", { class: "doc-a" }, T(it.adds,it.addsZh||it.adds)),
          it.fix ? h("div", { class: "doc-f" }, icon("arrow", "ic sm"), T(it.fix,it.fixZh||it.fix)) : null),
        h("div", { class: "doc-act" }, actionButton(it)));
    })))));
}

function jobBox(j) {
  const running = j.state === "running";
  const cls = j.state === "done" ? "ok" : j.state === "running" ? "run" : "bad";
  const label = { running: T("Running", "執行中"), done: T("Finished", "完成"), failed: T(`Failed (exit ${j.code})`, `失敗（exit ${j.code}）`), cancelled: T("Cancelled", "已取消") }[j.state];
  const log = h("pre", { class: "joblog", id: "installLog" }, (j.lines || []).join("\n"));
  setTimeout(() => { log.scrollTop = log.scrollHeight; });
  return h("div", { class: "rich", "data-job": j.state, id: "installJob" },
    h("div", { class: "rk" }, icon("download", "ic sm"), `${j.item} · ${j.method}`, h("span", { class: `badge ${cls}` }, label)),
    h("div", { class: "mono faint", style: "font-size:12px;word-break:break-all" }, (j.argv || []).join(" ")),
    log,
    h("div", { class: "actions" },
      running ? h("button", { class: "btn", id: "installCancel", onclick: () => postJ("/api/doctor/cancel", { id: j.id }).then((r) => r.error && toast(r.error)) }, icon("stop", "ic sm"), T("Cancel", "取消"))
        : h("button", { class: "btn ghost", onclick: () => { DOC.job = null; render(); } }, T("Close", "關閉"))));
}
function followJob(id) {
  clearInterval(DOC.poll);
  DOC.poll = setInterval(async () => {
    const j = await getJ(`/api/doctor/job/${id}`).catch(() => null);
    if (!j || j.error) return;
    DOC.job = j;
    if (S.route?.name === "doctor") { const box = $("#installJob"); if (box) box.replaceWith(jobBox(j)); else render(); }
    if (j.state !== "running") { clearInterval(DOC.poll); toast(j.state === "done" ? T("Done — checking again", "完成，重新檢查") : j.state === "cancelled" ? T("Cancelled", "已取消") : T("The installer failed; see the log", "安裝失敗，請看紀錄")); loadDoctor(); }
  }, 400);
}

async function openInstall(item) {
  const r = await getJ(`/api/doctor/methods?item=${encodeURIComponent(item)}`).catch(() => null);
  if (!r?.methods?.length) return toast(T("No official installer for this system yet", "這個系統還沒有官方安裝方式"));
  let pick = r.methods[0];
  const detail = h("div", { id: "installDetail", style: "display:grid;gap:8px" });
  const show = () => detail.replaceChildren(
    h("div", { class: "kv" }, h("span", { class: "faint" }, T("Command", "指令")), h("code", { "data-cmd": "1", style: "word-break:break-all" }, pick.kind === "open" ? T(`open ${pick.url} in your browser`, `在瀏覽器打開 ${pick.url}`) : pick.argv.join(" "))),
    h("div", { class: "kv" }, h("span", { class: "faint" }, T("Source", "來源")), h("span", { style: "word-break:break-all" }, pick.source)),
    h("div", { class: "kv" }, h("span", { class: "faint" }, T("Installs to", "安裝到")), h("span", {}, pick.location)),
    pick.admin ? h("div", { class: "faint", style: "font-size:12px" }, T("This may ask for your Mac password in a system dialog. Studio never asks for it.", "可能會跳出系統視窗要你的 Mac 密碼；Studio 不會向你要密碼。")) : null,
    !pick.usable && pick.kind !== "open" ? h("div", { class: "chat-err", style: "font-size:13px" }, T(`Needs ${pick.needs.join(", ")} on this Mac.`, `這台 Mac 需要先有 ${pick.needs.join("、")}。`)) : null);
  const sel = h("select", { class: "select", id: "installMethod" }, r.methods.map((m) => h("option", { value: m.id }, `${m.label}${m.usable || m.kind === "open" ? "" : T(" (not available)", "（無法使用）")}`)));
  sel.addEventListener("change", () => { pick = r.methods.find((m) => m.id === sel.value); show(); });
  show();
  modal(T(`Install ${item}`, `安裝 ${item}`), h("div", { style: "display:grid;gap:10px" },
    h("p", { class: "muted", style: "margin:0" }, T("Official installer only. It runs as you, in its own process, with the log shown here. Nothing runs until you press Install.",
      "只用官方安裝程式，以你的身分在獨立程序執行，紀錄會顯示在這裡。按下安裝前什麼都不會執行。")),
    h("label", { style: "display:grid;gap:4px;font-size:13px" }, T("Method", "方式"), sel), detail),
    async (close, btn) => {
      if (pick.kind === "open") { window.open(pick.url, "_blank", "noopener"); close(); toast(T("Opened the official download page; press Check again when done.", "已打開官方下載頁；裝好後按「重新檢查」。")); return; }
      btn.disabled = true;
      const res = await postJ("/api/doctor/install", { item, method: pick.id, confirm: true });
      close();
      if (res.error) return toast(res.error);
      DOC.job = res; render(); followJob(res.id);
    });
  $(".modal .btn.primary").textContent = T("Install", "安裝");
}
async function startLogin(item) {
  if(item==="codex")return window.crewConnectCodex?.();
  if(item==="claude")return window.crewConnectClaude?.();
  const res = await postJ("/api/doctor/login", { item });
  if (res.error) return toast(res.error);
  if (res.open) { window.open(res.open, "_blank", "noopener"); toast(res.note || T("Opened the sign-in page", "已打開登入頁")); return; }
  toast(res.note || T("Started the login", "已開始登入"));
  if (res.job) { DOC.job = res.job; render(); followJob(res.job.id); }
}

function openGithub() {
  const inp = h("input", { class: "input", id: "ghToken", type: "password", autocomplete: "off", placeholder: "ghp_… / github_pat_…" });
  modal(T("Connect GitHub", "連接 GitHub"), h("div", { style: "display:grid;gap:10px" },
    h("p", { class: "muted", style: "margin:0" }, T("Paste a token with read access to the repository. Studio checks it, keeps it on this Mac only (0600) and talks to GitHub's API directly: no gh CLI needed.",
      "貼上可以讀這個 repo 的 token。Studio 會先驗證，只存在這台 Mac（0600），直接呼叫 GitHub API，不需要 gh CLI。")),
    h("a", { href: "https://github.com/settings/personal-access-tokens/new", target: "_blank", rel: "noopener" }, T("Create a fine-grained token on github.com", "到 github.com 建立 fine-grained token")),
    h("label", { style: "display:grid;gap:4px;font-size:13px" }, T("Token", "Token"), inp),
    S.github?.tokenSource === "settings" ? h("button", { class: "btn ghost", onclick: async () => { await postJ("/api/github/forget"); $("#modalRoot").replaceChildren(); toast(T("Token removed", "已移除 token")); loadDoctor(); } }, T("Remove the saved token", "移除已存的 token")) : null),
    async (close, btn) => {
      btn.disabled = true;
      const r = await postJ("/api/github/token", { token: inp.value });
      btn.disabled = false;
      if (r.error) return toast(r.error);
      close(); if (r.github) S.github = r.github; toast(T("GitHub connected", "GitHub 已連接")); loadDoctor(); if (S.route?.name === "board") render();
    });
  $(".modal .btn.primary").textContent = T("Connect", "連接");
}

async function openKeys() {
  const k = await getJ("/api/keys").catch(() => ({}));
  const field = (id, label, set, ph, type = "password") => h("label", { style: "display:grid;gap:4px;font-size:13px" },
    h("span", {}, label, set ? h("span", { class: "badge ok", style: "margin-left:6px" }, set === "env" ? T("from env", "來自環境變數") : T("saved", "已儲存")) : null),
    h("input", { class: "input", id, type, autocomplete: "off", placeholder: set ? T("leave empty to keep", "留空保留") : ph }));
  modal(T("API keys for the status chat", "狀態對話的 API 金鑰"), h("div", { style: "display:grid;gap:10px" },
    h("p", { class: "muted", style: "margin:0" }, T("With a key (or a local model server) the status chat works with no CLI installed. Keys stay on this Mac (0600) and never reach the browser.",
      "有金鑰（或本地模型伺服器）就能在沒裝任何 CLI 的情況下使用狀態對話。金鑰只存在這台 Mac（0600），不會送到瀏覽器。")),
    field("keyAnthropic", "Anthropic API key", k.anthropic, "sk-ant-…"),
    field("keyOpenai", "OpenAI API key", k.openai, "sk-…"),
    field("keyCompatBase", T("OpenAI-compatible endpoint (LM Studio, Ollama…)", "OpenAI 相容端點（LM Studio、Ollama…）"), null, k.compatBaseUrl || "http://127.0.0.1:11434/v1", "url"),
    field("keyCompatKey", T("Endpoint key (optional)", "端點金鑰（選填）"), k.compatKey, "")),
    async (close, btn) => {
      const v = (id) => $(`#${id}`).value.trim() || undefined;
      btn.disabled = true;
      const r = await postJ("/api/keys", { anthropic: v("keyAnthropic"), openai: v("keyOpenai"), compatBaseUrl: v("keyCompatBase"), compatKey: v("keyCompatKey") });
      close(); if (r.error) toast(r.error); else { toast(T("Saved. Pick the provider in the chat settings.", "已儲存。請在對話設定選擇提供者。")); loadDoctor(); }
    });
  $(".modal .btn.primary").textContent = T("Save", "儲存");
}

// GitHub not connected: the bar says so and offers Connect, instead of an error
const _ghBar = ghBar;
// live S28: the chip said "GitHub off" while a project was connected to GitHub and its grant verified. Studio's own poller
// being off is not GitHub being off: the chip counts the projects whose grant verifies (the sidebar's data, projects.js),
// and with neither it is not shown at all
const ghProjects = () => { try { return (window.crewProjects?.state?.side?.projects || []).filter((p) => p.kind === "external" && p.connected).length; } catch { return 0; } };
ghBar = function () {
  const g = S.github, linked = ghProjects();
  if ((!g || !g.enabled) && linked) return h("span", { class: "ghbar", "data-gh": "projects", "data-gh-projects": linked }, icon("github", "ic sm"),
    T(`GitHub · ${linked} project${linked === 1 ? "" : "s"}`, `GitHub · ${linked} 個專案`));
  if (!g || !g.enabled) return null;
  if (g && g.enabled && g.connected === false) return h("span", { class: "ghbar", "data-gh": "disconnected" }, icon("github", "ic sm"), T("GitHub not connected", "GitHub 未連接"),
    h("button", { class: "btn ghost", style: "padding:0 6px;height:22px", onclick: openGithub }, T("Connect", "連接")));
  return _ghBar();
};

// the main session needs a vendor CLI; say so (and how to get one) when none is installed
const _driverBanner = driverBanner;
driverBanner = function (v) {
  const el = _driverBanner(v);
  const noCli = DOC.data && !DOC.data.items.some((i) => (i.id === "claude" || i.id === "codex") && i.availability === "available");
  if (v.state === "detached" && noCli) el.append(h("div", { class: "chat-err", "data-nocli": "1", style: "font-size:13px" },
    T("No Claude Code or Codex CLI on this Mac. The main session resumes that CLI's own session, so it needs one. The status chat works with any provider (API key or local model).",
      "這台 Mac 沒有 Claude Code 或 Codex CLI。主 session 要接續該 CLI 自己的 session，所以一定要有其中一個。狀態對話用任何提供者都可以（API 金鑰或本地模型）。"),
    " ", h("a", { href: "#/doctor" }, T("Install one in Doctor", "到健康檢查安裝"))));
  return el;
};

// LAN phone mode, built in: a section on the Phone page above Tailscale
const _viewRemote = viewRemote;
viewRemote = function () {
  const page = _viewRemote();
  const d = RM.data;
  if (!d || !d.lan || MS.me.kind === "phone") return page;
  const lan = d.lan;
  const sec = h("section", { class: "card", style: "display:grid;gap:10px;padding:16px", "data-section": "lan" },
    h("h2", { style: "margin:0;font-size:16px" }, T("Same Wi-Fi (built in, nothing to install)", "同一個 Wi-Fi（內建，不用安裝）")),
    h("p", { class: "muted", style: "margin:0" }, T("Your phone opens Studio at this Mac's local address and pairs with a code. This is plain HTTP on your local network, protected by pairing; Tailscale below adds encryption and access away from home.",
      "手機用這台 Mac 的區網位址打開 Studio，再用配對碼配對。這是區網內的明文 HTTP，靠配對保護；下面的 Tailscale 另外加上加密，也能在外面連。")),
    h("div", { class: "kv" }, h("span", { class: "faint" }, T("Phone URL", "手機網址")), h("span", { class: "mono", style: "word-break:break-all", "data-lan-url": lan.url || "" }, lan.url || T("no local network address", "沒有區網位址"))),
    h("div", { class: "kv" }, h("span", { class: "faint" }, T("LAN mode", "區網模式")), h("span", { "data-lan": lan.on ? "on" : "off" }, lan.on ? T("on", "開啟") : T("off", "關閉"))),
    h("div", { class: "actions" }, h("button", { class: lan.on ? "btn" : "btn primary", id: "lanToggle", disabled: !lan.url || null, onclick: () => {
      if (lan.on) return postJ("/api/remote/lan", { enable: false }).then(() => loadRemote());
      modal(T("Turn on LAN mode", "開啟區網模式"), h("div", { style: "display:grid;gap:10px" },
        h("p", { style: "margin:0" }, T("Studio will also listen on", "Studio 會另外在這裡聽"), " ", h("code", {}, lan.url)),
        h("p", { class: "faint", style: "margin:0;font-size:13px" }, T("Anyone on this Wi-Fi can reach the page, but only a paired phone sees or does anything. Turn it off when you are done; it is off again after Studio restarts.",
          "同一個 Wi-Fi 的人都連得到頁面，但只有配對過的手機看得到、做得了事。用完請關閉；Studio 重開後也會自動關閉。"))),
        async (close) => { const r = await postJ("/api/remote/lan", { enable: true, confirm: true }); close(); toast(r.ok ? T("LAN mode on — pair your phone below", "區網模式已開啟，請在下面配對手機") : r.error); loadRemote(); });
      $(".modal .btn.primary").textContent = T("Turn on", "開啟");
    } }, lan.on ? T("Turn LAN mode off", "關閉區網模式") : T("Turn on LAN mode…", "開啟區網模式…"))));
  const tsSec = page.querySelector('[data-section="tailscale"]');
  if (tsSec) { tsSec.before(sec); const h2 = tsSec.querySelector("h2"); if (!h2) tsSec.prepend(h("h2", { style: "margin:0;font-size:16px" }, T("Anywhere (Tailscale, optional)", "任何地方（Tailscale，選配）"))); }
  const intro = page.querySelector(".phead p");
  if (intro) intro.textContent = T("Pair your phone over the same Wi-Fi (built in) or, optionally, over Tailscale from anywhere.", "用同一個 Wi-Fi（內建）配對手機，或選配 Tailscale 在任何地方連線。");
  return page;
};
routes.remote = viewRemote;

// chat settings: point to the keys when an API provider is picked
$("#chatProv").addEventListener("click", () => setTimeout(() => {
  const sel = $("#provSel"); if (!sel) return;
  const hint = h("p", { class: "faint", id: "provHint", style: "margin:0;font-size:12px" });
  const upd = () => { const v = sel.value; hint.replaceChildren(["anthropic", "openai", "openai-compatible"].includes(v)
    ? h("span", {}, T("Direct API, no CLI needed. ", "直接呼叫 API，不需要 CLI。"), h("a", { href: "#", onclick: (e) => { e.preventDefault(); $("#modalRoot").replaceChildren(); openKeys(); } }, T("Set keys / endpoint", "設定金鑰／端點")))
    : T("Uses the installed CLI and its own login.", "使用已安裝的 CLI 和它自己的登入。")); };
  sel.addEventListener("change", upd); upd(); sel.closest("label")?.after(hint);
}));

Object.assign(routes, { doctor: viewDoctor });
{
  const b = h("button", { class: "nav-item", "data-view": "doctor", "data-tip": T("Doctor", "健康檢查") }, icon("tool"), h("span", { class: "nl" }, T("Doctor", "健康檢查")), h("span", { class: "count attn", id: "navDoctor", hidden: true }));
  $(".nav").append(b); b.addEventListener("click", () => { location.hash = "#/doctor"; });
  if (location.hash.startsWith("#/doctor")) route();
}
addEventListener("crew:codex-account",()=>{if(S.route?.name==="doctor")loadDoctor();});
addEventListener("crew:claude-account",()=>{if(S.route?.name==="doctor")loadDoctor();});
loadDoctor();
setInterval(loadDoctor, 60_000);
})();
