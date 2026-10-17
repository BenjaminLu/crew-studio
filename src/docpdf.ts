// A document's PDF: the page the captain previewed (doc.html) printed by the local page renderer (headless
// Chromium, the system's fonts, CJK included). Without the renderer, the built-in writer (Latin-only fonts) is
// used only when it can show every character; otherwise no PDF is written and the caller is told why. Either
// way a PDF is kept only when it shows the document's own words (its first heading): tolerantly for a printed
// page (shaped scripts do not read back verbatim), exactly for the built-in writer.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mdToDocHtml, pdfCovers, pdfProbe, pdfShows, toPdf } from "./docrender";
import { renderEnv, runRender } from "./render";

export type DocPdf = { pdf: Buffer; via: "browser" | "builtin"; warning?: string } | { pdf: null; via: null; warning: string };

/** Whether this machine can print a document page (the test renderer has no browser). */
export const pdfRendererReady = () => { const e = renderEnv(); return !e.stub && !!(e.node && e.playwright); };

// at most two Chromium prints at once, however many exports are asked for together
let running = 0; const waiting: (() => void)[] = [];
async function limited<T>(f: () => Promise<T>): Promise<T> {
  if (running >= 2) await new Promise<void>((r) => waiting.push(r)); running++;
  try { return await f(); } finally { running--; waiting.shift()?.(); }
}

/** Print folders a stopped Studio left behind (each print removes its own). */
export function cleanDocPdfWork(dataDir: string) {
  try { for (const n of readdirSync(join(dataDir, "work"))) if (n.startsWith("docpdf-")) rmSync(join(dataDir, "work", n), { recursive: true, force: true }); } catch {}
}

const KEEP = "Markdown, HTML and Word keep every character.";
export async function docPdf(dataDir: string, md: string, title: string): Promise<DocPdf> {
  const probe = pdfProbe(md); let warning: string;
  if (!pdfRendererReady()) warning = `PDF not exported: this text needs the local page renderer (a Playwright browser), which is not installed here; install it from Doctor. ${KEEP}`;
  else {
    let why = "";
    mkdirSync(join(dataDir, "work"), { recursive: true }); const dir = mkdtempSync(join(dataDir, "work", "docpdf-"));
    try {
      const html = join(dir, "doc.html"), out = join(dir, "doc.pdf"); writeFileSync(html, mdToDocHtml(md, title));
      const r = await limited(() => runRender(dataDir, "pdf", { html, out }).done);
      if (r.ok) { const pdf = readFileSync(out), c = probe ? pdfCovers(pdf, probe, md) : { ok: true }; if (c.ok) return { pdf, via: "browser" }; why = `printed, but the text check failed: ${c.why}`; }
      else why = `the page renderer could not print it: ${r.error ?? "unknown error"}`;
    } catch (e: any) { why = `the page renderer could not print it: ${String(e?.message ?? e)}`; }
    finally { rmSync(dir, { recursive: true, force: true }); }
    warning = `PDF not exported: ${why.slice(0, 240)}. ${KEEP}`;
  }
  const b = toPdf(md, title);
  if (!b.lossy && (!probe || pdfShows(b.pdf, probe))) return { pdf: b.pdf, via: "builtin" };
  return { pdf: null, via: null, warning };
}
