// Every workflow Studio knows: the built-in ones (workflows/*.flow.yaml) and the
// ones domain packs bring. Each has nodes and edges (the graph), roles with a
// skill source, optional script gates per node, and optionally a retro config.
//   skill sources:  fm:<path>        a file in the firstmate checkout (read-only)
//                   pack:<id>/<path> a file inside an installed or built-in pack
//                   bundled:<path>   a file shipped with Studio
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { bundledList, bundledText, parseYaml } from "./bundled";
import type { RetroConfig } from "./retro";

export type GateDef = { id: string; label?: string; builtin?: string; run?: string[]; args?: Record<string, any>; when?: { door?: string[] }; timeout_s?: number;
  cycle?: { worker: string; reviewer: string; max_rounds?: number } };
export type FlowNode = { id: string; kind: string; label: string; detail?: string; x: number; y: number; lane?: string; gates?: GateDef[] };
export type Role = { id: string; label: string; skill: string };
export type Flow = { id: string; name: string; version: number | string; nodes: FlowNode[]; edges: [string, string, string?][]; roles: Role[]; retro?: string | RetroConfig | null;
  pack?: string | null; description?: string };

export class Workflows {
  /** Extra sources (packs) register here. */
  extra: (() => { flow: Flow; read: (rel: string) => string | null }[]) | null = null;
  constructor(readonly fmRoot: string) {}
  private builtins(): { flow: Flow; read: (rel: string) => string | null }[] {
    return bundledList("workflows/").filter((f) => f.endsWith(".flow.yaml")).map((f) => {
      const text = bundledText(f); const flow = parseYaml(text ?? "") as Flow; if (!flow) throw new Error(`missing bundled workflow ${f}; bytes=${text?.length ?? "null"}`); flow.roles ??= []; flow.pack = null;
      return { flow, read: (rel: string) => bundledText(rel) };
    });
  }
  all() { return [...this.builtins(), ...(this.extra?.() ?? [])]; }
  list(): Flow[] { return this.all().map((x) => x.flow); }
  get(id: string) { return this.all().find((x) => x.flow.id === id) ?? null; }
  /** The text of a role's source skill (never written). */
  sourceSkill(wf: string, role: string): { text: string; source: string } | null {
    const w = this.get(wf); const r = w?.flow.roles.find((x) => x.id === role); if (!w || !r) return null;
    if (r.skill.startsWith("fm:")) { const p = join(this.fmRoot, r.skill.slice(3)); return existsSync(p) ? { text: readFileSync(p, "utf8"), source: p } : null; }
    if (r.skill.startsWith("bundled:")) { const t = bundledText(r.skill.slice(8)); return t == null ? null : { text: t, source: r.skill }; } // a Studio role skill, for a pack's flow too
    const rel = r.skill.replace(/^pack:/, "");
    const t = w.read(rel); return t == null ? null : { text: t, source: r.skill };
  }
  retro(wf: string): RetroConfig | null {
    const w = this.get(wf); if (!w?.flow.retro) return null;
    if (typeof w.flow.retro === "object") return w.flow.retro as RetroConfig;
    const t = w.read(w.flow.retro); return t ? (parseYaml(t) as RetroConfig) : null;
  }
}
