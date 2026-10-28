import { openScopedProxy } from "./egress-client";
import {localUnrestricted} from "./local-execution";
// One agent job runner for every M6+ feature: skill edits, replay evals, pack
// genesis, gate fix/review cycles and document drafting. A job runs one turn on
// any vendor-neutral provider with ONLY the tools the caller hands it; the tools
// are reached through Studio's /api/tools route with a token issued for that job.
// Guardrails: a time limit, a tool-call limit, no environment secrets, an empty cwd.
import { QueueRefusal, NativeQueue, type QueueRequest } from "./runtime/queue";
import { OperatingRules, jobInstructions, type RulesSection } from "./operating-rules";
import { redactJSON, redactText, roundEnv } from "./secure";
import { roundProfile, sandboxInfo } from "./runtime/checks";
import { roundPathRefusal } from "./runtime/round-paths";
import { randomBytes } from "node:crypto";
import { appendFileSync, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { extname, join, normalize, relative, resolve, sep } from "node:path";
import type { Cost } from "./artifacts";
import type { Provider } from "./providers";
import { helperCommand, helperReads } from "./self";
import { textOnly } from "./tool-content";

export type AgentTool = { name: string; description: string; schema: unknown; run: (args: any) => any };
export type AgentLog = { ts: string; kind: "start" | "tool" | "result" | "text" | "end" | "error"; text: string };
export type AgentJob = {
  id: string; kind: string; title: string; provider: string; model: string; status: "running" | "done" | "failed" | "cancelled";
  started: string; ended: string | null; tools: number; cost: Cost | null; said: string; error: string | null; /** the provider's end code (notLoggedIn, quotaExhausted, …) when it gave one */ errorCode?: string | null; log: AgentLog[]; ref: string | null; reasoningEffort?: string | null; executionMode?: string;
  /** the captain's operating rules this job received: the hash of the exact section text and the project it was read for */
  operatingRules?: { hash: string; project: string | null };
  /** `said` is every word the agent streamed, preambles and progress messages included. `answer` is only its final
   *  assistant message: what it said after its last tool call, and of several messages there, the last (a codex agent
   *  streams "I'll look at…" before its tools and again before its answer). Text streamed with no closing message
   *  (a provider that sends deltas only) counts as one message. */
  answer?: string;
};
const now = () => new Date().toISOString();

export class Agents {
  jobs = new Map<string, AgentJob>();
  readonly queue = new NativeQueue();
  providerAdmission: ((provider: Provider, o: any) => Promise<Provider>) | null = null;
  admission: ((o: any, key: string) => QueueRequest) | null = null;
  private tokens = new Map<string, { job: string; tools: AgentTool[]; calls: number; max: number; expires: number }>();
  private live = new Map<string, () => void>();
  onChange: (j: AgentJob) => void = () => {};
  constructor(readonly dataDir: string, readonly studioUrl: () => string) {}

  hasToken(t: string) { const s = this.tokens.get(t); return !!s && s.expires > Date.now(); }
  toolList(t: string) { return (this.tokens.get(t)?.tools ?? []).map((x) => ({ name: x.name, description: x.description, inputSchema: x.schema })); }
  async callTool(token: string, name: string, args: any): Promise<any> {
    const s = this.tokens.get(token);
    if (!s || s.expires < Date.now()) return { error: "no valid agent token" };
    if (++s.calls > s.max) return { error: `tool limit reached (${s.max} per job)` };
    const j = this.jobs.get(s.job); if (j) j.tools = s.calls;
    const tool = s.tools.find((x) => x.name === name);
    if (!tool) return { error: `no such tool ${name}` };
    try { const r = await tool.run(args ?? {}); if (j) this.log(j, "tool", `${name} ${JSON.stringify(args ?? {}).slice(0, 140)}`); return r; }
    catch (e: any) { return { error: String(e?.message ?? e) }; }
  }
  private log(j: AgentJob, kind: AgentLog["kind"], text: string) { j.log.push({ ts: now(), kind, text: redactText(text).slice(0, 600) }); if (j.log.length > 300) j.log.shift(); this.onChange(j); }
  cancel(id: string) { const s = this.live.get(id); if (!s) return false; s(); return true; }

  /** Studio's egress proxy: a sandboxed round reaches the network only through it, with a credential of its own and its own host list */
  egress: { port: number; open(token: string, hosts: string[], options?: {localOrigins?: string[]; blockedPorts?: number[]}): void; close(token: string): void } | null = null;
  /** the tools-only listener a sandboxed round reaches Studio through (never Studio's main port, its page or its API) */
  toolUrl: (() => string) | null = null;
  /** roots a round never reads or writes (firstmate's checkout); one source, set by the server */
  protect: () => string[] = () => [];
  /** Run one turn. Resolves when the provider ends the turn (or the time limit stops it). */
  async run(o: Parameters<Agents["execute"]>[0]): Promise<AgentJob> {
    const ensureOwner = (signal = o.signal) => { if (signal?.aborted || o.owns && !o.owns()) throw new QueueRefusal("round owner ended before provider launch"); };
    // the job really starts here (its queue slot is held): the operating rules are read again now, and a receipt
    // pinned to an older text before the queue is issued again for the current one (receiptFor), else left to refuse
    const admit = async (signal = o.signal) => { ensureOwner(signal); const job = this.currentRules(o); const provider = this.providerAdmission ? await this.providerAdmission(job.provider, job) : job.provider; ensureOwner(signal); return this.execute({ ...job, signal, provider }); };
    if (o.queueLease) return admit();
    const key = `job-${randomBytes(12).toString("hex")}`;
    const request = this.admission?.(o, key) ?? { key, task: o.ref ?? key, project: "studio", deadline: Date.now() + 300_000, signal: o.signal, limits: () => ({ global: 3, project: 3 }), ready: () => ({ ready: true }), waiting() {}, admitted() {} };
    const release = await this.queue.acquire(request);
    try { return await admit(request.signal ?? o.signal); } finally { release(); }
  }

  private currentRules<T extends { project?: string | null; rules?: RulesSection; admissionReceipt?: unknown; receiptFor?: (rules: RulesSection) => unknown }>(o: T): T {
    const rules = new OperatingRules(this.dataDir).section(o.rules ? o.rules.project : o.project ?? null);
    if (o.rules?.hash === rules.hash) return o;
    return { ...o, rules, ...(o.receiptFor ? { admissionReceipt: o.receiptFor(rules) } : {}) };
  }
  private async execute(o: { signal?: AbortSignal; owns?: () => boolean; queueLease?: boolean; kind: string; title: string; system: string; text: string; tools: AgentTool[]; provider: Provider; timeoutMs?: number; maxTools?: number; ref?: string; onStart?: (id: string) => void;
    /** the registered project the job works for: its operating rules join the Studio-wide ones in the prompt */
    project?: string | null;
    /** the operating-rules section read when the job was admitted (its instruction receipt covers it); else read now */
    rules?: RulesSection;
    /** issue the job's instruction receipt again when the rules changed while it waited in the queue */
    receiptFor?: (rules: RulesSection) => unknown; admissionReceipt?: unknown;
    /** run the round in the OS sandbox: it writes only to these folders (and its tmp and throwaway home), reaches the network only through the egress proxy */
    sandbox?: { writes: string[]; reads?: string[]; cwd?: string; allow?: string[] } | null;
    /** the round's record (data/runs/<run>/nodes/<node>/<round>/): prompt.md written before the provider starts, stream.jsonl, report.json */
    record?: { dir: string; header: Record<string, unknown> } | null }): Promise<AgentJob> {
    if (o.signal?.aborted || o.owns && !o.owns()) throw new QueueRefusal("round owner ended before job creation");
    const id = `J${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
    const job: AgentJob = { id, kind: o.kind, title: o.title, provider: o.provider.id, model: o.provider.model, status: "running", started: now(), ended: null, tools: 0,
      cost: null, said: "", error: null, log: [], ref: o.ref ?? null, reasoningEffort: o.provider.reasoningEffort ?? null, executionMode:localUnrestricted()?"local-unrestricted":"default" };
    this.jobs.set(id, job);
    if (this.jobs.size > 400) this.jobs.delete(this.jobs.keys().next().value!);
    const refuse = (why: string) => { job.status = "failed"; job.error = `refused: ${why}`; job.ended = now(); this.log(job, "error", job.error); return job; };
    const token = randomBytes(24).toString("hex");
    const timeoutMs = o.timeoutMs ?? Number(process.env.CREW_AGENT_TIMEOUT_MS ?? 10 * 60_000);
    let studioUrl = this.studioUrl();
    let cwd = join(this.dataDir, "work-cwd"); mkdirSync(cwd, { recursive: true });
    this.log(job, "start", `${o.provider.id} · ${o.provider.model}: ${o.title}`);
    if(localUnrestricted())this.log(job,"start","Local unrestricted execution: OS sandbox and outbound restrictions disabled; dependencies repository-local only");
    // a sandboxed round: a profile of its own, a throwaway home, its own proxy credential; refused (never run bare) when any of it is missing
    let sandbox: { profile: string } | null = null; let roundEnvAdd: Record<string, string> = {}; let cleanup = () => {}; let proxyUrl: string | null = null; let tokenFile: string | null = null;
    let envKeys = o.provider.envKeys ?? []; // a sandboxed CLI round gets no key from Studio's environment: only the login handed to it
    if (o.sandbox && !o.provider.sandboxFree) {
      if (!o.provider.sandboxNeeds) return refuse(`the provider ${o.provider.id} cannot run in the round sandbox (it declares no sandbox needs)`);
      const sb = sandboxInfo();
      if (!sb.ok && !localUnrestricted()) return refuse(`a sandboxed round needs an OS sandbox (${sb.detail})`);
      if (!this.egress && !localUnrestricted()) return refuse("a sandboxed round needs Studio's egress proxy");
      if (!this.toolUrl) return refuse("a sandboxed round needs Studio's tool listener");
      // a round's own paths are what the runtime materialized: a worktree under data/work, or a folder outside Studio's data and every protected root
      const bad = roundPathRefusal(this.dataDir, this.protect(), o.sandbox);
      if (bad) return refuse(`a round may not reach ${bad} (only its worktree, never Studio's data or a protected root)`);
      const needs = o.provider.sandboxNeeds();
      if (needs.inProcess) {
        // a provider in Studio's own process (direct HTTP): nothing to spawn; its requests go through the proxy with this round's credential, to its API host (and what policy grants) only
        studioUrl = this.toolUrl();
        if(!localUnrestricted()){const ptok = randomBytes(18).toString("hex"); const eg = this.egress; eg.open(ptok, [...needs.hosts, ...(o.sandbox.allow ?? [])], {localOrigins: needs.localOrigins, blockedPorts: [4210, Number(new URL(this.studioUrl()).port), Number(new URL(this.toolUrl!()).port)]}); cleanup = () => eg.close(ptok); proxyUrl = `http://round:${ptok}@127.0.0.1:${eg.port}`;}
      } else {
      const box = join(this.dataDir, "rounds", id); const tmp = join(box, "tmp"), home = join(box, "home");
      cleanup = () => { try { rmSync(home, { recursive: true, force: true }); rmSync(tmp, { recursive: true, force: true }); } catch {} };
      try {
      mkdirSync(tmp, { recursive: true });
      // the round's home and XDG folders are its own (v1 bin/fm-sandbox.sh, T-128): ordinary tools take their ordinary paths, inside the round
      Object.assign(roundEnvAdd, { XDG_CACHE_HOME: join(home, ".cache"), XDG_CONFIG_HOME: join(home, ".config"), XDG_DATA_HOME: join(home, ".local", "share") }, needs.home(home));
      if (needs.writes?.length) { const rmHome = cleanup, extra = [...needs.writes]; cleanup = () => { rmHome(); for (const d of extra) try { rmSync(d, { recursive: true, force: true }); } catch {} }; }
      // its vendor's own login, read here, outside the sandbox (v1 option A, T-117): the round gets that token and nothing else
      const login = needs.login(home); if (!login.ok) { cleanup(); return refuse(`${o.provider.id} has no login for a round: ${login.error}`); }
      if (login.warn) this.log(job, "start", `${o.provider.id} signs in with ${login.source}: ${login.warn}`);
      Object.assign(roundEnvAdd, login.env); envKeys = [];
      const lease = localUnrestricted() ? null : await openScopedProxy(this.egress!, [...needs.hosts, ...(o.sandbox.allow ?? [])]);
      if (lease) { const rmBox = cleanup; cleanup = () => { lease.close(); rmBox(); }; }
      if (o.signal?.aborted || o.owns && !o.owns()) throw new QueueRefusal("round owner ended during sandbox setup");
      studioUrl = this.toolUrl();
      cwd = o.sandbox.cwd ?? tmp;
      const prof = join(box, "round.sb");
      writeFileSync(prof, roundProfile({ cwd, tmp, writes: [...o.sandbox.writes, home, ...(needs.writes ?? [])], reads: [...needs.reads, ...helperReads(), ...(o.sandbox.reads ?? [])], proxyPort: lease?.port??1, toolPort: Number(new URL(studioUrl).port),
        dataDir: this.dataDir, protect: this.protect() }));
      const proxy = lease?.url ?? "";
      if(!localUnrestricted())Object.assign(roundEnvAdd, { HTTPS_PROXY: proxy, HTTP_PROXY: proxy, https_proxy: proxy, http_proxy: proxy, ALL_PROXY: proxy, all_proxy: proxy, NO_PROXY: "localhost,127.0.0.1,::1", no_proxy: "localhost,127.0.0.1,::1", NODE_USE_ENV_PROXY: "1", TMPDIR: tmp });
      // the tool token in a 0600 file inside the round's tmp (readable only in this round's sandbox), never on the CLI's argv
      tokenFile = join(tmp, "tool-token"); writeFileSync(tokenFile, token, { mode: 0o600 });
      roundEnvAdd.TMPDIR=tmp;
      for (const k of needs.tmpEnv) roundEnvAdd[k] = tmp; // the CLI's own temporary folder is the round's tmp, never a shared one
      sandbox = localUnrestricted()?null:{ profile: prof };
      } catch (e: any) { cleanup(); return refuse(`the round's sandbox could not be set up: ${e?.message ?? e}`); }
      }
    }
    try {
      if (!tokenFile) {
        const dir = join(this.dataDir, "agent-tokens"); mkdirSync(dir, { recursive: true, mode: 0o700 });
        tokenFile = join(dir, id); writeFileSync(tokenFile, token, { mode: 0o600 });
        const previous = cleanup, path = tokenFile; cleanup = () => { try { previous(); } finally { rmSync(path, { force: true }); } };
      }
      this.tokens.set(token, { job: id, tools: o.tools, calls: 0, max: o.maxTools ?? Number(process.env.CREW_AGENT_MAX_TOOLS ?? 60), expires: Date.now() + timeoutMs + 60_000 });
      // Every provider gets a protected file path; spawned CLIs never receive the tool credential in argv/env.
      const tokenEnv = { CREW_TOOL_TOKEN_FILE: tokenFile };
      const env = { ...roundEnv(envKeys, { CREW_STUDIO_URL: studioUrl, ...tokenEnv, CREW_HTTP_MAX_ROUNDS: "40" }), ...roundEnvAdd };
      // a credential never goes into a prompt (so it is never written into a round's record either)
      // the captain's operating rules, read now (an edit between two rounds reaches the next one), right after the safety rules
      const rules = o.rules!; job.operatingRules = { hash: rules.hash, project: rules.project }; // read in admit(), once the queue slot is held
      const text = keepCredentialsOut(o.text, [token]), system = keepCredentialsOut(jobInstructions(o.system, rules), [token]); // the safety rules lead every agent's instructions
      let rec: ReturnType<typeof roundRecord> | null = null;
      try { rec = o.record ? roundRecord(o.record.dir, { ...o.record.header, job: id, operatingRules: rules.hash, provider: o.provider.id, model: o.provider.model, reasoningEffort: o.provider.reasoningEffort ?? null, executionMode:job.executionMode }, text, system) : null; }
      catch (e: any) { return refuse(`the round's record could not be written: ${e?.message ?? e}`); }
      let session: ReturnType<Provider["start"]>;
      try { session = o.provider.start(system, o.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.schema })), { studioUrl, token, tokenFile, cwd, env, mcpCommand: helperCommand("mcp"), sandbox, proxy: proxyUrl }); }
      catch (e: any) { job.status = "failed"; job.error = `the provider could not start: ${e?.message ?? e}`; job.ended = now(); this.log(job, "error", job.error); rec?.end(job); return job; }
      let why: string | null = null;
      const stop = (r: string) => { if (!why) { why = r; session.interrupt(); } };
      this.live.set(id, () => stop("cancelled"));
      try { o.onStart?.(id); } catch {}
      const timer = setTimeout(() => stop("timeout"), timeoutMs);
      // the final message: `open` is text streamed since the last message closed, `last` the last closed message; a tool call
      // starts over, so what came before it (a preamble) is never the answer
      let open = "", last = "";
      try {
        for await (const e of session.send(text)) {
          rec?.event(e);
          if (e.type === "delta") { job.said += e.text; open += e.text; }
          else if (e.type === "message") { last = e.text; open = ""; }
          else if (e.type === "toolStart") { last = ""; open = ""; }
          else if (e.type === "toolEnd" && e.error) this.log(job, "result", `error: ${e.error}`);
          else if (e.type === "turnEnd") {
            const u = (e as any).usage; if (u) job.cost = { usd: u.usd ?? null, inTokens: u.inTokens ?? null, outTokens: u.outTokens ?? null };
            if (why === "cancelled") { job.status = "cancelled"; job.error = "cancelled"; }
            else if (why === "timeout") { job.status = "failed"; job.error = `no result within ${Math.round(timeoutMs / 1000)} s`; }
            else if (e.status !== "ok") { job.status = "failed"; job.error = e.message ?? e.code ?? "the agent run failed"; if ((e as any).code) job.errorCode = String((e as any).code); } // the provider's own code keeps the failure's class (runtime/failures.ts)
            else job.status = "done";
            break;
          }
        }
        if (job.status === "running") { job.status = "failed"; job.error = "the turn ended without a result"; }
      } catch (err: any) { job.status = "failed"; job.error = String(err?.message ?? err); }
      finally { clearTimeout(timer); this.live.delete(id); this.tokens.delete(token); job.answer = open.trim() ? open : last; }
      job.ended = now();
      if (job.said.trim()) this.log(job, "text", job.said.trim());
      this.log(job, job.status === "done" ? "end" : "error", job.error ?? "done");
    rec?.end(job);
    return job;
    } finally { cleanup(); this.tokens.delete(token); } // the proxy credential, the throwaway home and tmp, the tool token: released however the round ends
  }
}

// ---------- the record of one agent round ----------
/** Remove every credential (secure.ts's one registry: real key formats, Studio's own secret values) from text bound for a provider. */
export const keepCredentialsOut = (t: string, extra: string[] = []) => redactText(t, extra);
/**
 * data/runs/<run>/nodes/<node>/<round>/
 *   prompt.md     a header (front matter: run, node, round, head, the bound brief and the ledger ids it was bound to,
 *                 the job, provider, model), then the exact bytes sent to the provider; written and synced before it starts
 *   system.md     the system prompt the provider got
 *   stream.jsonl  the provider's events: {ts, type: message|tool_call|tool_result|status, ...}
 *   report.json   the final output: status, error, what the agent said, its tool count and cost
 * A later hand-off in the same round writes prompt.hop<n>.md next to it.
 */
export function roundRecord(dir: string, header: Record<string, unknown>, text: string, system: string) {
  mkdirSync(dir, { recursive: true });
  // hop 0 is prompt.md and system.md; a hand-off's hop n is prompt.hop<n>.md and system.hop<n>.md: the same n as its header
  // a retry of the round (attempt k > 1) adds .attempt<k>
  const hop = Number(header.hop ?? 0) || 0, attempt = Number(header.attempt ?? 1) || 1;
  const sfx = `${attempt > 1 ? `.attempt${attempt}` : ""}${hop ? `.hop${hop}` : ""}`; const name = `prompt${sfx}.md`, sysName = `system${sfx}.md`;
  const front = `---\n${Object.entries(header).map(([k, v]) => `${k}: ${JSON.stringify(v ?? null)}`).join("\n")}\nsent: ${JSON.stringify(new Date().toISOString())}\n---\n`;
  const fd = openSync(join(dir, name), "w"); writeSync(fd, front + text); fsyncSync(fd); closeSync(fd);
  writeFileSync(join(dir, sysName), system);
  const stream = join(dir, "stream.jsonl");
  const put = (o: Record<string, unknown>) => { try { appendFileSync(stream, JSON.stringify({ ts: new Date().toISOString(), ...o }) + "\n"); } catch {} };
  put({ type: "status", status: "started", prompt: name, ...header });
  let buf = "";
  const flush = () => { if (buf) { put({ type: "message", text: redactText(buf) }); buf = ""; } };
  return {
    event(e: any) {
      if (e.type === "delta") { buf += e.text; if (buf.length > 4000) flush(); return; }
      // a whole message repeats the deltas before it: keep the message, drop the streamed copy (it was written twice)
      if (e.type === "message") { buf = ""; put({ type: "message", text: redactText(e.text) }); return; }
      flush();
      if (e.type === "toolStart") put({ type: "tool_call", id: e.id, name: e.name, args: redactJSON(e.args ?? null) });
      else if (e.type === "toolEnd") put({ type: "tool_result", id: e.id, error: e.error ? redactText(e.error) : null, rows: e.rows, result: redactText(textOnly(String(e.result ?? ""))).slice(0, 20000) }); // a picture is noted, not kept
      else if (e.type === "turnEnd") put({ type: "status", status: e.status, code: e.code ?? null, message: e.message ?? null, usage: e.usage ?? null });
    },
    end(job: AgentJob) {
      flush(); put({ type: "status", status: job.status, error: job.error });
      const fd = openSync(join(dir, "report.json"), "w");
      writeSync(fd, JSON.stringify({ job: job.id, operatingRules: job.operatingRules ?? null, status: job.status, error: job.error ? redactText(job.error) : null, said: redactText(job.said), tools: job.tools, cost: job.cost, started: job.started, ended: job.ended, prompt: name }, null, 1)); fsyncSync(fd); closeSync(fd);
    },
  };
}

// ---------- a scoped folder: the same path guard as the M3 work tools ----------
const TEXT = new Set([".html", ".htm", ".css", ".js", ".mjs", ".ts", ".svg", ".md", ".txt", ".json", ".yaml", ".yml", ".jsonl", ".sh", ".py", ".toml", ".csv"]);
export function insideDir(dir: string, p: unknown, forWrite: boolean): string {
  const rel = String(p ?? "").replace(/^\.\//, "");
  if (!rel || rel.startsWith("/") || rel.split(/[\\/]/).includes("..")) throw new Error(`path not allowed: ${rel}`);
  const abs = normalize(resolve(dir, rel));
  if (!abs.startsWith(dir + sep)) throw new Error(`path not allowed: ${rel}`);
  let cur = dir;
  for (const part of relative(dir, abs).split(sep)) { cur = join(cur, part); if (existsSync(cur) && lstatSync(cur).isSymbolicLink()) throw new Error(`${rel} goes through a link`); }
  if (forWrite && !TEXT.has(extname(abs).toLowerCase())) throw new Error(`${extname(abs) || "this file type"} is not editable here (text files only)`);
  if (rel.split("/")[0] === ".git") throw new Error(".git is not reachable");
  return abs;
}
/** fs_list, fs_read, fs_search, fs_replace, fs_write over one folder (text files only, no links, no .git). */
export function folderTools(dir: string, onWrite: (rel: string) => void = () => {}, prefix = "fs"): AgentTool[] {
  const list = () => { const out: any[] = []; const walk = (d: string) => { for (const n of readdirSync(d).sort()) { if (n === ".git") continue; const p = join(d, n); const st = lstatSync(p);
    if (st.isSymbolicLink()) continue; if (st.isDirectory()) walk(p); else out.push({ path: relative(dir, p).split(sep).join("/"), size: st.size, editable: TEXT.has(extname(p).toLowerCase()) }); } }; walk(dir); return out; };
  return [
    { name: `${prefix}_list`, description: "List every file in the folder with its size and whether it is editable text.", schema: { type: "object", properties: {} }, run: list },
    { name: `${prefix}_read`, description: "Read a text file by line range (lines from 1; default 400, max 800).", schema: { type: "object", properties: { path: { type: "string" }, start: { type: "number" }, lines: { type: "number" } }, required: ["path"] },
      run: (a) => { const p = insideDir(dir, a.path, false); if (!existsSync(p) || !statSync(p).isFile()) return { error: `no such file: ${a.path}` }; if (!TEXT.has(extname(p).toLowerCase())) return { error: "binary file" };
        const all = readFileSync(p, "utf8").split("\n"); const s = Math.max(1, Number(a.start) || 1), n = Math.min(800, Math.max(1, Number(a.lines) || 400));
        return { path: a.path, totalLines: all.length, start: s, text: all.slice(s - 1, s - 1 + n).map((l, i) => `${s + i}\t${l}`).join("\n") }; } },
    { name: `${prefix}_search`, description: "Find lines containing a text (case-insensitive) across the editable files.", schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      run: (a) => { const q = String(a.text ?? "").toLowerCase(); if (!q) return { error: "text is required" }; const hits: any[] = [];
        for (const f of list().filter((x) => x.editable)) readFileSync(join(dir, f.path), "utf8").split("\n").forEach((l, i) => { if (hits.length < 50 && l.toLowerCase().includes(q)) hits.push({ path: f.path, line: i + 1, text: l.slice(0, 300) }); }); return hits; } },
    { name: `${prefix}_replace`, description: "Replace an exact piece of text in a file; `old` must occur once unless all=true.", schema: { type: "object", properties: { path: { type: "string" }, old: { type: "string" }, new: { type: "string" }, all: { type: "boolean" } }, required: ["path", "old", "new"] },
      run: (a) => { const p = insideDir(dir, a.path, true); if (!existsSync(p)) return { error: `no such file: ${a.path}` }; const old = String(a.old ?? ""); if (!old) return { error: "old is required" };
        const t = readFileSync(p, "utf8"); const c = t.split(old).length - 1; if (!c) return { error: "old text not found (it must match exactly)" }; if (c > 1 && !a.all) return { error: `old text occurs ${c} times` };
        writeFileSync(p, a.all ? t.split(old).join(String(a.new ?? "")) : t.replace(old, () => String(a.new ?? ""))); onWrite(String(a.path)); return { ok: true }; } },
    { name: `${prefix}_write`, description: "Write a whole text file (creates folders as needed).", schema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
      run: (a) => { const p = insideDir(dir, a.path, true); const c = String(a.content ?? ""); if (c.length > 600_000) return { error: "content too large" }; mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, c); onWrite(String(a.path)); return { ok: true }; } },
  ];
}
