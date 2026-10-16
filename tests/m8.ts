import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// M8 checks: the documents pack. Markdown blocks and stable block ids (pins
// follow unchanged blocks), the M3 review loop on a document (pin a block →
// the writer revises doc.md → v2 with doc.html re-rendered), drafting from a
// prompt (stub writer), the approval gates, and every export (md, html, a docx
// that unzips and reads, a PDF whose cross-reference table is right).   bun tests/m8.ts
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freePort, waitUp } from "./boot.mjs";
process.env.CREW_SESSION_TOKEN ??= "test-session"; // the server's write guard: a local client sends it as x-crew-session

let pass = 0, fail = 0;
const ok = (c: boolean, name: string, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const here = import.meta.dir, root = join(here, "..");
for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) delete process.env[k];
const MD = `# Offsite plan\n\nA two-day team offsite in spring.\n\n## Budget\n\nThe budget is **12k** for travel and rooms.\n\n## Agenda\n\n- Day one: planning\n- Day two: a walk and a retro\n\n> Book rooms early.\n\n\`\`\`\nroom-count: 14\n\`\`\`\n`;
const pdfOk = (buf: Buffer) => { const s = buf.toString("latin1"); const xref = Number(/startxref\n(\d+)/.exec(s)?.[1]); if (!s.startsWith("%PDF-1.4") || s.slice(xref, xref + 4) !== "xref") return false;
  const offs = [...s.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1])); return offs.length > 3 && offs.every((o, i) => s.slice(o, o + `${i + 1} 0 obj`.length) === `${i + 1} 0 obj`); };

// ---------- unit ----------
{
  const { parseBlocks, mdToDocHtml, blockAt, toDocx, toPdf } = await import("../src/docrender");
  const bl = parseBlocks(MD);
  ok(bl.map((b) => b.kind).join() === "h,p,h,p,h,ul,quote,code" && bl[5].items?.length === 2 && bl[3].line === 7, "Markdown parses into blocks with their source lines", bl.map((b) => `${b.kind}@${b.line}`).join(" "));
  const h1 = mdToDocHtml(MD), h2 = mdToDocHtml(MD.replace("A two-day", "A three-day"));
  const ids = (h: string) => [...h.matchAll(/id="(b[0-9a-f]{8}(?:-\d+)?)"/g)].map((m) => m[1]);
  const [a, b] = [ids(h1), ids(h2)];
  ok(a.length === 8 && a.filter((x, i) => x === b[i]).length === 7 && a[1] !== b[1], "block ids stay the same across versions unless the block's text changed (pins follow)");
  ok(blockAt(h1, MD, `#${a[3]}`)?.line === 7 && blockAt(h1, MD, `#${a[3]}`)!.text.includes("12k"), "a pinned block maps to its doc.md line for the brief");
  const docx = toDocx(MD, "Offsite plan");
  const dir = mkdtempSync(join(tmpdir(), "crew-m8-docx-")); writeFileSync(join(dir, "a.docx"), docx);
  const t = Bun.spawnSync(["unzip", "-t", join(dir, "a.docx")], { stdout: "pipe" });
  const xml = Bun.spawnSync(["unzip", "-p", join(dir, "a.docx"), "word/document.xml"], { stdout: "pipe" }).stdout.toString();
  ok(t.success && /No errors/.test(t.stdout.toString()), "the .docx is a valid zip (unzip -t)");
  ok(xml.includes('w:pStyle w:val="Heading1"') && xml.includes("Offsite plan") && xml.includes("<w:b/>") && xml.includes("Day two"), "its document.xml has the headings, bold run and list items");
  const pdf = toPdf(MD, "Offsite plan");
  ok(pdfOk(pdf.pdf) && !pdf.lossy && pdf.pdf.toString("latin1").includes("(Offsite plan)"), "the PDF is well formed (every xref offset points at its object) and holds the text");
  const long = toPdf(Array.from({ length: 200 }, (_, i) => `Paragraph ${i} with enough words to wrap across the line more than once when set in eleven point Helvetica.`).join("\n\n"), "Long");
  ok(pdfOk(long.pdf) && (long.pdf.toString("latin1").match(/\/Type \/Page /g) ?? []).length > 3, "long documents flow onto more pages");
  ok(toPdf("# 計畫\n\n中文內容", "x").lossy, "text the built-in PDF fonts cannot show is reported (not silently dropped)");
}

const tmp = mkdtempSync(join(tmpdir(), "crew-m8-"));
const state = join(tmp, "fm", "state"), data = join(tmp, "data");
mkdirSync(join(state, "pending"), { recursive: true }); writeFileSync(join(state, "events.jsonl"), ""); mkdirSync(data);
const port = await freePort();
const app = Bun.spawn(["bun", "src/server.ts"], { cwd: root, stdout: "pipe", stderr: "pipe", env: { ...process.env, CREW_FM_STATE: state, CREW_PORT: String(port), CREW_GH: "0", CREW_READONLY: "1", CREW_DATA: data,
  CREW_CHAT_PROVIDER: "stub", CREW_RETRO_AUTO: "0", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_GH_NO_CLI: "1", CREW_CLAUDE_BIN: "/nonexistent/claude", CREW_CODEX_BIN: "/nonexistent/codex",
  HOME: join(tmp, "home"), CREW_MAIN_PROJECT: join(tmp, "proj"), CREW_FILE_ALLOW: tmp } });
const base = `http://127.0.0.1:${port}`;
await waitUp(base, app);
const get = async (p: string) => (await fetch(base + p)).json();
const post = async (p: string, b: any = {}) => { const r = await fetch(base + p, { method: "POST", headers: { "content-type": "application/json", "x-crew-session": process.env.CREW_SESSION_TOKEN }, body: JSON.stringify(b) }); return { ...(await r.json()), http: r.status }; };
const until = async (f: () => Promise<boolean>, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return true; await Bun.sleep(150); } return false; };

try {
  ok((await get("/api/packs")).packs.some((p: any) => p.id === "documents" && p.ok && p.manifest.engine === "documents"), "the documents pack is built in and valid");
  const c = await post("/api/docs", { id: "offsite", title: "Offsite plan", md: MD });
  ok(c.http === 200 && c.version.n === 1 && c.version.files.some((f: any) => f.path === "doc.md") && c.version.primary === "doc.html", "a document is an artifact: v1 holds doc.md and its rendered doc.html");
  const art = await get("/api/artifacts/offsite");
  ok(art.artifact.type === "doc" && art.artifact.source === "md", "it lives in the Library like every artifact");
  const html = await (await fetch(`${base}/af/offsite/1/doc.html`)).text();
  const budgetId = /id="(b[0-9a-f]{8})" data-line="7"/.exec(html)?.[1];
  ok(!!budgetId, "the rendered page carries block ids");
  const note = await post("/api/artifacts/offsite/v/1/notes", { kind: "pin", selector: `#${budgetId}`, bbox: { x: 10, y: 200, w: 600, h: 30 }, comment: "Say who signs off the budget" });
  ok(note.id === "P1", "pin a note on a block (the M3 annotation loop)");
  const brief = await get("/api/artifacts/offsite/v/1/brief");
  ok(/Revise the document/.test(brief.brief) && /doc\.md line 7 \("The budget is \*\*12k\*\*/.test(brief.brief), "the writer's brief names the doc.md line and its text", brief.brief);
  const g1 = await get("/api/docs/offsite/v/1/gates");
  ok(g1.find((g: any) => g.id === "no-open-notes").state === "fail" && (await post("/api/docs/offsite/v/1/approve")).http === 409, "approval is gated: an open note blocks it");
  const run = await post("/api/artifacts/offsite/v/1/request", { provider: "stub" });
  ok(run.http === 200 && run.kind === "doc", "Request changes runs the writer on the document", JSON.stringify(run).slice(0, 200));
  ok(await until(async () => (await get(`/api/runs/${run.id}`)).status === "done"), "the run finishes");
  const v2md = (await get("/api/docs/offsite/v/2/source")).md;
  const v2html = await (await fetch(`${base}/af/offsite/2/doc.html`)).text();
  ok(v2md.includes("> Revised for P1.") && v2html.includes("<blockquote") && v2html.includes("Revised for P1"), "v2: doc.md revised, and doc.html re-rendered from it (never stale)");
  ok(v2html.includes(`id="${budgetId}"`), "the pinned (unchanged) block keeps its id in v2, so compare finds it");
  const g2 = await get("/api/docs/offsite/v/2/gates");
  ok(g2.every((g: any) => g.state === "pass"), "v2 passes both gates");
  const ap = await post("/api/docs/offsite/v/2/approve");
  ok(ap.http === 200 && ap.version.status === "approved", "approve v2");
  const ex = async (f: string) => { const r = await fetch(`${base}/api/docs/offsite/v/2/export?format=${f}`); return { type: r.headers.get("content-type") ?? "", disp: r.headers.get("content-disposition") ?? "", lossy: r.headers.get("x-crew-lossy"), buf: Buffer.from(await r.arrayBuffer()) }; };
  const [emd, ehtml, edocx, epdf] = await Promise.all(["md", "html", "docx", "pdf"].map(ex));
  ok(emd.type.startsWith("text/markdown") && emd.buf.toString().includes("Revised for P1") && /offsite-v2\.md/.test(emd.disp), "export Markdown");
  ok(ehtml.type.startsWith("text/html") && ehtml.buf.toString().includes("<h1"), "export HTML (standalone, light and dark)");
  ok(edocx.type.includes("wordprocessingml") && edocx.buf.subarray(0, 2).toString() === "PK", "export Word (.docx)");
  ok(epdf.type === "application/pdf" && pdfOk(epdf.buf) && !epdf.lossy, "export PDF");
  await post("/api/docs", { id: "cjk-note", title: "Notes", md: "# 會議紀錄\n\n下週再談。\n" });
  ok((await fetch(`${base}/api/docs/cjk-note/v/1/export?format=pdf`)).headers.get("x-crew-lossy") !== null, "a PDF of non-Latin text says it is lossy");
  ok((await get("/api/docs")).docs.find((d: any) => d.id === "cjk-note")?.pdfLatinOnly === true, "the list warns before export");
  const dr = await post("/api/docs", { id: "weekly-note", title: "Weekly note", prompt: "Summarise this week's shipped work for the team" });
  ok(dr.http === 200 && dr.status === "drafting", "draft a document from a prompt");
  ok(await until(async () => (await get("/api/artifacts/weekly-note")).versions?.length === 1), "the writer's draft becomes v1");
  const wn = await get("/api/artifacts/weekly-note");
  ok(wn.versions[0].createdBy.kind === "agent" && wn.versions[0].createdBy.provider === "stub" && (await get("/api/docs/weekly-note/v/1/source")).md.startsWith("# Weekly note"), "v1 is by the writer agent, with a title");
  ok((await post("/api/docs", { id: "offsite", title: "x", md: "# x" })).http === 400, "a taken id is refused");
} catch (e: any) { fail++; console.log(`  FAIL  exception ${e?.stack ?? e}`); }
finally { app.kill(); }
console.log(`\nm8: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
