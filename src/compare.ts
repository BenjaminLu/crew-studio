// Compare transcripts: two agent Rounds of one Task side by side (docs/units/compare-transcripts.md).
// A workflow may declare which roles answer each other (`compare: [[founder, judge]]` in its yaml): the k-th
// round of the first role sits next to the k-th round of the second. Without a declaration the captain picks
// any two agent Rounds. Read only; every text passes the Transcripts redaction (src/transcripts.ts).
//   GET /api/tasks/<id>/compare                   the declared pairs and every agent Round to choose from
//   GET /api/tasks/<id>/compare/<node>/<visit>    one Round's prompt, transcript entries and report
//
// TODO(error-log-links): src/logs.ts (branch error-log-links, under review) brings openLog, job pointers and
// log links. When it lands, read the round files through its openLog and take the header's log link from its
// linkFor; the confined reader below keeps the same rules (names only, realpath inside data/runs, no symlinks).
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";
import type { Run, Step } from "./runtime/engine";
import { redactJSON, redactText } from "./secure";
import { INVOCATION, parseLines, recordPrompt, type Entry } from "./transcripts";

export const TASK_ID = /^R-\d+$/;
const NODE = /^[a-z0-9][a-z0-9-]{0,40}$/; // a node id (src/runtime/defs.ts validate)
const VISIT = /^[1-9]\d{0,5}$/;
const STREAM_MAX = 16 << 20, PROMPT_MAX = 2 << 20, REPORT_MAX = 2 << 20;

export type Pair = [string, string];
export type CompareSide = {
  node: string; visit: number; attempt: number; role: string | null; roleLabel: string | null; label: string;
  provider: string | null; model: string | null; startedAt: string | null; endedAt: string | null; seconds: number | null;
  state: string; outcome: string | null; error: string | null; key: number; transcript: string;
};
export type ComparePair = { roles: Pair; key: number; left: CompareSide | null; right: CompareSide | null };
export type ComparePlan = { task: string; workflow: string; declared: Pair[]; source: "task" | "workflow" | null; pairs: ComparePair[]; rounds: CompareSide[] };

/** A `compare` hint as role pairs: [[a, b], …], two different roles of the workflow each. Anything else is not a hint. */
export function comparePairs(raw: unknown, roles: { id: string }[] | undefined): Pair[] | null {
  if (!Array.isArray(raw) || !raw.length) return null;
  const ids = new Set((roles ?? []).map((r) => r.id));
  const out: Pair[] = [];
  for (const p of raw) {
    if (!Array.isArray(p) || p.length !== 2 || typeof p[0] !== "string" || typeof p[1] !== "string" || p[0] === p[1] || !ids.has(p[0]) || !ids.has(p[1])) return null;
    out.push([p[0], p[1]]);
  }
  return out;
}
/** What is wrong with a workflow's `compare` hint (src/runtime/defs.ts validate reports it), or null. */
export function compareProblem(raw: unknown, roles: { id: string }[] | undefined): string | null {
  if (raw === undefined || raw === null) return null;
  return comparePairs(raw, roles) ? null : "compare: a list of [role, role] pairs, two different roles of this workflow each";
}

/** A Task's agent Rounds, one per node visit (its latest attempt), in order. */
export function agentRounds(run: Run): CompareSide[] {
  const last = new Map<string, { s: Step; attempt: number }>();
  for (const s of run.steps ?? []) {
    if (s.kind !== "agent") continue;
    const k = `${s.node}#${s.visit}`;
    last.set(k, { s, attempt: (last.get(k)?.attempt ?? 0) + 1 });
  }
  const perRole = new Map<string, number>();
  return [...last.values()].sort((a, b) => a.s.seq - b.s.seq).map(({ s, attempt }) => {
    const def: any = run.def?.nodes?.find((n: any) => n.id === s.node) ?? null;
    const role = def?.role ?? null;
    const ord = (perRole.get(role ?? "") ?? 0) + 1; perRole.set(role ?? "", ord);
    // a node that names its round (startup's args.round) keeps it; any other is the n-th round of its role
    const named = Number(def?.args?.round);
    // the exact model: the step's, else its job's, else the node's bound agent (a step written before it kept one)
    const rn: any = run.nodes?.[s.node], job = Array.isArray(rn?.data?.jobs) ? rn.data.jobs.find((j: any) => j?.id === s.job) : null;
    const provider = s.provider ?? job?.provider ?? rn?.agent?.provider ?? null, model = s.model ?? job?.model ?? rn?.agent?.model ?? null;
    const seconds = s.startedAt && s.endedAt ? Math.max(0, (Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 1000) : null;
    return { node: s.node, visit: s.visit, attempt, role, roleLabel: run.def?.roles?.find((r) => r.id === role)?.label ?? role, label: def?.label ?? s.node,
      provider, model, startedAt: s.startedAt ?? null, endedAt: s.endedAt ?? null, seconds,
      state: s.state, outcome: s.outcome ?? null, error: s.error ? redactText(String(s.error)).slice(0, 500) : null,
      key: Number.isInteger(named) && named > 0 ? named : ord,
      transcript: `#/runs/node/${encodeURIComponent(run.id)}/${encodeURIComponent(s.node)}/${s.visit}/transcript` };
  });
}

/** The pairs a Task's workflow declares (its own pinned copy first, else the workflow's current version), and every agent Round. */
export function comparePlan(run: Run, current?: { compare?: unknown } | null): ComparePlan {
  const rounds = agentRounds(run);
  const own = comparePairs((run.def as any)?.compare, run.def?.roles);
  const later = own ? null : comparePairs(current?.compare, run.def?.roles);
  const declared = own ?? later ?? [];
  const pairs: ComparePair[] = [];
  for (const roles of declared) {
    const lefts = rounds.filter((r) => r.role === roles[0]), rights = rounds.filter((r) => r.role === roles[1]);
    const keys = [...new Set([...lefts, ...rights].map((r) => r.key))].sort((a, b) => a - b);
    for (const key of keys) pairs.push({ roles, key, left: lefts.filter((r) => r.key === key).at(-1) ?? null, right: rights.filter((r) => r.key === key).at(-1) ?? null });
  }
  return { task: run.id, workflow: run.workflow, declared, source: own ? "task" : later ? "workflow" : null, pairs, rounds };
}

// ---------- the confined reader ----------
const inside = (root: string, p: string) => p === root || p.startsWith(root + sep);
/** Read a file under `root` by name parts only: no part may be a symlink, the folder's realpath stays inside the
 *  root's, and the leaf opens O_NOFOLLOW | O_NONBLOCK as a regular file. Null when any rule fails or it is missing. */
export function readConfined(root: string, parts: string[], max: number): { text: string; size: number; cut: boolean } | null {
  if (!parts.length || parts.some((x) => !x || x === "." || x === ".." || x.includes("/") || x.includes("\\") || x.includes("\0"))) return null;
  let fd = -1;
  try {
    const realRoot = realpathSync(root);
    let p = root;
    for (const part of parts) { p = join(p, part); if (lstatSync(p).isSymbolicLink()) return null; }
    const dir = join(root, ...parts.slice(0, -1));
    if (!inside(realRoot, realpathSync(dir))) return null;
    fd = openSync(p, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const st = fstatSync(fd);
    if (!st.isFile()) return null;
    if (!inside(realRoot, realpathSync(dir))) return null; // the folder did not move while it opened
    const len = Math.min(st.size, max);
    const b = Buffer.alloc(len); const n = readSync(fd, b, 0, len, 0);
    return { text: b.subarray(0, n).toString("utf8"), size: st.size, cut: st.size > max };
  } catch { return null; } finally { if (fd >= 0) closeSync(fd); }
}

/** The newest invocation's lines of a round's shared stream (an attempt or a hand-off starts with its "started" status). */
function newestLines(text: string, cut: boolean): { lines: string[]; prompt: string } {
  const all = text.split("\n"); if (cut) all.pop(); // a cut file ends mid-line
  let owner = "prompt.md", newest = "prompt.md";
  const by = new Map<string, string[]>();
  for (const line of all) {
    if (!line.trim()) continue;
    if (line.includes('"started"')) { try { const x = JSON.parse(line); if (x?.type === "status" && x.status === "started" && typeof x.prompt === "string" && INVOCATION.test(x.prompt)) { owner = x.prompt; newest = owner; } } catch {} }
    if (!by.has(owner)) by.set(owner, []);
    by.get(owner)!.push(line);
  }
  return { lines: by.get(newest) ?? [], prompt: newest };
}
/** Stream entries, with a message the provider wrote twice in a row (same time, same text) shown once. */
function entriesOf(lines: string[]): Entry[] {
  const out: Entry[] = [];
  for (const e of parseLines(lines)) { const p = out.at(-1); if (p && e.kind === "text" && p.kind === "text" && p.t === e.t && p.text === e.text) continue; out.push(e); }
  return out;
}
export type SideView = { node: string; visit: number; prompt: { name: string; header: any; body: string; bytes: number } | null; entries: Entry[];
  report: { status: string | null; said: string | null; error: string | null; tools: number | null; cost: any } | null; stream: { bytes: number; cut: boolean } };
/** One Round's record, read through the confined reader and redacted. */
export function readSide(dataDir: string, run: string, node: string, visit: number): SideView {
  const root = join(dataDir, "runs"), at = [run, "nodes", node, String(visit)];
  const s = readConfined(root, [...at, "stream.jsonl"], STREAM_MAX);
  const { lines, prompt: name } = s ? newestLines(s.text, s.cut) : { lines: [], prompt: "prompt.md" };
  const pt = readConfined(root, [...at, name], PROMPT_MAX) ?? (name === "prompt.md" ? null : readConfined(root, [...at, "prompt.md"], PROMPT_MAX));
  const pv = pt ? recordPrompt(pt.text) : null;
  const sfx = name.slice("prompt".length, -".md".length);
  const rt = (sfx ? readConfined(root, [...at, `report${sfx}.json`], REPORT_MAX) : null) ?? readConfined(root, [...at, "report.json"], REPORT_MAX);
  let report: SideView["report"] = null;
  if (rt) {
    let r: any; try { r = redactJSON(JSON.parse(rt.text)); } catch { r = { said: redactText(rt.text) }; }
    if (r && typeof r === "object") report = { status: typeof r.status === "string" ? r.status : null, said: typeof r.said === "string" ? r.said : null,
      error: r.error ? String(r.error) : null, tools: typeof r.tools === "number" ? r.tools : null, cost: r.cost ?? null };
  }
  return { node, visit, prompt: pv ? { name, header: pv.header, body: pv.body, bytes: pv.bytes } : null, entries: entriesOf(lines), report, stream: { bytes: s?.size ?? 0, cut: !!s?.cut } };
}

// ---------- routes ----------
type Who = { kind: string };
export function createCompare(o: { dataDir: string; get(id: string): Run | null | undefined; current(workflow: string): any; phoneRaw(): boolean }) {
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  async function handle(url: URL, who: Who, writing: boolean): Promise<Response | null> {
    const m = /^\/api\/tasks\/([^/]+)\/compare(?:\/([^/]*)\/([^/]*))?\/?$/.exec(url.pathname);
    if (!m) return null;
    if (writing) return json({ error: "read only" }, 405);
    let id: string, node: string | undefined, visit: string | undefined;
    try { [id, node, visit] = [m[1], m[2], m[3]].map((x) => (x === undefined ? undefined : decodeURIComponent(x))) as any; } catch { return json({ error: "bad name" }, 400); }
    if (!TASK_ID.test(id)) return json({ error: "bad task id" }, 400);
    const run = o.get(id);
    if (!run) return json({ error: "no such task" }, 404);
    let current: any = null; try { current = o.current(run.workflow); } catch {}
    const plan = comparePlan(run, current);
    if (node === undefined) return json(plan);
    if (!NODE.test(node) || !VISIT.test(visit ?? "")) return json({ error: "bad name" }, 400);
    // only an agent Round of this Task: its node and visit name a step the engine recorded
    const side = plan.rounds.find((r) => r.node === node && r.visit === Number(visit));
    if (!side) return json({ error: "no such agent round in this task" }, 404);
    const v = readSide(o.dataDir, run.id, node, side.visit);
    if (who.kind === "phone" && !o.phoneRaw())
      return json({ ...side, phone: true, prompt: null, entries: [], report: v.report ? { status: v.report.status, tools: v.report.tools } : null,
        summary: { entries: v.entries.length, tools: v.entries.filter((e) => e.kind === "tool").length, bytes: v.stream.bytes } });
    return json({ ...side, ...v });
  }
  return { handle };
}
