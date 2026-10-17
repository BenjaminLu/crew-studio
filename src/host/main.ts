import {bundledText} from '../bundled';
import { neutralizeMarkers } from "../operating-rules";
import { createHash } from "node:crypto";
import {writeNativeDiagnostic} from './native-errors';
import {NativeToolFailure,type NativeFailure} from './types';
import { fromError, fromExternal } from '../runtime/failures';
// The main-session controller: Studio as the single entry point to firstmate.
// It discovers sessions, holds the DRIVER LOCK (data/driver.json) so Studio
// and a terminal never write the same session at once, feeds one FIFO of
// inputs (captain chat, card notices, firstmate wakes) into the attached
// session one turn at a time, and bridges tool permissions to the captain.
// If a terminal starts writing the session while Studio holds it, Studio
// pauses and alerts the captain instead of forking the conversation.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { localExecutionNotice } from "../local-execution";
import { claudeHost } from "./claude";
import { codexHost } from "./codex";
import { PermissionBridge } from "./permission";
import { driving, mtimeOf, systemProbe, type ProcProbe } from "./probe";
import { InputQueue, lastArrival, type QItem, type QKind } from "./queue";
import type { AttachedSession, Host, HostEvent, HostId, SessionInfo, SessionPath } from "./types";
import { WakeReader, acknowledged } from "./wakes";
import { deliveryFor, filesLine } from "../attachments";
import { ChatLog } from "./chat-log";
import { claudeVendorMessage, externalError, type ExternalError } from "./external-errors";
import { redactText } from "../secure";
import { withScriptNote } from "../captain-script";
/** What captain-only native tools see as the captain's words: the text, or for a files-only message the files line. */
const captainText = (input: QItem | null) => input ? (input.text.trim() ? input.text : input.attachments?.length ? filesLine(input.attachments) : input.text) : "";

export type Driver = { holder: "studio" | "terminal" | "none"; host: HostId | null; sessionId: string | null; pid: number | null; since: string | null; resume?: string;
  /** a takeover: the session Studio forked, which stays untouched */
  forkedFrom?: string | null; mode?: TakeoverMode | null; handoff?: string | null;
  /** how Studio's session was made: a vendor fork, a new thread from a handoff (codex without a fork), or a fresh start */
  path?: SessionPath | null;
  /** the operating-rules section the live session last received (by session id): a takeover, a resume or an edit sends it again */
  rulesSent?: { session: string; hash: string } | null };
export type TakeoverMode = "takeover" | "rehearsal";
/** What a takeover started from and how the original terminal session looks now. */
export type Origin = { id: string; host: HostId; file: string | null; cwd: string; mode: TakeoverMode; model: string | null; permissionMode: string | null;
  at: string; handoff: string; terminal: string | null; originWrites: number; lastOriginWrite: string | null };
/** How the session Studio drives came to be, and the settings its vendor reports (Studio never overrides them). */
export type Drive = { host: HostId; path: SessionPath; statement: string; noFork: string | null; model: string | null; effort: string | null;
  approvalPolicy: string | null; sandbox: string | null; seededFrom: string | null; handoff: string | null; permissionMode?: string | null;
  /** claude: the mode the CLI reported (null until it does); the captain's autoMode rules; local unrestricted execution */
  effectivePermissionMode?: string | null; autoMode?: { state: string; summary: string; summaryZh?: string } | null; executionMode?: "default" | "local-unrestricted" | null };
export type MainState = "detached" | "attaching" | "detaching" | "attached" | "paused";
export type MainView = {
  state: MainState; driver: Driver; host: HostId | null; sessionId: string | null; model: string | null; busy: boolean;
  pausedReason: string | null; queue: QItem[]; approvals: ReturnType<PermissionBridge["pending"]>; log: LogItem[]; resume: string | null; project: string;
  origin: Origin | null; context?: "studio" | "explicit-project"; holdWakes: boolean; wakeGraceMs: number; drive: Drive | null;
};
/** a chat note in both UI languages: text keeps the English line (filters and older readers use it), i18n carries both */
const bi = (en: string, tw: string): { text: string; i18n: { en: string; "zh-TW": string } } => ({ text: en, i18n: { en, "zh-TW": tw } });
const TURN_ZH: Record<string, string> = { failed: "失敗", interrupted: "已中斷", cancelled: "已取消", timeout: "逾時" };
export type LogItem = { at: number; kind: "captain" | "card" | "wake" | "firstmate" | "tool" | "status" | "system"; text: string; /** the same note for the UI in each language; text stays the English line */ i18n?: { en: string; "zh-TW": string }; source?: string; status?: string; refusal?: import("./types").HostRefusalCode; nativeFailure?:NativeFailure; /** the failure's class and code (runtime/failures.ts) */ failure?: import("../runtime/failures").Failure; links?:{label:string;href:string}[];
  /** a captain message's attachments (ids and labels; served from /api/main/attachments/<id>) */
  attachments?: import("../attachments").AttachmentRef[];
  /** why the attachments of a captain message could not be sent: typed, never a silent drop */
  attachmentRefusal?: import("../attachments").AttachmentRefusalCode;
  /** the primary session this line belongs to (kept on disk, so earlier sessions show as their own blocks) */
  session?: SessionLabel | null;
  /** an error from outside Studio (vendor, CLI, network, process, attachment), typed, with the exact external message */
  external?: ExternalError };
export type SessionLabel = { host: HostId; id: string; model: string | null };

export type MainOpts = {
  dataDir: string; projectDir: string; stateDir: string; probe?: ProcProbe;
  hosts?: Record<HostId, Host>; permissionMcp: (bridge: PermissionBridge) => { command: string[]; env: Record<string, string> };
  pollMs?: number;
  /** Fresh Studio-owned workspace: no legacy repository handoff or dispatch scripts. */
  nativeWorkspace?: boolean;
  onGeneratedImage?: (image:import("./types").GeneratedImage,owner:import("../media-library").MediaOwner)=>Promise<void>;
  nativeTools?: ()=>import("./types").NativeMainTools;
  /** the captain's operating rules for the active project (Studio-wide and project), read when a seed is written */
  operatingRules?: () => string;
  /** argv of Studio's MCP helper (src/mcp.ts): how a fresh Claude primary reaches nativeTools over owned stdio */
  studioMcp?: () => string[];
  onNativeProposal?: (origin:import("./native-outcomes").NativeOrigin,result:unknown)=>void;
  nativeOutcomes?: (host:string|null,thread:string|null)=>LogItem[];
  /** where the chat log is kept across restarts (data/chat-log); none: memory only */
  chatLog?: ChatLog;
  /** the stored files behind a captain message's attachment ids (src/attachments.ts AttachmentStore.resolve) */
  attachmentFiles?: (ids: string[]) => ReturnType<import("../attachments").AttachmentStore["resolve"]>;
  /** how long a new wake waits for firstmate's own hook to deliver it before Studio sends it itself */
  wakeGraceMs?: number;
};

export class MainSession {
  readonly hosts: Record<HostId, Host>;
  readonly queue = new InputQueue();
  readonly bridge = new PermissionBridge();
  private probe: ProcProbe;
  private session: AttachedSession | null = null;
  private state: MainState = "detached";
  private pausedReason: string | null = null;
  private log: LogItem[] = [];
  private reply = "";
  private wakes: WakeReader | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private sessionFile: string | null = null;
  private lastOwnWrite = 0;
  private lastSeenMtime = 0;
  private lastResume: string | null = null;
  private own = new Set<number>();
  private origin: Origin | null = null;
  private drive: Drive | null = null;
  private originMtime = 0;
  private seenWakes = new Set<string>();
  private lastTerminalCheck = 0;
  onView: (v: MainView) => void = () => {};
  onEvent: (e: HostEvent) => void = () => {};

  constructor(readonly o: MainOpts) {
    if (o.chatLog) { this.log = o.chatLog.load(400); this.lastLabel = [...this.log].reverse().find((x) => x.session)?.session ?? null; }
    this.probe = o.probe ?? systemProbe;
    this.hosts = o.hosts ?? { claude: claudeHost(), codex: codexHost() };
    this.queue.onChange = () => this.changed();
    this.bridge.onChange = () => this.changed();
  }

  get wakeGraceMs() { return this.o.wakeGraceMs ?? Number(process.env.CREW_WAKE_GRACE_MS ?? 10_000); }
  async start() {
    await this.bridge.listen();
    const d = this.driver();
    // Studio restarted while it held a session: its CLI died with it; keep the way back
    if (d.holder === "studio") this.writeDriver({ holder: "none", host: d.host, sessionId: d.sessionId, pid: null, since: new Date().toISOString(),
      resume: d.sessionId && !(this.o.nativeWorkspace && d.path === "fresh" && !d.forkedFrom && !d.mode) ? this.hosts[d.host ?? "claude"].resumeCommand(d.sessionId) : undefined, forkedFrom: d.forkedFrom ?? null, mode: d.mode ?? null, handoff: d.handoff ?? null, path: d.path ?? null });
  }
  stop() { if (this.timer) clearInterval(this.timer); this.bridge.close(); }

  private get driverFile() { return join(this.o.dataDir, "driver.json"); }
  driver(): Driver { try { return JSON.parse(readFileSync(this.driverFile, "utf8")); } catch { return { holder: "none", host: null, sessionId: null, pid: null, since: null }; } }
  private writeDriver(d: Driver) { if (d.rulesSent === undefined) { const prev = this.driver().rulesSent; if (prev) d = { ...d, rulesSent: prev }; } const tmp = this.driverFile + ".tmp"; writeFileSync(tmp, JSON.stringify(d, null, 2), { mode: 0o600 }); renameSync(tmp, this.driverFile); }

  view(): MainView {
    return { state: this.state, driver: this.driver(), host: this.session?.host ?? null, sessionId: this.session?.id ?? null, model: this.session?.model ?? null,
      busy: this.session?.busy ?? false, pausedReason: this.pausedReason, queue: this.queue.list(), approvals: this.bridge.pending(), log: [...this.log, ...(this.o.nativeOutcomes?.(this.session?.host ?? this.driver().host,this.session?.id ?? this.driver().sessionId) ?? [])].sort((a,b)=>a.at-b.at).slice(-200),
      resume: this.lastResume, project: this.o.projectDir, context: this.o.nativeWorkspace ? "studio" : "explicit-project", origin: this.origin, holdWakes: this.origin?.mode === "rehearsal", wakeGraceMs: this.wakeGraceMs,
      drive: this.drive ? { ...this.drive, model: (this.session && this.session.model !== this.session.host ? this.session.model : null) ?? this.drive.model, effort: this.session?.effort ?? this.drive.effort } : null };
  }
  private changed() { try { this.onView(this.view()); } catch {} }
  private lastLabel: SessionLabel | null = null;
  private sessionLabel(): SessionLabel | null {
    if (this.session) this.lastLabel = { host: this.session.host, id: this.session.id, model: this.session.model && this.session.model !== this.session.host ? this.session.model : this.lastLabel?.id === this.session.id ? this.lastLabel.model : null };
    return this.lastLabel;
  }
  note(i: Omit<LogItem, "at">) {
    const item: LogItem = { at: Date.now(), ...i, text: redactText(i.text), session: this.sessionLabel() };
    if (item.external && !item.failure) item.failure = fromExternal(item.external); // every failed notice carries its class and code
    this.log.push(item); if (this.log.length > 400) this.log.splice(0, this.log.length - 400);
    this.o.chatLog?.append(item);
  }
  /** A failed turn or a vendor refusal, as a typed notice with the CLI's own words. */
  private external(source: HostId, raw: unknown, o: Parameters<typeof externalError>[2] = {}, extra: Partial<LogItem> = {}) {
    const ext = externalError(source, raw, o);
    this.note({ kind: "status", text: `${ext.reason.en} ${ext.message}`, status: "failed", external: ext, ...extra });
  }
  private refusedThisTurn = false;
  private lastExit: { code: number | null; stderr: string } | null = null;

  /** Sessions of the project for one host, each marked if a terminal may be driving it. */
  async discover(host: HostId): Promise<SessionInfo[]> {
    const list = await this.hosts[host].discover(this.o.projectDir);
    return list.map((s, i) => {
      const why = this.session?.id === s.id ? null : driving(this.probe, { host, id: s.id, cwd: s.cwd, file: s.file, newestInDir: i === 0 }, this.own);
      return { ...s, possiblyOpen: !!why, openReason: why };
    });
  }

  /** Sessions of the project from every host, newest first; a host that fails to list adds none. */
  async discoverAll(): Promise<SessionInfo[]> {
    const all = await Promise.all((Object.keys(this.hosts) as HostId[]).filter((h, i, a) => a.indexOf(h) === i && this.hosts[h].id === h)
      .map((h) => this.discover(h).catch(() => [] as SessionInfo[])));
    return all.flat().sort((a, b) => b.updated - a.updated);
  }

  async attach(host: HostId, id: string): Promise<{ ok: true } | { ok: false; reason: string; code: string }> {
    if (this.state !== "detached") return { ok: false, code: "attached", reason: "Studio already holds a session; hand it back first" };
    const priorDriver = this.driver();
    this.state = "attaching"; this.changed();
    try {
    const sessions = await this.hosts[host].discover(this.o.projectDir);
    const k = sessions.findIndex((s) => s.id === id);
    if (k < 0) { this.state = "detached"; this.changed(); return { ok: false, code: "unknown", reason: "no such session in this project" }; }
    const s = sessions[k];
    const why = driving(this.probe, { host, id, cwd: s.cwd, file: s.file, newestInDir: k === 0 }, this.own);
    if (why) { this.state = "detached"; this.changed(); return { ok: false, code: "terminalDriving", reason: `a terminal is driving this session: ${why}. Exit it there first.` }; }
    try {
      this.session = await this.hosts[host].attach(id, {
        cwd: s.cwd,
        onGeneratedImage:this.generatedImageCapability(), onEvent: (e) => this.hostEvent(e),
        onPermission: (r) => this.bridge.ask(r),
        permissionMcp: this.o.permissionMcp(this.bridge),
      });
    } catch (e: any) {
      this.state = "detached"; this.changed();
      return { ok: false, code: "attachFailed", reason: String(e?.message ?? e) };
    }
    this.sessionFile = s.file;
    this.lastSeenMtime = mtimeOf(s.file);
    this.writeDriver({ holder: "studio", host, sessionId: this.session.id, pid: process.pid, since: new Date().toISOString() });
    this.drive = null; this.origin = null;
    this.state = "attached"; this.pausedReason = null; this.lastResume = null;
    this.wakes = new WakeReader(this.o.stateDir);
    this.note({ kind: "status", ...bi(`Attached to ${host} session ${this.session.id}`, `已接上 ${host} session ${this.session.id}`) });
    this.timer = setInterval(() => this.tick(), this.o.pollMs ?? 1000);
    this.changed();
    void this.pump();
    return { ok: true };
    } catch (e: any) {
      this.bridge.denyAll("Session startup failed; denied");
      const failed = this.session; this.session = null;
      if (failed) { if (failed.pid) this.own.delete(failed.pid); try { await failed.detach(); } catch {} }
      if (this.timer) { clearInterval(this.timer); this.timer = null; }
      this.state = "detached"; this.origin = null; this.drive = null; this.wakes = null; this.sessionFile = null;
      try { this.writeDriver(priorDriver); } catch {}
      this.changed();
      return { ok: false, code: "startupFailed", reason: String(e?.message ?? e) };
    }
  }

  /** Take over a session as a COPY (`--fork-session`): the original id is never resumed or written, so the
   *  terminal keeps its conversation. Same cwd, model and permission mode; tool prompts come to Studio.
   *  "rehearsal" also sets FM_IN_ROUND=1, so firstmate's hooks stand down in the copy and its wakes are only shown. */
  async takeover(host: HostId, id: string, mode: TakeoverMode): Promise<{ ok: true; handoff: string; path: SessionPath; statement: string } | { ok: false; reason: string; code: string }> {
    if (this.state !== "detached") return { ok: false, code: "attached", reason: "Studio already holds a session; release it first" };
    const priorDriver = this.driver();
    this.state = "attaching"; this.changed();
    try {
    const sessions = await this.hosts[host].discover(this.o.projectDir);
    const k = sessions.findIndex((s) => s.id === id);
    if (k < 0) { this.state = "detached"; this.changed(); return { ok: false, code: "unknown", reason: "no such session in this project" }; }
    const s = sessions[k];
    const terminal = driving(this.probe, { host, id, cwd: s.cwd, file: s.file, newestInDir: k === 0 }, this.own);
    try {
      this.session = await this.hosts[host].attach(id, {
        cwd: s.cwd, fork: true, model: s.model ?? null, permissionMode: s.permissionMode ?? null,
        env: mode === "rehearsal" ? { FM_IN_ROUND: "1" } : undefined,
        onGeneratedImage:this.generatedImageCapability(), onEvent: (e) => this.hostEvent(e),
        onPermission: (r) => this.bridge.ask(r),
        permissionMcp: this.o.permissionMcp(this.bridge),
      });
    } catch (e: any) {
      this.state = "detached"; this.changed();
      return { ok: false, code: "attachFailed", reason: String(e?.message ?? e) };
    }
    if (this.session.pid) this.own.add(this.session.pid);
    const at = new Date().toISOString();
    const se = this.session, H = this.hosts[host];
    const path: SessionPath = host === "claude" ? "fork" : se.path === "handoff" ? "handoff" : "fork";
    const newest = path === "handoff" ? newestHandoffFile(this.o.stateDir) : null;
    const statement = path === "handoff" ? "Codex has no fork; Studio started a new thread from a handoff"
      : host === "codex" ? "Codex forked the thread (thread/fork); the original is never resumed" : "Claude Code forked the session (--fork-session); the original is never resumed";
    const original = `cd ${s.cwd} && ${H.resumeCommand(id)}`;
    const handoff = this.writeHandoff(`${at.replace(/[:.]/g, "-")}-${id.slice(0, 8)}.md`, [
      `# Handoff: ${mode === "rehearsal" ? "rehearsal" : "takeover"} of firstmate session ${id} (${host})`, "",
      `- When: ${at}`, `- Host: ${host}`, `- How: ${statement}${se.noFork ? ` (thread/fork answered: ${se.noFork})` : ""}`,
      `- Original session (left untouched, never resumed by Studio): ${id}`,
      `- Copy Studio drives: ${se.id !== id ? se.id : "assigned on its first turn (see the release section)"}`,
      `- cwd: ${s.cwd}`, `- model: ${se.model && se.model !== host ? se.model : s.model ?? "(the CLI default)"}${host === "codex" ? `; reasoning effort: ${se.effort ?? s.effort ?? "(the config default)"} (from the captain's Codex config; Studio sets neither)` : ""}`,
      host === "claude" ? `- permission mode: ${s.permissionMode ?? "(default)"}; every prompt goes to Studio's permission bridge, and any failure denies`
        : `- approval policy: ${se.approvalPolicy ?? "(config)"}; sandbox: ${se.sandbox ?? "(config)"}; every approval request goes to Studio's permission bridge, and any failure declines`,
      host === "claude" ? `- hooks and MCP: the project's own (.claude/settings*.json, .mcp.json), loaded by the CLI in that cwd` : `- hooks: the project's own (.codex/hooks.json), loaded by the app-server in that cwd`,
      path === "handoff" ? `- Seeded with: the original's recent turns (read with thread/turns/list) and ${newest ? `state/${newest.name}` : "no state/HANDOFF-*.md (none found)"}` : null,
      mode === "rehearsal" ? `- Rehearsal: FM_IN_ROUND=1, so firstmate's hooks stand down in the copy; wakes are shown and held, never sent`
        : host === "claude" ? `- Wakes: firstmate's own Stop hook (asyncRewake) in the copy delivers them; Studio shows each and sends any the hook has not delivered after ${Math.round(this.wakeGraceMs / 1000)}s`
        : `- Wakes: Codex's Stop hook cannot wake an idle thread, so Studio shows each wake and sends any firstmate has not acknowledged after ${Math.round(this.wakeGraceMs / 1000)}s`,
      `- The terminal at takeover: ${terminal ?? "no sign of it"}`, "",
      `## While Studio drives`, "",
      host === "codex" ? `Keep the original Codex terminal idle and exit it after its background agents finish. Studio delivers firstmate wakes to the copy.` : `The terminal session must stay idle. Better: exit it once its background agents finish, because while it runs its own Stop hook keeps claiming firstmate's wakes.`, "",
      `## Roll back`, "",
      `1. In Studio press Release (or stop Studio).`, `2. In a terminal: \`${original}\` returns to the conversation as it was before the takeover.`, "",
    ].filter((l): l is string => l !== null));
    this.origin = { id, host, file: s.file, cwd: s.cwd, mode, model: s.model ?? null, permissionMode: s.permissionMode ?? null, at, handoff, terminal, originWrites: 0, lastOriginWrite: null };
    this.drive = { host, path, statement, noFork: se.noFork ?? null, model: s.model ?? null, effort: s.effort ?? null, approvalPolicy: se.approvalPolicy ?? null, sandbox: se.sandbox ?? null,
      seededFrom: newest ? `state/${newest.name}` : null, handoff };
    this.originMtime = mtimeOf(s.file);
    this.sessionFile = null; // the copy's file is known once the CLI names it
    this.lastSeenMtime = 0;
    this.writeDriver({ holder: "studio", host, sessionId: id, pid: process.pid, since: at, forkedFrom: id, mode, handoff, path });
    if (se.id !== id) this.followCopy(id, se.id, se.file ?? null);
    this.state = "attached"; this.pausedReason = null; this.lastResume = null;
    this.wakes = new WakeReader(this.o.stateDir);
    this.seenWakes.clear();
    this.note({ kind: "status", ...bi(`${mode === "rehearsal" ? "Rehearsal" : "Took over"}: Studio drives a copy of ${id}. The terminal session must stay idle.`, `${mode === "rehearsal" ? "演練" : "已接手"}：Studio 駕駛 ${id} 的複本；終端機 session 必須保持閒置。`) });
    if (host === "codex") this.note({ kind: "status", text: statement });
    if (terminal) this.note({ kind: "system", ...(host === "codex" ? bi(`The original Codex terminal still looks open (${terminal}). Keep it idle and exit it after its background agents finish. Studio delivers wakes to the copy.`, `原本的 Codex 終端機看起來還開著（${terminal}）。請保持閒置，等它的背景 agent 結束後再退出；Studio 會把喚醒送到複本。`) : bi(`The terminal still looks open (${terminal}). Keep it idle; exit it after its background agents finish, or its Stop hook keeps taking firstmate's wakes.`, `終端機看起來還開著（${terminal}）。請保持閒置；等它的背景 agent 結束後再退出，否則它的 Stop hook 會繼續攔下 firstmate 的喚醒。`)) });
    if (path === "handoff") this.queue.seed(withRulesSeed(seedText({ host, original: id, cwd: s.cwd, turns: se.recentTurns ?? null, handoff: newest }), this.o.operatingRules));
    this.timer = setInterval(() => this.tick(), this.o.pollMs ?? 1000);
    this.changed();
    if (path === "handoff") void this.pump();
    return { ok: true, handoff, path, statement };
    } catch (e: any) {
      this.bridge.denyAll("Session startup failed; denied");
      const failed = this.session; this.session = null;
      if (failed) { if (failed.pid) this.own.delete(failed.pid); try { await failed.detach(); } catch {} }
      if (this.timer) { clearInterval(this.timer); this.timer = null; }
      this.state = "detached"; this.origin = null; this.drive = null; this.wakes = null; this.sessionFile = null;
      try { this.writeDriver(priorDriver); } catch {}
      this.changed();
      return { ok: false, code: "startupFailed", reason: String(e?.message ?? e) };
    }
  }

  /** "Start firstmate on <host>": a NEW session in the firstmate repo, following its AGENTS.md, whose first message is the newest state/HANDOFF-*.md. */
  async startFresh(host: HostId, validate?: (identity:{model:string;effort:string|null})=>boolean, extra?: { locale?: "en"|"zh-TW"|"zh-CN"; env?: Record<string, string>; model?: string | null; effort?: string | null; permissionMode?: "auto" | "default"; autoMode?: { state: string; summary: string; summaryZh?: string } }): Promise<{ ok: true; handoff: string; id: string; seededFrom: string | null } | { ok: false; reason: string; code: string }> {
    if (this.state !== "detached") return { ok: false, code: "attached", reason: "Studio already holds a session; release it first" };
    if (host !== "codex" && !(host === "claude" && this.o.nativeWorkspace)) return { ok: false, code: "host", reason: "a fresh start runs on Codex, or on Claude in Studio's own workspace" };
    const priorDriver = this.driver();
    this.state = "attaching"; this.changed();
    try {
    const cwd = this.o.projectDir, newest = this.o.nativeWorkspace ? null : newestHandoffFile(this.o.stateDir);
    try {
      this.session = await this.hosts[host].attach("", { cwd, fresh: true, onGeneratedImage:this.generatedImageCapability(), onEvent: (e) => this.hostEvent(e), onPermission: (r) => this.bridge.ask(r), permissionMcp: this.o.permissionMcp(this.bridge), nativeTools:this.nativeCapability(),
        ...(host === "claude" ? { env: extra?.env, model: extra?.model ?? null, permissionMode: extra?.permissionMode ?? "default", denyEdits: claudeDenyEdits(extra?.env?.CLAUDE_CONFIG_DIR), studioMcp: this.o.studioMcp ? { command: this.o.studioMcp() } : undefined } : {}) });
    } catch (e: any) {
      this.state = "detached"; this.changed();
      return { ok: false, code: "attachFailed", reason: String(e?.message ?? e) };
    }
    // Trusted synchronous host admission: no seed, driver, handoff or pump may
    // precede verification of the identity actually returned by thread/start.
    if(validate&&validate({model:this.session.model,effort:this.session.effort??null})!==true)throw new Error("Fresh host identity unverified / 新主對話身分尚未驗證");
    if (this.session.pid) this.own.add(this.session.pid);
    const se = this.session, at = new Date().toISOString();
    const vendor = host === "claude" ? "Claude Code" : "Codex";
    const statement = `Studio started a new firstmate ${host === "claude" ? "session" : "thread"} on ${vendor} in ${cwd}${newest ? `, first message: state/${newest.name}` : this.o.nativeWorkspace ? " (Studio-owned workspace)" : " (no state/HANDOFF-*.md found)"}`;
    const handoff = this.writeHandoff(`${at.replace(/[:.]/g, "-")}-fresh-${se.id.slice(0, 8)}.md`, [
      `# Handoff: fresh firstmate on ${host}`, "", `- When: ${at}`, `- Host: ${host}`, `- The copy Studio drives is ${se.id}`, `- cwd: ${cwd} (${this.o.nativeWorkspace ? "Studio-owned workspace" : "explicit project; AGENTS.md applies"})`,
      ...(host === "claude" ? [
        `- model: ${extra?.model ?? "(the CLI default)"}; effort: ${extra?.effort ?? "(the CLI default)"} (the pair the Claude account card checks)`,
        `- config: Studio's own Claude config folder; signs in with the crew token, never the captain's interactive login`,
        `- permission mode: ${extra?.permissionMode ?? "default"}; Studio's native tools are allowed by name, ${extra?.permissionMode === "auto" ? "Claude's auto-mode classifier decides the rest and whatever it escalates goes" : "every other prompt goes"} to Studio's permission bridge, and any failure denies`,
      ] : [
      `- model: ${se.model}; reasoning effort: ${se.effort ?? "(config default)"} (from the captain's Codex config; Studio sets neither)`,
      `- approval policy: ${se.approvalPolicy ?? "(config)"}; sandbox: ${se.sandbox ?? "(config)"}; every approval request goes to Studio's permission bridge, and any failure declines`]),
      `- First message: ${newest ? `state/${newest.name}` : this.o.nativeWorkspace ? "Studio-owned native Firstmate introduction" : "no state/HANDOFF-*.md found"}`, "",
      `## Roll back`, "", this.o.nativeWorkspace ? "Stop Firstmate in Studio. This closes the owned primary; dispatched native Tasks keep their own lifecycle. Start a new primary explicitly when ready." : `Release in Studio, then continue the thread in a terminal: \`cd ${cwd} && ${this.hosts[host].resumeCommand(se.id)}\``, "",
    ]);
    this.origin = null;
    this.drive = { host, path: "fresh", statement, noFork: null, model: host === "claude" ? extra?.model ?? null : se.model, effort: host === "claude" ? extra?.effort ?? null : se.effort ?? null, approvalPolicy: se.approvalPolicy ?? null, sandbox: se.sandbox ?? null, permissionMode: host === "claude" ? extra?.permissionMode ?? "default" : null, effectivePermissionMode: null, autoMode: host === "claude" ? extra?.autoMode ?? null : null, executionMode: host === "claude" ? (localExecutionNotice() ? "local-unrestricted" : "default") : null,
      seededFrom: newest ? `state/${newest.name}` : null, handoff };
    this.sessionFile = se.file ?? null; this.lastSeenMtime = mtimeOf(this.sessionFile);
    this.writeDriver({ holder: "studio", host, sessionId: se.id, pid: process.pid, since: at, forkedFrom: null, mode: null, handoff, path: "fresh" });
    this.state = "attached"; this.pausedReason = null; this.lastResume = null;
    this.wakes = new WakeReader(this.o.stateDir);
    this.seenWakes.clear();
    this.note({ kind: "status", text: statement });
    if (host === "claude" && extra?.autoMode) this.note({ kind: "status", ...bi(`The captain's auto-mode rules are ${extra.autoMode.summary}`, `船長的 auto mode 規則：${extra.autoMode.summaryZh || extra.autoMode.summary}`) });
    // local unrestricted mode (operator .env): a Claude primary is told so in its first message, as Codex is on every turn (after the rules, before the body)
    const body = this.o.nativeWorkspace ? nativeFreshText(cwd, (() => { try { const n = this.o.nativeTools?.().specs.map((t) => t.name) ?? []; return n.length ? n : undefined; } catch { return undefined; } })(),extra?.locale) : freshText(cwd, newest);
    this.queue.seed(withRulesSeed(body + (this.o.nativeWorkspace ? "\n\n"+(bundledText("workflows/skills/firstmate-workflow-design/SKILL.md")??"") : ""), this.o.operatingRules, !!this.o.nativeWorkspace, host === "claude" ? localExecutionNotice() : ""));
    this.timer = setInterval(() => this.tick(), this.o.pollMs ?? 1000);
    this.changed();
    void this.pump();
    return { ok: true, handoff, id: se.id, seededFrom: newest ? `state/${newest.name}` : null };
    } catch (e: any) {
      this.bridge.denyAll("Session startup failed; denied");
      const failed = this.session; this.session = null;
      if (failed) { if (failed.pid) this.own.delete(failed.pid); try { await failed.detach(); } catch {} }
      if (this.timer) { clearInterval(this.timer); this.timer = null; }
      this.state = "detached"; this.origin = null; this.drive = null; this.wakes = null; this.sessionFile = null;
      try { this.writeDriver(priorDriver); } catch {}
      this.changed();
      return { ok: false, code: "startupFailed", reason: String(e?.message ?? e) };
    }
  }

  /** Studio's copy got its own id: the lock and the handoff note name it. */
  private followCopy(oldId: string, newId: string, file: string | null) {
    const d = this.driver(); if (d.holder === "studio") this.writeDriver({ ...d, sessionId: newId });
    if (!this.origin) { if (this.sessionFile) this.sessionFile = this.sessionFile.replace(oldId, newId); return; }
    this.sessionFile = file ?? (this.origin.file ? this.origin.file.replace(this.origin.id, newId) : null);
    this.lastSeenMtime = Date.now();
    try { appendFileSync(join(this.handoffDir(), this.origin.handoff), `\n## Copy\n\nThe copy Studio drives is ${newId}. Studio's handoff resume command: \`cd ${this.origin.cwd} && ${this.hosts[this.origin.host].resumeCommand(newId)}\`\n`); } catch {}
  }

  private handoffDir() { const d = join(this.o.dataDir, "handoff"); mkdirSync(d, { recursive: true }); return d; }
  private writeHandoff(name: string, lines: string[]) { const f = join(this.handoffDir(), name); writeFileSync(f, lines.join("\n") + "\n", { mode: 0o600 }); return name; }
  handoffs(): { name: string; text: string }[] {
    try { return readdirSync(this.handoffDir()).filter((f) => f.endsWith(".md")).sort().reverse().slice(0, 10).map((name) => ({ name, text: readFileSync(join(this.handoffDir(), name), "utf8") })); } catch { return []; }
  }

  enqueue(kind: QKind, text: string, source: string, attachments?: import("../attachments").AttachmentRef[], repair?: { draft: string; nonce: string }) {
    const item = this.queue.push(kind, text, source, undefined, attachments, repair);
    this.changed();
    void this.pump();
    return item;
  }

  private generatedImageCapability():import("./types").AttachOpts["onGeneratedImage"]{return async image=>{const generation=this.nativeGeneration,session=this.session;const live=()=>!!session&&session===this.session&&session.id===image.thread&&this.state==="attached"&&this.nativeGeneration===generation&&image.live();const controller=new AbortController();this.nativeCalls.add(controller);try{if(!live()||!this.o.onGeneratedImage)throw new Error("Library image ownership unavailable");await this.o.onGeneratedImage(image,{signal:controller.signal,authorize:()=>{if(!live())throw new Error("Library image ownership ended");}});if(!live())throw new Error("Library image ownership ended");}finally{this.nativeCalls.delete(controller);}};}
  private nativeCapability():import("./types").AttachOpts["nativeTools"]{
    if(!this.o.nativeWorkspace||!this.o.nativeTools)return undefined;const tools=this.o.nativeTools();
    return{onDiagnostic:record=>writeNativeDiagnostic(this.o.dataDir,record),specs:tools.specs,call:async(name,args,identity)=>{const input=this.activeInput,generation=this.nativeGeneration,session=this.session;const live=()=>!!session&&session===this.session&&session.id===identity.thread&&this.state==="attached"&&this.activeInput===input&&this.nativeGeneration===generation&&identity.live();if(!live())throw new NativeToolFailure("owner_ended","The request no longer owns this session. Read the current state before continuing.","此請求已不再持有 session，請先讀取目前狀態。","read_current_state");const controller=new AbortController();this.nativeCalls.add(controller);try{const result=await tools.call(name,args,{key:`${identity.thread}:${identity.turn}`,captain:!!input&&input.kind==="chat"&&(input.source==="desktop"||input.source.startsWith("phone:")),text:captainText(input),live,signal:controller.signal,repair:input?.kind==="card"&&input.source==="studio-gate"?input.repair??null:null});if(!live())throw new NativeToolFailure("owner_ended","The request no longer owns this session. Read the current state before continuing.","此請求已不再持有 session，請先讀取目前狀態。","read_current_state");if(name==="studio_propose_work"&&input?.kind==="chat"&&(input.source==="desktop"||input.source.startsWith("phone:")))this.o.onNativeProposal?.({host:session!.host,thread:identity.thread,turn:identity.turn},result);return result;}finally{this.nativeCalls.delete(controller);}}};
  }
  private activeInput:QItem|null=null;
  private nativeGeneration=0;
  private nativeCalls=new Set<AbortController>();
  private abortNativeCalls(){for(const c of this.nativeCalls)c.abort();this.nativeCalls.clear();}
  private pumping = false;
  private compactions = 0;
  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.session && this.state === "attached" && !this.session.busy && this.queue.length) {
        this.pruneWakes();
        const item = this.queue.take((i) => this.ready(i));
        if (!item) break;
        this.note({ kind: item.kind === "chat" ? "captain" : item.kind, text: item.text, source: item.source, ...(item.attachments?.length ? { attachments: item.attachments } : {}) });
        // the captain's files go with this turn, or the turn is not sent: a typed refusal, never a silent drop
        let files: import("../attachments").AttachmentFile[] = [];
        if (item.attachments?.length) {
          const got = this.o.attachmentFiles ? this.o.attachmentFiles(item.attachments.map((a) => a.id)) : null;
          const fit = got?.ok ? deliveryFor(this.session.host, got.files) : got;
          if (!got || !got.ok || !fit || !fit.ok) {
            const why = fit && !fit.ok ? fit : { code: "attachmentMissing" as const, reason: { en: "Studio cannot read the attached files.", "zh-TW": "Studio 讀不到附件。" } };
            this.note({ kind: "status", text: `Not sent: ${why.reason.en} / ${why.reason["zh-TW"]}`, status: "failed", attachmentRefusal: why.code, external: { ...externalError("studio", why.reason.en, { cls: "attachment", code: why.code }), reason: why.reason } });
            this.changed(); continue;
          }
          files = got.files;
        }
        this.reply = "";
        this.lastOwnWrite = Date.now();
        this.changed();
        this.activeInput=item; this.refusedThisTurn = false; this.lastExit = null;
        // the operating rules reach every session once and again after each edit: a takeover, a resume or a restart has no seed
        let sendText = item.text, sentRules: { session: string; hash: string } | null = null;
        if (this.o.operatingRules) { const section = rulesNow(this.o.operatingRules), hash = createHash("sha256").update(section).digest("hex"), sid = this.session.id, prev = this.driver().rulesSent;
          if (prev?.session !== sid || prev.hash !== hash) { if (!item.text.startsWith(section) && !(item.source === "studio:handoff" && item.text.startsWith(`${localExecutionNotice()}\n\n${section}`))) sendText = withRulesTurn(item.text, section, prev?.session === sid); sentRules = { session: sid, hash }; } }
        // a captain who writes Traditional Chinese gets Traditional Chinese back, whatever the dashboard language
        if (item.kind === "chat") sendText = withScriptNote(sendText, item.text);
        const compactedBefore = this.compactions;
        const r = await this.session.send(sendText, files).catch((e) => ({ status: "failed" as const, message: String(e?.message ?? e), refusal: e?.refusal?.code as import("../attachments").AttachmentRefusalCode | undefined }));
        if ("refusal" in r && r.refusal) { this.activeInput = null; this.note({ kind: "status", text: `Not sent: ${r.message}`, status: "failed", attachmentRefusal: r.refusal, external: externalError("studio", r.message, { cls: "attachment", code: r.refusal }) }); this.changed(); continue; }
        this.activeInput=null;
        if (sentRules && r.status === "completed" && this.compactions === compactedBefore) this.writeDriver({ ...this.driver(), rulesSent: sentRules });
        this.lastOwnWrite = Date.now();
        this.lastSeenMtime = mtimeOf(this.sessionFile);
        if (r.status === "failed" && !this.refusedThisTurn) this.external(this.session?.host ?? "claude", r.message || (this.lastExit ? `exited ${this.lastExit.code}: ${this.lastExit.stderr.trim().split("\n").slice(-3).join(" ")}` : ""));
        // a refusal already showed as a typed notice for this turn: no second, grey "Turn failed" line
        else if (r.status !== "completed" && !(r.status === "failed" && this.refusedThisTurn)) this.note({ kind: "status", ...bi(`Turn ${r.status}${r.message ? `: ${r.message}` : ""}`, `回合${TURN_ZH[r.status] ?? `：${r.status}`}${r.message ? `：${r.message}` : ""}`), status: r.status });
        this.refusedThisTurn = false; this.lastExit = null;
        this.changed();
      }
    } finally { this.activeInput=null;this.pumping = false; }
  }

  /** A wake waits a grace period for firstmate's own hook; a rehearsal never sends one. */
  private ready(i: QItem) {
    if (i.kind !== "wake") return true;
    if (this.origin?.mode === "rehearsal") return false;
    return Date.now() - lastArrival(i) >= this.wakeGraceMs; // every folded wake has had its own grace
  }
  private pruneWakes() {
    for (const w of this.queue.prune((w) => !!w.id && acknowledged(this.o.stateDir, w.id, w.woken)))
      this.note({ kind: "system", ...bi(`wake delivered by firstmate's own hook: ${w.line}`, `喚醒已由 firstmate 自己的 hook 送達：${w.line}`) });
  }

  private hostEvent(e: HostEvent) {
    this.onEvent(e);
    // a compacted conversation may have summarised the rules away: the next turn carries them again
    if (e.type === "compacted") { this.compactions++; if (this.driver().rulesSent) this.writeDriver({ ...this.driver(), rulesSent: null }); }
    if(e.type==="nativeToolFailure")this.note({kind:"system",text:e.failure.reason.en,nativeFailure:e.failure,failure:fromError(Object.assign(new Error(e.failure.reason.en),{publicFailure:e.failure}),{source:"host"})});
    if (e.type === "turnStart") this.refusedThisTurn = false; // a turn Studio did not send starts clean
    if (e.type === "hostRefusal") { this.refusedThisTurn = true; this.note({ kind: "status", text: `${e.reason.en} / ${e.reason["zh-TW"]}`, i18n: e.reason, status: "failed", refusal: e.code,
      external: { ...externalError("claude", claudeVendorMessage(e.raw) || e.reason.en, { cls: e.code === "claudeQuotaExhausted" ? "quota" : e.code === "claudeNotSignedIn" ? "auth" : undefined, code: e.code }), reason: e.reason } }); }
    if (e.type === "exit") {
      this.lastExit = { code: e.code, stderr: e.stderr ?? "" };
      // a CLI that stops while nothing runs and Studio did not stop it: say so, with its own last words
      if (this.state === "attached" && !this.activeInput && !this.session?.busy && e.code !== 0 && e.code !== null)
        this.external(this.session?.host ?? "claude", `exited ${e.code}${e.stderr?.trim() ? `: ${e.stderr.trim().split("\n").slice(-3).join(" ")}` : ""}`, { cls: "exit" });
    }
    if (e.type === "turnEnd" && e.external) { if (e.status === "failed" && !this.refusedThisTurn) this.external(this.session?.host ?? "claude", e.message ?? ""); this.refusedThisTurn = false; }
    if (e.type === "turnStart") this.note({ kind: "system", ...(e.source === "task" ? bi("a background task's notice started a turn; following it", "背景任務的通知開始了一個回合；跟著它") : bi("a turn Studio did not send started (firstmate's wake hook, or a background task); following it", "開始了一個不是 Studio 送出的回合（firstmate 的喚醒 hook 或背景任務）；跟著它")) });
    if (e.type === "turnEnd" && e.external) { this.lastSeenMtime = mtimeOf(this.sessionFile); setTimeout(() => void this.pump(), 0); }
    if (e.type === "permissionMode" && this.drive && this.drive.host === "claude" && e.mode !== this.drive.effectivePermissionMode) {
      this.drive.effectivePermissionMode = e.mode;
      this.note({ kind: "system", ...bi(claudeModeLine(this.drive.permissionMode ?? null, e.mode), claudeModeLineZh(this.drive.permissionMode ?? null, e.mode)) });
      this.changed();
    }
    if (e.type === "delta") this.reply += e.text;
    else if (e.type === "toolStart") this.note({ kind: "tool", text: `${e.name} ${e.summary}`.trim() });
    else if (e.type === "message") { this.note({ kind: "firstmate", text: e.text || this.reply }); this.reply = ""; }
    else if (e.type === "forked") {
      this.note({ kind: "status", ...bi(`The session was re-identified: ${e.oldId} → ${e.newId}; Studio follows the new id`, `session 換了 id：${e.oldId} → ${e.newId}；Studio 跟著新的 id`) });
      if (this.state !== "attaching") this.followCopy(e.oldId, e.newId, e.file ?? null); // while attaching, takeover() follows it once the note exists
    }
    if (e.type !== "delta") this.changed();
    this.lastOwnWrite = Date.now();
  }

  /** Every second: deliver new wakes; watch for a terminal writing the session. */
  private tick() {
    if (!this.session) return;
    let fresh = false;
    for (const w of this.wakes?.readItems() ?? []) {
      if (this.seenWakes.has(w.key)) continue; // the same item read twice is one wake
      this.seenWakes.add(w.key); fresh = true;
      this.note({ kind: "system", ...bi(`wake: ${w.line}`, `喚醒：${w.line}`), source: "firstmate" });
      this.queue.push("wake", w.line, "firstmate", w);
    }
    if (this.seenWakes.size > 5000) this.seenWakes = new Set([...this.seenWakes].slice(-2000));
    const before = this.log.length;
    this.pruneWakes();
    const writes = this.origin?.originWrites ?? 0, term = this.origin?.terminal;
    this.watchOrigin();
    if (fresh || this.log.length !== before || writes !== (this.origin?.originWrites ?? 0) || term !== this.origin?.terminal) this.changed();
    if (this.state === "attached" && !this.session.busy && this.queue.length) void this.pump();
    if (this.state !== "attached") return;
    const m = mtimeOf(this.sessionFile);
    const quiet = !this.session.busy && Date.now() - this.lastOwnWrite > 4000;
    // a copy's file is Studio's alone (its hook turns write it too); only the process check below applies
    if (m > this.lastSeenMtime && quiet && !this.origin && !this.drive) { // Studio's own thread (a fresh start) is written by Studio alone
      this.pause("the session file changed while Studio was not running a turn: a terminal may be writing it");
      return;
    }
    if (m > this.lastSeenMtime) this.lastSeenMtime = m;
    const s = this.session;
    if (this.origin && s.id === this.origin.id) return; // the copy has no id of its own yet; the original's id names the terminal
    const other = this.probe.list().find((p) => p.pid !== process.pid && !this.own.has(p.pid) && p.command.includes(s.id) && !/\s-p(\s|$)|app-server/.test(p.command));
    if (other) this.pause(`process ${other.pid} opened this session`);
  }

  /** A takeover keeps an eye on the original: its transcript growing means the terminal is not idle. */
  private watchOrigin() {
    const o = this.origin; if (!o) return;
    const m = mtimeOf(o.file);
    if (m > this.originMtime) {
      this.originMtime = m; o.originWrites++; o.lastOriginWrite = new Date(m).toISOString();
      if (o.originWrites === 1 || o.originWrites % 20 === 0) this.note({ kind: "system", ...(o.mode === "rehearsal"
        ? bi(`The original session ${o.id.slice(0, 8)} is still being written (expected in a rehearsal: the terminal keeps working).`, `原本的 session ${o.id.slice(0, 8)} 仍在寫入（演練時是正常的：終端機繼續工作）。`)
        : bi(`Warning: the original session ${o.id.slice(0, 8)} was written at ${o.lastOriginWrite}: the terminal is not idle, and two firstmates may act on the same state.`, `警告：原本的 session ${o.id.slice(0, 8)} 在 ${o.lastOriginWrite} 被寫入：終端機不是閒置的，可能有兩個 firstmate 同時操作同一份狀態。`)) });
    }
    if (Date.now() - this.lastTerminalCheck > 15_000) {
      this.lastTerminalCheck = Date.now();
      o.terminal = driving(this.probe, { host: o.host, id: o.id, cwd: o.cwd, file: null, newestInDir: true }, this.own);
    }
  }

  pause(reason: string) {
    if (this.state !== "attached") return;
    this.nativeGeneration++;this.abortNativeCalls();
    this.state = "paused"; this.pausedReason = reason;
    this.note({ kind: "status", ...bi(`Paused: ${reason}. Nothing more is sent until you resume or hand back.`, `已暫停：${reason}。在你繼續或交還之前，不會再送出任何內容。`), status: "paused" });
    this.changed();
  }

  resume(): { ok: boolean; reason?: string } {
    if (this.state !== "paused" || !this.session) return { ok: false, reason: "not paused" };
    this.lastSeenMtime = mtimeOf(this.sessionFile);
    this.state = "attached"; this.pausedReason = null;
    this.note({ kind: "status", ...bi("Resumed by the captain", "船長已繼續") });
    this.changed(); void this.pump();
    return { ok: true };
  }

  async interrupt() { this.nativeGeneration++;this.abortNativeCalls();await this.session?.interrupt(); }

  /** Hand the session back to a terminal: stop Studio's process, release the lock, show the resume command. */
  async detach(): Promise<string | null> {
    if (!this.session) return null;
    const s = this.session;
    this.nativeGeneration++;this.abortNativeCalls();
    this.state = "detaching"; this.changed();
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.bridge.denyAll();
    const nativePrimary = this.o.nativeWorkspace && !this.origin && this.drive?.path === "fresh";
    const raw = await s.detach();
    const o = this.origin;
    if (nativePrimary) {
      if (s.pid) this.own.delete(s.pid);
      const dr = this.drive;
      this.session = null; this.state = "detached"; this.pausedReason = null; this.wakes = null; this.lastResume = null; this.sessionFile = null;
      this.writeDriver({ holder: "none", host: s.host, sessionId: s.id, pid: null, since: new Date().toISOString(), forkedFrom: null, mode: null, handoff: dr?.handoff ?? null, path: "fresh" });
      if (dr?.handoff) { try { appendFileSync(join(this.handoffDir(), dr.handoff), `\n## Stopped ${new Date().toISOString()}\n\nStudio closed its own primary. No terminal owns it. Dispatched native Tasks remain independent.\n`); } catch {} }
      this.drive = null; this.origin = null;
      this.note({ kind: "status", text: "Firstmate stopped. Dispatched native Tasks keep their own lifecycle. / Firstmate 已停止；已派出的原生任務保持各自的生命週期。", i18n: { en: "Firstmate stopped. Dispatched native Tasks keep their own lifecycle.", "zh-TW": "Firstmate 已停止；已派出的原生任務保持各自的生命週期。" } });
      this.changed();
      return null;
    }
    const cmd = o ? `cd ${o.cwd} && ${raw}` : raw;
    this.session = null; this.state = "detached"; this.pausedReason = null; this.wakes = null; this.lastResume = cmd;
    const dr = this.drive;
    const cmd2 = !o && dr ? `cd ${this.o.projectDir} && ${raw}` : cmd;
    this.lastResume = cmd2;
    this.writeDriver({ holder: "terminal", host: s.host, sessionId: s.id, pid: null, since: new Date().toISOString(), resume: cmd2,
      forkedFrom: o?.id ?? null, mode: o?.mode ?? null, handoff: o?.handoff ?? dr?.handoff ?? null, path: dr?.path ?? null });
    if (o) {
      try { appendFileSync(join(this.handoffDir(), o.handoff), `\n## Released ${new Date().toISOString()}\n\n- Continue the Studio copy in a terminal: \`${cmd}\`\n- Or go back to the original as it was before the takeover: \`cd ${o.cwd} && ${this.hosts[o.host].resumeCommand(o.id)}\`\n- Wakes still queued in Studio (firstmate keeps them in its own queue too): ${this.queue.list().filter((i) => i.kind === "wake").flatMap((i) => i.lines ?? []).join("; ") || "none"}\n`); } catch {}
      this.origin = null;
    } else if (dr) { try { appendFileSync(join(this.handoffDir(), dr.handoff!), `\n## Released ${new Date().toISOString()}\n\n- Continue the thread in a terminal: \`${cmd2}\`\n`); } catch {} }
    this.drive = null;
    this.note({ kind: "status", ...bi(`Handed back. Run in a terminal: ${cmd2}`, `已交回。在終端機執行：${cmd2}`) });
    this.changed();
    return cmd2;
  }
}

export const hasDriverFile = (dataDir: string) => existsSync(join(dataDir, "driver.json"));

/** The newest state/HANDOFF-*.md firstmate wrote (by time written, then name), capped for a first message. */
export function newestHandoffFile(stateDir: string, cap = 60_000): { name: string; text: string } | null {
  let names: string[] = [];
  try { names = readdirSync(stateDir).filter((f) => /^HANDOFF-[\w.-]+\.md$/.test(f)); } catch { return null; }
  const best = names.map((name) => ({ name, m: mtimeOf(join(stateDir, name)) })).sort((a, b) => b.m - a.m || b.name.localeCompare(a.name))[0];
  if (!best) return null;
  try { const t = readFileSync(join(stateDir, best.name), "utf8"); return { name: best.name, text: t.length > cap ? t.slice(0, cap) + "\n…(cut)" : t }; } catch { return null; }
}

/** A first message with the captain's operating rules after it: the same section every worker and reviewer gets. */
/**
 * A first message: the captain's operating rules first (after Studio's own lead line, e.g. the local execution notice), then the body. The body may quote untrusted text (the original
 * thread's recent turns, a handoff file, a worker's report): its rules markers and headings are neutralised, so the
 * real section is always the first one the model reads.
 */
export function withRulesSeed(text: string, rules?: () => string, tool = false, lead = ""): string {
  if (!rules) return lead ? `${lead}\n\n${text}` : text;
  return `${lead ? `${lead}\n\n` : ""}${rulesNow(rules)}\n\nThese rules bind you and every job you propose.${tool ? " Project rules are not included here: call studio_operating_rules before you propose work for a project, and read them again any time." : ""} Only the captain edits them, in Studio's settings. The message follows.\n\n${neutralizeMarkers(text)}`;
}
const RULES_UNREADABLE_SECTION = "# Operating rules (set by the captain)\n\nRULES UNREADABLE: Studio could not read the operating rules. Treat every action they usually cover (sign-in flows, live services, shared git config, accounts and billing) as forbidden and ask the captain.";
function rulesNow(rules: () => string): string { try { return rules(); } catch { return RULES_UNREADABLE_SECTION; } }
/** A turn for a session that has not seen the current rules (a takeover, a resume, a restart, or an edit since): the section first. */
export function withRulesTurn(text: string, section: string, changed: boolean): string {
  return `${section}\n\n${changed ? "The captain changed the operating rules above since you last saw them; they replace the earlier text." : "These are the captain's standing operating rules for this session."} The message follows.\n\n${neutralizeMarkers(text)}`;
}

/** The first message of a new thread that stands in for a fork: the original's recent turns (read only) and firstmate's handoff file. */
export function seedText(o: { host: HostId; original: string; cwd: string; turns: string | null; handoff: { name: string; text: string } | null }): string {
  return [`Crew Studio is handing the firstmate session over to you. ${o.host === "codex" ? "Codex has no fork, so this is a new thread" : "This is a new session"}; the original ${o.host} thread ${o.original} stays untouched in ${o.cwd} and must not be resumed.`,
    `You run in ${o.cwd}: follow its AGENTS.md as firstmate. The captain talks to you through Crew Studio from now on.`, "",
    `## The original thread's recent turns (read only)`, "", o.turns ?? "(Studio could not read them)", "",
    `## ${o.handoff ? `state/${o.handoff.name}` : "No state/HANDOFF-*.md found"}`, "", o.handoff?.text ?? "", "",
    `Read the state as AGENTS.md says, then reply in one line that you are ready.`].join("\n");
}

/** The first message of "Start firstmate on Codex": the newest handoff file's contents. */
export function freshText(cwd: string, handoff: { name: string; text: string } | null): string {
  return [`Crew Studio started you as firstmate in ${cwd}. Follow its AGENTS.md. The captain talks to you through Crew Studio.`, "",
    `## ${handoff ? `state/${handoff.name}` : "No state/HANDOFF-*.md found"}`, "", handoff?.text ?? "", "",
    `Read the state as AGENTS.md says, then reply in one line that you are ready.`].join("\n");
}

/** Native Firstmate has no dependency on a legacy repo or handoff. */
/** The names a fresh primary is told about: every tool actually registered, else the known default set. */
const DEFAULT_NATIVE_TOOLS=["studio_list_workflows","studio_list_projects","studio_operating_rules","studio_work_status","studio_prepare_project_work","studio_staffing_facts","studio_staffing_interview","studio_propose_staffing","studio_change_staffing","studio_propose_work","studio_draft_workflow","studio_workflow_draft_contract","studio_read_workflow","studio_update_workflow_staffing","studio_validate_workflow_draft","studio_save_workflow_draft","studio_workflow_gate","studio_startup_workflow_contract","studio_answer_agent_question"];
const toolList=(names:string[])=>names.length>1?`${names.slice(0,-1).join(", ")} and ${names.at(-1)}`:names.join("");
/** claudeModeLine in zh-TW (the 简体中文 UI derives from it), worded as the Firstmate card words it */
export function claudeModeLineZh(requested: string | null, effective: string | null): string {
  if (!effective) return `Claude 權限模式：${requested ?? "default"}（已要求，等待 Claude 確認）`;
  return requested && requested !== effective ? `Claude 權限模式：${effective}（要求的是 ${requested}；Claude 沒有啟用）` : `Claude 權限模式：${effective}`;
}
/** "Claude permission mode: <effective>", saying so when Claude did not enable the requested mode. */
export function claudeModeLine(requested: string | null, effective: string | null): string {
  if (!effective) return `Claude permission mode: ${requested ?? "default"} (requested, waiting for Claude to confirm)`;
  return requested && requested !== effective ? `Claude permission mode: ${effective} (${requested} was requested; Claude did not enable it)` : `Claude permission mode: ${effective}`;
}
/** What the fresh Claude primary's edit tools may never write: Studio's settings for it (where hooks, allow rules or the mode would go)
 *  and Studio's .env files (the operator settings). Its auto memory under projects/ stays writable. */
export function claudeDenyEdits(configDir: string | undefined): string[] {
  const cfg = configDir ? ["settings*.json", ".claude.json", "CLAUDE.md", "hooks/**", "skills/**", "agents/**", "commands/**", "plugins/**", "output-styles/**"].map((x) => join(configDir, x)) : [];
  // every .env file Bun loads for Studio by itself
  return [...cfg, ...[".env", ".env.local", ".env.development", ".env.production", ".env.test"].map((f) => join(process.cwd(), f))];
}
/** Firstmate answers in the captain's own language and script; the dashboard language only sets the greeting. */
export const REPLY_LANGUAGE = "After the greeting, reply in the language and script of the captain's latest message, whatever the dashboard language: Traditional Chinese (繁體中文) gets Traditional Chinese, never Simplified; Simplified Chinese gets Simplified; English gets English. Each captain turn may carry a Studio note naming the script it was written in; follow it.";
export function nativeFreshText(cwd:string,tools:string[]=DEFAULT_NATIVE_TOOLS,locale:"en"|"zh-TW"|"zh-CN"="en"):string { const language=locale==="zh-TW"?"Traditional Chinese (繁體中文)":locale==="zh-CN"?"Simplified Chinese (简体中文)":"English";return `The captain’s current dashboard language is ${language}. Greet the captain in ${language}. ${REPLY_LANGUAGE} Workflow drafting skill: before designing any workflow, read studio_workflow_draft_contract, follow its current skill and schema, and validate with studio_validate_workflow_draft before submission. Coffee onboarding: offer one coherent editable default website/image/video plan and ask only for genuinely blocking missing input; preserve the captain’s answers and omit unknown business facts. Do not conduct a long questionnaire. The captain reviews the complete coffeeDesignPlan and real confirmation cards before production. For staffing, offer the existing available verified default configuration, preferably the configured Codex pair. No invented capability or business facts. You are Studio's own Firstmate, working in its private workspace ${cwd}. The captain talks to you through Crew Studio. This is a fresh conversation, not a terminal takeover. No repository or legacy handoff is required. Help with the captain's actual request; offer the coffee-shop guided workflow when relevant, without forcing unrelated work into it. General CLI requests: this is a normal configured vendor CLI conversation with Studio tools added. For explicit requests to read or edit project files, run commands or Git, or apply available skills, use the vendor tools actually available in this session under their existing sandbox and approval policy. The following Studio tools are additional capabilities, not an exhaustive tool inventory. Do not claim that you can only query or propose work when normal CLI tools are available. Explain the actual working directory and any real tool or permission limitation; ask the captain to select the intended repository when unclear. Do not invent tools or request unrestricted permissions. Managed Studio workflows: you have Studio native tools: ${toolList(tools)}. Own workflow drafting is free and separate from execution: when the captain wants to design their own workflow, interview them briefly (two or three short questions, one at a time: who does the work, who reviews it, when the captain decides), then call studio_draft_workflow with the graph you designed so their page previews it; pass the draft id to revise it, and keep the captain's node choices. Write the captain's goals as numbered intent lines in their own words, each with what done means, and name on every node the lines it serves. Studio checks every draft with its readiness gate; read the result with studio_workflow_gate and, when a GATE-REPAIR turn arrives, revise the draft yourself without asking the captain (pick the most reasonable reading of an ambiguous line and write the assumption). Never start a sign-in or grant a permission. Call studio_save_workflow_draft only when the captain asks to save. For an already saved personal workflow, read studio_read_workflow, then use studio_update_workflow_staffing with the latest base and the captain’s explicitly selected provider, model and effort for all matching role nodes. Saving never starts work; do not ask the captain to manually re-enter choices in the editor. Never use studio_propose_work, staffing tools or any Task for drafting; the captain confirms staffing only when they click Run. Before managed coding-workflow dispatch, list registered projects and match the captain's repository to a unique enabled identity. If it is unregistered, use studio_prepare_project_work with the local path and same workflow/version/brief to raise a captain registration card; after registration an ordinary separate dispatch card still needs captain approval. Never ask the captain to manually visit Gates or invent a project ID. studio_propose_work accepts safe declared params and registered project IDs, never raw repo/base/branch/worktree. Its title is a short Task name for the board in the captain's language (at most 24 CJK or 48 Latin characters); its text is only the captain's request in their own words. Never put staffing, roles, providers, models, effort or the staffing card into text: Studio pins the approved staffing separately, and a spec writer reads every sentence of text as scope. Treat structured invalid_params, project_required, project_unregistered, project_disabled or project_revoked errors distinctly and follow their safe nextAction; do not call a malformed request a permission denial. Before dispatch, read native staffing facts; the main conversation account does not select worker accounts. Use studio_staffing_interview to read the complete currently available defaults; when its independence note says the reviewer or designer shares the worker's provider and model, tell the captain plainly. When the captain asks to use defaults or says there are too many staffing questions, call it with defaults:"use" to record the complete configuration in one turn, preserving already specified choices. An explicit request for a new complete default crew, including replacing a prior Claude suggestion with available defaults, authorizes defaults:"reset" so an old unverified suggestion does not force another question or verification. If the captain asks to keep a named role or use defaults only for the remaining roles, use defaults:"use" to preserve those choices. Then call studio_propose_staffing with the returned choices in the same turn to show the final captain configuration card; adoption of defaults is not approval and starts no work. Do not force three vendor/model/effort rounds or ask the captain to manually Verify Claude and report back. Defaults use only current verified exact configurations, prefer existing approved staffing and the configured available Codex pair, and never claim that execution verification proves quota. Keep the per-role dependent interview only when the captain chooses advanced customization: answer only its current frontier and wait for new replies before dependent choices. Preserve explicit role choices, never silently switch an unavailable chosen provider, and keep missing capabilities on hold. Missing or unverified native capabilities are not repaired by changing the main conversation account. Show each mandatory native role skill and the complete shared editable configuration, then create a staffing confirmation card. Its approval writes project-local versioned configuration; only then propose workflow execution. Missing facts or unanswered choices HOLD without model fallback. If an existing Task is on a readiness hold, propose studio_change_staffing for that exact task and node after discussing its complete role configuration. The captain must approve that configuration and then separately approve its existing fresh-preparation card; never replace the Task or answer either card yourself. When the captain asks to delegate or run a managed Studio workflow, use these tools to propose its exact pinned work and raise its real captain dispatch card. General CLI file/command requests do not require a workflow merely because they are actionable. Never ask for an external firstmate engine path. Proposing is not approval; only the captain can approve the card. Opening this conversation authorizes no automatic file edits, commands, task creation, project changes or paid work. Do not use legacy firstmate scripts or general CLI tools to bypass Studio project, staffing, card or ledger authority. General CLI editing does not authorize mutating managed workflow state or answering captain cards. Workflow execution requires the captain's explicit authenticated brief and confirmation through Studio. Respect any explicit project authority and tool permissions; unanswered permissions are denied. Greet the captain briefly, introduce yourself as their Studio Firstmate, and ask what they would like to make. Offer the coffee-shop example as an option; wait for their answer before proposing or starting any work.`; }
