// The main-session controller: Studio as the single entry point to firstmate.
// It discovers sessions, holds the DRIVER LOCK (data/driver.json) so Studio
// and a terminal never write the same session at once, feeds one FIFO of
// inputs (captain chat, card notices, firstmate wakes) into the attached
// session one turn at a time, and bridges tool permissions to the captain.
// If a terminal starts writing the session while Studio holds it, Studio
// pauses and alerts the captain instead of forking the conversation.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { claudeHost } from "./claude";
import { codexHost } from "./codex";
import { PermissionBridge } from "./permission";
import { driving, mtimeOf, systemProbe, type ProcProbe } from "./probe";
import { InputQueue, lastArrival, type QItem, type QKind } from "./queue";
import type { AttachedSession, Host, HostEvent, HostId, SessionInfo, SessionPath } from "./types";
import { WakeReader, acknowledged } from "./wakes";

export type Driver = { holder: "studio" | "terminal" | "none"; host: HostId | null; sessionId: string | null; pid: number | null; since: string | null; resume?: string;
  /** a takeover: the session Studio forked, which stays untouched */
  forkedFrom?: string | null; mode?: TakeoverMode | null; handoff?: string | null;
  /** how Studio's session was made: a vendor fork, a new thread from a handoff (codex without a fork), or a fresh start */
  path?: SessionPath | null };
export type TakeoverMode = "takeover" | "rehearsal";
/** What a takeover started from and how the original terminal session looks now. */
export type Origin = { id: string; host: HostId; file: string | null; cwd: string; mode: TakeoverMode; model: string | null; permissionMode: string | null;
  at: string; handoff: string; terminal: string | null; originWrites: number; lastOriginWrite: string | null };
/** How the session Studio drives came to be, and the settings its vendor reports (Studio never overrides them). */
export type Drive = { host: HostId; path: SessionPath; statement: string; noFork: string | null; model: string | null; effort: string | null;
  approvalPolicy: string | null; sandbox: string | null; seededFrom: string | null; handoff: string | null };
export type MainState = "detached" | "attaching" | "detaching" | "attached" | "paused";
export type MainView = {
  state: MainState; driver: Driver; host: HostId | null; sessionId: string | null; model: string | null; busy: boolean;
  pausedReason: string | null; queue: QItem[]; approvals: ReturnType<PermissionBridge["pending"]>; log: LogItem[]; resume: string | null; project: string;
  origin: Origin | null; context?: "studio" | "explicit-project"; holdWakes: boolean; wakeGraceMs: number; drive: Drive | null;
};
export type LogItem = { at: number; kind: "captain" | "card" | "wake" | "firstmate" | "tool" | "status" | "system"; text: string; source?: string; status?: string };

export type MainOpts = {
  dataDir: string; projectDir: string; stateDir: string; probe?: ProcProbe;
  hosts?: Record<HostId, Host>; permissionMcp: (bridge: PermissionBridge) => { command: string[]; env: Record<string, string> };
  pollMs?: number;
  /** Fresh Studio-owned workspace: no legacy repository handoff or dispatch scripts. */
  nativeWorkspace?: boolean;
  nativeTools?: ()=>import("./types").NativeMainTools;
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
  private writeDriver(d: Driver) { const tmp = this.driverFile + ".tmp"; writeFileSync(tmp, JSON.stringify(d, null, 2), { mode: 0o600 }); renameSync(tmp, this.driverFile); }

  view(): MainView {
    return { state: this.state, driver: this.driver(), host: this.session?.host ?? null, sessionId: this.session?.id ?? null, model: this.session?.model ?? null,
      busy: this.session?.busy ?? false, pausedReason: this.pausedReason, queue: this.queue.list(), approvals: this.bridge.pending(), log: this.log.slice(-200),
      resume: this.lastResume, project: this.o.projectDir, context: this.o.nativeWorkspace ? "studio" : "explicit-project", origin: this.origin, holdWakes: this.origin?.mode === "rehearsal", wakeGraceMs: this.wakeGraceMs,
      drive: this.drive ? { ...this.drive, model: this.session?.model ?? this.drive.model, effort: this.session?.effort ?? this.drive.effort } : null };
  }
  private changed() { try { this.onView(this.view()); } catch {} }
  note(i: Omit<LogItem, "at">) { this.log.push({ at: Date.now(), ...i }); if (this.log.length > 400) this.log.splice(0, this.log.length - 400); }

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
        onEvent: (e) => this.hostEvent(e),
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
    this.note({ kind: "status", text: `Attached to ${host} session ${this.session.id}` });
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
        onEvent: (e) => this.hostEvent(e),
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
    this.note({ kind: "status", text: `${mode === "rehearsal" ? "Rehearsal" : "Took over"}: Studio drives a copy of ${id}. The terminal session must stay idle.` });
    if (host === "codex") this.note({ kind: "status", text: statement });
    if (terminal) this.note({ kind: "system", text: host === "codex" ? `The original Codex terminal still looks open (${terminal}). Keep it idle and exit it after its background agents finish. Studio delivers wakes to the copy.` : `The terminal still looks open (${terminal}). Keep it idle; exit it after its background agents finish, or its Stop hook keeps taking firstmate's wakes.` });
    if (path === "handoff") this.queue.seed(seedText({ host, original: id, cwd: s.cwd, turns: se.recentTurns ?? null, handoff: newest }));
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
  async startFresh(host: HostId, validate?: (identity:{model:string;effort:string|null})=>boolean): Promise<{ ok: true; handoff: string; id: string; seededFrom: string | null } | { ok: false; reason: string; code: string }> {
    if (this.state !== "detached") return { ok: false, code: "attached", reason: "Studio already holds a session; release it first" };
    if (host !== "codex") return { ok: false, code: "host", reason: "a fresh start runs on Codex" };
    const priorDriver = this.driver();
    this.state = "attaching"; this.changed();
    try {
    const cwd = this.o.projectDir, newest = this.o.nativeWorkspace ? null : newestHandoffFile(this.o.stateDir);
    try {
      this.session = await this.hosts[host].attach("", { cwd, fresh: true, onEvent: (e) => this.hostEvent(e), onPermission: (r) => this.bridge.ask(r), permissionMcp: this.o.permissionMcp(this.bridge), nativeTools:this.nativeCapability() });
    } catch (e: any) {
      this.state = "detached"; this.changed();
      return { ok: false, code: "attachFailed", reason: String(e?.message ?? e) };
    }
    // Trusted synchronous host admission: no seed, driver, handoff or pump may
    // precede verification of the identity actually returned by thread/start.
    if(validate&&validate({model:this.session.model,effort:this.session.effort??null})!==true)throw new Error("Fresh host identity unverified / 新主對話身分尚未驗證");
    if (this.session.pid) this.own.add(this.session.pid);
    const se = this.session, at = new Date().toISOString();
    const statement = `Studio started a new firstmate thread on Codex in ${cwd}${newest ? `, first message: state/${newest.name}` : this.o.nativeWorkspace ? " (Studio-owned workspace)" : " (no state/HANDOFF-*.md found)"}`;
    const handoff = this.writeHandoff(`${at.replace(/[:.]/g, "-")}-fresh-${se.id.slice(0, 8)}.md`, [
      `# Handoff: fresh firstmate on ${host}`, "", `- When: ${at}`, `- Host: ${host}`, `- The copy Studio drives is ${se.id}`, `- cwd: ${cwd} (${this.o.nativeWorkspace ? "Studio-owned workspace" : "explicit project; AGENTS.md applies"})`,
      `- model: ${se.model}; reasoning effort: ${se.effort ?? "(config default)"} (from the captain's Codex config; Studio sets neither)`,
      `- approval policy: ${se.approvalPolicy ?? "(config)"}; sandbox: ${se.sandbox ?? "(config)"}; every approval request goes to Studio's permission bridge, and any failure declines`,
      `- First message: ${newest ? `state/${newest.name}` : this.o.nativeWorkspace ? "Studio-owned native Firstmate introduction" : "no state/HANDOFF-*.md found"}`, "",
      `## Roll back`, "", this.o.nativeWorkspace ? "Stop Firstmate in Studio. This closes the owned primary; dispatched native Tasks keep their own lifecycle. Start a new primary explicitly when ready." : `Release in Studio, then continue the thread in a terminal: \`cd ${cwd} && ${this.hosts[host].resumeCommand(se.id)}\``, "",
    ]);
    this.origin = null;
    this.drive = { host, path: "fresh", statement, noFork: null, model: se.model, effort: se.effort ?? null, approvalPolicy: se.approvalPolicy ?? null, sandbox: se.sandbox ?? null,
      seededFrom: newest ? `state/${newest.name}` : null, handoff };
    this.sessionFile = se.file ?? null; this.lastSeenMtime = mtimeOf(this.sessionFile);
    this.writeDriver({ holder: "studio", host, sessionId: se.id, pid: process.pid, since: at, forkedFrom: null, mode: null, handoff, path: "fresh" });
    this.state = "attached"; this.pausedReason = null; this.lastResume = null;
    this.wakes = new WakeReader(this.o.stateDir);
    this.seenWakes.clear();
    this.note({ kind: "status", text: statement });
    this.queue.seed(this.o.nativeWorkspace ? nativeFreshText(cwd) : freshText(cwd, newest));
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

  enqueue(kind: QKind, text: string, source: string) {
    const item = this.queue.push(kind, text, source);
    this.changed();
    void this.pump();
    return item;
  }

  private nativeCapability():import("./types").AttachOpts["nativeTools"]{
    if(!this.o.nativeWorkspace||!this.o.nativeTools)return undefined;const tools=this.o.nativeTools();
    return{specs:tools.specs,call:async(name,args,identity)=>{const input=this.activeInput,generation=this.nativeGeneration,session=this.session;const live=()=>!!session&&session===this.session&&session.id===identity.thread&&this.state==="attached"&&this.activeInput===input&&this.nativeGeneration===generation&&identity.live();if(!live())throw new Error("Primary tool ownership ended");const controller=new AbortController();this.nativeCalls.add(controller);try{const result=await tools.call(name,args,{key:`${identity.thread}:${identity.turn}`,captain:!!input&&input.kind==="chat"&&(input.source==="desktop"||input.source.startsWith("phone:")),text:input?.text??"",live,signal:controller.signal});if(!live())throw new Error("Primary tool ownership ended");return result;}finally{this.nativeCalls.delete(controller);}}};
  }
  private activeInput:QItem|null=null;
  private nativeGeneration=0;
  private nativeCalls=new Set<AbortController>();
  private abortNativeCalls(){for(const c of this.nativeCalls)c.abort();this.nativeCalls.clear();}
  private pumping = false;
  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.session && this.state === "attached" && !this.session.busy && this.queue.length) {
        this.pruneWakes();
        const item = this.queue.take((i) => this.ready(i));
        if (!item) break;
        this.note({ kind: item.kind === "chat" ? "captain" : item.kind, text: item.text, source: item.source });
        this.reply = "";
        this.lastOwnWrite = Date.now();
        this.changed();
        this.activeInput=item;
        const r = await this.session.send(item.text).catch((e) => ({ status: "failed" as const, message: String(e?.message ?? e) }));
        this.activeInput=null;
        this.lastOwnWrite = Date.now();
        this.lastSeenMtime = mtimeOf(this.sessionFile);
        if (r.status !== "completed") this.note({ kind: "status", text: `Turn ${r.status}${r.message ? `: ${r.message}` : ""}`, status: r.status });
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
      this.note({ kind: "system", text: `wake delivered by firstmate's own hook: ${w.line}` });
  }

  private hostEvent(e: HostEvent) {
    this.onEvent(e);
    if (e.type === "turnStart") this.note({ kind: "system", text: e.source === "task" ? "a background task's notice started a turn; following it" : "a turn Studio did not send started (firstmate's wake hook, or a background task); following it" });
    if (e.type === "turnEnd" && e.external) { this.lastSeenMtime = mtimeOf(this.sessionFile); setTimeout(() => void this.pump(), 0); }
    if (e.type === "delta") this.reply += e.text;
    else if (e.type === "toolStart") this.note({ kind: "tool", text: `${e.name} ${e.summary}`.trim() });
    else if (e.type === "message") { this.note({ kind: "firstmate", text: e.text || this.reply }); this.reply = ""; }
    else if (e.type === "forked") {
      this.note({ kind: "status", text: `The session was re-identified: ${e.oldId} → ${e.newId}; Studio follows the new id` });
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
      this.note({ kind: "system", text: `wake: ${w.line}`, source: "firstmate" });
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
      if (o.originWrites === 1 || o.originWrites % 20 === 0) this.note({ kind: "system", text: o.mode === "rehearsal"
        ? `The original session ${o.id.slice(0, 8)} is still being written (expected in a rehearsal: the terminal keeps working).`
        : `Warning: the original session ${o.id.slice(0, 8)} was written at ${o.lastOriginWrite}: the terminal is not idle, and two firstmates may act on the same state.` });
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
    this.note({ kind: "status", text: `Paused: ${reason}. Nothing more is sent until you resume or hand back.`, status: "paused" });
    this.changed();
  }

  resume(): { ok: boolean; reason?: string } {
    if (this.state !== "paused" || !this.session) return { ok: false, reason: "not paused" };
    this.lastSeenMtime = mtimeOf(this.sessionFile);
    this.state = "attached"; this.pausedReason = null;
    this.note({ kind: "status", text: "Resumed by the captain" });
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
      this.note({ kind: "status", text: "Firstmate stopped. Dispatched native Tasks keep their own lifecycle. / Firstmate 已停止；已派出的原生任務保持各自的生命週期。" });
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
    this.note({ kind: "status", text: `Handed back. Run in a terminal: ${cmd2}` });
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
export function nativeFreshText(cwd:string):string { return `You are Studio's own Firstmate, working in its private workspace ${cwd}. The captain talks to you through Crew Studio. This is a fresh conversation, not a terminal takeover. No repository or legacy handoff is required. Help the captain clarify their goal and prepare the coffee-shop guided workflow. You have Studio native tools: studio_list_workflows, studio_list_projects, studio_work_status, studio_prepare_project_work and studio_propose_work. Before coding work, list registered projects and match the captain's repository to a unique enabled identity. If it is unregistered, use studio_prepare_project_work with the local path and same workflow/version/brief to raise a captain registration card; after registration an ordinary separate dispatch card still needs captain approval. Never ask the captain to manually visit Gates or invent a project ID. studio_propose_work accepts safe declared params and registered project IDs, never raw repo/base/branch/worktree. Treat structured invalid_params, project_required, project_unregistered, project_disabled or project_revoked errors distinctly and follow their safe nextAction; do not call a malformed request a permission denial. For actionable captain requests, use these tools to propose the exact native workflow and raise its real captain dispatch card. Never ask for an external firstmate engine path. Proposing is not approval; only the captain can approve the card. Do not run legacy firstmate dispatch scripts, create tasks, alter projects, or execute workflow work merely because this conversation started. Workflow execution requires the captain's explicit authenticated brief and confirmation through Studio. Respect any explicit project authority and tool permissions; unanswered permissions are denied. Reply briefly that you are ready to help.`; }
