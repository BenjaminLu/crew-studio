// Artifacts (artifact:<id>): the Library as it reads them (src/artifacts.ts ArtifactStore.view(), what GET /api/artifacts
// returns): each artifact's versions, which one is approved, who made each, what it cost and how its render went. A
// version's summary is its maker's (a model's) words, so it is untrusted; so is a render's detail (it may quote a tool).
// Reading never approves, renders or makes a version.
import { registerKind, type Entity, type Sources } from "../registry";

const storeOf = (s: Sources): any => { try { return s.artifacts?.() ?? null; } catch { return null; } };
const view = (s: Sources): any[] => { try { return storeOf(s)?.view?.() ?? []; } catch { return []; } };
/** One Library row (ArtifactStore.view()) as an agent reads it; `all`: every version, else the last five. */
export function artifactRow(a: any, all = false) {
  const vs = a.versions ?? [];
  return { id: a.id, type: a.type, source: a.source, project: a.project ?? null, created: a.created, entry: a.entry ?? null, title: a.title, latest: a.latest ?? null, approved: a.approved ?? null,
    versions: (all ? vs : vs.slice(-5)).reverse().map((v: any) => ({ n: v.n, status: v.status, createdAt: v.createdAt, createdBy: v.createdBy ? { kind: v.createdBy.kind, provider: v.createdBy.provider ?? null, model: v.createdBy.model ?? null, run: v.createdBy.run ?? null } : null,
      approvedBy: v.approvedBy ?? null, approvedAt: v.approvedAt ?? null, parent: v.parent ?? null, cost: v.cost ?? null, notes: v.notes ?? 0, files: v.fileCount ?? null,
      render: v.render ? { state: v.render.state, ms: v.render.ms ?? null, detail: v.render.detail ?? null } : null, summary: v.summary ?? null })) };
}
const entity = (a: any): Entity => ({ id: a.id, title: `${a.id} (${a.type}${a.approved ? `, v${a.approved} approved` : a.latest ? `, v${a.latest}` : ""})`, updatedAt: a.versions?.at(-1)?.createdAt ?? a.created ?? null, project: a.project ?? null,
  data: artifactRow(a), full: () => artifactRow(a, true) });

export const ARTIFACT_FIELDS = [
  ...["id", "type", "source", "project", "created", "entry", "latest", "approved", "versions[].n", "versions[].status", "versions[].createdAt", "versions[].createdBy", "versions[].approvedBy", "versions[].approvedAt",
    "versions[].parent", "versions[].cost", "versions[].notes", "versions[].files", "versions[].render.state", "versions[].render.ms", "withheld"].map((path) => ({ path, trust: "studio" as const })),
  { path: "title", trust: "captain" as const },
  { path: "versions[].summary", trust: "untrusted" as const, source: "the version's maker's summary (a model)" },
  { path: "versions[].render.detail", trust: "untrusted" as const, source: "the renderer's message (it may quote a tool's output)" },
];
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

registerKind({
  kind: "artifact", route: "#/artifact/:id", listRoute: "#/library", idPattern: ID, idExample: "harbor-banner",
  pages: ["review", "compare", "changes"],
  about: "An artifact in the Library (a page, a film, an image, a document): its versions, which one is approved, who made each, its cost and render.",
  scope: (e) => e.project ?? null, grantable: true, viewer: "desktop",
  filters: { type: { type: "string", description: "web, video, image, doc or audio", enum: ["web", "video", "image", "doc", "audio"] }, project: { type: "string", description: "a project id" } },
  fields: ARTIFACT_FIELDS,
  list: (s, filter) => view(s).filter((a) => (!filter.type || a.type === filter.type) && (!filter.project || a.project === filter.project)).map(entity),
  get: (s, id) => { const a = view(s).find((x) => x.id === id); return a ? entity(a) : null; },
});
