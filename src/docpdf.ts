// A document's PDF: the page the captain previewed (doc.html) printed by the local page renderer (headless
// Chromium, the system's fonts, CJK included). Without the renderer, the built-in writer (Latin-only fonts) is
// used only when it can show every character; otherwise no PDF is written and the caller is told why. Either
// way a PDF is kept only when it shows the document's own words (its first heading).
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mdToDocHtml, pdfProbe, pdfShows, toPdf } from "./docrender";
import { runRender } from "./render";

export type DocPdf = { pdf: Buffer; via: "browser" | "builtin"; warning?: string } | { pdf: null; via: null; warning: string };

export async function docPdf(dataDir: string, md: string, title: string): Promise<DocPdf> {
  const probe = pdfProbe(md), shows = (b: Buffer) => !probe || pdfShows(b, probe);
  mkdirSync(join(dataDir, "work"), { recursive: true }); const dir = mkdtempSync(join(dataDir, "work", "docpdf-")); let why = "";
  try {
    const html = join(dir, "doc.html"), out = join(dir, "doc.pdf"); writeFileSync(html, mdToDocHtml(md, title));
    const r = await runRender(dataDir, "pdf", { html, out }).done;
    if (r.ok) { const pdf = readFileSync(out); if (shows(pdf)) return { pdf, via: "browser" }; why = "the rendered PDF did not show the document's text"; }
    else why = r.error ?? "the page renderer failed";
  } catch (e: any) { why = String(e?.message ?? e); }
  finally { rmSync(dir, { recursive: true, force: true }); }
  const b = toPdf(md, title);
  if (!b.lossy && shows(b.pdf)) return { pdf: b.pdf, via: "builtin" };
  return { pdf: null, via: null, warning: `PDF not exported: this text needs the local page renderer (a Playwright browser; install it from Doctor) to print it, and it could not here (${why.slice(0, 160)}). Markdown, HTML and Word keep every character.` };
}
