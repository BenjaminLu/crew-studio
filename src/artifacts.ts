// Artifacts (M3): first-class, project-shared deliverables with versions.
//   CREW_DATA/artifacts/<id>/artifact.json          what it is: id, title, type, project, source kind
//   CREW_DATA/artifacts/<id>/v<N>/manifest.json     one version: files with sha256, parent, who made it,
//                                                   which notes produced it, status, approval, cost
//   CREW_DATA/artifacts/<id>/v<N>/files/…           the version's files (never edited after the version exists)
//   CREW_DATA/artifacts/<id>/v<N>/notes.json        review notes on this version (web pins, video ranges)
// A version's bytes are fixed: the manifest records a sha256 per file and verify()
// recomputes them. Approving a version pins its sha; the previous approved one
// becomes superseded. Studio never edits a version in place: changes make v(N+1).
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, normalize, relative, resolve, sep } from "node:path";
import { withLock } from "./ids";
import { noteFinding, noteLocator, type Finding, type Locator } from "./runtime/locator";

export type ArtifactType = "web" | "video" | "image" | "doc" | "audio";
export type Status = "draft" | "in-review" | "approved" | "superseded";
export type Maker = { kind: "captain" | "agent" | "import" | "host"; provider?: string; model?: string; run?: string };
export type FileRec = { path: string; sha256: string; size: number };
export type Cost = { usd: number | null; inTokens: number | null; outTokens: number | null };
export type MediaProvenance = {schema:1;request:string;task:string;generation:number;dependencies:Record<string,string>;provider:string|null;model:string|null;origin:"generated"|"import"};
export type Version = {
  refinement?:import("./domain/image-refinement").ImageRefinementSnapshot;
  media?:MediaProvenance;
  artifact: string; n: number; type: ArtifactType; files: FileRec[]; primary: string | null; sha256: string | null; url: string | null;
  parent: number | null; createdBy: Maker; source: { intent?: string | null; run?: string | null }; annotations: string[];
  status: Status; approvedBy: string | null; approvedAt: string | null; createdAt: string; cost: Cost | null; summary: string | null;
  render: { state: "none" | "running" | "done" | "failed"; detail?: string | null; ms?: number | null; normalized?: boolean; notes?: string[]; orient?: "landscape" | "portrait"; code?: string; dur?: number | null; width?: number | null; height?: number | null } | null;
};
/** source: "html" = a page to pin-review; "film" = HTML that renders to an MP4 (render.mp4 in the version);
 *  "file" = a plain file (MP4, image) reviewed without regeneration; "url" = an external link only; "room" = a review room saved
 *  read-only (room.json and its pictures; src/domain/review-room.ts), replayed in the room, never reviewed or edited here. */
export type Artifact = { id: string; title: string; type: ArtifactType; project: string; source: "html" | "film" | "file" | "url" | "md" | "room"; created: string; note: string | null; entry: string | null; legacy?: string | null };
export type Note = {
  supersedes?:{version:number;note:string}[];
  id: string; kind: "pin" | "range"; comment: string; createdAt: string; status: "open" | "resolved";
  selector?: string | null; bbox?: { x: number; y: number; w: number; h: number } | null; crop?: string | null;
  t0?: number | null; t1?: number | null; box?: { x: number; y: number; w: number; h: number } | null; scene?: string | null;
  addressed?: { claim: boolean; how: string; by: string; version: number } | null; verified?: boolean;
  /** where the note points, in the locator schema shared with check findings */
  locator?: Locator | null;
};

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const sha256File = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
/**
 * The one link that opens a web version's whole site in a new tab: its own
 * entry file (the version's primary, else the artifact's entry), every path
 * segment encoded. /af/ serves a top-level page like this in an opaque-origin
 * sandbox, so the site's scripts cannot reach Studio. Null when the version is
 * not a local web site or its entry is not a plain relative path.
 */
export function websiteHref(a: Pick<Artifact, "id" | "type" | "source" | "entry"> | null | undefined, v: Pick<Version, "n" | "primary"> | null | undefined): string | null {
  if (!a || !v || a.type !== "web" || a.source === "url" || !Number.isInteger(v.n) || v.n < 1) return null;
  const entry = v.primary || a.entry || "index.html";
  if (entry.startsWith("/") || entry.includes("\\") || entry.split("/").some((p) => !p || p === "." || p === "..")) return null;
  return `/af/${encodeURIComponent(a.id)}/${v.n}/${entry.split("/").map(encodeURIComponent).join("/")}`;
}
const expand = (p: string) =>(p.startsWith("~/") ? join(homedir(), p.slice(2)) : p);
const now = () => new Date().toISOString();

/** Every regular file under dir (symlinked directories are followed only for listing shared assets; not hashed). */
function walk(dir: string, base = dir, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) continue; // shared assets (e.g. a film's cast/) are links, not part of the version's bytes
    if (st.isDirectory()) walk(p, base, out); else if (st.isFile()) out.push(relative(base, p).split(sep).join("/"));
  }
  return out;
}

export class ArtifactStore {
  readonly root: string;
  onApproved: (a: Artifact, v: Version, previous: Version | null) => void = () => {};
  onChange: () => void = () => {};
  constructor(dataDir: string) { this.root = join(dataDir, "artifacts"); mkdirSync(this.root, { recursive: true }); }

  private adir(id: string) { if (!ID.test(id)) throw new Error(`bad artifact id ${id}`); return join(this.root, id); }
  vdir(id: string, n: number) { return join(this.adir(id), `v${n}`); }
  filesDir(id: string, n: number) { return join(this.vdir(id, n), "files"); }

  list(): Artifact[] {
    return readdirSync(this.root).filter((d) => ID.test(d) && existsSync(join(this.root, d, "artifact.json")))
      .map((d) => JSON.parse(readFileSync(join(this.root, d, "artifact.json"), "utf8")) as Artifact)
      .sort((a, b) => b.created.localeCompare(a.created));
  }
  get(id: string): Artifact | null { try { return JSON.parse(readFileSync(join(this.adir(id), "artifact.json"), "utf8")); } catch { return null; } }
  versions(id: string): Version[] {
    if (!this.get(id)) return [];
    return readdirSync(this.adir(id)).filter((d) => /^v\d+$/.test(d) && existsSync(join(this.adir(id), d, "manifest.json")))
      .map((d) => JSON.parse(readFileSync(join(this.adir(id), d, "manifest.json"), "utf8")) as Version).sort((a, b) => a.n - b.n);
  }
  version(id: string, n: number): Version | null { try { return JSON.parse(readFileSync(join(this.vdir(id, n), "manifest.json"), "utf8")); } catch { return null; } }
  latest(id: string): Version | null { return this.versions(id).at(-1) ?? null; }
  approved(id: string): Version | null { return this.versions(id).filter((v) => v.status === "approved").at(-1) ?? null; }
  private saveVersion(v: Version) { const f = join(this.vdir(v.artifact, v.n), "manifest.json"); writeFileSync(f + ".tmp", JSON.stringify(v, null, 2)); renameSync(f + ".tmp", f); this.onChange(); }

  create(a: { id: string; title: string; type: ArtifactType; project?: string; source: Artifact["source"]; note?: string | null; entry?: string | null; legacy?: string | null }): Artifact {
    if (this.get(a.id)) throw new Error(`artifact ${a.id} exists`);
    const art: Artifact = { id: a.id, title: a.title.slice(0, 200), type: a.type, project: a.project ?? "firstmate-workflow", source: a.source, created: now(), note: a.note ?? null, entry: a.entry ?? null, legacy: a.legacy ?? null };
    mkdirSync(this.adir(a.id), { recursive: true });
    writeFileSync(join(this.adir(a.id), "artifact.json"), JSON.stringify(art, null, 2));
    this.onChange();
    return art;
  }

  /** A new version from a directory of files (copied in). Shared asset folders are linked, not copied or hashed. */
  addVersion(id: string, o: { from?: string | null; url?: string | null; primary?: string | null; parent?: number | null; createdBy: Maker; source?: Version["source"];
    refinement?:Version["refinement"]; annotations?: string[]; status?: Status; cost?: Cost | null; summary?: string | null; links?: Record<string, string> }): Version {
    const art = this.get(id); if (!art) throw new Error(`no artifact ${id}`);
    const n = (this.latest(id)?.n ?? 0) + 1;
    const fdir = this.filesDir(id, n);
    mkdirSync(fdir, { recursive: true });
    if (o.from) cpSync(o.from, fdir, { recursive: true, dereference: false, filter: (src) => !lstatSync(src).isSymbolicLink() || src === o.from });
    for (const [name, target] of Object.entries(o.links ?? {})) { const p = join(fdir, name); rmSync(p, { recursive: true, force: true }); mkdirSync(dirname(p), { recursive: true }); symlinkSync(target, p); }
    const files = o.from ? walk(fdir).map((path) => ({ path, sha256: sha256File(join(fdir, path)), size: statSync(join(fdir, path)).size })) : [];
    const primary = o.primary ?? (art.entry && files.some((f) => f.path === art.entry) ? art.entry : files[0]?.path ?? null);
    const v: Version = { artifact: id, n, type: art.type, files, primary, sha256: primary ? files.find((f) => f.path === primary)?.sha256 ?? null : null, url: o.url ?? null,
      parent: o.parent ?? (n > 1 ? n - 1 : null), createdBy: o.createdBy, source: o.source ?? {}, annotations: o.annotations ?? [], status: o.status ?? "in-review",
      approvedBy: null, approvedAt: null, createdAt: now(), cost: o.cost ?? null, summary: o.summary ?? null, render: null };
    if(o.refinement)v.refinement=structuredClone(o.refinement);
    this.saveVersion(v);
    return v;
  }

  /** Publish validated complete bytes atomically; managed callers own approval. */
  publishMedia(a:{id:string;title:string;type:"image"|"video"|"audio";project:string},o:{n:number;name:string;bytes:Buffer;poster?:Buffer;media:MediaProvenance;createdBy:Maker}):Version {
    if(!/^media-[a-f0-9]{40}$/.test(a.id)||!Number.isSafeInteger(o.n)||o.n<1||!/^[a-z0-9.-]+$/.test(o.name))throw new Error("Unsafe managed media identity");
    const existing=this.get(a.id);if(existing&&(existing.type!==a.type||existing.project!==a.project))throw new Error("Managed media identity changed");
    const stage=join(this.root,`.media-${crypto.randomUUID()}`);mkdirSync(join(stage,"files"),{recursive:true});
    try{
      writeFileSync(join(stage,"files",o.name),o.bytes,{flag:"wx",mode:0o600});
      if(o.poster)writeFileSync(join(stage,"files","poster.png"),o.poster,{flag:"wx",mode:0o600});
      const sha=sha256File(join(stage,"files",o.name)),files=[{path:o.name,sha256:sha,size:o.bytes.length},...(o.poster?[{path:"poster.png",sha256:sha256File(join(stage,"files","poster.png")),size:o.poster.length}]:[])].sort((a,b)=>a.path.localeCompare(b.path));
      const v:Version={artifact:a.id,n:o.n,type:a.type,files,primary:o.name,sha256:sha,url:null,parent:o.n>1?o.n-1:null,createdBy:o.createdBy,source:{run:o.media.task},annotations:[],status:"draft",approvedBy:null,approvedAt:null,createdAt:now(),cost:null,summary:o.media.origin==="import"?"Imported media; awaiting review":"Generated media; awaiting workflow review",render:null,media:o.media};
      writeFileSync(join(stage,"manifest.json"),JSON.stringify(v,null,2));writeFileSync(join(stage,"notes.json"),"[]");
      if(existing){if(this.latest(a.id)?.n!==o.n-1)throw new Error("Managed media version changed");renameSync(stage,this.vdir(a.id,o.n));}
      else{if(o.n!==1)throw new Error("Missing managed media parent");const outer=stage+"-artifact";mkdirSync(outer);try{renameSync(stage,join(outer,"v1"));writeFileSync(join(outer,"artifact.json"),JSON.stringify({...a,source:"file",entry:o.name,created:now(),note:"Workflow-owned managed media",legacy:null},null,2));renameSync(outer,this.adir(a.id));}finally{rmSync(outer,{recursive:true,force:true});}}
      this.onChange();return v;
    }finally{rmSync(stage,{recursive:true,force:true});}
  }

  /** Add or replace one file in a version that is not approved yet (used for a film's render.mp4). */
  attach(id: string, n: number, name: string, fromFile: string) {
    const v = this.version(id, n); if (!v) throw new Error("no such version");
    if (v.status === "approved" || v.status === "superseded") throw new Error("an approved version is fixed");
    const dest = join(this.filesDir(id, n), name);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(fromFile, dest);
    const rec = { path: name, sha256: sha256File(dest), size: statSync(dest).size };
    v.files = [...v.files.filter((f) => f.path !== name), rec].sort((a, b) => a.path.localeCompare(b.path));
    this.saveVersion(v);
    return rec;
  }
  setRender(id: string, n: number, render: Version["render"]) { const v = this.version(id, n); if (!v) return; v.render = render; this.saveVersion(v); }

  /** Recompute every file's sha256; returns the paths that no longer match (empty = intact). */
  verify(id: string, n: number): string[] {
    const v = this.version(id, n); if (!v) return ["(no manifest)"];
    const bad: string[] = [];
    for (const f of v.files) { const p = join(this.filesDir(id, n), f.path); if (!existsSync(p) || sha256File(p) !== f.sha256) bad.push(f.path); }
    return bad;
  }

  approve(id: string, n: number, by: string): Version {
    const art = this.get(id); const v = this.version(id, n);
    if (!art || !v) throw new Error("no such version");
    const bad = this.verify(id, n);
    if (bad.length) throw new Error(`version files changed since they were recorded: ${bad.join(", ")}`);
    const prev = this.approved(id);
    for (const o of this.versions(id)) if (o.status === "approved" && o.n !== n) { o.status = "superseded"; this.saveVersion(o); }
    v.status = "approved"; v.approvedBy = by; v.approvedAt = now();
    this.saveVersion(v);
    this.onApproved(art, v, prev && prev.n !== n ? prev : null);
    return v;
  }

  /** The Markdown source of a document version (source md): doc.md, or for a version written before doc.md was the
   *  convention (the startup competition's competition.md) its own .md primary or entry. Read only. */
  mdSource(id: string, n: number): string | null {
    const a = this.get(id), v = this.version(id, n); if (a?.source !== "md" || !v) return null;
    for (const rel of ["doc.md", v.primary, a.entry]) if (typeof rel === "string" && rel.endsWith(".md")) { const f = this.file(id, n, rel); if (f) return f; }
    return null;
  }
  /** Absolute path of a version file, only inside that version's files/ (shared links resolved and checked). */
  file(id: string, n: number, rel: string): string | null {
    let fdir: string; try { fdir = this.filesDir(id, n); } catch { return null; }
    const p = normalize(resolve(fdir, rel));
    if (!p.startsWith(fdir + sep)) return null;
    try {
      if(id.startsWith("media-")){if(!this.version(id,n)?.files.some(f=>f.path===relative(fdir,p).split(sep).join("/")))return null;let current=this.root;for(const part of [id,`v${n}`,"files",...relative(fdir,p).split(sep)]){current=join(current,part);if(lstatSync(current).isSymbolicLink())return null;}}
      if (!statSync(p).isFile()) return null;
    } catch { return null; }
    return p;
  }

  // --- notes ---
  /** A version's notes; each carries its locator in the shared schema (src/runtime/locator.ts), filled in for notes saved before it existed. */
  notes(id: string, n: number): Note[] {
    let list: Note[]; try { list = JSON.parse(readFileSync(join(this.vdir(id, n), "notes.json"), "utf8")); } catch { return []; }
    const a = this.get(id); const v = list.some((x) => !x.locator) ? this.version(id, n) : null;
    return list.map((x) => (x.locator ? x : { ...x, locator: noteLocator(x, { artifact: id, version: n, entry: v?.primary ?? a?.entry ?? null, source: a?.source }) }));
  }
  /** The notes as findings: the same type a check produces, so an agent cannot tell human from machine feedback. */
  findings(id: string, n: number, open = true): Finding[] { return this.notes(id, n).filter((x) => !open || x.status === "open").map((x) => noteFinding(x, x.locator ?? null)); }
  private saveNotes(id: string, n: number, notes: Note[]) { const f = join(this.vdir(id, n), "notes.json"); writeFileSync(f + ".tmp", JSON.stringify(notes, null, 2)); renameSync(f + ".tmp", f); this.onChange(); }
  addNote(id: string, n: number, input: Partial<Note>): Note {
    const v = this.version(id, n); if (!v) throw new Error("no such version");
    const comment = String(input.comment ?? "").trim().slice(0, 2000);
    if (!comment) throw new Error("a note needs a comment");
    return withLock(this.vdir(id, n), "notes", () => {
    const notes = this.notes(id, n);
    const supersedes=input.supersedes;
    if(supersedes!==undefined){if(!Array.isArray(supersedes)||supersedes.length>20)throw new Error("Invalid superseded annotations");const ancestors=new Set<number>();let parent:number|null=n;while(parent!==null){if(ancestors.has(parent)||ancestors.size>=100)throw new Error("Invalid annotation lineage");ancestors.add(parent);const version=this.version(id,parent);if(!version)throw new Error("Missing annotation ancestor");parent=version.parent;}
      const seen=new Set<string>();for(const target of supersedes){const key=`${target?.version}:${target?.note}`;if(!target||Object.keys(target).sort().join(',')!=="note,version"||!Number.isInteger(target.version)||!ancestors.has(target.version)||typeof target.note!=="string"||seen.has(key)||!this.notes(id,target.version).some(note=>note.id===target.note))throw new Error("Superseded annotation must belong to this version's ancestry");seen.add(key);}}
    const kind = input.kind === "range" ? "range" : "pin";
    const num = (x: any) => (Number.isFinite(Number(x)) ? Math.round(Number(x) * 1000) / 1000 : null);
    const box = (b: any) => (b && [b.x, b.y, b.w, b.h].every((x: any) => Number.isFinite(Number(x))) ? { x: num(b.x)!, y: num(b.y)!, w: num(b.w)!, h: num(b.h)! } : null);
    const prefix = kind === "pin" ? "P" : "R"; const noteNo = notes.reduce((m, x) => Math.max(m, Number(new RegExp(`^${prefix}(\\d+)$`).exec(x.id)?.[1] ?? 0)), 0) + 1;
    const note: Note = { id: `${prefix}${noteNo}`, kind, comment, createdAt: now(), status: "open",
      selector: kind === "pin" ? String(input.selector ?? "").slice(0, 500) || null : null, bbox: kind === "pin" ? box(input.bbox) : null, crop: null,
      t0: kind === "range" ? num(input.t0) : null, t1: kind === "range" ? num(input.t1) : null, box: kind === "range" ? box(input.box) : null,
      scene: kind === "range" ? (input.scene ? String(input.scene).slice(0, 120) : null) : null, addressed: null, verified: false };
    if (kind === "range" && (note.t0 == null || note.t1 == null || note.t1 < note.t0)) throw new Error("a range note needs t0 ≤ t1");
    const art = this.get(id);
    note.locator = noteLocator(note, { artifact: id, version: n, entry: v.primary ?? art?.entry ?? null, source: art?.source });
    if(supersedes?.length)note.supersedes=structuredClone(supersedes);
    notes.push(note); this.saveNotes(id, n, notes);
    return note;
    });
  }
  updateNote(id: string, n: number, noteId: string, patch: Partial<Pick<Note, "status" | "verified" | "comment" | "crop" | "addressed">>): Note {
    const notes = this.notes(id, n); const x = notes.find((y) => y.id === noteId);
    if (!x) throw new Error("no such note");
    if (patch.status === "open" || patch.status === "resolved") x.status = patch.status;
    if (typeof patch.verified === "boolean") x.verified = patch.verified;
    if (typeof patch.comment === "string" && patch.comment.trim()) x.comment = patch.comment.trim().slice(0, 2000);
    if (patch.crop !== undefined) x.crop = patch.crop;
    if (patch.addressed !== undefined) x.addressed = patch.addressed;
    this.saveNotes(id, n, notes);
    return x;
  }

  /** Library rows: each artifact with its versions summarised. */
  view() {
    return this.list().map((a) => {
      const vs = this.versions(a.id);
      const ap = vs.filter((v) => v.status === "approved").at(-1) ?? null;
      const last = vs.at(-1) ?? null;
      return { ...a, versions: vs.map((v) => ({ n: v.n, status: v.status, createdAt: v.createdAt, createdBy: v.createdBy, approvedBy: v.approvedBy, approvedAt: v.approvedAt,
        primary:v.primary,media:v.media,sha256: v.sha256, parent: v.parent, annotations: v.annotations, cost: v.cost, render: v.render, url: v.url, notes: this.notes(a.id, v.n).length, fileCount: v.files.length, summary: v.summary })),
        latest: last?.n ?? null, approved: ap?.n ?? null };
    });
  }

  /** First start: turn the M2 artifacts.json entries into v1 artifacts (copies; the originals are never touched). */
  importLegacy(entries: { id: string; type: string; title: string; path?: string; url?: string; note?: string; created?: string }[], o: { filmSource?: string | null; allow?: string[] } = {}) {
    const allowed = (p: string) => !o.allow || o.allow.some((d) => normalize(resolve(expand(p))).startsWith(normalize(resolve(expand(d))) + "/"));
    const made: string[] = [];
    for (const e of entries) {
      const id = e.id.replace(/^A-/, "").replace(/-v\d+$/, "") || e.id;
      if (this.get(id)) continue;
      if (e.url && !e.path) {
        this.create({ id, title: e.title, type: e.type === "web" ? "web" : "doc", source: "url", note: e.note ?? null, legacy: e.id });
        this.addVersion(id, { url: e.url, createdBy: { kind: "import" }, status: "in-review", summary: "registered from the M2 Library" });
        made.push(id); continue;
      }
      const p = e.path ? expand(e.path) : null;
      if (!p) continue;
      if (!allowed(p) || !existsSync(p)) {
        // never copy a file from outside the allowed folders: the artifact is listed, empty, and says why
        this.create({ id, title: e.title, type: e.type === "video" ? "video" : e.type === "web" ? "web" : "doc", source: "file", note: e.note ?? null, legacy: e.id });
        this.addVersion(id, { createdBy: { kind: "import" }, status: "in-review", summary: allowed(p) ? `not found: ${e.path}` : `not imported: ${e.path} is outside the allowed folders` });
        made.push(id); continue;
      }
      const src = o.filmSource && existsSync(join(o.filmSource, "firstmate-film.html")) && e.type === "video" ? o.filmSource : null;
      const tmp = join(this.root, `.import-${id}`);
      rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true });
      if (src) {
        cpSync(join(src, "firstmate-film.html"), join(tmp, "film.html"));
        const assets = join(this.adir(id), "assets");
        mkdirSync(assets, { recursive: true });
        if (existsSync(join(src, "cast")) && !existsSync(join(assets, "cast"))) cpSync(join(src, "cast"), join(assets, "cast"), { recursive: true });
      }
      cpSync(p, join(tmp, "render.mp4"));
      this.create({ id, title: e.title, type: e.type === "video" ? "video" : e.type === "web" ? "web" : "doc", source: src ? "film" : "file", note: e.note ?? null, entry: src ? "film.html" : "render.mp4", legacy: e.id });
      const v = this.addVersion(id, { from: tmp, primary: "render.mp4", createdBy: { kind: "import" }, status: "in-review", summary: `imported from ${e.path}`,
        links: src ? { cast: join(this.adir(id), "assets", "cast") } : {} });
      this.setRender(id, v.n, { state: "done", detail: "imported", ms: null });
      rmSync(tmp, { recursive: true, force: true });
      made.push(id);
    }
    return made;
  }

  /** Link a version's shared assets (a film's cast/) into a working copy. */
  sharedLinks(id: string, n: number): Record<string, string> {
    const fdir = this.filesDir(id, n); const out: Record<string, string> = {};
    if (!existsSync(fdir)) return out;
    for (const name of readdirSync(fdir)) { const p = join(fdir, name); if (lstatSync(p).isSymbolicLink()) out[name] = readlinkSync(p); }
    return out;
  }
}
