// Workflows (workflow:code-firstmate): the Workflows page's catalog rows (engine.defs.list(), the rows GET /api/wf returns)
// and, read one by one, its versions, steps, roles and inputs, and whether a person can start it now. A workflow imported
// from a package someone else wrote shows its name, description and steps as that package's words (untrusted).
import { registerKind, type Entity, type Sources } from "../registry";

const importedOf = (s: Sources, id: string) => { try { return s.engine.defs.get(id)?.origin?.source === "package-import" || id.startsWith("imp-"); } catch { return false; } };

/** One catalog row as an agent reads it: the row GET /api/wf lists (WorkflowDefs.list), its words by who wrote them. */
export function workflowRow(s: Sources, w: any) {
  const defs = s.engine.defs as any, imported = importedOf(s, w.id);
  let unavailable: string | null = null; try { unavailable = defs.unavailable?.(w.id) ?? null; } catch {}
  return { id: w.id, version: w.version, versions: w.versions, kind: w.kind ?? null, nodes: w.nodes, updatedAt: w.updatedAt ?? null, personal: !!w.personal, renamed: !!w.renamed, isTemplate: !!w.isTemplate,
    startable: !unavailable, unavailable, origin: imported ? "package" : w.personal ? "captain" : "studio", inputs: Object.keys(w.params ?? {}),
    ...(imported ? { importedName: w.displayName ?? w.name, importedDescription: w.description ?? "" } : { name: w.displayName ?? w.name, description: w.description ?? "" }) };
}
function full(s: Sources, w: any) {
  const defs = s.engine.defs as any, d = defs.get(w.id), imported = importedOf(s, w.id);
  const steps = (d?.nodes ?? []).map((n: any) => ({ id: n.id, kind: n.kind, role: n.role ?? null, label: n.label ?? n.id }));
  const roles = (d?.roles ?? []).map((r: any) => ({ id: r.id, label: r.label ?? r.id }));
  const inputs = Object.entries(d?.params ?? {}).map(([k, p]: [string, any]) => ({ name: k, label: p?.label ?? k, required: !!p?.required }));
  let versions: any[] = []; try { versions = defs.versions(w.id).map((v: any) => ({ version: v.version, at: v.createdAt ?? null, by: v.by ?? null })); } catch {}
  return { ...workflowRow(s, w), edges: (d?.edges ?? []).length, history: versions.slice(-20), ...(imported ? { importedSteps: steps, importedRoles: roles, importedInputs: inputs } : { steps, roles, inputInfo: inputs }) };
}
const entity = (s: Sources, w: any): Entity => ({ id: w.id, title: importedOf(s, w.id) ? `${w.id} (an imported workflow)` : `${w.displayName ?? w.name ?? w.id}`.slice(0, 100), updatedAt: w.updatedAt ?? null, project: null,
  data: workflowRow(s, w), full: () => full(s, w) });
const rows = (s: Sources): any[] => { try { return (s.engine.defs as any).list(); } catch { return []; } };

registerKind({
  kind: "workflow", route: "#/workflow/:id", listRoute: "#/workflows", idPattern: /^[a-z0-9][a-z0-9-]{0,80}$/, idExample: "code-firstmate",
  pages: ["first-workflow", "gates", "pack", "packs", "pack-draft", "pack-genesis", "fileorg"],
  about: "A workflow in the catalog: its version, steps and roles, its inputs, and whether a person can start it now (and why not).",
  scope: () => null, grantable: true, viewer: "desktop",
  filters: { startable: { type: "boolean", description: "true: only workflows a person can start now" }, personal: { type: "boolean", description: "true: only the captain's own workflows" } },
  fields: [
    ...["id", "version", "versions", "kind", "nodes", "updatedAt", "personal", "renamed", "isTemplate", "startable", "unavailable", "origin", "inputs", "name", "edges", "history", "steps", "roles", "inputInfo"].map((path) => ({ path, trust: "studio" as const })),
    { path: "description", trust: "captain" },
    { path: "importedName", trust: "untrusted", source: "an imported workflow package's name" },
    { path: "importedDescription", trust: "untrusted", source: "an imported workflow package's description" },
    { path: "importedSteps", trust: "untrusted", source: "an imported workflow package's steps" },
    { path: "importedRoles", trust: "untrusted", source: "an imported workflow package's roles" },
    { path: "importedInputs", trust: "untrusted", source: "an imported workflow package's inputs" },
  ],
  list: (s, filter) => rows(s).map((w) => entity(s, w)).filter((e) => (filter.startable !== true || (e.data as any).startable) && (filter.personal !== true || (e.data as any).personal)),
  get: (s, id) => { const w = rows(s).find((x) => x.id === id); return w ? entity(s, w) : null; },
});
