import {NativeToolFailure} from './types';
// Codex as a host, over its own `codex app-server` (JSON-RPC on stdio):
// initialize, then a thread, then one turn/start per captain turn. Approval
// requests from the server go to Studio; anything Studio does not understand
// is declined. Discovery asks a short-lived app-server for thread/list.
// The thread: a takeover forks (thread/fork, in codex-cli 0.162.1's stable protocol)
// and never resumes the original; if the fork is refused, a NEW thread (thread/start)
// that Studio seeds with the original's recent turns (thread/turns/list, read only).
// A fresh start is thread/start. Studio passes no model, effort, approval or sandbox
// setting: the captain's Codex config decides them, and Studio shows what the server reports.
// Only Studio's own thread is ever resumed (after its app-server exits).
//   CREW_HOST_CODEX_BIN  executable (default "codex"; a .mjs path runs under bun: test stub)
//   CODEX_HOME           the captain's Codex config folder (default ~/.codex), read for model and effort only
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { binArgv, spawnJsonl, type JsonProc } from "./jsonl";
import { cleanEnv, shortSummary, type AttachOpts, type AttachedSession, type Host, type HostEvent, type SessionInfo } from "./types";

type Rpc = { proc: JsonProc; call(method: string, params?: unknown, ms?: number): Promise<any>; notify(method: string, params?: unknown): void; close(): void };

function rpc(bin: string, cwd: string, onNotify: (m: any) => void, onRequest: (m: any) => Promise<unknown>, env: Record<string, string> = {}): Rpc {
  let n = 0;
  const waiting = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  const proc = spawnJsonl(binArgv(bin, ["app-server"]), cwd, { ...cleanEnv(), ...env }, async (m) => {
    if (m.id !== undefined && m.method === undefined) {
      const w = waiting.get(m.id); if (!w) return; waiting.delete(m.id);
      m.error ? w.reject(new Error(m.error.message ?? "rpc error")) : w.resolve(m.result);
    } else if (m.id !== undefined && m.method) {
      let result: unknown;
      try { result = await onRequest(m); } catch { result = undefined; }
      if (result === undefined) proc.write({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "declined by Crew Studio" } });
      else proc.write({ jsonrpc: "2.0", id: m.id, result });
    } else if (m.method) onNotify(m);
  });
  proc.exited.then(() => { for (const w of waiting.values()) w.reject(new Error("codex app-server exited")); waiting.clear(); });
  return {
    proc,
    call(method, params, ms = 30_000) {
      const id = ++n;
      return new Promise((resolve, reject) => {
        waiting.set(id, { resolve, reject });
        proc.write({ jsonrpc: "2.0", id, method, params: params ?? {} });
        setTimeout(() => { if (waiting.delete(id)) reject(new Error(`${method} timed out`)); }, ms);
      });
    },
    notify(method, params) { proc.write({ jsonrpc: "2.0", method, params: params ?? {} }); },
    close() { proc.kill(15); setTimeout(() => proc.kill(9), 1500); },
  };
}

/** The model and reasoning effort the captain's Codex config sets (user config, then the project's .codex/config.toml): shown, never overridden. */
export function codexConfig(projectDir: string, home = process.env.CODEX_HOME ?? join(homedir(), ".codex")): { model: string | null; effort: string | null; from: string[] } {
  const out = { model: null as string | null, effort: null as string | null, from: [] as string[] };
  for (const [f, label] of [[join(home, "config.toml"), "~/.codex/config.toml"], [join(projectDir, ".codex/config.toml"), ".codex/config.toml"]]) {
    if (!existsSync(f)) continue;
    let text = ""; try { text = readFileSync(f, "utf8"); } catch { continue; }
    let parsed: any; try { parsed = Bun.TOML.parse(text); } catch { continue; }
    const profile = typeof parsed.profile === "string" ? parsed.profiles?.[parsed.profile] : null;
    const model = typeof (profile?.model ?? parsed.model) === "string" ? (profile?.model ?? parsed.model) : null;
    const effort = typeof (profile?.model_reasoning_effort ?? parsed.model_reasoning_effort) === "string" ? (profile?.model_reasoning_effort ?? parsed.model_reasoning_effort) : null;
    if (model || effort) out.from.push(label);
    if (model) out.model = model; if (effort) out.effort = effort;
  }
  return out;
}

const text = (v: unknown) => typeof v === "string" ? v : "";
/** A turn list (newest first, as thread/turns/list gives it) as plain text, oldest first, for a handoff. */
export function turnsText(turns: any[], cap = 12_000): string {
  const parts: string[] = [];
  for (const t of [...turns].reverse()) {
    const lines: string[] = [];
    for (const it of t?.items ?? []) {
      if (it?.type === "userMessage") { const s = (it.content ?? []).map((c: any) => text(c?.text)).join(" ").trim(); if (s) lines.push(`Captain: ${s.slice(0, 1500)}`); }
      else if (it?.type === "agentMessage" && text(it.text).trim()) lines.push(`firstmate: ${text(it.text).trim().slice(0, 1500)}`);
    }
    if (lines.length) parts.push(lines.join("\n"));
  }
  let s = parts.join("\n\n");
  if (s.length > cap) s = "…" + s.slice(-cap);
  return s;
}
const policyText = (p: unknown) => typeof p === "string" ? p : p && typeof p === "object" ? Object.keys(p as object)[0] ?? null : null;

const init = async (r: Rpc, native=false) => { await r.call("initialize", { ...(native?{capabilities:{experimentalApi:true}}:{}),clientInfo: { name: "crew-studio", title: "Crew Studio", version: "0.3.0" } }); r.notify("initialized"); };

export function codexHost(bin = process.env.CREW_HOST_CODEX_BIN ?? "codex"): Host {
  return {
    id: "codex",
    resumeCommand: (id) => `codex resume ${id}`,
    async discover(projectDir) {
      const r = rpc(bin, projectDir, () => {}, async () => undefined);
      try {
        await init(r);
        const res = await r.call("thread/list", { sortKey: "updated_at", useStateDbOnly: true, limit: 50, cwd: projectDir }, 15_000);
        const rows: any[] = res?.data ?? res?.threads ?? (Array.isArray(res) ? res : []);
        return rows.filter((t) => !t.cwd || t.cwd === projectDir).map((t): SessionInfo => ({
          host: "codex", id: String(t.id ?? t.threadId), title: String(t.name ?? t.title ?? t.preview ?? "(untitled)").replace(/\s+/g, " ").slice(0, 120),
          cwd: String(t.cwd ?? projectDir), updated: Number(t.updatedAt ?? t.updated_at ?? 0) * (Number(t.updatedAt ?? 0) < 1e12 ? 1000 : 1),
          possiblyOpen: false, openReason: null, file: typeof t.path === "string" ? t.path : null,
          model: typeof t.model === "string" ? t.model : null, effort: typeof t.reasoningEffort === "string" ? t.reasoningEffort : null }));
      } catch { return []; } finally { r.close(); }
    },
    async attach(requested, opts: AttachOpts) {
      let id = requested, busy = false, model = "codex", turnId: string | null = null;
      let turn: { resolve: (v: { status: "completed" | "interrupted" | "failed"; message?: string }) => void; external?: boolean } | null = null;
      let interrupting = false, text = "", toolFailure: string | null = null;
      const emit = (e: HostEvent) => { try { opts.onEvent(e); } catch {} };
      const endTurn = (status: "completed" | "interrupted" | "failed", message?: string) => {
        if (!turn) return; const t = turn; turn = null; busy = false; turnId = null; interrupting = false; toolFailure = null;
        if (text) emit({ type: "message", text }); text = "";
        emit({ type: "turnEnd", status, message, external: t.external }); t.resolve({ status, message });
      };
      const onNotify = (m: any) => {
        const p = m.params ?? {};
        if (p.threadId !== id) return;
        if (m.method === "turn/started") {
          const incoming = typeof p.turn?.id === "string" ? p.turn.id : p.turnId;
          if (!incoming || (turn && turnId && incoming !== turnId)) return;
          if (!turn) {
            toolFailure = null; text = ""; interrupting = false;
            turn = { resolve: () => {}, external: true }; busy = true;
            emit({ type: "turnStart", source: "hook" });
          }
          turnId = incoming;
          return;
        }
        // Late output from a previous turn, or another client's turn, cannot
        // change the owned turn's text, tools, failure state or completion.
        const incoming = p.turnId ?? p.turn?.id;
        if (!turn || !turnId || incoming !== turnId) return;
        if (m.method === "error" && /timed out negotiating with the code-mode host|code-mode host is disabled/.test(String(p.error?.message ?? ""))) {
          toolFailure = "Codex code-mode tool execution failed. Repository reads are not verified; check the Codex runtime before continuing.";
        }
        else if (m.method === "item/agentMessage/delta" && p.delta) { text += p.delta; emit({ type: "delta", text: String(p.delta) }); }
        else if (m.method === "item/started" && p.item && p.item.type !== "agentMessage" && p.item.type !== "userMessage" && p.item.type !== "reasoning")
          emit({ type: "toolStart", id: String(p.item.id), name: String(p.item.type), summary: shortSummary(p.item.command ?? p.item.tool ?? p.item.changes ?? p.item) });
        else if (m.method === "item/completed" && p.item) {
          if (p.item.type === "functionCallOutput" && /timed out negotiating with the code-mode host|code-mode host is disabled/.test(JSON.stringify(p.item.output ?? ""))) {
            toolFailure = "Codex code-mode tool execution failed. Repository reads are not verified; check the Codex runtime before continuing.";
            emit({ type: "toolEnd", id: String(p.item.id), ok: false });
          } else if (p.item.type === "agentMessage") { if (!text && p.item.text) { text = String(p.item.text); emit({ type: "delta", text }); } }
          else if (p.item.type !== "userMessage" && p.item.type !== "reasoning") emit({ type: "toolEnd", id: String(p.item.id), ok: !/fail|declin|error/i.test(String(p.item.status ?? "")) });
        } else if (m.method === "turn/completed") {
          const st = String(p.turn?.status ?? "completed");
          endTurn(interrupting || st === "interrupted" ? "interrupted" : st === "failed" || toolFailure ? "failed" : "completed", toolFailure ?? p.turn?.error?.message);
        }
      };
      const onRequest = async (m: any) => {
        const p = m.params ?? {};
        if (m.method === "item/commandExecution/requestApproval" || m.method === "item/fileChange/requestApproval") {
          if (p.threadId !== id || !turn || p.turnId !== turnId) return { decision: "decline" };
          const tool = m.method.includes("command") ? "command" : "fileChange";
          const input = tool === "command" ? { command: p.command, cwd: p.cwd, reason: p.reason } : { reason: p.reason, grantRoot: p.grantRoot };
          let ans = { allow: false };
          try { ans = await opts.onPermission({ id: String(p.approvalId ?? p.itemId ?? m.id), tool, summary: shortSummary(input), input }); } catch {}
          return { decision: ans.allow ? "accept" : "decline" };
        }
        if (m.method === "item/tool/call") {
          const owned=()=>p.threadId===id&&!!turn&&p.turnId===turnId&&!interrupting;
          if(opts.nativeTools&&owned()&&typeof p.tool==="string"&&opts.nativeTools.specs.some(t=>t.name===p.tool)&&!p.namespace&&typeof p.callId==="string"){
            const savedTurn=turn, savedId=turnId;const live=()=>owned()&&turn===savedTurn&&turnId===savedId;
            try{const result=await opts.nativeTools.call(p.tool,p.arguments,{thread:id,turn:p.turnId,call:p.callId,live});if(!live())throw new Error("Primary tool ownership ended");return{success:true,contentItems:[{type:"inputText",text:JSON.stringify(result)}]};}catch(error){return{success:false,contentItems:[{type:"inputText",text:JSON.stringify(error instanceof NativeToolFailure?error.publicFailure:{schema:1,code:"unavailable",reason:{en:"Studio native tool unavailable. No authority was granted.","zh-TW":"Studio 原生工具暫不可用；未授予任何權限。"},nextAction:"captain_review"})}]};}
          }
          // Work/other clients own their dynamic tools. Studio does not execute
          // arbitrary JavaScript or translate their arguments into shell commands.
          if (p.threadId === id && turn && p.turnId === turnId) {
            toolFailure = "Codex requested an unsupported client-owned dynamic tool. Studio declined it; use native tools or start a fresh CLI thread.";
            emit({ type: "toolStart", id: String(p.callId ?? m.id), name: "unsupported dynamic tool", summary: "declined: no code was executed" });
            emit({ type: "toolEnd", id: String(p.callId ?? m.id), ok: false });
          }
          return { success: false, contentItems: [{ type: "inputText", text: "Crew Studio cannot execute this client-owned dynamic tool. Use Codex native tools; no capability was granted." }] };
        }
        return undefined; // every other server request is declined
      };
      let r: Rpc | null = null;
      let path: "resume" | "fork" | "handoff" | "fresh" = "resume", noFork: string | null = null, recentTurns: string | null = null, file: string | null = null;
      let effort: string | null = null, approvalPolicy: string | null = null, sandbox: string | null = null;
      let first = true;
      const opened = (res: any) => {
        if (res?.model) model = String(res.model);
        effort = typeof res?.reasoningEffort === "string" ? res.reasoningEffort : effort;
        approvalPolicy = policyText(res?.approvalPolicy) ?? approvalPolicy;
        sandbox = typeof res?.sandbox?.type === "string" ? res.sandbox.type : sandbox;
        if (typeof res?.thread?.path === "string") file = res.thread.path;
      };
      const follow = (newId: unknown) => { if (newId && newId !== id) { const old = id; id = String(newId); emit({ type: "forked", oldId: old, newId: id, file }); } };
      const start = async () => {
        const c = rpc(bin, opts.cwd, onNotify, onRequest, opts.env ?? {});
        c.proc.exited.then((code) => {
          if (r === c) { r = null; endTurn(interrupting ? "interrupted" : "failed", `codex app-server exited ${code}`); }
          emit({ type: "exit", code, stderr: c.proc.stderr().slice(-600) });
        });
        try {
        await init(c,!!opts.nativeTools);
        if (first && opts.fresh) {
          // a fresh firstmate: a new thread in the firstmate repo, with the captain's own settings
          const res = await c.call("thread/start", { cwd: opts.cwd, ...(opts.nativeTools?{dynamicTools:opts.nativeTools.specs}:{}) });
          path = "fresh"; opened(res); id = String(res?.thread?.id ?? ""); if (!id) throw new Error("thread/start returned no thread id");
        } else if (first && opts.fork) {
          // never thread/resume the original: fork it, or start a new thread seeded from its recent turns
          try {
            const res = await c.call("thread/fork", { threadId: requested, cwd: opts.cwd, excludeTurns: true });
            if (!res?.thread?.id || res.thread.id === requested) throw new Error("thread/fork returned no distinct thread id");
            path = "fork"; opened(res); follow(res.thread.id);
          } catch (e: any) {
            noFork = String(e?.message ?? e).slice(0, 300);
            try { recentTurns = turnsText((await c.call("thread/turns/list", { threadId: requested, limit: 6, sortDirection: "desc", itemsView: "summary" }, 15_000))?.data ?? []) || null; } catch { recentTurns = null; }
            const res = await c.call("thread/start", { cwd: opts.cwd });
            if (!res?.thread?.id) throw new Error("thread/start returned no thread id");
            path = "handoff"; opened(res); follow(res.thread.id);
          }
        } else {
          // a plain attach, or Studio's own thread again after its app-server exited
          const res = await c.call("thread/resume", { threadId: id, excludeTurns: true });
          opened(res); follow(res?.thread?.id ?? res?.threadId);
        }
        first = false;
        r = c;
        return c;
        } catch (e) { c.close(); throw e; }
      };
      await start();
      return {
        host: "codex",
        get id() { return id; }, get model() { return model; }, get busy() { return busy; }, get pid() { return r?.proc.pid ?? null; },
        get effort() { return effort; }, get approvalPolicy() { return approvalPolicy; }, get sandbox() { return sandbox; },
        get path() { return path; }, get noFork() { return noFork; }, get recentTurns() { return recentTurns; }, get file() { return file; },
        async send(t) {
          if (busy) throw new Error("BUSY");
          busy = true; toolFailure = null;
          let c: Rpc;
          try { c = r ?? (await start()); } catch (e) { busy = false; throw e; }
          return new Promise((resolve) => {
            const sentTurn = { resolve }; turn = sentTurn;
            c.call("turn/start", { threadId: id, input: [{ type: "text", text: t, text_elements: [] }] })
              .then((res) => { if (turn === sentTurn && !turnId) turnId = String(res?.turn?.id ?? res?.turnId ?? ""); })
              .catch((e) => { if (turn === sentTurn) endTurn("failed", String(e?.message ?? e)); });
          });
        },
        async interrupt() {
          if (!r || !busy) return;
          interrupting = true;
          const c = r;
          c.call("turn/interrupt", { threadId: id, turnId }, 8000).catch(() => {});
          const t0 = Date.now();
          while (busy && Date.now() - t0 < 8000) await Bun.sleep(50);
          if (busy) c.close();
        },
        async detach() { if (r) { const c = r; r = null; c.close(); await Promise.race([c.proc.exited, Bun.sleep(3000)]); } endTurn("interrupted"); return `codex resume ${id}`; },
      } as AttachedSession;
    },
  };
}
