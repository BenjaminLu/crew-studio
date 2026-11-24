// A document room's input (docs/units/review-room.md, "A document"): a proposal the captain uploads or pastes on the Review
// Room's home (Markdown, plain text, HTML (a page baton made before included) or a PDF Studio can read text from). The document
// is data, never instructions: it is checked here (its name, its type by extension and by its bytes, its size), kept byte for
// byte by its sha256 (the version's head), and read as text once, at the upload, into the files a run reads. Nothing here
// renders it: Studio never shows an uploaded page outside the explainer's isolated frame, and the explainer shows only what a
// skill made. An executable, an archive, a picture or any type not listed is refused before anything is kept.
import { createHash } from "node:crypto";
import { cleanText } from "./issue-triage";
import { kindOf, magicType, pdfText } from "../review-read";
import type { DocType } from "./review-room";

/** the largest document Studio keeps (its bytes as uploaded); CREW_REVIEW_DOC_MB for a test */
export const DOC_MAX_BYTES = () => (Number(process.env.CREW_REVIEW_DOC_MB) > 0 ? Number(process.env.CREW_REVIEW_DOC_MB) : 4) * 1024 * 1024;
/** the most text a run reads of one document (its extracted text; the original is kept whole) */
export const DOC_TEXT_MAX = 1_500_000;
/** the extensions a document may have, and the type each is read as */
const EXT: Record<string, DocType> = { ".md": "markdown", ".markdown": "markdown", ".txt": "text", ".text": "text", ".html": "html", ".htm": "html", ".pdf": "pdf" };
export const DOC_EXTENSIONS = Object.keys(EXT);
const refuse = (message: string, code: string) => Object.assign(new Error(message), { code });
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const glyph = (t: unknown) => String(t ?? "").replace(/</g, "‹").replace(/>/g, "›");

/** A document's name as the captain gave it: a file's base name (no folder, no control character), at most 160 characters.
 *  Its identity (the room) is that name without its extension, letter case folded and spaces, hyphens and underscores alike: proposal-v.md, Proposal V.html and
 *  pasted text titled "proposal_v" are versions of one document. */
export function docName(raw: unknown, file = true): string | null {
  // a file's name loses its folder; a pasted title keeps its slashes ("Q3 / Q4 plan" is a title, not a path)
  const s = String(raw ?? "").normalize("NFC"), n = (file ? s.replace(/^.*[\\/]/, "") : s).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  // a name with nothing of its own (".md", "_.txt") would share one room with every other such name
  return !n || n === "." || n === ".." || n.length > 160 || !docKey(n) ? null : n;
}
export const docKey = (name: string) => name.replace(/\.[A-Za-z0-9]{1,10}$/, "").normalize("NFKC").toLowerCase().replace(/[\s_-]+/g, " ").trim();
export const docRoomId = (name: string) => `DOC-${sha(`doc\0${docKey(name)}`).slice(0, 12)}`;
const extOf = (name: string) => { const m = /\.[A-Za-z0-9]{1,10}$/.exec(name); return m ? m[0].toLowerCase() : ""; };

/** What a document holds once read: its bytes as uploaded, its type, the text a run reads, and the files kept beside it (a baton
 *  page's packet and context). */
export type ReadDoc = { name: string; title: string; type: DocType; original: Buffer; sha256: string; text: string; pages: number | null; truncated: boolean;
  /** extra files kept with the version: a baton page's packet (baton-data.json) and its context (baton-context.md) */
  extra: { path: string; data: Buffer }[] };

/** Read what the captain sent: {name, base64} (a file) or {title, text} (pasted text, read as Markdown). Refused, with why,
 *  when its name or type is not a document's, it is empty or too big, its bytes are not what its name says (an executable named
 *  .md), a text is not UTF-8, or no text can be read from it (a scanned PDF). */
export function readDocument(input: any): ReadDoc {
  const pasted = typeof input?.text === "string" && input?.base64 == null;
  if (!pasted && typeof input?.base64 !== "string") throw refuse("Send a document: a file (name and its bytes) or pasted text with a title / 請傳一份文件：檔案，或貼上的文字加標題", "bad_request");
  const given = docName(pasted ? input?.title ?? input?.name : input?.name, !pasted);
  if (!given) throw refuse(pasted ? "Give the pasted text a title (at most 160 characters): it names the document / 請替貼上的文字取個標題（最多 160 字）" : "The file has no usable name / 檔名不能用", "bad_name");
  // pasted text is Markdown, whatever its title ends with
  const name = pasted ? ([".md", ".markdown"].includes(extOf(given)) ? given : `${given}.md`) : given, ext = extOf(name), type0 = EXT[ext];
  if (!type0) throw refuse(`Only a document opens a room: ${DOC_EXTENSIONS.join(", ")} (not ${glyph(ext || "a file with no extension")}) / 只有文件能開審查室：${DOC_EXTENSIONS.join("、")}`, "bad_type");
  let original: Buffer;
  if (pasted) original = Buffer.from(String(input.text), "utf8");
  else { const b64 = String(input.base64);
    if (b64.length > Math.ceil(DOC_MAX_BYTES() / 3) * 4 + 8) throw refuse(`The document is larger than ${DOC_MAX_BYTES() / 1024 ** 2} MB / 文件超過 ${DOC_MAX_BYTES() / 1024 ** 2} MB`, "too_large");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) throw refuse("The file's bytes are not base64 / 檔案內容不是 base64", "bad_request");
    original = Buffer.from(b64, "base64"); }
  if (!original.length || !original.toString("utf8").trim() && type0 !== "pdf") throw refuse("The document is empty / 文件是空的", "empty");
  if (original.length > DOC_MAX_BYTES()) throw refuse(`The document is larger than ${DOC_MAX_BYTES() / 1024 ** 2} MB / 文件超過 ${DOC_MAX_BYTES() / 1024 ** 2} MB`, "too_large");
  // its bytes must be what its name says: a PDF is a PDF, anything else UTF-8 text; an executable, an archive or a picture never
  // a text is UTF-8 all through, with no NUL anywhere (not only its first kilobytes)
  const magic = magicType(original), kind = type0 === "pdf" ? kindOf(original) : wholeText(original) ? "text" : kindOf(original) === "text" ? "binary" : kindOf(original);
  if (type0 === "pdf" ? magic !== "application/pdf" : kind !== "text") throw refuse(`${glyph(name)} is not ${type0 === "pdf" ? "a PDF" : "UTF-8 text"} (its bytes read as ${magic === "application/octet-stream" ? kind : magic}): only a document opens a room / 這不是${type0 === "pdf" ? " PDF" : " UTF-8 文字"}：只有文件能開審查室`, "bad_type");
  let type: DocType = type0, text = "", pages: number | null = null; const extra: ReadDoc["extra"] = [];
  const utf8 = () => original.toString("utf8").replace(/^﻿/, "");
  let cut = false;
  if (type0 === "pdf") { const t = pdfText(original, 2000, DOC_TEXT_MAX + 1); pages = t.pages; text = t.text.trim(); cut = t.text.length > DOC_TEXT_MAX;
    if (!text) throw refuse("Studio could not read any text in this PDF (a scanned one has none): export it as Markdown, HTML or text / Studio 讀不到這份 PDF 的文字（掃描的沒有文字）：請匯出成 Markdown、HTML 或純文字", "no_text"); }
  else if (type0 === "html") { const raw = utf8(), baton = batonOf(raw);
    // linear scans only: an HTML document is someone else's bytes, read on Studio's one thread
    if (baton) { type = "baton"; extra.push({ path: "baton-data.json", data: Buffer.from(baton.data, "utf8") }); if (baton.context) extra.push({ path: "baton-context.md", data: Buffer.from(baton.context, "utf8") });
      // a page baton made before: its context carries the document whole (baton's rule), the source a new page is built from
      text = baton.context || baton.text; }
    else text = htmlText(raw);
    if (!text.trim()) throw refuse("Studio could not read any text in this page / Studio 讀不到這個頁面的文字", "no_text"); }
  else text = utf8();
  const truncated = cut || text.length > DOC_TEXT_MAX; if (truncated) text = text.slice(0, DOC_TEXT_MAX);
  return { name, title: titleOf(type, original, text, name), type, original, sha256: sha(original), text, pages, truncated, extra };
}

/** A page baton made (its template: a script baton-data of type application/json, and baton-context of type text/markdown):
 *  its packet as JSON text, its context with render.py's escapes undone ("<\/script", "<\!--"), and the packet's own words. */
export function batonOf(raw: string, low = raw.toLowerCase()): { data: string; context: string; text: string } | null {
  const script = (id: string) => scriptById(raw, low, id);
  const data = script("baton-data"); if (data == null) return null;
  let packet: any; try { packet = JSON.parse(data); } catch { return null; }
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) return null;
  const context = (script("baton-context") ?? "").replace(/<\\(?=\/script|!--)/gi, "<").trim();
  // the packet's words, for a page that carries no context: every string in it, in order
  const words: string[] = []; const walk = (x: any) => { if (typeof x === "string") { if (x.trim()) words.push(x.trim()); } else if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === "object") Object.values(x).forEach(walk); };
  walk(packet);
  return { data: JSON.stringify(packet, null, 1), context, text: words.join("\n").slice(0, DOC_TEXT_MAX) };
}

/** a document's title as it calls itself (a baton packet's title, a page's <title> or first heading, a Markdown's first
 *  heading), else its name: someone else's words, cleaned, every angle bracket a glyph, at most 160 characters */
function titleOf(type: DocType, original: Buffer, text: string, name: string): string {
  let t = "";
  if (type === "baton" || type === "html") { const raw = original.toString("utf8"), low = raw.toLowerCase();
    if (type === "baton") { try { const p = JSON.parse(scriptById(raw, low, "baton-data") ?? "{}"); t = typeof p.title === "string" ? p.title : p.title?.en ?? p.title?.hant ?? p.title?.["zh-TW"] ?? ""; } catch {} }
    else t = (inner(raw, low, "title") ?? inner(raw, low, "h1") ?? "").slice(0, 2000).replace(/<[^>]*>/g, " "); }
  else if (type === "markdown") t = /^#\s+(.+)$/m.exec(text)?.[1] ?? "";
  const clean = glyph(cleanText(String(t).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim(), 160));
  return clean || glyph(name.replace(/\.[A-Za-z0-9]{1,10}$/, ""));
}

// ---------- linear HTML reading: indexOf scans, never a pattern that backtracks over someone else's bytes ----------
/** UTF-8 from the first byte to the last, and no NUL anywhere */
function wholeText(b: Buffer): boolean { if (b.includes(0)) return false; try { new TextDecoder("utf-8", { fatal: true }).decode(b); return true; } catch { return false; } }
/** the text of the script whose start tag carries id="<id>" (or '<id>'): its start tag found back from the id, its end after it */
function scriptById(raw: string, low: string, id: string): string | null {
  for (const q of ['"', "'"]) { const at = low.indexOf(`id=${q}${id}${q}`); if (at < 0) continue;
    const open = low.lastIndexOf("<script", at), gt = low.indexOf(">", at); if (open < 0 || gt < 0 || low.indexOf(">", open) < at) continue;
    const end = low.indexOf("</script", gt); return end < 0 ? null : raw.slice(gt + 1, end); }
  return null;
}
/** the inside of the first <name …>…</name> */
function inner(raw: string, low: string, name: string): string | null {
  const open = low.indexOf(`<${name}`); if (open < 0) return null; const gt = low.indexOf(">", open); if (gt < 0) return null;
  const end = low.indexOf(`</${name}`, gt); return end < 0 ? null : raw.slice(gt + 1, end);
}
const SKIP = new Set(["script", "style", "template", "noscript", "svg", "head"]), VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const BLOCK = new Set(["p", "div", "li", "tr", "section", "article", "table", "ul", "ol", "br", "blockquote", "pre", "dd", "dt"]);
/** elements whose end tag HTML lets an author leave out: the next one of the same name (or the parent's end) closes them */
const OPEN_ENDED = new Set(["li", "p", "dt", "dd", "tr", "td", "th", "option"]);
/** hidden: the hidden attribute (a name outside any quoted value), or display:none / visibility:hidden in the style attribute's
 *  own value; a class that merely says "hidden" is not read (Studio does not read stylesheets) */
const hiddenTag = (tag: string) => {
  if (/(?:^|\s)hidden(?=[\s=/]|$)/.test(tag.replace(/"[^"]*"|'[^']*'/g, '""'))) return true;
  const st = /(?:^|\s)style\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/.exec(tag), css = st ? st[1] ?? st[2] ?? st[3] ?? "" : "";
  return /display\s*:\s*none|visibility\s*:\s*hidden/.test(css); };
/** the end of the tag that starts at lt: the first ">" outside a quoted value (-1: the tag never ends) */
const tagEnd = (raw: string, lt: number) => { let q = ""; for (let j = lt + 1; j < raw.length; j++) { const c = raw[j]; if (q) { if (c === q) q = ""; } else if (c === '"' || c === "'") q = c; else if (c === ">") return j; } return -1; };
/** An HTML document's visible text, in linear time: no script, style, template, noscript or head; an element hidden by its
 *  hidden attribute or an inline display:none / visibility:hidden dropped with what it holds; a figure a mark; headings as
 *  Markdown. A hidden element that never closes (an end tag left out) hides nothing: that part is read once more, unhidden. */
export function htmlText(raw: string): string {
  const low = raw.toLowerCase(), n = raw.length;
  const pass = (from: number, hide: boolean): { out: string[]; reopen: number | null } => {
    const out: string[] = []; let i = from, hidden: { name: string; depth: number; at: number; mark: number } | null = null;
    while (i < n) {
      const lt = raw.indexOf("<", i); if (lt < 0) { if (!hidden) out.push(raw.slice(i)); break; }
      if (!hidden) out.push(raw.slice(i, lt));
      if (raw.startsWith("<!--", lt)) { const e = raw.indexOf("-->", lt + 4); if (e < 0) break; i = e + 3; continue; }
      // a tag that never ends (an unclosed quote, a stray "<") ends the reading: never scanned again from each "<" after it
      const gt = tagEnd(raw, lt); if (gt < 0) { if (!hidden) out.push(raw.slice(lt)); break; }
      const tag = low.slice(lt + 1, gt), m = /^(\/?)([a-z][a-z0-9:-]{0,40})/.exec(tag);
      if (!m) { i = gt + 1; if (!hidden) out.push(" "); continue; }
      const close = m[1] === "/", name = m[2];
      if (!close && SKIP.has(name)) { i = gt + 1; if (name === "svg" && !hidden) out.push(" [figure] "); const e = low.indexOf(`</${name}`, i); if (e < 0) break; const g = low.indexOf(">", e); i = g < 0 ? n : g + 1; continue; }
      if (hidden) {
        if (VOID.has(name)) { i = gt + 1; continue; }
        if (name === hidden.name) {
          // a second <li> (or <p>, <tr> …) at the same depth ends an open-ended hidden one; this tag is then read as usual
          if (!close && hidden.depth === 1 && OPEN_ENDED.has(name)) { hidden = null; i = lt; continue; }
          hidden.depth += close ? -1 : 1; i = gt + 1; if (!hidden.depth) hidden = null; continue; }
        // the parent's end closes an open-ended hidden element; it is then read as usual
        if (close && hidden.depth === 1 && OPEN_ENDED.has(hidden.name)) { hidden = null; i = lt; continue; }
        i = gt + 1; continue; }
      i = gt + 1;
      if (hide && !close && !VOID.has(name) && hiddenTag(tag)) { hidden = { name, depth: 1, at: lt, mark: out.length }; continue; }
      out.push(/^h[1-6]$/.test(name) ? (close ? "\n" : "\n\n## ") : BLOCK.has(name) ? "\n" : " ");
    }
    return { out, reopen: hidden ? hidden.at : null };
  };
  const first = pass(0, true), parts = first.out;
  // a hidden element still open at the end hid the rest by mistake: read from it again without hiding (once: linear)
  if (first.reopen !== null) parts.push(...pass(first.reopen, false).out);
  return parts.join("").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
