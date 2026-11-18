// Doctor (doctor:<item>): the Doctor page's rows (src/doctor.ts diagnose, the items GET /api/doctor returns): whether each
// tool, sign-in and setting Studio needs is there, and what fixes it. Paths in a row's text are shown from the home folder
// (~/…), never with a URL's credentials; a row's detail and version quote the tool (untrusted). Reading never installs, signs in or changes anything.
import { homedir } from "node:os";
import { registerKind, type Entity, type Sources } from "../registry";
import { scrubUrlUserinfo } from "../../secure";

const HOME = homedir();
/** A row's text as shown: home paths from ~, and never a URL's userinfo (an endpoint written https://user:pass@host). */
const home = (v: unknown) => { if (typeof v !== "string") return v ?? null; const t = HOME.length > 1 ? v.split(HOME).join("~") : v; return scrubUrlUserinfo(t); };
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
  fields: [...["id", "title", "group", "status", "availability", "authenticated", "adds", "fix", "action"].map((path) => ({ path, trust: "studio" as const })),
    // a row's detail and version quote the tool itself (its --version output, the endpoint it was given): its words, not Studio's
    { path: "detail", trust: "untrusted", source: "the Doctor row's detail (it quotes the tool's own output)" },
    { path: "version", trust: "untrusted", source: "the tool's own --version output" }],
  list: (s, filter) => items(s).filter((i) => !filter.status || i.status === filter.status).map(entity),
  get: (s, id) => { const i = items(s).find((x) => x.id === id); return i ? entity(i) : null; },
});
