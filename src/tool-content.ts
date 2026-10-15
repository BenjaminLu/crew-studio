// A tool result may carry a picture for the model (`__image: {mimeType, data}`, base64): the reviewer's typed read of an
// image or a PDF page. Each vendor path hands it on in its own form where the vendor takes images; logs never keep it.
export type ToolImage = { mimeType: string; data: string };
export const imageOf = (r: any): ToolImage | null => (r && typeof r === "object" && r.__image && typeof r.__image.data === "string" && /^image\/(png|jpeg|gif|webp)$/.test(String(r.__image.mimeType)) ? r.__image : null);
/** the result without its picture (a note in its place): what text channels and logs carry */
export function withoutImage(r: any): any { const im = imageOf(r); if (!im) return r; const { __image, ...rest } = r; return { ...rest, image: `attached (${im.mimeType}, ${Math.round((im.data.length * 3) / 4)} bytes)` }; }
/** MCP tools/call content: the picture as an image block, then the result as text */
export function mcpContent(r: any): any[] { const im = imageOf(r); return [...(im ? [{ type: "image", data: im.data, mimeType: im.mimeType }] : []), { type: "text", text: JSON.stringify(withoutImage(r)) }]; }
/** a tool output string as logs and text-only vendors get it: the picture replaced by a note */
export function textOnly(output: string): string { if (!output.includes("__image")) return output; try { return JSON.stringify(withoutImage(JSON.parse(output))); } catch { return output; } }

/**
 * The provider contract for a tool result: its text (never a picture) and, apart, its picture. Every provider takes a
 * result through here: a vendor that takes image input gets the picture as its own content part, every other vendor (and
 * every log, event and UI) gets the text with a short note in the picture's place.
 */
export type ToolResultParts = { text: string; image: ToolImage | null };
export function toolParts(output: string): ToolResultParts {
  if (!output.includes("__image")) return { text: output, image: null };
  try { const r = JSON.parse(output); const im = imageOf(r); return im ? { text: JSON.stringify(withoutImage(r)), image: im } : { text: output, image: null }; } catch { return { text: output, image: null }; }
}
/** what a CLI vendor's tool-result blocks say as text: an image block becomes a note, never its bytes */
export const blocksText = (content: any[]): string => content.map((x: any) => { const mt = x?.mimeType ?? x?.source?.media_type; return x?.type === "image" ? `[image attached${mt ? ` (${mt})` : ""}]` : x?.text ?? ""; }).join(""); // MCP ({data, mimeType}) or Anthropic ({source}) shape
