// Projects in the sidebar, phase 1 (read only; no new authority). Two reads:
//   GET /api/projects/overview          the sidebar: each registered project and the Studio row (runs in no project),
//                                       each with its open captain cards, running and held counts and one status line
//   GET /api/projects/<id>/overview     one project's page: identity, health tiles, active Tasks and who each waits on,
//                                       open cards (deep links), the approved crew (read only), sensitive paths, outputs,
//                                       worktrees. <id> may be "studio": its Tasks and cards only.
// A desktop request needs Studio's session (401 without it); a paired phone reads, as it reads Tasks. Nothing here
// writes: the registry is read with the strict reader (never the migrating one), git is never run (refs are read as
// files, as staffingIdentity reads them), and <repo>/.crew/gates.json is read size-capped without following links.
// A section that cannot be read carries {error} and the rest still renders. There are no cost fields.
//   POST /api/projects/<id>/github/connect   (desktop) only proposes: it raises the captain-only "Connect to GitHub"
//                                       card (src/github-connect.ts); the captain's answer on that card writes the grant.
//   POST /api/projects/<id>/github/merge[/revoke]   (desktop) only proposes: the captain-only card that grants
//                                       or revokes Studio's merge for that repository (src/github-merge-grant.ts).
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, join, relative, isAbsolute, resolve } from "node:path";
import { hasSession } from "./csrf";
import { loadDefaults, type Project, type Projects, type StaffingRefusal } from "./doors";
import { websiteHref } from "./artifacts";
import { StaffingStore } from "./domain/staffing";
import { roundsOf, waitsOn, type WaitsOn } from "./task-round";
import type { Engine, Run } from "./runtime/engine";
import type { WorktreeRecord } from "./worktrees";
import { githubSlugOf, originOf, verifyGitHubGrant } from "./github-grant";
import { startGitHubConnect } from "./github-connect";
import { startMergeGrant } from "./github-merge-grant";

export type Line = { tone: "" | "ok" | "run" | "human" | "warn" | "bad"; en: string; tw: string };
type Who = { kind: "desktop" | "phone" | "refused" | string };
export type OverviewDeps = {
  dataDir: string; projects: Projects; engine: Engine; session: string;
  worktrees: { all(): WorktreeRecord[] };
  artifacts?: { list(): any[]; versions(id: string): any[] } | null;
  protectedRoots?: string[];
  now?: () => number;
  prepareLocalProject?: (args:unknown,owner:any)=>Promise<unknown>;
};

const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);
const FAILED_RESULTS = new Set(["fail", "error", "timeout", "cap"]);
const STUDIO = "studio";
const GATES_MAX = 64 * 1024;
const inside = (a: string, b: string) => { const r = relative(a, b); return !r || (r !== ".." && !r.startsWith("../") && !isAbsolute(r)); };

/** A small file inside `container`, read without following a link out of it; null when it is not a plain small file. */
function small(path: string, max: number, container: string): string | null {
  try { const real = realpathSync(path); if (!inside(container, real)) return null; const st = statSync(real); if (!st.isFile() || st.size > max) return null; return readFileSync(real, "utf8").trim(); } catch { return null; }
}
/** The base branch's commit, read as files (loose ref, then packed-refs) the way staffingIdentity reads it; never runs git. */
export function readBaseRef(repo: string | null, base: string): { found: boolean; sha: string | null } {
  if (!repo || !base || base.includes("..") || base.startsWith("/") || base.startsWith("-")) return { found: false, sha: null };
  try {
    const root = realpathSync(repo); let git = join(root, ".git");
    if (statSync(git).isFile()) { const t = small(git, 4096, root); if (!t?.startsWith("gitdir: ") || t.includes("\n")) return { found: false, sha: null }; git = resolve(root, t.slice(8)); }
    git = realpathSync(git); if (!statSync(git).isDirectory()) return { found: false, sha: null };
    const cf = join(git, "commondir"); const common = existsSync(cf) ? realpathSync(resolve(git, small(cf, 4096, git) ?? ".")) : git;
    const ref = `refs/heads/${base}`;
    const loose = join(common, ref);
    if (existsSync(loose)) { const v = small(loose, 256, common); if (v && /^[a-f0-9]{40,64}$/.test(v)) return { found: true, sha: v }; }
    const packed = small(join(common, "packed-refs"), 1024 * 1024, common);
    for (const line of packed?.split("\n") ?? []) { const [sha, name] = line.split(" "); if (name === ref && /^[a-f0-9]{40,64}$/.test(sha ?? "")) return { found: true, sha }; }
  } catch {}
  return { found: false, sha: null };
}
/** The repository's declared test command from <repo>/.crew/gates.json: read only, size-capped, no links followed. */
export function readGatesTest(repo: string | null): { state: "ok" | "missing" | "no-test" | "link" | "oversized" | "unreadable"; test: string | null } {
  if (!repo) return { state: "missing", test: null };
  try {
    const dir = join(repo, ".crew"), file = join(dir, "gates.json");
    let d; try { d = lstatSync(dir); } catch { return { state: "missing", test: null }; }
    if (d.isSymbolicLink()) return { state: "link", test: null };
    if (!d.isDirectory()) return { state: "missing", test: null };
    let f; try { f = lstatSync(file); } catch { return { state: "missing", test: null }; }
    if (f.isSymbolicLink()) return { state: "link", test: null };
    if (!f.isFile()) return { state: "unreadable", test: null };
    if (f.size > GATES_MAX) return { state: "oversized", test: null };
    const c = JSON.parse(readFileSync(file, "utf8"));
    const t = c?.test;
    if (Array.isArray(t) && t.length && t.every((s: unknown) => typeof s === "string")) return { state: "ok", test: t.join(" ").slice(0, 300) };
    if (typeof t === "string" && t.trim()) return { state: "ok", test: t.trim().slice(0, 300) };
    return { state: "no-test", test: null };
  } catch { return { state: "unreadable", test: null }; }
}

const kindOf = (p: Project): "local" | "external" | "builtin" => (p.github ? "external" : p.id === "sandbox" ? "builtin" : "local");
const enabledOf = (p: Project) => p.enabled === undefined || p.enabled === true;
const failedRun = (r: Run) => r.status === "failed" || (r.status === "succeeded" && FAILED_RESULTS.has(r.result ?? ""));
const short = (sha: string | null | undefined) => (sha ? String(sha).slice(0, 7) : "");
const tile = (key: string, tone: Line["tone"] | "idle", en: string, tw: string, detail: { en: string; tw: string } | null = null, code: string | null = null) => ({ key, tone, en, tw, detail, code });

export function createProjectOverview(d: OverviewDeps) {
  const now = d.now ?? (() => Date.now());
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  const E = d.engine;
  const records = (): Project[] => d.projects.nativeSnapshot().records;
  const live = (r: Run) => !TERMINAL.has(r.status) && !r.archived;
  const capacityFor = (r: Run) => {
    try {
      const project = E.queueProject(r);
      const limit = Number(E.policies.get("queue.project_capacity", { project, workflow: r.def?.policies }).value);
      const active = E.deps.agents.queue.snapshot().active.filter((a) => a.project === project).length;
      return Number.isFinite(limit) ? { active, limit } : null;
    } catch { return null; }
  };
  const waitOf = (r: Run, open: any[]): WaitsOn => waitsOn(r, open, capacityFor(r));
  /** each run in the sidebar row it counts under */
  function grouped() {
    const by = new Map<string, Run[]>();
    for (const r of E.list()) { const k = E.projectRow(r); if (!by.has(k)) by.set(k, []); by.get(k)!.push(r); }
    return by;
  }
  function counts(runs: Run[], open: any[]) {
    let attention = 0, running = 0, held = 0, failed24h = 0; const mini: string[] = [];
    const day = now() - 24 * 3600 * 1000;
    for (const r of runs) {
      if (live(r)) {
        attention += open.filter((c) => c.run === r.id).length;
        const w = waitOf(r, open);
        if (w.kind === "queue") { held++; mini.push(""); }
        else if (w.kind === "captain" || w.kind === "hold") mini.push("human");
        else if (r.status !== "paused") { running++; mini.push("running"); }
        else mini.push("");
      } else if (failedRun(r) && r.endedAt && Date.parse(r.endedAt) >= day && !r.archived) failed24h++;
    }
    // mini: one pipe segment per active Task (human, running, or empty for held and paused), for the projects index
    return { attention, running, held, failed24h, mini: [...mini.filter((x) => x === "human"), ...mini.filter((x) => x === "running"), ...mini.filter((x) => !x)].slice(0, 12) };
  }
  /**
   * Can tasks start here: the staffing check itself (Projects.staffingAssess, the same steps dispatch runs), as data.
   * `own` checks the project's own registration also when it is disabled (display only), for "Folder missing".
   */
  /** the project's GitHub grant is the captain's signed one for it (github-grant.ts) */
  const grantOk = (p: Project) => grantProblem(p) === null;
  /** why the project's GitHub grant does not verify, in fixed words (never exception text or a path); null when it verifies */
  function grantProblem(p: Project): { en: string; tw: string } | null {
    if (!p.github) return { en: "not connected", tw: "尚未連線" };
    try { verifyGitHubGrant(d.dataDir, p); return null; } catch (e: any) {
      const m = String(e?.message ?? "");
      if (/not signed by this Studio/.test(m)) return { en: "grant not signed by this Studio", tw: "授權不是這個 Studio 簽的" };
      if (/local repository is unavailable|names no local repository/.test(m)) return { en: "local repository unavailable", tw: "本機儲存庫無法使用" };
      if (/another local repository/.test(m)) return { en: "grant names another folder", tw: "授權指向別的資料夾" };
      if (/\bbase\b/.test(m)) return { en: "base branch changed", tw: "主 branch 變了" };
      if (/origin|Git config|Git directory/.test(m)) return { en: "repository origin does not match", tw: "儲存庫 origin 不符" };
      return { en: "grant does not verify", tw: "授權驗證不過" };
    }
  }
  function startState(p: Project) {
    const roots = d.protectedRoots ?? [];
    // an external project whose GitHub grant does not verify is never put through the staffing check here (it cannot dispatch)
    if (kindOf(p) === "external" && !grantOk(p)) return { real: null, folderMissing: false, folderUnusable: false, canStart: false };
    let real: ReturnType<Projects["staffingAssess"]> | null = null, own: ReturnType<Projects["staffingAssess"]> | null = null;
    try { real = d.projects.staffingAssess(p.id, roots); } catch {}
    try { own = d.projects.staffingAssess(p.id, roots, { includeDisabled: true }); } catch {}
    const ownReason = own && !own.ok && own.record === p.id ? own.reason : null;
    const folderMissing = ownReason === "folder_missing", folderUnusable = ownReason === "folder_unusable";
    const canStart = enabledOf(p) && !!real?.ok;
    return { real, folderMissing, folderUnusable, canStart };
  }
  /** fixed words per refusal reason, naming the registration (never a path, never exception text) */
  function refusalText(a: { reason: StaffingRefusal; record: string; aliases: string[] }): { en: string; tw: string } {
    const id = a.record || "?", al = a.aliases.join(", ");
    switch (a.reason) {
      case "folder_missing": return { en: `Registration ${id}: its folder does not exist.`, tw: `登錄的專案 ${id}：資料夾不存在。` };
      case "folder_unusable": return { en: `Registration ${id}: its folder cannot be used (not a folder, or not readable).`, tw: `登錄的專案 ${id}：資料夾無法使用（不是資料夾，或無法讀取）。` };
      case "git_invalid": return { en: `Registration ${id}: its Git data is missing or malformed.`, tw: `登錄的專案 ${id}：Git 資料不見了或格式不正確。` };
      case "git_escapes_container": return { en: `Registration ${id}: its Git data points outside its folder.`, tw: `登錄的專案 ${id}：Git 資料指向資料夾以外。` };
      case "private_overlap": return { en: `Registration ${id}: its folder is inside, or holds, Studio's private data.`, tw: `登錄的專案 ${id}：資料夾位於 Studio 的私有資料裡，或包含它。` };
      case "ambiguous_alias": return { en: `Registrations ${id} and ${al || "another"} point to the same repository.`, tw: `登錄的專案 ${id} 與 ${al || "另一個專案"} 指向同一個儲存庫。` };
      case "base_invalid": return { en: `Registration ${id}: its base branch name is invalid.`, tw: `登錄的專案 ${id}：主 branch 名稱無效。` };
      case "base_missing": return { en: `Registration ${id}: its base branch is missing.`, tw: `登錄的專案 ${id}：找不到主 branch。` };
      case "external_unverified": return { en: `Registration ${id}: its GitHub grant does not verify (connect it to GitHub again).`, tw: `登錄的專案 ${id}：它的 GitHub 授權驗證不過（請重新連到 GitHub）。` };
      case "registry_unreadable": return { en: "The project registry cannot be read.", tw: "無法讀取專案登錄資料。" };
      default: return { en: `Registration ${id}: the staffing check refused it.`, tw: `登錄的專案 ${id}：派工檢查未通過。` };
    }
  }
  function statusLine(kind: string, enabled: boolean, c: ReturnType<typeof counts>, folderMissing = false, canStart = true, p?: Project): Line {
    if (!enabled) return { tone: "", en: "Disabled", tw: "已停用" };
    if (kind === "external") {
      // a connected project names its repository and what it is doing; only a grant that fails warns, and says why
      const why = p ? grantProblem(p) : { en: "grant does not verify", tw: "授權驗證不過" };
      if (why || !p?.github) return { tone: "warn", en: `GitHub: ${why?.en}`, tw: `GitHub：${why?.tw}` };
      const gh = `GitHub · ${p.github.repository} · `;
      if (!canStart) return { tone: "warn", en: gh + "no task can start", tw: gh + "無法開始任務" };
      if (c.attention) return { tone: "human", en: gh + "waiting for you", tw: gh + "等你處理" };
      if (c.running) return { tone: "run", en: gh + `${c.running} running`, tw: gh + `${c.running} 進行中` };
      if (c.held) return { tone: "warn", en: gh + `${c.held} held`, tw: gh + `${c.held} 暫緩` };
      return { tone: "", en: gh + "idle", tw: gh + "閒置" };
    }
    if (folderMissing) return { tone: "warn", en: "Folder missing", tw: "資料夾不存在" };
    if (!canStart && kind !== STUDIO) return { tone: "warn", en: "No task can start", tw: "無法開始任何任務" };
    if (c.failed24h) return { tone: "bad", en: `${c.failed24h} failed in the last 24 h`, tw: `近 24 小時 ${c.failed24h} 個失敗` };
    const en: string[] = [], tw: string[] = [];
    if (c.running) { en.push(`${c.running} running`); tw.push(`${c.running} 進行中`); }
    if (c.held) { en.push(`${c.held} held`); tw.push(`${c.held} 暫緩`); }
    const prefix = kind === STUDIO ? { en: "No project · ", tw: "無專案 · " } : kind === "builtin" ? { en: "Built-in · ", tw: "內建 · " } : { en: "", tw: "" };
    const tone: Line["tone"] = c.attention ? "human" : c.running ? "run" : c.held ? "warn" : "";
    if (en.length) return { tone, en: prefix.en + en.join(" · "), tw: prefix.tw + tw.join(" · ") };
    if (c.attention) return { tone: "human", en: prefix.en + "Waiting for you", tw: prefix.tw + "等你處理" };
    if (kind === STUDIO) return { tone: "", en: "No project · idle", tw: "無專案 · 閒置" };
    if (kind === "builtin") return { tone: "", en: "Built-in · idle", tw: "內建 · 閒置" };
    return { tone: "", en: "Idle", tw: "閒置" };
  }

  function sidebar() {
    const open = E.cards.list({ open: true });
    const by = grouped();
    let error: { en: string; tw: string } | null = null, list: Project[] = [];
    try { list = records(); } catch { error = { en: "Registry unreadable", tw: "無法讀取登錄資料" }; }
    const rows = list.map((p) => {
      const kind = kindOf(p), enabled = enabledOf(p), c = counts(by.get(p.id) ?? [], open), st = startState(p);
      return { id: p.id, name: p.name || p.id, enabled, kind, ...(kind === "external" ? { connected: grantOk(p) } : {}), folderMissing: st.folderMissing, canStart: st.canStart, ...c, status: statusLine(kind, enabled, c, st.folderMissing, st.canStart, p) };
    });
    const rank = (r: (typeof rows)[number]) => (r.kind === "builtin" ? 3 : r.attention ? 0 : r.running ? 1 : 2);
    rows.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    const sc = counts(by.get(STUDIO) ?? [], open);
    const studio = { id: STUDIO, name: "Studio", enabled: true, kind: STUDIO, ...sc, status: statusLine(STUDIO, true, sc) };
    return { projects: [...rows, studio], ...(error ? { error } : {}) };
  }

  // ---------- one project's page ----------
  // a section that cannot be read says so in fixed words: no exception text and no path ever reaches a reply (or a phone)
  const section = <T>(f: () => T): T | { error: "unreadable" } => { try { return f(); } catch { return { error: "unreadable" }; } };
  function pipeOf(r: Run): string[] {
    const out: string[] = [];
    for (const n of r.def?.nodes ?? []) {
      if (!["agent", "check", "card"].includes(n.kind)) continue;
      const rn = r.nodes?.[n.id]; const st = rn?.state;
      out.push(st === "passed" ? "done" : st === "failed" || st === "error" ? "failed" : st === "running" ? (rn?.waiting === "card" ? "human" : "running") : "");
      if (out.length >= 12) break;
    }
    return out;
  }
  function taskRow(r: Run, open: any[]) {
    const w = waitOf(r, open);
    const rounds = roundsOf(r).filter((x) => x.actor.kind === "agent");
    return { id: r.id, title: r.title ?? "", workflow: r.workflow, version: r.version ?? null, status: r.status, result: r.result ?? null, merged: !!r.ctx?.merged,
      node: w.node, nodeLabel: w.nodeLabel, door: r.ctx?.door?.door ?? null, rounds: new Set(rounds.map((x) => x.number)).size,
      pipe: pipeOf(r), href: `#/run/${r.id}`, createdAt: r.createdAt ?? null, updatedAt: r.updatedAt ?? null, waitsOn: w };
  }
  function cardRow(c: any) {
    return { id: c.id, run: c.run, node: c.node, kind: c.kind, title: { en: c.title?.en ?? "", tw: c.title?.["zh-TW"] ?? c.title?.en ?? "" }, runTitle: c.runTitle ?? "",
      captainOnly: !!c.captainOnly, door: c.door ?? null, href: `#/run/${encodeURIComponent(c.run)}?card=${encodeURIComponent(c.id)}` };
  }
  function registeredAt(id: string): string | null {
    for (const r of E.list()) {
      if (r.workflow !== "firstmate-register-project") continue;
      try { const e = E.ledger(r.id).filter((x) => x.record === "firstmate-project-registered" && x.data?.project === id).at(-1); if (e?.at) return e.at; } catch {}
    }
    return null;
  }
  function crewOf(p: Project, st: ReturnType<typeof startState>) {
    if ((kindOf(p) === "external" && !grantOk(p)) || !enabledOf(p) || !p.path) return null;
    // the staffing check refused: no task can start here, and the reply says which registration and why
    if (!st.real) return { error: "refused" as const, detail: { en: "The staffing check could not run.", tw: "無法執行派工檢查。" } };
    if (!st.real.ok) return { error: "refused" as const, record: st.real.record, detail: refusalText(st.real) };
    const store = new StaffingStore(d.dataDir), identity = st.real.identity;
    if (!existsSync(join(d.dataDir, "projects", store.key(identity), "staffing", "current.json"))) return null;
    const c = store.current(identity);
    const card = E.cards.get(c.approval.card);
    return { workflow: c.workflow.id, version: c.workflow.version, config: c.version, approvedAt: card?.answer?.at ?? null, signed: true,
      roles: Object.entries(c.roles).map(([role, x]) => ({ role, provider: x.provider, model: x.model, effort: x.effort, skill: x.skill.ref.split("+").map((p) => basename(p)).join(" + ") })) };
  }
  function health(p: Project, crew: ReturnType<typeof crewOf> | { error: string }, st: ReturnType<typeof startState>) {
    const kind = kindOf(p), enabled = enabledOf(p);
    const out = [];
    out.push(enabled && st.folderMissing ? tile("enabled", "warn", "Folder missing", "資料夾不存在", { en: "The registered folder does not exist. Studio skips this registration; no task can start here.", tw: "登錄的資料夾不存在。Studio 會略過這個登錄；這裡無法開始任何任務。" })
      : enabled && st.canStart ? tile("enabled", "ok", "Enabled", "已啟用", { en: "New tasks can start", tw: "可以開始新任務" })
      : enabled ? tile("enabled", "warn", "Enabled", "已啟用", kind === "external" ? { en: "No task can start (see Registered)", tw: "無法開始任何任務（見「已註冊」）" } : { en: "No task can start (see Crew)", tw: "無法開始任何任務（見「船員」）" })
      : tile("enabled", "bad", "Disabled", "已停用", { en: "New tasks and rounds will not start.", tw: "不會開始新任務或新的一輪。" }));
    out.push(kind === "external" && grantOk(p) ? tile("registered", "ok", "Connected to GitHub", "已連到 GitHub", { en: `${p.github!.repository}: Task branches are pushed and pull requests opened after your approval`, tw: `${p.github!.repository}：任務分支推送與開 pull request 都要你核准` })
      : kind === "external" ? tile("registered", "warn", "External project: cannot dispatch yet", "外部專案：暫時無法派工", { en: `Its GitHub grant does not verify: ${grantProblem(p)?.en}. Connect it to GitHub again.`, tw: `它的 GitHub 授權驗證不過：${grantProblem(p)?.tw}。請重新連到 GitHub。` })
      : kind === "builtin" ? tile("registered", "ok", "Built-in", "內建", { en: "Studio's own practice repository", tw: "Studio 內建的練習用儲存庫" })
      : tile("registered", "ok", "Registered", "已註冊", { en: "Local repository", tw: "本機儲存庫" }));
    const b = readBaseRef(p.path, p.base);
    out.push(!p.path ? tile("base", "bad", "No repository path", "沒有儲存庫路徑", null)
      : st.folderMissing ? tile("base", "bad", "Repository folder missing", "儲存庫資料夾不存在", { en: "The registered folder does not exist.", tw: "登錄的資料夾不存在。" })
      : st.folderUnusable ? tile("base", "bad", "Repository folder cannot be used", "儲存庫資料夾無法使用", { en: "The registered folder is not a usable folder, or cannot be read; the base branch was not checked.", tw: "登錄的資料夾不是可用的資料夾，或無法讀取；未檢查主 branch。" })
      : b.found ? tile("base", "ok", "Base branch found", "找到主 branch", { en: `${p.base} · ${short(b.sha)}`, tw: `${p.base} · ${short(b.sha)}` })
      : tile("base", "bad", "Base branch missing", "找不到主 branch", { en: p.base, tw: p.base }));
    if (kind === "external") out.push(tile("crew", "idle", "Crew not checked", "未檢查船員", { en: "External project", tw: "外部專案" }));
    else if (!enabled) out.push(tile("crew", "idle", "Crew not checked", "未檢查船員", { en: "Project disabled", tw: "專案已停用" }));
    else if (crew && "error" in crew && crew.error === "refused") out.push(tile("crew", "warn", "No task can start", "無法開始任何任務", (crew as any).detail));
    else if (crew && "error" in crew) out.push(tile("crew", "warn", "Crew cannot be read", "無法讀取船員配置", { en: "The approved crew could not be read. Nothing was changed.", tw: "無法讀取已核准的船員配置。沒有任何變更。" }));
    else if (crew) out.push(tile("crew", "ok", "Crew approved", "船員已核准", { en: `${crew.workflow} v${crew.version} · config v${crew.config}`, tw: `${crew.workflow} v${crew.version} · 配置 v${crew.config}` }));
    else out.push(tile("crew", "warn", "Crew not approved", "船員未核准", { en: "Tasks here will wait at their first round.", tw: "這裡的任務會停在第一輪。" }));
    const g = readGatesTest(p.path);
    const gd: Record<string, [string, string]> = { missing: ["No .crew/gates.json", "沒有 .crew/gates.json"], "no-test": ["No test command in .crew/gates.json", ".crew/gates.json 沒有測試指令"],
      link: [".crew/gates.json is a link; not read", ".crew/gates.json 是連結，未讀取"], oversized: [".crew/gates.json is too large; not read", ".crew/gates.json 太大，未讀取"], unreadable: [".crew/gates.json cannot be read", "無法讀取 .crew/gates.json"] };
    out.push(g.state === "ok" ? tile("test", "idle", "Test command", "測試指令", { en: "from .crew/gates.json", tw: "來自 .crew/gates.json" }, g.test)
      : tile("test", g.state === "missing" || g.state === "no-test" ? "idle" : "warn", "Test command", "測試指令", { en: gd[g.state][0], tw: gd[g.state][1] }));
    out.push(tile("rules", "idle", "Operating rules", "作業規則", { en: "Not checked yet", tw: "尚未檢查" }));
    out.push(tile("gitconfig", "idle", "Shared git config", "共用 git 設定", { en: "Not checked yet", tw: "尚未檢查" }));
    return out;
  }
  function sensitive(p: Project) {
    // what the classifier uses (Policies.get): an unreadable org or project policy file fails closed, every path one-way
    const unreadable = E.policies.orgUnreadable() ? "org" : E.policies.projectUnreadable(p.id) ? "project" : null;
    const isFailClosed = (r: any) => r?.glob === "**" && /^policy file unreadable/.test(String(r?.why ?? ""));
    // the engine's own policy reader: no Policies is constructed here (its constructor creates the policies folder)
    const cur = unreadable === "project" ? [] : E.policies.project(p.id).sensitive_paths;
    const rules = (Array.isArray(cur) ? cur : []).map((r: any) => ({ glob: String(r?.glob ?? r), why: String(r?.why ?? "") }));
    const base = loadDefaults().base, orgPol = E.policies.get("sensitive_paths").value;
    const extra = (Array.isArray(orgPol) ? orgPol : []).filter((r: any) => !isFailClosed(r)).map((r: any) => ({ glob: String(r?.glob ?? r), why: String(r?.why ?? "org policy") })).filter((r: any) => !base.some((b) => b.glob === r.glob));
    const org = [...base, ...extra].map((r) => ({ glob: r.glob, why: r.why }));
    return { project: rules, proposed: Array.isArray(p.proposed) && p.proposed.length ? p.proposed.map((r) => ({ glob: r.glob, why: r.why })) : null, org, orgCount: org.length,
      unreadable, canPropose: !unreadable,
      message: unreadable ? { en: "Policy file cannot be read: every path is one-way until it is fixed", tw: "政策檔讀不到：修好之前每條路徑都是單向" } : null };
  }
  function outputs(id: string, runs: Run[]) {
    const out: any[] = [];
    for (const r of [...runs].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))) {
      const pr = r.ctx?.pr;
      if (pr && typeof pr === "object" && !r.ctx?.merged) out.push({ kind: "review", task: r.id, title: { en: `Review request ${r.id}`, tw: `審查請求 ${r.id}` },
        sub: { en: `${pr.adapter === "github" ? "GitHub" : "local"} · ${pr.branch ?? ""} → ${pr.base ?? ""}`, tw: `${pr.adapter === "github" ? "GitHub" : "本機"} · ${pr.branch ?? ""} → ${pr.base ?? ""}` },
        href: `#/run/${r.id}`, at: pr.openedAt ?? null });
      const m = r.ctx?.merged;
      if (m && typeof m === "object" && r.def?.kind === "code") out.push({ kind: "merge", task: r.id, title: { en: `${r.id} merged into ${r.ctx?.base ?? "main"}`, tw: `${r.id} 已合併到 ${r.ctx?.base ?? "main"}` },
        sub: { en: [m.adapter === "github" ? "GitHub" : "local", short(m.head ?? m.sha)].filter(Boolean).join(" · "), tw: [m.adapter === "github" ? "GitHub" : "本機", short(m.head ?? m.sha)].filter(Boolean).join(" · ") },
        href: `#/run/${r.id}`, at: m.at ?? null });
    }
    if (d.artifacts) for (const a of d.artifacts.list().filter((x) => x.project === id).slice(0, 60)) {
      const vs = d.artifacts.versions(a.id), v = vs.filter((x: any) => x.status === "approved").at(-1) ?? vs.at(-1) ?? null;
      // an output counts where its Task counts: a coffee artifact named like a registered project stays with Studio
      const from = v?.source?.run ? E.get(v.source.run) : null;
      if (from && E.projectRow(from) !== id) continue;
      const type = a.type === "web" ? "web" : a.type === "image" ? "image" : a.type === "video" || a.type === "film" ? "video" : a.type === "audio" ? "audio" : "doc";
      const web = type === "web" ? websiteHref(a, v) : null;
      const names: Record<string, [string, string]> = { web: ["website", "網站"], image: ["image", "圖片"], video: ["video", "影片"], audio: ["audio", "音訊"], doc: ["document", "文件"] };
      const st = v ? (v.status === "approved" ? [`v${v.n} approved`, `v${v.n} 已驗收`] : [`v${v.n}`, `v${v.n}`]) : ["no version", "沒有版本"];
      const task = v?.source?.run ?? null;
      out.push({ kind: type, task, title: { en: a.title, tw: a.title }, sub: { en: [names[type][0], st[0], task].filter(Boolean).join(" · "), tw: [names[type][1], st[1], task].filter(Boolean).join(" · ") },
        href: web ?? `#/artifact/${encodeURIComponent(a.id)}`, external: !!web, at: v?.createdAt ?? a.created ?? null });
    }
    return out.slice(0, 40);
  }
  function worktreeRows(id: string, open: any[]) {
    return d.worktrees.all().filter((w) => w.project === id && !w.removedAt).map((w) => {
      const r = E.get(w.task); const busy = !!r && live(r) && waitOf(r, open).kind === "agent";
      return { task: w.task, branch: w.branch, path: w.path, busy };
    });
  }
  function page(id: string) {
    const open = E.cards.list({ open: true });
    const runs = grouped().get(id) ?? [];
    const active = runs.filter(live).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    const ids = new Set(active.map((r) => r.id));
    const tasks = section(() => active.map((r) => taskRow(r, open)));
    const cards = section(() => open.filter((c) => ids.has(c.run)).map(cardRow));
    if (id === STUDIO) return { project: { id: STUDIO, name: "Studio", path: null, base: null, kind: STUDIO, enabled: true }, health: [], tasks, cards, crew: null, sensitive: null, outputs: [], worktrees: [] };
    const p = records().find((x) => x.id === id);
    if (!p) return null;
    const kind = kindOf(p);
    const st = startState(p);
    const crew = section(() => crewOf(p, st));
    // the GitHub side: the grant (verified as staffing verifies it), or the origin a Connect card would propose
    const github = section(() => { if (p.github) { try { verifyGitHubGrant(d.dataDir, p); return { connected: true, verified: true, repository: p.github.repository, branchPrefix: p.github.branchPrefix, merge: p.github.operations ? { method: p.github.operations.mergeMethod, approvedAt: p.github.operations.approvedAt } : null }; } catch (e: any) { return { connected: true, verified: false, repository: p.github.repository, error: String(e?.message ?? e) }; } }
      let origin: string | null = null; try { origin = p.path ? githubSlugOf(originOf(p.path).url) : null; } catch {} return { connected: false, verified: false, origin }; });
    return {
      project: { id: p.id, name: p.name || p.id, path: p.path, base: p.base, kind, enabled: enabledOf(p), folderMissing: st.folderMissing, canStart: st.canStart, ...(p.github?.repository ? { repository: p.github.repository } : {}), registeredAt: section(() => registeredAt(p.id)) },
      health: section(() => health(p, crew, st)), tasks, cards, crew, github,
      sensitive: section(() => sensitive(p)), outputs: section(() => outputs(p.id, runs)), worktrees: section(() => worktreeRows(p.id, open)),
    };
  }

  async function handle(req: Request, url: URL, who: Who, writing: boolean): Promise<Response | null> {
    const p = url.pathname;
    if(p==='/api/projects/local-registration'){
      if(req.method!=='POST')return json({error:'use POST'},405);
      if(who.kind!=='desktop')return json({error:'do this on the Mac',code:'desktopOnly'},403);
      if(!hasSession(req,d.session))return json({error:'Studio session required'},401);
      try{
        const text=await req.text();if(text.length>4096)return json({error:'Request too large',tw:'請求過大',code:'invalid_params'},413);
        const args=JSON.parse(text);if(!d.prepareLocalProject)return json({error:'Registration unavailable',tw:'註冊流程無法使用',code:'unavailable'},503);
        return json(await d.prepareLocalProject(args,{key:'projects-page',captain:true,text:'Register a local project only',signal:req.signal,live:()=>!req.signal.aborted}));
      }catch(e:any){const f=e?.publicFailure;return json({error:f?.reason?.en||'Local project could not be prepared.',tw:f?.reason?.['zh-TW']||'無法準備本機專案，請檢查路徑後重試。',code:f?.code||'invalid_params'},409);}
    }
    const connect = /^\/api\/projects\/([A-Za-z0-9][A-Za-z0-9_.-]{0,199})\/github\/connect$/.exec(p);
    if (connect) {
      if (!writing) return json({ error: "use POST" }, 405);
      if (who.kind !== "desktop") return json({ error: "do this on the Mac", code: "desktopOnly" }, 403);
      if (!hasSession(req, d.session)) return json({ error: "Studio session required" }, 401);
      try { const run = startGitHubConnect(d.engine, d.projects, connect[1], "captain (Projects page)"); return json({ ok: true, task: run.id, href: `#/run/${run.id}` }); }
      catch (e: any) { return json({ error: String(e?.message ?? e) }, 409); }
    }
    const merge = /^\/api\/projects\/([A-Za-z0-9][A-Za-z0-9_.-]{0,199})\/github\/merge(\/revoke)?$/.exec(p);
    if (merge) {
      if (!writing) return json({ error: "use POST" }, 405);
      if (who.kind !== "desktop") return json({ error: "do this on the Mac", code: "desktopOnly" }, 403);
      if (!hasSession(req, d.session)) return json({ error: "Studio session required" }, 401);
      try { const run = startMergeGrant(d.engine, d.projects, merge[1], merge[2] ? "revoke" : "grant", "captain (Projects page)"); return json({ ok: true, task: run.id, href: `#/run/${run.id}` }); }
      catch (e: any) { return json({ error: String(e?.message ?? e) }, 409); }
    }
    const m = /^\/api\/projects\/([A-Za-z0-9][A-Za-z0-9_.-]{0,199})\/overview$/.exec(p);
    if (p !== "/api/projects/overview" && !m) return null;
    if (writing) return json({ error: "read only" }, 405);
    if (who.kind === "desktop" && !hasSession(req, d.session)) return json({ error: "Studio session required" }, 401);
    if (who.kind !== "desktop" && who.kind !== "phone") return json({ error: "refused" }, 403);
    if (!m) return json(sidebar());
    let v; try { v = page(m[1]); } catch { return json({ error: "Registry unreadable", tw: "無法讀取登錄資料" }, 503); }
    return v ? json(v) : json({ error: "No such project", tw: "沒有這個專案" }, 404);
  }
  return { handle, sidebar, page };
}
