import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// R-073: an accepted Traditional Chinese guide exported a PDF with "?" for every non-Latin character (built-in
// Type1 fonts). The PDF is now the previewed page printed by the page renderer and must show the document's own
// words; without a renderer a lossy PDF is never written (the reason is returned instead); Word gets East Asian
// font and language hints.   bun tests/doc-pdf-cjk.ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let pass = 0, fail = 0;
const ok = (c: boolean, name: string, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const { docLang, mdToDocHtml, pdfProbe, pdfShows, pdfText, toDocx, toPdf } = await import("../src/docrender");
const { docPdf } = await import("../src/docpdf");
const { renderEnv } = await import("../src/render");
const data = mkdtempSync(join(tmpdir(), "crew-doc-pdf-cjk-"));
const GUIDE = "# money-kit 專案上手指南\n\nmoney-kit 是小型 TypeScript 函式庫，以整數「分」處理金額。\n\n## 執行測試\n\n| 指令 | 用途 |\n| --- | --- |\n| `bun test` | 執行全部測試 |\n| `bun run lint` | 檢查風格規則 |\n\n1. **建立分支：**使用 `feature/<名稱>`。\n\n```\nbun test  # 全部測試\n```\n";
const LATIN = "# Offsite plan\n\nA two-day team offsite in spring.\n";
const env = (vars: Record<string, string | undefined>) => { const old: Record<string, string | undefined> = {}; for (const [k, v] of Object.entries(vars)) { old[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; } return () => { for (const [k, v] of Object.entries(old)) if (v === undefined) delete process.env[k]; else process.env[k] = v; }; };

try {
  // ---------- the check itself ----------
  ok(pdfProbe(GUIDE) === "money-kit 專案上手指南", "the probe is the document's first heading as rendered", pdfProbe(GUIDE));
  const builtin = toPdf(GUIDE, "x");
  ok(builtin.lossy && !pdfShows(builtin.pdf, pdfProbe(GUIDE)) && /\?\?\?/.test(pdfText(builtin.pdf)), "the built-in writer's \"?\" PDF fails the text check (the R-073 regression is caught)");
  ok(pdfShows(toPdf(LATIN, "Offsite plan").pdf, "Offsite plan"), "a Latin built-in PDF passes the text check (Tj strings read back)");

  // ---------- the page the captain previewed ----------
  const html = mdToDocHtml(GUIDE);
  ok(docLang(GUIDE) === "zh-Hant" && html.includes('<html lang="zh-Hant">') && /"PingFang TC","Noto Sans CJK TC"/.test(html) && /@page\{size:A4/.test(html), "the page names its language, a CJK font stack and A4 print rules");
  ok(docLang("# 这个说明\n\n我们会过来。") === "zh-Hans" && docLang("# 手順\n\nこれはテストです。") === "ja" && docLang(LATIN) === "en", "simplified Chinese, Japanese and Latin documents are told apart");
  ok(/<table [^>]*><thead><tr><th>指令<\/th><th>用途<\/th><\/tr><\/thead><tbody><tr><td><code>bun test<\/code><\/td><td>執行全部測試<\/td>/.test(html), "a Markdown table renders as a table (not a paragraph of pipes)");

  // ---------- browser PDF ----------
  const re = renderEnv();
  if (!(re.node && re.playwright) || re.stub) ok(false, "the page renderer (node + Playwright) is installed for this test");
  else {
    const r = await docPdf(data, GUIDE, "money-kit 專案上手指南");
    const text = r.pdf ? pdfText(r.pdf) : "";
    ok(r.via === "browser" && !!r.pdf && !r.warning, "a CJK document's PDF is printed by the page renderer", JSON.stringify({ via: r.via, warning: (r as any).warning }));
    ok(!!r.pdf && pdfShows(r.pdf, "money-kit 專案上手指南") && pdfShows(r.pdf, "執行全部測試") && pdfShows(r.pdf, "建立分支"), "the PDF shows the title, a table cell and list text in Chinese", text.slice(0, 200));
    ok(!!r.pdf && !/\?{3}/.test(text), "no run of \"?\" stands in for the text");
    ok(!!r.pdf && /\/MediaBox\s*\[\s*0 0 59[45](\.\d+)? 84[12](\.\d+)?\s*\]/.test(r.pdf.toString("latin1")), "pages are A4");
    const l = await docPdf(data, LATIN, "Offsite plan");
    ok(l.via === "browser" && !!l.pdf && pdfShows(l.pdf, "Offsite plan"), "a Latin document is printed the same way");
  }

  // ---------- no renderer: never a "?" PDF ----------
  for (const [label, vars] of [["no node", { CREW_NODE_BIN: "/nonexistent/node", CREW_RENDER_STUB: undefined }], ["the test renderer", { CREW_RENDER_STUB: "1" }]] as const) {
    const restore = env(vars as any);
    try {
      const r = await docPdf(data, GUIDE, "money-kit 專案上手指南");
      ok(r.pdf === null && /PDF not exported/.test(r.warning ?? "") && /page renderer/.test(r.warning ?? "") && /Doctor/.test(r.warning ?? "") && /Word/.test(r.warning ?? ""), `${label}: a CJK document gets no PDF and a warning naming the missing renderer`, JSON.stringify(r.warning));
      const l = await docPdf(data, LATIN, "Offsite plan");
      ok(l.via === "builtin" && !!l.pdf && pdfShows(l.pdf, "Offsite plan") && !l.warning, `${label}: a Latin document still gets the built-in PDF`);
    } finally { restore(); }
  }

  // ---------- Word ----------
  const dir = mkdtempSync(join(tmpdir(), "crew-doc-docx-")); writeFileSync(join(dir, "a.docx"), toDocx(GUIDE, "x"));
  const part = (f: string) => Bun.spawnSync(["unzip", "-p", join(dir, "a.docx"), f], { stdout: "pipe" }).stdout.toString();
  const doc = part("word/document.xml"), styles = part("word/styles.xml");
  ok(/<w:rFonts w:eastAsia="Microsoft JhengHei" w:hint="eastAsia"\/><w:b\/><\/w:rPr><w:t xml:space="preserve">建立分支：/.test(doc), "document.xml: a CJK run carries an East Asian font hint", doc.slice(0, 400));
  ok(/<w:rPrDefault><w:rPr><w:rFonts [^>]*w:eastAsia="Microsoft JhengHei"[^>]*\/><w:sz w:val="22"\/><w:lang w:val="en-US" w:eastAsia="zh-TW"\/>/.test(styles) && /w:styleId="Code"[\s\S]*?w:eastAsia="Microsoft JhengHei"/.test(styles), "styles.xml: the defaults name an East Asian font and zh-TW; Code keeps it");
  ok(/<w:tbl>[\s\S]*指令[\s\S]*執行全部測試[\s\S]*<\/w:tbl>/.test(doc), "document.xml: the table is a Word table");
  ok(Bun.spawnSync(["unzip", "-t", join(dir, "a.docx")], { stdout: "pipe" }).success, "the .docx is still a valid zip");
  const sc = mkdtempSync(join(tmpdir(), "crew-doc-docx-")); writeFileSync(join(sc, "a.docx"), toDocx("# 这个说明\n\n我们会过来。", "x"));
  ok(/w:eastAsia="zh-CN"/.test(Bun.spawnSync(["unzip", "-p", join(sc, "a.docx"), "word/styles.xml"], { stdout: "pipe" }).stdout.toString()), "a simplified Chinese document is marked zh-CN");
  rmSync(dir, { recursive: true, force: true }); rmSync(sc, { recursive: true, force: true });
} finally { rmSync(data, { recursive: true, force: true }); }

console.log(`\ndoc-pdf-cjk: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
