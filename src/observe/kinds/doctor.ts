// Doctor (doctor:<item>): the Doctor page's rows (src/doctor.ts diagnose, the items GET /api/doctor returns): whether each
// tool, sign-in and setting Studio needs is there, and what fixes it. Paths in a row's text are shown from the home folder
// (~/…). Reading never installs, signs in or changes anything.
import { homedir } from "node:os";
import { registerKind, type Entity, type Sources } from "../registry";

const HOME = homedir();
const home = (v: unknown) => (typeof v === "string" && HOME.length > 1 ? v.split(HOME).join("~") : v ?? null);
const items = (s: Sources): any[] => { try { return s.doctor?.() ?? []; } catch { return []; } };
/** One Doctor row as an agent reads it. */
export function doctorRow(i: any) {
  return { id: i.id, title: i.title, group: i.group ?? null, status: i.status, availability: i.availability ?? null, authenticated: i.authenticated ?? null, version: i.version ?? null,
    detail: home(i.detail), adds: i.adds ?? null, fix: home(i.fix), action: i.action ? (typeof i.action === "string" ? i.action : i.action.kind ?? null) : null };
}
const entity = (i: any): Entity => ({ id: i.id, title: `${i.title ?? i.id} (${i.status})`, updatedAt: null, project: null, data: doctorRow(i) });

registerKind({
  kind: "doctor", route: "#/doctor", listRoute: "#/doctor", idPattern: /^[a-z0-9][a-z0-9._-]{0,60}$/, idExample: "claude",
  about: "A Doctor row: whether a tool, sign-in or setting Studio needs is there (ok, degraded, missing), its version and what fixes it.",
  scope: () => null, grantable: true, viewer: "desktop",
  filters: { status: { type: "string", description: "ok, degraded, missing or info", enum: ["ok", "degraded", "missing", "info"] } },
  fields: ["id", "title", "group", "status", "availability", "authenticated", "version", "detail", "adds", "fix", "action"].map((path) => ({ path, trust: "studio" as const })),
  list: (s, filter) => items(s).filter((i) => !filter.status || i.status === filter.status).map(entity),
  get: (s, id) => { const i = items(s).find((x) => x.id === id); return i ? entity(i) : null; },
});
