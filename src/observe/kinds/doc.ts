// Documents (doc:<id>): the Documents page as it reads them (src/docs.ts docRows, the rows GET /api/docs returns): a
// Markdown artifact's versions, words, open notes and whether it prints as a PDF here. Its text is its writer's (a model's or
// the captain's), so at depth full the latest version's Markdown comes wrapped as untrusted. Reading never approves,
// exports or asks the writer for a change.
import { readFileSync } from "node:fs";
import { registerKind, type Entity, type Sources } from "../registry";
import { docRows } from "../../docs";
import { artifactRow, ARTIFACT_FIELDS } from "./artifact";

const storeOf = (s: Sources): any => { try { return s.artifacts?.() ?? null; } catch { return null; } };
const rows = (s: Sources): any[] => { const st = storeOf(s); if (!st) return []; try { return docRows(st); } catch { return []; } };
const docData = (d: any, all = false) => ({ ...artifactRow(d, all), words: d.words ?? 0, openNotes: d.openNotes ?? 0, pdfUnavailable: !!d.pdfUnavailable });
const entity = (s: Sources, d: any): Entity => ({ id: d.id, title: `${d.id} (document${d.approved ? `, v${d.approved} approved` : d.latest ? `, v${d.latest}` : ""})`, updatedAt: d.versions?.at(-1)?.createdAt ?? d.created ?? null, project: d.project ?? null,
  data: docData(d),
  full: () => { let text: string | null = null; try { const st = storeOf(s), f = d.latest ? st?.mdSource(d.id, d.latest) : null; text = f ? readFileSync(f, "utf8").slice(0, 16_000) : null; } catch {} return { ...docData(d, true), text }; } });

registerKind({
  kind: "doc", route: "#/doc/:id", listRoute: "#/docs", idPattern: /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, idExample: "harbor-brief",
  about: "A document: its versions, which one is approved, its words and open notes, and (depth full) its latest text, as untrusted.",
  scope: (e) => e.project ?? null, grantable: true, viewer: "desktop",
  fields: [...ARTIFACT_FIELDS, ...["words", "openNotes", "pdfUnavailable"].map((path) => ({ path, trust: "studio" as const })),
    { path: "text", trust: "untrusted", source: "the document's Markdown (its writer: a model or the captain)" }],
  list: (s) => rows(s).map((d) => entity(s, d)),
  get: (s, id) => { const d = rows(s).find((x) => x.id === id); return d ? entity(s, d) : null; },
});
