// Projects (project:harbor-app, and project:studio for work in no project): the Projects page as it reads them, through
// its own functions (src/project-overview.ts sidebar() for the list, page(id) for one project). A project's Tasks and cards
// are named by id and state only: their words are the task and card kinds' (which withhold what they must).
import { registerKind, type Entity, type Sources } from "../registry";

const viewOf = (s: Sources) => { try { return s.projects?.() ?? null; } catch { return null; } };
/** A sidebar row (GET /api/projects/overview): its counts and Studio's status line. */
export function projectRow(r: any) {
  return { id: r.id, name: r.name, enabled: r.enabled !== false, kind: r.kind ?? null, connected: r.connected ?? null, folderMissing: !!r.folderMissing, canStart: r.canStart ?? null,
    attention: r.attention ?? 0, running: r.running ?? 0, held: r.held ?? 0, failed24h: r.failed24h ?? 0, status: r.status ?? null };
}
const ok = (v: any) => v && typeof v === "object" && !("error" in v);
function pageData(s: Sources, id: string): Record<string, unknown> | null {
  let v: any = null; try { v = viewOf(s)?.page(id) ?? null; } catch { return null; } if (!v) return null;
  const p = v.project ?? {};
  return { id: p.id, name: p.name, path: p.path ?? null, base: p.base ?? null, kind: p.kind ?? null, enabled: p.enabled !== false, folderMissing: !!p.folderMissing, canStart: p.canStart ?? null, repository: p.repository ?? null,
    health: Array.isArray(v.health) ? v.health.map((t: any) => ({ key: t.key ?? null, tone: t.tone ?? null, en: t.en ?? null, zh: t.tw ?? null, detail: t.detail?.en ?? null, code: t.code ?? null })) : null,
    tasks: Array.isArray(v.tasks) ? v.tasks.map((t: any) => ({ ref: `task:${t.id}`, workflow: t.workflow, status: t.status, node: t.node ?? null, door: t.door ?? null, rounds: t.rounds ?? null })) : null,
    cards: Array.isArray(v.cards) ? v.cards.map((c: any) => ({ ref: `card:${c.id}`, run: c.run, kind: c.kind, captainOnly: !!c.captainOnly, door: c.door ?? null })) : null,
    github: ok(v.github) ? { connected: !!v.github.connected, verified: !!v.github.verified, repository: v.github.repository ?? v.github.origin ?? null, merge: v.github.merge ?? null } : null,
    sensitive: ok(v.sensitive) ? { project: (v.sensitive.project ?? []).map((r: any) => r.glob), orgCount: v.sensitive.orgCount ?? null, unreadable: v.sensitive.unreadable ?? null } : null };
}
const entity = (s: Sources, r: any): Entity => ({ id: r.id, title: `${r.name ?? r.id}`.slice(0, 100), updatedAt: null, project: r.id === "studio" ? null : r.id,
  data: projectRow(r), full: () => pageData(s, r.id) ?? projectRow(r) });
const rows = (s: Sources): any[] => { try { return viewOf(s)?.sidebar()?.projects ?? []; } catch { return []; } };

registerKind({
  kind: "project", route: "#/project/:id", listRoute: "#/projects", idPattern: /^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/, idExample: "harbor-app",
  about: "A registered project (project:studio: work in no project): whether new work can start, what needs the captain, what runs, its health, GitHub link and sensitive paths.",
  scope: (e) => e.project ?? null, grantable: true, viewer: "desktop",
  fields: [
    ...["id", "name", "enabled", "kind", "connected", "folderMissing", "canStart", "attention", "running", "held", "failed24h", "status", "base", "repository", "health", "tasks", "cards", "github", "sensitive"].map((path) => ({ path, trust: "studio" as const })),
    { path: "path", trust: "captain" },
  ],
  list: (s) => rows(s).map((r) => entity(s, r)),
  get: (s, id) => { const r = rows(s).find((x) => x.id === id); if (!r) return null; const e = entity(s, r); const d = pageData(s, id); return d ? { ...e, data: { ...projectRow(r), ...d, path: undefined } as any, full: () => d } : e; },
});
