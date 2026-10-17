// Stage 4: the draft, end to end, on the real engine and board path (createRuntime and its
// HTTP routes) in a throwaway data folder, with a stub provider. No model is called, no
// network is used, nothing touches the live Studio's data. The stub answers only the cards
// the scenario allows (plain question cards); it never answers a card the gate counts as a
// one-way guard (acceptance, merge, door or one_way cards). A refusal, a sandbox/path/cwd problem, a stall or an outcome no edge takes
// fails the stage with the step and the exact error.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agents } from "../agent";
import { ArtifactStore } from "../artifacts";
import { createFileOrg } from "../fileorg";
import { StudioLog } from "../rawlog";
import { Lane } from "../recipes";
import { roundPathRefusal } from "../runtime/round-paths";
import type { WDef } from "../runtime/defs";
import type { Provider } from "../providers";
import { P, type DryStep, type GateProblem } from "./types";
import { isOneWayCard, type Sample } from "./stages";

const ENTRY: Record<string, string> = { document: "doc.md", web: "index.html", video: "film.html" };
/** The dry run's stand-in for a model: writes the deliverable a deliver round asks for, through the real tool route. */
export function dryStubProvider(call: (name: string, args: any, token: string) => Promise<any>, seen: string[] = []): Provider {
  return { id: "stub", model: "dry-run", sandboxFree: true, start: (_sys: string, _tools: any[], ctx: any) => {
    let interrupted = false;
    return { interrupt() { interrupted = true; }, async *send(text: string) {
      seen.push(text);
      const format = /^DELIVER (\w+)/m.exec(text)?.[1] ?? "document";
      const path = ENTRY[format] ?? "doc.md";
      const content = format === "document" ? "# Dry run\n\nA stub deliverable for the readiness gate. 測試內容。\n" : "<html><body><h1>Dry run</h1><p>Stub deliverable for the readiness gate.</p></body></html>";
      if (interrupted) { yield { type: "turnEnd", status: "interrupted" }; return; }
      const r = await call("work_write", { path, content }, ctx.token);
      if (r?.error) { yield { type: "turnEnd", status: "error", message: String(r.error) }; return; }
      yield { type: "message", text: `wrote ${path}` }; yield { type: "turnEnd", status: "ok" };
    } } as any;
  } } as any;
}

export type DryRunOptions = { sample: Sample; protectedRoots: string[]; timeoutMs?: number; maxCards?: number;
  /** the runtime factory (src/runtime createRuntime): passed in so this module stays below the runtime */
  createRuntime: (deps: any) => any };
export type DryRunResult = { status: "pass" | "fail"; problems: GateProblem[]; steps: DryStep[]; runStatus: string; stoppedAt: string | null };

/** Shortest number of edges from a node to an end (cards pick the option that finishes soonest). */
function distances(def: WDef) {
  const outs = new Set(def.edges.map((e) => e.from)); const d = new Map<string, number>();
  for (const n of def.nodes) if (!outs.has(n.id)) d.set(n.id, 0);
  let grew = true; while (grew) { grew = false; for (const e of def.edges) { const t = d.get(e.to); if (t === undefined) continue; const cur = d.get(e.from); if (cur === undefined || t + 1 < cur) { d.set(e.from, t + 1); grew = true; } } }
  return d;
}

export async function dryRun(def: WDef, o: DryRunOptions): Promise<DryRunResult> {
  const data = mkdtempSync(join(tmpdir(), "crew-gate-dry-")); const fm = join(data, "protected"); mkdirSync(fm, { recursive: true });
  const problems: GateProblem[] = []; const steps: DryStep[] = [];
  const fail = (code: string, node: string | null, en: string, zh: string, fen: string, fzh: string) => problems.push(P("dryrun", code, node, { en, zh }, { en: fen, zh: fzh }));
  const log = new StudioLog(join(data, "events.jsonl")); const store = new ArtifactStore(data); const lane = new Lane(data, store);
  const agents = new Agents(data, () => "http://127.0.0.1:1");
  const call = async (name: string, args: any, token: string) => agents.callTool(token, name, args);
  const provider = dryStubProvider(call);
  // the agent path check every real round passes (src/agent.ts), applied here too: the stub is sandbox-free
  const protect = [fm, ...o.protectedRoots];
  const run0 = agents.run.bind(agents);
  (agents as any).run = async (opts: any) => {
    if (opts.sandbox) { const bad = roundPathRefusal(data, protect, opts.sandbox); if (bad) { const job = await run0({ ...opts, sandbox: null, provider: { ...provider, start: () => ({ interrupt() {}, async *send() { yield { type: "turnEnd", status: "error", message: `refused: a round may not reach ${bad} (only its worktree, never Studio's data or a protected root)` }; } }) } }); return job; } }
    return run0(opts);
  };
  const fileorg = createFileOrg({ dataDir: data, refuse: [fm], rules: () => ({ categories: { Text: ["txt"] }, other: "Other" }) as any, gates: () => [], log, send() {} });
  let rt: any = null;
  try {
    rt = o.createRuntime({ dataDir: data, agents, provider: () => provider, defaultProvider: () => ({ provider: "stub", model: "dry-run" }), selectProvider: async () => provider, log, send() {}, fmRoot: fm, protectedRoots: protect,
      m3: { store, lane, runs: null }, fileorg, docs: {}, studioUrl: () => "http://127.0.0.1:1", readiness: false });
    const who = { kind: "desktop" };
    const api = async (path: string, body?: any) => { const u = new URL("http://gate.local" + path); const req = new Request(u, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      const r: Response | null = await rt.handle(req, u, who, body !== undefined); const j = r ? await r.json().catch(() => ({})) : { error: "no route" }; return { status: r?.status ?? 404, body: j }; };
    // the draft as the captain's own workflow v1 in the throwaway folder; unstaffed nodes get the stub (staffing is the captain's at Run)
    const staffed = { ...def, nodes: def.nodes.map((n) => n.kind === "agent" ? { ...n, provider: n.provider ?? "codex", model: n.model ?? "dry-run", ...(n.provider === "codex" || !n.provider ? { effort: (n as any).effort ?? "low" } : {}) } : n) };
    const wid = "gate-dry-run";
    rt.defs.createDrafted(wid, staffed, "readiness gate (dry run)", { schema: 1, source: "firstmate-draft", draft: "d-000000000000", revision: 1, definition: "dry", brief: { goal: o.sample.text, interview: [] } });
    let start = await api("/api/wruns", { workflow: wid, text: o.sample.text, params: o.sample.params });
    // confirmed as Run is (the staffing hash and, for Claude-staffed nodes, the bounded Claude verification): in this throwaway folder every round is the stub, so nothing is spent
    if (start.status === 409 && start.body.staffing?.hash) start = await api("/api/wruns", { workflow: wid, text: o.sample.text, params: o.sample.params, staffingConfirm: start.body.staffing.hash, claudeVerification: start.body.staffing.claudeVerification ?? undefined });
    if (start.status !== 200 || !start.body.id) { fail("dryrun-start", null, `The run did not start: ${start.body.error ?? start.status}`, `任務無法開始：${start.body.error ?? start.status}`, "Fix the Start inputs and staffing so Run can start the Task.", "修正開始輸入與配置，讓執行能開始任務。"); return { status: "fail", problems, steps, runStatus: "not-started", stoppedAt: null }; }
    const id = start.body.id as string; const dist = distances(staffed as WDef);
    const t0 = Date.now(); let answered = 0, stoppedAt: string | null = null; let r: any = null;
    while (Date.now() - t0 < (o.timeoutMs ?? 20000)) {
      r = rt.engine.get(id);
      if (["succeeded", "failed", "cancelled"].includes(r.status)) break;
      const open = rt.engine.cards.list({ run: id, open: true });
      if (r.status === "waiting" && open.length) {
        const c = open[0]; const node = r.def.nodes.find((n: any) => n.id === c.node);
        if (node && isOneWayCard(node)) { stoppedAt = node.id; break; } // every card the gate counts as a one-way guard is the captain's alone
        if (answered >= (o.maxCards ?? 12)) { fail("dryrun-loop", node?.id ?? null, `The run kept asking for decisions (${answered} cards) without ending.`, `任務一直要求決定（${answered} 張卡）而沒有結束。`, "Make sure each card has an option that moves toward the end.", "確認每張卡都有往結束前進的選項。"); break; }
        const opts = c.options.filter((x: any) => !x.hold && !x.note);
        const rank = (x: any) => { if (/^approve-/.test(x.id)) return -1; const e = r.def.edges.find((e: any) => e.from === c.node && e.when?.split("|").includes(x.id)) ?? r.def.edges.find((e: any) => e.from === c.node && !e.when); return e ? dist.get(e.to) ?? 99 : 999; };
        const pick = [...opts].sort((a: any, b: any) => rank(a) - rank(b))[0];
        if (!pick) { stoppedAt = c.node; break; }
        const n = c.detail?.intents?.length ?? 0;
        const a = await api(`/api/scards/${c.id}/answer`, { choice: pick.id, aligned: Array.from({ length: n }, (_, i) => i) });
        if (a.status !== 200) { fail("dryrun-card", c.node, `${node?.label ?? c.node}: answering "${pick.id}" was refused: ${a.body.error}`, `「${node?.label ?? c.node}」：回答「${pick.id}」被拒絕：${a.body.error}`, "Give the card options the run can take.", "讓卡片選項能被任務採用。"); break; }
        answered++; continue;
      }
      await Bun.sleep(25);
    }
    r = rt.engine.get(id);
    for (const s of r.steps) steps.push({ node: s.node, state: s.state, outcome: s.outcome, error: s.error });
    const jobs = [...agents.jobs.values()];
    for (const j of jobs) if (j.status === "failed" && /^refused:/.test(j.error ?? "")) { const s = r.steps.find((x: any) => x.job === j.id) ?? r.steps.find((x: any) => x.state === "failed" || x.state === "error");
      fail("dryrun-refused", s?.node ?? null, `${s?.node ?? "a round"}: ${j.error}`, `${s?.node ?? "回合"}：${j.error}`, "Let the node work only in its own round folder.", "讓節點只在自己的回合資料夾中工作。"); }
    if (stoppedAt) { /* reached a captain-only one-way decision: everything before it ran */ }
    else if (r.status === "failed") {
      const bad = [...r.steps].reverse().find((s: any) => s.state === "failed" || s.state === "error");
      if (!problems.length) fail(/no edge takes it/.test(r.error ?? "") ? "dryrun-unhandled" : "dryrun-failed", bad?.node ?? null, `${bad ? `${r.def.nodes.find((n: any) => n.id === bad.node)?.label ?? bad.node}: ` : ""}${r.error ?? "the run failed"}${bad?.error && !String(r.error).includes(bad.error) ? ` (${bad.error})` : ""}`,
        `${bad ? `「${r.def.nodes.find((n: any) => n.id === bad.node)?.label ?? bad.node}」：` : ""}${r.error ?? "任務失敗"}`, "Fix the step named here; the dry run repeats it with the same stub.", "修正這裡指出的步驟；試跑會用同一個替身重跑。");
    } else if (!["succeeded"].includes(r.status) && !problems.length) {
      const cur = Object.entries(r.nodes).find(([, n]: any) => n.state === "running")?.[0] ?? null;
      fail("dryrun-timeout", cur, `The run did not finish (status ${r.status}${cur ? `, at ${cur}` : ""}).`, `任務沒有完成（狀態 ${r.status}${cur ? `，停在 ${cur}` : ""}）。`, "Make sure every path reaches an end the stub can take.", "確認每條路徑都能到達替身可以走完的結束點。");
    }
    if (!["succeeded", "failed", "cancelled"].includes(r.status)) try { rt.engine.cancel(id, "readiness gate", "dry run finished"); } catch {}
    return { status: problems.length ? "fail" : "pass", problems, steps, runStatus: r.status, stoppedAt };
  } catch (e: any) {
    fail("dryrun-error", null, `The dry run could not run: ${e?.message ?? e}`, `試跑無法進行：${e?.message ?? e}`, "Fix the draft so the engine accepts it.", "修正草稿，讓引擎能接受它。");
    return { status: "fail", problems, steps, runStatus: "error", stoppedAt: null };
  } finally {
    try { rt?.engine?.disposeExternal?.(); } catch {}
    await Bun.sleep(50); rmSync(data, { recursive: true, force: true });
  }
}
