// M7 domain packs: a new way of working as data.
//   manifest.yaml  id, name, version, description, engine?, skills [{role,file}], gates, artifactTypes,
//                  workflows [paths], evals [paths], permissions, rules?
// Built-in packs ship in packs/ (embedded in the binary). Drafts (from workflow
// genesis) live in data/packs/drafts/<id>/; an installed pack is copied to
// data/packs/installed/<id>/ with lock.json pinning every file's sha256: a pack
// whose files no longer match is refused, not loaded.
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { folderTools, type Agents, type AgentTool } from "./agent";
import { bundledList, bundledText, parseYaml } from "./bundled";
import { BUILTINS } from "./gates";
import type { Evals, EvalCase, SuiteResult } from "./evals";
import type { Flow } from "./workflows";
import { normalize as nativeDef, validate as validateNativeDef } from "./runtime/defs";
import type { Provider } from "./providers";

export type Manifest = { id: string; name: string; version: string; description: string; engine?: string; skills: { role: string; file: string }[];
  gates: { id: string; builtin?: string; run?: string[]; label?: string; args?: any }[]; artifactTypes: { id: string; label: string; viewer?: string }[];
  workflows: string[]; evals: string[]; permissions: string[]; rules?: string };
export type PackSource = { kind: "builtin" | "installed" | "draft" | "published"; id: string; read: (rel: string) => string | null; files: () => string[]; dir: string | null; nativeFlows?: {id:string;name:string;nodes:number;roles:any[]}[] };
export type Validation = { ok: boolean; errors: string[]; warnings: string[] };
export type Draft = { id: string; description: string; status: "drafting" | "drafted" | "invalid" | "failed" | "installed" | "discarded"; createdAt: string; job: string | null; summary: string | null;
  validation: Validation | null; evals: SuiteResult | null; error: string | null; by: string };

const PERMS = new Set(["fs.read", "fs.write", "fs.move", "agent"]);
export const ENGINE_BUILTINS = new Set(["fileorg-inside-root", "fileorg-no-overwrite", "fileorg-max-moves", "doc-has-title", "doc-no-open-notes", "pack-valid", "pack-evals"]);
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const walk = (d: string, base = d, out: string[] = []) => { for (const f of readdirSync(d).sort()) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p, base, out); else if (!f.startsWith(".")) out.push(relative(base, p).split(sep).join("/")); } return out; };
const dirSource = (kind: PackSource["kind"], id: string, dir: string): PackSource => ({ kind, id, dir,
  read: (rel) => { const p = join(dir, rel); if (!p.startsWith(dir + sep) || !existsSync(p)) return null; try { return readFileSync(p, "utf8"); } catch { return null; } },
  files: () => (existsSync(dir) ? walk(dir) : []) });

/** Check a pack against the format: every reference resolves, every workflow and eval parses. */
export function validate(src: PackSource): Validation & { manifest: Manifest | null; flows: Flow[]; cases: (EvalCase & { file: string })[] } {
  const errors: string[] = [], warnings: string[] = [];
  const flows: Flow[] = []; const cases: any[] = [];
  let m: Manifest | null = null;
  try { m = parseYaml(src.read("manifest.yaml") ?? ""); } catch (e: any) { errors.push(`manifest.yaml does not parse: ${e?.message ?? e}`); }
  if (!m || typeof m !== "object") { if (!errors.length) errors.push("no manifest.yaml"); return { ok: false, errors, warnings, manifest: null, flows, cases }; }
  for (const k of ["id", "name", "version", "description"] as const) if (!m[k] || typeof m[k] !== "string") errors.push(`manifest: ${k} is required (text)`);
  if (m.id && !/^[a-z0-9][a-z0-9-]{1,40}$/.test(m.id)) errors.push("manifest: id must be lowercase letters, digits and dashes");
  if (m.version && !/^\d+\.\d+\.\d+$/.test(String(m.version))) errors.push("manifest: version must look like 1.0.0");
  for (const k of ["skills", "gates", "artifactTypes", "workflows", "evals", "permissions"] as const) { if (m[k] == null) (m as any)[k] = []; if (!Array.isArray(m[k])) errors.push(`manifest: ${k} must be a list`); }
  if (errors.length) return { ok: false, errors, warnings, manifest: m, flows, cases };
  if (m.engine === "native-v2") {
    const checks = (m as any).checks; if (!Array.isArray(checks) || !checks.length) errors.push("native pack needs check definitions");
    for (const skill of m.skills) if (!skill?.file || src.read(skill.file) == null) errors.push("native role skill is missing");
    for (const file of m.workflows) { try { const d = nativeDef(parseYaml(src.read(file) ?? "")); errors.push(...validateNativeDef(d).filter(p => p.level === "error").map(p => p.text)); flows.push(d as any); } catch { errors.push("native workflow does not parse"); } }
    let evalSet: any; try { evalSet = JSON.parse(src.read("eval-set.json") ?? ""); } catch { errors.push("native frozen eval set is missing"); }
    if (!evalSet?.evalHash || !Array.isArray(evalSet.samples) || !Array.isArray(evalSet.metrics)) errors.push("native publication needs frozen samples and measured metrics");
    return { ok: !errors.length, errors, warnings, manifest: m, flows, cases };
  }
  const roles = new Set<string>();
  for (const s of m.skills) { if (!s?.role || !s?.file) { errors.push("skills: each needs role and file"); continue; } roles.add(s.role); if (src.read(s.file) == null) errors.push(`skills: ${s.file} is missing`); }
  const gateOk = (g: any, where: string) => { if (!g?.id) errors.push(`${where}: a gate needs an id`); else if (g.builtin) { if (!BUILTINS[g.builtin] && !ENGINE_BUILTINS.has(g.builtin)) errors.push(`${where}: unknown builtin gate ${g.builtin}`); }
    else if (!Array.isArray(g.run) || !g.run.length) errors.push(`${where}: gate ${g.id} needs builtin or run`); else if (g.run.some((a: any) => /curl|wget|https?:/.test(String(a)))) errors.push(`${where}: gate ${g.id} reaches the network`); };
  for (const g of m.gates) gateOk(g, "gates");
  for (const t of m.artifactTypes) if (!t?.id || !t?.label) errors.push("artifactTypes: each needs id and label");
  for (const p of m.permissions) if (!PERMS.has(String(p))) errors.push(`permissions: ${p} is not allowed (allowed: ${[...PERMS].join(", ")})`);
  if (!m.workflows.length) errors.push("workflows: a pack needs at least one workflow");
  for (const wf of m.workflows) {
    const t = src.read(wf); if (t == null) { errors.push(`workflows: ${wf} is missing`); continue; }
    let f: Flow; try { f = parseYaml(t); } catch (e: any) { errors.push(`${wf} does not parse: ${e?.message ?? e}`); continue; }
    if (!f?.id || !Array.isArray(f.nodes) || !Array.isArray(f.edges)) { errors.push(`${wf}: needs id, nodes and edges`); continue; }
    const ids = new Set(f.nodes.map((n) => n.id));
    for (const n of f.nodes) { if (!n.id || !n.label || typeof n.x !== "number" || typeof n.y !== "number") errors.push(`${wf}: node ${n.id ?? "?"} needs id, label, x, y`); for (const g of n.gates ?? []) gateOk(g, `${wf} node ${n.id}`); }
    for (const e of f.edges) if (!Array.isArray(e) || !ids.has(e[0]) || !ids.has(e[1])) errors.push(`${wf}: edge ${JSON.stringify(e)} names a node that does not exist`);
    for (const r of f.roles ?? []) { const pre = `pack:${m.id}/`; if (!r.skill?.startsWith(pre)) errors.push(`${wf}: role ${r.id} skill must start with ${pre}`); else if (src.read(r.skill.slice(pre.length)) == null) errors.push(`${wf}: role ${r.id} skill ${r.skill} is missing`); }
    f.pack = m.id; f.roles ??= []; flows.push(f);
  }
  for (const ef of m.evals) {
    const t = src.read(ef); if (t == null) { errors.push(`evals: ${ef} is missing`); continue; }
    let arr: any; try { arr = JSON.parse(t); } catch (e: any) { errors.push(`${ef} is not JSON: ${e?.message ?? e}`); continue; }
    if (!Array.isArray(arr)) { errors.push(`${ef}: must be a list of cases`); continue; }
    for (const c of arr) { if (!c?.id || !c?.role || !c?.ask || !Array.isArray(c?.expect) || !c.expect.length) { errors.push(`${ef}: case ${c?.id ?? "?"} needs id, role, ask and expect`); continue; }
      try { for (const x of c.expect) new RegExp(x.pattern); } catch { errors.push(`${ef}: case ${c.id} has a bad pattern`); continue; }
      if (!roles.has(c.role)) warnings.push(`${ef}: case ${c.id} is for role ${c.role}, which has no skill`); cases.push({ ...c, file: ef }); }
  }
  for (const r of roles) if (!cases.some((c) => c.role === r)) warnings.push(`role ${r} has no eval case`);
  if (!cases.length) errors.push("evals: a pack needs at least one eval case");
  return { ok: !errors.length, errors, warnings, manifest: m, flows, cases };
}

export class Packs {
  readonly root: string;
  onChange: () => void = () => {};
  nativePublished: () => { src: PackSource; tampered: string[]; lock: any }[] = () => [];
  constructor(readonly dataDir: string) { this.root = join(dataDir, "packs"); for (const d of ["drafts", "installed"]) mkdirSync(join(this.root, d), { recursive: true }); }
  private builtins(): PackSource[] {
    const ids = [...new Set(bundledList("packs/").map((f) => f.split("/")[1]))];
    return ids.map((id) => ({ kind: "builtin" as const, id, dir: null, read: (rel: string) => bundledText(`packs/${id}/${rel}`), files: () => bundledList(`packs/${id}/`).map((f) => f.slice(`packs/${id}/`.length)) }));
  }
  installedSources(): PackSource[] { return readdirSync(join(this.root, "installed")).filter((d) => existsSync(join(this.root, "installed", d, "manifest.yaml"))).map((d) => dirSource("installed", d, join(this.root, "installed", d))); }
  /** The lock check: every file of an installed pack still has its pinned sha256. */
  verify(id: string): string[] {
    const dir = join(this.root, "installed", id);
    let lock: any; try { lock = JSON.parse(readFileSync(join(dir, "..", `${id}.lock.json`), "utf8")); } catch { return ["no lock file"]; }
    const bad: string[] = []; const files = walk(dir);
    for (const [f, h] of Object.entries(lock.files as Record<string, string>)) { const p = join(dir, f); if (!existsSync(p) || sha(readFileSync(p)) !== h) bad.push(f); }
    for (const f of files) if (!(f in lock.files)) bad.push(`${f} (not in the lock)`);
    return bad;
  }
  lock(id: string) { const native = this.nativePublished().find(p => p.src.id === id); if (native) return native.lock; try { return JSON.parse(readFileSync(join(this.root, "installed", `${id}.lock.json`), "utf8")); } catch { return null; } }
  /** Every usable pack: built-in, plus installed ones whose files match their lock. */
  active(): { src: PackSource; v: ReturnType<typeof validate>; tampered: string[] }[] {
    const out: { src: PackSource; v: ReturnType<typeof validate>; tampered: string[] }[] = [];
    for (const s of this.builtins()) out.push({ src: s, v: validate(s), tampered: [] });
    for (const s of this.installedSources()) { const t = this.verify(s.id); out.push({ src: s, v: validate(s), tampered: t }); }
    for (const p of this.nativePublished()) out.push({ src: p.src, v: validate(p.src), tampered: p.tampered });
    return out;
  }
  flows(): { flow: Flow; read: (rel: string) => string | null }[] {
    return this.active().filter((p) => p.v.ok && !p.tampered.length && p.v.manifest?.engine !== "native-v2").flatMap((p) => p.v.flows.map((flow) => ({ flow, read: (rel: string) => p.src.read(rel) })));
  }
  get(id: string) { return this.active().find((p) => p.src.id === id) ?? null; }
  draftDir(id: string) { if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(id)) throw new Error("bad pack id"); return join(this.root, "drafts", id); }
  draftSource(id: string) { return dirSource("draft", id, this.draftDir(id)); }
  drafts(): Draft[] { return readdirSync(join(this.root, "drafts")).filter((f) => f.endsWith(".json")).map((f) => { try { return JSON.parse(readFileSync(join(this.root, "drafts", f), "utf8")); } catch { return null; } }).filter(Boolean)
    .sort((a: Draft, b: Draft) => b.createdAt.localeCompare(a.createdAt)); }
  draft(id: string): Draft | null { try { return JSON.parse(readFileSync(join(this.root, "drafts", `${id}.json`), "utf8")); } catch { return null; } }
  saveDraft(d: Draft) { writeFileSync(join(this.root, "drafts", `${d.id}.json`), JSON.stringify(d, null, 1)); this.onChange(); }
  /** Install a validated draft: copy it and pin every file by sha256. */
  install(id: string): any {
    const src = this.draftSource(id); const v = validate(src);
    if (!v.ok) throw new Error(`the pack is not valid: ${v.errors[0]}`);
    if (v.manifest!.id !== id) throw new Error(`the manifest id (${v.manifest!.id}) must be the draft id (${id})`);
    if (this.builtins().some((b) => b.id === id)) throw new Error(`${id} is a built-in pack`);
    const dest = join(this.root, "installed", id); rmSync(dest, { recursive: true, force: true }); cpSync(src.dir!, dest, { recursive: true });
    const files: Record<string, string> = {}; for (const f of walk(dest)) files[f] = sha(readFileSync(join(dest, f)));
    const lock = { id, version: v.manifest!.version, installedAt: new Date().toISOString(), files, sha256: sha(JSON.stringify(files)) };
    writeFileSync(join(this.root, "installed", `${id}.lock.json`), JSON.stringify(lock, null, 1));
    this.onChange(); return lock;
  }
  uninstall(id: string) { rmSync(join(this.root, "installed", id), { recursive: true, force: true }); rmSync(join(this.root, "installed", `${id}.lock.json`), { force: true }); this.onChange(); }
}

const AUTHOR_TAIL = `\n\nWrite the files with pack_write (paths relative to the pack folder), then call pack_report once. Answer in 2 short lines.`;

/** Workflow genesis: an author agent drafts a pack from a description; Studio validates it and runs its evals. */
export function startGenesis(o: { packs: Packs; agents: Agents; evals: Evals; provider: Provider; authorSkill: string; description: string; id?: string; by: string }): Draft {
  const description = String(o.description ?? "").trim().slice(0, 4000);
  if (description.length < 12) throw new Error("describe the way of working in a sentence or two");
  const base = (o.id || description.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2).slice(0, 3).join("-") || "new-pack").slice(0, 36);
  let id = base, n = 1; while (o.packs.draft(id) || o.packs.get(id)) id = `${base}-${++n}`;
  const dir = o.packs.draftDir(id); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const d: Draft = { id, description, status: "drafting", createdAt: new Date().toISOString(), job: null, summary: null, validation: null, evals: null, error: null, by: o.by };
  o.packs.saveDraft(d);
  let summary = "";
  const tools: AgentTool[] = [...folderTools(dir, () => {}, "pack"), { name: "pack_report", description: "Call once when done: a one-line summary of the pack.", schema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] },
    run: (a) => { summary = String(a.summary ?? "").slice(0, 400); return { ok: true }; } }];
  (async () => {
    const j = await o.agents.run({ kind: "genesis", title: `draft pack ${id}`, system: o.authorSkill + AUTHOR_TAIL, text: `PACK GENESIS\nPack id: ${id}\nDescription: ${description}\n\nStart with the manifest, then the workflow, the skills and the evals.`, tools, provider: o.provider, ref: `pack:${id}`, maxTools: 40 });
    d.job = j.id; d.summary = summary || j.said.trim().slice(0, 400) || null;
    if (j.status !== "done") { d.status = "failed"; d.error = j.error; o.packs.saveDraft(d); return; }
    checkDraft(o.packs, o.evals, d);
  })();
  return d;
}
/** The genesis gates: the format check, then the pack's own evals (static replay against its skills). */
export async function checkDraft(packs: Packs, evals: Evals, d: Draft) {
  const src = packs.draftSource(d.id); const v = validate(src);
  d.validation = { ok: v.ok, errors: v.errors, warnings: v.warnings };
  if (v.ok) {
    const results: SuiteResult["results"] = [];
    for (const role of new Set(v.cases.map((c) => c.role))) {
      const file = v.manifest!.skills.find((s) => s.role === role)?.file; const skill = file ? src.read(file) ?? "" : "";
      const cs = v.cases.filter((c) => c.role === role).map((c) => ({ ...c, workflow: v.flows[0]?.id ?? d.id, from: { task: null, actor: null, seq: null, ts: null }, situation: c.situation ?? "", terms: c.terms ?? [], createdAt: "" })) as EvalCase[];
      results.push(...(await evals.run(cs, skill, "static")).results);
    }
    d.evals = { mode: "static", provider: "none", model: "no model", passed: results.filter((r) => r.pass).length, total: results.length, results, at: new Date().toISOString() };
  }
  d.status = v.ok ? "drafted" : "invalid"; packs.saveDraft(d);
}
