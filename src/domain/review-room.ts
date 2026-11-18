// The review room (docs/units/review-room.md): one room per change, where the captain reads a skill's page about it (baton by
// default, src/domain/review-explain.ts) and asks the room's tutor about it before answering its merge card. A room has one of
// four subjects, each one room across its heads: a merge card (SC-n), a Task's local branch once Studio's review passed at its
// head (R-n), a GitHub pull request of a connected project read by its URL (PR-<repository hash>-<n>: GitHub is only read, with
// GET, and the head's objects are fetched into a bare repository Studio owns under its data folder), or a GitHub directory read
// at one commit (DIR-…). The room never answers the merge card and never changes merge readiness: the card only shows a summary
// of it (baton's versions and what they cost). The paid runs (a page, a question) are the explainer's, on the room tutor's seat.
// A room from before keeps its whiteboard (turns, scenes, drawings) on disk exactly as it was: Studio reads none of it any more,
// and offers the room's whole record as a file (exportRoom).
//   data/runs/<task>/review-room/<card or R-n>.json        the room: subject, heads seen, the captain's tutor and archive marks
//   data/review-room/pr/<PR-…>.json                         a pull request's room; data/review-room/cache/<hash>.git its objects
//   data/review-room/dir/<DIR-…>.json                       a directory's room, pinned at its commit
//   <room>-explain/                                         the explainer's state, versions and runs (src/domain/review-explain.ts)
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { copyFileSync, mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { ArtifactStore } from "../artifacts";
import { cleanText } from "./issue-triage";
import type { GitHubPrAdapter } from "../adapters/github";
import type { Projects } from "../doors";
import { git, gitArgv, gitEnv, must } from "../git";
import { helper, normPath } from "../review-read";
import { localUnrestricted } from "../local-execution";
import type { Engine, AgentPick } from "../runtime/engine";
import type { SCard } from "../runtime/cards";
import { PROVIDERS as CREW_PROVIDERS } from "./crew";
import { bestOf, defaultEffort, degradedWhy, levelAgainst, required, LEVEL_TEXT, type Level, type Usable } from "./independence";
import { installExplainer } from "./review-explain";
import { OperatingRules, jobInstructions } from "../operating-rules";
export function parseDirUrl(u: unknown): { repository: string; rest: string[] } | null {
  const m = /^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})(?:\/tree\/([^?#\s]{1,600}))?\/?$/.exec(String(u ?? "").trim());
  if (!m || m[2] === "." || m[2] === ".." || m[2].endsWith(".git")) return null;
  let rest: string[] = []; if (m[3]) { try { rest = m[3].replace(/\/+$/, "").split("/").map((x) => decodeURIComponent(x)); } catch { return null; } }
  if (rest.some((x) => !x || x === "." || x === ".." || /[\x00-\x1f\x7f\\:]/.test(x) || x.length > 200)) return null;
  return { repository: `${m[1]}/${m[2]}`, rest };
}
export const dirRoomId = (repository: string, ref: string, path: string) => `DIR-${sha(repository.toLowerCase()).slice(0, 12)}-${sha(`${ref}\0${path}`).slice(0, 12)}`;
export type Subject = { kind: "merge" | "branch" | "pr" | "dir"; room: string; task?: string | null; branch?: string | null; url?: string | null; repository?: string; number?: number; project?: string | null; ref?: string; path?: string };
/** a GitHub directory as Studio read it, pinned at one commit (the ref named in its address, resolved once; the room never moves) */
type DirSnap = { repository: string; ref: string; refKind: "branch" | "tag" | "commit" | "default"; sha: string; path: string; private: boolean; files: number; bytes: number;
  parts: { name: string; kind: "dir" | "file"; files: number; bytes: number }[]; readme: string | null; fetchedAt: string; truncated: boolean };
type Note = { id: string; kind: "review" | "inline" | "comment"; author: string; body: string; at: string | null; url: string | null; state?: string; commit?: string | null; path?: string | null; line?: number | null; outdated?: boolean };
/** a pull request as Studio last read it on GitHub (GET only); every text in it is untrusted, cleaned and fenced */
type PrSnap = { title: string; body: string; state: "open" | "closed"; merged: boolean; mergedAt: string | null; closedAt: string | null; draft: boolean; author: string; headRef: string; headRepo: string; baseRef: string;
  head: string; base: string; files: { path: string; status: string; added: number; removed: number }[]; notes: Note[]; checkedAt: string; truncated: boolean;
  /** GitHub showed a newer head whose commits Studio could not fetch: the room keeps reading the last head it has, and takes no paid turn until a check fetches it */
  stale?: { head: string; error: string; at: string } | null;
  /** the last read attempt, successful or not (re-entry reads again at most once a minute from it) */
  attemptedAt?: string };
/** A room as kept. turns, board, sources and check are a room's old whiteboard, kept as they were and never read by Studio any
 *  more (exportRoom offers them as a file); a room made now has them empty. */
export type Room = { schema: 1; run: string; card: string; node: string; head: string; base: string; turns: any[]; board: any[]; sources: any[]; check: { questions: any[] };
  subject?: Subject;
  /** the head the captain last looked at: when the subject's head moved past it, the next turn opens with what changed */
  seen?: { head: string; at: string };
  /** every head this room has seen, in order */
  heads?: { head: string; base: string; at: string }[];
  pr?: PrSnap;
  /** a directory room: the directory, pinned at its commit */
  dir?: DirSnap;
  /** the host Task Studio made for a pull request no Task made (workflow review-room-host), on its first paid turn */
  host?: string;
  /** the room's Library artifact (a version per save: its pages) */
  library?: { artifact: string; versions: { n: number; at: string; reason: string }[]; rev: number; ended?: boolean; sig?: string };
  /** the room finished (its merge card answered, its pull request merged or closed), recorded at that moment: only such a room is
   *  saved to the Library by Studio, once (tried: a failed save is not retried by itself; the captain's Save to Library still works) */
  finished?: { at: string; reason: string; tried?: boolean; error?: string | null };
  /** bumped on every save */
  rev?: number;
  /** the tutor the captain picked for this room (over Studio's default, src … settings().tutor); absent: the default */
  tutor?: { provider: string; model: string; by: string; at: string };
  /** the captain put this room in 封存 (only ever by hand: a merge does not); start-over keeps it, restoring clears it. Not a Task's
   *  archive (a room may have no Task yet, and shares one with other rooms) and not start-over's .archive folder */
  archived?: { by: string; at: string };
  /** when the captain last opened the room with a page there: a later page waits for them (zoneFacts) */
  read?: string;
  /** an old room's whiteboard fields (shown, opening, translations, lesson, autoTeach, images, …): kept on disk, never read */
  [old: string]: any };
export type ReviewRoom = ReturnType<typeof installReviewRoom>;
/** the room list's zones, in the order they show */
export const ROOM_ZONES = ["waiting", "reviewing", "concluded", "archived"] as const;
export type RoomZone = (typeof ROOM_ZONES)[number];
/** what a room's zone is decided from. A later signal (a deployment, say) is one more fact here and one more rule below */
export type ZoneFacts = { archived: boolean; running: boolean; concluded: boolean; waiting: boolean };
/** the first rule that holds names the zone */
const ZONE_RULES: [RoomZone, (f: ZoneFacts) => boolean][] = [["archived", (f) => f.archived], ["reviewing", (f) => f.running], ["concluded", (f) => f.concluded], ["waiting", (f) => f.waiting], ["reviewing", () => true]];
export const roomZone = (f: ZoneFacts): RoomZone => ZONE_RULES.find(([, holds]) => holds(f))![0];
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const SHA = /^[a-f0-9]{40}$/;
/** the pull request reads a check makes at most (pages of 100 per list) and how big its cached objects may grow */
const PR_PAGES = 3, PR_CACHE_BYTES = () => (Number(process.env.CREW_REVIEW_PR_CACHE_MB) > 0 ? Number(process.env.CREW_REVIEW_PR_CACHE_MB) : 1024) * 1024 ** 2, PR_FETCH_MS = 120_000, PR_RECHECK_MS = 60_000,
  /** a paid run on a pull request read longer ago than this reads it again first (a merged or closed one then refuses the run) */
  PR_FRESH_MS = () => (process.env.CREW_REVIEW_PR_FRESH_MS !== undefined && Number(process.env.CREW_REVIEW_PR_FRESH_MS) >= 0 ? Number(process.env.CREW_REVIEW_PR_FRESH_MS) : 5 * 60_000);
const refuse = (message: string, code: string, extra: Record<string, any> = {}) => Object.assign(new Error(message), { code, ...extra });
export const TUTOR_SEAT = "review-room-tutor", TUTOR_ROLE = "reviewer";
/** a pull request's address, exactly https://github.com/<owner>/<repo>/pull/<n>: no other host, path, query or fragment */
export function parsePrUrl(u: unknown): { repository: string; n: number; url: string } | null {
  const m = /^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})\/pull\/([1-9]\d{0,8})\/?$/.exec(String(u ?? "").trim());
  if (!m || m[2] === "." || m[2] === "..") return null; const repository = `${m[1]}/${m[2]}`;
  return { repository, n: Number(m[3]), url: `https://github.com/${repository}/pull/${m[3]}` };
}
/** a room's id: a merge card, a Task (its reviewed branch), or a pull request by its repository and number */
export const ROOM_ID = /^(SC-\d+|R-\d+|PR-[0-9a-f]{12}-[1-9]\d{0,8}|DIR-[0-9a-f]{12}-[0-9a-f]{12})$/;
export const prRoomId = (repository: string, n: number) => `PR-${sha(repository.toLowerCase()).slice(0, 12)}-${n}`;
const glyph = (t: unknown) => String(t ?? "").replace(/</g, "‹").replace(/>/g, "›");
const untrusted = (t: unknown, max: number) => glyph(cleanText(t, max));
const login = (u: any) => { const l = String(u?.login ?? ""); return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(\[bot\])?$/.test(l) ? l : "someone"; };
const ghUrl = (u: unknown, repository: string) => { const t = String(u ?? ""); return t.toLowerCase().startsWith(`https://github.com/${repository.toLowerCase()}/`) && !/[\s"<>]/.test(t) ? t.slice(0, 300) : null; };
export function installReviewRoom(engine: Engine, o: { dataDir: string;
  /** the registered projects (a pull request is read only for a project connected to GitHub with that repository) */
  projects?: Projects;
  /** the GitHub adapter of a connected project (production: its grant's adapter, verified; tests: the simulator's) */
  github?: (project: any) => GitHubPrAdapter | null;
  /** the Library (src/artifacts.ts): where a room's read-only snapshot is kept; production passes Studio's own store */
  artifacts?: ArtifactStore;
  /** where a directory room's repository is fetched from (tests: a local bare repository; production: https://github.com/<repo>.git) */
  dirRemote?: (repository: string) => string;
  /** the captain's GitHub token for a private repository's directory (production: `gh auth token`; tests stub it) */
  ghToken?: () => string | null }) {
  const live = new Map<string, number>();
  /** the rooms reading their repository's cache now (a host being made, a run going): an over-cap cache is not removed under them */
  const busyRooms = (): string[] => [...live.keys(), ...(explainer?.runningRooms?.() ?? [])];
  /** The tutor's seat: the reviewer's member (its own read-only role and skill), on a different model from the maker. */
  const reviewNode = (run: any) => run.def.nodes.find((n: any) => n.kind === "agent" && (n.mode === "review" || n.role === "reviewer"));
  const prDir = join(o.dataDir, "review-room", "pr"), cacheDir = (repository: string) => join(o.dataDir, "review-room", "cache", `${sha(repository.toLowerCase()).slice(0, 16)}.git`);
  // ---------- the room's key: its id, where it is kept, whose Task hosts its turns, and whether it still takes them ----------
  type Key = { id: string; kind: Subject["kind"]; run: string | null; node: string | null; file: string; dir: string; stat: string; open: () => boolean; card?: SCard };
  const inRun = (run: string, id: string) => ({ file: join(engine.rdir(run), "review-room", `${id.replace(/[^\w-]/g, "")}.json`), dir: join(engine.rdir(run), "review-room", `${id.replace(/[^\w-]/g, "")}-images`) });
  /** a review-room-host Task: hosts a pull request's turns when no Task made it; its tutor is the project's crew reviewer */
  const HOST_WORKFLOW = "review-room-host", HOST_NODE = "review-room", isHostRun = (run: any) => run?.def?.kind === HOST_WORKFLOW;
  /** the Task that published a pull request (its reviewer seat hosts the room's turns), the newest one */
  const hostOf = (url: string) => engine.list().filter((r: any) => r.ctx?.pr?.adapter === "github" && String(r.ctx.pr.url ?? "").toLowerCase() === url.toLowerCase() && reviewNode(r)).sort((a: any, b: any) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""))).at(0) ?? null;
  const prFile = (id: string) => join(prDir, `${id}.json`);
  /** a directory room (DIR-…): its file, its commits' cache (one per repository), and the host Task Studio makes on its first paid
   *  turn (workflow review-room-dir-host: one node an auxiliary owner holds; it runs no agent, writes nothing and has no crew: the
   *  tutor runs on the model the captain picked or Studio's Automatic pick, confirmed per turn) */
  const dirDir = join(o.dataDir, "review-room", "dir"), dirFile = (id: string) => join(dirDir, `${id}.json`), dirCache = (repository: string) => join(o.dataDir, "review-room", "cache", `dir-${sha(repository.toLowerCase()).slice(0, 16)}.git`);
  const DIR_HOST_WORKFLOW = "review-room-dir-host", isDirHostRun = (run: any) => run?.def?.kind === DIR_HOST_WORKFLOW;
  const dirHostInto = (k: Key, room: Room | null) => { const made = room?.host ? engine.get(room.host) : null, host = made && isDirHostRun(made) && made.params?.dir === room?.subject?.url ? made : null;
    k.run = host?.id ?? null; k.node = host ? HOST_NODE : null; return host; };
  /** a pull request room's host: the Task that published it, else the host Task Studio made for it on its first paid turn */
  const hostInto = (k: Key, room: Room | null) => { const url = room?.subject?.url, made = room?.host ? engine.get(room.host) : null;
    const host = (url ? hostOf(url) : null) ?? (made && isHostRun(made) && made.params?.pr === url ? made : null);
    k.run = host?.id ?? null; k.node = host ? (isHostRun(host) ? HOST_NODE : reviewNode(host).id) : null; return host; };
  const keyOf = (id: string): Key => {
    if (!ROOM_ID.test(id)) throw refuse("No such review room", "not_found");
    if (id.startsWith("SC-")) { const c = cardOf(id); if (c.kind !== "merge") throw refuse("A review room belongs to a merge card / 審查室只屬於合併卡", "not_merge");
      return { id, kind: "merge", run: c.run, node: c.node, ...inRun(c.run, id), stat: c.run, open: () => engine.cards.get(id)?.status === "open", card: c }; }
    if (id.startsWith("R-")) { const run = engine.get(id); if (!run) throw refuse("No such Task", "not_found"); const n = reviewNode(run); if (!n) throw refuse("This Task has no reviewed code branch / 這個任務沒有經過審查的程式分支", "no_change");
      return { id, kind: "branch", run: id, node: n.id, ...inRun(id, id), stat: `branch:${id}`, open: () => !!engine.get(id) }; }
    if (id.startsWith("DIR-")) { const f = dirFile(id); if (!existsSync(f)) throw refuse("Paste the directory's GitHub address to open its room / 請貼上目錄的 GitHub 網址來開啟審查室", "not_found");
      const k: Key = { id, kind: "dir", run: null, node: null, file: f, dir: join(dirDir, `${id}-images`), stat: `dir:${id}`, open: () => !!load(k)?.dir?.sha };
      dirHostInto(k, load(k)); return k; }
    const f = prFile(id); if (!existsSync(f)) throw refuse("Paste the pull request's URL to open its room / 請貼上 pull request 的網址來開啟審查室", "not_found");
    const k: Key = { id, kind: "pr", run: null, node: null, file: f, dir: join(prDir, `${id}-images`), stat: `pr:${id}`, open: () => load(k)?.pr?.state === "open" };
    hostInto(k, load(k)); return k;
  };
  // one object per room in memory: a turn's tools and a background illustration change the same room, never two copies
  const cache = new Map<string, Room>();
  // read from disk only once per process: an illustration still pending there had its job in a Studio that stopped
  const load = (k: Key): Room | null => { const had = cache.get(k.file); if (had) return had; try { const r: Room = JSON.parse(readFileSync(k.file, "utf8"));
    cache.set(k.file, r); return r; } catch { return null; } };
  /** the review room's own settings (Studio-wide): autoTeach, a room's full analysis (its lesson) starting by itself when the
   *  captain opens the room, by any route, or pastes its pull request (default on) */
  const settingsFile = () => join(o.dataDir, "review-room-settings.json");
  /** the review room's Studio-wide tutor (tutor: {provider, model}, picked by the captain; null: Automatic, Studio picks the
   *  most independent model it can run, as before) */
  const settings = (): { autoTeach: boolean; tutor: { provider: string; model: string } | null } => { try { const j = JSON.parse(readFileSync(settingsFile(), "utf8"));
    const t = j?.tutor && typeof j.tutor.provider === "string" && typeof j.tutor.model === "string" ? { provider: j.tutor.provider, model: j.tutor.model } : null;
    return { autoTeach: j?.autoTeach !== false, tutor: t }; } catch { return { autoTeach: true, tutor: null }; } };
  /** rooms started over: their old object (held by a background job: a picture, a Library save) is never written back */
  const startedOver = new WeakSet<Room>(), resetGen = new Map<string, number>();
  const save = (k: Key, r: Room) => { if (startedOver.has(r)) return; r.rev = (r.rev ?? 0) + 1; cache.set(k.file, r); mkdirSync(join(k.file, ".."), { recursive: true }); writeFileSync(k.file + ".tmp", JSON.stringify(r)); renameSync(k.file + ".tmp", k.file); };
  const cardOf = (id: string) => { const c = engine.cards.get(id); if (!c) throw refuse("No such card", "not_found"); return c; };
  /** dir: a directory room's directory (its path, and its files, the room's "changed files": what a citation may name) */
  type S = { key: Key; run: any; wt: string; head: string; base: string; node: any; dir?: { path: string; files: string[] } };
  const dirFilesMemo = new Map<string, string[]>();
  /** the files under a directory at its pinned commit (at most 5000), read once per commit and path */
  const dirFiles = (wt: string, at: string, path: string) => { const key = `${wt}\0${at}\0${path}`, had = dirFilesMemo.get(key); if (had) return had;
    const r = git(wt, ["ls-tree", "-r", "--name-only", "-z", at, "--", ...(path ? [path] : [])]), files = r.ok ? r.out.split("\0").filter(Boolean).slice(0, 5000) : [];
    if (dirFilesMemo.size > 50) dirFilesMemo.clear(); dirFilesMemo.set(key, files); return files; };
  /** the room's subject: where its git objects are read (the worktree, the repository once it is cleaned, or the pull
   *  request's cache), its head and base, and the Task and node that host its turns (none for a pull request no Task published) */
  const subjectOf = (k: Key): S => {
    if (k.kind === "dir") {
      const room = load(k); if (!room?.dir?.sha) throw refuse("This directory has not been read yet", "no_change");
      const wt = dirCache(room.dir.repository); if (!existsSync(wt) || !git(wt, ["cat-file", "-e", `${room.dir.sha}^{commit}`]).ok) throw refuse("The directory's commit is not in Studio's copy: paste its address again to read it", "no_change");
      const run = k.run ? engine.get(k.run) : null;
      return { key: k, run, wt, head: room.dir.sha, base: room.dir.sha, node: run ? run.def.nodes.find((n: any) => n.id === k.node) : null, dir: { path: room.dir.path, files: dirFiles(wt, room.dir.sha, room.dir.path) } };
    }
    if (k.kind === "pr") {
      const room = load(k); if (!room?.pr) throw refuse("This pull request has not been read yet", "no_change");
      const wt = cacheDir(room.subject!.repository!); if (!existsSync(wt) || !git(wt, ["cat-file", "-e", `${room.pr.head}^{commit}`]).ok || !git(wt, ["cat-file", "-e", `${room.pr.base}^{commit}`]).ok) throw refuse("The pull request's commits are not in Studio's copy: check for new commits", "no_change");
      const run = k.run ? engine.get(k.run) : null; return { key: k, run, wt, head: room.pr.head, base: room.pr.base, node: run ? run.def.nodes.find((n: any) => n.id === k.node) : null };
    }
    const run = engine.get(k.run!); if (!run) throw refuse("The card's Task is gone", "not_found");
    // git objects are read from the worktree, or from the repository once the worktree is cleaned (citations still open)
    const tree = run.ctx.worktree as string | undefined, wt = tree && existsSync(tree) ? tree : run.ctx.repo as string | undefined;
    const head = String(k.kind === "branch" ? run.ctx.taintedReady?.head ?? run.ctx.head ?? "" : run.ctx.pr?.head ?? run.ctx.head ?? ""), base = String(run.ctx.baseCommit ?? "");
    if (!wt || !existsSync(wt) || !SHA.test(head) || !SHA.test(base)) throw refuse(k.kind === "merge" ? "This merge card has no local change to review (no worktree, head or base) / 這張合併卡沒有可審查的本地改動" : "This Task has no local change to review (no worktree, head or base) / 這個任務沒有可審查的本地改動", "no_change");
    if (!git(wt, ["cat-file", "-e", `${head}^{commit}`]).ok || !git(wt, ["cat-file", "-e", `${base}^{commit}`]).ok) throw refuse("The head or the base is not in the repository", "no_change");
    const node = run.def.nodes.find((n: any) => n.id === k.node); if (!node) throw refuse("The card's node is gone", "not_found");
    return { key: k, run, wt, head, base, node };
  };
  /** Studio's internal review passed at this head: the Task's signed review verdict (a tainted Task's ready-on-branch end counts once it is on the ledger) */
  const reviewed = (run: any, head: string) => { const t = engine.trusted(run.id); if (!t.ok) return false; const e: any = t.entries.filter((e: any) => e.run === run.id && e.check === "firstmate/review-verdict").at(-1);
    return (e?.verdict === "pass" && e.head === head) || (run.ctx.taintedReady?.head === head && t.entries.some((x: any) => x.record === "tainted-ready" && x.head === head)); };
  const subjectRecord = (k: Key, s: { run: any; head: string; base: string }, room: Room | null): Subject & { head: string; base: string } =>
    k.kind === "pr" || k.kind === "dir" ? { ...(room?.subject ?? { kind: k.kind, room: k.id }), task: s.run?.id ?? null, head: s.head, base: s.base }
    : { kind: k.kind, room: k.id, task: s.run?.id ?? null, branch: s.run?.ctx.branch ?? null, url: s.run?.ctx.pr?.url ?? null, head: s.head, base: s.base };
  type Tutor = { pick: AgentPick; level: Level; adaptive: boolean; outside: boolean; label: { en: string; zh: string }; warning?: { en: string; zh: string } | null;
    /** picked: the captain picked it (a room's, Studio's default, a regeneration); unlisted: not on this machine's model list */
    picked?: boolean; unlisted?: boolean };
  const tutorPick = (run: any, node?: any): Tutor => {
    const review = reviewNode(run);
    if (!review) throw refuse("This workflow has no reviewer seat for the tutor", "no_seat");
    // the approved staffing's reviewer member as admitted on the merge card's node (the node the tutor's rounds belong to)
    const card = node ?? run.def.nodes.find((n: any) => n.kind === "card" && n.args?.card_kind === "merge");
    const pickOf = (n: any, role?: string): AgentPick | null => { try { return (engine.deps.approvedPick?.(run, n, role) as AgentPick | null) || (role ? null : engine.x(run, n, run.nodes[n.id]).pick()); } catch { return null; } };
    const approved0 = (card && pickOf(card, TUTOR_ROLE)) || engine.x(run, review, run.nodes[review.id]).pick();
    // every node that wrote the change (build, fix, rework: the maker's role), as staffed and as it really ran
    const makerRole = run.def.nodes.find((n: any) => n.kind === "agent" && n.mode === "build")?.role ?? "worker";
    const writers = run.def.nodes.filter((n: any) => (n.kind === "agent" || n.kind === "loop") && (n.mode === "build" || n.role === makerRole || n.args?.producer === "build"));
    const makers = [...writers.flatMap((n: any) => { try { return [engine.x(run, n, run.nodes[n.id]).pick()]; } catch { return []; } }),
      ...run.steps.filter((s: any) => writers.some((n: any) => n.id === s.node) && s.provider).map((s: any) => ({ provider: s.provider, model: s.model }))] as AgentPick[];
    // what this machine has (src/domain/independence.ts): runnable now, or held (out of quota, quota unreadable, stale facts)
    const usable = (engine.deps.usableModels?.() ?? null) as Usable[] | null;
    // a member left to the vendor's default model is that vendor's actual default, before anything is judged
    const resolve = (p: AgentPick): AgentPick => p.model || !usable ? p : { ...p, model: usable.find((u) => u.provider === p.provider && u.isDefault)?.model ?? null };
    const approved = resolve(approved0);
    const group = makers.map((m) => resolve(m)).map((m) => ({ provider: m.provider, model: m.model ?? null }));
    const runnable = (p: AgentPick) => !usable ? true : usable.some((u) => u.provider === p.provider && u.model === p.model && u.runnable);
    const free = (p: AgentPick) => !engine.deps.verifyBackoff?.(p);
    const ok = (p: AgentPick) => !!p.model && runnable(p) && free(p) || !usable && p === approved;
    const label = (level: Level, outside: boolean, why = { en: "", zh: "" }) => ({ en: `${LEVEL_TEXT[level].en}.${why.en}${outside ? " Not in this project's crew: Studio chose it from the models this machine can run." : ""}`, zh: `${LEVEL_TEXT[level].zh}。${why.zh}${outside ? "不在這個專案的人員配置裡：是 Studio 從這台機器可用的模型中挑的。" : ""}` });
    const same = (a: AgentPick, b: AgentPick) => a.provider === b.provider && (a.model ?? null) === (b.model ?? null) && (a.effort ?? null) === (b.effort ?? null);
    const done = (pick: AgentPick, level: Level, outside: boolean, why?: { en: string; zh: string }): Tutor => ({ pick, level, adaptive: !same(pick, approved0), outside, label: label(level, outside, why) });
    // 1. the approved reviewer, when it can run and differs from the author at least by model: kept, whatever else is signed in
    const approvedLevel = levelAgainst({ provider: approved.provider, model: approved.model ?? null }, group);
    if (ok(approved) && approvedLevel !== "same") return done(approved, approvedLevel, false);
    // 2. otherwise a member already approved in this project's crew (another role, a node override), then a model this machine
    //    can run outside the crew (a verified Claude model before an unverified one): the most independent one first
    const crew: AgentPick[] = []; for (const n of run.def.nodes) if (n.kind === "agent" || n.kind === "loop") { const p = pickOf(n); if (p) crew.push(resolve(p)); }
    for (const r of run.def.roles ?? []) { const p = card && pickOf(card, r.id); if (p) crew.push(resolve(p)); }
    const inCrew = crew.filter((p, i) => ok(p) && crew.findIndex((q) => same(p, q)) === i && !same(p, approved));
    const verifiedClaude = (usable ?? []).some((u) => u.provider === "claude" && u.verified && u.runnable);
    const outsideOf = (usable ?? []).filter((u) => u.runnable && !(u.provider === "claude" && !u.verified && verifiedClaude) && !crew.some((p) => p.provider === u.provider && p.model === u.model))
      .map((u) => ({ provider: u.provider, model: u.model, effort: defaultEffort(u) } as AgentPick)).filter(free);
    const m = (p: AgentPick) => ({ ...p, model: p.model ?? null });
    const inside = bestOf(inCrew.map(m), group); if (inside && inside.level !== "same") return done(inside.pick as AgentPick, inside.level, false);
    const outside = bestOf(outsideOf.map(m), group); if (outside && outside.level !== "same") return done(outside.pick as AgentPick, outside.level, true);
    // 3. nothing that differs from the author can run now. The author's own model only when this machine has no other model at
    //    all; a vendor that is signed in but held (out of quota, quota unreadable) is waited for, never worked around
    const need = required("model", usable);
    if (need !== "same") { const heldOne = (usable ?? []).find((u) => !u.runnable && levelAgainst({ provider: u.provider, model: u.model }, group) !== "same");
      throw refuse(heldOne ? `The tutor waits: ${heldOne.held ?? "it cannot run now"} (${heldOne.provider} ${heldOne.model}), and every model that can run now is the author's own. Try again later / 導師需等待：${heldOne.provider} ${heldOne.model} 目前無法使用，能用的模型都和作者相同，請稍後再試`
        : "No model that differs from the author can run the tutor now: sign in, or wait for a verification to be retried / 目前沒有和作者不同、且能執行的模型可當導師", "no_tutor"); }
    const why = degradedWhy(usable);
    if (ok(approved)) return done(approved, "same", false, why);
    const fallback = inCrew[0] ?? outsideOf[0];
    if (!fallback) throw refuse("No signed-in model can run the tutor on this machine now: sign in to a vendor, then open the room again / 這台機器目前沒有已登入、可用的模型能當導師：請先登入一個供應商，再打開審查室", "no_tutor");
    return done(fallback, "same", !inCrew.length, why);
  };
  /** every node that wrote the change, as staffed and as it ran (the author the tutor is judged against) */
  const makersOf = (run: any, usable: Usable[] | null): { provider: string; model: string | null }[] => {
    const resolve = (p: AgentPick): AgentPick => p.model || !usable ? p : { ...p, model: usable.find((u) => u.provider === p.provider && u.isDefault)?.model ?? null };
    const makerRole = run.def.nodes.find((n: any) => n.kind === "agent" && n.mode === "build")?.role ?? "worker";
    const writers = run.def.nodes.filter((n: any) => (n.kind === "agent" || n.kind === "loop") && (n.mode === "build" || n.role === makerRole || n.args?.producer === "build"));
    return [...writers.flatMap((n: any) => { try { return [engine.x(run, n, run.nodes[n.id]).pick()]; } catch { return []; } }), ...run.steps.filter((st: any) => writers.some((n: any) => n.id === st.node) && st.provider).map((st: any) => ({ provider: st.provider, model: st.model }))]
      .map((m: AgentPick) => resolve(m)).map((m) => ({ provider: m.provider, model: m.model ?? null }));
  };
  /** the models the captain may pick as a tutor: what this machine has (adaptive staffing's facts), each with how independent it
   *  is from the author. Every one can be picked: one that is held (out of quota, unreadable), not verified yet or in its
   *  verification backoff keeps its reason in held, said next to it as a warning, never a refusal. runnable says whether it
   *  runs now and is verified (what Automatic chooses from). extra: picks the captain made that the list lacks (a model entered
   *  by hand), listed after it with why. */
  const tutorsOf = (run: any, current: { provider: string; model: string | null } | null, extra: { provider: string; model: string }[] = []) => {
    const usable = (engine.deps.usableModels?.() ?? null) as Usable[] | null;
    const group = run && !isHostRun(run) && !isDirHostRun(run) ? makersOf(run, usable) : [];
    const cur = (p: string, m: string | null) => !!current && current.provider === p && (current.model ?? null) === m;
    const listed = (usable ?? []).map((u) => { const backoff = !!engine.deps.verifyBackoff?.({ provider: u.provider, model: u.model } as AgentPick);
      return { provider: u.provider, model: u.model, effort: defaultEffort(u), verified: !!u.verified, listed: true, runnable: !!u.runnable && !!u.verified && !backoff,
        held: !u.runnable ? (u.held ?? "it cannot run now") : !u.verified ? "not verified on this machine yet" : backoff ? "its verification is being retried" : null,
        level: group.length ? levelAgainst({ provider: u.provider, model: u.model }, group) : null, current: cur(u.provider, u.model) }; });
    const more = extra.filter((p, i) => !listed.some((u) => u.provider === p.provider && u.model === p.model) && extra.findIndex((q) => q.provider === p.provider && q.model === p.model) === i)
      .map((p) => ({ provider: p.provider, model: p.model, effort: null, verified: false, listed: false, runnable: false, held: UNLISTED,
        level: group.length ? levelAgainst({ provider: p.provider, model: p.model }, group) : null, current: cur(p.provider, p.model) }));
    return [...listed, ...more];
  };
  /** what a pick that is not on this machine's model list is said to be (entered by hand) */
  const UNLISTED = "not reported on this machine (entered by hand): the vendor decides";
  /** the providers a tutor may be entered by hand for: the ones staffing runs (src/domain/crew.ts), and any this machine lists */
  const tutorProviders = () => [...new Set<string>([...CREW_PROVIDERS, ...(((engine.deps.usableModels?.() ?? null) as Usable[] | null) ?? []).map((u) => u.provider)])];
  /** a tutor's {provider, model} as the captain sent it: any model of a provider Studio runs, the model a free id (no blank, no
   *  control character, not an option); nothing else is refused here. Whether it runs is the vendor's answer, on the turn. */
  const tutorArg = (want: any): { provider: string; model: string } => {
    const provider = typeof want?.provider === "string" ? want.provider.trim() : "", model = typeof want?.model === "string" ? want.model.trim() : "";
    if (!provider || !model || provider.length > 40 || model.length > 120 || /[\u0000-\u001f\u007f\s]/.test(model) || model.startsWith("-")) throw refuse("A tutor is {provider, model}: a provider Studio runs and a model id (at most 120 characters, no spaces) / 導師是 {provider, model}：Studio 能跑的供應商，加上模型代號（最多 120 字元、不含空白）", "bad_request");
    if (!tutorProviders().includes(provider)) throw refuse(`${provider} is not a provider Studio runs: use one of ${tutorProviders().join(", ")} / Studio 不會跑 ${provider}：請用 ${tutorProviders().join("、")} 之一`, "bad_request");
    return { provider, model }; };
  /** a picked tutor as this machine has it now: its effort, its independence from the author (null: no author Studio knows) and,
   *  when it is held, not verified or not listed, what to expect (said in its label; the turn then runs and fails with the
   *  vendor's own error if it cannot run, it is never refused up front nor swapped for another) */
  const tutorFacts = (run: any | null, p: { provider: string; model: string }) => {
    const host = run && !isHostRun(run) && !isDirHostRun(run) ? run : null, u = tutorsOf(host, null, [p]).find((x) => x.provider === p.provider && x.model === p.model)!;
    const warning = u.runnable ? null : !u.listed ? { en: ` Not reported by ${p.provider} on this machine (entered by hand); the vendor decides: Studio passes the id as given, and the turn fails with ${p.provider}'s error if it rejects it.`, zh: `${p.provider} 在這台機器上沒有回報這個模型（手動輸入），由供應商決定：Studio 原樣傳給它，不接受時這一回合會失敗並顯示 ${p.provider} 的錯誤。` }
      : u.held === "not verified on this machine yet" ? { en: " Not verified on this machine yet: Studio verifies it with one bounded request before the paid round, and the turn fails with the reason if it does not pass.", zh: "這台機器還沒驗證：付費回合前 Studio 會先用一次有限請求驗證，沒通過時這一回合會失敗並說明原因。" }
      : { en: ` Held now (${u.held}): the turn may fail with ${p.provider}'s error.`, zh: `目前暫停（${u.held}）：這一回合可能失敗並顯示 ${p.provider} 的錯誤。` };
    return { effort: u.effort ?? null, level: (u.level ?? null) as Level | null, warning, unlisted: !u.listed };
  };
  /** the tutor the captain picked for a regeneration: any model (a listed one or one entered by hand); a held or unlisted one is said */
  const pickedTutor = (run: any, want: any): Tutor => {
    const { provider, model } = tutorArg(want), { effort, level, warning, unlisted } = tutorFacts(run, { provider, model }), w = warning ?? { en: "", zh: "" };
    // no author Studio knows (a pull request no Task made): how independent the pick is cannot be said, and is not claimed
    if (!level) return { pick: { provider, model, effort } as AgentPick, level: null as unknown as Level, adaptive: true, outside: true, warning, picked: true, unlisted, label: { en: `Independence from the author unknown: the change's author is outside Studio. Picked by the captain to explain this again.${w.en}`, zh: `和作者的獨立程度未知：改動的作者不在 Studio 裡。船長選來重講這一題。${w.zh}` } };
    // the author's own model too: how independent it is, is said (the label), never a refusal: the captain picked it
    return { pick: { provider, model, effort } as AgentPick, level, adaptive: true, outside: true, warning, picked: true, unlisted, label: { en: `${LEVEL_TEXT[level].en}. Picked by the captain to explain this again.${w.en}`, zh: `${LEVEL_TEXT[level].zh}。船長選來重講這一題。${w.zh}` } };
  };
  /** the tutor the captain picked: this room's, else Studio's default (settings().tutor), else none (Automatic: seatPick) */
  const choiceOf = (room: Room | null): { provider: string; model: string; source: "room" | "studio" } | null => {
    if (room?.tutor) return { provider: room.tutor.provider, model: room.tutor.model, source: "room" }; const d = settings().tutor; return d ? { ...d, source: "studio" } : null; };
  /** the picked tutor: the turn runs on it whatever this machine says of it now (held, not verified, not listed: said in its
   *  label, and a turn that cannot run fails with the vendor's error; Studio never switches to another tutor by itself). Its
   *  independence from the author is said, never enforced. The approved reviewer picked is the seat's own member; any other
   *  runs as the seat's adaptive member. */
  const chosenTutor = (run: any | null, node: any | null, c: { provider: string; model: string; source: "room" | "studio" }): Tutor => {
    const { effort, level, warning, unlisted } = tutorFacts(run, c), w = warning ?? { en: "", zh: "" };
    let approved: AgentPick | null = null; if (run && node && !isDirHostRun(run)) { try { approved = (engine.deps.approvedPick?.(run, node, TUTOR_ROLE) as AgentPick | null) ?? (isHostRun(run) ? null : engine.x(run, reviewNode(run), run.nodes[reviewNode(run).id]).pick()); } catch {} }
    const own = !!approved && approved.provider === c.provider && (approved.model ?? null) === c.model;
    const by = c.source === "room" ? { en: " Picked by the captain for this room.", zh: "船長為這間審查室選的。" } : { en: " Studio's default tutor, picked by the captain.", zh: "船長選的 Studio 預設導師。" };
    const label = level ? { en: `${LEVEL_TEXT[level].en}.${by.en}${w.en}`, zh: `${LEVEL_TEXT[level].zh}。${by.zh}${w.zh}` } : { en: `Independence from the author unknown: the change's author is outside Studio.${by.en}${w.en}`, zh: `和作者的獨立程度未知：改動的作者不在 Studio 裡。${by.zh}${w.zh}` };
    return { pick: own ? approved! : { provider: c.provider, model: c.model, effort } as AgentPick, level: level as Level, adaptive: !own, outside: !own, warning, picked: true, unlisted, label };
  };
  /** a tutor the captain picks (a room's, or Studio's default): any {provider, model} of a provider Studio runs, listed or entered by hand */
  const pickable = (want: any): { provider: string; model: string } => tutorArg(want);
  /** the room's tutor as the page shows it: every model this machine has (each with why it may not run, how independent it is
   *  from the author, the current one marked; a pick entered by hand listed after them), whose pick it is (this room's,
   *  Studio's default, or Studio's own), and the providers a model may be entered by hand for */
  const tutorView = (k: Key, s: S | null, r: Room | null, open: boolean) => { const c = choiceOf(r), d = settings().tutor;
    let tutors: any[] = []; if (open) { try { const o0: any = offerOf(k); tutors = tutorsOf(s?.run && !isHostRun(s.run) && !isDirHostRun(s.run) ? s.run : null, "error" in o0 ? null : { provider: o0.provider, model: o0.model }, [...(r?.tutor ? [r.tutor] : []), ...(d ? [d] : [])]); } catch {} }
    return { tutors, tutorProviders: open ? tutorProviders() : [], tutorChoice: { room: r?.tutor ? { provider: r.tutor.provider, model: r.tutor.model } : null, studio: d, source: c?.source ?? "auto" } }; };
  /** the tutor a turn of this room runs on: the captain's pick (the room's, else Studio's default), else Studio's own (Automatic) */
  const tutorFor = (k: Key, s: S): Tutor => { const c = choiceOf(load(k)); return c ? chosenTutor(s.run, s.node, c) : k.kind === "dir" ? autoDirTutor() : s.run ? seatPick(s.run, s.node) : crewTutor(crewPick(load(k)?.subject?.project)); };
  /** a directory room's tutor when the captain picked none (Automatic): a model this machine runs now and has verified, the
   *  machine's default first. There is no change and no author: independence does not apply, and is not claimed. */
  const autoDirTutor = (): Tutor => {
    const usable = (engine.deps.usableModels?.() ?? null) as Usable[] | null, list = tutorsOf(null, null).filter((u) => u.runnable);
    const u = list.find((x) => usable?.some((y) => y.provider === x.provider && y.model === x.model && y.isDefault)) ?? list[0];
    if (!u) throw refuse("No model this machine runs now and has verified can be this directory's tutor: sign in, or pick a tutor / 這台機器目前沒有已驗證、能用的模型可當這個目錄的導師：請登入，或選一位導師", "no_tutor");
    return { pick: { provider: u.provider, model: u.model, effort: u.effort ?? null } as AgentPick, level: null as unknown as Level, adaptive: true, outside: true,
      label: { en: "Automatic: Studio picked it from the models this machine runs. A directory has no change and no author, so independence does not apply.", zh: "自動：Studio 從這台機器能跑的模型中挑的。目錄沒有改動也沒有作者，所以不談獨立程度。" } }; };
  /** the seat a turn runs on: the hosting Task's reviewer (tutorPick); on a review-room-host Task, the project's approved crew reviewer */
  const crewTutor = (pick: AgentPick): Tutor => ({ pick, level: null as unknown as Level, adaptive: false, outside: false,
    label: { en: "The project's crew reviewer. The change's author is outside Studio, so its independence is not measured.", zh: "專案船員的審查者。改動的作者不在 Studio 裡，所以不衡量獨立程度。" } });
  const seatPick = (run: any, node: any): Tutor => { if (!isHostRun(run)) return tutorPick(run, node);
    let p: AgentPick | null = null; try { p = engine.deps.approvedPick?.(run, node, TUTOR_ROLE) ?? null; } catch (e: any) { throw refuse(String(e?.message ?? e), e?.code ?? "no_crew"); }
    if (!p) throw refuse("Approve this project's crew first: the tutor runs on its approved reviewer / 請先核准這個專案的船員：導師用它核准的審查者", "no_crew"); return crewTutor(p); };
  /** Read only (an offer, a page read): the project's approved crew reviewer, else what the Studio team would give code-firstmate's
   *  reviewer, derived without writing anything. Nothing is persisted until the captain confirms a turn (hostFor). */
  /** the code workflow whose crew staffs a pull request's tutor: code-firstmate, else the first code workflow with a reviewer role */
  const codeDef = () => engine.defs.get("code-firstmate") ?? engine.defs.list().map((w: any) => engine.defs.get(w.id)).find((d: any) => d?.kind === "code" && d.roles?.some((r: any) => r.id === TUTOR_ROLE)) ?? null;
  const crewPick = (project: string | null | undefined): AgentPick => {
    const none = (why?: string) => refuse(why ?? "Approve this project's crew first: the tutor runs on its approved reviewer / 請先核准這個專案的船員：導師用它核准的審查者", "no_crew");
    let why: string | undefined;
    try { const r = engine.deps.projectReviewer?.(String(project ?? "")); if (r) return { provider: r.provider, model: r.model, effort: r.effort }; } catch (e: any) { why = String(e?.message ?? e); }
    const def = codeDef(), team = def && project ? engine.deps.teamReviewerPreview?.(def, project) : null;
    if (team) return { provider: team.provider, model: team.model, effort: team.effort ?? null };
    throw none(why); };
  const noHost = () => refuse("No Studio Task made this pull request, so no reviewer seat can host a tutor here: the room shows the pull request, its reviewers' comments and what changed, without paid turns / 這個 pull request 不是 Studio 的任務開的，沒有審查座位可以當導師：審查室只顯示 PR、審查者的意見和改了什麼，不能付費提問", "no_host");
  const offerOf = (k: Key, want?: any) => {
    try { const s = subjectOf(k); if ((!s.run || !s.node) && k.kind !== "pr" && k.kind !== "dir") throw noHost();
      if (want && (!s.run || !s.node)) throw noHost();
      if (k.kind === "branch" && !reviewed(s.run, s.head)) throw refuse("Studio's review has not passed at this head yet / Studio 的審查還沒在這個 head 通過", "not_reviewed");
      // a pull request no Task made: the project's crew reviewer, until the first paid turn makes its host Task
      const t = want ? pickedTutor(s.run, want) : tutorFor(k, s), p = t.pick, effort = p.effort ?? null, c = want ? null : choiceOf(load(k));
      return { provider: p.provider, model: p.model ?? null, effort, paid: true, picked: want ? "regenerate" : c?.source ?? "auto", independence: { level: t.level, adaptive: t.adaptive, outside: t.outside, ...t.label }, warning: t.warning ?? null,
        hash: sha(JSON.stringify({ card: k.id, head: s.head, provider: p.provider, model: p.model ?? null, effort, level: t.level, outside: t.outside, ...(want ? { picked: true } : {}),
          // a picked model that turned held, unverified or unreported since the offer is confirmed again, its warning said
          ...(t.warning ? { warning: t.warning.en } : {}) })).slice(0, 16) }; }
    catch (e: any) { return { error: String(e?.message ?? e), code: e?.code ?? null }; }
  };
  // ---------- reading the head through git objects (nothing touches the worktree's files, index or refs) ----------
  const g = async (wt: string, args: string[], max = 4_000_000) => { const b = await helper(gitArgv(args), { cwd: wt, env: gitEnv(), maxBytes: max }); return b === null ? null : b.toString("utf8"); };
  const fileAt = async (wt: string, commit: string, path: string) => { const b = await helper(gitArgv(["show", `${commit}:${path}`]), { cwd: wt, env: gitEnv(), maxBytes: 2_000_000 }); return b === null ? null : b.includes(0) ? Buffer.from("\0") : b; };
  const fresh = (k: Key, s: { run: any; head: string; base: string }): Room => ({ schema: 1, run: s.run?.id ?? "", card: k.id, node: k.node ?? "", head: s.head, base: s.base, turns: [], board: [], sources: [], check: { questions: [] },
    ...(k.kind === "merge" ? {} : { subject: subjectRecord(k, s, null), seen: { head: s.head, at: new Date().toISOString() }, heads: [{ head: s.head, base: s.base, at: new Date().toISOString() }] }) });
  async function ensureHost(k: Key, by: string) {
    const room0 = load(k)!, project = k.kind === "dir" ? null : room0.subject?.project ?? null;
    if (engine.grants.open("sandbox-off", project)) throw refuse(k.kind === "dir" ? "The tutor runs only in the round sandbox: an open sandbox-off grant is in effect; end it first" : "The tutor runs only in the round sandbox: this project has an open sandbox-off grant; end it first", "sandbox");
    if (localUnrestricted()) throw refuse("The tutor runs only in the round sandbox: Studio is in local unrestricted mode (CREW_LOCAL_UNRESTRICTED)", "sandbox");
    if (live.has(k.id)) throw refuse("The room's host is being made: try again in a moment / 審查室的主機正在建立，請稍候再試", "busy");
    const had = room0.host ? engine.get(room0.host) : null; if (had && (k.kind === "dir" ? isDirHostRun(had) : isHostRun(had))) return;
    live.set(k.id, -1);
    try {
      if (k.kind === "dir") {
        try { const h = engine.start({ workflow: DIR_HOST_WORKFLOW, text: `Review room host for ${room0.subject?.url}`, params: { dir: String(room0.subject?.url ?? ""), room: k.id }, by } as any); room0.host = h.id; save(k, room0); }
        catch (e: any) { throw refuse(`The tutor's host could not start: ${String(e?.message ?? e).slice(0, 300)}`, e?.code ?? "no_host"); }
      } else {
        // a team that covers code-firstmate writes the project's crew-derived staffing
        try { const def = codeDef(); if (def && project) engine.deps.teamStaffing?.(def, project); } catch {}
        try { const h = engine.start({ workflow: HOST_WORKFLOW, text: `Review room host for ${room0.subject?.url}`, params: { project: String(project ?? ""), pr: String(room0.subject?.url ?? "") }, by } as any); room0.host = h.id; save(k, room0); }
        catch (e: any) { throw refuse(`The tutor's host could not start: ${String(e?.message ?? e).slice(0, 300)}`, e?.code ?? "no_crew"); }
      }
      // the host is one hook node: it ends at once, and its end aborts what listens to its signal. The page's round starts only
      // after that end (an auxiliary owner holds an ended host), so the first page is never cancelled by its own host finishing
      const hid = load(k)?.host, ended = () => ["succeeded", "failed", "cancelled"].includes(String(engine.get(hid!)?.status ?? "succeeded")), t0 = Date.now();
      while (hid && !ended() && Date.now() - t0 < 30_000) await new Promise((r) => setTimeout(r, 25));
      if (hid && !ended()) throw refuse("The room's host Task has not started yet (Studio is busy): try again in a moment / 審查室的主機任務還沒開始（Studio 忙碌中），請稍候再試", "busy");
    } finally { live.delete(k.id); }
  }
  /** instr: the seat on the tutor's member and its pinned texts (the explainer's: Studio's frame and the skill, or the question
   *  frame; src/domain/review-explain.ts) */
  async function admit(k: Key, s: S, tutor: Tutor, instr: { seat: string; texts: { id: string; sha256: string; text: string }[] }) {
    const off = engine.grants.open("sandbox-off", s.run.ctx.project ?? s.run.params?.project ?? null);
    if (off) throw refuse("The tutor runs only in the round sandbox: this project has an open sandbox-off grant; end it first", "sandbox");
    if (localUnrestricted()) throw refuse("The tutor runs only in the round sandbox: Studio is in local unrestricted mode (CREW_LOCAL_UNRESTRICTED)", "sandbox");
    const sk = instr.texts.map((t) => ({ ...t, ref: t.id }));
    // the tutor's round is one of the Task's jobs, admitted like any role's: the merge card's live node owns it (a branch or
    // pull request room: an auxiliary owner of the review node, which never advances the Task), the native selection verifies
    // the reviewer member's capability, and staffing issues its receipt for the tutor seat
    const run = s.run, pick = tutor.pick, held = k.kind === "merge" ? null : engine.auxOwner(run, s.node), x = held ? held.x : engine.x(run, s.node, run.nodes[s.node.id]); let provider: any;
    try {
      if (!engine.owns(x)) throw refuse(k.kind === "merge" ? "The merge card's step is no longer live" : "The Task's review step changed", "closed");
      // a signed-in model not verified yet is verified by Studio itself (one bounded request, kept for its window); one that is not
      // signed in, out of quota or not offered is refused with the reason. A model the captain entered by hand is not on the list
      // Studio verifies from: the native selection passes it to its vendor as given (picked), and the turn fails with the vendor's error
      if (pick.model && !tutor.unlisted) try { const v: any = await engine.deps.ensurePick?.({ provider: pick.provider, model: pick.model, effort: pick.effort ?? null }, { signal: engine.abortOf(run).signal, why: `review room ${k.id}` });
        // what Studio verified itself for this turn, on the Task's own ledger (as a Board start records it)
        if (v?.verified?.length) engine.record(x, "staffing-auto-verify", { data: { schema: 1, verified: v.verified, by: "studio", for: `review room ${k.id}`, at: new Date().toISOString() } } as any); }
      catch (e: any) { throw refuse(`The tutor's model is not available: ${String(e?.message ?? e).slice(0, 400)}`, "no_tutor"); }
      try { provider = engine.deps.selectProvider ? await engine.deps.selectProvider(x, pick, { role: TUTOR_ROLE, explicit: true, ...(tutor.adaptive ? { adaptive: true, ...(tutor.picked ? { picked: true } : {}) } : {}) }) : engine.deps.provider(pick.provider, pick.model ?? undefined); }
      catch (e: any) { throw refuse(`The tutor's model is not available: ${String(e?.message ?? e).slice(0, 300)}`, "no_tutor"); }
    } catch (e) { held?.release(); throw e; }
    const system = sk.map((k) => k.text).join("\n"), rules = new OperatingRules(engine.deps.dataDir).section(run.params?.project || null);
    // an adaptive tutor names the member it runs on: staffing's receipt is for that member, never the role's approved one
    const aux = { seat: instr.seat, texts: sk.map((k) => ({ sha256: k.sha256, text: k.text })), ...(tutor.adaptive ? { member: { provider: pick.provider, model: pick.model ?? null, effort: pick.effort ?? null, independence: tutor.level ?? "unknown", crew: !tutor.outside, ...(tutor.picked ? { picked: true } : {}) } } : {}) };
    const receipt = (r: any) => engine.deps.instructionReceipt?.(x, TUTOR_ROLE, jobInstructions(system, r), provider, { ...aux, rules: r });
    let admissionReceipt: unknown; try { admissionReceipt = receipt(rules); } catch (e: any) { held?.release(); throw refuse(`The tutor's staffing could not be admitted: ${String(e?.message ?? e).slice(0, 300)}`, "staffing"); }
    return { x, held, provider, sk, system, rules, admissionReceipt, receipt, pick, tutor };
  }
  const isBot = (x: Note) => x.kind === "comment" && /\[bot\]$/i.test(x.author);
  // ---------- a pull request by its URL: read on GitHub (GET only), its head's objects fetched into Studio's own cache ----------
  const connected = (repository: string) => { for (const p of o.projects?.list() ?? []) { const gr: any = (p as any).github; if (gr?.repository && String(gr.repository).toLowerCase() === repository.toLowerCase() && (p as any).enabled !== false) return p; } return null; };
  const refreshing = new Map<string, Promise<any>>();
  /** Read the pull request again and keep what GitHub shows now: its text, state, files, reviews and comments, and its head's
   *  commits. Bounded (a few pages a list, a fetch with a time limit and a size cap); only on the captain's action. */
  async function readPr(url: string): Promise<string> {
    const p = parsePrUrl(url); if (!p) throw refuse("Paste a pull request's address: https://github.com/<owner>/<repo>/pull/<number> / 請貼上 pull request 的網址：https://github.com/<owner>/<repo>/pull/<number>", "bad_url");
    const project: any = connected(p.repository); if (!project) throw refuse(`github.com/${p.repository} is not the GitHub repository of a registered project connected to GitHub; Studio reads only those / github.com/${p.repository} 不是已註冊且連到 GitHub 的專案的儲存庫；Studio 只讀這些`, "not_connected");
    let a: GitHubPrAdapter | null = null; try { a = o.github?.(project) ?? null; } catch (e: any) { throw refuse(`The project's GitHub connection does not verify: ${String(e?.message ?? e).slice(0, 200)}`, "not_connected"); }
    if (!a || String(a.grant.repository).toLowerCase() !== p.repository.toLowerCase()) throw refuse(`The project's GitHub connection is not available for ${p.repository}`, "not_connected");
    const repository = a.grant.repository, n = String(p.n), id = prRoomId(repository, p.n), canonical = `https://github.com/${repository}/pull/${n}`;
    const running = refreshing.get(id); if (running) return running;
    const job = (async () => {
      const ac = new AbortController(), timer = setTimeout(() => ac.abort(), PR_FETCH_MS + 60_000);
      try {
        const read = async () => { const v = await a!.remoteRead("pull", n, 1, ac.signal, true);
          if (v?.number !== p.n || String(v?.html_url ?? "").toLowerCase() !== canonical.toLowerCase() || String(v?.base?.repo?.full_name ?? "").toLowerCase() !== repository.toLowerCase() || !SHA.test(String(v?.head?.sha ?? "")) || typeof v?.base?.ref !== "string" || !["open", "closed"].includes(v?.state)) throw refuse("GitHub returned a pull request record Studio does not recognise", "github");
          return v; };
        const pages = async (kind: "reviews" | "inline-comments" | "issue-comments" | "pull-files") => { const out: any[] = []; let more = false;
          for (let page = 1; page <= PR_PAGES; page++) { const v = await a!.remoteRead(kind, n, page, ac.signal, true); if (!Array.isArray(v)) throw refuse("GitHub returned a list Studio does not recognise", "github"); out.push(...v); if (v.length < 100) break; if (page === PR_PAGES) more = true; }
          return { out, more }; };
        let pull: any; try { pull = await read(); } catch (e) { const k0: Key = { id, kind: "pr", run: null, node: null, file: prFile(id), dir: join(prDir, `${id}-images`), stat: `pr:${id}`, open: () => false };
          const r0 = load(k0); if (r0?.pr) { r0.pr.attemptedAt = new Date().toISOString(); save(k0, r0); } throw e; } const [reviews, inline, comments, files] = [await pages("reviews"), await pages("inline-comments"), await pages("issue-comments"), await pages("pull-files")];
        const notes: Note[] = [
          ...reviews.out.filter((r: any) => Number.isSafeInteger(r?.id)).map((r: any): Note => ({ id: `r${r.id}`, kind: "review", author: login(r.user), body: untrusted(r.body ?? "", 4000), at: typeof r.submitted_at === "string" ? r.submitted_at : null, url: ghUrl(r.html_url, repository), state: /^[A-Z_]{1,20}$/.test(String(r.state)) ? String(r.state) : undefined, commit: SHA.test(String(r.commit_id)) ? r.commit_id : null })),
          ...inline.out.filter((c: any) => Number.isSafeInteger(c?.id)).map((c: any): Note => ({ id: `c${c.id}`, kind: "inline", author: login(c.user), body: untrusted(c.body ?? "", 4000), at: typeof c.created_at === "string" ? c.created_at : null, url: ghUrl(c.html_url, repository), path: normPath(String(c.path ?? "")) ?? null, line: Number.isSafeInteger(c.line) ? c.line : Number.isSafeInteger(c.original_line) ? c.original_line : null, commit: SHA.test(String(c.commit_id)) ? c.commit_id : null, outdated: c.position === null })),
          ...comments.out.filter((c: any) => Number.isSafeInteger(c?.id)).map((c: any): Note => ({ id: `i${c.id}`, kind: "comment", author: login(c.user), body: untrusted(c.body ?? "", 4000), at: typeof c.created_at === "string" ? c.created_at : null, url: ghUrl(c.html_url, repository) })),
        ].sort((x, y) => String(x.at ?? "").localeCompare(String(y.at ?? "")));
        const k: Key = { id, kind: "pr", run: null, node: null, file: prFile(id), dir: join(prDir, `${id}-images`), stat: `pr:${id}`, open: () => load(k)?.pr?.state === "open" };
        const prior = load(k), wasOpen = !!prior?.pr && prior.pr.state === "open" && !prior.pr.merged, host = hostInto(k, prior ?? { subject: { url: canonical } } as any); if (prior && prior.subject?.repository?.toLowerCase() !== repository.toLowerCase()) throw refuse("Another pull request's room has this id", "conflict");
        const wt = cacheDir(repository); let fetched: { head: string; base: string } | null = null, failed: string | null = null;
        try { fetched = await a!.fetchPull(n, pull.base.ref, wt, { signal: ac.signal, timeoutMs: PR_FETCH_MS, maxBytes: PR_CACHE_BYTES() }); }
        catch (e: any) { failed = e?.overCap ? String(e.message) : "Studio could not fetch the pull request's commits from GitHub (authentication, the network or the time limit)";
          // over the cap the cache goes, unless a room of this repository is reading it right now (a turn running)
          const rooms = `PR-${sha(repository.toLowerCase()).slice(0, 12)}-`; if (e?.overCap && !busyRooms().some((x) => x.startsWith(rooms))) rmSync(wt, { recursive: true, force: true }); }
        // the head moved while Studio read: read it once more; still different, the commits fetched are not this head's
        if (fetched && fetched.head !== pull.head.sha) { pull = await read(); if (fetched.head !== pull.head.sha) { failed = "The pull request moved while Studio read it: check again"; fetched = null; } }
        const base = fetched ? git(wt, ["merge-base", fetched.head, fetched.base]).out || fetched.base : prior?.pr?.base ?? "";
        const now = new Date().toISOString(), snap: PrSnap = { title: untrusted(pull.title ?? "", 300), body: untrusted(pull.body ?? "", 12000), state: pull.state, merged: pull.merged === true || !!pull.merged_at, mergedAt: typeof pull.merged_at === "string" ? pull.merged_at : null, closedAt: typeof pull.closed_at === "string" ? pull.closed_at : null,
          draft: pull.draft === true, author: login(pull.user), headRef: untrusted(pull.head?.ref ?? "", 200), headRepo: untrusted(pull.head?.repo?.full_name ?? "", 200), baseRef: String(pull.base.ref), head: fetched?.head ?? prior?.pr?.head ?? pull.head.sha, base,
          files: files.out.slice(0, 300).map((f: any) => ({ path: normPath(String(f?.filename ?? "")) ?? "?", status: /^[a-z]{1,12}$/.test(String(f?.status)) ? f.status : "?", added: Number(f?.additions) || 0, removed: Number(f?.deletions) || 0 })),
          notes, checkedAt: now, attemptedAt: now, truncated: [reviews, inline, comments, files].some((x) => x.more), stale: failed ? { head: pull.head.sha, error: failed, at: now } : null };
        const room: Room = prior ?? { ...fresh(k, { run: host, head: snap.head, base }), subject: { kind: "pr", room: id, url: canonical, repository, number: p.n, project: project.id, task: host?.id ?? null } };
        room.pr = snap; room.run = host?.id ?? ""; room.node = k.node ?? ""; room.subject = { ...room.subject!, task: host?.id ?? null };
        if (fetched && !(room.heads ?? []).some((h) => h.head === snap.head)) room.heads = [...(room.heads ?? []), { head: snap.head, base, at: snap.checkedAt }];
        save(k, room); notify(k); if (wasOpen && (snap.merged || snap.state === "closed")) finish(self, k, snap.merged ? "The pull request was merged" : "The pull request was closed"); return id;
      } finally { clearTimeout(timer); }
    })();
    refreshing.set(id, job); try { return await job; } finally { refreshing.delete(id); }
  }

  // ---------- a GitHub directory by its address: any repository (a public one anonymously, a private one through the captain's
  // gh login), its ref resolved once and pinned at that commit, its objects fetched into Studio's own cache (never a checkout) ----------
  /** the captain's GitHub token, for a repository that is not public: `gh auth token` (never stored, never on a command line) */
  const ghToken = (): string | null => { if (o.ghToken) return o.ghToken(); if (process.env.CREW_GH_NO_CLI === "1") return null;
    try { const r = Bun.spawnSync(["gh", "auth", "token"], { stdout: "pipe", stderr: "pipe", env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" } }); const t = r.stdout.toString().trim(); return r.success && /^[\w-]{20,255}$/.test(t) ? t : null; } catch { return null; } };
  /** git against the directory's remote: no prompt, no hook; the token (when one is needed) only in this process's environment */
  const remoteGit = async (cwd: string, args: string[], token: string | null, ms: number) => {
    const env = gitEnv(token ? { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader", GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}` } : {});
    const p = Bun.spawn(gitArgv(["-c", "core.hooksPath=/dev/null", "-c", `protocol.file.allow=${o.dirRemote ? "always" : "never"}`, "-c", "gc.auto=0", "-c", "maintenance.auto=false", "-c", "fetch.unpackLimit=1", ...args]), { cwd, env, stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => { try { p.kill(9); } catch {} }, ms);
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]); clearTimeout(timer);
    return { ok: code === 0, out, err: err.replace(/AUTHORIZATION:[^\n]*/gi, "").slice(0, 400) }; };
  const reading = new Map<string, Promise<string>>();
  /** Read a GitHub directory: its address checked, the repository's refs listed (anonymously, else with the captain's gh token),
   *  the ref the address names resolved and pinned (a branch, a tag, a commit, or the default branch), its objects fetched
   *  (bounded: a time limit, the cache's size cap, history to depth 200), the directory listed. A room already read stays
   *  pinned at its commit: pasting it again opens it as it was. */
  async function readDir(url: string): Promise<string> {
    const p = parseDirUrl(String(url ?? "").slice(0, 800)); if (!p) throw refuse("Paste a GitHub directory's address: https://github.com/<owner>/<repo>/tree/<branch, tag or commit>/<path>, or https://github.com/<owner>/<repo> / 請貼上 GitHub 目錄的網址", "bad_url");
    const remote = o.dirRemote?.(p.repository) ?? `https://github.com/${p.repository}.git`, wt = dirCache(p.repository);
    const key = `${p.repository.toLowerCase()}\0${p.rest.join("/")}`, running = reading.get(key); if (running) return running;
    const job = (async () => {
      mkdirSync(wt, { recursive: true, mode: 0o700 }); if (!existsSync(join(wt, "HEAD"))) must(wt, ["-c", "core.hooksPath=/dev/null", "init", "--bare", "-q", "--template=", "."]);
      // who may read it: anyone (a public repository), else the captain through their gh login (a private one)
      let token: string | null = null, refs = await remoteGit(wt, ["ls-remote", "--symref", remote, "HEAD", "refs/heads/*", "refs/tags/*"], null, 30_000);
      if (!refs.ok) { token = ghToken(); if (token) refs = await remoteGit(wt, ["ls-remote", "--symref", remote, "HEAD", "refs/heads/*", "refs/tags/*"], token, 30_000); }
      if (!refs.ok) throw refuse(`Studio cannot read github.com/${p.repository}: it is not public, and ${token ? "your GitHub login (gh) cannot read it either" : "no GitHub login (gh auth login) is there to read it"} / Studio 讀不到 github.com/${p.repository}`, "no_access");
      const heads = new Map<string, string>(), tags = new Map<string, string>(); let defaultBranch: string | null = null;
      for (const l of refs.out.split("\n")) { const sym = /^ref: refs\/heads\/(\S+)\tHEAD$/.exec(l); if (sym) { defaultBranch = sym[1]; continue; }
        const m = /^([0-9a-f]{40})\t(refs\/(heads|tags)\/(.+?))(\^\{\})?$/.exec(l); if (!m) continue;
        if (m[3] === "heads") heads.set(m[4], m[1]); else if (m[5] || !tags.has(m[4])) tags.set(m[4], m[1]); }
      // the ref: the longest prefix of the address's segments that is a branch or a tag (a branch's name may hold a slash), else a commit
      let ref = "", refKind: DirSnap["refKind"] = "default", tip = "", path = "";
      if (!p.rest.length) { if (!defaultBranch || !heads.has(defaultBranch)) throw refuse(`github.com/${p.repository} has no default branch Studio can read`, "bad_ref"); ref = defaultBranch; tip = heads.get(defaultBranch)!; }
      else { for (let n = p.rest.length; n >= 1 && !ref; n--) { const name = p.rest.slice(0, n).join("/"); if (heads.has(name)) { ref = name; refKind = "branch"; tip = heads.get(name)!; path = p.rest.slice(n).join("/"); } else if (tags.has(name)) { ref = name; refKind = "tag"; tip = tags.get(name)!; path = p.rest.slice(n).join("/"); } }
        if (!ref && /^[0-9a-f]{40}$/.test(p.rest[0])) { ref = p.rest[0]; refKind = "commit"; tip = p.rest[0]; path = p.rest.slice(1).join("/"); }
        if (!ref) throw refuse(`github.com/${p.repository} has no branch or tag named in that address (${glyph(p.rest.join("/")).slice(0, 120)}); a commit is its full 40-character id / 這個網址裡沒有這個儲存庫的分支或標籤`, "bad_ref"); }
      if (path) { const n = normPath(path); if (!n || n !== path) throw refuse("That directory's path is not a path inside the repository", "bad_url"); }
      const id = dirRoomId(p.repository, ref, path), k: Key = { id, kind: "dir", run: null, node: null, file: dirFile(id), dir: join(dirDir, `${id}-images`), stat: `dir:${id}`, open: () => !!load(k)?.dir?.sha };
      const prior = load(k), pin = prior?.dir?.sha ?? tip;
      // pinned: a room already read stays at its commit (its citations stay stable); only its objects are fetched again when missing
      if (prior?.dir?.sha && git(wt, ["cat-file", "-e", `${pin}^{commit}`]).ok) return id;
      const target = refKind === "commit" || prior ? pin : `refs/${refKind === "tag" ? "tags" : "heads"}/${ref}`;
      const got = await remoteGit(wt, ["fetch", "--no-tags", "--no-write-fetch-head", "--no-recurse-submodules", "--depth=200", "--", remote, `+${target}:refs/crew/dir/${id}`], token, PR_FETCH_MS);
      if (!got.ok) throw refuse(`Studio could not fetch github.com/${p.repository} at ${glyph(ref).slice(0, 80)} (the network, the time limit or access) / Studio 抓不到這個目錄`, "no_access");
      const size = git(wt, ["count-objects", "-v"]).out.split("\n").reduce((t, l) => { const m = /^(size|size-pack): (\d+)$/.exec(l); return t + (m ? Number(m[2]) * 1024 : 0); }, 0);
      if (size > PR_CACHE_BYTES()) { if (!busyRooms().some((x) => x.startsWith(`DIR-${sha(p.repository.toLowerCase()).slice(0, 12)}-`))) rmSync(wt, { recursive: true, force: true }); throw refuse(`github.com/${p.repository} is larger than the review room keeps (${Math.round(PR_CACHE_BYTES() / 1024 ** 2)} MB)`, "too_large"); }
      const at = git(wt, ["rev-parse", "--verify", `refs/crew/dir/${id}^{commit}`]).out; if (!SHA.test(at)) throw refuse("The fetched commit is not one Studio can read", "no_access");
      if (path && git(wt, ["cat-file", "-t", `${at}:${path}`]).out !== "tree") throw refuse(`${glyph(path)} is not a directory at ${at.slice(0, 8)}: paste a directory's address (a file's /blob/ address is not one)`, "not_a_directory");
      // what it holds: its files by part (each folder and file right under it), sizes, and its README if it has one
      const ls = git(wt, ["ls-tree", "-r", "-l", "-z", at, "--", ...(path ? [path] : [])]).out.split("\0").filter(Boolean).map((l) => { const m = /^\d+ \w+ [0-9a-f]+\s+(-|\d+)\t([\s\S]+)$/.exec(l); return m ? { path: m[2], bytes: Number(m[1]) || 0 } : null; }).filter(Boolean) as { path: string; bytes: number }[];
      const parts = new Map<string, { name: string; kind: "dir" | "file"; files: number; bytes: number }>();
      for (const f of ls) { const rel = path ? f.path.slice(path.length + 1) : f.path, seg = rel.split("/"), name = seg[0], kind = seg.length > 1 ? "dir" as const : "file" as const;
        const x = parts.get(name) ?? { name: glyph(name).slice(0, 120), kind, files: 0, bytes: 0 }; x.files++; x.bytes += f.bytes; parts.set(name, x); }
      const readmeName = ls.map((f) => f.path).find((f) => (path ? f.startsWith(`${path}/`) : true) && /^readme(\.(md|markdown|txt|rst))?$/i.test(f.slice(path ? path.length + 1 : 0)));
      const readme = readmeName ? (await fileAt(wt, at, readmeName))?.toString("utf8").slice(0, 12000) ?? null : null, now = new Date().toISOString();
      const snap: DirSnap = { repository: p.repository, ref, refKind, sha: at, path, private: !!token, files: ls.length, bytes: ls.reduce((n, f) => n + f.bytes, 0), parts: [...parts.values()].sort((a, b) => b.files - a.files).slice(0, 40), readme: readme && !readme.includes("\0") ? readme : null, fetchedAt: now, truncated: parts.size > 40 };
      const canonical = `https://github.com/${p.repository}/tree/${ref.split("/").map(encodeURIComponent).join("/")}${path ? `/${path.split("/").map(encodeURIComponent).join("/")}` : ""}`;
      const room: Room = prior ?? { schema: 1, run: "", card: id, node: "", head: at, base: at, turns: [], board: [], sources: [], check: { questions: [] },
        subject: { kind: "dir", room: id, url: canonical, repository: p.repository, ref, path, project: null, task: null }, seen: { head: at, at: now }, heads: [{ head: at, base: at, at: now }] };
      room.dir = snap; room.head = at; room.base = at; save(k, room); notify(k); return id;
    })();
    reading.set(key, job); try { return await job; } finally { reading.delete(key); }
  }
  // ---------- the per-pull-request record, kept for later comparison with reverts and reopens (no analysis here) ----------
  const statsFile = join(o.dataDir, "review-room-stats.json");
  let statsMemo: Record<string, any> | null = null;
  const stats = (): Record<string, any> => { if (statsMemo) return statsMemo; try { statsMemo = JSON.parse(readFileSync(statsFile, "utf8")); } catch { statsMemo = {}; } return statsMemo!; };
  /** the repository a room is listed under: a merge card's and a branch's rooms keep none of their own, their Task's pull request or project says */
  const repositoryOf = (k: Key, r: Room): string | null => { if (r.subject?.repository) return r.subject.repository; const run = k.run ? engine.get(k.run) : null; if (!run) return null;
    const pr = parsePrUrl(String(run.ctx.pr?.url ?? "")); if (pr) return pr.repository; const id = engine.projectOf(run), p: any = o.projects?.list().find((x: any) => x.id === id);
    return p?.github?.repository ?? p?.name ?? null; };
  const stat = (k: Key, patch: Record<string, any>) => { try { const all = stats(), run = k.run ? engine.get(k.run) : null, prev = all[k.stat] ?? {}, room = k.kind === "pr" ? load(k) : null;
    all[k.stat] = { card: k.id, ...(k.kind === "merge" ? {} : { kind: k.kind }), project: run?.params?.project ?? run?.ctx.project ?? room?.subject?.project ?? null,
      pr: k.kind === "pr" ? { id: String(room?.subject?.number ?? ""), url: room?.subject?.url ?? null } : run?.ctx.pr ? { id: run.ctx.pr.id ?? null, url: run.ctx.pr.url ?? null } : null,
      head: k.kind === "pr" ? room?.pr?.head ?? null : k.kind === "branch" ? run?.ctx.taintedReady?.head ?? run?.ctx.head ?? null : run?.ctx.pr?.head ?? run?.ctx.head ?? null,
      openedAt: null, turns: 0, check: { asked: 0, graded: 0, correct: 0 }, ...prev, ...patch, updatedAt: new Date().toISOString() };
    statsMemo = all; mkdirSync(o.dataDir, { recursive: true }); writeFileSync(statsFile + ".tmp", JSON.stringify(all, null, 1)); renameSync(statsFile + ".tmp", statsFile); } catch {} };
  const notify = (k: Key, turn?: number) => { try { if (k.card) engine.deps.send("scard", { id: k.id, run: k.run, status: engine.cards.get(k.id)?.status }); engine.deps.send("review-room", { card: k.id, run: k.run, turn: turn ?? null }); } catch {} };

  /** a directory room's title: the directory (or the repository's root) and where it is */
  const dirTitle = (r: Room | null) => { const d = r?.dir, where = d ? `${d.repository}${d.path ? `/${d.path}` : ""}` : r?.subject?.repository ?? "";
    return { en: `Directory ${where} @ ${d?.ref ?? ""}`, "zh-TW": `目錄 ${where} @ ${d?.ref ?? ""}` }; };
  const closedText = (k: Key, room: Room | null) => k.kind === "dir" ? { en: "Studio has not read this directory's commit (paste its address again): the room stays readable and takes no turn.", zh: "Studio 還沒讀到這個目錄的 commit（請再貼一次網址）：審查室仍可閱讀，不能提問。" } : k.kind === "merge" ? { en: "The merge card is answered: this room is read-only now.", zh: "合併卡已回覆：審查室現在只能閱讀。" }
    : k.kind === "pr" ? (room?.pr?.state === "open" && !room.pr.merged ? (/larger than the review room keeps/.test(room.pr.stale?.error ?? "")
        ? { en: `Studio cannot keep this pull request's commits (${room.pr.stale!.error}): the room stays readable and takes no turn.`, zh: `Studio 無法保存這個 pull request 的 commit（${room.pr.stale!.error}）：審查室仍可閱讀，不能提問。` }
        : { en: `Studio has not read this pull request's commits yet${room.pr.stale?.error ? ` (${room.pr.stale.error})` : ""}: the room takes turns once it has. Check for new commits to try again.`, zh: `Studio 還沒讀到這個 pull request 的 commit${room.pr.stale?.error ? `（${room.pr.stale.error}）` : ""}：讀到之後審查室才能提問。按「檢查新的 commit」再試一次。` })
      : room?.pr?.merged ? { en: "This pull request is merged on GitHub: the room stays readable and takes no turn.", zh: "這個 pull request 已在 GitHub 合併：審查室仍可閱讀，不再提問。" } : { en: "This pull request is closed on GitHub: the room stays readable and takes no turn.", zh: "這個 pull request 已在 GitHub 關閉：審查室仍可閱讀，不再提問。" })
    : { en: "The Task is gone: this room is read-only.", zh: "任務已不在：審查室只能閱讀。" };
  /** a pull request's state as the room shows it: open, draft, merged or closed, and each reviewer's latest verdict at which head */
  const prState = (room: Room | null) => { const pr = room?.pr; if (!pr) return null; const latest = new Map<string, Note>();
    for (const x of pr.notes) if (x.kind === "review" && ["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(x.state ?? "")) latest.set(x.author, x);
    const verdicts = [...latest.values()].map((x) => ({ author: x.author, state: x.state!, commit: x.commit ?? null, current: x.commit === pr.head }));
    return { state: pr.merged ? "merged" : pr.state, draft: pr.draft, mergedAt: pr.mergedAt, closedAt: pr.closedAt, checkedAt: pr.checkedAt, head: pr.head, headRef: pr.headRef, headRepo: pr.headRepo, baseRef: pr.baseRef, author: pr.author, title: pr.title,
      files: pr.files.length, truncated: pr.truncated, verdicts, approved: verdicts.some((v) => v.state === "APPROVED" && v.current) && !verdicts.some((v) => v.state === "CHANGES_REQUESTED") }; };
  /** the change's line counts per file, counted by git (base to head; a pull request Studio has no commits of yet: what GitHub
   *  listed): the room's free pictures (the welcome scene, an answer that drew none) are drawn from these. Cached per head. */
  const statMemo = new Map<string, { files: { path: string; added: number; removed: number }[]; total: { files: number; added: number; removed: number }; from: "git" | "github" }>();
  const diffstatOf = (s: { wt: string; base: string; head: string } | null, room: Room | null) => {
    const sum = (files: { path: string; added: number; removed: number }[], from: "git" | "github") => ({ files: files.slice(0, 300), total: { files: files.length, added: files.reduce((n, f) => n + f.added, 0), removed: files.reduce((n, f) => n + f.removed, 0) }, from });
    if (s) { const key = `${s.wt}\0${s.base}\0${s.head}`, had = statMemo.get(key); if (had) return had;
      const r = git(s.wt, ["diff", "--numstat", "-M", s.base, s.head]); if (r.ok) {
        const v = sum(r.out.split("\n").filter(Boolean).map((l) => { const [a, d, ...rest] = l.split("\t"); return { path: glyph(rest.join("\t")).slice(0, 300), added: Number(a) || 0, removed: Number(d) || 0 }; }), "git");
        if (statMemo.size > 200) statMemo.clear(); statMemo.set(key, v); return v; } }
    return room?.pr?.files?.length ? sum(room.pr.files.map((f) => ({ path: f.path, added: f.added, removed: f.removed })), "github") : null;
  };
  /** the head moved past the one the captain last looked at: how many commits (null when the branch was rewritten) */
  const movedOf = (s: { wt: string; head: string } | null, room: Room | null) => { const from = room?.seen?.head; if (!s || !from || from === s.head) return null;
    const known = git(s.wt, ["cat-file", "-e", `${from}^{commit}`]).ok, anc = known && git(s.wt, ["merge-base", "--is-ancestor", from, s.head]).ok;
    return { from, to: s.head, commits: anc ? Number(git(s.wt, ["rev-list", "--count", `${from}..${s.head}`]).out) || 0 : null, rewritten: known && !anc }; };
  // ---------- the Library: a room's pages (the explainer's versions), one artifact per room, a version per save ----------
  let libMemo: ArtifactStore | null = null;
  const library = () => o.artifacts ?? (libMemo ??= new ArtifactStore(o.dataDir));
  /** a room's Library artifact id: room-<the room's id> */
  const libId = (id: string) => `room-${id.toLowerCase()}`, LIB_ID = /^room-(sc-\d+|r-\d+|pr-[0-9a-f]{12}-[1-9]\d{0,8}|dir-[0-9a-f]{12}-[0-9a-f]{12})$/;
  const saving = new Map<string, Promise<any>>();
  /** every Library save runs after the one before it, whatever its room: two saves never race for a version number */
  let saveChain: Promise<unknown> = Promise.resolve();
  const queueSave = <T>(id: string, fn: () => Promise<T>): Promise<T> => { const job = saveChain.then(fn, fn); saveChain = job.catch(() => null); saving.set(id, job); void job.catch(() => null).finally(() => { if (saving.get(id) === job) saving.delete(id); }); return job; };
  /** what a save keeps: the room's pages, their files byte for byte (pages/v<n>/…), and a manifest (room.json): each version's
   *  skill, head, instructions, cost and summary, the room's subject and the date. The pages are shown only by the room (an
   *  isolated frame, src/domain/review-explain.ts); the Library keeps them. Nothing goes to GitHub. */
  async function snapshot(api: any, k: Key, reason: string, ended = false) {
    const room = load(k), pages = explainer.pages(k.id);
    if (!pages.length) throw refuse("Nothing to save yet: the room has no page / 還沒有可以存的頁面", "empty");
    const view: any = api.view(k.id), dir = mkdtempSync(join(tmpdir(), "crew-room-snap-"));
    try {
      for (const v of pages) for (const f of v.files) { try { const to = join(dir, "pages", `v${v.n}`, f.path); mkdirSync(dirname(to), { recursive: true }); copyFileSync(join(v.dir, f.path), to); } catch {} }
      const usd = pages.reduce((n, v) => n + (typeof v.run?.cost?.usd === "number" ? v.run.cost.usd : 0), 0), savedAt = new Date().toISOString();
      const snap = { schema: 2, kind: "review-room-pages", room: k.id, savedAt, reason, cost: { usd: Math.round(usd * 10000) / 10000 },
        subject: { kind: k.kind, room: k.id, repository: room?.subject?.repository ?? null, number: room?.subject?.number ?? (view.pr?.id ?? null), url: room?.subject?.url ?? view.pr?.url ?? null, head: room?.head ?? view.head ?? null, title: view.card?.title ?? null },
        pages: pages.map((v) => ({ n: v.n, skill: v.skill, at: v.at, entry: `pages/v${v.n}/${v.entry}`, kind: v.kind, summary: v.summary, prompt: v.prompt ?? null, head: v.run?.head ?? null, provider: v.run?.provider ?? null, model: v.run?.model ?? null, cost: v.run?.cost ?? null })),
        view: { card: view.card, subject: view.subject, task: view.task, pr: view.pr, head: view.head, base: view.base, dir: view.dir ?? null, open: false, closed: { en: "Saved in the Library: its pages, read only.", zh: "存在成品庫：它的頁面，唯讀。" } } };
      writeFileSync(join(dir, "room.json"), JSON.stringify(snap));
      const store = library(), aid = libId(k.id), title = `Review room · ${(view.card?.title?.en ?? k.id)}`.slice(0, 200);
      const project = String(engine.get(room?.run ?? "")?.params?.project ?? engine.get(room?.run ?? "")?.ctx.project ?? room?.subject?.project ?? "") || "firstmate-workflow";
      if (!store.get(aid)) store.create({ id: aid, title, type: "doc", project, source: "room", note: "A review room's pages, saved read-only: open the room to read them. / 存起來的審查室頁面（唯讀）：打開審查室閱讀。" });
      const v = store.addVersion(aid, { from: dir, primary: "room.json", createdBy: { kind: "host" }, status: "draft", summary: reason, cost: { usd: snap.cost.usd, inTokens: null, outTokens: null } });
      const fresh0 = load(k); if (fresh0) { fresh0.library = { artifact: aid, versions: [...(fresh0.library?.artifact === aid && v.n > 1 ? fresh0.library.versions : []), { n: v.n, at: savedAt, reason }], rev: (fresh0.rev ?? 0) + 1, ended: !!fresh0.library?.ended || ended }; save(k, fresh0); }
      notify(k); return { artifact: aid, n: v.n, href: `#/room/lib:${aid}` };
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  /** Mark the room finished at the moment it finishes (its merge card answered, its pull request merged or closed) and save its
   *  pages to the Library once. A room with no page has nothing to keep; a failed save is recorded, not retried by itself. */
  const finish = (api: any, k: Key, reason: string) => { try { let room = load(k); if (!room) { if (existsSync(k.file) || (!explainer.pages(k.id).length && !explainer.running(k.id))) return; room = fresh(k, subjectOf(k)); }
    if (room.finished) return; room.finished = { at: new Date().toISOString(), reason }; save(k, room); autoSave(api, k); } catch {} };
  // a page being made: the save waits for it to end (Studio saves what is there once nothing runs), never half a version
  const autoSave = (api: any, k: Key) => { try { const room = load(k); if (!room?.finished || room.finished.tried || explainer.running(k.id) || !explainer.pages(k.id).length) return;
    room.finished.tried = true; save(k, room);
    void queueSave(k.id, () => snapshot(api, k, room.finished!.reason, true)).catch((e: any) => { const r2 = load(k); if (r2?.finished) { r2.finished.error = String(e?.message ?? e).slice(0, 300); save(k, r2); } }); } catch {} };
  /** a room's old whiteboard, as counts (the page offers its record as a file): never its text */
  const oldBoard = (r: Room | null) => { const turns = (r?.turns ?? []).filter((t: any) => !t?.studio && t?.status && t.status !== "running").length, items = (r?.board ?? []).length; return turns || items ? { turns, items } : null; };
  // ---------- the room list, the zones and the merge card's summary: from the explainer (its versions, its runs) ----------
  /** the room's latest page, while the captain has not opened the room since it came */
  const unread = (k: Key, r: Room | null) => { const at = explainer.brief(k.id)?.latest?.at ?? null; return at && !(r?.read && r.read >= at) ? at : null; };
  /** what the room list knows of a room, from what Studio holds (no read of GitHub or git). A pull request's end is its state. A
   *  room waits for the captain while its head has no page yet, or a page came since they last looked. */
  const zoneFacts = (k: Key, r: Room): ZoneFacts => {
    const run = k.run ? engine.get(k.run) : null, b = explainer.brief(k.id);
    const head = k.kind === "pr" ? r.pr?.stale?.head ?? r.pr?.head ?? r.head : k.kind === "dir" ? r.dir?.sha ?? r.head : run?.ctx.taintedReady?.head ?? run?.ctx.head ?? r.head;
    const waiting = k.kind === "merge" ? k.open() : !(b?.heads ?? []).includes(head) || !!unread(k, r);
    const concluded = k.kind === "merge" ? !k.open() : k.kind === "pr" ? !!r.pr && r.pr.state !== "open" : k.kind === "dir" ? !waiting : !run || ["succeeded", "failed", "cancelled"].includes(run.status);
    return { archived: !!r.archived, running: !!b?.running, concluded, waiting };
  };
  const markRead = (k: Key) => { const r = load(k); if (r && unread(k, r)) { r.read = new Date().toISOString(); save(k, r); notify(k); } };
  let self: any = null;
  // "Explain with": the room presented by a skill (src/domain/review-explain.ts), on the room tutor's seat; questions are the tutor's
  const explainer = installExplainer({ engine, dataDir: o.dataDir, role: TUTOR_ROLE, keyOf, load, subjectOf, offerOf, tutorFor, admit, ensureHost: (k, _offer, by) => ensureHost(k, by),
    tutorBusy: () => false, subjectRecord,
    beforePaid: async (k) => { if (k.kind !== "pr") return; const r0 = load(k);
      if (r0?.subject?.url && Date.now() - Date.parse(r0.pr?.checkedAt ?? "0") >= PR_FRESH_MS()) { try { await readPr(r0.subject.url); } catch (e: any) { throw refuse(`Studio could not read the pull request again on GitHub before this paid run: ${String(e?.message ?? e).slice(0, 200)} / Studio 在這次付費執行前沒辦法再讀一次 GitHub 上的 pull request`, "stale"); } }
      const r1 = load(k); if (r1?.pr?.stale && r1.pr.state === "open") throw refuse("GitHub shows newer commits Studio could not fetch yet: check for new commits before a paid run / GitHub 上有 Studio 還沒抓到的新 commit：付費執行前請先檢查新的 commit", "stale"); },
    // its own live event: a run's progress redraws the explainer's parts, never the whole room (whose output frame would reload);
    // a run that ends in a finished room saves its pages to the Library then (autoSave waits for it)
    notify: (k) => { try { engine.deps.send("review-explain", { card: k.id }); } catch {}
      // a room's first page gives it its file (the room list reads rooms by their files)
      try { if (!existsSync(k.file) && explainer.pages(k.id).length) { save(k, fresh(k, subjectOf(k))); notify(k); } } catch {}
      // a page made at the room's head is the captain's look at it: "new commits since you last looked" counts from there
      try { if (!explainer.running(k.id)) { const r = load(k), b = explainer.brief(k.id), h = r && b?.heads.length ? subjectOf(k).head : null; if (r && h && b?.heads.includes(h) && r.seen?.head !== h) { r.seen = { head: h, at: new Date().toISOString() }; save(k, r); } } } catch {}
      try { if (self && !explainer.running(k.id)) autoSave(self, k); } catch {} },
    github: (k, room) => { const repo = room?.subject?.repository; let p: any = repo ? connected(repo) : null;
      if (!p) { const run = k.run ? engine.get(k.run) : null, pid = run?.params?.project; if (pid && run?.ctx?.pr?.adapter === "github") p = (o.projects as any)?.get?.(pid) ?? null; }
      if (!p) return null; const a = o.github?.(p) ?? null; return a && (!repo || String(a.grant.repository).toLowerCase() === String(repo).toLowerCase()) ? a : null; } });
  const libraryView = (r: Room | null) => r?.library && library().get(r.library.artifact) ? { artifact: r.library.artifact, versions: r.library.versions } : null;
  return (self = {
    /** the room's "Explain with" (src/domain/review-explain.ts): the picker's skills, its runs and versions, a version's page */
    explain: explainer,
    /** the summary a merge card shows: the room's pages and what they cost; never readiness, never an answer */
    summary(c: SCard) {
      if (c.kind !== "merge") return null; const b = explainer.brief(c.id);
      return { href: `#/room/${encodeURIComponent(c.id)}`, opened: !!stats()[c.run]?.openedAt, versions: b?.versions ?? 0, questions: b?.questions ?? 0, usd: b?.usd ?? 0, running: !!b?.running, latest: b?.latest ?? null };
    },
    /** A Task's entry to the room on its reviewed branch (the Task page): once Studio's review passed at its head, or a room exists. */
    taskEntry(run: any) {
      if (isDirHostRun(run)) { const id = String(run.params?.room ?? ""); return ROOM_ID.test(id) && id.startsWith("DIR-") ? { href: `#/room/${id}`, host: true, pr: null, dir: String(run.params?.dir ?? ""), reviewed: true, head: null, branch: null, local: false, versions: 0, moved: false } : null; }
      if (isHostRun(run)) { const p = parsePrUrl(run.params?.pr); return p ? { href: `#/room/${prRoomId(p.repository, p.n)}`, host: true, pr: p.url, reviewed: true, head: null, branch: null, local: false, versions: 0, moved: false } : null; }
      try { if (!run?.ctx?.repo || !reviewNode(run)) return null; const k = keyOf(run.id), head = String(run.ctx.taintedReady?.head ?? run.ctx.head ?? ""), ok = SHA.test(head) && reviewed(run, head), room = load(k);
        if (!ok && !room) return null;
        return { href: `#/room/${run.id}`, reviewed: ok, head, branch: run.ctx.branch ?? null, local: !!run.ctx.taintedReady, versions: explainer.brief(k.id)?.versions ?? 0, moved: !!room?.seen && room.seen.head !== head }; } catch { return null; }
    },
    /** the room as its page reads it; opened: the captain opened the page (recorded once per subject; a pull request is read again) */
    view(id: string, opened = false) {
      const k = keyOf(id);
      if (k.kind === "merge") { const c = k.card!;
        if (opened) { if (!stats()[c.run]?.openedAt) stat(k, { openedAt: new Date().toISOString() }); markRead(k); }
        const run = engine.get(c.run), r = load(k);
        let s0: S | null = null; try { s0 = subjectOf(k); } catch {}
        return { ...tutorView(k, s0, r, c.status === "open"), card: { id: c.id, run: c.run, node: c.node, title: c.title, status: c.status }, subject: { kind: "merge", room: c.id }, task: { id: c.run, title: run?.title ?? c.run }, pr: run?.ctx.pr ? { id: run.ctx.pr.id ?? null, url: run.ctx.pr.url ?? null } : null,
          head: s0?.head ?? r?.head ?? run?.ctx.pr?.head ?? run?.ctx.head ?? null, base: s0?.base ?? r?.base ?? run?.ctx.baseCommit ?? null, open: c.status === "open", closed: c.status === "open" ? null : closedText(k, r), running: explainer.running(c.id) ? -1 : null, offer: c.status === "open" ? offerOf(k) : null,
          diffstat: diffstatOf(s0, r), summary: this.summary(c), archived: !!r?.archived, oldBoard: oldBoard(r), library: libraryView(r) };
      }
      if (k.kind === "branch") { const run = engine.get(k.run!)!, head = String(run.ctx.taintedReady?.head ?? run.ctx.head ?? "");
        if (!load(k) && !(SHA.test(head) && reviewed(run, head))) throw refuse("Studio's review has not passed on this Task's branch yet: its room opens once it has / 這個任務的分支還沒通過 Studio 的審查：通過後才能開審查室", "not_reviewed"); }
      let s: S | null = null; try { s = subjectOf(k); } catch (e) { if (k.kind !== "pr" && k.kind !== "dir") throw e; }
      if (k.kind === "branch" && opened && !load(k)) save(k, fresh(k, s!));
      if (opened) { if (!stats()[k.stat]?.openedAt) stat(k, { openedAt: new Date().toISOString() }); markRead(k);
        // re-entering a pull request's room reads it again on GitHub (in the background, at most once a minute)
        const pr = k.kind === "pr" ? load(k) : null; if (pr?.subject?.url && Date.now() - Date.parse(pr.pr?.attemptedAt ?? pr.pr?.checkedAt ?? "0") > PR_RECHECK_MS) void readPr(pr.subject.url).catch(() => {}); }
      const r = load(k), run = k.run ? engine.get(k.run) : null, open = k.open() && !!s, sub = r?.subject ?? (s ? subjectRecord(k, s, r) : { kind: k.kind, room: k.id });
      const title = k.kind === "branch" ? { en: `Branch ${run?.ctx.branch ?? k.id}`, "zh-TW": `分支 ${run?.ctx.branch ?? k.id}` } : k.kind === "dir" ? dirTitle(r) : { en: `Pull request #${sub.number}: ${r?.pr?.title ?? ""}`, "zh-TW": `Pull request #${sub.number}：${r?.pr?.title ?? ""}` };
      return { ...tutorView(k, s, r, open), card: { id: k.id, run: k.run, node: k.node, title, status: open ? "open" : "closed" }, subject: sub, task: run ? { id: run.id, title: run.title ?? run.id } : null,
        pr: k.kind === "pr" ? { id: String(sub.number ?? ""), url: sub.url ?? null } : run?.ctx.pr?.adapter === "github" ? { id: run.ctx.pr.id ?? null, url: run.ctx.pr.url ?? null } : null, prState: prState(r), stale: r?.pr?.stale ?? null, checking: refreshing.has(k.id),
        head: s?.head ?? r?.head ?? null, base: s?.base ?? r?.base ?? null, reviewed: k.kind === "branch" && s ? reviewed(s.run, s.head) : null, local: !!run?.ctx.taintedReady, moved: movedOf(s, r), seen: r?.seen ?? null, heads: r?.heads ?? [],
        open, closed: open ? null : closedText(k, r), running: explainer.running(k.id) ? -1 : null, offer: open ? offerOf(k) : null,
        notes: [...(r?.pr?.notes ?? [])].reverse().slice(0, 200).map((x) => ({ ...x, bot: isBot(x) })),
        diffstat: k.kind === "dir" ? null : diffstatOf(s, r), summary: null, archived: !!r?.archived, oldBoard: oldBoard(r), library: libraryView(r),
        // a directory room: the directory, pinned at its commit (no pull request, diff, check for new commits or moved head)
        dir: k.kind === "dir" && r?.dir ? { repository: r.dir.repository, ref: r.dir.ref, refKind: r.dir.refKind, sha: r.dir.sha, path: r.dir.path, private: r.dir.private, files: r.dir.files, bytes: r.dir.bytes, parts: r.dir.parts, truncated: r.dir.truncated, fetchedAt: r.dir.fetchedAt, url: r.subject?.url ?? null, readme: !!r.dir.readme } : null };
    },
    /** every review room on this machine (merge cards, branches, pull requests, directories), each with its zone, open ones first,
     *  then the most recent: all of them, since the page searches this list. A room's time is its latest page's or run's */
    list() { const out: any[] = [], push = (id: string, file: string) => { try { const k = keyOf(id), r = load(k); if (!r) return; const st = statSync(file), b = explainer.brief(id);
        const title = k.kind === "merge" ? (k.card?.title?.en ?? id) : k.kind === "branch" ? `Branch ${engine.get(k.run!)?.ctx.branch ?? id}` : k.kind === "dir" ? dirTitle(r).en : `Pull request #${r.subject?.number ?? ""}: ${r.pr?.title ?? ""}`;
        out.push({ id, kind: k.kind, title, titleZh: k.kind === "merge" ? (k.card?.title?.["zh-TW"] ?? title) : k.kind === "dir" ? dirTitle(r)["zh-TW"] : title, open: k.open(), running: !!b?.running, versions: b?.versions ?? 0, questions: b?.questions ?? 0, usd: b?.usd ?? 0,
          oldBoard: oldBoard(r), repository: repositoryOf(k, r), zone: roomZone(zoneFacts(k, r)), updatedAt: b?.updatedAt ?? st.mtime.toISOString() }); } catch {} };
      try { for (const f of readdirSync(prDir)) if (/^PR-[0-9a-f]{12}-\d+\.json$/.test(f)) push(f.slice(0, -5), join(prDir, f)); } catch {}
      try { for (const f of readdirSync(dirDir)) if (/^DIR-[0-9a-f]{12}-[0-9a-f]{12}\.json$/.test(f)) push(f.slice(0, -5), join(dirDir, f)); } catch {}
      for (const run of engine.list()) { const d = join(engine.rdir(run.id), "review-room"); if (!existsSync(d)) continue; try { for (const f of readdirSync(d)) if (/^(SC-\d+|R-\d+)\.json$/.test(f)) push(f.slice(0, -5), join(d, f)); } catch {} }
      return out.sort((a, b) => Number(b.open) - Number(a.open) || String(b.updatedAt).localeCompare(String(a.updatedAt))); },
    /** Archive a room or restore it (the captain, on this Mac): it moves between 封存 and its own zone, and nothing else about it
     *  changes. A room with no file yet (a merge card's, before any page) gets one, or the list could not show it. */
    archive(id: string, on: unknown, by: string) { if (typeof on !== "boolean") throw refuse("archived is true or false", "bad_request");
      const k = keyOf(id); let room = load(k); if (!room) { const v = this.view(id); if (!on) return { archived: false, zone: null, view: v }; room = fresh(k, subjectOf(k)); }
      if (on) room.archived = { by: String(by ?? "captain").slice(0, 80), at: new Date().toISOString() }; else delete room.archived;
      save(k, room); notify(k); return { archived: on, zone: roomZone(zoneFacts(k, room)), view: this.view(id) }; },
    /** Paste a pull request's URL: Studio reads it (GET) and its head's commits (into its own cache), and opens its room. */
    async openPr(url: unknown) { const id = await readPr(String(url ?? "").slice(0, 400)); return { id, href: `#/room/${id}`, room: this.view(id) }; },
    /** Paste a GitHub directory's address (any repository: a public one, or a private one the captain's gh login reads): Studio
     *  reads it, pins its commit and opens its room */
    async openDir(url: unknown) { const id = await readDir(String(url ?? "").slice(0, 800)); return { id, href: `#/room/${id}`, room: this.view(id) }; },
    /** A room's record exactly as kept (an old room's whiteboard: its turns, scenes and drawings), for the captain to download.
     *  Read only; nothing in the file is changed or removed. */
    exportRoom(id: string) { const k = keyOf(id), r = load(k); if (!r) throw refuse("No such review room", "not_found");
      return { schema: 1, exportedAt: new Date().toISOString(), room: k.id, note: "Crew Studio review room record, as kept on disk (read only)", record: r }; },
    /** Studio-wide settings of the review room: the default tutor */
    settings() { return { tutor: settings().tutor }; },
    setSettings(a: { tutor?: unknown }) {
      if (a?.tutor === undefined) throw refuse("tutor is {provider, model} or null", "bad_request");
      const tutor = a.tutor === null ? null : pickable(a.tutor);
      writeFileSync(settingsFile(), JSON.stringify({ ...settings(), tutor })); return this.settings(); },
    /** the models the captain may pick as a tutor (the room list's Studio-wide default): this machine's, each with why it may
     *  not run, and Studio's default when it was entered by hand */
    tutorChoices() { const d = settings().tutor; return tutorsOf(null, d ? { provider: d.provider, model: d.model } : null, d ? [d] : []); },
    /** the providers a tutor may be entered by hand for (the ones staffing runs, and any this machine lists) */
    tutorProviders() { return tutorProviders(); },
    /** this room's tutor, picked by the captain: any model of a provider Studio runs; null goes back to Studio's default. Its
     *  independence from the author is shown, never enforced. */
    setTutor(id: string, pick: unknown, by: string) { const k = keyOf(id); let s: S | null = null; try { s = subjectOf(k); } catch {}
      if (!k.open()) throw refuse("This room takes no run now: its tutor stays as it was / 這間審查室現在不能執行：導師維持原樣", "closed");
      let room = load(k); if (!room) { if (!s) throw refuse("No such review room", "not_found"); room = fresh(k, s); }
      if (pick === null) delete room.tutor; else { const p = pickable(pick); room.tutor = { ...p, by: String(by ?? "captain").slice(0, 80), at: new Date().toISOString() }; }
      save(k, room); notify(k); return this.view(id); },
    /** Check for new commits: a pull request is read again on GitHub; a branch is read from its Task. Never a background loop. */
    async check(id: string) { const k = keyOf(id); if (k.kind === "pr") { const url = load(k)?.subject?.url; if (!url) throw refuse("No such review room", "not_found"); await readPr(url); } return this.view(id); },
    async saveToLibrary(id: string, by: string) { const k = keyOf(id); return queueSave(k.id, () => snapshot(this, k, `Saved by ${by}`)); },
    /** the engine calls this when a card is answered: a merge card's room finishes now (and its pages are saved once) */
    cardAnswered(c: SCard) { if (c.kind !== "merge") return; try { finish(this, keyOf(c.id), "The merge card was answered"); } catch {} },
    /** a room's save from the Library (a version, else the latest): a page save's manifest, or an old whiteboard's snapshot as kept */
    librarySnapshot(aid: string, n?: unknown) {
      if (!LIB_ID.test(aid)) throw refuse("No such saved room", "not_found"); const store = library(), a = store.get(aid); if (!a || a.source !== "room") throw refuse("No such saved room", "not_found");
      const vs = store.versions(aid), v = n != null && n !== "" ? vs.find((x) => x.n === Number(n)) : vs.at(-1); if (!v) throw refuse("No such version of this saved room", "not_found");
      const file = store.file(aid, v.n, "room.json"); if (!file) throw refuse("The snapshot file is missing", "not_found");
      const snap = JSON.parse(readFileSync(file, "utf8"));
      return { ...snap, artifact: aid, n: v.n, versions: vs.map((x) => ({ n: x.n, at: x.createdAt, summary: x.summary })), project: a.project, integrity: store.verify(aid, v.n) };
    },
    /** an old whiteboard snapshot's picture, as it was saved */
    libraryAsset(aid: string, n: number, name: string) {
      if (!LIB_ID.test(aid) || !/^(B\d+-\d+\.png|cap-[0-9a-f]{16}\.png)$/.test(name)) throw refuse("No such file", "not_found");
      const f = library().file(aid, n, `assets/${name}`); if (!f) throw refuse("No such file", "not_found"); return readFileSync(f); },
    /** tests: wait for a room's GitHub read, a page being made and a Library save */
    async settle(id: string, ms = 30000) { const t = Date.now(); while ((explainer.running(id) || refreshing.size || saving.size) && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 30)); return !explainer.running(id) && !saving.size; },
  });
}
