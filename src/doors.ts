// The door classifier: every change gets a risk tier from its changed paths,
// the org-level defaults (workflows/doors.yaml) and the project's own sensitive
// paths. Those live in one place, the project's policy `sensitive_paths`
// (data/policies/project-<id>.yaml, resolved org → project → workflow, adding up);
// Project.sensitive is read from it. A proposed list (data/projects.json) does
// nothing until the captain approves it, which writes it into the policy. A
// project can add lines, never remove an org line.
import { existsSync, readFileSync, writeFileSync, lstatSync, renameSync, unlinkSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { bundledText, parseYaml } from "./bundled";
import { Policies } from "./runtime/checks";

export type Rule = { glob: string; why: string };
export type DoorDefaults = { base: Rule[]; trivial: Rule[]; trivial_max_lines: number };
export type Tier = "one-way" | "undecided" | "trivial" | "two-way";
export type ChangedPath = { path: string; status?: string; added?: number; removed?: number; from?: string | null };
export type Reason = { path: string; list: "org" | "project" | "trivial" | "unclassified"; glob: string | null; why: string };
export type DoorResult = { tier: Tier; door: "one-way" | "two-way" | "undecided"; reasons: Reason[]; lines: number; paths: number; decidedBy: "classifier" | "captain"; lists: { org: number; project: number } };
export type Project = { id: string; name: string; path: string | null; base: string; sensitive: Rule[]; proposed: Rule[] | null; proposedAt: string | null; approvedAt: string | null;
  github?: import("./adapters/github").GitHubProjectGrant;
  gates?: Record<string, any[]> };

/** gitignore-like globs: ** spans folders, * and ? stay in one; no "/" means "this name at any depth". */
export function globRe(glob: string): RegExp {
  const g = glob.replace(/^\.\//, "");
  const anyDepth = !g.includes("/");
  let re = "";
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "*" && g[i + 1] === "*") { if (g[i + 2] === "/") { re += "(?:.*/)?"; i += 2; } else { re += ".*"; i++; } }
    else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${anyDepth ? "(?:.*/)?" : ""}${re}$`);
}
export const matches = (glob: string, path: string) => globRe(glob).test(path);

export function loadDefaults(): DoorDefaults {
  const d = parseYaml(bundledText("workflows/doors.yaml") ?? "{}") ?? {};
  return { base: d.base ?? [], trivial: d.trivial ?? [], trivial_max_lines: d.trivial_max_lines ?? 40 };
}

/** The org lines a classification uses: doors.yaml's base plus the org policy's sensitive_paths. */
export function orgDefaults(dataDir: string): DoorDefaults {
  const d = loadDefaults(); const org = new Policies(dataDir).get("sensitive_paths").value ?? [];
  const rules: Rule[] = (Array.isArray(org) ? org : []).map((r: any) => ({ glob: String(r?.glob ?? r), why: String(r?.why ?? "org policy") }));
  return { ...d, base: [...d.base, ...rules.filter((r) => !d.base.some((b) => b.glob === r.glob))] };
}

/**
 * Classify a change. `topLevel` (the base tree's top-level names), when given,
 * makes a path under a NEW top-level name unclassifiable, like a rename.
 */
export function classify(paths: ChangedPath[], o: { defaults: DoorDefaults; project?: Project | null; topLevel?: Set<string> | null }): DoorResult {
  const reasons: Reason[] = [];
  const proj = o.project?.sensitive ?? []; // the project's policy sensitive_paths (written by Studio or the captain's approval)
  let oneWay = false, unclassified = false, allTrivial = paths.length > 0;
  for (const p of paths) {
    const hitOrg = o.defaults.base.find((r) => matches(r.glob, p.path) || (p.from ? matches(r.glob, p.from) : false));
    const hitProj = proj.find((r) => matches(r.glob, p.path) || (p.from ? matches(r.glob, p.from) : false));
    if (hitOrg) { oneWay = true; reasons.push({ path: p.path, list: "org", glob: hitOrg.glob, why: hitOrg.why }); }
    if (hitProj) { oneWay = true; reasons.push({ path: p.path, list: "project", glob: hitProj.glob, why: hitProj.why }); }
    const top = p.path.split("/")[0];
    if (!hitOrg && !hitProj) {
      if (p.status?.startsWith("R")) { unclassified = true; reasons.push({ path: p.path, list: "unclassified", glob: null, why: `renamed from ${p.from ?? "?"}` }); }
      else if (o.topLevel && p.path.includes("/") && !o.topLevel.has(top)) { unclassified = true; reasons.push({ path: p.path, list: "unclassified", glob: null, why: `a new top-level path (${top}/)` }); }
    }
    const triv = o.defaults.trivial.find((r) => matches(r.glob, p.path));
    if (!triv || p.status?.startsWith("D")) allTrivial = false;
  }
  const lines = paths.reduce((n, p) => n + (p.added ?? 0) + (p.removed ?? 0), 0);
  const tier: Tier = oneWay ? "one-way" : unclassified ? "undecided" : allTrivial && lines <= o.defaults.trivial_max_lines ? "trivial" : "two-way";
  if (tier === "trivial") for (const p of paths) { const r = o.defaults.trivial.find((x) => matches(x.glob, p.path))!; reasons.push({ path: p.path, list: "trivial", glob: r.glob, why: r.why }); }
  return { tier, door: tier === "one-way" ? "one-way" : tier === "undecided" ? "undecided" : "two-way", reasons, lines, paths: paths.length, decidedBy: "classifier",
    lists: { org: o.defaults.base.length, project: proj.length } };
}

// ---------- projects ----------
export class Projects {
  constructor(readonly dataDir: string) {}
  private file() { return join(this.dataDir, "projects.json"); }
  /** Strict authority reader: never migrates, repairs or treats corruption as empty. */
  nativeSnapshot(): {exists:boolean;digest:string;records:Project[]} {
    let bytes:string|null=null;
    try {const st=lstatSync(this.file());if(!st.isFile()||st.isSymbolicLink()||st.size>1024*1024)throw new Error("unsafe registry");bytes=readFileSync(this.file(),"utf8");}
    catch(e:any){if(e?.code!=="ENOENT")throw new Error("Project registry is malformed or unavailable");}
    const records=bytes===null?[]:JSON.parse(bytes);
    if(!Array.isArray(records)||records.length>1000)throw new Error("Project registry is malformed");
    const ids=new Set<string>();for(const p of records){if(!p||typeof p!=="object"||Array.isArray(p)||typeof p.id!=="string"||!p.id||ids.has(p.id)||typeof p.name!=="string"||!(p.path===null||typeof p.path==="string"&&p.path.startsWith("/"))||typeof p.base!=="string"||!p.base||p.enabled!==undefined&&typeof p.enabled!=="boolean")throw new Error("Project registry is malformed");ids.add(p.id);}
    return {exists:bytes!==null,digest:createHash("sha256").update(bytes===null?"absent":bytes).digest("hex"),records};
  }
  /** Synchronous source-owned CAS; unrelated legacy callers retain their old API. */
  nativeAddCAS(expected:{exists:boolean;digest:string},p:Project):Project {
    const current=this.nativeSnapshot();if(current.exists!==expected.exists||current.digest!==expected.digest||current.records.some(r=>r.id===p.id))throw new Error("Project registry changed; fresh captain confirmation required");
    const tmp=this.file()+".native-"+randomUUID();try{writeFileSync(tmp,JSON.stringify([...current.records,p],null,1),{flag:"wx",mode:0o600});const last=this.nativeSnapshot();if(last.exists!==expected.exists||last.digest!==expected.digest)throw new Error("Project registry changed");renameSync(tmp,this.file());}finally{try{unlinkSync(tmp);}catch{}}
    return p;
  }
  private raw(): Project[] { try { const a = JSON.parse(readFileSync(this.file(), "utf8")); return Array.isArray(a) ? a : []; } catch { return []; } }
  /** Each project, its sensitive paths read from its policy (the one home of a project's sensitive paths). */
  list(): Project[] {
    const pol = new Policies(this.dataDir); const raw = this.raw();
    // a list approved before the policy was its home moves there once, and projects.json keeps no copy
    const legacy = raw.filter((p) => Array.isArray(p.sensitive) && p.sensitive.length);
    for (const p of legacy) if (p.approvedAt && pol.project(p.id).sensitive_paths === undefined) pol.setProject(p.id, { sensitive_paths: p.sensitive });
    if (legacy.length) this.save(raw);
    return raw.map((p) => {
      const cur = pol.project(p.id).sensitive_paths;
      return { ...p, sensitive: Array.isArray(cur) ? cur.map((r: any) => ({ glob: String(r?.glob ?? r), why: String(r?.why ?? "project rule") })) : [] };
    });
  }
  get(id: string) { return this.list().find((p) => p.id === id) ?? null; }
  private save(list: Project[]) { writeFileSync(this.file(), JSON.stringify(list.map((p) => ({ ...p, sensitive: [] })), null, 1)); }
  add(o: { id?: string; name?: string; path?: string | null; base?: string; propose?: Rule[] }): Project {
    const name = String(o.name ?? o.id ?? "").trim();
    const id = String(o.id ?? name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
    if (!id) throw new Error("give the project a name");
    if (this.get(id)) throw new Error(`project ${id} exists`);
    const path = o.path ? String(o.path) : null;
    if (path && (!path.startsWith("/") || !existsSync(join(path, ".git")))) throw new Error("the path must be the absolute path of a local git repository");
    const p: Project = { id, name: name || id, path, base: o.base || "main", sensitive: [], proposed: null, proposedAt: null, approvedAt: null };
    this.save([...this.list(), p]);
    if (o.propose?.length) return this.propose(id, o.propose);
    return p;
  }
  /** A proposed list does nothing until the captain approves it. */
  propose(id: string, rules: Rule[]): Project {
    const list = this.list(); const p = list.find((x) => x.id === id); if (!p) throw new Error("no such project");
    const clean = rules.map((r) => ({ glob: String(r?.glob ?? "").trim(), why: String(r?.why ?? "").trim() || "project rule" })).filter((r) => r.glob && r.glob.length < 200);
    for (const r of clean) globRe(r.glob);
    p.proposed = clean; p.proposedAt = new Date().toISOString(); this.save(list); return p;
  }
  approve(id: string): Project {
    const list = this.list(); const p = list.find((x) => x.id === id); if (!p) throw new Error("no such project");
    if (!p.proposed) throw new Error("nothing proposed");
    // approving adds the proposed lines to the project's policy (removing a line is an edit of the policy itself)
    const cur: Rule[] = p.sensitive ?? []; const merged = [...cur, ...p.proposed.filter((r) => !cur.some((c) => c.glob === r.glob))];
    new Policies(this.dataDir).setProject(id, { sensitive_paths: merged });
    p.sensitive = merged; p.proposed = null; p.approvedAt = new Date().toISOString(); this.save(list); return p;
  }
  decline(id: string): Project { const list = this.list(); const p = list.find((x) => x.id === id); if (!p) throw new Error("no such project"); p.proposed = null; this.save(list); return p; }
}
