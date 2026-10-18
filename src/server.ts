import { firstmateTurnNote } from "./firstmate-turn";
import {refreshOwnWorkflowClaude} from './providers/own-workflow-claude-refresh';
import {refreshStartupClaude} from './providers/startup-claude-refresh';
import {imageOutcomeProof} from "./domain/image-proof";
import {localExecutionNotice, executionMode} from "./local-execution";
import {staffingApprovedTurn} from "./firstmate-staffing";
import {NativeOutcomes} from "./host/native-outcomes";
import {coffeeJourneyProof} from "./domain/coffee-kit";
import {ClaudeLogin} from './host/claude-login';
import {claudePrimaryReadiness} from './host/claude-primary';
import {sweepPrivateDirs} from './host/claude';
import {discoverCoffeeFilmCapability,renderCoffeeFilm} from "./render/coffee-film";
import {publishGeneratedImage} from "./host/generated-media";
import {createNativeProviderAdmission} from "./providers/native-admission";
import { registerInstance } from "./instance";
import {GitHubPoller} from './github-poller';
import {Projects} from './doors';
import { gitConfigReport } from "./git-config-health";
import {projectPrAdapter,GitHubPrAdapter,type GitHubProjectGrant} from './adapters/github';
// Crew Studio: a read-only window onto a running firstmate, plus card answers
// sent through the firstmate board's own write route.
//   CREW_FM_STATE   optional explicit legacy read adapter; absent means native Studio only
//   CREW_PORT       port to serve on                        (default 4210)
//   CREW_BOARD_URL  firstmate board, for answering cards    (default http://127.0.0.1:4173)
//   CREW_BOARD_SECRET  board secret file                    (default ~/.config/firstmate/board-<port>.secret)
//   CREW_READONLY=1 never send an answer
//   CREW_RECENT_DAYS  how far back the board lists tasks (default 3)
//   CREW_GH=0       do not poll GitHub;  CREW_GH_REPO  owner/name (default: the firstmate checkout's GitHub origin)
//   CREW_DATA       Studio's own store: intents, intent links, artifacts (default ./data)
//   CREW_FILE_ALLOW colon-separated directories artifact files may be served from (default: the main session's project folder, CREW_DATA/workspace)
//   CREW_EXAMPLE_WORKFLOWS=1  also seed the example workflows (the startup competition) on a fresh data folder
//   main session (M2.5): CREW_MAIN_PROJECT  the firstmate repo whose sessions Studio may drive (default: Studio-owned workspace; an explicit legacy adapter keeps its project)
//         CREW_HOST_CLAUDE_BIN, CREW_HOST_CODEX_BIN, CREW_HOST_CLAUDE_PROJECTS, CREW_PERMISSION_TIMEOUT_MS
//   phone: CREW_TAILSCALE_LIVE=1 lets "Enable phone access" really run `tailscale serve` (default: a stub that only records the command)
//         CREW_TAILNET_NAME  extra Host name to accept (tests); CREW_MEMORY_DIR  vendor-neutral memory folder
//   LAN mode (built in, off until turned on in Studio): CREW_LAN_IP, CREW_LAN_PORT (tests)
//   GitHub: CREW_GITHUB_TOKEN / GITHUB_TOKEN / GH_TOKEN, or a token pasted in Studio; CREW_GITHUB_API (tests)
//   installs (Doctor): CREW_INSTALL_RUNNER=mock records instead of running; CREW_NO_REAL_INSTALL=1 refuses real installs
//   chat: CREW_CHAT_PROVIDER=claude|codex|anthropic|openai|openai-compatible|stub (Settings in the chat header saves a choice to CREW_DATA/settings.json),
//         CREW_CLAUDE_MODEL, CREW_CLAUDE_PERMISSION_MODE (fresh Claude Firstmate: auto|default, default auto), CREW_CODEX_MODEL, CREW_CLAUDE_BIN, CREW_CODEX_BIN, CREW_CHAT_TIMEOUT_MS
//   Crew page: CREW_DETECT_FORCE_MIN_MS (tests: how soon 重新偵測 may detect again; default 10 s)
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { extname, join, normalize } from "node:path";
import { Board } from "./board";
import { FmState, type Card, type Ev } from "./fm";
import { GitHub } from "./github";
import { Store } from "./store";
import { TOOLS, toolByName, type ToolCtx } from "./tools";
import { manualFor } from "./manual";
import { runChat, MAX_TOOL_CALLS, type Turn } from "./chat";
import { makeProvider, PROVIDERS, CLI_PROVIDERS, type Provider } from "./providers";
import { COMPILED, DEFAULT_DATA, SRC_ROOT, helperCommand } from "./self";
import { ASSETS } from "./assets.gen";
import { keyStatus, keys, saveKeys, setKeysDir } from "./keys";
import { diagnose, Installs, LOGINS, methodsFor, MockRunner, RealRunner, type Item } from "./doctor";
import { lanIp } from "./remote/lan";

import { MainSession } from "./host/main";
import type { HostEvent, HostId } from "./host/types";
import { Remote } from "./remote/pairing";
import { LiveRunner, StubRunner, readStatus, serveCommand, serveOffCommand, type TsRunner, type TsStatus } from "./remote/tailscale";
import { MemoryStore } from "./memory";
import { createM3 } from "./m3";
import { renderEnv, TOOLS_DIR } from "./render";
import { dirname } from "node:path";
import { Agents } from "./agent";
import { RawLog, StudioLog } from "./rawlog";
import { Workflows } from "./workflows";
import { createImprove } from "./improve";
import { createChanges } from "./changes";
import { createProjectOverview } from "./project-overview";
import { createM7 } from "./m7";
import { createDocs } from "./docs";
import { Skins, snapshotFor, nativeSkinData } from "./skins";
import { bundledText } from "./bundled";
import { classify, orgDefaults } from "./doors";
import { installPackGenesis } from "./pack-genesis";
import { createRuntime } from "./runtime";
import { amendmentsNotice } from "./runtime/refine";
import { EXEMPT, guardWrite, hasSession, hasSessionCookie, sessionCookie, sessionToken } from "./csrf";
import { AttachmentStore, deliveryFor, uploadAttachment } from "./attachments";
import { ChatLog } from "./host/chat-log";
import { OperatingRules, DEFAULT_OPERATING_RULES, DEFAULT_OPERATING_RULES_ZH_TW } from "./operating-rules";
import { registerSecretValues } from "./secure";
import { timingSafeEqual } from "node:crypto";
import { git, setGitHome } from "./git";
import { Egress } from "./egress";
import { Worktrees } from "./worktrees";
import { claudeLogin as claudeLogin_, claudeLoginPresence, claudeLoginPresenceAsync, claudeLoginStatus, setBillingFile, setLoginOutcomeFile } from "./providers/login";
import { installCode } from "./domain/code";
import { applySandboxAddons, prepareSandbox, registerSandbox } from "./sandbox-repo";
import { createTakeover, doorComplete, doorInput, needsDoor } from "./takeover";
import { createTranscripts } from "./transcripts";
import { createTasksApi, taskAlias } from "./tasks-api";
import { createCompare } from "./compare";
import { createGraphMode } from "./graphmode";
import { createSkillRoutes } from "./skill-routes";
import { startupPaths } from "./startup";
import { encodeCwd } from "./host/claude";

import { codexProvider } from "./providers/codex";
import { codexConfig } from "./host/codex";
import { CodexAccount } from "./host/codex-account";
import { generateCodexImage } from "./providers/codex-image";
import { probeCodex } from "./providers/codex-probe";
import {nativeClaude,probeClaudeNative,makeNativeClaudeProvider,validClaudePair,claudeEfforts,configuredClaudeEffort,isClaudeExecutionAdmission} from './providers/claude-native';
import { ProviderRefusal, selectNativeProvider, type ProviderSelection, type ProviderCapability } from "./providers/policy";

const ROOT = SRC_ROOT;
const DATA = process.env.CREW_DATA ?? DEFAULT_DATA;
const startup = startupPaths(DATA);
const STATE = startup.state;
const PORT = Number(process.env.CREW_PORT ?? 4210);
if (startup.legacy && !existsSync(join(STATE, "events.jsonl"))) console.warn(`crew-studio: no events.jsonl under ${STATE}`);

const fm = new FmState(STATE);
const board = Board.fromEnv(startup.legacy);
mkdirSync(DATA, { recursive: true });
setKeysDir(DATA);
setGitHome(DATA);
// Studio's own secrets, for the one redactor (secure.ts): its GitHub token file, its ledger key, its session token (the key store registers itself)
registerSecretValues(() => { let gh: string | null = null; try { gh = readFileSync(join(DATA, "github-token"), "utf8"); } catch {}
  let lk: string | null = null; try { lk = readFileSync(join(DATA, "ledger.key"), "utf8"); } catch {}
  let st: string | null = null; try { st = readFileSync(join(DATA, "session-token"), "utf8"); } catch {}
  return [gh, lk, st]; });
// the egress proxy (architecture §10): provider API hosts plus policy egress.allow; everything else refused and logged in data/egress.log
const egress = new Egress(join(DATA, "egress.log"));
await egress.start().catch((e) => console.warn(`crew-studio: egress proxy: ${e?.message ?? e}`));
const store = new Store(DATA, (process.env.CREW_FILE_ALLOW ?? startup.project).split(":").filter(Boolean));
// the repository firstmate's PRs live in: CREW_GH_REPO, else the firstmate checkout's own GitHub origin (read-only)
let ghRepo = process.env.CREW_GH_REPO ?? (() => {
  if (!existsSync(join(startup.project,".git"))) return "";
  try { const r = git(startup.project, ["remote", "get-url", "origin"]); return /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(r.out)?.[1] ?? ""; } catch { return ""; }
})();
const githubPoller=new GitHubPoller();let dashboardGrant:GitHubProjectGrant|undefined,bindingError:string|null=null;
const dashboardEnabled=process.env.CREW_GH?process.env.CREW_GH!=='0':!!(ghRepo||process.env.CREW_GH_PROJECT);
if(dashboardEnabled&&process.env.CREW_GH_PROJECT){try{const project=new Projects(DATA).get(process.env.CREW_GH_PROJECT);if(!project||(project as any).enabled===false)throw new Error();const adapter=projectPrAdapter(project,DATA,githubPoller);if(!(adapter instanceof GitHubPrAdapter)||process.env.CREW_GH_REPO&&process.env.CREW_GH_REPO!==adapter.grant.repository||process.env.CREW_GITHUB_API&&process.env.CREW_GITHUB_API.replace(/\/$/,'')!==adapter.grant.apiOrigin)throw new Error();dashboardGrant=adapter.grant;ghRepo=adapter.grant.repository;}catch{bindingError='unsupported GitHub dashboard project binding';}}
const gh=new GitHub(ghRepo||'unknown/unknown',dashboardEnabled&&!bindingError,DATA,{poller:githubPoller,grant:dashboardGrant});if(bindingError)gh.state.error=bindingError;
const flow = (Bun as any).YAML.parse(bundledText("workflows/code.flow.yaml") ?? "");
fm.pollEvents();
let pending: Card[] = fm.pending();
let crewCache = fm.crew(0);
const alive = () => new Set(crewCache.filter(c => c.alive).map(c => c.actor));
const RECENT_DAYS = Number(process.env.CREW_RECENT_DAYS ?? 3);
const tasks = () => fm.taskList(alive(), pending, RECENT_DAYS);

// --- live updates (server-sent events) ---
const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
const clientDevice = new Map<ReadableStreamDefaultController<Uint8Array>, string>(); // phone streams, cut when the device is revoked
const enc = new TextEncoder();
const send = (type: string, data: unknown) => {
  const chunk = enc.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  for (const c of clients) { try { c.enqueue(chunk); } catch { clients.delete(c); } }
};
let pendingSig = "", crewSig = "";
const pendingSignature = () => {
  const dir = join(STATE, "pending");
  if (!existsSync(dir)) return "";
  return readdirSync(dir).filter(f => f.endsWith(".json")).sort()
    .map(f => { try { return f + ":" + statSync(join(dir, f)).mtimeMs; } catch { return f; } }).join("|");
};
pendingSig = pendingSignature();
setInterval(() => {
  const fresh = fm.pollEvents();
  if (fresh.length) send("events", { events: fresh.slice(-100), tasks: tasks() });
  const sig = pendingSignature();
  if (sig !== pendingSig) { pendingSig = sig; pending = fm.pending(); send("pending", { pending, tasks: tasks() }); }
}, 700);
setInterval(() => {
  crewCache = fm.crew(8);
  const sig = JSON.stringify(crewCache.map(c => [c.actor, c.alive, c.lastWrite, c.lines.at(-1)?.text]));
  if (sig !== crewSig) { crewSig = sig; send("crew", { crew: crewCache.slice(0, 40), tasks: tasks() }); }
}, 3000);
gh.onChange = s => send("github", s);
// Studio's own intents and firstmate's links to them
const dataSig = () => ["intents.jsonl", "intent-links.jsonl", "artifacts.json"].map(f => { try { return statSync(join(DATA, f)).mtimeMs; } catch { return 0; } }).join("|");
let lastData = dataSig();
setInterval(() => { const d = dataSig(); if (d !== lastData) { lastData = d; send("intents", store.intentView(fm)); } }, 1500);
setInterval(() => send("ping", Date.now()), 20_000);

// --- the firstmate MAIN session (M2.5): Studio drives it, one input at a time ---
const PROJECT = startup.project;
if (!startup.legacy && !process.env.CREW_MAIN_PROJECT) mkdirSync(PROJECT, { recursive: true });
const nativeOutcomes = new NativeOutcomes(DATA,()=>runtime.engine,id=>runtime.engine.get(id)?.def.kind==='image'?imageOutcomeProof(runtime.engine,m3.store,id):coffeeJourneyProof(runtime.engine,m3.store,id));
// the captain's chat attachments: content-hash names in Studio's data folder (src/attachments.ts)
const chatFiles = new AttachmentStore(DATA);
// retention (src/attachments.ts): uploads never sent go after a day, stray temporary files after an hour; sent files stay with the history
const chatLog = new ChatLog(DATA);
/** Retention runs at start and every hour: what the kept history or the queue references stays (src/attachments.ts sweep). */
const sweepChatFiles = () => { try { const referenced = chatLog.referencedIds(); for (const q of main.queue.list()) for (const a of q.attachments ?? []) referenced.add(a.id); return chatFiles.sweep({ referenced }); } catch { return 0; } };
const main = new MainSession({ dataDir: DATA, projectDir: PROJECT, stateDir: STATE, nativeWorkspace: !startup.legacy && !process.env.CREW_MAIN_PROJECT,
  nativeTools:()=>runtime.firstmate,
  // each captain turn carries Studio's note: the deliverables it routes to a workflow (src/firstmate-turn.ts)
  turnNote:(text)=>firstmateTurnNote(runtime.engine)(text),
  // the active project's rules: the registered project at this checkout (explicit project), else the Studio-wide ones only
  operatingRules:()=>new OperatingRules(DATA).section(runtime.projects.list().find(p=>p.path===PROJECT)?.id ?? null).text,
  onNativeProposal:(origin,result)=>nativeOutcomes.bind(origin,result),
  nativeOutcomes:(host,thread)=>{try{return nativeOutcomes.list(host,thread);}catch{return[];}},
  onGeneratedImage:async(image,owner)=>{await publishGeneratedImage(m3.media,image,owner);},
  permissionMcp: (b) => ({ command: helperCommand("permission-mcp"), env: { CREW_PERM_SOCKET: b.socket, CREW_PERM_TOKEN: b.token } }),
  attachmentFiles: (ids) => chatFiles.resolve(ids),
  chatLog,
  studioMcp: () => helperCommand("mcp") });
sweepChatFiles(); setInterval(sweepChatFiles, Number(process.env.CREW_ATTACH_SWEEP_MS) || 3600_000).unref?.(); // CREW_ATTACH_SWEEP_MS: tests only
main.onView = (v) => { send("main", v); if (v.state === "attached") { try { runtime.engine.resumeFirstmateQuestions(); } catch {} } }; // Firstmate attached: send questions it could not take at the restart
main.onEvent = (e: HostEvent) => {
  // a Claude primary's own quota or sign-in refusal is the Claude account card's fact too (no fallback anywhere)
  if (e.type === "hostRefusal" && main.view().host === "claude") { try { nativeClaude.observe(e.raw); } catch {} } if (e.type === "delta" || e.type === "toolStart" || e.type === "permissionRequest" || e.type === "turnStart") send("mainEvent", e); };
const codexAccount=new CodexAccount({cwd:PROJECT,busy:()=>main.view().state!=="detached",configured:()=>{const c=codexConfig(PROJECT);return{model:c.model,effort:c.effort};},changed:()=>send("codex-account",codexAccount.view())});
const claudeLogin=new ClaudeLogin({loginMs:Number(process.env.CREW_CLAUDE_LOGIN_MS)||undefined,signedIn:()=>nativeClaude.signedIn(),changed:()=>send("claude-account",claudeLogin.view())});
// Studio's own primary is stopped with Studio: its process ends and its private folder (tokens, socket) goes
for(const sig of ["SIGTERM","SIGINT"] as const)process.once(sig,()=>{void Promise.all([codexAccount.shutdown(),nativeClaude.cancel(),claudeLogin.shutdown(),(()=>{const v=main.view();return v.context==="studio"&&!v.origin&&v.drive?.path==="fresh"&&["attached","paused"].includes(v.state)?main.detach({shutdown:true}).catch(()=>null):null;})()]).then(()=>process.exit(0),()=>process.exit(1));});
// a fresh Claude primary: the model the Claude account card checks, Studio's own config folder, the crew token
const claudePrimaryPair = () => { const model = chatSettings().models.claude || process.env.CREW_CLAUDE_MODEL || "claude-sonnet-5-5"; let effort: string | null = null; try { effort = configuredClaudeEffort(model); } catch {} return { model, effort }; };
// a Studio that stopped without its shutdown handler leaves private folders behind: remove those whose Studio is gone
try { sweepPrivateDirs(); } catch {}
const takeover = createTakeover({ claudePair: claudePrimaryPair,
  claudePreflight: async () => { const pair = claudePrimaryPair(); let status: unknown = null; const ready = await claudePrimaryReadiness({ dry: true, pair, status: async () => (status = await nativeClaude.status(pair)) as any, login: () => ({ ok: false, error: "dry" }), probe: () => claudeLoginPresence(), configDir: join(DATA, "claude-firstmate"), signInPending: claudeLogin.view().state === "pending", permissionMode: process.env.CREW_CLAUDE_PERMISSION_MODE }); if (!status) { try { status = await nativeClaude.status(pair); } catch {} } return { ready, status }; },
  claudePrimary: () => claudePrimaryReadiness({ probe: () => claudeLoginStatus(), pair: claudePrimaryPair(), status: () => nativeClaude.status(claudePrimaryPair()), login: () => claudeLogin_(), configDir: join(DATA, "claude-firstmate"), signInPending: claudeLogin.view().state === "pending", permissionMode: process.env.CREW_CLAUDE_PERMISSION_MODE }), main, fm, gh, board, codexAccount, stateDir: STATE, pending: () => pending, tasks, crew: () => fm.crew(8) });
// transcripts: the session Studio drives (its copy holds the turns before the takeover), else the firstmate session
const CLAUDE_PROJECTS = process.env.CREW_HOST_CLAUDE_PROJECTS ?? join(homedir(), ".claude/projects");
let firstmateId: string | null = null;
const refreshFirstmate = async () => { try { const own = takeover.copies(); firstmateId = (await main.discover("claude")).find((x) => !own.has(x.id))?.id ?? null; } catch {} };
void refreshFirstmate(); setInterval(refreshFirstmate, 15_000);
const graphMode = createGraphMode(DATA);
const transcripts = createTranscripts({ stateDir: STATE, dataDir: DATA, sessionFile: () => {
  const v = main.view(); const id = v.state !== "detached" && v.host === "claude" ? v.sessionId : firstmateId;
  return id && /^[\w-]+$/.test(id) ? join(CLAUDE_PROJECTS, encodeCwd(PROJECT), `${id}.jsonl`) : null; } });
const memory = MemoryStore.fromEnv(DATA);

// --- phones over Tailscale: pairing, devices, the drive gate ---
const remote = new Remote(DATA, PORT);
remote.onRevoke = (id) => { for (const [c, d] of clientDevice) if (d === id) { try { c.close(); } catch {} clients.delete(c); clientDevice.delete(c); } };
let ts: TsStatus = readStatus();
const refreshTs = () => { ts = readStatus(); remote.tailnetNames.clear(); if (ts.dnsName) remote.tailnetNames.add(ts.dnsName.toLowerCase());
  if (process.env.CREW_TAILNET_NAME) remote.tailnetNames.add(process.env.CREW_TAILNET_NAME.toLowerCase()); };
refreshTs(); setInterval(refreshTs, 60_000);
const tsRunner: TsRunner = process.env.CREW_TAILSCALE_LIVE === "1" ? new LiveRunner() : new StubRunner();
let serveOn = false;
// a phone may read and interrupt; driving firstmate (and answering cards, changing settings) needs "allow phone to drive"
const PHONE_DRIVE = new Set(["/api/main/attachments", "/api/main/takeover", "/api/main/start", "/api/main/switch", "/api/main/question", "/api/main/dispatch", "/api/answer/check-door", "/api/main/attach", "/api/main/send", "/api/main/approve", "/api/main/resume", "/api/main/detach", "/api/main/queue/remove", "/api/main/locale", "/api/answer", "/api/settings"]);
const DESKTOP_ONLY = new Set(["/api/transcripts/settings", "/api/remote/pair/start", "/api/remote/revoke", "/api/remote/settings", "/api/remote/tailscale", "/api/remote/lan",
  "/api/claude/native/verify","/api/claude/native/cancel","/api/claude/account/login","/api/claude/account/cancel","/api/codex/account/login", "/api/codex/account/cancel", "/api/codex/account/verify", "/api/github/token", "/api/github/forget", "/api/keys", "/api/doctor/install", "/api/doctor/login", "/api/doctor/cancel"]);

// --- LAN mode: a second listener on this Mac's LAN address, only while turned on (never at start) ---
let lanServer: ReturnType<typeof Bun.serve> | null = null;
const lanState = () => { const ip = lanIp(); const port = Number(process.env.CREW_LAN_PORT ?? PORT);
  return { on: !!lanServer, ip, port, url: ip ? `http://${ip}:${port}/remote/` : null }; };
function setLan(on: boolean): { ok: boolean; error?: string } {
  if (!on) { lanServer?.stop(true); lanServer = null; remote.lanHost = null; return { ok: true }; }
  if (lanServer) return { ok: true };
  const st = lanState();
  if (!st.ip) return { ok: false, error: "no local network address found" };
  try { lanServer = Bun.serve({ port: st.port, hostname: st.ip, idleTimeout: 0, fetch: (req) => handle(req, "lan") }); }
  catch (e: any) { return { ok: false, error: `could not listen on ${st.ip}:${st.port}: ${e?.message ?? e}` }; }
  remote.lanHost = `${st.ip}:${st.port}`;
  return { ok: true };
}

// --- Doctor: what works, what is degraded, one-click official installs (never during tests) ---
const installs = new Installs(process.env.CREW_INSTALL_RUNNER === "mock" ? new MockRunner() : new RealRunner());
let doctorCache: Item[] = [];
const doctor = () => (doctorCache = diagnose({ state: STATE, legacy: startup.legacy, board: board.status(), gh: gh.state, keys: keyStatus() as any, chatProvider: chatInfo().provider, lanIp: lanIp(),
  tailscale: ts, compiled: COMPILED, render: renderEnv(), film: coffeeTools.ready ? { ready: true } : { ready: false, reason: coffeeTools.reason }, egress: egress.status(), codexAccount:codexAccount.view(), operatingRules: (() => { const r = new OperatingRules(DATA); return { studio: r.studio(), projects: runtime.projects.list().map((x) => ({ id: x.id, ...r.project(x.id) })) }; })(), gitConfig: gitConfigNow(), roundLogin: startup.legacy || existsSync(join(PROJECT,".git")) ? roundLogin() : undefined }));
installs.onChange = (j, line) => send("install", { id: j.id, item: j.item, state: j.state, code: j.code, line: line ?? null });
installs.onFinished = () => { refreshTs(); send("doctor", doctor()); };

// --- chat tools: callable only with a token issued for one question ---
const ctx: ToolCtx = { fm, gh, store, tasks, pending: () => pending, crew: () => crewCache,
  crewTail: (a, n) => fm.crew(n).find(c => c.actor === a) };
const tokens = new Map<string, { calls: number; expires: number }>();
// chat provider: a choice saved from Settings, else CREW_CHAT_PROVIDER, else claude
const SETTINGS = join(DATA, "settings.json");
const allowStub = process.env.CREW_CHAT_PROVIDER === "stub" || process.env.CREW_ALLOW_STUB === "1";
const choices = PROVIDERS.filter(p => p !== "stub" || allowStub);
const chatSettings = (): { provider: string; models: Record<string, string> } => {
  let saved: any = {};
  try { saved = JSON.parse(readFileSync(SETTINGS, "utf8")); } catch {}
  if (saved.provider !== undefined && !(choices as readonly string[]).includes(saved.provider)) throw new Error("unknown saved provider identity");
  if (process.env.CREW_CHAT_PROVIDER && !(choices as readonly string[]).includes(process.env.CREW_CHAT_PROVIDER)) throw new Error("unknown configured provider identity");
  const provider = choices.includes(saved.provider) ? saved.provider : (choices as readonly string[]).includes(process.env.CREW_CHAT_PROVIDER ?? "") ? process.env.CREW_CHAT_PROVIDER! : "claude";
  return { provider, models: typeof saved.models === "object" && saved.models ? saved.models : {} };
};
const provider = () => { const s = chatSettings(); return makeProvider(s.provider, s.models[s.provider] || undefined); };
const chatInfo = () => { const p = provider(); return { provider: p.id, model: p.model, choices, cli: CLI_PROVIDERS.has(p.id), keys: keyStatus() }; };
let chats = 0;
const MAX_CHATS = 2;

// --- M3: artifacts, review loops, agent work runs, the trivial lane ---
const m3 = createM3({ dataDir: DATA, fileAllow: store.fileAllow, studioUrl: () => `http://127.0.0.1:${PORT}`, send,
  provider: (id, model) => { const s = chatSettings(); if (id && !(choices as readonly string[]).includes(id)) throw new Error(`unknown provider identity: ${id}`); const pid = id || s.provider; return makeProvider(pid, model || s.models[pid] || undefined); },
  allowDrive: () => remote.allowDrive });

// --- M6+: one agent runner, the raw event logs, every workflow, self-improvement ---
const agents = new Agents(DATA, () => `http://127.0.0.1:${PORT}`);
// agent rounds in the OS sandbox reach the network only through this proxy, and Studio only through a tools-only
// listener (never the main port: no page, no session, no other route); firstmate's checkout is closed to them
const toolListener = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: async (req) => {
  const u = new URL(req.url); const t = req.headers.get("x-crew-tool-token") ?? "";
  const reply = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  if (!(u.pathname === "/api/tools" || u.pathname.startsWith("/api/tools/"))) return reply({ error: "this listener serves an agent round's tools only" }, 404);
  if (!agents.hasToken(t)) return reply({ error: "no valid agent token" }, 401);
  if (u.pathname === "/api/tools") return reply(agents.toolList(t));
  let a: any = {}; try { a = await req.json(); } catch {}
  return reply(await agents.callTool(t, decodeURIComponent(u.pathname.slice("/api/tools/".length)), a));
} });
const PROTECTED = startup.protectedRoots; // the one list of protected roots: rounds, worktrees and the runtime all read it
// how claude rounds sign in (v1 option A): Studio reads the vendor's login outside the sandbox and hands the round only its token; checked once a minute for the Doctor
let loginCache: { at: number; v: { ok: boolean; source?: string; warn?: string | null; error?: string } } | null = null;
// the Doctor's status never decrypts a login: items by existence only (claudeLoginStatus); the token is read when a round starts
const roundLogin = () => { if (!loginCache || Date.now() - loginCache.at > 60_000) loginCache = { at: Date.now(), v: claudeLoginStatus() }; return loginCache.v; };
// a captain who chose API billing for claude rounds (the earlier keychain/API-key switch, data/round-auth.json) keeps it: moved to data/claude-billing.json, never switched silently
setBillingFile(join(DATA, "claude-billing.json")); setLoginOutcomeFile(join(DATA, "login-outcomes.json"));
try { const ra = join(DATA, "round-auth.json"); if (existsSync(ra)) { const j = JSON.parse(readFileSync(ra, "utf8"));
  if (!existsSync(join(DATA, "claude-billing.json"))) writeFileSync(join(DATA, "claude-billing.json"), JSON.stringify({ billing: j.claude === "api-key" ? "api-key" : "subscription", from: "round-auth.json", at: new Date().toISOString() }));
  rmSync(ra, { force: true }); console.log(`crew-studio: claude round billing kept from round-auth.json: ${j.claude === "api-key" ? "API key" : "subscription"}`); } } catch {}
agents.egress = egress; agents.toolUrl = () => `http://127.0.0.1:${toolListener.port}`; agents.protect = () => PROTECTED;
agents.onChange = (j) => send("agent", { id: j.id, kind: j.kind, status: j.status, ref: j.ref, tools: j.tools });
const fmRaw = new RawLog(join(STATE, "events.jsonl"));
const studioLog = new StudioLog(join(DATA, "events.jsonl"));
const flows = new Workflows(dirname(STATE));
const pickProvider = (id?: string, model?: string) => { const s = chatSettings(); if (id && !(choices as readonly string[]).includes(id)) throw new Error(`unknown provider identity: ${id}`); const pid = id || s.provider; return makeProvider(pid, model || s.models[pid] || undefined); };
let nativeEngineForPolicy: any = null;
const certified = new WeakMap<object, { input: ProviderSelection; expires: number; x?: any }>();
async function nativeSelection(input: ProviderSelection, x?: any): Promise<Provider> {
  const signal = x && x.engine.get(x.run.id) ? x.engine.abortOf(x.run).signal : undefined;
  const capabilities = new Map<string, ProviderCapability>();
  const selected = await selectNativeProvider(input, async (id,pair) => {
    const at = Date.now();
    let cap = id === "codex" ? await probeCodex(undefined, signal) : id==='claude'?await probeClaudeNative(pair,signal): id === "stub" && allowStub ? { provider: id, available: true, auth: "verified" as const, quota: "available" as const, models: [{ id: "no model" }], at, expires: at + 30_000 } : { provider: id, available: false, auth: "unverified" as const, quota: "unknown" as const, models: [], at, expires: at + 30_000, reason: "native auth/model/quota capability adapter is unavailable" };
    if(id==='claude')cap=await refreshStartupClaude(x,input,pair,cap);if(id==='claude')cap=await refreshOwnWorkflowClaude(x,input,pair,cap);
    capabilities.set(id, cap); return cap;
  }, (id, model, effort) => id === "codex" ? codexProvider(model, undefined, { model, effort }) : id==='claude'?makeNativeClaudeProvider(capabilities.get(id)!,{model,effort}):makeProvider(id, model));
  if (signal?.aborted || x && x.engine.get(x.run.id) && !x.engine.owns(x)) throw new ProviderRefusal("native round owner ended during capability verification");
  certified.set(selected.provider, { input, expires: capabilities.get(selected.provider.id)!.expires, x });
  if (x && x.engine.get(x.run.id)) { x.engine.record(x, "provider-selection", { data: selected.evidence }); const step = [...x.run.steps].reverse().find((s: any) => s.node === x.node.id && s.state === "running"); if (step) { step.provider = selected.provider.id; step.model = selected.provider.model; step.effort = selected.provider.reasoningEffort ?? null; } x.save(); }
  return selected.provider;
}
const nativePick = async (x: any, pick: any, context?: { role: string; explicit: boolean }): Promise<Provider> => {
  const settings = chatSettings(), config = codexConfig(PROJECT), hostView = main.view();
  const host = hostView.state === "attached" && hostView.driver.holder === "studio" ? hostView.host : null;
  const role = context?.role ?? (x.node.role === "worker" || x.node.mode === "deliver" ? "worker" : x.node.role ?? "coordinator");
  const roleDef = x.run.def.roles.find((r: any) => r.id === x.node.role);
  const staffed = x.engine.deps.approvedPick?.(x.run,x.node,context?.role === "judge" ? "reviewer" : context?.role);
  if(staffed)pick=staffed;
  const explicit = !!staffed || (context?.explicit ?? !!(x.rn.agent || x.node.provider || roleDef?.provider || x.run.params.provider));
  const configured: ProviderSelection["configured"] = { codex: { model: settings.models.codex || process.env.CREW_CODEX_MODEL || config.model, effort: config.effort }, claude: { model: settings.models.claude || process.env.CREW_CLAUDE_MODEL || "claude-sonnet-5-5",effort:configuredClaudeEffort(settings.models.claude || process.env.CREW_CLAUDE_MODEL || "claude-sonnet-5-5") }, stub: { model: "no model" } };

  for (const id of choices) if (!configured[id]) configured[id] = { model: settings.models[id] || null };
  const fallback = x.engine.policies.get("vendor_policy.fallback", { project: x.engine.queueProject(x.run), workflow: x.run.def.policies }).value;
  if (!Array.isArray(fallback) || fallback.some(id => typeof id !== "string")) throw new ProviderRefusal("configured fallback chain is invalid");
  // Offline fixture provider is an explicit setting, never a real-vendor fallback.
  const fixture = allowStub && settings.provider === "stub" && !explicit;
  const provider = fixture ? "stub" : !explicit && role === "reviewer" ? String(x.engine.policies.get("vendor_policy.reviewer", { project: x.engine.queueProject(x.run), workflow: x.run.def.policies }).value) : !explicit && role === "coordinator" && host ? host : pick.provider;
  return nativeSelection({ role, host, explicit: explicit || fixture || role === "reviewer", provider, model: explicit ? pick.model : configured[provider]?.model ?? null, roleModel: !explicit ? x.node.model ?? roleDef?.model ?? null : null, effort: explicit&&Object.hasOwn(pick,"effort")?pick.effort??null:configured[provider]?.effort??null, configured, fallback, known: [...choices] }, x);

};
agents.providerAdmission = createNativeProviderAdmission({certified,engine:()=>nativeEngineForPolicy,select:nativeSelection,pick:nativePick});
const improve = createImprove({ dataDir: DATA, flows, agents, events: (src) => (src === "studio" ? studioLog.poll() : fmRaw.poll()), provider: pickProvider, send });
const changes = createChanges({ dataDir: DATA, flows, skills: improve.skills, agents, log: studioLog, provider: pickProvider, send });
// the trivial lane's cards carry their door too (README.md + one asset: normally trivial)
{ const orig = m3.lane.cards.bind(m3.lane);
  m3.lane.cards = () => orig().map((c: any) => ({ ...c, door: classify(c.kind === "update" ? [{ path: c.asset, added: 1, removed: 1 }] : [{ path: "README.md", added: 1 }, { path: c.asset, added: 1 }], { defaults: orgDefaults(DATA) }) })); }
const m7 = createM7({ dataDir: DATA, flows, skills: improve.skills, evals: improve.evals, agents, log: studioLog, refuse: [...PROTECTED, DATA, ROOT], provider: pickProvider, send });
const docs = createDocs({ dataDir: DATA, store: m3.store, agents, skills: improve.skills, log: studioLog, provider: pickProvider, send });
m3.runs.docSystem = () => { try { return improve.skills.text("documents", "writer"); } catch { return ""; } };
const skins = new Skins(DATA);
// first run: the Studio-wide operating rules start from a short generic default the captain edits in Settings
try { new OperatingRules(DATA).seed(); } catch (e: any) { console.warn(`crew-studio: operating rules: ${e?.message ?? e}`); }
// the sandbox repository the coding workflow runs on (data/demo-repo, project "sandbox"); CREW_SANDBOX=0 skips it
if (process.env.CREW_SANDBOX !== "0") { try { prepareSandbox(DATA); registerSandbox(DATA); } catch (e: any) { console.warn(`crew-studio: sandbox repo: ${e?.message ?? e}`); } }
// the shared git config of Studio's own checkout, every registered project and the sandbox: a broken one (core.bare=true,
// a stray core.worktree or hooksPath) breaks the checkout and every linked worktree at once; reported here and in the Doctor, never fixed
const gitConfigTargets = () => { let projects: { id: string; path: string | null }[] = []; try { projects = new Projects(DATA).nativeSnapshot().records as any; } catch {} // the strict reader: no migration as a side effect
  return [...(!COMPILED ? [{ label: "Crew Studio's own checkout", path: SRC_ROOT }] : []), ...projects.map((p) => ({ label: `project ${p.id}`, path: p.path })), { label: "built-in sandbox (data/demo-repo)", path: join(DATA, "demo-repo") }]; };
const gitConfigNow = () => { try { return gitConfigReport(gitConfigTargets()); } catch { return { checked: [], problems: [] }; } };
for (const p of gitConfigNow().problems) console.warn(`crew-studio: WARNING broken shared git config in ${p.label} (${p.repo}): ${p.key}=${p.value}. ${p.why}. Studio does not change it; fix by hand: ${p.fix}`);
// --- v2: Studio's native runtime (workflows that really run, checks, Studio-owned cards) ---
const worktrees = new Worktrees(DATA, { protect: () => PROTECTED });
let packGenesis: ReturnType<typeof installPackGenesis>;
const coffeeTools = (()=>{const rendering=renderEnv();return discoverCoffeeFilmCapability([process.env.CREW_HYPERFRAMES_ROOT,TOOLS_DIR,!COMPILED?ROOT:null,join(dirname(process.execPath),"..")].filter(Boolean)as string[],{browser:process.env.HYPERFRAMES_BROWSER_PATH,playwright:rendering.playwright,ffmpeg:process.env.CREW_FFMPEG||Bun.which("ffmpeg"),ffprobe:Bun.which("ffprobe")});})();
let staffingClaudeCapabilities:ProviderCapability[]=[];
/** Login presence per provider for the readiness gate, read once per gate run and kept 30 s: environment and files are read
 *  directly; Claude's keychain items are asked about with an async `security find-generic-password` (existence only, no secret
 *  read), so the event loop never waits on it. Nothing is written and no sign-in is ever started. */
let gateLoginCache: { at: number; v: Promise<Record<string, "logged-in" | "not-logged-in" | "unknown">> } | null = null;
const gateLogins = () => {
  if (gateLoginCache && Date.now() - gateLoginCache.at < 30_000) return gateLoginCache.v;
  const v = (async () => {
    const out: Record<string, "logged-in" | "not-logged-in" | "unknown"> = {};
    try { out.claude = (await claudeLoginPresenceAsync()).ok ? "logged-in" : "not-logged-in"; } catch { out.claude = "unknown"; }
    try { const k = process.env.CODEX_API_KEY?.trim(); if (k && /^sk-[A-Za-z0-9_-]{20,}$/.test(k)) out.codex = "logged-in"; else { const f = join(process.env.CODEX_HOME || join(homedir(), ".codex"), "auth.json"); if (!existsSync(f)) out.codex = "not-logged-in"; else { const j = JSON.parse(await Bun.file(f).text()); out.codex = j?.tokens?.access_token || j?.OPENAI_API_KEY ? "logged-in" : "not-logged-in"; } } } catch { out.codex = "unknown"; }
    out.stub = allowStub ? "logged-in" : "not-logged-in";
    return out;
  })();
  gateLoginCache = { at: Date.now(), v }; return v;
};

const runtime = createRuntime({coffeeVideo:coffeeTools.ready?(request=>renderCoffeeFilm(request,coffeeTools)):undefined,coffeeFilmStatus:{ready:coffeeTools.ready,reason:coffeeTools.ready?null:coffeeTools.reason},startupModel:provider=>{const settings=chatSettings();return provider==="claude"?claudePrimaryPair().model:settings.models.codex||process.env.CREW_CODEX_MODEL||codexConfig(PROJECT).model;},coffeeChoice:()=>{const config=codexConfig(PROJECT),model=chatSettings().models.codex||process.env.CREW_CODEX_MODEL||config.model;return model?{provider:"codex",model,effort:config.effort}:null;}, staffingApproved:a=>{if(main.view().context==='studio'&&main.view().state!=='detached')main.enqueue('card',staffingApprovedTurn(a),'studio-native');},staffingPending:intent=>{if(main.view().context==="studio"&&main.view().state!=="detached")main.enqueue("card",`Project registered for: ${intent.work.text}. No workflow work has started. Offer one complete available default staffing plan and optional advanced customization. If the captain requests defaults, adopt them in one turn, then show the real configuration approval card before dispatch. / 專案已註冊，工作尚未開始。請提供一組可用預設配置；船長選擇採用時一次記錄整組，再顯示真正的配置核准卡。進階自訂可選，不必逐角色訪談。`,"studio-native");},staffingAdmission:role=>role.provider==='claude'&&staffingClaudeCapabilities.some(cap=>isClaudeExecutionAdmission(cap,{model:role.model,effort:role.effort})),staffingFacts:async(o)=>{const settings=chatSettings(),model=settings.models.claude||process.env.CREW_CLAUDE_MODEL||'claude-sonnet-5-5',pair={model,effort:configuredClaudeEffort(model)};const [cap,claude,inventory]=await Promise.all([probeCodex(),probeClaudeNative(pair),nativeClaude.models({fresh:o?.fresh})]);staffingClaudeCapabilities=nativeClaude.verifiedCapabilities();const verified=new Map<string,Set<string>>();for(const cap of staffingClaudeCapabilities)for(const m of cap.models){let efforts=verified.get(m.id);if(!efforts)verified.set(m.id,efforts=new Set());for(const effort of claudeEfforts(m.id))if(isClaudeExecutionAdmission(cap,{model:m.id,effort}))efforts.add(effort);}
  // models: what passed exact execution (readiness); candidates: every model the installed CLI offers (the choices)
  return[{provider:'codex',support:'supported' as const,auth:cap.auth,quota:cap.quota,expires:cap.expires,models:cap.models.map(m=>({id:m.id,efforts:m.efforts??[]})),default:{model:settings.models.codex||process.env.CREW_CODEX_MODEL||codexConfig(PROJECT).model||'',effort:codexConfig(PROJECT).effort},detectedAt:cap.at,inventory:cap.available?'detected' as const:'unavailable' as const,login:cap.auth==='verified'?'logged-in' as const:/no verified native Codex login|auth verification failed/.test(cap.reason??'')?'not-logged-in' as const:'unknown' as const,...cap.reason?{reason:cap.reason}:{}},{provider:'claude',support:'supported' as const,auth:claude.auth,quota:claude.quota,expires:claude.expires,models:[...verified].map(([id,efforts])=>({id,efforts:[...efforts]})),candidates:inventory.models.map(m=>({id:m.id,efforts:m.efforts})),reason:claude.reason,detectedAt:inventory.at,inventory:inventory.source==='cli'?'detected' as const:'unverified-fallback' as const,...inventory.reason?{inventoryReason:inventory.reason}:{},login:claude.loginState}];},dataDir: DATA, agents, provider: pickProvider, defaultProvider: () => { const s = chatSettings(); return { provider: s.provider, model: s.models[s.provider] || null }; }, selectProvider: nativePick,
  // the readiness gate: login state is read from what is on disk (never a probe that could start a sign-in); repair turns go to Firstmate's queue
  // repair turns go only to Studio's own Firstmate conversation (like staffingPending), never a takeover terminal session
  readiness: { logins: gateLogins, knownProviders: () => [...choices], repoRoot: ROOT, ...(Number(process.env.CREW_GATE_REPAIR_WAIT_MS) > 0 ? { repairWaitMs: Number(process.env.CREW_GATE_REPAIR_WAIT_MS) } : {}), ask: (text: string, repair: { draft: string; nonce: string }) => { const v = main.view(); if (v.context !== "studio" || v.state === "detached") return false; main.enqueue("card", text, "studio-gate", undefined, repair); return true; } },
  log: studioLog, send, fmRoot: dirname(STATE), protectedRoots: PROTECTED, store, m3: { store: m3.store, runs: m3.runs, lane: m3.lane,useArtifactReviewPolicy:m3.useArtifactReviewPolicy }, fileorg: m7.fileorg, docs, improve, studioUrl: () => `http://127.0.0.1:${PORT}`,
  // the crew's pick for the image step when the Studio team staffs it; else Studio's configured Codex model
  generateImage: (prompt, authorize, signal, reference, rules, crew) => {
    const config = codexConfig(PROJECT), model = crew?.model || chatSettings().models.codex || process.env.CREW_CODEX_MODEL || config.model;
    if (!model) throw new Error("Configure a Codex model before generating images");
    return generateCodexImage({ prompt, authorize, signal, reference, rules: rules ?? new OperatingRules(DATA).section(null), approved: { model, effort: crew ? crew.effort : config.effort } });
  },
  // domain packs' runtime steps: the firstmate coding pipeline (packs/firstmate)
  install: [(engine, c) => { installCode(engine, { dataDir: c.dataDir, projects: c.projects, improve, poller:githubPoller }); packGenesis = installPackGenesis(engine, { dataDir: c.dataDir, artifacts: m3.store }); }], skills: improve.skills });
nativeEngineForPolicy = runtime.engine;
// an agent's question goes to Firstmate first: it answers through studio_answer_agent_question, or escalates to the captain with its reason
runtime.engine.askFirstmate = (r, node, question, visit, o) => {
  if (main.view().state === "detached") return false;
  // an escalation (step-back, no progress, round budget, scope blocked …): Firstmate decides within the spec or escalates with its diagnosis
  if (o?.escalation) { main.enqueue("wake", `Escalation in Task ${r.id}, step ${node.id} (${node.label}).\n${question}\nDecide with studio_answer_agent_question {task:"${r.id}", node:"${node.id}", visit:${visit}, choice:"<option id>", answer:"<your reason, or the picked value>"}, or escalate {task:"${r.id}", node:"${node.id}", visit:${visit}, escalate:"<what is stuck and why, in plain words>", recommendation:"<what the captain should pick>"}. / Task ${r.id} 卡住了：能在 spec 內決定就自己決定；只有單向決定、憑證或權限、或無法推斷的偏好才轉交船長，並寫清楚卡在哪、為什麼、建議怎麼選。${amendmentsNotice(runtime.engine.amendments(r))}`, "studio-native"); return true; }
  main.enqueue("wake", `Agent question in Task ${r.id}, step ${node.id} (${node.label}): ${question}\nRead the step's operating manual section first (studio_manual section ${manualFor(r.workflow, node.role ?? node.args?.coordinator)}). Answer it yourself with studio_answer_agent_question {task:"${r.id}", node:"${node.id}", visit:${visit}, answer:"…"}. Escalate to the captain (escalate:"<your reason>") only for a one-way decision, a credential or permission, or a preference you cannot infer. / Task ${r.id} 的 agent 提問：請用 studio_answer_agent_question 自己回答；只有單向決定、憑證或權限、或無法推斷的偏好才轉交船長並寫明理由。${amendmentsNotice(runtime.engine.amendments(r))}`, "studio-native");
  return true;
};
// the "another model" picker on step-back cards: each provider with its configured model, and with its default model
runtime.engine.modelChoices = () => { const s = chatSettings(); return choices.filter((id) => id !== "stub").flatMap((id) => [...(s.models[id] ? [{ value: `${id}/${s.models[id]}`, label: `${id} · ${s.models[id]}` }] : []), { value: id, label: `${id} · default model` }]); };
runtime.engine.resumeFirstmateQuestions(); // questions pending at the restart: their wake notices died with the old process
gh.start();
process.once("exit",()=>{gh.stop();githubPoller.stop();});
const tasksApi = createTasksApi({ list: () => runtime.engine.list(), get: (id) => runtime.engine.get(id), openCards: () => runtime.engine.cards.list({ open: true }), projectOf: (r) => runtime.engine.projectRow(r),
  runView: async (id) => { const r = await runtime.handle(new Request(`http://127.0.0.1/api/wruns/${id}`), new URL(`http://127.0.0.1/api/wruns/${id}`), { kind: "desktop" }, false); return r && r.ok ? r.json() : null; } });
const compareApi = createCompare({ dataDir: DATA, get: (id) => runtime.engine.get(id), current: (wf) => runtime.engine.defs.get(wf), phoneRaw: () => transcripts.settings().phoneRaw });
// rounds of an earlier Studio left their throwaway homes and tmp behind (it stopped mid-round): no job is live at start, so they go
try { const rd = join(DATA, "rounds"); if (existsSync(rd)) for (const d of readdirSync(rd)) for (const x of ["home", "tmp"]) { const p = join(rd, d, x); if (existsSync(p)) rmSync(p, { recursive: true, force: true }); }
  if (existsSync(rd)) for (const d of readdirSync(rd)) if (d.startsWith("install-")) rmSync(join(rd, d), { recursive: true, force: true }); } catch {}
// one worktree per task under data/work (src/worktrees.ts): at start, worktrees and locks no live run owns are swept, each with its reason
try { worktrees.migrate(); } catch (e: any) { console.warn(`crew-studio: worktree migration: ${e?.message ?? e}`); }
try { const sw = worktrees.sweep((run) => { const r = run ? runtime.engine.get(run) : null; return !!r && (!["succeeded", "failed", "cancelled"].includes(r.status) || r.status === "failed" && !r.archived && !r.parked); }, Number(runtime.engine.policies.get("worktree.keep_days").value ?? 7));
  if (sw.removed.length || sw.locks.length) studioLog.emit({ type: "worktree_sweep", workflow: "studio", summary: `startup sweep: ${sw.removed.length} worktrees, ${sw.locks.length} stale locks removed (data/work/sweep.log)`, data: sw }); } catch (e: any) { console.warn(`crew-studio: worktree sweep: ${e?.message ?? e}`); }
// additions to the sandbox repository (a normal commit on main each), held while a run works on it: its branch fast-forwards only if main stays put
if (process.env.CREW_SANDBOX !== "0") { try { const repo = join(DATA, "demo-repo");
  const live = () => runtime.engine.list().filter((r) => !["succeeded", "failed", "cancelled"].includes(r.status) && (r.ctx?.repo ? r.ctx.repo === repo : !r.params?.repo)).map((r) => r.id);
  applySandboxAddons(DATA, { live, log: (m) => studioLog.emit({ type: "sandbox_addition", workflow: "studio", summary: m }) }); } catch (e: any) { console.warn(`crew-studio: sandbox additions: ${e?.message ?? e}`); } }
// the skill library (unit agent-skills): the v2 workflows' roles are versioned in the same store; its routes are the captain's (cookie + Origin for an import)
improve.skills.extraSource = (wf, role) => { const r = runtime.defs.get(wf)?.roles.find((x) => x.id === role); if (!r) return null; try { return { text: runtime.engine.deps.skillText(r.skill), source: r.skill }; } catch { return null; } };
// one source of truth for a role's text: rounds (and staffing pins) read Studio's current version, the same text the Improve page shows and edits;
// a changed source (a pack update) becomes the next version there first, so the page never shows a stale copy
runtime.engine.deps.roleSkill = (wf, role, ref) => {
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(wf) || !/^[a-z0-9][a-z0-9-]{0,40}$/.test(role)) return null;
  const cur = improve.skills.current(wf, role, { text: runtime.engine.deps.skillText(ref), source: ref });
  return { text: cur.text, version: cur.n };
};
const skillRoutes = createSkillRoutes({ skills: improve.skills, defs: () => runtime.defs, session: sessionToken(DATA), log: studioLog });
// the built-in skill library (packs/*/skills) is in data/skills/_library from startup, on a new data folder and an existing one
try { improve.skills.library(); } catch (e: any) { console.warn(`crew-studio: the built-in skill library could not be seeded: ${e?.message ?? e}`); }
m7.packs.nativePublished = () => packGenesis.pg.publishedSources();
m7.useNativeGenesis((description, id, by) => { const task = packGenesis.pg.start(description, id, by); return { id: task.id, task, native: true, link: `#/tasks/${task.id}` }; });
ctx.packs = { draft: (description: string) => m7.genesis(description, undefined, "captain (chat)") };
ctx.improve = { roles: () => improve.skills.overview().map((s) => ({ workflow: s.workflow, role: s.role })), edit: (a) => improve.startChatEdit({ ...a, by: "captain (chat)" }) };

// --- http ---
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json" };
Object.assign(TYPES, { ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".png": "image/png" });
const pub = join(ROOT, "public");
// the source checkout serves public/ from disk; the binary serves the copies embedded in it
const serveStatic = (path: string) => {
  const rel = path === "/" || path === "/remote" || path === "/remote/" ? "/index.html" : path;
  if (COMPILED) {
    const f = ASSETS[rel];
    return f ? new Response(Bun.file(f), { headers: { "content-type": TYPES[extname(rel)] ?? "application/octet-stream", "cache-control": "no-cache" } }) : null;
  }
  const file = normalize(join(pub, rel));
  if (!file.startsWith(pub) || !existsSync(file) || statSync(file).isDirectory()) return null;
  return new Response(Bun.file(file), { headers: { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" } });
};

const SESSION = sessionToken(DATA);
// the sidebar's Projects section and each project's page: read only (src/project-overview.ts)
const projectOverview = createProjectOverview({ dataDir: DATA, projects: new Projects(DATA), engine: runtime.engine, session: SESSION, worktrees, artifacts: m3.store, protectedRoots: PROTECTED });
async function handle(req: Request, via: "loopback" | "lan"): Promise<Response> {
    const url = new URL(req.url);
    // /api/tasks is the new name of /api/wruns: a path the run routes serve is handed to them under its old name
    { const a = taskAlias(url.pathname, req.method !== "GET" && req.method !== "HEAD"); if (a) url.pathname = a; }
    const p = url.pathname;
    if(via === "loopback" && req.method === "GET" && ["localhost","[::1]"].includes(url.hostname) && (p === "/session" || !p.startsWith("/api/"))) { const canonical=new URL(url);canonical.hostname="127.0.0.1";return new Response(null,{status:307,headers:{location:canonical.href,"cache-control":"no-store","referrer-policy":"no-referrer"}}); }
    // who is asking: this Mac (loopback Host) or a paired phone (tailnet Host + token); anything else is refused
    if (p === "/api/remote/pair" && req.method === "POST") {
      { const o = req.headers.get("origin"); if (o && o !== url.origin) return json({ error: "a request from another site cannot pair", code: "crossSite" }, 403); }
      const host = (req.headers.get("host") ?? "").toLowerCase().replace(/:\d+$/, "");
      const full = (req.headers.get("host") ?? "").toLowerCase();
      const known = via === "lan" ? remote.lanHost === full : ["127.0.0.1", "localhost", "[::1]"].includes(host) || remote.tailnetNames.has(host);
      if (!known) return json({ error: "unknown Host" }, 421);
      let body: any; try { body = await req.json(); } catch { return json({ error: "json only" }, 400); }
      const r = remote.pair(String(body?.code ?? ""), String(body?.name ?? "phone"));
      return r.ok ? json({ token: r.token, device: r.device, allowDrive: remote.allowDrive }) : json({ error: r.error }, r.status);
    }
    const who = remote.who(req, url, via);
    // the page itself carries no data: an unpaired phone may load it (to pair), but only on a known Host
    if (who.kind === "refused" && who.status === 401 && !p.startsWith("/api/") && !p.startsWith("/files/")) return serveStatic(p) ?? new Response("not found", { status: 404 });
    if (who.kind === "refused") return json({ error: who.error, code: who.status === 401 ? "pair" : "host" }, who.status);
    const writing = req.method !== "GET" && req.method !== "HEAD";
    // the one guard in front of every mutating route: same site, a Studio session (or a paired phone), JSON
    if (writing && !EXEMPT(p)) { const g = guardWrite(req, url, SESSION, who.kind === "phone"); if (g) return json({ error: g.error, code: g.code }, g.status); }
    if (who.kind === "phone" && writing) {
      if (DESKTOP_ONLY.has(p)) return json({ error: "do this on the Mac", code: "desktopOnly" }, 403);
      if (PHONE_DRIVE.has(p) && !remote.allowDrive) return json({ error: "this phone may read and interrupt only; allow phone driving on the Mac first", code: "noDrive" }, 403);
    }
    if(p==='/api/models'&&!writing){
      if(who.kind!=='desktop'||!hasSession(req,SESSION))return json({error:'Desktop session required'},403);
      const settings=chatSettings(),configured=settings.models.claude||process.env.CREW_CLAUDE_MODEL||'claude-sonnet-5-5';let codex:any[]=[];
      try{codex=(await probeCodex(undefined,req.signal)).models.map(m=>({id:m.id,efforts:m.efforts??[]}));}catch{}
      // the installed CLI's own list (src/providers/claude-native.ts models()); a verified model it no longer lists stays
      const inventory=await nativeClaude.models({signal:req.signal}),claude=[...inventory.models.map(m=>({id:m.id,efforts:m.efforts}))];
      for(const id of nativeClaude.verifiedCapabilities().flatMap(c=>c.models.map(m=>m.id)))if(!claude.some(m=>m.id===id)&&validClaudePair({model:id,effort:null}))claude.push({id,efforts:claudeEfforts(id)});
      return json({providers:[{id:'codex',models:codex},{id:'claude',models:claude,source:inventory.source,detectedAt:inventory.at,...inventory.reason?{reason:inventory.reason}:{}}],configured,executionVerified:false});
    }
    if(p==='/api/codex/native/status'&&!writing){
      if(who.kind!=='desktop')return json({error:'Desktop session required'},403);
      if(!hasSession(req,SESSION))return json({error:'Studio session required'},401);
      const config=codexConfig(PROJECT),model=chatSettings().models.codex||process.env.CREW_CODEX_MODEL||config.model,effort=config.effort;
      // Read capability metadata only; never acquire or start the main session.
      try{
        await selectNativeProvider({role:'worker',host:null,explicit:true,provider:'codex',model,effort,configured:{codex:{model,effort}},fallback:[],known:['codex']},
          ()=>probeCodex(undefined,req.signal),(_id,m,e)=>codexProvider(m,undefined,{model:m,effort:e}));
        return json({state:'ready',model,effort});
      }catch(e){return json({state:'hold',model,effort,reason:e instanceof Error?e.message:'Capability verification unavailable'});}
    }
    if(p==='/api/claude/native/status'&&!writing){if(who.kind==='desktop'&&!hasSession(req,SESSION))return json({error:'Studio session required'},401);const s=chatSettings(),model=url.searchParams.get('model')||s.models.claude||process.env.CREW_CLAUDE_MODEL||'claude-sonnet-5-5',effort=url.searchParams.get('effort')||configuredClaudeEffort(model);return json(await probeClaudeNative({model,effort},req.signal));}
    if(p==='/api/claude/account'&&!writing){if(who.kind==='desktop'&&!hasSession(req,SESSION))return json({error:'Studio session required'},401);return json(claudeLogin.view());}
    if((p==='/api/claude/account/login'||p==='/api/claude/account/cancel')&&writing){if(who.kind!=='desktop')return json({error:'do this on the Mac',code:'desktopOnly'},403);if(p.endsWith('/cancel'))return json(await claudeLogin.cancel());try{return json(claudeLogin.start());}catch(e:any){return json({error:String(e?.message??e)},409);}}
    if((p==='/api/claude/native/verify'||p==='/api/claude/native/cancel')&&writing){if(p.endsWith('/cancel')){await nativeClaude.cancel();return json({ok:true});}const b=await req.json().catch(()=>null);if(!b||Object.keys(b).some(k=>!['model','effort','confirm'].includes(k))||b.confirm!==true||!validClaudePair({model:b.model,effort:b.effort??null}))return json({error:'Confirm an exact selected Claude model/effort; this performs one bounded model request'},400);const cap=await nativeClaude.verify({model:b.model,effort:b.effort??null},{confirm:true,signal:req.signal});return json(cap,cap.admission==='verified-execution'?200:409);}
    { const rt = await takeover.handle(req, url, who as any, writing); if (rt) return rt; }
    { const rx = await transcripts.handle(req, url, who as any, writing); if (rx) return rx; }
    { const rg = await graphMode.handle(req, url, writing); if (rg) return rg; }
    { const r3 = await m3.handle(req, url, who, writing); if (r3) return r3; }
    { const rp = await packGenesis.handle(req, url, who, writing); if (rp) return rp; }
    { const r6 = await improve.handle(req, url, who, writing); if (r6) return r6; }
    { const ro = await projectOverview.handle(req, url, who as any, writing); if (ro) return ro; }
    { const rc = await changes.handle(req, url, who, writing); if (rc) return rc; }
    { const r7 = await m7.handle(req, url, who, writing); if (r7) return r7; }
    { const r8 = await docs.handle(req, url, who, writing); if (r8) return r8; }
    { const rc = await compareApi.handle(url, who as any, writing); if (rc) return rc; }
    { const rk = await tasksApi.handle(url, writing); if (rk) return rk; }
    { const rr = await runtime.handle(req, url, who, writing); if (rr) return rr; }
    { const rk = await skillRoutes(req, url, who, writing); if (rk) return rk; }
    // --- skins: read-only snapshot, pinned files, no network ---
    if (p.startsWith("/skin/") && !writing) return skins.serve(p);
    if (p === "/api/skins" && !writing) return json({ skins: skins.list(), kit: bundledText("skins/kit/README.md") });
    if (p === "/api/skins/install" && writing) { if (who.kind === "phone") return json({ error: "do this on the Mac", code: "desktopOnly" }, 403);
      let b: any = {}; try { b = await req.json(); } catch {} try { return json(skins.install(String(b?.path ?? ""), b?.grantNetwork === true)); } catch (e: any) { return json({ error: String(e?.message ?? e) }, 400); } }
    { const sm = /^\/api\/skins\/([\w-]+)\/(snapshot|check|uninstall)$/.exec(p);
      if (sm) {
        const sk = skins.list().find((x) => x.id === sm[1]); if (!sk) return json({ error: "no such skin" }, 404);
        if (sm[2] === "snapshot" && !writing) {
          const native = nativeSkinData(runtime.engine.list(), runtime.engine.cards.list({ open: true }), [...agents.jobs.values()]);
          return json(sk.ok ? snapshotFor(sk.manifest?.permissions ?? [], {
            tasks: [...native.tasks, ...tasks()], crew: [...native.crew, ...crewCache], pending: [...native.pending, ...pending],
            flow: native.flow.nodes.length ? native.flow : flow,
          }) : { error: "this skin fails its checks" }, sk.ok ? 200 : 409);
        }
        if (sm[2] === "check") return json(skins.check(sk.id));
        if (sm[2] === "uninstall" && writing) { if (who.kind === "phone") return json({ error: "do this on the Mac", code: "desktopOnly" }, 403); if (sk.kind !== "installed") return json({ error: "a built-in skin stays" }, 409); skins.uninstall(sk.id); return json({ ok: true }); }
      } }
    if (p === "/api/flows" && !writing) return json(flows.list());
    if (p === "/api/agents" && !writing) return json([...agents.jobs.values()].reverse().slice(0, 50).map((j) => ({ ...j, log: j.log.slice(-20) })));
    if (p.startsWith("/api/agents/") && !writing) { const j = agents.jobs.get(p.slice("/api/agents/".length)); return j ? json(j) : json({ error: "no such job" }, 404); }
    // the captain's operating rules: anyone on this Mac with Studio's session reads them; only the captain's own page writes them
    if (p === "/api/operating-rules") {
      if (who.kind !== "desktop") return json({ error: "do this on the Mac", code: "desktopOnly" }, 403);
      if (!hasSession(req, SESSION)) return json({ error: "Studio session required" }, 401);
      const rules = new OperatingRules(DATA);
      const view = () => ({ studio: rules.studio(), projects: runtime.projects.list().map((x) => ({ id: x.id, name: x.name, ...rules.project(x.id) })), defaults: DEFAULT_OPERATING_RULES, defaultsZhTW: DEFAULT_OPERATING_RULES_ZH_TW, max: 8000 });
      if (!writing) return json(view());
      // a captain edit: the page's own session cookie (never a script's x-crew-session header) on a same-origin request from this Mac
      if (!hasSessionCookie(req, SESSION) || req.headers.get("origin") !== url.origin || req.headers.get("sec-fetch-site") !== "same-origin")
        return json({ error: "Only the captain edits operating rules, from Studio's page on this Mac / 只有船長能在這台 Mac 的 Studio 頁面編輯作業規則", code: "captainOnly" }, 403);
      let b: any; try { b = await req.json(); } catch { return json({ error: "json only" }, 400); }
      if (!b || typeof b !== "object" || Array.isArray(b) || Object.keys(b).some((k) => k !== "project" && k !== "text")) return json({ error: "send {project?, text}" }, 400);
      const project = b.project == null || b.project === "" ? null : String(b.project);
      if (project && !runtime.projects.get(project)) return json({ error: "no such project" }, 404);
      try { rules.set({ project }, b.text, "captain"); } catch (e: any) { const m = String(e?.message ?? e); return json({ error: m, ...(/cannot be read/.test(m) ? { code: "rulesUnreadable" } : {}) }, /cannot be read/.test(m) ? 409 : 400); }
      studioLog.emit({ type: "operating_rules_changed", workflow: "studio", actor: "captain", summary: project ? `operating rules changed for ${project}` : "Studio-wide operating rules changed", data: { project } });
      return json(view());
    }
    if (p === "/api/remote/me") return json({ kind: who.kind, device: who.kind === "phone" ? { id: who.device.id, name: who.device.name } : null, allowDrive: remote.allowDrive });
    if (p === "/api/remote") return json({ devices: remote.devices(), allowDrive: remote.allowDrive, tailscale: ts, serveOn, live: tsRunner.live, lan: lanState(),
      command: serveCommand(PORT).join(" "), offCommand: serveOffCommand().join(" "), pairUrl: ts.url });
    if (p === "/api/remote/pair/start" && writing) { const c = remote.startPairing(); const lan = lanState();
      return json({ ...c, url: lan.on && lan.url ? `${lan.url}?pair=${c.code}` : ts.url ? `${ts.url}?pair=${c.code}` : `http://127.0.0.1:${PORT}/?pair=${c.code}` }); }
    if (p === "/api/remote/lan" && writing) {
      let b: any = {}; try { b = await req.json(); } catch {}
      if (b?.enable === true && b?.confirm !== true) return json({ error: "confirm first", ...lanState() }, 400);
      const r = setLan(b?.enable === true);
      return json({ ...r, ...lanState() }, r.ok ? 200 : 500);
    }
    // --- Doctor ---
    // which process answers (tests check they reach the server they started)
    if (p === "/api/instance" && !writing) return json(launchAuthority.respond(url.searchParams.get("challenge")));
    if (p === "/api/doctor") return json({ items: doctor(), os: process.platform, compiled: COMPILED, installer: installs.runner.real ? "real" : "mock", execution: executionMode(),
      jobs: [...installs.jobs.values()].slice(-5) });
    if (p === "/api/doctor/methods") { const item = url.searchParams.get("item") ?? ""; return json({ item, methods: methodsFor(item), login: LOGINS[item] ?? null }); }
    if (p.startsWith("/api/doctor/job/")) { const j = installs.jobs.get(p.slice("/api/doctor/job/".length)); return j ? json(j) : json({ error: "no such job" }, 404); }
    if (p === "/api/doctor/install" && writing) {
      let b: any = {}; try { b = await req.json(); } catch {}
      const m = methodsFor(String(b?.item ?? "")).find((x) => x.id === b?.method);
      if (!m) return json({ error: "no such installer" }, 404);
      if (m.kind === "open") return json({ open: m.url });
      if (!m.usable) return json({ error: `this method needs ${m.needs.join(", ")}` }, 409);
      if (b?.confirm !== true) return json({ error: "confirm first", command: m.argv.join(" "), source: m.source, location: m.location }, 400);
      try { return json(installs.start(String(b.item), m)); } catch (e: any) { return json({ error: String(e?.message ?? e) }, 409); }
    }
    if(p==="/api/codex/account"&&!writing)return json(codexAccount.view());
    if(["/api/codex/account/login","/api/codex/account/cancel","/api/codex/account/verify"].includes(p)&&writing){try{return json(p.endsWith("/login")?await codexAccount.start():p.endsWith("/cancel")?await codexAccount.cancel():await codexAccount.verify());}catch{return json({error:"Codex account action unavailable; complete/cancel any existing sign-in and release Studio-owned firstmate before retrying / Codex 帳號操作無法進行；請先完成或取消登入，並交還 Studio 正在操作的 firstmate"},409);}}
    if (p === "/api/doctor/login" && writing) {
      let b: any = {}; try { b = await req.json(); } catch {}
      if(b?.item==="claude"){try{return json(claudeLogin.start());}catch(e:any){return json({error:String(e?.message??e)},409);}}
      if(b?.item==="codex"){try{return json(await codexAccount.start());}catch{return json({error:"Codex sign-in unavailable; release Studio-owned firstmate or complete/cancel the pending sign-in / 無法登入 Codex；請先交還 Studio 正在操作的 firstmate，或完成／取消目前登入"},409);}}
      const l = LOGINS[String(b?.item ?? "")];
      if (!l) return json({ error: "no login flow for that" }, 404);
      if (!l.argv || process.platform !== "darwin" && b?.item !== "codex") return json({ open: l.url, note: l.note });
      try { return json({ job: installs.start(`login:${b.item}`, { id: "login", label: l.label, argv: l.argv, source: l.url ?? "", location: "", needs: [], admin: false }), note: l.note }); }
      catch (e: any) { return json({ error: String(e?.message ?? e) }, 409); }
    }
    // test mode only: make the mock installer fail, to show the failure display
    if (p === "/api/doctor/mock" && writing && !installs.runner.real) { let b: any = {}; try { b = await req.json(); } catch {} process.env.CREW_MOCK_INSTALL = b?.fail ? "fail" : ""; return json({ ok: true }); }
    if (p === "/api/doctor/cancel" && writing) { let b: any = {}; try { b = await req.json(); } catch {} return installs.cancel(String(b?.id ?? "")) ? json({ ok: true }) : json({ error: "nothing to cancel" }, 404); }
    // --- GitHub token (no gh CLI needed) ---
    if (p === "/api/github/token" && writing) { let b: any = {}; try { b = await req.json(); } catch {} const r = await gh.saveToken(String(b?.token ?? "")); send("github", gh.state); return json(r.ok ? { ok: true, github: gh.state } : r, r.ok ? 200 : 400); }
    if (p === "/api/github/forget" && writing) { gh.forgetToken(); send("github", gh.state); return json({ ok: true, github: gh.state }); }
    // --- API keys for the direct-HTTP chat providers (values never leave this server) ---
    if (p === "/api/keys") {
      if (writing) {
        let b: any = {}; try { b = await req.json(); } catch {}
        if (b?.compatBaseUrl && !/^https?:\/\/[^\s]+$/.test(String(b.compatBaseUrl))) return json({ error: "the endpoint must be an http(s) URL" }, 400);
        saveKeys({ anthropic: b?.anthropic, openai: b?.openai, compatBaseUrl: b?.compatBaseUrl, compatKey: b?.compatKey });
        send("chat", chatInfo());
      }
      return json(keyStatus());
    }
    if (p === "/api/remote/revoke" && writing) { let b: any = {}; try { b = await req.json(); } catch {} return remote.revoke(String(b?.id ?? "")) ? json({ ok: true, devices: remote.devices() }) : json({ error: "no such device" }, 404); }
    if (p === "/api/remote/settings" && writing) { let b: any = {}; try { b = await req.json(); } catch {} remote.setAllowDrive(b?.allowDrive === true); return json({ allowDrive: remote.allowDrive }); }
    if (p === "/api/remote/tailscale" && writing) {
      let b: any = {}; try { b = await req.json(); } catch {}
      if (b?.confirm !== true) return json({ error: "confirm first", command: serveCommand(PORT).join(" ") }, 400);
      const argv = b?.action === "disable" ? serveOffCommand() : serveCommand(PORT);
      const r = tsRunner.run(argv);
      if (r.ok) serveOn = b?.action !== "disable";
      return json({ ok: r.ok, out: r.out, live: tsRunner.live, serveOn, ran: argv.join(" ") }, r.ok ? 200 : 500);
    }
    // --- main session ---
    if (p === "/api/main") return json(main.view());
    if (p === "/api/main/sessions") {
      const host = (url.searchParams.get("host") ?? "claude") as HostId;
      if (!["claude", "codex"].includes(host)) return json({ error: "host must be claude or codex" }, 400);
      try { return json({ host, project: PROJECT, sessions: await main.discover(host) }); } catch (e: any) { return json({ error: String(e?.message ?? e) }, 500); }
    }
    // chat attachments: one file per upload (JSON, base64), read capped; the bytes come back only to this Mac's session or a paired phone
    if (p === "/api/main/attachments" && writing) { const r = await uploadAttachment(req, chatFiles, main.view().state === "detached" ? null : main.view().host); return json(r.body, r.status); }
    { const am = /^\/api\/main\/attachments\/([a-f0-9]{64})$/.exec(p);
      if (am && !writing) {
        if (who.kind === "desktop" && !hasSession(req, SESSION)) return json({ error: "Studio session required" }, 401);
        const f = chatFiles.get(am[1]); if (!f) return json({ error: "no such attachment" }, 404);
        return new Response(Bun.file(f.path), { headers: { "content-type": f.mime, "cache-control": "private, no-store", "x-content-type-options": "nosniff",
          "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox", "content-disposition": `inline; filename="${f.id.slice(0, 12)}.${f.mime === "application/pdf" ? "pdf" : f.mime.split("/")[1]}"` } });
      } }
    if (p.startsWith("/api/main/") && writing) {
      let b: any = {}; try { b = await req.json(); } catch {}
      if (p === "/api/main/attach") { if(codexAccount.blocking)return json({error:"Complete or cancel Codex account action first / 請先完成或取消 Codex 帳號操作"},409); const r = await main.attach(b?.host === "codex" ? "codex" : "claude", String(b?.id ?? "")); return json(r, r.ok ? 200 : 409); }
      if (p === "/api/main/send") {
        const text = String(b?.text ?? "").trim().slice(0, 8000);
        const files = chatFiles.resolve(b?.attachments);
        if (!files.ok) return json({ ...files, error: `${files.reason.en} / ${files.reason["zh-TW"]}` }, 400);
        if (!text && !files.files.length) return json({ error: "empty message" }, 400);
        const v = main.view();
        if (v.state === "detached") return json({ error: "no main session is attached", code: "detached" }, 409);
        // the host that runs the turn must take every file, or nothing is queued: a typed refusal the chat shows
        const fit = deliveryFor(v.host, files.files);
        if (!fit.ok) return json({ ...fit, error: `${fit.reason.en} / ${fit.reason["zh-TW"]}` }, 409);
        chatFiles.markSent(files.files.map((f) => f.id));
        return json({ queued: main.enqueue("chat", text, who.kind === "phone" ? `phone:${who.device.name}` : "desktop", files.files.map(({ path, ...ref }) => ref)), deliveries: fit.deliveries });
      }
      if (p === "/api/main/interrupt") { await main.interrupt(); return json({ ok: true }); }
      if (p === "/api/main/resume") { const r = main.resume(); return json(r, r.ok ? 200 : 409); }
      if (p === "/api/main/detach") { const before = main.view(), nativePrimary = before.context === "studio" && !before.origin && before.drive?.path === "fresh" && ["attached", "paused"].includes(before.state); const cmd = await main.detach(); if (cmd) return json({ resume: cmd }); const after = main.view(); return nativePrimary && after.state === "detached" && after.driver.holder === "none" && !after.driver.resume ? json({ stopped: true, resume: null }) : json({ error: "nothing attached" }, 409); }
      if (p === "/api/main/approve") return main.bridge.answer(String(b?.id ?? ""), b?.allow === true) ? json({ ok: true }) : json({ error: "no such pending request" }, 404);
      if (p === "/api/main/queue/remove") return main.queue.remove(String(b?.id ?? "")) ? json({ ok: true }) : json({ error: "no such item" }, 404);
      return json({ error: "unknown" }, 404);
    }
    if (p === "/api/memory") return json({ dir: memory.dir, notes: memory.list().map(({ body, ...n }) => n) });
    if (p === "/api/summary") {
      return json({ state: STATE, legacy: startup.legacy, chat: chatInfo(), tasks: tasks(), pending, crew: crewCache.slice(0, 40), github: gh.state, board: board.status(), flow,
        events: fm.events.length, now: new Date().toISOString() });
    }
    if (p === "/api/pending") return json(pending);
    if (p === "/api/crew") return json(fm.crew(8).slice(0, 60));
    if (p.startsWith("/api/crew/")) {
      const id = decodeURIComponent(p.slice("/api/crew/".length));
      const a = fm.crew(200).find(c => c.actor === id);
      return a ? json(a) : json({ error: "no such crew round" }, 404);
    }
    if (p === "/api/activity") {
      const q = url.searchParams;
      return json(fm.activity({ task: q.get("task") || undefined, type: q.get("type") || undefined, actor: q.get("actor") || undefined,
        limit: Number(q.get("limit") || 150), before: q.get("before") ? Number(q.get("before")) : undefined }));
    }
    if (p === "/api/tools" || p.startsWith("/api/tools/")) {
      const wt = req.headers.get("x-crew-tool-token") ?? "";
      if (agents.hasToken(wt)) {
        if (p === "/api/tools") return json(agents.toolList(wt));
        let args: any = {}; try { args = await req.json(); } catch {}
        return json(await agents.callTool(wt, decodeURIComponent(p.slice("/api/tools/".length)), args));
      }
      if (m3.runs.hasToken(wt)) {
        if (p === "/api/tools") return json(m3.runs.toolList());
        let args: any = {}; try { args = await req.json(); } catch {}
        return json(m3.runs.callTool(wt, decodeURIComponent(p.slice("/api/tools/".length)), args));
      }
      const tk = tokens.get(req.headers.get("x-crew-tool-token") ?? "");
      if (!tk || tk.expires < Date.now()) return json({ error: "no valid tool token" }, 403);
      if (p === "/api/tools") return json(TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: t.schema })));
      const tool = toolByName(decodeURIComponent(p.slice("/api/tools/".length)));
      if (!tool) return json({ error: "no such tool" }, 404);
      if (++tk.calls > MAX_TOOL_CALLS) return json({ error: `tool limit reached (${MAX_TOOL_CALLS} per question)` });
      let args: any = {};
      try { args = await req.json(); } catch {}
      try { const r = tool.run(ctx, args); if (tool.write) send("intents", store.intentView(fm)); return json(r); }
      catch (e: any) { return json({ error: String(e?.message ?? e) }); }
    }
    if (p === "/api/chat" && req.method === "POST") {
      let body: any;
      try { body = await req.json(); } catch { return json({ error: "json only" }, 400); }
      const message = String(body?.message ?? "").trim().slice(0, 4000);
      if (!message) return json({ error: "empty message" }, 400);
      if (chats >= MAX_CHATS) return json({ error: "firstmate is answering two questions already; try again in a moment", code: "busy" }, 429);
      const history: Turn[] = (Array.isArray(body?.history) ? body.history : []).filter((t: any) => t && (t.role === "captain" || t.role === "firstmate") && typeof t.text === "string")
        .map((t: any) => ({ role: t.role, text: String(t.text).slice(0, 2000) })).slice(-8);
      const lang = body?.lang === "zh-TW" ? "zh-TW" : "en";
      const token = randomBytes(24).toString("hex");
      tokens.set(token, { calls: 0, expires: Date.now() + 10 * 60_000 });
      chats++;
      const abort = new AbortController();
      let ctl: ReadableStreamDefaultController<Uint8Array>;
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          ctl = c;
          runChat({ provider: provider(), message, history, lang, studioUrl: `http://127.0.0.1:${server.port}`, token, dataDir: DATA, signal: abort.signal,
            onEvent: e => { try { ctl.enqueue(enc.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)); } catch {} } })
            .finally(() => { chats--; tokens.delete(token); try { ctl.close(); } catch {} });
        },
        cancel() { abort.abort(); },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
    }
    if (p === "/api/settings") {
      if (req.method === "POST") {
        let body: any; try { body = await req.json(); } catch { return json({ error: "json only" }, 400); }
        const cur = chatSettings();
        if (!choices.includes(body?.provider)) return json({ error: `provider must be one of ${choices.join(", ")}` }, 400);
        const models = { ...cur.models };
        if (typeof body.model === "string") { const m = body.model.trim(); if (m && !/^[\w.:\/-]{1,80}$/.test(m)) return json({ error: "bad model name" }, 400); if (m) models[body.provider] = m; else delete models[body.provider]; }
        writeFileSync(SETTINGS, JSON.stringify({ provider: body.provider, models }, null, 2));
        send("chat", chatInfo());
      }
      return json(chatInfo());
    }
    if (p === "/api/intents") return json(store.intentView(fm));
    if (p === "/api/library") { const lib = store.library(fm, gh.merged); return json({ ...lib, artifacts: m3.store.view(), mergedSync: gh.mergedSync, github: { ok: gh.state.ok, error: gh.state.error, repo: gh.state.repo } }); }
    if (p.startsWith("/api/task/")) {
      const id = decodeURIComponent(p.slice("/api/task/".length)).toUpperCase();
      if (!fm.known(id)) return json({ error: "not in the log" }, 404);
      const t = tasks().find(x => x.id === id) ?? null;
      return json({ id, title: fm.title(id), door: fm.doorOf(id), task: t, lineage: fm.lineage(id), events: fm.activity({ task: id, limit: 200 }),
        pending: pending.filter(c => c.task === id).map(c => ({ id: c.id, title: c.title })), intent: store.links().find(l => l.task === id)?.intent ?? null });
    }
    if (p.startsWith("/api/event/")) {
      const seq = Number(p.slice("/api/event/".length));
      const e = fm.events[seq];
      if (!Number.isInteger(seq) || !e) return json({ error: "no such event" }, 404);
      return json({ event: e, around: fm.activity({ before: Math.min(fm.events.length, seq + 13), limit: 25 }) });
    }
    if (p.startsWith("/files/")) {
      const file = store.file(decodeURIComponent(p.slice("/files/".length)));
      if (!file) return new Response("not found", { status: 404 });
      const f = Bun.file(file), size = f.size;
      const type = extname(file) === ".mp4" ? "video/mp4" : extname(file) === ".webm" ? "video/webm" : "application/octet-stream";
      const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
      if (m) {
        const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
        const end = m[1] && m[2] ? Math.min(size - 1, Number(m[2])) : size - 1;
        if (start >= size || start > end) return new Response("", { status: 416, headers: { "content-range": `bytes */${size}` } });
        return new Response(f.slice(start, end + 1), { status: 206, headers: { "content-type": type, "accept-ranges": "bytes",
          "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1), "cache-control": "no-cache" } });
      }
      return new Response(f, { headers: { "content-type": type, "accept-ranges": "bytes", "content-length": String(size), "cache-control": "no-cache" } });
    }
    if (p === "/api/types") return json([...new Set(fm.events.map(e => e.type))].sort());
    if (p === "/api/github") return json({...gh.state,polling:githubPoller.ownership});
    if (p === "/api/flow") return json(flow);
    if (p === "/api/answer" && req.method === "POST") {
      // only a card that is pending right now, and only the kinds Crew Studio can render in full
      let body: any;
      try { body = await req.json(); } catch { return json({ error: "json only" }, 400); }
      const card = pending.find(c => c.id === body?.id);
      if (!card) return json({ error: "no such pending card", code: "notPending" }, 404);
      if (card.boardOnly) return json({ error: "answer this card on the board", code: "useBoard", board: board.url }, 409);
      if (!["A", "B", "C", "D"].includes(body?.chosen)) return json({ error: "bad choice" }, 400);
      const qs = card.details?.en?.questions;
      const answers = Array.isArray(qs) ? (Array.isArray(body.answers) ? body.answers : qs.map((_: unknown, index: number) => ({ index, ok: true }))) : undefined;
      // a one-way merge carries the same door confirmation the board asks for; the board checks it again
      let door: ReturnType<typeof doorInput> | undefined;
      if (needsDoor(card, body.chosen, answers)) { door = doorInput(body); if (!door || !doorComplete(card, door)) return json({ error: "review every intent and answer the check first", code: "doorUnconfirmed" }, 400); }
      const r = await board.answer({ id: card.id, chosen: body.chosen, project: card.project, answers, door: door ?? undefined });
      if (r.status < 300 && main.view().state !== "detached") main.enqueue("card", `card: ${card.id} answered ${body.chosen} (in Crew Studio)`, who.kind === "phone" ? "phone" : "desktop");
      return json(r.body, r.status);
    }
    if (p === "/api/stream") {
      let ctl: ReadableStreamDefaultController<Uint8Array>;
      const stream = new ReadableStream<Uint8Array>({
        start(c) { ctl = c; clients.add(c); if (who.kind === "phone") clientDevice.set(c, who.device.id); c.enqueue(enc.encode(`event: hello\ndata: ${JSON.stringify({ events: fm.events.length })}\n\n`)); },
        cancel() { clients.delete(ctl); clientDevice.delete(ctl); },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" } });
    }
    // the session starts with an explicit step: the captain opens Studio's session link (`crew-studio open`), which
    // carries the session token; the page itself never hands out a session
    if (p === "/session" && req.method === "GET") {
      const t = url.searchParams.get("t") ?? ""; const okT = t.length === SESSION.length && timingSafeEqual(Buffer.from(t), Buffer.from(SESSION));
      if (!okT) return new Response("This session link is not valid. Open Studio with `crew-studio open` (or `bun src/main.ts open`).", { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
      return new Response(null, { status: 303, headers: { location: "/", "set-cookie": sessionCookie(SESSION), "cache-control": "no-store", "referrer-policy": "no-referrer" } });
    }
    if (p === "/api/session") return json({ session: who.kind === "phone" || hasSession(req, SESSION) });
    const page = serveStatic(p);
    return page ?? new Response("not found", { status: 404 });
}

// Restore/start only after private media and native runtime callbacks exist.
await main.start();
// a live release restarted Studio while its own Firstmate ran: start it again with the same settings (signed-in only), or note why not
void takeover.resumeOnBoot().catch((e) => console.warn(`crew-studio: Firstmate restart: ${e?.message ?? e}`));
const server = Bun.serve({ port: PORT, hostname: "127.0.0.1", idleTimeout: 0, fetch: (req) => handle(req, "loopback") });
if(localExecutionNotice())console.log(`crew-studio: ${localExecutionNotice()}`);
console.log(`crew-studio: http://127.0.0.1:${server.port}  data=${DATA}  state=${STATE}  board=${board.url} (${board.status().writable ? "answers on" : "read-only"})  github=${gh.state.enabled ? gh.state.repo : "off"}`);
console.log("crew-studio: use bun run launch or ./crew-studio launch to request the authenticated Board.");

const launchAuthority = registerInstance(server.port, DATA, SESSION);
export const runningInstance = { ...launchAuthority.record, token: SESSION };
