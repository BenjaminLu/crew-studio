// Per-node records for the live acceptance report, and the real-model check over them.
// Agent nodes take provider/model from their Rounds. Hook nodes that call a model (MODEL_HOOKS)
// take it from the provenance of the artifact version they produced (createdBy), read through
// the run's ctx.deliver pins; a model hook that ran with no such record is not proven real.

export type NodeRecord = { node: string; label: string; kind: string; do: string | null; status: string; outcome: string; provider: string | null; model: string | null; source: "round" | "artifact" | null; rounds: number; durationSeconds: number | null; log: string; firstError: string | null };
/** hook actions that call a model on their own (not through an agent Round) */
export const MODEL_HOOKS = new Set(["image.generate", "coffee.image"]);
export const REAL = new Set(["claude", "codex"]);

export function outcomeClass(roundOutcome: string | null, nodeState: string): string {
  const o = nodeState === "error" ? "error" : roundOutcome ?? nodeState;
  if (o === "passed" || o === "chosen") return "pass";
  if (o === "failed") return "fail";
  if (o === "error") return "error";
  if (["interrupted", "superseded", "swapped"].includes(o)) return "interrupted";
  if (o === "skipped") return "skipped";
  if (o === "running" || o === "waiting") return "incomplete";
  return "not-reached";
}
const seconds = (a: string | null, b: string | null) => a ? Math.max(0, ((b ? Date.parse(b) : Date.now()) - Date.parse(a)) / 1000) : null;

/** artifacts: id -> the versions GET /api/artifacts/<id> returned (each with n and createdBy) */
export function nodeRecords(base: string, view: any, artifacts: Map<string, any[]> = new Map()): NodeRecord[] {
  const runLink = `${base}/#/run/${view.id}`;
  const made = new Map<string, any>(); // producer node -> createdBy of its pinned version
  for (const pin of Object.values<any>(view.ctx?.deliver ?? {})) { const v = (artifacts.get(pin?.id) ?? []).find((x: any) => x.n === pin.n); if (pin?.producer && v?.createdBy) made.set(pin.producer, v.createdBy); }
  return (view.def?.nodes ?? []).map((n: any) => {
    const rn = view.nodes?.[n.id] ?? {}; const rounds = (view.rounds ?? []).filter((r: any) => r.node === n.id);
    const last = rounds.at(-1) ?? null; const errored = rounds.find((r: any) => r.reason) ?? null; const agent = [...rounds].reverse().find((r: any) => r.actor?.kind === "agent") ?? null;
    let duration: number | null = null;
    if (rounds.length) duration = rounds.reduce((s: number, r: any) => s + (seconds(r.startedAt, r.endedAt) ?? 0), 0);
    else if (rn.startedAt) duration = seconds(rn.startedAt, rn.endedAt);
    const transcript = errored?.transcript ?? agent?.transcript ?? null;
    const by = n.kind !== "agent" ? made.get(n.id) : null;
    const provider = agent?.actor?.provider ?? rn.agent?.provider ?? by?.provider ?? null, model = agent?.actor?.model ?? rn.agent?.model ?? by?.model ?? null;
    return { node: n.id, label: n.label ?? n.id, kind: n.kind, do: n.do ?? null, status: rn.state ?? "pending", outcome: outcomeClass(last?.outcome ?? null, rn.state ?? "pending"),
      provider, model, source: agent ? "round" : by ? "artifact" : null, rounds: rounds.length,
      durationSeconds: duration === null ? null : Math.round(duration * 10) / 10, log: transcript ? `${base}/${transcript}` : runLink,
      firstError: errored?.reason?.en ?? rn.error ?? null };
  });
}

/** Every model call the run made, from its own records: agent Rounds, every job a node ran
 *  (loop coordinators included: node data.jobs), judged-check votes in the ledger, and the
 *  provenance of artifacts a model hook made. Each entry is "<provider>/<model>" with where it came from. */
export function modelCalls(view: any, nodes: NodeRecord[]): { call: string; from: string }[] {
  const out: { call: string; from: string }[] = [];
  const add = (p: unknown, m: unknown, from: string) => { if (typeof p === "string" && p) out.push({ call: `${p}/${typeof m === "string" && m ? m : "?"}`, from }); };
  for (const r of view.rounds ?? []) if (r.actor?.kind === "agent") add(r.actor.provider, r.actor.model, `round ${r.id}`);
  for (const [id, rn] of Object.entries<any>(view.nodes ?? {})) for (const j of Array.isArray(rn?.data?.jobs) ? rn.data.jobs : []) add(j?.provider, j?.model, `job ${id}/${j?.id ?? "?"}`);
  for (const e of view.ledger ?? []) for (const v of Array.isArray(e?.votes) ? e.votes : []) add(v?.provider, v?.model, `vote ${e.check ?? "check"}#${e.seq ?? "?"}`);
  for (const n of nodes) if (n.source === "artifact") add(n.provider, n.model, `artifact of ${n.node}`);
  return out;
}

/** Every node that called a model must show a real vendor; a model hook that ran without a provenance record is not proven. */
export function modelProblems(nodes: NodeRecord[], offline: boolean, calls: { call: string; from: string }[] = []): string[] {
  const out: string[] = [];
  for (const c of calls) { const p = c.call.split("/")[0]; if (!offline && !REAL.has(p)) out.push(`${c.from} ran on ${c.call}, not a real model`); }
  for (const n of nodes) {
    const ran = n.outcome !== "not-reached";
    if (n.kind === "agent" && n.rounds && n.provider && !offline && !REAL.has(n.provider) && !calls.length) out.push(`${n.node} ran on ${n.provider}, not a real model`);
    if (n.kind === "agent" && n.rounds && !n.provider) out.push(`${n.node} ran ${n.rounds} round(s) with no provider recorded: a real model is not proven`);
    if (n.kind !== "agent" && n.do && MODEL_HOOKS.has(n.do) && ran && n.status === "passed") {
      if (!n.provider) out.push(`${n.node} (${n.do}) called a model but left no provider/model record: a real model is not proven`);
      else if (!offline && !REAL.has(n.provider)) out.push(`${n.node} (${n.do}) ran on ${n.provider}, not a real model`);
    }
  }
  return out;
}

/** Pick fallbacks: the vendors Studio's policy may choose for an unpinned pick (opposite of the host, then a fallback). */
export type ProviderNeed = { provider: string; why: string };
/**
 * The vendors a run may call, in the order the engine picks them (engine.x pick): the node's own
 * provider, then its role's, then the Start form's provider, then Studio's policy (any of `policy`).
 * Agent nodes, loop coordinators and judged checks (a ref's provider, else the policy) all count.
 * Staffing-approved picks are added by the caller once Studio shows the staffing plan.
 */
export function providersToCheck(def: any, startProvider: string | null, judged: Set<string>, policy: string[]): ProviderNeed[] {
  const out: ProviderNeed[] = []; const roles = new Map<string, any>((def?.roles ?? []).map((r: any) => [r.id, r]));
  const pick = (node: any, roleId: string | null, why: string) => {
    if (typeof node?.provider === "string") return out.push({ provider: node.provider, why: `${why}: node provider` });
    const role = roleId ? roles.get(roleId) : null;
    if (typeof role?.provider === "string") return out.push({ provider: role.provider, why: `${why}: role ${role.id}` });
    if (startProvider) return out.push({ provider: startProvider, why: `${why}: Start form provider` });
    for (const p of policy) out.push({ provider: p, why: `${why}: Studio's policy may pick it` });
  };
  for (const n of def?.nodes ?? []) {
    if (n.kind === "agent") pick(n, n.role ?? null, `agent ${n.id}`);
    if (n.kind === "loop" && n.args?.coordinator) pick({}, n.args.coordinator, `loop ${n.id} coordinator`);
    for (const c of n.checks ?? []) if (judged.has(c.use)) { if (typeof c.provider === "string") out.push({ provider: c.provider, why: `judged check ${c.use} on ${n.id}` }); else for (const p of policy) out.push({ provider: p, why: `judged check ${c.use} on ${n.id}: Studio's policy may pick it` }); }
  }
  for (const e of def?.edges ?? []) for (const c of (Array.isArray(e) ? e[3]?.checks : e.checks) ?? []) if (judged.has(c.use)) { if (typeof c.provider === "string") out.push({ provider: c.provider, why: `judged check ${c.use} on an edge` }); else for (const p of policy) out.push({ provider: p, why: `judged check ${c.use} on an edge: Studio's policy may pick it` }); }
  return out;
}
