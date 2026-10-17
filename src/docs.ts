// M8 documents (the documents pack's engine). A document is an artifact
// (type doc, source md): each version holds doc.md (the source) and doc.html
// (rendered by Studio, block ids for pins). It reuses M3's whole review loop:
// pins on blocks, "request changes" runs the writer (the pack's writer skill +
// the work tools), compare, approve. Drafting from a prompt runs the writer on
// an empty document. Approval passes the pack's gates. Exports: md, html, docx,
// pdf, all written by Studio (no external tool).
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { folderTools, type Agents } from "./agent";
import type { ArtifactStore } from "./artifacts";
import { mdToDocHtml, parseBlocks, toDocx } from "./docrender";
import { cleanDocPdfWork, docPdf, pdfRendererReady } from "./docpdf";
import type { StudioLog } from "./rawlog";
import type { Skills } from "./skills";
import type { Provider } from "./providers";
import { STARTUP_ACCEPT_ONLY, isStartupArtifact } from "./domain/startup-recursion";

const DRAFT_TAIL = `\n\nYou write ONE new document in doc.md with the doc_* tools only (no shell, no web): a # title, a short summary, then the sections the prompt needs. Answer in 2 short lines when done.`;

export function createDocs(o: { dataDir: string; store: ArtifactStore; agents: Agents; skills: Skills; log: StudioLog; provider: (id?: string, model?: string) => Provider; send: (t: string, d: unknown) => void }) {
  cleanDocPdfWork(o.dataDir);
  const drafts = new Map<string, { id: string; title: string; job: string | null; status: "drafting" | "done" | "failed"; error: string | null; startedAt: string }>();
  const writer = () => { try { return o.skills.text("documents", "writer"); } catch { return ""; } };
  const create = (id: string, title: string, md: string, by: { kind: "captain" | "agent"; provider?: string; model?: string; run?: string }) => {
    if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(id)) throw new Error("id: lowercase letters, digits and dashes");
    if (o.store.get(id)) throw new Error(`${id} exists`);
    const tmp = join(o.dataDir, "work", `doc-${id}-${Date.now()}`); mkdirSync(tmp, { recursive: true });
    writeFileSync(join(tmp, "doc.md"), md); writeFileSync(join(tmp, "doc.html"), mdToDocHtml(md, title));
    o.store.create({ id, title, type: "doc", source: "md", entry: "doc.md", note: null });
    const v = o.store.addVersion(id, { from: tmp, primary: "doc.html", createdBy: by, status: "in-review", summary: by.kind === "agent" ? "first draft" : null });
    rmSync(tmp, { recursive: true, force: true });
    o.log.emit({ type: "doc_created", workflow: "documents", task: id, summary: `${title} v1 (${by.kind})` });
    return v;
  };
  function draft(a: { id: string; title: string; prompt: string; provider?: string; model?: string }) {
    const prompt = String(a.prompt ?? "").trim().slice(0, 4000); if (!prompt) throw new Error("say what the document is for");
    if (o.store.get(a.id) || drafts.get(a.id)?.status === "drafting") throw new Error(`${a.id} exists`);
    if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(a.id)) throw new Error("id: lowercase letters, digits and dashes");
    const dir = join(o.dataDir, "work", `draft-${a.id}`); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "doc.md"), `# ${a.title}\n`);
    const rec = { id: a.id, title: a.title, job: null as string | null, status: "drafting" as const, error: null as string | null, startedAt: new Date().toISOString() };
    drafts.set(a.id, rec);
    const prov = o.provider(a.provider, a.model);
    (async () => {
      const j = await o.agents.run({ kind: "doc-draft", title: `draft ${a.id}`, system: writer() + DRAFT_TAIL, text: `DOC DRAFT\nTitle: ${a.title}\nPrompt: ${prompt}\n\nWrite doc.md, then answer.`, tools: folderTools(dir, () => {}, "doc"), provider: prov, ref: `doc:${a.id}`, maxTools: 30 });
      (rec as any).job = j.id;
      const md = readFileSync(join(dir, "doc.md"), "utf8");
      if (j.status !== "done" || md.trim() === `# ${a.title}`) { (rec as any).status = "failed"; rec.error = j.error ?? "the writer wrote nothing"; }
      else { create(a.id, a.title, md, { kind: "agent", provider: j.provider, model: j.model, run: j.id }); (rec as any).status = "done"; }
      rmSync(dir, { recursive: true, force: true });
      o.send("artifacts", { at: Date.now() });
    })();
    return rec;
  }
  /** The pack's approval gates for one version. */
  function gates(id: string, n: number) {
    const md = readFileSync(o.store.mdSource(id, n)!, "utf8");
    const first = parseBlocks(md)[0];
    const open = o.store.notes(id, n).filter((x) => x.status === "open");
    return [{ id: "has-title", label: "The document starts with a title", state: first?.kind === "h" && first.level === 1 ? "pass" : "fail", detail: first?.kind === "h" ? first.text : "no # title first" },
      { id: "no-open-notes", label: "No note is still open", state: open.length ? "fail" : "pass", detail: open.length ? `${open.length} open: ${open.map((x) => x.id).join(", ")}` : "none open" }];
  }
  async function exportDoc(id: string, n: number, format: string): Promise<Response> {
    const a = o.store.get(id); const v = o.store.version(id, n); if (!a || !v || a.source !== "md") return new Response("not found", { status: 404 });
    const md = readFileSync(o.store.mdSource(id, n)!, "utf8");
    const name = `${id}-v${n}`;
    const send = (body: BodyInit, type: string, ext: string, extra: Record<string, string> = {}) => new Response(body, { headers: { "content-type": type, "content-disposition": `attachment; filename="${name}.${ext}"`, "cache-control": "no-store", ...extra } });
    o.log.emit({ type: "doc_exported", workflow: "documents", task: id, summary: `v${n} as ${format}` });
    if (format === "md") return send(md, "text/markdown; charset=utf-8", "md");
    if (format === "html") return send(mdToDocHtml(md, a.title), "text/html; charset=utf-8", "html");
    if (format === "docx") return send(new Uint8Array(toDocx(md, a.title)), "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "docx");
    // the previewed page printed; never a PDF that cannot show the text (409 with the reason instead)
    if (format === "pdf") { const r = await docPdf(o.dataDir, md, a.title); return r.pdf ? send(new Uint8Array(r.pdf), "application/pdf", "pdf") : new Response(JSON.stringify({ error: r.warning, code: "pdfRenderer" }), { status: 409, headers: { "content-type": "application/json" } }); }
    return new Response(JSON.stringify({ error: "format: md, html, docx or pdf" }), { status: 400, headers: { "content-type": "application/json" } });
  }

  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  async function handle(req: Request, url: URL, who: { kind: string }, writing: boolean): Promise<Response | null> {
    const p = url.pathname;
    if (!p.startsWith("/api/docs")) return null;
    if (writing && who.kind === "phone") return json({ error: "do this on the Mac", code: "desktopOnly" }, 403);
    let b: any = {}; if (writing) { try { b = await req.json(); } catch {} }
    try {
      if (p === "/api/docs" && !writing) {
        const pdfRenderer = pdfRendererReady(); const docs = o.store.view().filter((a: any) => a.source === "md").map((a: any) => { const last = a.versions.at(-1); let words = 0, lossy = false; // non-Latin text: only the page renderer can print it
          try { const md = readFileSync(o.store.mdSource(a.id, last.n)!, "utf8"); words = md.split(/\s+/).filter(Boolean).length; lossy = /[^\u0000-ÿ“”‘’–—…•]/.test(md); } catch {}
          return { ...a, words, pdfUnavailable: lossy && !pdfRenderer, openNotes: o.store.notes(a.id, last.n).filter((x) => x.status === "open").length }; });
        return json({ docs, drafts: [...drafts.values()].filter((d) => d.status !== "done") });
      }
      if (p === "/api/docs" && writing) {
        const id = String(b?.id ?? "").trim(), title = String(b?.title ?? "").trim() || id;
        if (b?.prompt) return json(draft({ id, title, prompt: b.prompt, provider: b.provider || undefined, model: b.model || undefined }));
        const md = String(b?.md ?? "").trim() ? String(b.md) : `# ${title}\n`;
        return json({ version: create(id, title, md, { kind: "captain" }), id });
      }
      const m = /^\/api\/docs\/([\w-]+)\/v\/(\d+)\/(gates|approve|export|source)$/.exec(p);
      if (m) {
        const id = m[1], n = Number(m[2]); const a = o.store.get(id); if (!a || a.source !== "md" || !o.store.version(id, n)) return json({ error: "no such document version" }, 404);
        if (m[3] === "gates") return json(gates(id, n));
        if (m[3] === "source") return json({ md: readFileSync(o.store.mdSource(id, n)!, "utf8") });
        if (m[3] === "export") return await exportDoc(id, n, url.searchParams.get("format") ?? "md");
        // a startup competition write-up is accepted only on its Task's accept card (export and source stay open)
        if (m[3] === "approve" && writing && isStartupArtifact(id, a)) return json({ error: STARTUP_ACCEPT_ONLY.en, errorZh: STARTUP_ACCEPT_ONLY.zh, code: "startup-accept-card-only" }, 409);
        if (m[3] === "approve" && writing) {
          const g = gates(id, n); const bad = g.filter((x) => x.state === "fail");
          if (bad.length) return json({ error: `a gate failed: ${bad.map((x) => `${x.label} (${x.detail})`).join("; ")}`, gates: g }, 409);
          const v = o.store.approve(id, n, who.kind === "phone" ? "captain (phone)" : "captain");
          o.log.emit({ type: "doc_approved", workflow: "documents", task: id, summary: `v${n} approved` });
          return json({ version: v, gates: g });
        }
      }
      const d = /^\/api\/docs\/drafts\/([\w-]+)$/.exec(p); if (d) { const r = drafts.get(d[1]); return r ? json({ ...r, job: r.job ? o.agents.jobs.get(r.job) ?? null : null }) : json({ error: "no such draft" }, 404); }
      return json({ error: "not found" }, 404);
    } catch (e: any) { return json({ error: String(e?.message ?? e) }, 400); }
  }
  return { handle, create, draft, gates };
}
