import {localUnrestricted} from "./local-execution";
// The Doctor: what Studio can use on this machine, what is degraded, and the one
// action that fixes each item. Studio itself needs nothing but its binary and a
// firstmate state folder; everything here is optional and Studio says what it adds.
// Installs use each vendor's official installer only, run in a child process with a
// clean environment, never without the captain's click, and never during tests
// (CREW_INSTALL_RUNNER=mock records instead of running; CREW_NO_REAL_INSTALL=1 refuses).
import { sandboxInfo } from "./runtime/checks";
import { captainAutoMode, claudePermissionMode } from "./host/claude-primary";
import { localExecutionNotice } from "./local-execution";
import { accessSync, constants, existsSync } from "node:fs";
import { homedir, platform, tmpdir } from "node:os";
import { join } from "node:path";

export type Status = "ok" | "degraded" | "missing" | "info";
export type Action = { kind: "install"; item: string } | { kind: "login"; item: string } | { kind: "github" } | { kind: "keys" } | { kind: "phone" } | { kind: "none" };
export type Item = { id: string; title: string; titleZh?: string; status: Status; availability?: "missing" | "available" | "unusable"; authenticated?: boolean | null; detail: string; detailZh?: string; adds: string; addsZh?: string; fix: string; fixZh?: string; group?: "basic" | "coding" | "optional"; action: Action; version?: string | null };
export type Method = { id: string; label: string; argv: string[]; source: string; location: string; needs: string[]; admin: boolean; kind?: "run" | "open"; url?: string };

const which = (bin: string): string | null => {
  if (bin.includes("/")) return existsSync(bin) ? bin : null;
  for (const d of (process.env.PATH ?? "").split(":")) { const p = join(d, bin); try { accessSync(p, constants.X_OK); return p; } catch {} }
  return null;
};
const version = (bin: string, flag = "--version"): string | null => {
  if (!which(bin)) return null;
  try { const r = Bun.spawnSync([bin, flag], { stdout: "pipe", stderr: "pipe", timeout: 8000 }); const v = (r.stdout.toString() || r.stderr.toString()).trim().split("\n")[0]; return r.success ? v.slice(0, 80) : null; } catch { return null; }
};
const present = (bin: string) => bin.includes("/") ? existsSync(bin) : (process.env.PATH ?? "").split(":").some(d => existsSync(join(d, bin)));
/** Read the vendor's login status only: never start a conversation or login flow. */
function authenticated(id: "claude" | "codex", bin: string): boolean | null {
  try {
    const r = Bun.spawnSync([bin, ...(id === "claude" ? ["auth", "status", "--json"] : ["login", "status"])], { stdout: "pipe", stderr: "pipe", timeout: 8000 });
    if (id === "claude") { const v = JSON.parse(r.stdout.toString()); return typeof v.loggedIn === "boolean" && (r.success || v.loggedIn === false) ? v.loggedIn : null; }
    const text = r.stdout.toString() + r.stderr.toString();
    if (/not logged in/i.test(text)) return false;
    return r.success && /^Logged in using /im.test(text) ? true : null;
  } catch { return null; }
}

/** Official installers, per OS. Data only: add linux/win32 rows here. */
export const INSTALLERS: Record<string, Record<string, Method[]>> = {
  darwin: {
    claude: [
      { id: "native", label: "Official installer (no admin rights)", argv: ["/bin/bash", "-c", "curl -fsSL https://claude.ai/install.sh | bash"],
        source: "https://claude.ai/install.sh — documented at https://docs.claude.com/en/docs/claude-code/setup", location: "~/.local/bin/claude", needs: ["curl"], admin: false },
      { id: "npm", label: "npm (official package)", argv: ["npm", "install", "-g", "@anthropic-ai/claude-code"],
        source: "https://www.npmjs.com/package/@anthropic-ai/claude-code", location: "npm's global folder", needs: ["npm"], admin: false },
      { id: "brew", label: "Homebrew", argv: ["brew", "install", "--cask", "claude-code"], source: "https://formulae.brew.sh/cask/claude-code", location: "Homebrew's prefix", needs: ["brew"], admin: false },
    ],
    codex: [
      { id: "npm", label: "npm (official package)", argv: ["npm", "install", "-g", "@openai/codex"], source: "https://www.npmjs.com/package/@openai/codex — documented at https://github.com/openai/codex",
        location: "npm's global folder", needs: ["npm"], admin: false },
      { id: "brew", label: "Homebrew", argv: ["brew", "install", "--cask", "codex"], source: "https://formulae.brew.sh/cask/codex", location: "Homebrew's prefix", needs: ["brew"], admin: false },
    ],
    tailscale: [
      { id: "brew", label: "Homebrew cask (macOS may ask for your password)", argv: ["brew", "install", "--cask", "tailscale"], source: "https://formulae.brew.sh/cask/tailscale",
        location: "/Applications/Tailscale.app", needs: ["brew"], admin: true },
      { id: "download", label: "Official download page", argv: [], kind: "open", url: "https://tailscale.com/download/mac", source: "https://tailscale.com/download/mac",
        location: "/Applications/Tailscale.app (you install it)", needs: [], admin: true },
    ],
    ffmpeg: [
      { id: "brew", label: "Homebrew (official formula)", argv: ["brew", "install", "ffmpeg"], source: "https://formulae.brew.sh/formula/ffmpeg — documented at https://ffmpeg.org/download.html",
        location: "Homebrew's prefix", needs: ["brew"], admin: false },
      { id: "download", label: "Official download page", argv: [], kind: "open", url: "https://ffmpeg.org/download.html#build-mac", source: "https://ffmpeg.org/download.html", location: "you choose", needs: [], admin: false },
    ],
    node: [
      { id: "brew", label: "Homebrew (official formula)", argv: ["brew", "install", "node"], source: "https://formulae.brew.sh/formula/node — documented at https://nodejs.org/en/download", location: "Homebrew's prefix", needs: ["brew"], admin: false },
      { id: "download", label: "Official installer", argv: [], kind: "open", url: "https://nodejs.org/en/download", source: "https://nodejs.org/en/download", location: "/usr/local (you install it)", needs: [], admin: true },
    ],
    renderer: [
      { id: "npm", label: "Playwright + Chromium into ~/.crew-studio/tools (no admin rights)", argv: ["/bin/bash", "-c", "mkdir -p ~/.crew-studio/tools && npm install --prefix ~/.crew-studio/tools playwright@1 && ~/.crew-studio/tools/node_modules/.bin/playwright install chromium"],
        source: "https://www.npmjs.com/package/playwright — documented at https://playwright.dev/docs/browsers", location: "~/.crew-studio/tools and Playwright's browser cache", needs: ["npm"], admin: false },
    ],
  },
  linux: {
    claude: [{ id: "native", label: "Official installer (no admin rights)", argv: ["/bin/bash", "-c", "curl -fsSL https://claude.ai/install.sh | bash"],
      source: "https://claude.ai/install.sh", location: "~/.local/bin/claude", needs: ["curl"], admin: false }],
    codex: [{ id: "npm", label: "npm (official package)", argv: ["npm", "install", "-g", "@openai/codex"], source: "https://www.npmjs.com/package/@openai/codex", location: "npm's global folder", needs: ["npm"], admin: false }],
    tailscale: [{ id: "download", label: "Official download page", argv: [], kind: "open", url: "https://tailscale.com/download/linux", source: "https://tailscale.com/download/linux", location: "system packages (you install it)", needs: [], admin: true }],
    ffmpeg: [{ id: "download", label: "Official download page", argv: [], kind: "open", url: "https://ffmpeg.org/download.html#build-linux", source: "https://ffmpeg.org/download.html", location: "system packages (you install it)", needs: [], admin: true }],
    node: [{ id: "download", label: "Official download page", argv: [], kind: "open", url: "https://nodejs.org/en/download", source: "https://nodejs.org/en/download", location: "you choose", needs: [], admin: true }],
    renderer: [{ id: "npm", label: "Playwright + Chromium into ~/.crew-studio/tools", argv: ["/bin/bash", "-c", "mkdir -p ~/.crew-studio/tools && npm install --prefix ~/.crew-studio/tools playwright@1 && ~/.crew-studio/tools/node_modules/.bin/playwright install chromium"],
      source: "https://www.npmjs.com/package/playwright", location: "~/.crew-studio/tools", needs: ["npm"], admin: false }],
  },
  win32: {
    claude: [{ id: "npm", label: "npm (official package)", argv: ["npm", "install", "-g", "@anthropic-ai/claude-code"], source: "https://www.npmjs.com/package/@anthropic-ai/claude-code", location: "npm's global folder", needs: ["npm"], admin: false }],
    codex: [{ id: "npm", label: "npm (official package)", argv: ["npm", "install", "-g", "@openai/codex"], source: "https://www.npmjs.com/package/@openai/codex", location: "npm's global folder", needs: ["npm"], admin: false }],
    tailscale: [{ id: "download", label: "Official download page", argv: [], kind: "open", url: "https://tailscale.com/download/windows", source: "https://tailscale.com/download/windows", location: "Program Files (you install it)", needs: [], admin: true }],
  },
};

/** Vendor login flows: Studio starts or links them, never sees the credentials. */
export const LOGINS: Record<string, { label: string; argv?: string[]; url?: string; note: string }> = {
  claude: { label: "Sign in to Claude", url: "https://claude.ai/login", note: "Studio runs the official `claude auth login`, which opens your browser. Studio never sees the credentials." },
  codex: { label: "Log in to Codex", argv: ["codex", "login"], url: "https://chatgpt.com/auth/login", note: "Studio owns the official Codex browser sign-in; no terminal session is required." },
  tailscale: { label: "Sign in to Tailscale", argv: ["open", "-a", "Tailscale"], url: "https://login.tailscale.com", note: "Opens the Tailscale app; sign in there." },
};

/** Installer choices for an item on this OS, usable ones first, no-admin first. */
export function methodsFor(item: string, os = platform()): (Method & { usable: boolean })[] {
  const list = INSTALLERS[os]?.[item] ?? [];
  return list.map((m) => ({ ...m, usable: m.needs.every((n) => !!which(n)) }))
    .sort((a, b) => Number(b.usable) - Number(a.usable) || Number(a.admin) - Number(b.admin));
}

export type DoctorInput = {
  codexAccount?:import("./host/codex-account").CodexAccountView;
  state: string; legacy?: boolean; board: { writable: boolean; readonlyReason?: string | null }; gh: { connected: boolean; tokenSource: string | null; enabled: boolean };
  keys: { anthropic: string | null; openai: string | null; compatBaseUrl: string | null }; chatProvider: string; lanIp: string | null;
  tailscale: { installed: boolean; running: boolean; dnsName: string | null }; claudeBin?: string; codexBin?: string; compiled: boolean;
  render?: { node: string | null; ffmpeg: string | null; ffprobe?: string | null; playwright: string | null };
  /** the egress proxy agent rounds go through */
  egress?: { running: boolean; port: number; rounds: number };
  /** how claude rounds sign in: the login Studio hands them (v1 option A) */
  roundLogin?: { ok: boolean; verified?: boolean; source?: string; warn?: string | null; error?: string };
  /** the captain's operating rules: an unreadable text is a visible problem, never a silent "none" */
  operatingRules?: { studio: { text: string; unreadable?: string }; projects: { id: string; text: string; unreadable?: string }[] };
};

export function diagnose(i: DoctorInput): Item[] {
  const claudeV = version(i.claudeBin ?? process.env.CREW_CLAUDE_BIN ?? "claude");
  const codexV = version(i.codexBin ?? process.env.CREW_CODEX_BIN ?? "codex");
  const anyKey = !!(i.keys.anthropic || i.keys.openai || i.keys.compatBaseUrl);
  const statusChatOk = !!claudeV || !!codexV || anyKey;
  const items: Item[] = [];
  const legacy=i.legacy !== false;
  if (i.operatingRules) { const bad = [...(i.operatingRules.studio.unreadable ? [`Studio-wide: ${i.operatingRules.studio.unreadable}`] : []), ...i.operatingRules.projects.filter((p) => p.unreadable).map((p) => `${p.id}: ${p.unreadable}`)];
    items.push({ id: "operating-rules", title: "Operating rules", titleZh: "作業規則", status: bad.length ? "degraded" : "ok",
      detail: bad.length ? `could not read: ${bad.join("; ")}. Every prompt says the rules are unreadable until the file is fixed.` : i.operatingRules.studio.text ? "Studio-wide rules set; every job gets them" : "no Studio-wide rules set (prompts say None set)",
      detailZh: bad.length ? `無法讀取：${bad.join("；")}。修好檔案前，每個提示都會寫明規則無法讀取。` : i.operatingRules.studio.text ? "已設定 Studio 全域規則，每個工作都會收到" : "尚未設定 Studio 全域規則（提示會寫明未設定）",
      group: "basic" } as any); }
  items.push({id:"native",title:"Native Studio web",titleZh:"原生 Studio 網頁",status:"ok",group:"basic",detail:"Local pages, native workflows, cards and storage need no v1 folder or external runtime.",detailZh:"本機頁面、原生工作流程、卡片與儲存不需要 v1 資料夾或外部執行環境。",adds:"Basic Studio works before coding tools are installed.",addsZh:"尚未安裝寫程式工具，也能使用 Studio 基本功能。",fix:"",action:{kind:"none"}});
  for (const [id, bin, en, zh, purpose, purposeZh] of [
    ["git","git","Git (coding repositories)","Git（程式碼儲存庫）","Coding worktrees and local commits.","程式碼 worktree 與本機提交。"],
    ["node",process.env.CREW_NODE_BIN||"node","Node.js (built-in script checks)","Node.js（內建腳本檢查）","Built-in firstmate script checks; not needed to launch the binary.","內建 firstmate 腳本檢查；啟動獨立執行檔不需要它。"],
    ["python",process.env.CREW_PYTHON_BIN||"python3","Python 3 (wording check)","Python 3（用字檢查）","The core/ste-wording check; not needed for basic pages.","core/ste-wording 檢查；基本頁面不需要它。"],
  ]) {
    const v=version(bin);
    const found = present(bin);
    items.push({id,title:en,titleZh:zh,status:v?"ok":found?"degraded":"missing",availability:v?"available":found?"unusable":"missing",group:"coding",version:v,detail:v||(found?"CLI found, but --version failed.":"not installed; this coding/check capability is unavailable"),detailZh:v||(found?"找到 CLI，但 --version 執行失敗。":"尚未安裝；此程式碼／檢查功能無法使用"),adds:purpose,addsZh:purposeZh,fix:v?"":found?"Check executable permissions and dependencies.":`Install ${id==="python"?"Python 3":en.split(" (")[0]} before using this capability.`,fixZh:v?"":found?"檢查執行權限與依賴。":"使用這項功能前，請先安裝對應工具。",action:v||found||id!=="node"||!methodsFor("node").length?{kind:"none"}:{kind:"install",item:"node"}});
  }
  const hasEvents = existsSync(join(i.state, "events.jsonl"));
  items.push({ id: "state", title: "firstmate state folder", status: !legacy ? "info" : hasEvents ? "ok" : "missing", detail: !legacy ? "Legacy adapter off; no v1 state folder is read." : hasEvents ? i.state : `no events.jsonl under ${i.state}`, detailZh: !legacy ? "舊版轉接器已關閉；不會讀取 v1 state 資料夾。" : undefined,
    adds: !legacy ? "Optional legacy task history; native workflows do not use it." : "Board, Inbox, Crew, Activity, Library: everything Studio shows.", addsZh: !legacy ? "選用的舊版任務紀錄；原生工作流程不使用它。" : undefined, fix: !legacy || hasEvents ? "" : "Start Studio with CREW_FM_STATE=<firstmate>/state.", action: { kind: "none" } });
  items.push({ id: "board", title: "firstmate board (to answer cards)", status: !legacy ? "info" : i.board.writable ? "ok" : "degraded", detail: !legacy ? "Optional legacy board disabled; native cards use Studio." : i.board.writable ? "answers go through the board" : `read-only: ${i.board.readonlyReason ?? "board unavailable"}`, detailZh: !legacy ? "選用的舊版看板已停用；原生卡片由 Studio 處理。" : undefined,
    adds: "Answering cards from Studio.", fix: !legacy || i.board.writable ? "" : "Start the firstmate board; until then answer cards on the board itself.", action: { kind: "none" } });
  for (const [id, title, bin, v] of [
    ["claude", "Claude Code CLI", i.claudeBin ?? process.env.CREW_CLAUDE_BIN ?? "claude", claudeV],
    ["codex", "Codex CLI", i.codexBin ?? process.env.CREW_CODEX_BIN ?? "codex", codexV],
  ] as const) {
    const found = present(bin), auth = v ? authenticated(id, bin) : null;
    items.push({ id, title, status: v ? "ok" : found ? "degraded" : "missing", availability: v ? "available" : found ? "unusable" : "missing", authenticated: auth, version: v,
      detail: v ? `${v}; ${auth === true ? "CLI reports logged in" : auth === false ? "not logged in" : "login status unverified"}. Workflow execution is not verified.` : found ? "CLI found, but --version could not complete successfully." : "CLI not found at the configured path or on PATH.",
      detailZh: v ? `${v}；${auth === true ? "CLI 回報已登入" : auth === false ? "尚未登入" : "登入狀態未確認"}。工作流程執行能力尚未驗證。` : found ? "找到 CLI，但 --version 無法成功完成。" : "在指定路徑或 PATH 中找不到 CLI。",
      adds: "CLI availability and login status only; model access, quota and workflow execution require separate checks.",
      addsZh: "只檢查 CLI 與登入狀態；模型權限、配額與工作流程執行需另外驗證。",
      fix: v ? "" : found ? "Check executable permissions and dependencies, then run --version again." : "Install the CLI using its official installer.",
      fixZh: v ? "" : found ? "檢查執行權限與依賴，再執行 --version。" : "使用官方安裝方式安裝 CLI。",
      action: v && auth !== true ? { kind: "login", item: id } : found || v ? { kind: "none" } : { kind: "install", item: id } });
  }
  if(i.codexAccount)items.push({id:"codex-account",title:"Codex account",titleZh:"Codex 帳號",status:i.codexAccount.state==="ready"?"info":"degraded",detail:i.codexAccount.reason,detailZh:i.codexAccount.reasonZh,adds:"Sign in and start new work here; no terminal session selection is required. Account readiness does not verify repository tools.",addsZh:"在這裡登入並開始新工作，不必選擇終端機 session；帳號就緒不代表專案工具已驗證。",fix:"",action:{kind:"login",item:"codex"}});
  items.push({ id: "keys", title: "API keys for the status chat", status: anyKey ? "ok" : statusChatOk ? "info" : "degraded",
    detail: [i.keys.anthropic ? `Anthropic (${i.keys.anthropic})` : null, i.keys.openai ? `OpenAI (${i.keys.openai})` : null, i.keys.compatBaseUrl ? `endpoint ${i.keys.compatBaseUrl}` : null].filter(Boolean).join(", ") || "none set",
    adds: "The status chat without any CLI: Anthropic API, OpenAI API, or a local OpenAI-compatible server (LM Studio, Ollama).", fix: anyKey ? "" : "Add a key or an endpoint.", action: { kind: "keys" } });
  items.push({ id: "chat", title: "Status chat", status: statusChatOk ? "ok" : "degraded", detail: statusChatOk ? `answering with ${i.chatProvider}` : "no provider can answer yet",
    adds: "Asking firstmate how things stand, with cited sources.", fix: statusChatOk ? "" : "Install a CLI or add an API key.", action: statusChatOk ? { kind: "none" } : { kind: "keys" } });
  items.push({ id: "main", title: "firstmate main session", status: claudeV || codexV ? "info" : "degraded", detail: claudeV || codexV ? "CLI available; verify login and an actual native repository read before firstmate work." : "needs the Claude Code or Codex CLI", detailZh: claudeV || codexV ? "CLI 可用；開始 firstmate 工作前，請確認登入並完成一次實際的原生工具讀檔。" : "需要 Claude Code 或 Codex CLI",
    adds: "Driving the real firstmate from Studio and your phone. It resumes that CLI's own session, so it needs the CLI.", fix: claudeV || codexV ? "" : "Install Claude Code or Codex.", action: claudeV || codexV ? { kind: "none" } : { kind: "install", item: "claude" } });
  items.push({ id: "github", title: "GitHub", status: !i.gh.enabled ? "info" : i.gh.connected ? "ok" : "degraded", detail: !i.gh.enabled ? "off (CREW_GH=0)" : i.gh.connected ? `connected (token from ${i.gh.tokenSource})` : "not connected",
    adds: "PR and CI columns, merged work in the Library.", fix: i.gh.connected || !i.gh.enabled ? "" : "Paste a GitHub token (read access to the repository).", action: { kind: "github" } });
  items.push({ id: "lan", title: "Phone on the same Wi-Fi (built in)", status: i.lanIp ? "info" : "degraded", detail: i.lanIp ? `this Mac is ${i.lanIp}; LAN mode is off until you turn it on` : "no local network address found",
    adds: "Phone access with nothing to install. Plain HTTP on your local network, protected by pairing.", fix: "", action: { kind: "phone" } });
  items.push({ id: "tailscale", title: "Tailscale (optional)", status: i.tailscale.installed ? (i.tailscale.running ? "ok" : "degraded") : "info",
    detail: i.tailscale.installed ? (i.tailscale.running ? `running as ${i.tailscale.dnsName ?? "?"}` : "installed, not signed in") : "not installed",
    adds: "Phone access from anywhere, encrypted. Not needed on the same Wi-Fi.", fix: i.tailscale.installed ? (i.tailscale.running ? "" : "Sign in to Tailscale.") : "Install it only if you want access away from home.",
    action: i.tailscale.installed ? (i.tailscale.running ? { kind: "none" } : { kind: "login", item: "tailscale" }) : { kind: "install", item: "tailscale" } });
  if (i.render) {
    // M3: rendering films and pin crops (review loops still take notes and briefs without them)
    const r = i.render;
    items.push({ id: "ffmpeg", title: "ffmpeg (film render)", status: r.ffmpeg ? "ok" : "info", detail: r.ffmpeg ? `${r.ffmpeg}` : "not installed",
      adds: "Turning a revised HTML film into an MP4. Without it, notes and briefs still work; a regenerated film waits for a render.", fix: r.ffmpeg ? "" : "Install ffmpeg (Homebrew or the official build).",
      action: r.ffmpeg ? { kind: "none" } : { kind: "install", item: "ffmpeg" } });
    items.push({ id: "ffprobe", title: "ffprobe (film size check)", status: r.ffprobe ? "ok" : "info", detail: r.ffprobe ? `${r.ffprobe}` : r.ffmpeg ? "not installed; ffmpeg reads the MP4 size instead" : "not installed",
      adds: "Confirming a rendered film is exactly 1920x1080 (or 1080x1920) before it is offered for acceptance.", fix: r.ffprobe || r.ffmpeg ? "" : "Install ffmpeg; its official builds include ffprobe.",
      action: r.ffprobe || r.ffmpeg ? { kind: "none" } : { kind: "install", item: "ffmpeg" } });
    items.push({ id: "renderer", title: "Headless browser (film frames, pin crops)", status: "info",
      detail: r.node && r.playwright ? `Node and Playwright detected; Chromium and actual capture execution are unverified.` : !r.node ? "node not installed" : "Playwright and Chromium not installed",
      adds: "Screenshot crops of web pins and the frames of a film render.", fix: r.node && r.playwright ? "" : !r.node ? "Install Node.js first, then the renderer." : "Install Playwright with Chromium (no admin rights).",
      action: r.node && r.playwright ? { kind: "none" } : { kind: "install", item: !r.node ? "node" : "renderer" } });
  }
  const lock = !!which("ps") && !!which("lsof");
  items.push({ id: "lock", title: "ps / lsof (driver lock)", status: lock ? "ok" : "degraded", detail: lock ? "built into the OS" : "missing: Studio cannot tell whether a terminal holds the session",
    adds: "Refusing to attach while a terminal drives the same session.", fix: lock ? "" : "Use a system with ps and lsof.", action: { kind: "none" } });
  items.push({ id: "assets", title: "Fonts and web assets", status: "ok", detail: i.compiled ? "embedded in the binary" : "served from public/ (vendored)", adds: "The UI loads with no network.", fix: "", action: { kind: "none" } });
  const sb = sandboxInfo();
  items.push({ id: "sandbox", title: "Check sandbox", status: sb.ok ? "ok" : "missing", detail: sb.detail,
    adds: "Checks and run gates execute with read-only inputs, writes only to out/ and no network.", fix: sb.ok ? "" : "Run Studio on macOS (sandbox-exec). Without it, checks are refused rather than run unconfined.", action: { kind: "none" } });
  const eg = i.egress;
  const roundOk = sb.ok && !!eg?.running;
  items.push({ id: "round-sandbox", title: "Agent round sandbox and egress proxy", status: roundOk ? "ok" : "missing",
    detail: roundOk ? `rounds write only their worktree and a throwaway home; they reach Studio only through its tool listener and the network only through the proxy on 127.0.0.1:${eg!.port}, each with its own credential and host list (${eg!.rounds} open now)` : !sb.ok ? "no OS sandbox: agent rounds are refused" : "the egress proxy is not running: agent rounds are refused",
    adds: "Every workflow agent round (worker, coordinator, reviewer, judge) runs in the OS sandbox and reaches only its provider's API.", fix: roundOk ? "" : "Run Studio on macOS; the proxy starts with Studio.", action: { kind: "none" } });
  if(localUnrestricted())for(const item of items.filter(v=>["sandbox","round-sandbox"].includes(v.id))){item.status="degraded";item.detail="Local unrestricted mode: OS sandbox and outbound-network restrictions disabled by operator configuration";item.adds="Captain approvals, task scope and ledger validation remain required. Dependencies are repository-local only. Unsandboxed processes run as you, so Studio's 0600 tool-token files no longer isolate the Firstmate's Studio tools from them.";item.fix="Unset CREW_LOCAL_UNRESTRICTED and restart to restore isolation.";}
  const rl = i.roundLogin;
  // degraded (the Doctor's warn) while the login is a keychain item no round has signed in with yet; ok once one has; missing when no source works
  if (rl) items.push({ id: "round-login", title: "Vendor token handed to rounds; keychain not reachable", status: !rl.ok ? "missing" : rl.verified === false ? "degraded" : "ok",
    detail: rl.ok ? `Claude rounds get ${rl.source} as their one credential (CLAUDE_CODE_OAUTH_TOKEN); no keychain, no GitHub token and no other credential reaches a round.${rl.warn ? ` Note: ${rl.warn}.` : ""}` : `Claude rounds are refused: ${rl.error}`,
    adds: "How agent rounds sign in: Studio reads the vendor's own login outside the sandbox and hands the round only its token.",
    fix: rl.ok ? (rl.warn ? "Make a crew token once: claude setup-token, then security add-generic-password -s crew-studio-claude-token -a \"$USER\" -w (or ~/.config/crew-studio/claude-token, mode 600)." : "") : "Make a crew token once: claude setup-token, then security add-generic-password -s crew-studio-claude-token -a \"$USER\" -w (or ~/.config/crew-studio/claude-token, mode 600).", action: { kind: "none" } });
  // the fresh Claude Firstmate's configured permission mode (auto unless the operator sets CREW_CLAUDE_PERMISSION_MODE in env or .env),
  // the captain's autoMode rules Studio copies into it, and whether it runs in local unrestricted mode
  const pm = claudePermissionMode(process.env.CREW_CLAUDE_PERMISSION_MODE), am = captainAutoMode();
  let unrestricted = false; try { unrestricted = !!localExecutionNotice(); } catch {}
  const extra = ` Captain auto-mode rules: ${am.summary}. Local unrestricted mode: ${unrestricted ? "on (the Claude primary runs as you with no OS sandbox or egress limits and is told so; the permission bridge, deny rules and token files stay)" : "off"}.`;
  const extraZh = ` 船長的 auto mode 規則：${am.summaryZh}。本機無限制模式：${unrestricted ? "開啟" : "關閉"}。`;
  items.push({ id: "claude-permission-mode", title: "Claude Firstmate permission mode", titleZh: "Claude Firstmate 權限模式", status: !pm.ok ? "missing" : am.state === "malformed" || unrestricted ? "degraded" : "ok",
    detail: pm.ok ? `Configured Claude permission mode: ${pm.mode}${pm.mode === "auto" ? " (Claude's classifier approves or denies tool calls; what it escalates asks you through Studio's permission bridge; the Firstmate card shows the mode Claude actually reports)" : " (every tool outside Studio's own asks you through Studio's permission bridge)"}.${extra}` : pm.en,
    detailZh: pm.ok ? `設定的 Claude 權限模式：${pm.mode}${pm.mode === "auto" ? "（由 Claude 的分類器核准或拒絕工具呼叫；它升級的請求會透過 Studio 的權限橋問你；Firstmate 卡片顯示 Claude 實際回報的模式）" : "（Studio 以外的工具都會透過 Studio 的權限橋問你）"}。${extraZh}` : pm.zh,
    adds: "How a fresh Claude Firstmate approves tool calls. Worker rounds are not affected. The operator sets CREW_CLAUDE_PERMISSION_MODE=default|auto in the environment or .env; no model or API request can change it. Only the autoMode block of the captain's Claude settings is copied; hooks, permissions, env and MCP servers are never copied.",
    fix: !pm.ok ? "Set CREW_CLAUDE_PERMISSION_MODE to default or auto (or unset it for auto), then restart Studio." : am.state === "malformed" ? "Fix the autoMode block in your Claude settings.json (lists of text rules: environment, allow, soft_deny, hard_deny; classifyAllShell true/false), then start the Claude Firstmate again." : "", action: { kind: "none" } });
  for (const item of items) {
    if (item.id === "tailscale") { item.availability = i.tailscale.installed ? "available" : "missing"; item.authenticated = i.tailscale.running ? true : null; }
    if (item.id === "ffmpeg") item.availability = i.render?.ffmpeg ? (version(i.render.ffmpeg, "-version") ? "available" : "unusable") : "missing";
    if (item.id === "ffprobe") item.availability = i.render?.ffprobe ? "available" : "missing";
    // A detected Playwright module alone does not prove Chromium is installed or runnable.
    if (item.id === "renderer" && !(i.render?.node && i.render?.playwright)) item.availability = "missing";
    if (item.id === "lock") item.availability = lock ? "available" : "missing";
    if (item.id === "sandbox") item.availability = sb.ok ? "available" : present("/usr/bin/sandbox-exec") ? "unusable" : "missing";
    item.group ??= ["native","assets"].includes(item.id)?"basic":["state","board","github","lan","tailscale","ffmpeg","ffprobe","renderer"].includes(item.id)?"optional":"coding";
  }
  return items;
}

// --- installer runs: one job at a time, log streamed, cancellable ---
export type Job = { id: string; item: string; method: string; argv: string[]; state: "running" | "done" | "failed" | "cancelled"; code: number | null; lines: string[]; started: string; ended: string | null };
export interface InstallRunner { readonly real: boolean; run(argv: string[], onLine: (l: string) => void): { done: Promise<number>; cancel(): void } }

/** Runs the official installer in its own process group, with a clean environment and no stdin. */
export class RealRunner implements InstallRunner {
  readonly real = true;
  run(argv: string[], onLine: (l: string) => void) {
    if (process.env.CREW_NO_REAL_INSTALL === "1") throw new Error("installs are disabled here (CREW_NO_REAL_INSTALL=1)");
    const env: Record<string, string> = {};
    for (const k of ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "TMPDIR", "TERM"]) if (process.env[k]) env[k] = process.env[k]!;
    const p = Bun.spawn(argv, { cwd: tmpdir(), env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const pump = async (s: ReadableStream<Uint8Array>) => { const d = new TextDecoder(); let buf = ""; for await (const c of s as any) { buf += d.decode(c, { stream: true }); let i; while ((i = buf.indexOf("\n")) >= 0) { onLine(buf.slice(0, i)); buf = buf.slice(i + 1); } } if (buf) onLine(buf); };
    void pump(p.stdout as any); void pump(p.stderr as any);
    const timer = setTimeout(() => { try { p.kill(); } catch {} }, 15 * 60_000);
    return { done: p.exited.then((c) => { clearTimeout(timer); return c; }), cancel: () => { try { p.kill(); } catch {} } };
  }
}

/** Test runner: records the command and plays a scripted log; never runs anything. */
export class MockRunner implements InstallRunner {
  readonly real = false;
  readonly ran: string[][] = [];
  run(argv: string[], onLine: (l: string) => void) {
    this.ran.push(argv);
    const fail = process.env.CREW_MOCK_INSTALL === "fail";
    let cancelled = false, finish: (c: number) => void = () => {};
    const done = new Promise<number>((r) => { finish = r; });
    const lines = ["(mock) would run: " + argv.join(" "), "downloading…", "installing…", fail ? "error: mock installer failed" : "installed"];
    let i = 0;
    const tick = () => { if (cancelled) return; if (i < lines.length) { onLine(lines[i++]); setTimeout(tick, 250); } else finish(fail ? 1 : 0); };
    setTimeout(tick, 50);
    return { done, cancel: () => { cancelled = true; finish(143); } };
  }
}

export class Installs {
  jobs = new Map<string, Job>();
  private current: { job: Job; cancel(): void } | null = null;
  onChange: (j: Job, line?: string) => void = () => {};
  onFinished: (j: Job) => void = () => {};
  constructor(readonly runner: InstallRunner) {}
  get busy() { return !!this.current; }

  start(item: string, method: Method, argvOverride?: string[]): Job {
    if (this.current) throw new Error("another install is running; wait or cancel it");
    const argv = argvOverride ?? method.argv;
    const job: Job = { id: `J${Date.now().toString(36)}`, item, method: method.id, argv, state: "running", code: null, lines: [], started: new Date().toISOString(), ended: null };
    this.jobs.set(job.id, job);
    const h = this.runner.run(argv, (l) => { job.lines.push(l.slice(0, 500)); if (job.lines.length > 2000) job.lines.shift(); this.onChange(job, l); });
    this.current = { job, cancel: h.cancel };
    h.done.then((code) => {
      job.code = code; job.ended = new Date().toISOString();
      if (job.state === "running") job.state = code === 0 ? "done" : "failed";
      this.current = null; this.onChange(job); this.onFinished(job);
    });
    this.onChange(job);
    return job;
  }
  cancel(id: string) {
    if (this.current?.job.id !== id) return false;
    this.current.job.state = "cancelled"; this.current.cancel(); return true;
  }
}

export const isTestRunner = () => process.env.CREW_INSTALL_RUNNER === "mock";
export const homeShort = (p: string) => p.replace(homedir(), "~");
