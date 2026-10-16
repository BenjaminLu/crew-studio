// The readiness gate, wired into the runtime: every draft revision and every saved version of
// the captain's own workflow is checked (stages 1-4), results are stored per definition hash,
// failures loop back to Firstmate, and the captain may verify a version with one real Task.
// Routes:
//   GET  /api/wf/drafts/<id>/gate          the draft's gate result, repair rounds, intent mapping, status line
//   POST /api/wf/drafts/<id>/gate          re-run the gate on the current revision
//   GET  /api/wf/<id>/gate[?v=N]           a workflow version's gate result and status line
//   POST /api/wf/<id>/gate                 re-run it
//   POST /api/wf/<id>/gate/smoke           "Verify with a real run": one real Task (staffing confirmed like Run)
import type { Engine } from "../runtime/engine";
import { normalize, type WDef, type WorkflowDefs } from "../runtime/defs";
import { ownBrief, ownStaffingPlan, ownWorkflow, type DraftRecord, type WorkflowDrafts } from "../workflow-drafts";
import { contractStage, intentMap, intentStage, type LoginState } from "./stages";
import { engineEnv } from "./engine-env";
import { dryRun } from "./dryrun";
import { Gate, gateKeyForDraft, gateKeyForWorkflow, sampleOf, weakening } from "./service";
import { gatePassed } from "./types";

export type ReadinessDeps = { engine: Engine; defs: WorkflowDefs; drafts: WorkflowDrafts; dataDir: string; protectedRoots: string[]; createRuntime: (d: any) => any; send: (t: string, d: unknown) => void;
  login?: (provider: string) => LoginState; knownProviders?: () => string[]; repoRoot?: string | null; ask?: (text: string) => boolean; dryTimeoutMs?: number; smokePollMs?: number };

/** A draft as the workflow it would be saved as (its goal and interview are part of every brief). */
export const draftDef = (d: DraftRecord): WDef => ({ ...d.def, origin: { schema: 1, source: "firstmate-draft", draft: d.id, brief: { goal: d.goal, interview: d.interview } } } as WDef);

export function installReadiness(d: ReadinessDeps) {
  const env = engineEnv({ engine: d.engine, dataDir: d.dataDir, protectedRoots: d.protectedRoots, repoRoot: d.repoRoot ?? null,
    knownProviders: d.knownProviders ?? (() => ["claude", "codex"]), login: d.login ?? (() => "unknown") });
  const gate = new Gate({ dataDir: d.dataDir, contract: env.contract, briefs: env.briefs,
    dry: (def, sample) => dryRun(def, { sample, protectedRoots: d.protectedRoots, createRuntime: d.createRuntime, timeoutMs: d.dryTimeoutMs }),
    ask: d.ask, maxRounds: () => { const v = Number(d.engine.policies.get("readiness.repair_rounds").value ?? 6); return Number.isInteger(v) && v >= 1 && v <= 12 ? v : 6; },
    notify: (key) => { try { d.send("wfgate", { key }); } catch {} } });
  const lastDef = new Map<string, WDef>();
  const contractOf = (def: WDef) => contractStage(def, env.contract(def, sampleOf(def)));
  d.drafts.gate.weakening = (prev, next) => weakening(prev, next, contractOf);
  d.drafts.gate.refused = (id, reason) => { try { const rec = d.drafts.get(id); gate.refused(id, reason, draftDef(rec)); } catch {} };
  /** Gate one draft revision, then let the repair loop decide the next step. */
  const gateDraft = async (id: string, force = false) => {
    const rec = d.drafts.get(id); const def = draftDef(rec); const key = gateKeyForDraft(id);
    const r = await gate.run(key, def, rec.goal, force);
    const now = d.drafts.get(id); if (now.revision !== rec.revision) return r; // a newer revision is gated next
    const prev = lastDef.get(id) ?? null; lastDef.set(id, def);
    gate.afterGate(id, rec.revision, def, r, rec.provenance.last ?? "model", prev);
    return r;
  };
  const pending = new Map<string, Promise<any>>();
  const schedule = (id: string) => { const p = (pending.get(id) ?? Promise.resolve()).catch(() => null).then(() => gateDraft(id)).catch(() => null); pending.set(id, p); return p; };
  const prior = d.drafts.notify; (d.drafts as any).notify = (id: string, revision: number) => { prior(id, revision); void schedule(id); };
  // a saved draft's result carries to the workflow version when the definition is the same
  const save0 = d.drafts.save.bind(d.drafts);
  (d.drafts as any).save = (id: string, by: string, revision?: number) => { const out = save0(id, by, revision);
    try { const def = d.defs.get(out.workflow, out.version)!; if (!gate.carry(gateKeyForDraft(id), gateKeyForWorkflow(out.workflow, out.version), def)) void gate.run(gateKeyForWorkflow(out.workflow, out.version), def); } catch {}
    return out; };
  const wfView = (id: string, v?: number, start = true) => {
    const def = d.defs.get(id, v); if (!def) return null; const key = gateKeyForWorkflow(id, def.version);
    const own = ownWorkflow(def);
    // the gate runs by itself on the captain's own workflows; any other workflow is checked on request (POST)
    const r = gate.read(key, def); if (!r && start && own) void gate.run(key, def);
    return { workflow: id, version: def.version, own, key, gate: r, status: gate.status(r), intents: intentMap(def), passed: gatePassed(r), repair: def.origin?.draft ? gate.repair(def.origin.draft) : null };
  };
  const draftView = (id: string, start = true) => {
    const rec = d.drafts.get(id); const def = draftDef(rec); const key = gateKeyForDraft(id);
    const r = gate.read(key, def); if (!r && start) void schedule(id);
    return { draft: id, revision: rec.revision, key, gate: r, status: gate.status(r), intents: intentMap(def), passed: gatePassed(r), repair: gate.repair(id) };
  };
  /** Stage 5 watcher: a real run ended → verified, or fed back to Firstmate once. */
  const checkSmokes = () => {
    for (const r of gate.runningSmokes()) {
      const m = /^wf-([a-z0-9][a-z0-9-]*)-v(\d+)$/.exec(r.key); if (!m) continue; const def = d.defs.get(m[1], Number(m[2])); const run = r.smoke && d.engine.get(r.smoke.task); if (!def || !run) continue;
      if (!["succeeded", "failed", "cancelled"].includes(run.status)) continue;
      const ok = run.status === "succeeded";
      const step = [...run.steps].reverse().find((s) => s.state === "failed" || s.state === "error");
      const res = gate.smokeEnded(r.key, def, run.id, ok, ok ? null : `${run.status}${step ? ` at ${step.node}` : ""}: ${run.error ?? step?.error ?? "no reason recorded"}`);
      if (res && !ok && run.status !== "cancelled" && def.origin?.draft) { try { const rec = d.drafts.get(def.origin.draft); gate.feedSmoke(rec.id, draftDef(rec), res); } catch {} }
    }
  };
  const timer = setInterval(() => { try { checkSmokes(); } catch {} }, d.smokePollMs ?? 3000); (timer as any).unref?.();
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  async function route(p: string, url: URL, method: string, writing: boolean, b: any, by: string, who: { kind: string }): Promise<Response | null> {
    let m = /^\/api\/wf\/drafts\/(d-[a-f0-9]{12})\/gate$/.exec(p);
    if (m) { if (writing) { if (method !== "POST") return json({ error: "POST required" }, 405); await gateDraft(m[1], true).catch(() => null); } return json(draftView(m[1])); }
    m = /^\/api\/wf\/([a-z0-9][a-z0-9-]*)\/gate(\/smoke)?$/.exec(p);
    if (!m || m[1] === "drafts") return null;
    const id = m[1];
    if (!m[2]) {
      if (writing) { if (method !== "POST") return json({ error: "POST required" }, 405); const def = d.defs.get(id, b?.version ? Number(b.version) : undefined); if (!def) return json({ error: "no such workflow" }, 404); await gate.run(gateKeyForWorkflow(id, def.version), def, null, true); }
      const v = url.searchParams.get("v"); const view = wfView(id, v ? Number(v) : b?.version ? Number(b.version) : undefined); return view ? json(view) : json({ error: "no such workflow" }, 404);
    }
    if (!writing || method !== "POST") return json({ error: "POST required" }, 405);
    if (who.kind !== "desktop") return json({ error: "Verify with a real run on the Mac / 請在 Mac 上進行真實試跑", code: "desktopOnly" }, 403);
    const def = d.defs.get(id, b?.version ? Number(b.version) : undefined); if (!def) return json({ error: "no such workflow" }, 404);
    if (!ownWorkflow(def)) return json({ error: "Only your own workflows take a verification run / 只有你自己的流程可以進行驗證試跑" }, 409);
    const key = gateKeyForWorkflow(id, def.version); const r = gate.read(key, def);
    if (!gatePassed(r)) return json({ error: "Stages 1-4 must pass on this version first / 這個版本需先通過前四關", code: "gate_not_passed", status: gate.status(r) }, 409);
    if (r!.smoke?.status === "running") return json({ error: `A verification run is already going: ${r!.smoke.task} / 驗證試跑進行中：${r!.smoke.task}`, code: "smoke_running", task: r!.smoke.task }, 409);
    const staffing = ownStaffingPlan(def);
    if (staffing.plan.length) {
      if (staffing.missing.length) return json({ error: "Choose a provider, model and (for Codex) effort for every agent node first / 請先為每個代理節點選擇供應商、模型與（Codex）推理強度", code: "staffing_incomplete", staffing }, 409);
      if (b?.staffingConfirm !== staffing.hash) return json({ error: "Confirm who works on each node before the verification run / 驗證試跑前請確認每個節點的人員配置", code: "staffing_confirmation_required", staffing }, 409);
    }
    const sample = sampleOf(def);
    // one real Task on the subscription with the small sample input; Studio answers none of its cards
    const run = d.engine.start({ workflow: id, version: def.version, title: `Verify: ${def.name}`, text: ownBrief(def, sample.text, sample.params), params: { ...sample.params, ...(staffing.plan.length ? { _ownStaffing: staffing.hash } : {}), _gateSmoke: key }, by });
    gate.smokeStarted(key, def, run.id);
    return json({ task: run.id, href: `#/run/${run.id}`, ...wfView(id, def.version, false) });
  }
  /** An editor save of a drafted workflow keeps every intent line served (en / zh-TW). */
  const editRefusal = (id: string, body: any) => {
    const cur = d.defs.get(id); if (!cur || cur.origin?.source !== "firstmate-draft" || !(cur as any).intents?.length) return null;
    const next = normalize({ ...cur, ...body, intents: (cur as any).intents });
    const ps = intentStage(next); if (!ps.length) return null;
    return { error: `Cannot save yet: ${ps.map((x) => x.reason.en).join(" ")} / 還不能儲存：${ps.map((x) => x.reason.zh).join("")}`, problems: ps.map((x) => ({ level: "error", node: x.node ?? undefined, text: x.reason.en, zh: x.reason.zh, fix: x.fix })) };
  };
  const versionSaved = (def: WDef) => { try { if (ownWorkflow(def)) void gate.run(gateKeyForWorkflow(def.id, def.version), d.defs.get(def.id, def.version)!); } catch {} };
  const tools = {
    repairAuthorized: (draft: string, text: string) => { try { return gate.repairAuthorized(draft, text); } catch { return false; } },
    view: (a: { draft?: string; workflow?: string; version?: number }) => {
      const slim = (v: any) => v && ({ ...v, gate: v.gate && { ...v.gate, briefs: v.gate.briefs.map((x: any) => ({ node: x.node, label: x.label, chars: x.system.length + x.prompt.length })) } });
      if (typeof a.draft === "string") return slim(draftView(a.draft));
      if (typeof a.workflow === "string") { const v = wfView(a.workflow, a.version); if (!v) throw new Error("no such workflow"); return slim(v); }
      throw new Error("pass draft, or workflow and version");
    },
  };
  return { gate, route, tools, editRefusal, versionSaved, checkSmokes, gateDraft, schedule, draftView, wfView, stop: () => clearInterval(timer) };
}
