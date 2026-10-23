import { scrubEnv } from "../secure";
// The host interface: how Studio drives the firstmate MAIN session, whatever
// vendor runs it. A host finds a project's sessions, attaches to one by id,
// sends one captain turn at a time, and turns the vendor's own output into
// these normalized events. Detaching hands the session back to a terminal.
//   discover(projectDir) -> SessionInfo[]
//   attach(id) -> AttachedSession;  send(text) -> resolves when the turn ends
//   events come through onEvent; interrupt() stops the turn; detach() returns the resume command
export type HostId = "claude" | "codex" | "cursor";

export type SessionInfo = {
  host: HostId; id: string; title: string; cwd: string; updated: number;
  /** a terminal may be driving it: a process names it, or it was written in the last 3 minutes */
  possiblyOpen: boolean; openReason: string | null; file: string | null;
  /** the model and permission mode the session last ran with (from its transcript), so a takeover keeps them */
  model?: string | null; permissionMode?: string | null;
  /** codex: the reasoning effort the thread last ran with */
  effort?: string | null;
};

export type PermissionRequest = { id: string; tool: string; summary: string; input: unknown };
export type PermissionAnswer = { allow: boolean; message?: string; updatedInput?: unknown };

export type HostEvent =
  | {type:"nativeToolFailure";failure:NativeFailure}
  | { type: "delta"; text: string }
  | { type: "progress"; text: string }
  /** `tool`: the called tool's own name when `name` is a vendor item type (Codex mcpToolCall/dynamicToolCall); `input`: its
   *  arguments, read by Studio for the chat's activity line (src/tool-activity.ts) and dropped before the event leaves Studio */
  | { type: "toolStart"; id: string; name: string; summary: string; tool?: string; input?: unknown; activity?: import("../tool-activity").Activity | null }
  /** `result`: the call's answer text, when the vendor reports it (a proposal names its run) */
  | { type: "toolEnd"; id: string; ok: boolean; result?: string }
  | { type: "permissionRequest"; request: PermissionRequest }
  | { type: "message"; text: string }
  | { type: "turnEnd"; status: "completed" | "interrupted" | "failed"; message?: string; external?: boolean }
  /** a turn Studio did not send: the session's own hook (firstmate's asyncRewake Stop hook) woke it */
  | { type: "turnStart"; source: "hook" | "task" }
  | { type: "forked"; oldId: string; newId: string; file?: string | null }
  /** the vendor compacted the conversation (Claude compact_boundary, Codex thread/compacted or a contextCompaction item): earlier turns may be summarised away */
  | { type: "compacted" }
  | { type: "exit"; code: number | null; stderr: string }
  /** the permission mode the CLI itself reports (stream-json init, or a later status message): the effective one */
  | { type: "permissionMode"; mode: string }
  /** the vendor refused the turn for a typed reason (no fallback to another host); `raw` is the vendor's own event, kept in-process */
  | { type: "hostRefusal"; code: HostRefusalCode; reason: { en: string; "zh-TW": string }; raw?: unknown };

/** Typed reasons a host refuses to start or run: never a silent switch to another vendor. */
export type HostRefusalCode = "claudeNotSignedIn" | "claudeQuotaExhausted" | "claudeCrewTokenMissing" | "claudeSignInPending" | "claudeUnavailable" | "cursorProjectHooks";

export interface AttachedSession {
  readonly host: HostId;
  /** follows a fork: a resumed session the CLI re-ids reports its new id */
  readonly id: string;
  readonly model: string;
  readonly busy: boolean;
  /** the CLI process Studio runs for this session, when one is running */
  readonly pid?: number | null;
  /** codex: the reasoning effort, approval policy and sandbox the vendor reports (from the captain's config; Studio never overrides them) */
  readonly effort?: string | null;
  readonly approvalPolicy?: string | null;
  readonly sandbox?: string | null;
  /** how Studio got this session: resumed by id, a vendor fork, a new thread seeded from a handoff, or a fresh start */
  readonly path?: SessionPath;
  /** a "handoff" path: why there is no fork, and the original's recent turns (read only) to seed the new thread */
  readonly noFork?: string | null;
  readonly recentTurns?: string | null;
  /** the session's transcript file, when the vendor names it */
  readonly file?: string | null;
  /** one captain turn; `files` are chat attachments, delivered as this host's CLI takes them (src/attachments.ts) */
  send(text: string, files?: import("../attachments").AttachmentFile[]): Promise<{ status: "completed" | "interrupted" | "failed"; message?: string }>;
  interrupt(): Promise<void>;
  /** stops Studio's process; returns the command that resumes the session in a terminal */
  detach(): Promise<string>;
}

export type SessionPath = "resume" | "fork" | "handoff" | "fresh";

export type GeneratedImage = {thread:string;turn:string;model:string;startedAt:number;outputRoot:string;item:{type:string;id:string;status:string;result:string;savedPath?:string|null};live:()=>boolean};

export type AttachOpts = {
  /** Private source-owned completion bridge, never serialized as an event. */
  onGeneratedImage?: (image:GeneratedImage)=>Promise<void>;
  cwd: string;
  onEvent: (e: HostEvent) => void;
  /** asked for every tool permission request; any failure or timeout must deny */
  onPermission: (r: PermissionRequest) => Promise<PermissionAnswer>;
  /** for claude: the permission MCP command line (Studio's own stdio MCP server) */
  permissionMcp?: { command: string[]; env: Record<string, string> };
  /** start from a copy: `--fork-session`, so the original session id is never written */
  fork?: boolean;
  /** start a NEW session in cwd (the id is ignored): "Start firstmate" */
  fresh?: boolean;
  /** Verified official default, pinned only when the vendor effort setting is absent. */
  codexDefaultEffort?: string;
  nativeTools?: {onDiagnostic?:(record:import("./native-errors").NativeDiagnostic)=>boolean;specs:NativeMainTools["specs"];call(name:string,args:unknown,identity:{thread:string;turn:string;call:string;live:()=>boolean}):Promise<unknown>};
  /** keep the session's own settings: model and permission mode */
  model?: string | null; permissionMode?: string | null;
  /** claude fresh primary: Studio's own MCP helper (src/mcp.ts) that carries nativeTools over owned stdio */
  studioMcp?: { command: string[] };
  /** extra environment for the CLI (after cleanEnv), e.g. FM_IN_ROUND=1 for a rehearsal */
  env?: Record<string, string>;
  /** cursor fresh primary in an explicit project: cwd is its workspace and its own tools work there, under the OS sandbox */
  cursorProject?: boolean;
  /** Studio's data folder: closed to a cursor fresh primary in an explicit project (its secrets by name as well) */
  dataDir?: string;
  /** claude fresh primary: absolute paths (globs allowed) the model's edit tools may never write, passed as Edit(//path) deny rules */
  denyEdits?: string[];
};

export interface Host {
  readonly id: HostId;
  discover(projectDir: string): Promise<SessionInfo[]>;
  attach(id: string, opts: AttachOpts): Promise<AttachedSession>;
  resumeCommand(id: string): string;
}

/** The environment a host CLI runs with: the user's PATH and login, nothing of firstmate or Studio. */
export function cleanEnv(base: Record<string, string | undefined> = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(scrubEnv(base))) {
    if (v === undefined) continue;
    if (/^(CODEX_SESSION_ID|CODEX_THREAD_ID|CODEX_SANDBOX|CODEX_SANDBOX_NETWORK_DISABLED|CODEX_PERMISSION_PROFILE|CODEX_CI)$/.test(k)) continue;
    if (/^(FM_|HERDR|CREW_|CLAUDECODE|CLAUDE_CODE_)/.test(k)) continue;
    if (/(_API_KEY|_TOKEN|_SECRET|PASSWORD|BOARD)/i.test(k) && !/^(PATH|HOME)$/.test(k)) continue;
    out[k] = v;
  }
  return out;
}

/** A tool result's text (a string, or the text blocks of a content array), capped: only Studio reads it, for the activity line. */
export const resultText = (content: unknown, n = 2000): string | undefined => {
  const s = typeof content === "string" ? content : Array.isArray(content) ? content.map((b: any) => typeof b?.text === "string" ? b.text : "").join("") : "";
  return s ? s.slice(0, n) : undefined;
};
export const shortSummary = (input: unknown, n = 160): string => {
  if (input == null) return "";
  if (typeof input === "string") return input.slice(0, n);
  const o = input as Record<string, unknown>;
  const pick = o.command ?? o.file_path ?? o.path ?? o.pattern ?? o.url ?? o.description;
  const s = typeof pick === "string" ? pick : JSON.stringify(input);
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
};

export type NativeMainTools={specs:{type:"function";name:string;description:string;inputSchema:unknown}[];call(name:string,args:unknown,owner:{key:string;captain:boolean;text:string;live:()=>boolean;signal?:AbortSignal;
 /** a Studio gate-repair turn: the ref its queued item carried (never parsed from text) */ repair?:{draft:string;nonce:string}|null}):Promise<unknown>};

/** Only trusted source code constructs public recovery guidance; arbitrary exceptions stay private. */
export type NativeFailure={schema:1;code:string;reason:{en:string;'zh-TW':string};nextAction:string;retryable:boolean;correlationId?:string;diagnosticRecorded?:boolean};
export class NativeToolFailure extends Error {
 readonly publicFailure:NativeFailure;
 constructor(code:string,en:string,zh:string,nextAction='captain_review',retryable=false){super(en);this.name='NativeToolFailure';this.publicFailure={schema:1,code,reason:{en,'zh-TW':zh},nextAction,retryable};}
}
