// The crew (crew:worker, one per seat): the team the captain approved on the Crew page (src/domain/crew.ts: the config
// CrewStore.current() holds, read through teamBody, the function the Crew page's own view uses), each seat's provider, model,
// effort and pinned skills, and the team's version and who approved it. Reading changes no seat: a change is proposed with
// studio_propose_crew_change and only the captain approves it.
import { registerKind, type Entity, type Sources } from "../registry";
import { teamBody } from "../../domain/crew";

const cfgOf = (s: Sources): any => { try { return s.crew?.() ?? null; } catch { return null; } };
/** One seat as the Crew page shows it: who sits in it, with what skills; overrides per workflow and project, counted. */
export function seatRow(cfg: any, seat: string) {
  const t = teamBody(cfg), m = t.members[seat], decl = t.seats?.[seat];
  const overrides = Object.values(t.workflows ?? {}).reduce((n: number, w: any) => n + Object.values(w.nodes ?? {}).filter((o: any) => o.seat === seat).length, 0);
  const projects = Object.entries(t.projects ?? {}).filter(([, p]: [string, any]) => !!p.seats?.[seat]).map(([id]) => id);
  return { seat, label: decl?.label ?? seat, provider: m?.provider ?? null, model: m?.model ?? null, effort: m?.effort ?? null, skills: (m?.skills ?? []).map((p: any) => `${p.id}@v${p.v}`),
    needs: decl?.needs ?? [], reviews: decl?.reviews ?? null, workflowOverrides: overrides, projectOverrides: projects, team: { version: cfg.version, approvedBy: cfg.approval?.by ?? null, via: cfg.approval?.via ?? null } };
}
const seats = (cfg: any): string[] => { if (!cfg) return []; const t = teamBody(cfg); return [...new Set([...Object.keys(t.members ?? {}), ...Object.keys(t.seats ?? {})])]; };
const entity = (cfg: any, seat: string): Entity => ({ id: seat, title: `${seat} seat`, updatedAt: null, project: null, data: seatRow(cfg, seat) });

registerKind({
  kind: "crew", route: "#/crew", listRoute: "#/crew", idPattern: /^[a-z][a-z0-9-]{0,40}$/, idExample: "worker",
  pages: ["team"],
  about: "A seat of the approved crew: its provider, model, effort and pinned skills, the workflows and projects that change it, and the team's version.",
  scope: () => null, grantable: true, viewer: "desktop",
  fields: ["seat", "label", "provider", "model", "effort", "skills", "needs", "reviews", "workflowOverrides", "projectOverrides", "team"].map((path) => ({ path, trust: "studio" as const })),
  list: (s) => { const cfg = cfgOf(s); return seats(cfg).map((x) => entity(cfg, x)); },
  get: (s, id) => { const cfg = cfgOf(s); return seats(cfg).includes(id) ? entity(cfg, id) : null; },
});
