// Drive one Task to its end the way the captain does on the board, and check what it left behind.
import { TERMINAL, type Studio } from "./studio";
import { Ledger, type LedgerEntry } from "../../src/runtime/checks";

export type Choice = { choice: string; note?: string | null };
/** What the captain does with one open card: answer it, or stop (the card was not scripted). */
export type Decide = (card: any, view: any, visit: number) => Promise<Choice | { stop: string }>;
export type Expect = {
  status: "succeeded" | "failed" | "cancelled" | "waiting";
  /** every node the Task must have visited */
  visited: string[];
  /** nodes it must not have visited (the other branch) */
  notVisited?: string[];
  /** an approved artifact reached the Library (ctx.library, listed by /api/library as approved) */
  library?: boolean;
  /** at least this many pinned artifact outputs (ctx.deliver) */
  outputs?: number;
  /** for status "waiting": the node whose card it must be waiting on */
  waitingOn?: string;
  /** the run's result (the shared scenario's expect.result) */
  result?: string | null;
  minVisits?: Record<string, number>;
  /** an artifact that must be listed approved in the Library ({task} = the Task id, lower case) */
  approved?: string;
  /** a file the run folder must hold (the shared scenario's {file: path}) */
  files?: string[];
};
export type Drive = { view: any; answered: { node: string; card: string; choice: string }[]; problems: string[] };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Phrases that tell the captain nothing: an error that leaked as-is, or a placeholder. */
export const GENERIC = [/\[object Object\]/, /\bundefined\b/, /\bNaN\b/, /the agent run failed/, /the turn ended without a result/, /CLI exited without a successful result/, /the model run failed/, /\b(?:TypeError|ReferenceError|SyntaxError)\b/, /Cannot read propert/, /is not a function/, /Unexpected token/];
export const PATH_REFUSAL = /a round may not reach/;

export async function answerCard(s: Studio, c: any, a: Choice) {
  // as the board does (public/scard.js): every intent line ticked, the door confirmed on a one-way card
  const n = c.detail?.intents?.length ?? 0;
  return s.api(`/api/scards/${encodeURIComponent(c.id)}/answer`, { choice: a.choice, note: a.note ?? null, confirm: c.confirmDoor && c.door === "one-way" ? "one-way" : null, aligned: n ? Array.from({ length: n }, (_, i) => i) : undefined });
}

/** Poll the Task, answer each new open card through `decide`, stop at a terminal status (or when `until` holds). */
export async function drive(s: Studio, rid: string, decide: Decide, o: { timeoutMs?: number; until?: (v: any) => boolean } = {}): Promise<Drive> {
  const t0 = Date.now(), timeout = o.timeoutMs ?? 120_000, seen = new Set<string>(), visits = new Map<string, number>();
  const answered: Drive["answered"] = [], problems: string[] = []; let view: any = null;
  while (Date.now() - t0 < timeout) {
    const r = await s.api(`/api/wruns/${rid}`); if (r.status !== 200) { problems.push(`GET /api/wruns/${rid}: ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`); return { view, answered, problems }; }
    view = r.body;
    if ((TERMINAL.includes(view.status) && !view.ctx?.firstmateQuestion && !(view.cards ?? []).some((c: any) => c.status === "open" && c.failure?.code === "ask.escalated")) || o.until?.(view)) return { view, answered, problems };
    for (const c of (view.cards ?? []).filter((c: any) => c.status === "open" && !seen.has(c.id))) {
      seen.add(c.id); const i = visits.get(c.node) ?? 0; visits.set(c.node, i + 1);
      const a = await decide(c, view, i);
      if ("stop" in a) { problems.push(`unscripted captain card at node ${c.node}: ${titleOf(c)} (options ${(c.options ?? []).map((x: any) => x.id).join("|")}) ${noteOf(view, c.node)} [${a.stop}]`.trim()); return { view, answered, problems }; }
      const res = await answerCard(s, c, a);
      answered.push({ node: c.node, card: c.id, choice: a.choice });
      if (res.status !== 200) { problems.push(`answering ${c.id} at ${c.node} with ${a.choice} was refused: ${res.status} ${String(res.body?.error ?? JSON.stringify(res.body)).slice(0, 400)}`); return { view, answered, problems }; }
    }
    await sleep(200);
  }
  problems.push(`no terminal status within ${Math.round(timeout / 1000)} s: ${where(view)}`);
  return { view, answered, problems };
}
export const titleOf = (c: any) => (typeof c.title === "object" ? c.title?.en ?? JSON.stringify(c.title) : String(c.title ?? ""));
const noteOf = (v: any, node: string) => { const n = v?.nodes?.[node]; return n?.note ? `(${String(n.note).slice(0, 300)})` : ""; };

/** Where a Task stands, in one line: the failed node and its error, else what it waits on. */
export function where(v: any): string {
  if (!v) return "no Task view";
  const failed = Object.entries<any>(v.nodes ?? {}).find(([, n]) => ["error", "failed"].includes(n.state) && n.error);
  if (failed) return `node ${failed[0]}: ${String(failed[1].error).slice(0, 400)}`;
  const live = Object.entries<any>(v.nodes ?? {}).filter(([, n]) => ["running", "waiting"].includes(n.state)).map(([k, n]) => `${k} ${n.state}${n.note ? ` (${String(n.note).slice(0, 200)})` : ""}`);
  return `status ${v.status}${v.error ? `: ${String(v.error).slice(0, 400)}` : ""}${live.length ? `; at ${live.join(", ")}` : ""}`;
}

/** Every presented card needs its own authenticated wording result, not an unrelated passing check. */
export function cardWordingProblems(v: any, entries: LedgerEntry[]): string[] {
  const cards = (v.cards ?? []).filter((c: any) => !c.decidedBy);
  const out = entries.filter(e => e.check === "core/ste-wording" && e.verdict !== "pass")
    .map(e => `wording ${e.verdict} at ${e.node} #${e.seq}: ${(e.findings ?? []).map(f => f.message).join("; ")}`);
  if (cards.length && !(v.def?.card_checks ?? ["core/ste-wording"]).includes("core/ste-wording")) out.push("wording policy unexpectedly disables core/ste-wording");
  for (const c of cards) {
    if (c.ste?.verdict !== "pass" || !Number.isInteger(c.ste?.seq)) { out.push(`card ${c.id} has no passing wording check state`); continue; }
    const receipt = entries.find(e => e.seq === c.ste.seq && e.run === v.id && e.run === c.run && e.node === c.node && e.round === c.visit && e.edge === `card:${c.id}` && e.check === "core/ste-wording" && e.verdict === "pass");
    if (!receipt) out.push(`card ${c.id} has no matching authenticated passing wording receipt`);
  }
  return out;
}

/** Everything the Task left behind, against what the scenario expects. */
export async function verify(s: Studio, d: Drive, e: Expect): Promise<string[]> {
  const v = d.view, out = [...d.problems]; if (!v) return out.length ? out : ["no Task view"];
  if ((v.cards ?? []).some((c: any) => !c.decidedBy)) {
    const auth = new Ledger(s.data, v.id).authenticatedPrefix();
    if (auth.bad.length || auth.malformed) out.push("wording check evidence does not authenticate");
    else out.push(...cardWordingProblems(v, auth.prefix));
  }
  if (e.status !== "waiting" && v.status !== e.status) out.push(`status ${v.status}, expected ${e.status} (${where(v)})`);
  if (e.waitingOn && TERMINAL.includes(v.status)) out.push(`ended ${v.status} instead of waiting on ${e.waitingOn} (${where(v)})`);
  else if (e.waitingOn && !(v.cards ?? []).some((c: any) => c.status === "open" && c.node === e.waitingOn)) out.push(`not waiting on a card at ${e.waitingOn} (${where(v)})`);
  const visited = (id: string) => (v.nodes?.[id]?.visits ?? 0) > 0 || (v.steps ?? []).some((st: any) => st.node === id);
  const missed = e.visited.filter((id) => !visited(id)); if (missed.length) out.push(`never visited: ${missed.join(", ")}`);
  const wrong = (e.notVisited ?? []).filter(visited); if (wrong.length) out.push(`visited the other branch: ${wrong.join(", ")}`);
  const texts = [v.error, ...Object.values<any>(v.nodes ?? {}).map((n) => n.error), ...(v.events ?? []).filter((x: any) => /fail|error|refus/.test(x.type)).map((x: any) => x.summary), ...Object.values<any>(v.nodes ?? {}).flatMap((n) => (n.data?.jobs ?? []).map((j: any) => j.error))].filter(Boolean).map(String);
  const refused = texts.find((t) => PATH_REFUSAL.test(t)); if (refused) out.push(`agent path check refused a round: ${refused.slice(0, 300)}`);
  for (const t of texts) { const g = GENERIC.find((re) => re.test(t)); if (g) { out.push(`generic error text (${g}): ${t.slice(0, 300)}`); break; } }
  if (e.outputs !== undefined) { const n = Object.keys(v.ctx?.deliver ?? {}).length; if (n < e.outputs) out.push(`${n} pinned artifact outputs, expected at least ${e.outputs}`); }
  if (e.result !== undefined && v.status === e.status && (v.result ?? null) !== e.result) out.push(`result ${v.result ?? null}, expected ${e.result}`);
  for (const [node, n] of Object.entries(e.minVisits ?? {})) { const got = v.nodes?.[node]?.visits ?? 0; if (got < n) out.push(`${node} visited ${got} times, expected at least ${n}`); }
  for (const f of e.files ?? []) { const r = await s.api(`/api/wruns/${v.id}/file?path=${encodeURIComponent(f)}`); if (r.status !== 200) out.push(`run folder has no ${f}`); }
  if (e.approved) { const id = e.approved.replace("{task}", String(v.id).toLowerCase()); const a = ((await s.api("/api/library")).body.artifacts ?? []).find((x: any) => x.id === id); if (!a?.versions?.some((x: any) => x.status === "approved")) out.push(`Library has no approved ${id}`); }
  if (e.library) {
    const lib = v.ctx?.library; if (!lib?.artifact) out.push("no Library entry (ctx.library)");
    else { const l = await s.api("/api/library"); const a = (l.body.artifacts ?? []).find((x: any) => x.id === lib.artifact); const ver = a?.versions?.find?.((x: any) => x.n === lib.version) ?? null;
      if (!a) out.push(`Library does not list ${lib.artifact}`); else if (!ver) out.push(`Library does not list ${lib.artifact} v${lib.version}`); else if (ver.status !== "approved") out.push(`Library lists ${lib.artifact} v${lib.version} as ${ver.status}, not approved`); }
  }
  return out;
}
