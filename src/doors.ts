// The door classifier: every change gets a risk tier from its changed paths,
// the org-level defaults (workflows/doors.yaml) and the project's own sensitive
// paths. Those live in one place, the project's policy `sensitive_paths`
// (data/policies/project-<id>.yaml, resolved org → project → workflow, adding up);
// Project.sensitive is read from it. A proposed list (data/projects.json) does
// nothing until the captain approves it, which writes it into the policy. A
// project can add lines, never remove an org line.
import { existsSync, readFileSync, writeFileSync, lstatSync, renameSync, unlinkSync, realpathSync, statSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { join, resolve, relative, isAbsolute } from "node:path";
import {homedir} from "node:os";
import { bundledText, parseYaml } from "./bundled";
import { Policies, unreadableRule } from "./runtime/checks";

/**
 * The one exception to Studio's private data root: the source-owned sandbox repository,
 * registered as project "sandbox" at exactly <data>/demo-repo (sandbox-repo.ts). It holds only when
 * the id is exactly "sandbox", the registered path is that literal path, the path and its .git are
 * real directories (no links anywhere on the way), and .git is a standalone Git directory (no
 * gitdir file, no commondir). Returns the repository's real root, or null. Every other path below
 * the data root, and every other protected root, stays refused.
 */
export function builtInSandboxRoot(dataDir: string, id: string, path: unknown): string | null {
  if (id !== "sandbox" || typeof path !== "string" || !isAbsolute(path)) return null;
  try {
    const data = realpathSync(dataDir), literal = join(resolve(dataDir), "demo-repo"), real = join(data, "demo-repo");
    if (path !== literal && path !== real) return null;
    const root = lstatSync(path), git = lstatSync(join(path, ".git"));
    if (root.isSymbolicLink() || !root.isDirectory() || git.isSymbolicLink() || !git.isDirectory()) return null;
    if (realpathSync(path) !== real || realpathSync(join(path, ".git")) !== join(real, ".git")) return null;
    if (existsSync(join(real, ".git", "commondir"))) return null;
    return real;
  } catch { return null; }
}

export type Rule = { glob: string; why: string };
export type DoorDefaults = { base: Rule[]; trivial: Rule[]; trivial_max_lines: number };
export type Tier = "one-way" | "undecided" | "trivial" | "two-way";
export type ChangedPath = { path: string; status?: string; added?: number; removed?: number; from?: string | null };
export type Reason = { path: string; list: "org" | "project" | "trivial" | "unclassified"; glob: string | null; why: string };
export type DoorResult = { tier: Tier; door: "one-way" | "two-way" | "undecided"; reasons: Reason[]; lines: number; paths: number; decidedBy: "classifier" | "captain"; lists: { org: number; project: number } };
export type Project = { id: string; name: string; path: string | null; base: string; sensitive: Rule[]; proposed: Rule[] | null; proposedAt: string | null; approvedAt: string | null; enabled?: boolean;
  /** its policy file exists but cannot be read: classification fails closed (one-way) */ policyUnreadable?: boolean;
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

/** Why the staffing check refuses a project (bookkeeping beside the error it throws; see Projects.staffingAssess). */
export type StaffingRefusal='invalid_id'|'registry_unreadable'|'missing_or_disabled'|'folder_missing'|'folder_unusable'|'git_invalid'|'git_escapes_container'|'private_overlap'|'ambiguous_alias'|'base_invalid'|'base_missing'|'external_unverified'|'unsupported_value';
/** `record` is the registration the failing step was reading (another one while checking aliases); `aliases` the other ids on the same repository. */
export type StaffingAssessment={ok:true;identity:{namespace:'git';id:string;identity:string}}|{ok:false;reason:StaffingRefusal;record:string;aliases:string[];error:unknown};
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
  /** Stable source-only staffing identity. No Git commands, hooks or mutable HEAD authority. */
  staffingIdentity(id:string,protectedRoots:string[]=[]):{namespace:'git';id:string;identity:string}{
    // the checks live in staffingAssess (read only); this throws the very error it recorded, as before the extraction
    const a=this.staffingAssess(id,protectedRoots);if(!a.ok)throw a.error;return a.identity;
  }
  /**
   * The staffing checks, read only, as data: the identity, or why it is refused and which registration is at fault.
   * Same steps, same order, same errors as staffingIdentity has always run (it is now a thin wrapper over this); the
   * reason and the record are bookkeeping alongside. `includeDisabled` (display only, never used for authority) lets a
   * disabled registration be checked too.
   */
  staffingAssess(id:string,protectedRoots:string[]=[],o:{includeDisabled?:boolean}={}):StaffingAssessment{
    let stage:StaffingRefusal='invalid_id',record:string=typeof id==='string'?id:'',aliases:string[]=[],rootPath:string|null=null;
    try{
    if(typeof id!=='string'||!id||id.length>200)throw new Error("Choose an exact registered project");
    stage='registry_unreadable';
    const snapshot=this.nativeSnapshot(),project=snapshot.records.find(p=>p.id===id);
    stage='missing_or_disabled';
    if(!project?.path||(!o.includeDisabled&&project.enabled!==undefined&&project.enabled!==true))throw new Error("Registered project is missing or disabled");
    const inside=(a:string,b:string)=>{const r=relative(a,b);return !r||r!=='..'&&!r.startsWith('../')&&!isAbsolute(r);};
    const privateRoots=[this.dataDir,...protectedRoots,process.env.CODEX_HOME||join(homedir(),'.codex'),join(homedir(),'.claude'),process.env.CREW_RUNTIME_DIR||join(homedir(),'.crew-studio/runtime')].map(p=>{try{return realpathSync(p)}catch{return resolve(p)}});
    // The built-in sandbox is the only repository allowed below the data root; other protected roots still apply to it.
    // Index 0 is the data root itself: an explicit protected root that equals it still refuses.
    const sandbox=builtInSandboxRoot(this.dataDir,id,project.path);
    const allowed=(path:string)=>{if(privateRoots.some((root,i)=>!(sandbox&&i===0&&inside(sandbox,path))&&(inside(root,path)||inside(path,root)))){stage='private_overlap';throw new Error("Registered repository overlaps private or protected data");}};
    const small=(path:string,max:number,container:string,checkPrivate=true)=>{const actual=realpathSync(path);if(!inside(container,actual)){stage='git_escapes_container';throw new Error("Repository identity file escaped its container");}if(checkPrivate)allowed(actual);const st=statSync(actual);if(!st.isFile()||st.size>max)throw new Error("Repository identity file is unavailable or oversized");return readFileSync(actual,'utf8').trim();};
    const gitIdentity=(path:string,checkPrivate=true)=>{
      stage='folder_missing';rootPath=path;
      const root=realpathSync(path);if(!statSync(root).isDirectory())throw new Error("Repository root missing");if(checkPrivate)allowed(root);
      stage='git_invalid';
      let git=join(root,'.git');if(statSync(git).isFile()){const text=small(git,4096,root,checkPrivate);if(!text.startsWith('gitdir: ')||text.includes('\n'))throw new Error("Malformed Git directory reference");git=resolve(root,text.slice(8));}
      git=realpathSync(git);if(!statSync(git).isDirectory())throw new Error("Git directory missing");if(checkPrivate)allowed(git);
      const commonFile=join(git,'commondir'),common=realpathSync(existsSync(commonFile)?resolve(git,small(commonFile,4096,git,checkPrivate)):git);if(!statSync(common).isDirectory())throw new Error("Git common directory missing");if(checkPrivate)allowed(common);
      return{root,git,common};
    };
    const repository=gitIdentity(project.path);let matches=0;
    // Captain decision (2026-10-16): another registration whose root folder does not exist at all (ENOENT on the root
    // itself) is skipped: it cannot alias this repository, so it neither refuses staffing here nor counts. Anything else
    // about it (not a directory, unreadable, EACCES, no Git data, a link out) still refuses, as before.
    const rootAbsent=(path:string)=>{try{lstatSync(path);return false;}catch(e:any){return e?.code==='ENOENT';}};
    for(const other of snapshot.records){if(!other.path)continue;if(other.id!==id&&rootAbsent(other.path))continue;record=other.id;const identity=gitIdentity(other.path,false);if(identity.common===repository.common){matches++;if(other.id!==id)aliases.push(other.id);}}
    record=id;stage='ambiguous_alias';
    if(matches!==1)throw new Error("Repository has ambiguous registered aliases");
    stage='base_invalid';
    if(typeof project.base!=='string'||!project.base||project.base.length>200||project.base.startsWith('-')||project.base.includes('..')||project.base.includes('@{')||/[\s~^:?*\[\]\\]/.test(project.base)||project.base.startsWith('/')||project.base.endsWith('/')||project.base.split('/').some(p=>!p||p.startsWith('.')||p.endsWith('.')||p.endsWith('.lock')))throw new Error("Registered base is invalid");
    stage='base_missing';
    const ref='refs/heads/'+project.base,loose=join(repository.common,ref);let found=false;
    if(existsSync(loose)){const actual=realpathSync(loose);if(!inside(repository.common,actual)){stage='git_escapes_container';throw new Error("Base reference escaped Git authority");}found=/^[a-f0-9]{40,64}$/.test(small(actual,256,repository.common));}
    if(!found&&existsSync(join(repository.common,'packed-refs'))){const lines=small(join(repository.common,'packed-refs'),1024*1024,repository.common).split('\n');found=lines.some(line=>{const parts=line.split(' ');return parts.length===2&&/^[a-f0-9]{40,64}$/.test(parts[0])&&parts[1]===ref;});}
    if(!found){stage='base_missing';throw new Error("Confirmed base reference is unavailable");}
    stage='external_unverified';
    if(project.github){const assert=(this as any).assertExecutable;if(typeof assert!=='function')throw new Error("External project grant verification is unavailable");assert.call(this,{project:id,base:project.base},{});}
    stage='unsupported_value';
    const canonical=(v:any):string=>v===null||typeof v==='string'||typeof v==='boolean'?JSON.stringify(v):typeof v==='number'&&Number.isFinite(v)?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&Object.getPrototypeOf(v)===Object.prototype?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':(()=>{throw new Error("Unsupported project authority value")})();
    return{ok:true,identity:{namespace:'git',id,identity:createHash('sha256').update(canonical({schema:1,id,root:repository.root,common:repository.common,base:project.base,enabled:project.enabled??true,grant:project.github??null})).digest('hex')}};
    }catch(error:any){
      // folder_missing only when the root itself is not there (lstat ENOENT, the same test as the skip rule); a root that
      // exists but cannot be used (a file, a dangling link, EACCES, a file on the way: ENOTDIR) is folder_unusable
      let reason:StaffingRefusal=stage;
      if(stage==='folder_missing'){let absent=false;try{if(rootPath)lstatSync(rootPath);}catch(e:any){absent=e?.code==='ENOENT';}reason=absent?'folder_missing':'folder_unusable';}
      return{ok:false,reason,record,aliases:stage==='ambiguous_alias'?aliases:[],error};}
  }
  private raw(): Project[] { try { const a = JSON.parse(readFileSync(this.file(), "utf8")); return Array.isArray(a) ? a : []; } catch { return []; } }
  /** Each project, its sensitive paths read from its policy (the one home of a project's sensitive paths). */
  list(): Project[] {
    const pol = new Policies(this.dataDir); const raw = this.raw();
    // a list approved before the policy was its home moves there once, and projects.json keeps no copy
    const legacy = raw.filter((p) => Array.isArray(p.sensitive) && p.sensitive.length);
    // a project whose policy file cannot be read keeps its legacy list here until that file is fixed: the file is never replaced
    const kept = new Set<string>();
    for (const p of legacy) if (p.approvedAt && pol.project(p.id).sensitive_paths === undefined) { try { pol.setProject(p.id, { sensitive_paths: p.sensitive }); } catch (e: any) { if (e?.code !== "policyUnreadable") throw e; kept.add(p.id); } }
    if (legacy.length) writeFileSync(this.file(), JSON.stringify(raw.map((p) => kept.has(p.id) ? p : { ...p, sensitive: [] }), null, 1));
    return raw.map((p) => {
      // an unreadable policy file fails closed: the legacy list it could not take yet, plus a catch-all one-way line
      if (pol.projectUnreadable(p.id)) { const kept = Array.isArray(p.sensitive) ? p.sensitive.map((r: any) => ({ glob: String(r?.glob ?? r), why: String(r?.why ?? "project rule") })) : [];
        return { ...p, sensitive: [unreadableRule(`project ${p.id}`), ...kept], policyUnreadable: true }; }
      const cur = pol.project(p.id).sensitive_paths;
      return { ...p, sensitive: Array.isArray(cur) ? cur.map((r: any) => ({ glob: String(r?.glob ?? r), why: String(r?.why ?? "project rule") })) : [] };
    });
  }
  get(id: string) { return this.list().find((p) => p.id === id) ?? null; }
  /** projects.json keeps no copy of a policy's lists, except a legacy list whose policy file cannot be read yet (it moves once the file is fixed). */
  private save(list: Project[]) { const raw = new Map(this.raw().map((p) => [p.id, p])), pol = new Policies(this.dataDir);
    writeFileSync(this.file(), JSON.stringify(list.map((p) => { const old = raw.get(p.id)?.sensitive; const { policyUnreadable: _, ...rest } = p as any; return { ...rest, sensitive: Array.isArray(old) && old.length && pol.projectUnreadable(p.id) ? old : [] }; }), null, 1)); }
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
