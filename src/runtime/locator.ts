// One locator schema for machine findings and human annotations (docs/check-contract.md).
// A human pin or timeline box is stored in the same shape as a check's finding,
// so a worker cannot tell them apart and acts on both the same way.
export type Locator =
  | { type: "file"; path: string; line?: number | null; end_line?: number | null }
  | { type: "web"; url: string; selector?: string | null; x?: number | null; y?: number | null; w?: number | null; h?: number | null; viewport: { w: number; h: number } }
  | { type: "image"; bbox: [number, number, number, number]; path?: string | null }
  | { type: "timeline"; from: number; to: number; bbox?: [number, number, number, number] | null }
  | { type: "text"; section: string; start?: number | null; end?: number | null }
  | { type: "card"; field: string; index?: number | null };
export type Severity = "blocking" | "minor";
export type Finding = { locator: Locator | null; message: string; expected?: string | null; class: string; severity: Severity; source?: "check" | "judge" | "human" | "firstmate"; check?: string | null };

const num = (v: any) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
/** A locator from untrusted JSON, or null when it does not fit the schema. */
export function parseLocator(o: any): Locator | null {
  if (!o || typeof o !== "object") return null;
  const t = String(o.type ?? "");
  if (t === "file" && typeof o.path === "string" && o.path) return { type: "file", path: o.path.slice(0, 400), line: num(o.line), end_line: num(o.end_line) };
  if (t === "web" && typeof o.url === "string") { const vp = o.viewport && Number.isFinite(Number(o.viewport.w)) ? { w: Number(o.viewport.w), h: Number(o.viewport.h) || 0 } : { w: 1280, h: 800 };
    return { type: "web", url: o.url.slice(0, 400), selector: o.selector ? String(o.selector).slice(0, 400) : null, x: num(o.x), y: num(o.y), w: num(o.w), h: num(o.h), viewport: vp }; }
  if (t === "image" && Array.isArray(o.bbox) && o.bbox.length === 4 && o.bbox.every((x: any) => Number.isFinite(Number(x)))) return { type: "image", bbox: o.bbox.map(Number) as any, path: o.path ? String(o.path) : null };
  if (t === "timeline" && num(o.from) != null && num(o.to) != null && Number(o.to) >= Number(o.from)) return { type: "timeline", from: Number(o.from), to: Number(o.to), bbox: Array.isArray(o.bbox) && o.bbox.length === 4 ? o.bbox.map(Number) as any : null };
  if (t === "text" && typeof o.section === "string") return { type: "text", section: o.section.slice(0, 200), start: num(o.start), end: num(o.end) };
  if (t === "card" && typeof o.field === "string") return { type: "card", field: o.field.slice(0, 100), index: num(o.index) };
  return null;
}
export function parseFinding(o: any, source: Finding["source"] = "check", check: string | null = null): Finding | null {
  if (!o || typeof o !== "object" || !String(o.message ?? "").trim()) return null;
  return { locator: parseLocator(o.locator), message: String(o.message).slice(0, 1500), expected: o.expected ? String(o.expected).slice(0, 800) : null,
    class: String(o.class ?? "unclassified").replace(/[^\w.-]/g, "-").slice(0, 60) || "unclassified", severity: o.severity === "minor" ? "minor" : "blocking", source, check };
}
export function locatorText(l: Locator | null): string {
  if (!l) return "(no locator)";
  switch (l.type) {
    case "file": return `${l.path}${l.line ? `:${l.line}${l.end_line ? `-${l.end_line}` : ""}` : ""}`;
    case "web": return `${l.url}${l.selector ? ` \`${l.selector}\`` : ""}${l.x != null ? ` at (${Math.round(l.x)},${Math.round(l.y ?? 0)}${l.w ? ` ${Math.round(l.w)}×${Math.round(l.h ?? 0)}` : ""})` : ""} @${l.viewport.w}px`;
    case "image": return `image box [${l.bbox.map((x) => Math.round(x)).join(", ")}]`;
    case "timeline": return `${fmtT(l.from)}–${fmtT(l.to)}${l.bbox ? ` box [${l.bbox.map((x) => Math.round(x * 100) / 100).join(", ")}]` : ""}`;
    case "text": return `§${l.section}${l.start != null ? ` chars ${l.start}–${l.end ?? l.start}` : ""}`;
    case "card": return `card ${l.field}${l.index != null ? `[${l.index}]` : ""}`;
  }
}
const fmtT = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;

/** M3 notes (web pins, timeline ranges, document blocks) in the shared schema. */
export function noteLocator(note: { kind: string; selector?: string | null; bbox?: { x: number; y: number; w: number; h: number } | null; t0?: number | null; t1?: number | null; box?: { x: number; y: number; w: number; h: number } | null },
  ctx: { artifact: string; version: number; entry?: string | null; source?: string }): Locator | null {
  if (note.kind === "range") { if (note.t0 == null || note.t1 == null) return null; return { type: "timeline", from: note.t0, to: note.t1, bbox: note.box ? [note.box.x, note.box.y, note.box.w, note.box.h] : null }; }
  if (ctx.source === "md") return { type: "text", section: note.selector ?? "document" };
  const url = `/af/${ctx.artifact}/${ctx.version}/${ctx.entry ?? "index.html"}`;
  return { type: "web", url, selector: note.selector ?? null, x: note.bbox?.x ?? null, y: note.bbox?.y ?? null, w: note.bbox?.w ?? null, h: note.bbox?.h ?? null, viewport: { w: 1280, h: 800 } };
}
/** A human note as a finding: the same type a check produces. */
export function noteFinding(note: { id: string; comment: string; locator?: Locator | null }, loc: Locator | null): Finding {
  return { locator: note.locator ?? loc, message: note.comment, expected: null, class: `captain-note`, severity: "blocking", source: "human", check: `note:${note.id}` };
}
