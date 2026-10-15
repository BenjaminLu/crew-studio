// Installed app-server schema capability reads; no thread/turn/tool is created.
// A private disposable auth copy owns every byte of config touched by the probe.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { binArgv } from "../host/jsonl";
import { probeProcess } from "./probe-process";
import { codexLogin } from "./login";
import type { ProviderCapability } from "./policy";
const unavailable = (reason: string): ProviderCapability => ({ provider: "codex", available: false, auth: "unverified", quota: "unknown", models: [], refusal: "unverified", at: Date.now(), expires: Date.now() + 30_000, reason });
export async function probeCodex(bin = process.env.CREW_CODEX_BIN ?? "codex", signal?: AbortSignal): Promise<ProviderCapability> {
  const dir = mkdtempSync(join(tmpdir(), "crew-codex-capability-")), cfg = join(dir, ".codex");
  let proc: ReturnType<typeof probeProcess> | null = null;
  let status: ReturnType<typeof probeProcess> | null = null;
  let phase = "auth";
  const waiting = new Map<number, { resolve(v: any): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout> }>(); let n = 0;
  const abort = () => { proc?.kill(9); for (const w of waiting.values()) { clearTimeout(w.timer); w.reject(new Error("capability probe cancelled")); } waiting.clear(); };
  try {
    if (signal?.aborted) return unavailable("capability probe cancelled");
    const login = codexLogin(cfg); if (!login.ok) return unavailable("no verified native Codex login is available");
    const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: dir, TMPDIR: dir, LANG: "en_US.UTF-8", ...login.env, CODEX_HOME: cfg };
    // The copied login has no refresh token; no original home/config is passed.
    status = probeProcess(binArgv(bin, ["login", "status"]), dir, env, undefined, { timeoutMs: 10_000, bytes: 64 * 1024 });
    const stopStatus = () => status!.kill(); signal?.addEventListener("abort", stopStatus, { once: true });
    let auth = false; try { const code = await status.exited, output = status.output(); auth = !output.failure && code === 0 && /logged in/i.test(output.out + output.err) && !/not logged in/i.test(output.out + output.err); } finally { signal?.removeEventListener("abort", stopStatus); }
    if (!auth || signal?.aborted) return unavailable("native CLI auth verification failed");
    phase = "app-server initialize";
    proc = probeProcess(binArgv(bin, ["app-server", "--listen", "stdio://"]), dir, env, m => {
      if (m.id !== undefined && !m.method) { const w = waiting.get(m.id); if (!w) return; waiting.delete(m.id); clearTimeout(w.timer); m.error ? w.reject(new Error(/refresh/i.test(String(m.error.message)) ? "refresh-required" : /expired/i.test(String(m.error.message)) ? "expired-login" : /unauthorized|authentication/i.test(String(m.error.message)) ? "auth-refused" : /invalid.*param|unknown.*field/i.test(String(m.error.message)) ? "unsupported-parameters" : "RPC-refused")) : w.resolve(m.result); }
      else if (m.id !== undefined && m.method) proc?.write({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "capability reader refuses requests" } });
    });
    signal?.addEventListener("abort", abort, { once: true });
    proc.exited.then(() => { for (const w of waiting.values()) { clearTimeout(w.timer); w.reject(new Error("capability child exited")); } waiting.clear(); });
    const call = (method: string, params: unknown) => { const id = ++n; return new Promise<any>((resolve, reject) => { const timer = setTimeout(() => { waiting.delete(id); reject(new Error("capability request timeout")); }, 10_000); waiting.set(id, { resolve, reject, timer }); proc!.write({ jsonrpc: "2.0", id, method, params }); }); };
    await call("initialize", { clientInfo: { name: "crew-studio-capability", version: "1.0.0" } }); proc.write({ jsonrpc: "2.0", method: "initialized" });
    phase = "account identity";
    const account = await call("account/read", { refreshToken: false });
    if (!account?.account || !["chatgpt", "apiKey"].includes(account.account.type)) return unavailable("native account identity verification failed");
    phase = "model inventory";
    const models: ProviderCapability["models"] = []; let cursor: string | null = null; const seen = new Set<string>();
    for (let page = 0; page < 10; page++) {
      const list = await call("model/list", { cursor, limit: 100, includeHidden: true });
      if (!Array.isArray(list?.data) || list.data.length > 100) return unavailable("model inventory is incomplete");
      for (const m of list.data) { if (typeof m?.model !== "string" || !Array.isArray(m.supportedReasoningEfforts)) return unavailable("model inventory schema is unsupported"); const efforts = m.supportedReasoningEfforts.map((x: any) => x.reasoningEffort).filter((x: any) => typeof x === "string"); models.push({ id: m.model, efforts }); if (typeof m.id === "string" && m.id !== m.model) models.push({ id: m.id, efforts }); }
      cursor = list.nextCursor ?? null; if (!cursor) break; if (typeof cursor !== "string" || seen.has(cursor) || page === 9) return unavailable("model inventory pagination is incomplete"); seen.add(cursor);
    }
    phase = "quota";
    const limits = await call("account/rateLimits/read", {});
    const buckets: any[] = [limits?.rateLimits, ...Object.values(limits?.rateLimitsByLimitId ?? {})].filter(Boolean);
    const windows = buckets.flatMap(b => [b.primary, b.secondary].filter(Boolean));
    const malformed = !buckets.length || !windows.length || windows.some(w => !Number.isInteger(w.usedPercent) || w.usedPercent < 0 || w.usedPercent > 100);
    const exhausted = buckets.some(b => b.rateLimitReachedType != null) || windows.some(w => w.usedPercent >= 100);
    const at = Date.now();
    return { provider: "codex", available: true, auth: "verified", quota: malformed ? "unknown" : exhausted ? "exhausted" : "available", models, at, expires: at + 30_000, ...(malformed ? { refusal: "unverified" as const, reason: "quota schema or windows unavailable" } : exhausted ? { refusal: "exhausted" as const, reason: "quota exhausted" } : {}) };
  } catch (e) { const category = e instanceof Error && ["refresh-required", "expired-login", "auth-refused", "unsupported-parameters", "RPC-refused", "capability child exited", "capability request timeout"].includes(e.message) ? e.message : "verification-refused"; return unavailable(signal?.aborted ? "capability probe cancelled" : `native capability verification failed at ${phase}: ${category}`); }
  finally {
    signal?.removeEventListener("abort", abort); abort();
    try { if (status) await status.stop(); if (proc) await proc.stop(); } catch (e) { return unavailable("native probe teardown unverified; private credential home retained: "+(e instanceof Error && /^probe group (stop unavailable|death unverified|liveness unavailable)/.test(e.message)?e.message:"unknown")); }
    rmSync(dir, { recursive: true, force: true });
  }
}
