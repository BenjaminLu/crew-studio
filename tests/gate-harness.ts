// Test harness for the readiness gate: the real runtime (createRuntime) over throwaway data,
// a stub provider that writes deliverables through the real tool route, a stub login state
// and a stub Firstmate queue. No model, no network, no live Studio data.
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agents } from "../src/agent";
import { ArtifactStore } from "../src/artifacts";
import { createFileOrg } from "../src/fileorg";
import { Lane } from "../src/recipes";
import { createRuntime } from "../src/runtime";
import { StudioLog } from "../src/rawlog";
import { dryStubProvider } from "../src/readiness/dryrun";
for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete process.env[k];

export type RepairRef = { draft: string; nonce: string };
export function gateHarness(o: { login?: Record<string, "logged-in" | "not-logged-in" | "unknown">; ask?: (text: string, ref: RepairRef) => boolean; createRuntime?: (d: any) => any; repairWaitMs?: number } = {}) {
  const data = mkdtempSync(join(tmpdir(), "crew-gate-")); const fm = join(data, "protected-fm"); mkdirSync(fm, { recursive: true });
  const log = new StudioLog(join(data, "events.jsonl")), store = new ArtifactStore(data), lane = new Lane(data, store);
  const agents = new Agents(data, () => "http://127.0.0.1:1");
  const seen: string[] = [];
  const provider = dryStubProvider(async (name, args, token) => agents.callTool(token, name, args), seen);
  // a run whose input says SMOKEFAIL writes nothing (a real-run failure for stage 5)
  const live: any = { ...provider, start: (sys: string, tools: any[], ctx: any) => { const s = (provider as any).start(sys, tools, ctx); return { interrupt: s.interrupt, async *send(text: string) { if (/SMOKEFAIL/.test(text)) { yield { type: "message", text: "nothing" }; yield { type: "turnEnd", status: "ok" }; return; } yield* s.send(text); } }; } };
  const fileorg = createFileOrg({ dataDir: data, refuse: [fm], rules: () => ({ categories: { Text: ["txt"] }, other: "Other" }) as any, gates: () => [], log, send() {} });
  const login = { codex: "logged-in", claude: "logged-in", ...(o.login ?? {}) } as Record<string, any>;
  const asks: string[] = []; let loginReads = 0;
  let ask = o.ask ?? ((t: string) => { asks.push(t); return true; });
  const make = o.createRuntime ?? createRuntime;
  const rt: any = createRuntime({ dataDir: data, agents, provider: () => live, defaultProvider: () => ({ provider: "codex", model: "fixture-model" }), selectProvider: async () => live, log, send() {}, fmRoot: fm, protectedRoots: [fm],
    m3: { store, lane, runs: null }, fileorg, docs: {}, studioUrl: () => "http://127.0.0.1:1",
    readiness: { logins: async () => { loginReads++; return { ...login }; }, knownProviders: () => ["claude", "codex"], repoRoot: join(import.meta.dir, ".."), ask: (t: string, ref: RepairRef) => ask(t, ref), smokePollMs: 40, repairWaitMs: o.repairWaitMs, createRuntimeOverride: make } } as any);
  const who = { kind: "desktop" };
  const api = async (path: string, body?: any) => { const u = new URL("http://t.local" + path); const r: Response | null = await rt.handle(new Request(u, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }), u, who, body !== undefined); const j = r ? await r.json().catch(() => ({})) : {}; return { status: r?.status ?? 404, body: j as any }; };
  const owner = (text: string, captain = true, repair: RepairRef | null = null) => ({ key: "thread:" + Math.random().toString(36).slice(2), captain, text, live: () => true, repair });
  /** a Firstmate tool call; a repair turn passes the ref its queued Studio item carried */
  const tool = async (name: string, args: any, text = "captain message", captain = true, repair: RepairRef | null = null) => { try { return await rt.firstmate.call(name, args, owner(text, captain, repair)); } catch (e: any) { return { code: e?.publicFailure?.code ?? e?.code ?? "error", error: e?.message ?? String(e) }; } };
  return { data, rt, api, tool, login, asks, seen, agents, loginReads: () => loginReads, setAsk: (f: (t: string, ref: RepairRef) => boolean) => { ask = f; } };
}
export const until = async (f: () => boolean | Promise<boolean>, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await Bun.sleep(25); } return !!(await f()); };
