// Skins (M4/M5): another face for Studio, never another set of powers.
// A skin is a folder (manifest.json + an HTML entry). It runs in a sandboxed
// iframe (scripts only: no same-origin, no forms, no popups) served with a CSP
// that has no network unless the captain granted origins the manifest lists.
// It receives a read-only snapshot and events from the host page and may only
// ask the host to OPEN a card. Every file is pinned by sha256 at install (the
// built-in skins are pinned when Studio starts); a changed file is refused.
//   data/skins/installed/<id>/…   data/skins/installed/<id>.lock.json
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { extname, join, normalize, relative, sep } from "node:path";
import { bundledBytes, bundledList } from "./bundled";
import type { Run } from "./runtime/engine";

/** Adapt native tasks to the existing read-only skin contract without exposing run context. */
export function nativeSkinData(runs: Run[], cards: any[]) {
  const visible = runs.filter(r => !r.archived);
  const key = (r: Run, node: string) => `${r.workflow}:v${r.version}:${node}`;
  const nodes = new Map<string, any>(); const edges: any[] = [];
  for (const r of visible.filter(r => !["succeeded", "cancelled", "failed"].includes(r.status))) {
    for (const n of r.def.nodes) nodes.set(key(r, n.id), { id: key(r, n.id), label: n.label, kind: n.kind === "card" ? "human" : n.kind === "check" ? "gate" : n.kind });
    for (const e of r.def.edges) edges.push({ ...e, from: key(r, e.from), to: key(r, e.to) });
  }
  return {
    tasks: visible.map(r => {
      const current = r.def.nodes.find(n => r.nodes[n.id]?.state === "running" || r.nodes[n.id]?.state === "waiting");
      return { id: r.id, title: r.title, status: r.status === "waiting" ? "needs-you" : ["succeeded", "cancelled"].includes(r.status) ? "done" : r.status,
        node: current ? key(r, current.id) : null, round: current ? r.nodes[current.id].visits : 0, lastTs: r.updatedAt };
    }),
    crew: visible.flatMap(r => r.def.nodes.filter(n => n.kind === "agent" && r.nodes[n.id]?.state === "running" && r.nodes[n.id]?.job).map(n => ({ name: `${r.id}/${n.id}`, role: n.role || "worker", task: r.id, alive: true, activity: { en: n.label } }))),
    pending: cards.filter(c => c.status === "open" && visible.some(r => r.id === c.run)).map(c => ({ id: c.id, title: c.title?.["zh-TW"] || c.title?.en || String(c.title || c.id), kind: c.kind, task: c.run })),
    flow: { nodes: [...nodes.values()], edges },
  };
}

export const SKIN_PERMS = ["snapshot.tasks", "snapshot.crew", "snapshot.pending", "snapshot.flow", "events", "openCard"] as const;
export type SkinManifest = { id: string; name: string; version: string; entry: string; description?: string; permissions: string[]; network: string[] };
type Src = { kind: "builtin" | "installed"; id: string; bytes: (rel: string) => Buffer | null; files: () => string[] };
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".json": "application/json", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8" };
const walk = (d: string, base = d, out: string[] = []) => { for (const f of readdirSync(d).sort()) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p, base, out); else if (!f.startsWith(".")) out.push(relative(base, p).split(sep).join("/")); } return out; };
export const skinCsp = (network: string[]) => `default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src ${network.length ? network.join(" ") : "'none'"}; frame-ancestors 'self'; form-action 'none'; base-uri 'none'`;

export class Skins {
  readonly root: string;
  private pins = new Map<string, Record<string, string>>(); // builtin pins, computed at start
  constructor(dataDir: string) {
    this.root = join(dataDir, "skins", "installed"); mkdirSync(this.root, { recursive: true });
    for (const s of this.builtins()) { const files: Record<string, string> = {}; for (const f of s.files()) files[f] = sha(s.bytes(f)!); this.pins.set(s.id, files); }
  }
  private builtins(): Src[] {
    const ids = [...new Set(bundledList("skins/").map((f) => f.split("/")[1]))].filter((x) => x !== "kit");
    return ids.map((id) => ({ kind: "builtin" as const, id, bytes: (rel: string) => bundledBytes(`skins/${id}/${rel}`), files: () => bundledList(`skins/${id}/`).map((f) => f.slice(`skins/${id}/`.length)) }));
  }
  private installed(): Src[] {
    return readdirSync(this.root).filter((d) => existsSync(join(this.root, d, "manifest.json"))).map((id) => { const dir = join(this.root, id);
      return { kind: "installed" as const, id, files: () => walk(dir), bytes: (rel: string) => { const p = normalize(join(dir, rel)); if (!p.startsWith(dir + sep) || !existsSync(p)) return null; return readFileSync(p); } }; });
  }
  private src(id: string) { return [...this.builtins(), ...this.installed()].find((s) => s.id === id) ?? null; }
  lock(id: string): { files: Record<string, string>; network: string[]; installedAt: string | null; sha256: string } | null {
    const b = this.pins.get(id); if (b) return { files: b, network: [], installedAt: null, sha256: sha(Buffer.from(JSON.stringify(b))) };
    try { return JSON.parse(readFileSync(join(this.root, `${id}.lock.json`), "utf8")); } catch { return null; }
  }
  manifest(s: Src): SkinManifest | null { try { const m = JSON.parse(s.bytes("manifest.json")!.toString("utf8")); return { ...m, permissions: m.permissions ?? [], network: m.network ?? [] }; } catch { return null; } }
  /** The kit's checks: manifest, entry, pins, no network, the kit and ready(), known permissions. */
  check(id: string) {
    const s = this.src(id); if (!s) throw new Error("no such skin");
    const out: { id: string; label: string; ok: boolean; detail: string }[] = [];
    const m = this.manifest(s);
    out.push({ id: "manifest", label: "The manifest parses and names an entry that exists", ok: !!m && !!m.id && !!m.entry && !!s.bytes(m.entry), detail: m ? `entry ${m.entry}` : "no manifest.json" });
    const lock = this.lock(id); const bad = lock ? Object.entries(lock.files).filter(([f, h]) => { const b = s.bytes(f); return !b || sha(b) !== h; }).map(([f]) => f).concat(s.files().filter((f) => !(f in (lock?.files ?? {})))) : ["no lock"];
    out.push({ id: "pins", label: "Every file matches its pinned sha256", ok: !bad.length, detail: bad.length ? `changed: ${bad.join(", ")}` : `${Object.keys(lock!.files).length} files pinned` });
    const granted = new Set(lock?.network ?? []);
    const net: string[] = [];
    for (const f of s.files().filter((f) => /\.(html|js|css|svg)$/.test(f))) { const t = s.bytes(f)!.toString("utf8");
      for (const u of t.match(/(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}[^\s"'`)]*/gi) ?? []) { if (/^\/\/(www\.)?w3\.org/.test(u.replace(/^https?:/, "")) || /^https?:\/\/(www\.)?w3\.org\//.test(u)) continue; if (![...granted].some((g) => u.startsWith(g))) net.push(`${f}: ${u.slice(0, 60)}`); } }
    out.push({ id: "network", label: "No file reaches the network (unless granted)", ok: !net.length, detail: net.length ? net.slice(0, 4).join("; ") : m?.network?.length ? `granted: ${(lock?.network ?? []).join(", ") || "none"}` : "no network" });
    const entry = m && s.bytes(m.entry)?.toString("utf8") || "";
    const all = s.files().filter((f) => /\.(html|js)$/.test(f)).map((f) => s.bytes(f)!.toString("utf8")).join("\n");
    out.push({ id: "kit", label: "It loads the kit and calls CrewSkin.ready()", ok: entry.includes("/skin/_kit/skin-kit.js") && /CrewSkin\.ready\(\)/.test(all), detail: entry.includes("/skin/_kit/skin-kit.js") ? (/CrewSkin\.ready\(\)/.test(all) ? "kit + ready()" : "never calls ready()") : "the entry does not load /skin/_kit/skin-kit.js" });
    const unknown = (m?.permissions ?? []).filter((p) => !(SKIN_PERMS as readonly string[]).includes(p));
    out.push({ id: "permissions", label: "Only known permissions", ok: !unknown.length, detail: unknown.length ? `unknown: ${unknown.join(", ")}` : (m?.permissions ?? []).join(", ") || "none" });
    return { ok: out.every((x) => x.ok), checks: out };
  }
  list() {
    return [...this.builtins(), ...this.installed()].map((s) => { const m = this.manifest(s); const c = (() => { try { return this.check(s.id); } catch (e: any) { return { ok: false, checks: [] }; } })();
      const lock = this.lock(s.id); return { id: s.id, kind: s.kind, manifest: m, ok: c.ok, checks: c.checks, sha256: lock?.sha256 ?? null, network: lock?.network ?? [] }; });
  }
  /** Install from a folder on this Mac: copy, check, pin. Network origins need the captain's explicit grant. */
  install(path: string, grantNetwork: boolean) {
    const dir = normalize(String(path ?? "")); if (!dir.startsWith("/") || !existsSync(join(dir, "manifest.json"))) throw new Error("give the absolute path of a skin folder (with manifest.json)");
    let m: SkinManifest; try { m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")); } catch { throw new Error("manifest.json does not parse"); }
    if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(m?.id ?? "")) throw new Error("manifest id: lowercase letters, digits and dashes");
    if (this.builtins().some((b) => b.id === m.id)) throw new Error(`${m.id} is a built-in skin`);
    const network = Array.isArray(m.network) ? m.network.map(String).filter((u) => /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(u)) : [];
    if (network.length && !grantNetwork) throw new Error(`this skin asks for the network (${network.join(", ")}): grant it explicitly to install`);
    const dest = join(this.root, m.id); rmSync(dest, { recursive: true, force: true }); cpSync(dir, dest, { recursive: true, filter: (p) => !/(^|\/)\./.test(relative(dir, p)) });
    const files: Record<string, string> = {}; for (const f of walk(dest)) files[f] = sha(readFileSync(join(dest, f)));
    const lock = { id: m.id, version: m.version, installedAt: new Date().toISOString(), files, network, sha256: sha(Buffer.from(JSON.stringify(files))) };
    writeFileSync(join(this.root, `${m.id}.lock.json`), JSON.stringify(lock, null, 1));
    const c = this.check(m.id);
    if (!c.ok) { this.uninstall(m.id); throw new Error(`the skin fails the compatibility check: ${c.checks.filter((x) => !x.ok).map((x) => `${x.label} (${x.detail})`).join("; ")}`); }
    return { lock, check: c };
  }
  uninstall(id: string) { if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(id)) throw new Error("bad id"); rmSync(join(this.root, id), { recursive: true, force: true }); rmSync(join(this.root, `${id}.lock.json`), { force: true }); }

  /** /skin/<id>/<file>: only pinned files whose bytes still match, with the no-network CSP. /skin/_kit/skin-kit.js is Studio's own. */
  serve(path: string): Response {
    const [, , id, ...rest] = path.split("/"); const rel = decodeURIComponent(rest.join("/"));
    const head = (net: string[], type: string) => ({ "content-type": type, "content-security-policy": skinCsp(net), "x-content-type-options": "nosniff", "cache-control": "no-cache" });
    if (id === "_kit") { const b = rel === "skin-kit.js" ? bundledBytes("skins/kit/skin-kit.js") : null; return b ? new Response(new Uint8Array(b), { headers: head([], TYPES[".js"]) }) : new Response("not found", { status: 404 }); }
    const s = this.src(id); const lock = this.lock(id);
    if (!s || !lock || rel.split("/").includes("..")) return new Response("not found", { status: 404 });
    const want = lock.files[rel]; const b = s.bytes(rel);
    if (!want || !b) return new Response("not found", { status: 404 });
    if (sha(b) !== want) return new Response(`refused: ${rel} no longer matches the sha256 pinned at install`, { status: 409, headers: { "content-type": "text/plain" } });
    return new Response(new Uint8Array(b), { headers: head(lock.network ?? [], TYPES[extname(rel).toLowerCase()] ?? "application/octet-stream") });
  }
}

/** What a skin may see: only the parts its permissions name, nothing that writes. */
export function snapshotFor(perms: string[], d: { tasks: any[]; crew: any[]; pending: any[]; flow: any }) {
  const has = (p: string) => perms.includes(p);
  return {
    permissions: perms,
    tasks: has("snapshot.tasks") ? d.tasks.slice(0, 80).map((t) => ({ id: t.id, title: t.title, status: t.status, node: t.node, door: t.door, round: t.round, pr: t.pr, lastTs: t.lastTs })) : [],
    crew: has("snapshot.crew") ? d.crew.slice(0, 60).map((c) => ({ name: c.name, role: c.role, task: c.task, alive: c.alive, activity: c.activity?.en ?? null })) : [],
    pending: has("snapshot.pending") ? d.pending.map((c) => ({ id: c.id, title: c.details?.en?.title || c.title, kind: c.kind, task: c.task })) : [],
    flow: has("snapshot.flow") ? { nodes: d.flow?.nodes?.map((n: any) => ({ id: n.id, kind: n.kind, label: n.label, lane: n.lane ?? null })) ?? [], edges: d.flow?.edges ?? [] } : null,
    at: new Date().toISOString(),
  };
}
