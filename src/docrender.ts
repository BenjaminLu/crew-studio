// Documents (M8): Markdown → blocks → HTML (with stable block ids for pins and
// the source line for briefs), and exports with no external dependency:
// Markdown, standalone HTML, DOCX (OOXML, zipped here), a built-in PDF writer
// (Latin fonts: the fallback docpdf.ts uses without a page renderer) and the
// PDF text reader that checks an exported PDF shows the document's words.
import { createHash } from "node:crypto";
import { deflateRawSync, inflateSync } from "node:zlib";

export type Inline = { text: string; b?: boolean; i?: boolean; code?: boolean; href?: string };
export type Block = { kind: "h" | "p" | "ul" | "ol" | "quote" | "code" | "hr" | "table"; level?: number; line: number; text: string; items?: string[]; rows?: string[][] };
// a GFM table: a header row of cells, then a |---|:--:| separator; cells split on unescaped pipes
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const cells = (l: string) => l.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));

export function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i], ln = i + 1;
    if (!l.trim()) { i++; continue; }
    if (/^```/.test(l)) { const buf: string[] = []; i++; while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]); i++; out.push({ kind: "code", line: ln, text: buf.join("\n") }); continue; }
    const hd = /^(#{1,6})\s+(.*)$/.exec(l); if (hd) { out.push({ kind: "h", level: hd[1].length, line: ln, text: hd[2].trim() }); i++; continue; }
    if (/^(\*\s*\*\s*\*|-\s*-\s*-|_\s*_\s*_)[\s*_-]*$/.test(l)) { out.push({ kind: "hr", line: ln, text: "" }); i++; continue; }
    if (/^>\s?/.test(l)) { const buf: string[] = []; while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, "")); out.push({ kind: "quote", line: ln, text: buf.join(" ").trim() }); continue; }
    if (/^\s*[-*+]\s+/.test(l)) { const items: string[] = []; while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*+]\s+/, "").trim()); out.push({ kind: "ul", line: ln, text: items.join("\n"), items }); continue; }
    if (/^\s*\d+[.)]\s+/.test(l)) { const items: string[] = []; while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, "").trim()); out.push({ kind: "ol", line: ln, text: items.join("\n"), items }); continue; }
    const tableAt = (j: number) => lines[j].includes("|") && TABLE_SEP.test(lines[j + 1] ?? "") && lines[j + 1].includes("|");
    if (tableAt(i)) { const raw = [lines[i]], rows = [cells(lines[i])]; i += 2; while (i < lines.length && lines[i].trim() && lines[i].includes("|")) { raw.push(lines[i]); rows.push(cells(lines[i++])); }
      out.push({ kind: "table", line: ln, text: raw.join("\n"), rows }); continue; }
    const buf: string[] = []; while (i < lines.length && lines[i].trim() && !tableAt(i) && !/^(#{1,6}\s|```|>|\s*[-*+]\s+|\s*\d+[.)]\s+)/.test(lines[i])) buf.push(lines[i++].trim());
    out.push({ kind: "p", line: ln, text: buf.join(" ") });
  }
  return out;
}

export function inlines(s: string): Inline[] {
  const out: Inline[] = []; const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\))/g;
  let last = 0, m;
  while ((m = re.exec(s))) { if (m.index > last) out.push({ text: s.slice(last, m.index) });
    if (m[2]) out.push({ text: m[2], b: true }); else if (m[3] || m[4]) out.push({ text: m[3] ?? m[4], i: true }); else if (m[5]) out.push({ text: m[5], code: true }); else out.push({ text: m[6], href: m[7] });
    last = re.lastIndex; }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out;
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const inlineHtml = (s: string) => inlines(s).map((x) => x.b ? `<strong>${esc(x.text)}</strong>` : x.i ? `<em>${esc(x.text)}</em>` : x.code ? `<code>${esc(x.text)}</code>` : x.href ? (/^(https?:|mailto:|#)/.test(x.href) ? `<a href="${esc(x.href)}">${esc(x.text)}</a>` : esc(x.text)) : esc(x.text)).join("");
/** A block's id stays the same across versions while its text does (pins follow it); an edited block gets a new one. */
export const blockId = (b: Block, seen: Map<string, number>) => { const h = createHash("sha1").update(`${b.kind}${b.level ?? ""}:${b.text}`).digest("hex").slice(0, 8); const n = (seen.get(h) ?? 0) + 1; seen.set(h, n); return n > 1 ? `b${h}-${n}` : `b${h}`; };

// CJK text falls through the Latin faces to the system's CJK fonts; html[lang] picks the regional glyph forms
const DOC_CSS = `:root{color-scheme:light dark;--bg:#fff;--fg:#1d2230;--mute:#5b6476;--rule:#dde2ea;--code:#f3f5f8;--acc:#2f5bd3;--cjk:"PingFang TC","Noto Sans CJK TC","Source Han Sans TC","Microsoft JhengHei","Hiragino Sans","Noto Sans CJK JP","PingFang SC","Noto Sans CJK SC","Microsoft YaHei"}
:root:lang(zh-Hans){--cjk:"PingFang SC","Noto Sans CJK SC","Source Han Sans SC","Microsoft YaHei","PingFang TC","Noto Sans CJK TC"}:root:lang(ja){--cjk:"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans CJK JP","Yu Gothic","PingFang TC"}:root:lang(ko){--cjk:"Apple SD Gothic Neo","Noto Sans CJK KR","Malgun Gothic","PingFang TC"}
@media (prefers-color-scheme:dark){:root{--bg:#14171d;--fg:#e6e9ef;--mute:#9aa3b5;--rule:#2b3140;--code:#1d2129;--acc:#86a6ff}}
html{background:var(--bg)}body{max-width:720px;margin:0 auto;padding:48px 24px 80px;font:17px/1.65 Charter,"Iowan Old Style",Georgia,var(--cjk),serif;color:var(--fg);background:var(--bg)}
h1,h2,h3,h4{font-family:system-ui,-apple-system,"Segoe UI",var(--cjk),sans-serif;line-height:1.25;margin:1.6em 0 .5em}h1{font-size:2em;margin-top:0}h2{font-size:1.4em}h3{font-size:1.15em}
p,ul,ol,blockquote,pre,table{margin:0 0 1em}blockquote{border-left:3px solid var(--rule);padding-left:14px;color:var(--mute)}
code{font:.88em ui-monospace,Menlo,Consolas,var(--cjk),monospace;background:var(--code);padding:.1em .3em;border-radius:4px}pre{background:var(--code);padding:12px 14px;border-radius:8px;overflow:auto}pre code{background:none;padding:0}
table{border-collapse:collapse}th,td{border:1px solid var(--rule);padding:4px 8px;text-align:left;vertical-align:top}
hr{border:0;border-top:1px solid var(--rule);margin:2em 0}a{color:var(--acc)}
@page{size:A4;margin:18mm 16mm}@media print{:root{--bg:#fff;--fg:#1d2230;--mute:#5b6476;--rule:#c9d0db;--code:#f3f5f8}body{max-width:none;padding:0;font-size:11.5pt}a{color:inherit}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:9.5pt}h1,h2,h3,h4{break-after:avoid}pre,blockquote,tr,li{break-inside:avoid}}`;
/** The language a document is written in, for html[lang] and Word's East Asian font: kana → ja, hangul → ko,
 *  Han → zh-Hant unless simplified-only forms outnumber traditional-only ones; otherwise en. */
export function docLang(md: string): "en" | "ja" | "ko" | "zh-Hant" | "zh-Hans" {
  if (/[\u3040-\u30ff]/.test(md)) return "ja";
  if (/[\uac00-\ud7af]/.test(md)) return "ko";
  if (!/[\u3400-\u9fff]/.test(md)) return "en";
  const count = (set: string) => [...md].filter((c) => set.includes(c)).length;
  return count("这们说为对时会过还没发经么个来问东车门见长现实开关应该样书") > count("這們說為對時會過還沒發經麼個來問東車門見長現實開關應該樣書") ? "zh-Hans" : "zh-Hant";
}

/** The rendered page a doc version carries (doc.html): each block has an id and its doc.md line. */
export function mdToDocHtml(md: string, title?: string): string {
  const seen = new Map<string, number>();
  const body = parseBlocks(md).map((b) => {
    const a = `id="${blockId(b, seen)}" data-line="${b.line}"`;
    if (b.kind === "h") return `<h${b.level} ${a}>${inlineHtml(b.text)}</h${b.level}>`;
    if (b.kind === "ul" || b.kind === "ol") return `<${b.kind} ${a}>${b.items!.map((x) => `<li>${inlineHtml(x)}</li>`).join("")}</${b.kind}>`;
    if (b.kind === "quote") return `<blockquote ${a}>${inlineHtml(b.text)}</blockquote>`;
    if (b.kind === "code") return `<pre ${a}><code>${esc(b.text)}</code></pre>`;
    if (b.kind === "table") { const [head, ...body] = b.rows!; return `<table ${a}><thead><tr>${head.map((c) => `<th>${inlineHtml(c)}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${head.map((_, k) => `<td>${inlineHtml(r[k] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table>`; }
    if (b.kind === "hr") return `<hr ${a}>`;
    return `<p ${a}>${inlineHtml(b.text)}</p>`;
  }).join("\n");
  const t = title ?? parseBlocks(md).find((b) => b.kind === "h")?.text ?? "Document";
  return `<!doctype html>\n<html lang="${docLang(md)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(t)}</title><style>${DOC_CSS}</style></head>\n<body>\n${body}\n</body></html>\n`;
}
/** The md line and text of a pinned block, from the version's doc.html and doc.md. */
export function blockAt(html: string, md: string, selector: string | null | undefined): { line: number; text: string } | null {
  const id = /^#(b[0-9a-f]{8}(?:-\d+)?)$/.exec(selector ?? "")?.[1]; if (!id) return null;
  const m = new RegExp(`id="${id}" data-line="(\\d+)"`).exec(html); if (!m) return null;
  const line = Number(m[1]); return { line, text: (md.split("\n")[line - 1] ?? "").slice(0, 160) };
}

// ---------- DOCX ----------
const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
/** A zip of the given files (deflate), as a Buffer. */
export function zip(files: { name: string; data: Buffer | string }[]): Buffer {
  const parts: Buffer[] = [], central: Buffer[] = []; let off = 0;
  for (const f of files) {
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, "utf8"); const comp = deflateRawSync(raw); const name = Buffer.from(f.name, "utf8"); const crc = crc32(raw);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    parts.push(lh, name, comp);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10); ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    central.push(ch, name); off += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}
const x = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!)).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
// Word picks a run's East Asian font from w:eastAsia (and the docDefaults' lang); a run with CJK text is hinted so
// shared punctuation follows it too
const CJK = /[\u3000-\u30ff\u3400-\u9fff\uac00-\ud7af\uff00-\uffef]/;
const EA_FONT = { "zh-Hant": "Microsoft JhengHei", "zh-Hans": "Microsoft YaHei", ja: "Yu Gothic", ko: "Malgun Gothic", en: "Microsoft JhengHei" } as const;
const EA_LANG = { "zh-Hant": "zh-TW", "zh-Hans": "zh-CN", ja: "ja-JP", ko: "ko-KR", en: "zh-TW" } as const;
const runs = (s: string, ea: string) => inlines(s).map((r) => { const hint = CJK.test(r.text) ? ' w:hint="eastAsia"' : "";
  const fonts = r.code ? `<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:eastAsia="${ea}"${hint}/>` : hint ? `<w:rFonts w:eastAsia="${ea}"${hint}/>` : "";
  return `<w:r><w:rPr>${fonts}${r.b ? "<w:b/>" : ""}${r.i ? "<w:i/>" : ""}${r.href ? '<w:color w:val="2F5BD3"/><w:u w:val="single"/>' : ""}</w:rPr><w:t xml:space="preserve">${x(r.text)}</w:t></w:r>`; }).join("");
export function toDocx(md: string, title: string): Buffer {
  const ps: string[] = []; const lang = docLang(md), ea = EA_FONT[lang];
  const para = (style: string | null, inner: string, extra = "") => ps.push(`<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${extra}</w:pPr>${inner}</w:p>`);
  for (const b of parseBlocks(md)) {
    if (b.kind === "h") para(`Heading${Math.min(3, b.level!)}`, runs(b.text, ea));
    else if (b.kind === "ul" || b.kind === "ol") b.items!.forEach((it, i) => para("ListParagraph", `<w:r><w:t xml:space="preserve">${b.kind === "ul" ? "•" : `${i + 1}.`}\t</w:t></w:r>${runs(it, ea)}`, '<w:ind w:left="720" w:hanging="360"/>'));
    else if (b.kind === "quote") para("Quote", runs(b.text, ea));
    else if (b.kind === "table") { const n = b.rows![0].length, cell = (c: string, head: boolean) => `<w:tc><w:tcPr><w:tcW w:w="${Math.floor(9026 / n)}" w:type="dxa"/></w:tcPr><w:p><w:pPr><w:spacing w:after="0"/></w:pPr>${runs(head ? `**${c}**` : c, ea)}</w:p></w:tc>`;
      const border = (k: string) => `<w:${k} w:val="single" w:sz="4" w:space="0" w:color="BBBBBB"/>`;
      ps.push(`<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(border).join("")}</w:tblBorders><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${b.rows![0].map(() => `<w:gridCol w:w="${Math.floor(9026 / n)}"/>`).join("")}</w:tblGrid>${b.rows!.map((r, ri) => `<w:tr>${b.rows![0].map((_, k) => cell(r[k] ?? "", ri === 0)).join("")}</w:tr>`).join("")}</w:tbl><w:p/>`); }
    else if (b.kind === "code") for (const l of b.text.split("\n")) para("Code", `<w:r>${CJK.test(l) ? `<w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:eastAsia="${ea}" w:hint="eastAsia"/></w:rPr>` : ""}<w:t xml:space="preserve">${x(l)}</w:t></w:r>`);
    else if (b.kind === "hr") para(null, "", '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="BBBBBB"/></w:pBdr>');
    else para(null, runs(b.text, ea));
  }
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const style = (id: string, name: string, rpr: string, ppr = "") => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:pPr>${ppr}</w:pPr><w:rPr>${rpr}</w:rPr></w:style>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="${ea}" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="en-US" w:eastAsia="${EA_LANG[lang]}"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`
    + `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>`
    + style("Heading1", "heading 1", '<w:b/><w:sz w:val="36"/>', '<w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/>')
    + style("Heading2", "heading 2", '<w:b/><w:sz w:val="28"/>', '<w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="1"/>')
    + style("Heading3", "heading 3", '<w:b/><w:sz w:val="24"/>', '<w:keepNext/><w:spacing w:before="200" w:after="60"/><w:outlineLvl w:val="2"/>')
    + style("ListParagraph", "List Paragraph", "", '<w:spacing w:after="60"/>') + style("Quote", "Quote", '<w:i/><w:color w:val="555555"/>', '<w:ind w:left="567"/>')
    + style("Code", "Code", `<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:eastAsia="${ea}"/><w:sz w:val="19"/>`, '<w:spacing w:after="0"/>') + `</w:styles>`;
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${ps.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  return zip([
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>` },
    { name: "word/_rels/document.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "word/document.xml", data: doc }, { name: "word/styles.xml", data: styles },
    { name: "docProps/core.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${x(title)}</dc:title><dc:creator>Crew Studio</dc:creator></cp:coreProperties>` },
  ]);
}

// ---------- PDF ----------
// Helvetica widths (1/1000 em) for 32..126; bold is close enough at +6%.
const HW = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const width = (s: string, size: number, font: "R" | "B" | "M") => font === "M" ? s.length * 600 * size / 1000 : [...s].reduce((w, c) => w + (HW[c.charCodeAt(0) - 32] ?? 556), 0) * (font === "B" ? 1.06 : 1) * size / 1000;
/** Text a built-in PDF font can show (Latin-1); anything else becomes "?", and the caller is told. */
const latin = (s: string) => { let lossy = false; const t = [...s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, "-").replace(/…/g, "...").replace(/•/g, "·")].map((c) => { if (c.charCodeAt(0) <= 255) return c; lossy = true; return "?"; }).join(""); return { t, lossy }; };
const pdfStr = (s: string) => `(${Buffer.from(s, "latin1").toString("latin1").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")})`;
export function toPdf(md: string, title: string): { pdf: Buffer; lossy: boolean } {
  const PW = 595, PH = 842, M = 64, maxW = PW - 2 * M;
  const pages: string[][] = [[]]; let y = PH - M; let lossy = false;
  const line = (txt: string, size: number, font: "R" | "B" | "M", indent = 0, lead = 1.45) => {
    if (y - size * lead < M) { pages.push([]); y = PH - M; }
    y -= size * lead; const f = font === "B" ? "F2" : font === "M" ? "F3" : "F1";
    pages.at(-1)!.push(`BT /${f} ${size} Tf ${M + indent} ${y.toFixed(1)} Td ${pdfStr(txt)} Tj ET`);
  };
  const wrap = (raw: string, size: number, font: "R" | "B" | "M", indent = 0, first = "") => {
    const { t, lossy: l } = latin(raw); lossy ||= l;
    const words = t.split(/\s+/).filter(Boolean); let cur = first;
    for (const w of words) { const next = cur ? `${cur} ${w}` : w; if (width(next, size, font) > maxW - indent && cur) { line(cur, size, font, indent); cur = w; } else cur = next; }
    if (cur) line(cur, size, font, indent);
  };
  const plain = (s: string) => inlines(s).map((r) => r.text).join("");
  for (const b of parseBlocks(md)) {
    if (b.kind === "h") { y -= b.level === 1 ? 10 : 8; wrap(plain(b.text), b.level === 1 ? 22 : b.level === 2 ? 16 : 13, "B"); y -= 4; }
    else if (b.kind === "ul" || b.kind === "ol") { b.items!.forEach((it, i) => wrap(plain(it), 11, "R", 16, b.kind === "ul" ? "·" : `${i + 1}.`)); y -= 6; }
    else if (b.kind === "table") { b.rows!.forEach((r, ri) => wrap(r.map(plain).join("  |  "), 10.5, ri === 0 ? "B" : "R", 8)); y -= 7; }
    else if (b.kind === "code") { for (const l of b.text.split("\n")) { const { t, lossy: ll } = latin(l); lossy ||= ll; line(t.slice(0, 80), 9.5, "M", 8, 1.35); } y -= 8; }
    else if (b.kind === "hr") { y -= 10; pages.at(-1)!.push(`0.75 G ${M} ${y.toFixed(1)} m ${PW - M} ${y.toFixed(1)} l S 0 G`); y -= 6; }
    else { wrap(plain(b.text), 11, b.kind === "quote" ? "R" : "R", b.kind === "quote" ? 14 : 0); y -= 7; }
  }
  const objs: string[] = [];
  const add = (s: string) => { objs.push(s); return objs.length; };
  const fonts = [add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"), add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"), add("<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>")];
  const pagesId = objs.length + 1 + pages.length * 2; const kids: number[] = [];
  for (const p of pages) { const body = p.join("\n"); const c = add(`<< /Length ${Buffer.byteLength(body, "latin1")} >>\nstream\n${body}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PW} ${PH}] /Contents ${c} 0 R /Resources << /Font << /F1 ${fonts[0]} 0 R /F2 ${fonts[1]} 0 R /F3 ${fonts[2]} 0 R >> >> >>`)); }
  add(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`);
  const info = add(`<< /Title ${pdfStr(latin(title).t)} /Producer (Crew Studio) >>`);
  const cat = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let out = "%PDF-1.4\n%âãÏÓ\n"; const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(Buffer.byteLength(out, "latin1")); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root ${cat} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return { pdf: Buffer.from(out, "latin1"), lossy };
}

// ---------- PDF text (the export check) ----------
type CMap = { bytes: number; map: Map<number, string> };
const utf16 = (hex: string) => { const b = Buffer.from(hex.replace(/\s+/g, ""), "hex"); let t = ""; for (let i = 0; i + 1 < b.length; i += 2) t += String.fromCharCode(b.readUInt16BE(i)); return t; };
function parseCMap(src: string): CMap {
  const map = new Map<number, string>(); const cs = /begincodespacerange\s*<([0-9a-fA-F]+)>/.exec(src); const bytes = cs ? cs[1].length / 2 : 2;
  for (const blk of src.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) for (const m of blk[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) map.set(parseInt(m[1], 16), utf16(m[2]));
  for (const blk of src.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) for (const m of blk[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:<([0-9a-fA-F]*)>|\[([^\]]*)\])/g)) {
    const lo = parseInt(m[1], 16), hi = Math.min(parseInt(m[2], 16), lo + 65535);
    if (m[3] !== undefined) { const base = utf16(m[3]); for (let c = lo; c <= hi; c++) map.set(c, base.slice(0, -1) + String.fromCharCode(base.charCodeAt(base.length - 1) + c - lo)); }
    else [...m[4].matchAll(/<([0-9a-fA-F]*)>/g)].forEach((d, i) => { if (lo + i <= hi) map.set(lo + i, utf16(d[1])); });
  }
  return { bytes, map };
}
const literalBytes = (s: string) => { const out: number[] = [];
  for (let i = 0; i < s.length; i++) { const c = s[i]; if (c !== "\\") { out.push(s.charCodeAt(i) & 0xff); continue; } const n = s[++i] ?? "";
    if (/[0-7]/.test(n)) { let o = n; while (o.length < 3 && /[0-7]/.test(s[i + 1] ?? "")) o += s[++i]; out.push(parseInt(o, 8) & 0xff); }
    else if (n) out.push(({ n: 10, r: 13, t: 9, b: 8, f: 12 } as Record<string, number>)[n] ?? n.charCodeAt(0)); }
  return Buffer.from(out); };
/** The text a PDF shows, in content order: each Tj/TJ string decoded through its font's ToUnicode map (what a
 *  reader's search finds), or as Latin-1 for a simple font without one. Enough to check that a PDF carries a
 *  document's words; not a general PDF parser. */
export function pdfText(pdf: Buffer): string {
  const raw = pdf.toString("latin1"); const objs = new Map<number, { dict: string; data: string }>();
  for (const m of raw.matchAll(/(\d+)\s+0\s+obj\b([\s\S]*?)endobj/g)) {
    const body = m[2], si = body.search(/\bstream\r?\n/); let dict = body, data = "";
    if (si >= 0) { dict = body.slice(0, si); const start = si + (body[si + 6] === "\r" ? 8 : 7); let bytes = Buffer.from(body.slice(start, body.lastIndexOf("endstream")), "latin1");
      if (/\/FlateDecode/.test(dict)) { try { bytes = inflateSync(bytes); } catch { try { bytes = inflateSync(bytes.subarray(0, bytes.length - 1)); } catch { bytes = Buffer.alloc(0); } } }
      data = bytes.toString("latin1"); }
    objs.set(Number(m[1]), { dict, data });
  }
  const fonts = new Map<string, CMap | null>();
  for (const { dict } of objs.values()) for (const f of dict.matchAll(/\/Font\s*<<([^>]*)>>/g)) for (const r of f[1].matchAll(/\/([^\s/<>\[\]()]+)\s+(\d+)\s+0\s+R/g)) {
    const tu = /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(objs.get(Number(r[2]))?.dict ?? ""); fonts.set(r[1], tu ? parseCMap(objs.get(Number(tu[1]))?.data ?? "") : null); }
  let text = "";
  for (const { data } of objs.values()) {
    if (!/\bT[jJ]\b/.test(data) || !/\bTf\b/.test(data)) continue;
    let cm: CMap | null = null;
    for (const t of data.matchAll(/\/([^\s/<>\[\]()]+)\s+[-\d.]+\s+Tf\b|<([0-9a-fA-F\s]*)>|\(((?:\\[\s\S]|[^\\)])*)\)|\b(ET|T\*|Td|TD)\b/g)) {
      if (t[1] !== undefined) { cm = fonts.get(t[1]) ?? null; continue; }
      if (t[4] !== undefined) { text += " "; continue; }
      const b = t[2] !== undefined ? Buffer.from(t[2].replace(/\s+/g, ""), "hex") : literalBytes(t[3]);
      if (!cm) { text += b.toString("latin1"); continue; }
      for (let i = 0; i + cm.bytes <= b.length; i += cm.bytes) text += cm.map.get(b.readUIntBE(i, cm.bytes)) ?? "";
    }
    text += "\n";
  }
  return text;
}
/** The words an exported PDF must show: the document's first heading (or first block), as rendered. */
export function pdfProbe(md: string): string { const bl = parseBlocks(md); const b = bl.find((x) => x.kind === "h") ?? bl.find((x) => x.kind !== "hr"); return b ? inlines(b.text).map((r) => r.text).join("").trim().slice(0, 60) : ""; }
/** Whether a PDF shows the probe text (whitespace ignored: a heading may wrap or be split into runs). */
export const pdfShows = (pdf: Buffer, probe: string) => { const squash = (s: string) => s.normalize("NFKC").replace(/\s+/g, ""); return squash(pdfText(pdf)).includes(squash(probe)); };
