// Versioned workflow definitions for Studio's own runtime (v2).
//   workflows/v2/<id>.wf.yaml           the built-in definitions (seeded as v1 on first start)
//   data/workflows/<id>/v<N>.json       every saved version; a version never changes once written
//   data/workflows/<id>/layout-v<N>.json  node positions dragged in the editor (per version, not a new version)
// Editing a workflow writes v(N+1) with a diff against v(N). A run pins the
// version it started on and keeps a copy of that definition in its own folder,
// so later edits never change a running run.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {withLock} from "../ids";
import {Ledger} from "./checks";
import { bundledList, bundledText, parseYaml } from "../bundled";
import { compareProblem } from "../compare";

export const NODE_KINDS = ["agent", "check", "card", "loop", "hook"] as const; // a closed set (architecture §3.1)
export type NodeKind = (typeof NODE_KINDS)[number];
export type CheckRef = { use: string; params?: Record<string, any>; blocking?: boolean; quorum?: { n: number; of: number }; proves?: number[]; prompt?: string; model?: string; provider?: string;
  /** a judged check's duty skills, pinned like a node's: its judge turns load them after the role skill */
  skills?: { id: string; v: number; sha256: string; filesSha256?: string }[] };
/** Hook actions that run a model turn of their own (the pull request text, the image request): such a hook may pin skills too. */
export const MODEL_HOOK_ACTIONS = ["pr.open", "image.generate"] as const;
export const pinsSkills = (n: Pick<WNode, "kind" | "do">) => n.kind === "agent" || n.kind === "loop" || (n.kind === "hook" && (MODEL_HOOK_ACTIONS as readonly string[]).includes(String(n.do)));
export type GateSpec = { id: string; label?: string; builtin?: string; run?: string[]; args?: Record<string, any>; when?: { door?: string[] }; timeout_s?: number };
export type CardSpec = { title?: string | { en: string; "zh-TW"?: string }; body?: string | { en: string; "zh-TW"?: string }; auto_option?: string;
  /** the context key a door node stored its result in; the card declares that door (one-way cards need the confirmation) */
  door_from?: string; options?: { id: string; label: string }[]; confirm_door?: boolean; effects?: Record<string, { node: string; add: number }> };
export type WNode = {
  id: string; kind: NodeKind; label: string; x: number; y: number; detail?: string;
  role?: string; mode?: string; provider?: string; model?: string; effort?: string; skill?: string;
  gates?: GateSpec[]; checks?: CheckRef[]; do?: string; args?: Record<string, any>; card?: CardSpec;
  max_visits?: number; retries?: number; timeout_s?: number; join?: "any" | "all"; lane?: string;
  /** lifecycle points this node marks when it finishes (after_round, after_merge …): the workflow's hooks at those points run */
  lifecycle?: string[];
  /** the captain's intent lines (numbers) this node serves (readiness gate stage 1) */
  serves?: number[];
  /** an agent or loop node's enabled skills, in order, each pinned by version and hash (unit agent-skills); filesSha256 pins the version's
   *  other files too (a pin without it takes the library's). A skill's scripts run only through Studio's skill_run, once approved */
  skills?: { id: string; v: number; sha256: string; filesSha256?: string }[];
  /** the team seat this node runs as when it is not its role's (web-prototype design-b: alt-maker; docs/design/crew-seats.md) */
  seat?: string;
};
export type WEdge = { from: string; to: string; when?: string; checks?: CheckRef[] };
/** A role's defaults: its skill, and the provider, model and reasoning effort its nodes run on unless a node (or approved staffing) says otherwise.
 *  skills: several named skills (a shared contract, then a domain profile), in order; normalize() then sets skill to their joined ref,
 *  the one text the role receives, versions and pins. */
export type WRole = { id: string; label: string; skill: string; skills?: string[]; provider?: string; model?: string; effort?: string;
  /** the team seat its nodes run as (docs/design/crew-seats.md) */
  seat?: string };
/** The team's built-in seats; a workflow declares any specialist seat it needs in seats (src/domain/crew.ts). */
export const TEAM_SEATS = ["coordinator", "maker", "alt-maker", "reviewer", "design-reviewer"] as const;
export type SeatDecl = { id: string; label: string; labelZh: string; reviews?: string; needs?: string[]; suggest?: { provider?: "codex" | "claude"; model?: string; effort?: string | null } };
/** The separator of a role's joined skill ref. */
export const ROLE_SKILL_JOIN = "+";
/** A role skill ref's named parts, in order (one part for a plain ref). */
export const roleSkillParts = (ref: string | undefined | null): string[] => (typeof ref === "string" && ref ? ref.split(ROLE_SKILL_JOIN) : []);
/** A joined ref's text: each named skill's text in the listed order (the contract first, then the profile). */
export const roleSkillJoin = (ref: string, one: (part: string) => string): string => { const parts = roleSkillParts(ref); return parts.length > 1 ? parts.map((p) => one(p).trim()).join("\n\n") + "\n" : one(ref); };
export type WDef = {
  id: string; name: string; version: number; description?: string; kind?: string;
  intent?: { keywords?: string[]; examples?: string[] };
  /** the captain's own goals as numbered lines, each with what "done" means (a drafted workflow; readiness gate stage 1) */
  intents?: { n: number; text: string; done: string; assumption?: string }[];
  /** the small sample input the readiness gate's dry run and verification run use */
  sample?: { text?: string; params?: Record<string, string> };
  params?: Record<string, { label: string; labelZh?: string; required?: boolean; default?: string; /** a failure card's Edit params checks values against these */ options?: string[]; pattern?: string; max_length?: number }>;
  roles: WRole[]; nodes: WNode[]; edges: WEdge[];
  /** the specialist team seats this workflow needs besides the built-in ones */
  seats?: SeatDecl[];
  /** role pairs whose rounds the Task page compares side by side, k-th round with k-th round (src/compare.ts) */
  compare?: [string, string][];
  isTemplate?: boolean;
  templateSource?: {workflow:string;version:number;sha256:string};
  policies?: Record<string, any>; card_checks?: string[]; hooks?: { at: string; use: string; params?: Record<string, any> }[];
  parent?: number | null; createdAt?: string; by?: string; note?: string | null; diff?: DefDiff | null; seed?: string | null;
  /** the captain's own workflow: where v1 came from (a Firstmate draft or the free starter); kept by every later version, never set by an edit */
  origin?: { schema: 1; source: "firstmate-draft" | "starter"; draft?: string; revision?: number; definition?: string; brief?: { goal: string; interview: { question: string; answer: string }[] } };
};
export type DefDiff = {
  nodesAdded: string[]; nodesRemoved: string[]; nodesChanged: { id: string; fields: string[] }[]; nodesMoved: string[];
  edgesAdded: string[]; edgesRemoved: string[]; edgesChanged: string[]; meta: string[];
  /** agent nodes whose enabled skills changed: the list before and after, as name@vN in order */
  skills?: { node: string; before: string[]; after: string[] }[];
};
/** What a skill pin is checked against: the library's record of that version (null when it has none). */
export type SkillInfo = (id: string, v: number) => { sha256: string; filesSha256?: string; bytes: number } | null;
/** The skill library as Firstmate chooses from it: each skill's current version, what it is for and where it fits. */
export type SkillCatalogue = () => { id: string; current: number; sha256: string; description: string; fits: { kinds?: string[]; roles?: string[]; formats?: string[] } | null }[];
export const SKILL_NODE_CAP = 96 * 1024; // the enabled skills' text on one agent node (src/skills.ts SKILL_CAPS.node)
/** The one size format for skill text, in the server's messages and in the page (public/skills.js keeps the same rule):
 *  under 1 KB in bytes, under 10 KB with one decimal, else whole KB. "120 KB", "5.7 KB", "19 B". */
export const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 10 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${Math.round(n / 1024)} KB`);
const pinName = (p: any) => `${p?.id}@v${p?.v}`;
export type Problem = { level: "error" | "warn"; node?: string; edge?: string; text: string };

const ekey = (e: WEdge) => `${e.from}→${e.to}${e.when ? `[${e.when}]` : ""}`;
const now = () => new Date().toISOString();

/** YAML edges may be [from, to, when?] or {from, to, when}; nodes get defaults. */
export function normalize(raw: any): WDef {
  // a role that names skills gets their joined ref as its skill; one that also names a different skill is refused by validate()
  const joined = (r: any) => Array.isArray(r?.skills) && r.skills.length && r.skills.every((x: any) => typeof x === "string") && r.skill == null ? { ...r, skill: r.skills.join(ROLE_SKILL_JOIN) } : r;
  const d: WDef = { ...raw, version: Number(raw?.version ?? 1), roles: Array.isArray(raw?.roles) ? raw.roles.map(joined) : [], nodes: [], edges: [] };
  d.nodes = (Array.isArray(raw?.nodes) ? raw.nodes : []).map((n: any) => ({ ...n, id: String(n.id), kind: String(n.kind ?? "action"), label: String(n.label ?? n.id), x: Number(n.x ?? 0), y: Number(n.y ?? 0) }));
  const refs = (v: any) => (Array.isArray(v) ? v.filter((c: any) => c && typeof c.use === "string").map((c: any) => ({ ...c })) : undefined);
  d.edges = (Array.isArray(raw?.edges) ? raw.edges : []).map((e: any) => Array.isArray(e) ? { from: String(e[0]), to: String(e[1]), ...(e[2] ? { when: String(e[2]) } : {}), ...(e[3]?.checks ? { checks: refs(e[3].checks) } : {}) }
    : { from: String(e.from), to: String(e.to), ...(e.when ? { when: String(e.when) } : {}), ...(e.checks?.length ? { checks: refs(e.checks) } : {}) });
  for (const n of d.nodes) if (n.checks) n.checks = refs(n.checks);
  return d;
}

/** A definition's content without its version record (number, parent, author, note, diff, seed): what a built-in internal
 *  workflow is bound by. Studio's seed stores a changed built-in as a new version, so the number is never part of the binding. */
export const defBody = (d: any) => { const { parent, createdAt, by, note, diff, seed, version, ...rest } = d ?? {}; return rest; };
/** The newest installed version of a built-in internal workflow whose content is the bundled source's; null when none is. */
export function installedSource(defs: { versions(id: string): WDef[] }, source: WDef, same: (a: unknown, b: unknown) => boolean): WDef | null {
  return [...defs.versions(source.id)].reverse().find((v) => same(defBody(v), defBody(source))) ?? null;
}
/** The entry: the one node no edge leads to. */
export const entryOf = (d: WDef) => { const ins = new Set(d.edges.map((e) => e.to)); const c = d.nodes.filter((n) => !ins.has(n.id)); return c.length === 1 ? c[0] : null; };
/** Terminals: nodes no edge leaves; finishing one ends the run. */
export const terminalsOf = (d: WDef) => { const outs = new Set(d.edges.map((e) => e.from)); return d.nodes.filter((n) => !outs.has(n.id)); };

/** Problems that stop a definition from being saved (errors) or that the editor shows (warnings). */
/** A list of skill pins (a node's, or a judged check's): each {id, v, sha256} once, in the library at that hash, within the node cap. */
function checkPins(out: Problem[], node: string, label: string, pins: unknown, skillInfo?: SkillInfo) {
  if (!Array.isArray(pins)) { out.push({ level: "error", node, text: `${label}: skills is an ordered list of {id, v, sha256}` }); return; }
  let total = 0; const seen = new Set<string>();
  for (const p of pins as any[]) {
    if (!p || typeof p.id !== "string" || !Number.isInteger(Number(p.v)) || typeof p.sha256 !== "string") { out.push({ level: "error", node, text: `${label}: each skill is pinned as {id, v, sha256}` }); continue; }
    if (seen.has(p.id)) out.push({ level: "error", node, text: `${label}: ${p.id} is enabled twice` }); seen.add(p.id);
    if (!skillInfo) continue;
    const info = skillInfo(p.id, Number(p.v));
    if (!info) out.push({ level: "error", node, text: `${label}: no skill ${p.id} v${p.v} in the library` });
    else if (info.sha256 !== p.sha256) out.push({ level: "error", node, text: `${label}: ${p.id} v${p.v}: the hash does not match the stored version` });
    else if (p.filesSha256 !== undefined && p.filesSha256 !== info.filesSha256) out.push({ level: "error", node, text: `${label}: ${p.id} v${p.v}: the files hash does not match the stored version` });
    else total += info.bytes;
  }
  if (total > SKILL_NODE_CAP) out.push({ level: "error", node, text: `${node}: the enabled skills total ${fmtSize(total)}; the cap is ${fmtSize(SKILL_NODE_CAP)}` });
}
export function validate(d: WDef, known?: (ref: string) => boolean, runners?: Set<string>, skillInfo?: SkillInfo): Problem[] {
  const out: Problem[] = [];
  const ids = new Set<string>();
  const terms = new Set(terminalsOf(d).map((n) => n.id));
  for (const n of d.nodes) {
    if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(n.id)) out.push({ level: "error", node: n.id, text: `node id "${n.id}": lowercase letters, digits and dashes` });
    if (ids.has(n.id)) out.push({ level: "error", node: n.id, text: `two nodes are called ${n.id}` });
    ids.add(n.id);
    if (!(NODE_KINDS as readonly string[]).includes(n.kind)) out.push({ level: "error", node: n.id, text: `${n.id}: unknown kind ${n.kind} (agent, check, card, loop or hook)` });
    else if (runners && !runners.has(n.kind)) out.push({ level: "error", node: n.id, text: `${n.label}: no runner for the ${n.kind} kind` });
    if (n.kind === "check" && !(n.checks?.length)) out.push({ level: "error", node: n.id, text: `${n.label}: a check node needs at least one check attached` });
    if (n.kind === "hook" && !n.do && !(n.checks?.length) && !terms.has(n.id)) out.push({ level: "error", node: n.id, text: `${n.label}: a hook names its action (do) or attaches hook checks` });
    if (n.kind === "agent" && !n.role) out.push({ level: "error", node: n.id, text: `${n.label}: an agent node needs a role` });
    if (n.kind === "agent" && n.role && !d.roles.some((r) => r.id === n.role)) out.push({ level: "error", node: n.id, text: `${n.label}: no role ${n.role} in this workflow` });
    if (n.kind === "agent" && !n.mode) out.push({ level: "error", node: n.id, text: `${n.label}: an agent node names its mode` });
    if (n.kind === "loop" && !n.args?.producer) out.push({ level: "error", node: n.id, text: `${n.label}: a loop names its producer node (args.producer)` });
    if (n.kind === "loop" && n.args?.producer && !d.nodes.some((m) => m.id === n.args!.producer)) out.push({ level: "error", node: n.id, text: `${n.label}: no producer node ${n.args.producer}` });
    if (n.max_visits != null && !(Number(n.max_visits) >= 1)) out.push({ level: "error", node: n.id, text: `${n.label}: max_visits must be 1 or more` });
    for (const c of n.checks ?? []) if (known && !known(c.use)) out.push({ level: "error", node: n.id, text: `${n.label}: no check ${c.use}` });
    if (n.skills != null) {
      if (!pinsSkills(n)) out.push({ level: "error", node: n.id, text: `${n.label}: only an agent or loop node, or a hook that runs a model turn (${MODEL_HOOK_ACTIONS.join(", ")}), enables skills` });
      else checkPins(out, n.id, n.label, n.skills, skillInfo);
    }
    for (const c of n.checks ?? []) if (c?.skills != null) checkPins(out, n.id, `${n.label} · ${c.use}`, c.skills, skillInfo);
  }
  // team seats: a role's or node's seat is a built-in seat or one this workflow declares (docs/design/crew-seats.md)
  const declared = Array.isArray(d.seats) ? d.seats : d.seats == null ? [] : (out.push({ level: "error", text: "seats is a list of {id, label, labelZh}" }), []);
  for (const s of declared) if (!s || typeof s.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,40}$/.test(s.id) || (TEAM_SEATS as readonly string[]).includes(s.id) || typeof s.label !== "string" || !s.label.trim() || typeof s.labelZh !== "string" || !s.labelZh.trim() || (s.needs != null && (!Array.isArray(s.needs) || s.needs.some((x: any) => typeof x !== "string"))))
    out.push({ level: "error", text: `seat ${s?.id ?? "?"}: a specialist seat has its own id (not ${TEAM_SEATS.join(", ")}), a label, a labelZh, and needs as a list of capability tags` });
  const seatOk = (x: unknown) => typeof x === "string" && ((TEAM_SEATS as readonly string[]).includes(x) || declared.some((s) => s?.id === x));
  for (const r of d.roles) if (r.seat != null && !seatOk(r.seat)) out.push({ level: "error", text: `role ${r.id}: seat ${r.seat} is not a team seat (${TEAM_SEATS.join(", ")}) or one this workflow declares in seats` });
  for (const n of d.nodes) if (n.seat != null && (!seatOk(n.seat) || (n.kind !== "agent" && n.kind !== "loop"))) out.push({ level: "error", node: n.id, text: `${n.label}: seat ${n.seat} is not a team seat (${TEAM_SEATS.join(", ")}) or one this workflow declares, or the node is not an agent or loop` });
  for (const r of d.roles) if (r.skills != null && (!Array.isArray(r.skills) || !r.skills.length || r.skills.some((x: any) => typeof x !== "string" || !x || x.includes(ROLE_SKILL_JOIN)) || new Set(r.skills).size !== r.skills.length))
    out.push({ level: "error", text: `role ${r.id}: skills is an ordered list of distinct skill refs` });
  else if (r.skills != null && r.skill !== r.skills.join(ROLE_SKILL_JOIN)) out.push({ level: "error", text: `role ${r.id}: name its skill once, as skill or as skills, not both` });
  for (const e of d.edges) for (const c of e.checks ?? []) if (c?.skills != null) checkPins(out, e.to, `${e.from} → ${e.to} · ${c.use}`, c.skills, skillInfo);
  for (const e of d.edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) out.push({ level: "error", edge: ekey(e), text: `edge ${ekey(e)} names a node that does not exist` });
    for (const c of e.checks ?? []) if (known && !known(c.use)) out.push({ level: "error", edge: ekey(e), text: `edge ${ekey(e)}: no check ${c.use}` });
  }
  { const c = compareProblem((d as any).compare, d.roles); if (c) out.push({ level: "error", text: c }); }
  const ins = new Set(d.edges.map((e) => e.to));
  const entries = d.nodes.filter((n) => !ins.has(n.id));
  if (entries.length !== 1) out.push({ level: "error", text: entries.length ? `a workflow has exactly one entry (a node no edge leads to); this one has ${entries.length}: ${entries.map((n) => n.label).join(", ")}` : "a workflow needs an entry: a node no edge leads to" });
  if (!terms.size) out.push({ level: "error", text: "a workflow needs an end: a node no edge leaves" });
  const outs = (id: string) => d.edges.filter((e) => e.from === id).map((e) => e.to);
  if (entries.length === 1) {
    const seen = new Set<string>([entries[0].id]); const q = [entries[0].id];
    while (q.length) for (const t of outs(q.shift()!)) if (!seen.has(t)) { seen.add(t); q.push(t); }
    for (const n of d.nodes) if (!seen.has(n.id)) out.push({ level: "error", node: n.id, text: `${n.label} is an orphan: no path from the entry reaches it` });
    if (terms.size && ![...terms].some((t) => seen.has(t))) out.push({ level: "error", text: "no end is reachable from the entry" });
  }
  const canEnd = new Set(terms); let grew = true;
  while (grew) { grew = false; for (const n of d.nodes) if (!canEnd.has(n.id) && outs(n.id).some((t) => canEnd.has(t))) { canEnd.add(n.id); grew = true; } }
  for (const n of d.nodes) if (!canEnd.has(n.id) && ids.has(n.id)) out.push({ level: "error", node: n.id, text: `${n.label}: no path from here reaches an end` });
  // Firstmate decides first only on escalation cards (step-back, round budget, scope), never on a card that acts, a mode, or a door
  for (const n of d.nodes) if (n.args?.firstmate_first) {
    const kind = n.args?.card_kind ?? "question";
    if (n.kind !== "card" || !["step-back", "round-budget", "scope"].includes(kind) || n.do || n.args?.mode || (n.card as any)?.confirm_door || (n.card as any)?.door_from)
      out.push({ level: "error", node: n.id, text: `${n.label}: firstmate_first is only for a step-back, round-budget or scope card with no action, mode or door` });
  }
  // an acceptance card needs a readiness check on the way to it: without one it can only say "Proved by checks: None" (R-047)
  for (const n of d.nodes) if (n.kind === "card" && n.args?.mode === "deliver-accept") {
    const seen = new Set<string>([n.id]); const q = [n.id]; let checked = false;
    while (q.length && !checked) { const at = q.shift()!; for (const e of d.edges.filter((e) => e.to === at)) { const m = d.nodes.find((x) => x.id === e.from); if (!m || seen.has(m.id)) continue; seen.add(m.id); if (m.kind === "check" && m.checks?.length) { checked = true; break; } q.push(m.id); } }
    if (!checked) out.push({ level: "error", node: n.id, text: `${n.label}: an acceptance card needs a readiness check node before it, so its card can say what the checks proved` });
  }
  for (const n of d.nodes) if (n.join === "all" && d.edges.filter((e) => e.to === n.id).length < 2) out.push({ level: "warn", node: n.id, text: `${n.label} waits for all inputs but has only one` });
  return out;
}

const FIELDS: (keyof WNode)[] = ["kind", "label", "detail", "role", "seat", "mode", "provider", "model", "effort", "skill", "skills", "gates", "checks", "lifecycle", "do", "args", "card", "max_visits", "retries", "timeout_s", "join", "lane", "serves"];
export function diff(a: WDef, b: WDef): DefDiff {
  const an = new Map(a.nodes.map((n) => [n.id, n])), bn = new Map(b.nodes.map((n) => [n.id, n]));
  const ae = new Set(a.edges.map(ekey)), be = new Set(b.edges.map(ekey));
  const changed: { id: string; fields: string[] }[] = []; const moved: string[] = [];
  for (const [id, n] of bn) { const o = an.get(id); if (!o) continue;
    const f = FIELDS.filter((k) => JSON.stringify(o[k] ?? null) !== JSON.stringify(n[k] ?? null)) as string[];
    if (f.length) changed.push({ id, fields: f });
    if (Math.round(o.x) !== Math.round(n.x) || Math.round(o.y) !== Math.round(n.y)) moved.push(id); }
  const ac = new Map(a.edges.map((e) => [ekey(e), JSON.stringify(e.checks ?? [])]));
  const edgesChanged = b.edges.filter((e) => ac.has(ekey(e)) && ac.get(ekey(e)) !== JSON.stringify(e.checks ?? [])).map(ekey);
  const meta = (["name", "description", "roles", "seats", "params", "intent", "intents", "sample", "policies", "hooks", "card_checks"] as const).filter((k) => JSON.stringify((a as any)[k] ?? null) !== JSON.stringify((b as any)[k] ?? null));
  const skills: { node: string; before: string[]; after: string[] }[] = [];
  for (const [id, n] of bn) { const before = (an.get(id)?.skills ?? []).map(pinName), after = (n.skills ?? []).map(pinName);
    if (JSON.stringify(before) !== JSON.stringify(after)) skills.push({ node: id, before, after }); }
  return { nodesAdded: [...bn.keys()].filter((k) => !an.has(k)), nodesRemoved: [...an.keys()].filter((k) => !bn.has(k)), nodesChanged: changed, nodesMoved: moved,
    edgesAdded: [...be].filter((k) => !ae.has(k)), edgesRemoved: [...ae].filter((k) => !be.has(k)), edgesChanged, meta, ...(skills.length ? { skills } : {}) };
}
export const diffEmpty = (d: DefDiff) => !d.nodesAdded.length && !d.nodesRemoved.length && !d.nodesChanged.length && !d.nodesMoved.length && !d.edgesAdded.length && !d.edgesRemoved.length && !(d.edgesChanged ?? []).length && !d.meta.length;

const RETIRED_DEFAULTS=new Set(["refine-demo","trivial-lane"]);
const INTERNAL_WORKFLOWS=new Set(["firstmate-proposal","firstmate-register-project","firstmate-staffing","firstmate-connect-github","firstmate-grant-merge","crew-change"]);
/** Kept and editable, but no new Task starts until its runtime is activated. The reason is shown in the catalog. */
const HELD_REASON={en:"held: GitHub review does not run end to end until it is rebuilt from code-firstmate",zh:"暫停：GitHub 審查改由 code-firstmate 重建前無法端到端執行"};
/**
 * Examples: shipped but not seeded on a fresh install (CREW_EXAMPLE_WORKFLOWS=1 seeds them). The startup competition
 * (docs/units/startup-recursion.md) is a two-vendor demonstration, not a starting point a new captain needs. An install
 * that already has it keeps it, startable, and receives built-in updates of it while the captain has not edited it.
 */
const EXAMPLE_DEFAULTS=new Set(["startup-recursion"]);
const examplesOn=()=>process.env.CREW_EXAMPLE_WORKFLOWS==="1";
function defaultDefinitions(){return [...bundledList("workflows/v2/"),...bundledList("packs/")].filter(f=>f.endsWith(".wf.yaml")).map(f=>bundledText(f)??"").filter(text=>{if(!text.trim())return false;const id=normalize(parseYaml(text)).id;return !RETIRED_DEFAULTS.has(id);});}

export class WorkflowDefs {
  readonly dir: string;
  /** the skill library's record of a pinned version (set by the runtime): saves check every pin and the per-node cap against it */
  skillInfo: SkillInfo | null = null;
  /** the library itself (set by the runtime): Firstmate drafts and configures node skills by id from it */
  skillLibrary: SkillCatalogue | null = null;
  /** the Studio team's resolution of a definition (set by the runtime): a captain's own workflow confirms exactly what will run */
  ownCrew: ((def: WDef) => any) | null = null;
  constructor(readonly dataDir: string, readonly bundled = defaultDefinitions, public known?: (ref: string) => boolean, public runners?: () => Set<string>) {
    this.dir = join(dataDir, "workflows"); mkdirSync(this.dir, { recursive: true });
    this.seed();
  }
  private wdir(id: string) { if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(id)) throw new Error(`bad workflow id ${id}`); return join(this.dir, id); }
  /** Built-ins become v1; a changed built-in becomes a new version only while nobody has edited that workflow. */
  private seed() {
    for (const text of this.bundled()) {
      if (!text.trim()) continue;
      const d = normalize(parseYaml(text)); const hash = createHash("sha256").update(text).digest("hex").slice(0, 16);
      const vs = this.versions(d.id);
      // an example is seeded only when asked; once installed it gets built-in updates like any default (an edited copy is kept)
      if (!vs.length && EXAMPLE_DEFAULTS.has(d.id) && this.bundled === defaultDefinitions && !examplesOn()) continue;
      if (!vs.length) { this.write({ ...d, version: 1, parent: null, createdAt: now(), by: "studio (built-in)", note: "built-in", diff: null, seed: hash }); continue; }
      const last = vs.at(-1)!;
      if (last.seed && last.seed !== hash && last.by?.startsWith("studio (built-in")) this.write({ ...d, version: last.version + 1, parent: last.version, createdAt: now(), by: "studio (built-in update)", note: "the built-in definition changed", diff: diff(last, d), seed: hash });
    }
  }
  private write(d: WDef) {
    mkdirSync(this.wdir(d.id), { recursive: true });
    const f = join(this.wdir(d.id), `v${d.version}.json`);
    if (existsSync(f)) throw new Error(`${d.id} v${d.version} exists`);
    writeFileSync(f + ".tmp", JSON.stringify(d, null, 1)); renameSync(f + ".tmp", f);
  }
  /** Native pack installer only: caller must verify the canonical signed file pin first.
   *  Definitions are appended; existing pinned Tasks and built-in versions never change. */
  importPinned(raw: any, pin: { hash: string; verify: () => boolean }): WDef {
    if (!/^[a-f0-9]{64}$/.test(pin.hash) || !pin.verify()) throw new Error("pack provenance is not verified");
    const d = normalize(raw); const errors = validate(d, this.known, this.runners?.(), this.skillInfo ?? undefined).filter(p => p.level === "error");
    if (errors.length) throw new Error(errors[0].text);
    const versions = this.versions(d.id), previous = versions.at(-1);
    if (previous) { if ((previous as any).packPin?.hash !== pin.hash || JSON.stringify(previous.nodes) !== JSON.stringify(d.nodes) || JSON.stringify(previous.edges) !== JSON.stringify(d.edges)) throw new Error("a pinned pack definition cannot be overwritten"); return previous; }
    const next = { ...d, version: 1, parent: null, createdAt: now(), by: "studio (verified pack)", note: pin.hash, diff: null };
    this.write(next); return next;
  }
  ids(): string[] { return existsSync(this.dir) ? readdirSync(this.dir).filter((d) => /^[a-z0-9][a-z0-9-]*$/.test(d)).sort() : []; }
  versions(id: string): WDef[] {
    const d = this.wdir(id); if (!existsSync(d)) return [];
    return readdirSync(d).filter((f) => /^v\d+\.json$/.test(f)).map((f) => JSON.parse(readFileSync(join(d, f), "utf8")) as WDef).sort((a, b) => a.version - b.version);
  }
  /** One version (latest when v is omitted), with its saved layout applied. */
  get(id: string, v?: number): WDef | null {
    const vs = this.versions(id); const d = v ? vs.find((x) => x.version === v) : vs.at(-1); if (!d) return null;
    const lay = this.layout(id, d.version);
    return { ...d, nodes: d.nodes.map((n) => (lay[n.id] ? { ...n, x: lay[n.id].x, y: lay[n.id].y } : n)) };
  }
  /** Recoverable catalog state. Version files and pinned Task definitions stay intact. */
  trashState(id:string):{schema:1;workflow:string;version:number;revision:number;deleted:boolean;by:string;at:string}|null {
    const file=join(this.wdir(id),'trash.json');if(!existsSync(file))return null;
    const state=JSON.parse(readFileSync(file,'utf8'));
    if(state.schema!==1||state.workflow!==id||!Number.isSafeInteger(state.revision)||state.revision<1||!Number.isSafeInteger(state.version)||typeof state.deleted!=='boolean')throw new Error('Workflow trash state is invalid');
    return state;
  }
  personal(id:string){const d=this.get(id);return !!d&&!INTERNAL_WORKFLOWS.has(id)&&!!d.origin&&['starter','firstmate-draft'].includes(d.origin.source);}
  trashed(id:string){return this.trashState(id)?.deleted===true;}
  setTrash(id:string,base:unknown,revision:unknown,deleted:boolean,by:string){
    return withLock(this.dir,'create-'+id,()=>{
      const def=this.get(id),state=this.trashState(id);
      if(!def||!this.personal(id))throw new Error('Only personal workflows can move to or from Trash');
      if(!Number.isSafeInteger(base)||base!==def.version||!Number.isSafeInteger(revision)||revision!==(state?.revision??0))throw new Error('Workflow changed; reload before changing Trash');
      if((state?.deleted??false)===deleted)throw new Error(deleted?'Workflow is already in Trash':'Workflow is not in Trash');
      const next={schema:1 as const,workflow:id,version:def.version,revision:(state?.revision??0)+1,deleted,by,at:now()};
      const file=join(this.wdir(id),'trash.json');writeFileSync(file+'.tmp',JSON.stringify(next));renameSync(file+'.tmp',file);return next;
    });
  }
  trashCatalog(){return this.list().filter(w=>this.trashed(w.id));}
  /** Exact versions remain readable for pinned Tasks; only public choices enter a new dispatch. */
  selectable(id:string,version?:number){const d=this.get(id,version);return !!d&&!this.trashed(id)&&!INTERNAL_WORKFLOWS.has(id)&&!(RETIRED_DEFAULTS.has(id)&&!!d.seed&&!!d.by?.startsWith("studio (built-in"))&&!this.held(id);}
  /** Why a kept workflow cannot start a Task yet (the GitHub review template and copies of it), or null. */
  held(id:string):{en:string;zh:string}|null{return this.versions(id).length&&this.previewOnly(id)?HELD_REASON:null;}
  catalog(){return this.list().filter(w=>this.selectable(w.id,w.version));}
  /** Workflows kept in the catalog for editing that the Start form and start routes do not offer. */
  heldCatalog(){return this.list().filter(w=>!INTERNAL_WORKFLOWS.has(w.id)&&!this.trashed(w.id)&&!!this.held(w.id)).map(w=>({...w,held:this.held(w.id)!}));}
  list() { return this.ids().map((id) => { const vs = this.versions(id); const l = vs.at(-1)!; return { id, name: l.name, description: l.description ?? "", kind: l.kind ?? null, isTemplate: l.isTemplate === true, version: l.version, versions: vs.length, nodes: l.nodes.length, intent: l.intent ?? null, params: l.params ?? null, personal:this.personal(id), trashRevision:this.trashState(id)?.revision??0 }; }); }
  layout(id: string, v: number): Record<string, { x: number; y: number }> { try { return JSON.parse(readFileSync(join(this.wdir(id), `layout-v${v}.json`), "utf8")); } catch { return {}; } }
  /** Dragging nodes: positions are kept per version without making a new one. */
  setLayout(id: string, v: number, pos: Record<string, { x: number; y: number }>) {
    const d = this.versions(id).find((x) => x.version === v); if (!d) throw new Error("no such version");
    const clean: Record<string, { x: number; y: number }> = { ...this.layout(id, v) };
    for (const [k, p] of Object.entries(pos ?? {})) if (d.nodes.some((n) => n.id === k) && Number.isFinite(Number(p?.x)) && Number.isFinite(Number(p?.y))) clean[k] = { x: Math.round(Number(p.x)), y: Math.round(Number(p.y)) };
    const f = join(this.wdir(id), `layout-v${v}.json`); writeFileSync(f + ".tmp", JSON.stringify(clean)); renameSync(f + ".tmp", f);
    return clean;
  }
  /** Explicit captain-created safe starter, never arbitrary execution/import authority. */
  create(id:unknown,name:unknown,by:string,locale:unknown="en",template:unknown=undefined,origin:unknown=undefined):WDef {
    if(origin!==undefined&&(origin!=="starter"||(template!==undefined&&template!=="hello-crew-studio")))throw new Error("Unsupported workflow origin");
    if(template!==undefined&&!["coffee-kit","github-review","hello-crew-studio"].includes(String(template)))throw new Error("Unsupported workflow template");
    if(locale!=="en"&&locale!=="zh-TW"&&!(locale==="zh-CN"&&template==="coffee-kit"))throw new Error("Unsupported workflow language");
    const zh=locale==="zh-TW";
    if(typeof id!=="string"||!/^[a-z0-9][a-z0-9-]{0,40}$/.test(id))throw new Error("Use 1–41 lowercase letters, numbers or hyphens for the workflow id");
    if(typeof name!=="string"||!name.trim()||name.trim().length>120||/[\u0000-\u001f]/.test(name))throw new Error("Workflow name must contain 1–120 characters");
    return withLock(this.dir,"create-"+id,()=>{
      if(existsSync(this.wdir(id)))throw new Error("A workflow with this id already exists");
      if(template==="coffee-kit"||template==="github-review"||template==="hello-crew-studio") {
        const source=bundledText(`workflows/v2/${template}.wf.yaml`);if(!source)throw new Error("Coffee template unavailable");
        const canonical=normalize(parseYaml(source));
        if(canonical.id!==template||(template==="coffee-kit"&&canonical.kind!=="coffee-kit"))throw new Error("Coffee template identity differs");
        const definition:WDef={...canonical,id,name:name.trim(),version:1,parent:null,createdAt:now(),by,note:"Source template "+template+" SHA256 "+createHash("sha256").update(source).digest("hex"),diff:null,seed:null,...(origin==="starter"?{origin:{schema:1 as const,source:"starter" as const}}:{})};
        const errors=validate(definition,this.known,this.runners?.(),this.skillInfo??undefined).filter(p=>p.level==="error");if(errors.length)throw new Error(errors[0].text);
        if(template==='github-review'){const ledger=new Ledger(this.dataDir,'workflow-draft-'+id);ledger.add({run:'workflow-draft-'+id,node:'',edge:null,round:0,head:null,check:'draft-capability',version:'1',kind:'deterministic',record:'workflow-draft-capability',attempt:0,verdict:'warn',score:null,findings:[],evidence:[],proves:[],error:null,blocking:true,inputHash:createHash('sha256').update(source).digest('hex'),params:{},ms:0,dir:null,data:{schema:1,workflow:id,source:'github-review',capability:'preview-edit-save-only'}}as any);}
        this.write(definition);return definition;
      }
      const definition:WDef={id,name:name.trim(),version:1,description:"",roles:[],nodes:[
        {id:"start",kind:"card",label:zh?"開始":"Start",x:80,y:100,card:{title:{en:"Ready to continue?","zh-TW":"準備好繼續了嗎？"},body:{en:"This starter waits for your confirmation.","zh-TW":"此起始流程會等待你的確認。"},options:[{id:"continue",label:zh?"繼續":"Continue",labelZh:"繼續"}]}},
        {id:"done",kind:"hook",label:zh?"完成":"Done",x:340,y:100}],edges:[{from:"start",to:"done",when:"continue"}],parent:null,createdAt:now(),by,note:null,diff:null,seed:null,...(origin==="starter"?{origin:{schema:1 as const,source:"starter" as const}}:{})};
      const errors=validate(definition,this.known,this.runners?.(),this.skillInfo??undefined).filter(p=>p.level==="error");if(errors.length)throw new Error(errors[0].text);
      this.write(definition);return definition;
    });
  }
  /** A reviewed Firstmate draft becomes the captain's own workflow v1. The caller validated the drafting vocabulary. */
  createDrafted(id:string,draft:WDef,by:string,origin:NonNullable<WDef["origin"]>):WDef {
    if(!/^[a-z0-9][a-z0-9-]{0,40}$/.test(id))throw new Error("bad workflow id");
    return withLock(this.dir,"create-"+id,()=>{
      if(existsSync(this.wdir(id)))throw new Error("A workflow with this id already exists");
      const definition:WDef={...normalize(draft),id,version:1,parent:null,createdAt:now(),by,note:"Saved from Firstmate draft "+origin.draft,diff:null,seed:null,origin};
      const errors=validate(definition,this.known,this.runners?.(),this.skillInfo??undefined).filter(p=>p.level==="error");if(errors.length)throw new Error(errors[0].text);
      this.write(definition);return definition;
    });
  }
  /** A template is a new definition, never a task, approval or live artifact copy. */
  copyTemplate(source:string,version:number,id:string,name:string,asTemplate:boolean,by:string):WDef {
    if(!/^[a-z0-9][a-z0-9-]{0,40}$/.test(id)||typeof name!=='string'||!name.trim()||name.trim().length>120||/[\x00-\x1f\x7f]/.test(name)||!Number.isSafeInteger(version)||version<1||typeof asTemplate!=='boolean')throw new Error('Invalid template identity or exact version');
    return withLock(this.dir,'create-'+id,()=>{
      if(existsSync(this.wdir(id)))throw new Error('A workflow with this id already exists');
      const saved=this.get(source,version);if(!saved?.origin||this.previewOnly(source)||!this.selectable(source,version))throw new Error('Choose an available personal workflow');
      const canonical=this.versions(source).find(v=>v.version===version)!;
      const def:WDef={...structuredClone(saved),id,name:name.trim(),version:1,parent:null,createdAt:now(),by,note:`Copied from ${source} v${version}`,diff:null,seed:null,origin:{schema:1,source:saved.origin.source,...(saved.origin.brief?{brief:structuredClone(saved.origin.brief)}:{})},isTemplate:asTemplate,templateSource:{workflow:source,version,sha256:createHash('sha256').update(JSON.stringify(canonical)).digest('hex')}};
      const errors=validate(def,this.known,this.runners?.(),this.skillInfo??undefined).filter(p=>p.level==='error');if(errors.length)throw new Error(errors[0].text);
      this.write(def);return def;
    });
  }
  /** Immutable source lineage plus a signed draft capability; editable node metadata is never authority. */
  previewOnly(id:string):boolean {const ledger=new Ledger(this.dataDir,'workflow-draft-'+id);if(existsSync(ledger.file()))return true;return id==='github-review'||this.versions(id).some(d=>d.note?.startsWith('Source template github-review SHA256 ')||d.nodes.some(n=>n.do==='github.review.wait'));}
  /** Save an edit as a new version; refused when it has errors or changes nothing. */
  save(id: string, body: any, by: string, note?: string): WDef {
    return withLock(this.dir,"create-"+id,()=>this.saveActive(id,body,by,note));
  }
  private saveActive(id: string, body: any, by: string, note?: string): WDef {
    if(this.trashed(id))throw new Error("Restore this workflow from Trash before editing");
    const prev = this.get(id); if (!prev) throw new Error("no such workflow");
    if (body?.base == null) throw new Error(`say which version you edited (base); v${prev.version} is the latest`);
    if (Number(body.base) !== prev.version) throw new Error(`v${prev.version} is the latest now (you edited v${body.base}); reload and edit again`);
    const next = normalize({ ...prev, ...body, id, version: prev.version + 1 });
    if(prev.templateSource)next.templateSource=prev.templateSource;else delete next.templateSource;
    if(prev.isTemplate!==undefined)next.isTemplate=prev.isTemplate;else delete next.isTemplate;
    if (prev.origin) next.origin = prev.origin; else delete next.origin; // lineage is never an edit
    const errs = validate(next, this.known, this.runners?.(), this.skillInfo ?? undefined).filter((p) => p.level === "error");
    if (errs.length) { const e: any = new Error(`the workflow has ${errs.length} problem${errs.length > 1 ? "s" : ""}: ${errs.map((p) => p.text).join("; ")}`); e.problems = errs; throw e; }
    const dd = diff(prev, next);
    if (diffEmpty(dd)) throw new Error("nothing changed");
    const out: WDef = { ...next, parent: prev.version, createdAt: now(), by, note: note ? String(note).slice(0, 300) : null, diff: dd, seed: null };
    for (const k of ["base", "problems"]) delete (out as any)[k];
    this.write(out);
    return out;
  }
}
