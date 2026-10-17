// Native non-code workflows share the persisted scheduler, sandboxed agent rounds,
// check ledger and refine loop. No domain agent owns a human decision or a merge.
import {captureDeliverInputs,deliverInputTools} from "./deliver-inputs";
import { OperatingRules, type RulesSection } from "../operating-rules";
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, relative } from "node:path";
import { folderTools, type AgentTool } from "../agent";
import { redactText } from "../secure";
import { websiteHref, type ArtifactStore } from "../artifacts";
import { bundledList, bundledText } from "../bundled";
import { mdToDocHtml, toDocx, toPdf } from "../docrender";
import { frameLuma, probeVideo, requestedSeconds, runRender, renderEnv } from "../render";
import { imageRefinement, lineageText, requirementLineage } from "./image-refinement";
import { briefFor } from "../runtime/refine";
import { mergeDetail } from "./mergecard";
import { verifyImagePng, type CodexImage } from "../providers/codex-image";
import { roleSkillName, type Engine, type X } from "../runtime/engine";

type Deps = { dataDir: string; artifacts: ArtifactStore; lane: any; fileorg: any; docs: any;
  /** Studio's docs for a document about Crew Studio itself (R-032): a folder (tests), null for none, or by default
   *  the docs bundled with Studio (the checkout's docs/, or the copies embedded in the binary) */
  studioDocs?: string | null; generateImage?: (prompt: string, authorize: () => void, signal: AbortSignal, reference?:import("../providers/codex-image").CodexImageReference, rules?: RulesSection) => Promise<CodexImage> };
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
/** A document's title is its own # heading, never the raw prompt that asked for it. */
export const docTitle = (md: string, fallback: string) => /^#\s+(.+?)\s*#*\s*$/m.exec(md)?.[1].trim() || fallback;
type DocSource = { label: string; list: () => string[]; text: (rel: string) => string | null };
/** Studio's own docs as a read-only source: the bundled docs/ (dev checkout or binary), or a test folder. */
export function studioDocSource(dir?: string | null): DocSource | null {
  if (dir === null) return null;
  if (dir === undefined) { const list = () => bundledList("docs/").filter(p => /^docs\/(?:[^/]+|units\/[^/]+)\.md$/.test(p)); // what the binary embeds (scripts/gen-assets.ts)
    return list().length ? { label: "Crew Studio docs", list, text: rel => list().includes(rel) ? bundledText(rel) : null } : null; }
  let root: string; try { root = realpathSync(dir); if (!lstatSync(dir).isDirectory()) return null; } catch { return null; }
  const list = () => { const out: string[] = []; const walk = (d: string) => { for (const n of readdirSync(d).sort()) { const p = join(d, n), s = lstatSync(p); if (s.isSymbolicLink()) continue; if (s.isDirectory()) walk(p); else if (s.isFile() && n.endsWith(".md")) out.push(relative(root, p)); } }; walk(root); return out; };
  return { label: "Crew Studio docs", list, text: rel => { if (!list().includes(rel)) return null; try { const p = join(root, rel); return lstatSync(p).isFile() && realpathSync(p).startsWith(root + "/") ? readFileSync(p, "utf8") : null; } catch { return null; } } };
}
/** Read-only tools over a doc source; every text the model sees is passed through the credential redactor. */
export function productDocTools(src: DocSource): AgentTool[] {
  const read = (rel: string) => { const t = src.text(String(rel ?? "")); return t === null ? null : redactText(t); };
  return [
    { name: "product_docs_list", description: `Read-only, ${src.label}: list the documents.`, schema: { type: "object", properties: {} }, run: () => src.list().slice(0, 400) },
    { name: "product_docs_read", description: `Read-only, ${src.label}: read a document by line range (lines from 1; default 400, max 800).`, schema: { type: "object", properties: { path: { type: "string" }, start: { type: "number" }, lines: { type: "number" } }, required: ["path"] },
      run: a => { const t = read(a.path); if (t === null) return { error: `no such document: ${a.path}` }; const all = t.split("\n"), s0 = Math.max(1, Number(a.start) || 1), n = Math.min(800, Math.max(1, Number(a.lines) || 400));
        return { path: a.path, totalLines: all.length, start: s0, text: all.slice(s0 - 1, s0 - 1 + n).map((l, i) => `${s0 + i}\t${l}`).join("\n") }; } },
    { name: "product_docs_search", description: `Read-only, ${src.label}: find lines containing a text (case-insensitive).`, schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      run: a => { const q = String(a.text ?? "").toLowerCase(); if (!q) return { error: "text is required" }; const hits: any[] = [];
        for (const rel of src.list()) { if (hits.length >= 50) break; (read(rel) ?? "").split("\n").forEach((l, i) => { if (hits.length < 50 && l.toLowerCase().includes(q)) hits.push({ path: rel, line: i + 1, text: l.slice(0, 300) }); }); } return hits; } },
  ];
}
/** The primary actions a web prototype must perform: a submit or a named button that the captain's words (intent
 *  and notes) ask to work ("the submit button must show a thank-you", "clicking Add to cart does nothing"). A
 *  sentence that removes, hides or restyles a control asks nothing of it. At most six. */
const REMOVE = /\b(remove|delete|drop|hide|get rid of|take out|take away|no longer|without|don'?t (?:need|want)|lose)\b|刪除|删除|移除|拿掉|去掉|不要/i;
const WORKS = /\b(must|should|needs? to|has to|have to|does(?:n'?t| not)? (?:nothing|work)|do(?:es)?n'?t work|nothing happens|works?|working|broken|open|opens|show|shows|display|send|sends|take[s]? (?:me|you|the user|people) to|go(?:es)? to|lead[s]? to|navigate|respond|add[s]? (?:it|the|an?|items?)|when (?:i|you|the user|someone|people) (?:click|press|tap|submit))\b|要能|按下後|點了|點擊後|沒反應|没反应|送出後/i;
export function primaryActions(texts: string[]): { kind: "submit" | "click"; text: string; said: string }[] {
  const out: { kind: "submit" | "click"; text: string; said: string }[] = [], add = (kind: "submit" | "click", text: string, said: string) => { const t = text.trim().replace(/\s+/g, " "); if (t && !out.some(a => a.kind === kind && a.text.toLowerCase() === t.toLowerCase())) out.push({ kind, text: t, said: said.trim().slice(0, 200) }); };
  for (const said of texts.flatMap(t => String(t ?? "").split(/(?<=[.!?。！？;；\n])\s*/))) {
    if (!said.trim() || REMOVE.test(said) || !WORKS.test(said)) continue;
    if (/\bsubmit(?:s|ted|ting)?\b|送出|提交/i.test(said)) add("submit", "submit", said);
    for (const m of said.matchAll(/\bclick(?:ing|s)?\s+(?:on\s+)?(?:the\s+)?["“'‘]?([A-Za-z][\w '-]{1,28}?)["”'’]?\s+button\b/gi)) add("click", m[1], said);
    for (const m of said.matchAll(/["“'‘]([^"”'’]{2,30})["”'’]\s+button\b/gi)) add("click", m[1], said);
    for (const m of said.matchAll(/\b(add to cart|sign up|subscribe|book now|buy now|place order|log ?in|send message)\b/gi)) add("click", m[1], said);
  }
  return out.slice(0, 6);
}
/** Sentences a reader stumbles on: longer than 30 words. Reported to the captain, never blocking. */
export function readabilityFindings(md: string): { section: string; message: string }[] {
  const out: { section: string; message: string }[] = []; let fence = false;
  md.split(/\n\s*\n/).forEach((para, i) => { if (/^\s*```/.test(para)) fence = !fence; if (fence || /^\s*(```|#|\|)/.test(para)) return;
    for (const sentence of para.replace(/\s+/g, " ").split(/(?<=[.!?。！？])\s+/)) { const words = sentence.split(" ").filter(Boolean).length; if (words > 30) out.push({ section: `paragraph ${i + 1}`, message: `a ${words}-word sentence: "${sentence.slice(0, 90)}…"` }); } });
  return out;
}
export function installDeliver(engine: Engine, d: Deps) {
  const st = d.artifacts;
  engine.actions["deliver.intake"] = x => { x.ctx.intent = { text: x.run.text, workflow: x.run.workflow }; x.ctx.spec ??= { done: [x.run.workflow === "trivial-lane" ? "The local image recipe passes its deterministic checks" : x.run.workflow === "file-organization" ? "The planned moves stay inside the folder without overwrite" : "Every delivered source passes its deterministic readiness check", "The content and presentation match the captain's intent"] }; return "ok"; };
  const refs = (x: X): any[] => Object.values(x.ctx.deliver ?? {}).sort((a: any, b: any) => a.producer.localeCompare(b.producer));
  const ref = (x: X) => { const p = String(x.node.args?.producer ?? "draft"); const r = x.ctx.deliver?.[p]; if (!r || !st.version(r.id, r.n)) throw new Error("no pinned artifact output"); return r; };
  const kind = (x: X) => String(x.node.args?.format ?? "web");
  const entry = (f: string) => f === "image" ? "image.png" : f === "document" ? "doc.md" : f === "video" ? "film.html" : "index.html";
  const artifactType = (f: string) => f === "document" ? "doc" : f === "video" ? "video" : f === "image" ? "image" : "web";
  // the brief names the version this round edits, so a later round builds on it instead of starting over
  const parentLine = (x: X) => { const e = entry(kind(x)), p = x.rn.data.parent; return p ? `${e} in the work folder is v${p.n}, the version the captain last saw. Edit it in place: keep every earlier change${kind(x) === "video" ? " and beat" : ""} unless a newer requirement above changes it, then apply the newest requirements. Do not start over.` : `Write ${e}.`; };
  engine.actions["image.generate"] = async x => {
    if (!d.generateImage) throw new Error("sandboxed image generation unavailable");
    if (x.run.params.provider && x.run.params.provider !== "codex") throw new Error("image generation requires Codex");
    const authorize = () => { if (x.cancelled() || !engine.owns(x)) throw new Error("image owner ended"); };
    authorize();
    const old = x.ctx.deliver?.draft;
    // the node's role skill leads the image request (counted in the request's byte cap), and the step records it (ref, version, sha256) like an agent round's
    const role = x.node.role ? engine.roleSkillText(x.run.def, x.node.role) : null;
    const refinement=imageRefinement(st,{run:x.run.id,producer:x.node.id,round:x.visit,attempt:(x.rn.attempt??0)+1,intent:x.run.text,old,lead:role?.text});
    const notes = old ? st.notes(old.id, old.n).filter(n => n.status === "open") : [];
    const dir = join(d.dataDir, "work", "images", x.run.id, `${x.visit}-${x.rn.attempt ?? 0}`);
    const controller = new AbortController();
    const timer = setInterval(() => { if (x.cancelled() || !engine.owns(x)) controller.abort(); }, 100);
    try {
      const rules = new OperatingRules(d.dataDir).section(x.run.params.project || null); x.rn.data = { ...x.rn.data, operatingRules: rules.hash };
      const use = role && x.skillUse ? x.skillUse() : null;
      if (use?.roleSkill) { const step = [...x.run.steps].reverse().find(s => s.node === x.node.id && s.state === "running"); if (step) { step.roleSkill = use.roleSkill; step.skills = use.skills; } x.log(`skills loaded: ${roleSkillName(use.roleSkill)}`); x.save(); }
      const image = await d.generateImage(refinement.prompt, authorize, controller.signal, refinement.reference, rules);
      authorize(); verifyImagePng(image.bytes);
      mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, "image.png"), image.bytes);
      const id = old?.id ?? `out-${x.run.id.toLowerCase()}-draft`;
      if (!st.get(id)) st.create({ id, title: x.run.title, type: "image", source: "file", entry: "image.png" });
      const v = st.addVersion(id, { from: dir, primary: "image.png", parent: old?.n ?? null, refinement:refinement.snapshot, annotations: notes.map(n => n.id), createdBy: { kind: "agent", provider: image.provider, model: image.model, run: x.run.id }, source: { run: x.run.id }, summary: `${image.width}x${image.height} PNG` });
      (x.ctx.deliver ??= {}).draft = { id, n: v.n, sha256: v.sha256, format: "image", producer: "draft" };
      x.ctx.head = hash(refs(x)); x.rn.note = `${id} v${v.n}`; x.save(); return "ok";
    } finally { clearInterval(timer); controller.abort(); rmSync(dir, { recursive: true, force: true }); }
  };
  engine.actions["deliver.round"] = x => {
    const producers = x.run.def.nodes.filter(n => n.mode === "deliver"), source = producers.map(n => x.ctx.briefs?.[n.id]).find(b => b && b.head === x.ctx.head);
    if (source) for (const n of producers) (x.ctx.briefs ??= {})[n.id] = { ...source, producer: n.id, round: x.run.nodes[n.id].visits };
    return "ok";
  };
  // a document about Crew Studio reads Studio's own docs (read-only, host-side, redacted tools); when this build
  // has none, the brief says so instead of leaving the writer to invent product facts
  const aboutStudio = (x: X) => kind(x) === "document" && /\bcrew[\s-]?studio\b/i.test(`${x.run.text} ${x.run.title}`);
  const docsFor = (x: X) => aboutStudio(x) ? studioDocSource(d.studioDocs) : null;
  /** What the captain wrote on the workflow's own cards (card.ask: a purpose, a title, a style): the producer works from it (R-044). */
  const captainCardNotes = (x: X) => { const lines = x.run.def.nodes.filter(n => n.kind === "card" && !n.args?.mode && !n.args?.body_from).map(n => [n, x.ctx.answers?.[n.id]] as const)
      .filter(([, a]) => a?.note && String(a.note).trim()).map(([n, a]) => `- ${n.label} (${a.choice}): ${String(a.note).trim().slice(0, 1000)}`);
    return lines.length ? `The captain's answers on this workflow's cards:\n${lines.join("\n")}\n` : ""; };
  engine.modes.deliver = {
    begin(x) {
      const dir = engine.roundDir(x, "deliver");
      const old = x.ctx.deliver?.[x.node.id]; if (old) cpSync(st.filesDir(old.id, old.n), dir, { recursive: true });
      if (kind(x) === "video" && !old) { const tpl = bundledText("workflows/v2/templates/film.html"); if (!tpl) throw new Error("film template unavailable"); writeFileSync(join(dir, "film.html"), tpl.replaceAll(/\{\{(?:TITLE|LINE[123])\}\}/g, "Crew Studio")); }
      x.rn.data.inputs = captureDeliverInputs(x,st); x.rn.data.productDocs = aboutStudio(x) ? (docsFor(x)?.label ?? "unavailable") : null; engine.record(x,"deliver-inputs",{data:{inputs:x.rn.data.inputs}});
      x.rn.data.brief = briefFor(x); x.rn.data.dir = dir; x.rn.data.parent = old ?? null; x.rn.data.notes = old ? st.notes(old.id, old.n).filter(n => n.status === "open") : [];
      // every round carries the captain's notes from every earlier version, not only the parent's open ones (R-051, R-054)
      x.rn.data.lineage = requirementLineage(st, { run: x.run.id, producer: x.node.id, round: x.visit, attempt: (x.rn.attempt ?? 0) + 1, intent: x.run.text, old, type: artifactType(kind(x)) }); x.save();
    },
    sandbox: x => { const dir = engine.roundDirPath(x, "deliver"); return { writes: [dir], cwd: dir }; },
    tools: x => [...folderTools(x.rn.data.dir, () => {}, "work").filter(t => t.name !== "work_search"),...deliverInputTools(st,x.run.id,x.rn.data.inputs??[],()=>engine.owns(x)),...(x.rn.data.productDocs && x.rn.data.productDocs !== "unavailable" ? productDocTools(docsFor(x)!) : [])], maxTools: 30,
    system: (x, skill) => `${skill}\nProduce ${entry(kind(x))} in the isolated work folder using work_* tools. Read related fixed-version source documents with input_list/input_read before building on or reviewing them; input sources are read-only and are not in the work folder. No shell, network, browser inspection or external assets. Preserve existing content unless the brief changes it.${kind(x) === "video" ? " Keep the renderer contract in the brief's DELIVERABLE section (operating manual, video/editor)." : ""}`,
    // the brief's six sections; the parent version and its lineage are already in the prompt (parentLine, lineageText)
    skeleton: x => { const f = kind(x), e = entry(f);
      const deps = f === "video" ? (() => { const r = renderEnv(); const have = (v: unknown) => v ? "installed" : "missing";
        return [`Film renderer (runs after you, in Studio): Node ${have(r.node)}, Playwright ${have(r.playwright)}, ffmpeg ${have(r.ffmpeg)}, ffprobe ${have(r.ffprobe)}${r.canFilm ? "" : "; the MP4 cannot be rendered until Doctor installs what is missing"}.`]; })() : [];
      return { manual: f === "video" ? ["video/editor"] : [], extra: f === "video" ? { DELIVERABLE: ["Renderer contract"] } : {},
        TESTS: [`No test command: core/artifact-ready checks ${e} after this step${f === "video" ? " and the rendered MP4" : ""}.`],
        DEPENDENCIES: deps, DELIVERABLE: [`${e} in the work folder (format ${f}); Studio versions it.`] }; },
    prompt: x => `DELIVER ${kind(x)}\nNode: ${x.node.id} — ${x.node.label}\nAssignment: ${x.node.detail ?? "Produce the requested output for this step."}\nFixed Task inputs (use input_read with producer): ${JSON.stringify(x.rn.data.inputs??[])}\n${x.rn.data.productDocs === "unavailable" ? "Product docs: unavailable in this build. Do not invent facts about the product; say plainly which facts the captain must supply.\n" : x.rn.data.productDocs ? `Product docs (read-only, product_docs_list/read/search): ${x.rn.data.productDocs}. Take every fact about the product from them; never invent one.\n` : ""}Variant: ${x.node.args?.variant ?? "A"}\nIntent: ${x.run.text || x.run.title}\n${captainCardNotes(x)}${x.rn.data.brief?.text ?? ""}\n${x.rn.data.lineage ? lineageText(x.rn.data.lineage) : ""}\n${parentLine(x)}`,
    after(x, job) {
      if (x.cancelled()) throw new Error("cancelled");
      const f = kind(x), dir = x.rn.data.dir, e = entry(f); if (!existsSync(join(dir, e))) throw new Error(`the agent wrote no ${e}`);
      const id = x.ctx.deliver?.[x.node.id]?.id ?? `out-${x.run.id.toLowerCase()}-${x.node.id}`;
      if (!st.get(id)) st.create({ id, title: `${x.run.title} ${x.node.args?.variant ?? ""}`.trim(), type: artifactType(f) as any, source: f === "document" ? "md" : f === "video" ? "film" : "html", entry: e });
      if (f === "document") { const md = readFileSync(join(dir, e), "utf8"); writeFileSync(join(dir, "doc.html"), mdToDocHtml(md, docTitle(md, x.run.title))); }
      const v = st.addVersion(id, { from: dir, primary: e, parent: x.rn.data.parent?.n ?? null, ...(x.rn.data.lineage ? { refinement: x.rn.data.lineage } : {}), annotations: (x.rn.data.notes ?? []).map((n: any) => n.id), createdBy: { kind: "agent", provider: job.provider, model: job.model, run: job.id }, source: { run: x.run.id }, cost: job.cost, summary: job.said.slice(0, 300) });
      (x.ctx.deliver ??= {})[x.node.id] = { id, n: v.n, sha256: v.sha256, format: f, producer: x.node.id };
      // Approval evidence binds to the complete set, not a mutable global latest pointer.
      x.ctx.head = hash(refs(x)); x.ctx.spec ??= { done: ["Every delivered source passes its deterministic readiness check", "The content and presentation match the captain's intent"] };
      x.rn.note = `${id} v${v.n}`; return "ok";
    },
    end(x) { if (x.rn.data.dir) rmSync(x.rn.data.dir, { recursive: true, force: true }); },
  } as any;
  const previousRunInput = engine.artifacts.run;
  engine.artifacts.run = x => x.ctx.deliver ? ({ type: "run", data: refs(x), version: x.ctx.head }) : previousRunInput?.(x) ?? ({ type: "run", id: x.run.id });
  for (const t of ["web", "document", "video"]) engine.artifacts[t] = x => { const r = x.node.args?.producer === "all" ? refs(x)[0] : ref(x); return { type: t, path: st.file(r.id, r.n, entry(r.format)), version: r.n, data: r }; };
  // what the captain asked of the film, checked on the rendered MP4 itself: its length (ffprobe/ffmpeg, else the
  // renderer's own metadata), that it is not all black, and the fades the captain named (ffmpeg frame samples)
  const filmFindings = async (x: X, v: any, mp4: string, probed: number | null) => {
    const out: { message: string; expected: string; cls: string }[] = [];
    const asked = [x.run.text, ...((v?.refinement?.active ?? []) as any[]).map(q => String(q.comment ?? ""))], said = asked.join("\n");
    const want = requestedSeconds(asked), dur = probed ?? (typeof v?.render?.dur === "number" ? v.render.dur : null);
    if (want && dur !== null && Math.abs(dur - want) > Math.max(0.5, want * 0.1)) out.push({ message: `rendered MP4 runs ${dur.toFixed(1)} s; the captain asked for ${want} s`, expected: `set DUR to ${want} so the film runs ${want} s, and pace the beats to fill it`, cls: "video-duration" });
    const len = dur ?? 1, at = (t: number) => frameLuma(mp4, Math.max(0, Math.min(t, len - Math.min(0.2, len / 4))));
    const samples = await Promise.all([0.1, 0.5, 0.9].map(f => at(len * f)));
    if (samples.every(l => l !== null && l.peak < 16)) out.push({ message: "every sampled frame of the rendered MP4 is black", expected: "make the film's content visible on #stage: check opacity, colours and that render(t) draws each beat", cls: "video-black" });
    if (/\bfad(?:e|es|ed|ing)[\s-]?in\b|淡入/i.test(said)) { const [a, b] = await Promise.all([at(0), at(Math.min(1.5, len / 3))]);
      if (a !== null && b !== null && !(a.mean < 12 || a.mean < b.mean * 0.6)) out.push({ message: "the captain asked for a fade-in, but the first frame is already at full brightness", expected: "start the film from black (opacity 0) and fade it in over the first second", cls: "video-fade" }); }
    if (/\bfad(?:e|es|ed|ing)[\s-]?out\b|淡出/i.test(said)) { const [a, b] = await Promise.all([at(len), at(len * 2 / 3)]);
      if (a !== null && b !== null && !(a.mean < 12 || a.mean < b.mean * 0.6)) out.push({ message: "the captain asked for a fade-out, but the last frame is still at full brightness", expected: "fade the film to black (opacity 0) over its last second", cls: "video-fade" }); }
    return out;
  };
  // a web prototype's primary actions are clicked in a headless browser (the film renderer's Playwright): an action
  // that changes nothing is a blocking finding the refine loop gets back; no renderer is "not run", never a pass
  const smokeRuns = new Map<string, Promise<any>>();
  const webSmoke = (x: X, r: any, v: any, file: string): Promise<any> => {
    const actions = primaryActions([x.run.text, ...((v?.refinement?.active ?? []) as any[]).map(q => String(q.comment ?? ""))]);
    const key = `${r.id}@${r.n}:${r.sha256}:${hash(actions)}`; if (smokeRuns.has(key)) return smokeRuns.get(key)!;
    const run = (async () => {
      if (!actions.length) return { status: "not-run", reason: "the captain named no primary action", actions };
      const env = renderEnv(); if (env.stub || !env.canCrop) return { status: "not-run", reason: "renderer unavailable", actions };
      // bounded by runRender's interact limit, and stopped as soon as the Task is cancelled
      const job = runRender(d.dataDir, "interact", { html: file, actions: JSON.stringify(actions) }); let settled = false; job.done.finally(() => settled = true);
      while (!settled) { if (x.cancelled()) { job.cancel(); await job.done; smokeRuns.delete(key); return { status: "not-run", reason: "cancelled", actions }; } await sleep(40); }
      const result = await job.done;
      if (!result.ok || !Array.isArray(result.info?.results)) { const e = String(result.error ?? "no result").slice(0, 160); return { status: "not-run", reason: /^timed out/.test(e) ? `the page did not answer: the smoke ${e}` : `renderer unavailable: ${e}`, actions }; }
      return { status: "ran", actions, results: result.info.results.slice(0, 6) };
    })();
    smokeRuns.set(key, run); return run;
  };
  const readiness = async (x: X, r: any) => {
    const a = st.get(r.id), v = st.version(r.id, r.n); const findings: any[] = [];
    const bad = (message: string, expected: string, cls: string) => findings.push({ locator: r.format === "document" ? { type: "text", section: "source", start: 0, end: 1 } : r.format === "video" ? { type: "timeline", from: 0, to: 1 } : { type: "web", url: `#/review/${r.id}/${r.n}`, selector: "body", viewport: { width: 1280, height: 720 } }, message, expected, class: cls, severity: "blocking" });
    if (!a || !v || st.latest(r.id)?.n !== r.n || v.sha256 !== r.sha256 || st.verify(r.id, r.n).length) bad("artifact source changed or disappeared", "restore the exact version source", "artifact-integrity");
    const file = a && st.file(r.id, r.n, entry(r.format)); const s = file ? readFileSync(file, "utf8") : "";
    if (r.format === "document") { if (!/^#\s+\S/m.test(s) || s.trim().split(/\s+/).length < 4) bad("document needs a title and content", "write a # title followed by document content", "document-content"); }
    else if (r.format === "image") { try { if (!file) throw new Error("missing image"); verifyImagePng(readFileSync(file)); } catch { bad("PNG is invalid", "produce a valid bounded PNG", "image-content"); } }
    else if (!/<(?:html|body|main|div|h1|p)\b/i.test(s)) bad("page has no content element", "write a self-contained HTML page", "html-content");
    if (r.format === "web" && file && v && !findings.length) {
      const smoke = await webSmoke(x, r, v, file); ((x.ctx.webSmoke ??= {}) as any)[`${r.id}@${r.n}`] = smoke;
      for (const a of smoke.results ?? []) {
        const label = a.kind === "submit" ? "the form's submit button" : `the "${a.text}" button`, err = a.errors?.length ? ` Page errors: ${a.errors.join("; ").slice(0, 200)}` : "";
        if (!a.found) bad(`${label} is not on the page, so the captain's action cannot be tried`, `add ${label} and make it do what the captain asked: ${a.said}`, "web-interaction");
        else if (!a.changed) bad(`clicking ${label} in a headless browser changed nothing on the page.${err}`, `make ${label} visibly respond as the captain asked: ${a.said}`, "web-interaction");
      }
    }
    if (!["document", "image"].includes(r.format) && /(?:src|href)\s*=\s*["'](?:https?:|\/\/)/i.test(s)) bad("external resource URL", "embed required resources locally", "external-resource");
    if (st.notes(r.id, r.n).some(n => n.status === "open")) bad("artifact has unresolved notes", "produce a new version addressing the annotations", "open-note");
    const mp4 = r.format === "video" ? st.file(r.id, r.n, "render.mp4") : null;
    if (r.format === "video" && v?.render?.state === "failed" && v.render.code === "no-stage") bad("the film has no #stage element, so the renderer has nothing to capture", "wrap the film in #stage: a fixed 960x540 px box (540x960 vertical), never vw/vh/%", "video-stage");
    else if (r.format === "video" && (v?.render?.state !== "done" || !mp4)) bad("rendered MP4 is unavailable", "render this exact film version with the optional local renderer", "renderer-unavailable");
    else if (r.format === "video") {
      const probe = await probeVideo(mp4!);
      if (probe.kind === "no-tool") bad("the rendered MP4's size cannot be read: neither ffprobe nor ffmpeg is installed", "install ffmpeg (with ffprobe) from Doctor; the film itself needs no change", "renderer-unavailable");
      else if (probe.kind === "no-video") bad("rendered MP4 has no video stream (audio only)", "keep DUR long enough for at least two frames and #stage visible so the render has video", "video-stream");
      else if (probe.kind === "unreadable") bad(`the rendered MP4 cannot be read by ${probe.tool}`, "re-render this exact film version with a working local renderer; the film itself needs no change", "renderer-unavailable");
      else if (!((probe.width === 1920 && probe.height === 1080) || (probe.width === 1080 && probe.height === 1920))) bad(`rendered MP4 is ${probe.width}x${probe.height}, not 1920x1080 or 1080x1920`, "make #stage a fixed 960x540 px box (540x960 vertical), never vw/vh/%, so the render is exactly 1920x1080 (1080x1920)", "video-size");
      if (probe.kind === "size") for (const f of await filmFindings(x, v, mp4!, probe.duration ?? null)) bad(f.message, f.expected, f.cls);
    }
    return findings;
  };
  engine.natives["artifact-ready"] = async (_i, h) => { const x = h.x as X; const rs = x.node.args?.producer === "all" ? refs(x) : [ref(x)]; const findings = rs.length ? (await Promise.all(rs.map(r => readiness(x, r)))).flat() : [{ locator: { type: "card", field: "output" }, message: "No pinned artifact output exists", expected: "produce a versioned artifact before readiness checks", class: "missing-output", severity: "blocking" }]; return { verdict: findings.length ? "fail" : "pass", score: findings.length ? 0 : 1, findings, data: { artifacts: rs }, proves: findings.length ? [] : [0] } as any; };
  engine.actions["deliver.render"] = async x => {
    const r = ref(x), html = st.file(r.id, r.n, "film.html"); if (!html) throw new Error("film source unavailable");
    if (!renderEnv().canFilm) { st.setRender(r.id, r.n, { state: "failed", detail: "optional renderer unavailable: node, Playwright browser and ffmpeg required", ms: null }); x.rn.note = "MP4 unverified: optional renderer unavailable"; return "unavailable"; }
    const out = join(x.dir, `render-${r.id}-v${r.n}.mp4`); const job = runRender(d.dataDir, "film", { html, out });
    st.setRender(r.id, r.n, { state: "running", ms: null });
    let settled = false; job.done.finally(() => settled = true); while (!settled) { if (x.cancelled()) { job.cancel(); await job.done; throw new Error("cancelled"); } await sleep(40); }
    const result = await job.done; if (x.cancelled()) throw new Error("cancelled");
    const notes = Array.isArray(result.info?.notes) ? result.info.notes.map(String).slice(0, 8) : [];
    const code = result.ok ? null : typeof result.info?.code === "string" ? result.info.code.slice(0, 40) : null;
    st.setRender(r.id, r.n, { state: result.ok ? "done" : "failed", detail: result.error ?? (notes.join("; ") || null), ms: result.ms, ...(result.ok ? { orient: Number(result.info?.height) > Number(result.info?.width) ? "portrait" as const : "landscape" as const } : {}), ...(result.ok ? { normalized: !!result.info?.normalized, notes, dur: Number.isFinite(Number(result.info?.dur)) ? Number(result.info.dur) : null, width: Number(result.info?.width) || null, height: Number(result.info?.height) || null } : {}), ...(code ? { code } : {}) });
    if (notes.length) x.rn.note = notes.join("; ");
    if (result.ok && existsSync(out)) st.attach(r.id, r.n, "render.mp4", out);
    return result.ok ? "ok" : "unavailable";
  };
  // a drafted workflow's intent lines (the captain's words, with what done means) are the lines its acceptance card ticks
  const ownIntents = (x: X) => { const ls: any[] = Array.isArray((x.run.def as any).intents) ? (x.run.def as any).intents : []; return ls.length ? ls.map((l) => { const t = `${l.n}. ${l.text} — done means: ${l.done}`; return { en: t, "zh-TW": t }; }) : null; };
  const withIntents = <T extends { intents: any[] }>(x: X, d: T): T => { const own = ownIntents(x); return own ? { ...d, intents: own } : d; };
  const acceptanceDetail = (x: X, offered: any[] = [], kind: "artifact" | "file-plan" | "lane" = "artifact") => withIntents(x, {
    ...mergeDetail({ run: x.run.id, intent: x.run.text, spec: x.ctx.spec, ctx: x.ctx, ledger: engine.trusted(x.run.id).entries, doneMap: engine.doneLines(x.run), diff: "", stat: "", cost: null }, { intents: [], walk: [], done: (x.ctx.spec?.done ?? []).map((_: string, i: number) => i ? "內容和呈現方式符合船長的意圖" : kind === "file-plan" ? "搬移不出資料夾且不覆寫檔案" : kind === "lane" ? "本機修改通過必要檢查" : "作品原始檔與必要輸出通過完整性檢查") }),
    artifactAcceptance: { kind, offered, review:{node:x.node.id,round:x.visit,attempt:(x.rn.attempt??0)+1}, refinements:offered.filter(r=>r.format==="image").map(r=>({artifact:r.id,version:r.n,snapshot:st.version(r.id,r.n)?.refinement??null,recorded:!!st.version(r.id,r.n)?.refinement})) },
  });
  // a document's plain-wording (core/ste-wording) and readability findings, for the captain's eye: never blocking
  const wordingEye = async (x: X, offered: any[]) => {
    const lines: string[] = [], found: any[] = [];
    for (const r of offered.filter(r => r.format === "document")) {
      const file = st.file(r.id, r.n, "doc.md"); if (!file) continue; const md = readFileSync(file, "utf8");
      const texts = md.split(/\n\s*\n/).map((text, i) => ({ section: `paragraph ${i + 1}`, text: text.trim() })).filter(t => t.text && !/^(```|\|)/.test(t.text));
      const e = await engine.runCheck(x, { use: "core/ste-wording", blocking: false } as any, `accept:${r.id}@${r.n}`, { texts }).catch(() => null);
      if (!e || e.verdict === "error") lines.push(`· ${offered.length > 1 ? `${r.producer} ` : ""}Wording check not run${e?.error ? `: ${String(e.error).slice(0, 80)}` : ""}`);
      for (const f of e?.findings ?? []) found.push({ producer: r.producer, kind: "wording", section: (f.locator as any)?.section ?? null, message: f.message });
      for (const f of readabilityFindings(md)) found.push({ producer: r.producer, kind: "readability", ...f });
    }
    for (const r of offered.filter(r => r.format === "web")) { const s = x.ctx.webSmoke?.[`${r.id}@${r.n}`], tag = offered.length > 1 ? `${r.producer} ` : "";
      if (!s) lines.push(`· ${tag}Interaction smoke not run`);
      else if (s.status === "not-run") lines.push(`· ${tag}Interaction smoke not run: ${s.reason}`);
      else lines.push(`· ${tag}Interaction smoke: ${s.results.map((a: any) => `${a.kind === "submit" ? "submit" : `"${a.text}"`} ${a.changed ? "changed the page" : "did nothing"}`).join("; ")}. Check the result is what you asked for.`); }
    for (const f of found.slice(0, 10)) lines.push(`· ${offered.length > 1 ? `${f.producer} ` : ""}${f.kind === "wording" ? "Wording" : "Readability"} (${f.section}): ${f.message}`);
    if (found.length > 10) lines.push(`· and ${found.length - 10} more wording findings`);
    return { lines, found };
  };
  /** The readiness checks that ran on this run's output (check nodes, not card wording checks): an acceptance card needs at least one. */
  const readinessRan = (x: X) => { const checkNodes = new Set(x.run.def.nodes.filter(n => n.kind === "check").map(n => n.id));
    return engine.trusted(x.run.id).entries.filter(e => checkNodes.has(e.node) && !String(e.edge ?? "").startsWith("card:")); };
  const finalCard = async (x: X, error = "") => {
    const offered = refs(x); if (!offered.length) throw new Error("no output to accept");
    // an acceptance card never says "Proved by checks: None": a workflow without a readiness check that ran stops here (workflow validation refuses such a graph)
    const ran = readinessRan(x); if (!ran.length) throw new Error("no readiness check ran on this output, so nothing could prove it: the workflow needs a check node before its acceptance card");
    const done = engine.doneLines(x.run), proved = done.filter(l => l.proved), eye = done.filter(l => !l.proved), wording = await wordingEye(x, offered);
    const latest = new Map(ran.map(e => [e.check, e] as const)); const failing = [...latest.values()].filter(e => e.verdict !== "pass");
    const provedText = proved.map(l => `✓ ${l.text}`).join("\n") || `No line is proved yet: ${failing.length ? failing.map(e => `${e.check} ${e.verdict}${e.findings?.[0]?.message ? ` (${e.findings[0].message})` : ""}`).join("; ") : "the checks passed but name no done line"}.`;
    const c = await engine.card(x, "acceptance", { captainOnly: true, title: `Accept ${x.run.title}?`, zhTitle: `驗收 ${x.run.title}？`,
      en: { why: `${offered.length > 1 ? `${offered.length} versions are` : "One version is"} ready for your review. ${[...latest.keys()].join(", ")} ran on ${offered.length > 1 ? "them" : "it"}${failing.length ? `; ${failing.length} did not pass` : " and passed"}.`, how: "Approve a version, request changes with a note, or reject it." },
      zh: { why: `有 ${offered.length} 個版本等你審查。已執行的檢查：${[...latest.keys()].join("、")}${failing.length ? `；其中 ${failing.length} 個沒有通過` : "，全部通過"}。`, how: "核准一個版本、寫備註要求修改，或不採用。" },
      body: `${error}\nProved by checks:\n${provedText}\n\nNeeds your eye:\n${[...eye.map(l => `· ${l.text}`), ...wording.lines].join("\n") || "Content and presentation"}`, detail: { ...acceptanceDetail(x, offered), ...(wording.found.length ? { wording: wording.found } : {}) }, links: [...offered.flatMap(r=>{const href=websiteHref(st.get(r.id),st.version(r.id,r.n));return href?[{label:"Open website in new tab",href}]:[];}),...offered.map(r => ({ label: `${r.producer} v${r.n}`, href: `/#/review/${r.id}/${r.n}` }))], options: [...offered.map(r => ({ id: `approve-${r.producer}`, label: `Approve ${/^design-[a-z]$/.test(r.producer) ? `direction ${r.producer.slice(-1).toUpperCase()} ` : offered.length > 1 ? `${r.producer} ` : ""}v${r.n}`, labelZh: `核准${/^design-[a-z]$/.test(r.producer) ? `方向 ${r.producer.slice(-1).toUpperCase()} ` : offered.length > 1 ? `${r.producer} ` : ""}版本 ${r.n}`, primary: true })), { id: "changes", label: "Request changes", labelZh: "要求修改", note: true, noteLabel: "What to change", noteLabelZh: "要改什麼", hold: true }, { id: "reject", label: "Reject", labelZh: "不採用", hold: true }] });
    x.rn.data.offered = offered; x.rn.data.offerVisit = x.visit; x.rn.data.offerCard = c.id; x.save(); return { wait: true, note: `final acceptance ${c.id}` };
  };
  engine.cardModes["deliver-accept"] = {
    start: x => finalCard(x),
    async answer(x, c) {
      // a rejection ends the run closed, never succeeded (R-047), whatever the end node says
      if (c.answer!.choice === "reject") { x.ctx.acceptRejected = { card: c.id, by: c.answer!.by, at: c.answer!.at }; x.save(); return { outcome: "rejected" }; }
      const offers = c.detail?.artifactAcceptance?.offered; const selected = Array.isArray(offers) && offers.find((r: any) => c.answer!.choice === `approve-${r.producer}`);
      // Old in-flight cards lack pins: never synthesize pins; require a fresh card.
      if (c.id !== x.rn.data.offerCard || c.visit !== x.rn.data.offerVisit || !Array.isArray(offers) || hash(offers) !== hash(refs(x))) return finalCard(x, "The output changed or this card predates pinned acceptance. Review a fresh card.");
      if (c.answer!.choice === "changes") { if (!c.answer!.note?.trim() && !refs(x).some(r => st.notes(r.id, r.n).some(n => n.status === "open"))) return finalCard(x, "Write a change request or add an annotation first.");
        for (const r of offers) if (c.answer!.note) st.addNote(r.id, r.n, r.format === "video" ? { kind: "range", t0: 0, t1: 1, comment: c.answer!.note } : { kind: "pin", selector: r.format === "document" ? null : "body", comment: c.answer!.note });
        return { outcome: "changes" }; }
      if (!selected || (await readiness(x, selected)).length || !engine.trusted(x.run.id).ok) return finalCard(x, "Checks or annotations need attention before approval.");
      st.approve(selected.id, selected.n, c.answer!.by); x.ctx.approved = { artifact: selected.id, version: selected.n, sha256: selected.sha256, by: c.answer!.by }; return { outcome: "approved" };
    },
  };
  // the escalation after the refine loop stopped (cap, no progress, the same failure twice): it names the failing checks; Firstmate looks first
  engine.cardBodies["deliver-escalation"] = x => {
    const loop = x.run.def.nodes.find(n => n.kind === "loop" && x.run.def.edges.some(e => e.from === n.id && e.to === x.node.id));
    const producer = String(loop?.args?.producer ?? "draft"), last = loop ? x.ctx.refine?.[loop.id]?.history?.at(-1) : null, rounds = x.run.nodes[producer]?.visits ?? 0;
    const items: any[] = x.ctx.briefs?.[producer]?.items ?? []; const by = new Map<string, string>(); for (const it of items) if (it?.check && !by.has(it.check)) by.set(String(it.check), String(it.message ?? "").replace(/\s+/g, " ").slice(0, 160));
    const checks = [...by.entries()].slice(0, 6);
    const why = last?.outcome === "stalled" ? ["the checks made no progress for two rounds", "檢查連續兩輪沒有進展"] : last?.outcome === "step-back" ? ["the same check failed in two rounds in a row", "同一個檢查連續兩輪失敗"] : [`the round cap was reached after ${rounds} rounds`, `跑了 ${rounds} 輪，已到輪數上限`];
    return { title: `Checks did not pass: one more round, revise, or close? ${x.run.title}`, zhTitle: `檢查沒有通過：再給一輪、修改方向，還是關閉？${x.run.title}`,
      en: { why: `The output stopped because ${why[0]}. Still failing: ${checks.map(([c, m]) => `${c}${m ? ` (${m})` : ""}`).join("; ") || "no check named a failure"}.`, how: "Allow one more round, revise with a note the producer follows, or close the task." },
      zh: { why: `產出停住了：${why[1]}。仍未通過的檢查：${checks.map(([c]) => c).join("、") || "沒有檢查列出失敗"}。`, how: "再給一輪、寫備註讓產出者照著修改，或關閉這個任務。" },
      body: `Stopped: ${why[0]}.\n\nStill failing:\n${checks.map(([c, m]) => `- ${c}${m ? `: ${m}` : ""}`).join("\n") || "- (no check named a failure)"}`,
      options: [{ id: "retry", label: "One more round", labelZh: "再給一輪", primary: true }, { id: "changes", label: "Revise: tell the producer what to change", labelZh: "修改方向：告訴產出者要改什麼", note: true, noteLabel: "What to change", noteLabelZh: "要改什麼" }, { id: "close", label: "Close the task", labelZh: "關閉任務", hold: true }] };
  };
  // the local renderer is missing (renderer-unavailable): install it, then check again; or close
  engine.cardBodies["render-capability"] = x => { const video = x.run.def.nodes.some(n => n.do === "deliver.render");
    const what = video ? ["the MP4 renderer (node, a Playwright browser and ffmpeg)", "MP4 轉檔工具（node、Playwright 瀏覽器和 ffmpeg）"] : ["the local page renderer (a Playwright browser)", "本機頁面轉檔工具（Playwright 瀏覽器）"];
    return { title: `The renderer is missing: install it and check again, or close? ${x.run.title}`, zhTitle: `缺少轉檔工具：安裝後重新檢查，還是關閉？${x.run.title}`, direct: true,
      en: { why: `The output cannot be verified on this machine: ${what[0]} is not installed. The source stays; nothing is approved.`, how: "Install it from Doctor, then check again; or close the task." },
      zh: { why: `這台電腦無法驗證產出：沒有安裝${what[1]}。原始檔仍在；尚未核准任何東西。`, how: "在 Doctor 安裝後重新檢查，或關閉這個任務。" },
      body: `${what[0]} is not installed, so the output cannot be rendered and checked. Install it from Doctor (the source stays; no approval is recorded).`,
      options: [{ id: "retry", label: "Installed: check again", labelZh: "已安裝：重新檢查", primary: true }, { id: "close", label: "Close the task", labelZh: "關閉任務", hold: true }] }; };
  engine.actions["library.publish"] = x => { const a = x.ctx.approved; if (!a || st.version(a.artifact, a.version)?.status !== "approved" || st.verify(a.artifact, a.version).length) throw new Error("no intact pinned approval"); x.ctx.library = { ...a, href: `#/artifact/${a.artifact}` }; return "ok"; };
  engine.actions["doc.export"] = x => { const a = x.ctx.approved; if (!a) throw new Error("no approved document"); const md = readFileSync(st.file(a.artifact, a.version, "doc.md")!, "utf8"), title = docTitle(md, st.get(a.artifact)!.title); const out = join(x.dir, "exports"); mkdirSync(out, { recursive: true }); const pdf = toPdf(md, title);
    const bodies: Record<string, any> = { md, html: mdToDocHtml(md, title), docx: toDocx(md, title), pdf: pdf.pdf };
    for (const [ext, body] of Object.entries(bodies)) writeFileSync(join(out, `${a.artifact}-v${a.version}.${ext}`), body);
    x.ctx.exports = Object.keys(bodies); x.ctx.exportWarnings = pdf.lossy ? ["PDF uses ? for non-Latin text; use HTML or DOCX to preserve it"] : []; x.rn.note = `exported md, html, docx, pdf${pdf.lossy ? " (PDF character limitation)" : ""}`; return "ok";
  };
  const safePlan = (p: any) => {
    if (!p || p.status !== "planned") throw new Error("no current move plan"); d.fileorg.checkRoot(p.root);
    for (const m of p.moves.filter((m: any) => m.include)) {
      if (!m.from.startsWith(p.root + "/") || !m.to.startsWith(p.root + "/") || relative(p.root, m.to).startsWith("..")) throw new Error("move escapes folder");
      let parent = dirname(m.to); while (!existsSync(parent)) parent = dirname(parent);
      if (realpathSync(parent) !== p.root && !realpathSync(parent).startsWith(p.root + "/")) throw new Error("move destination escapes through a link");
      const s = lstatSync(m.from); if (!s.isFile() || s.isSymbolicLink() || s.size !== m.size || s.mtimeMs !== m.mtimeMs || existsSync(m.to)) throw new Error("move source or destination changed since planning");
    }
    if (!p.gates.length || p.gates.some((g: any) => g.state !== "pass")) throw new Error("move plan has no passing gates"); return p;
  };
  const moveIdentity = (p: any) => hash({ id: p.id, root: p.root, moves: p.moves.map(({ id, from, to, category, size, mtimeMs, include }: any) => ({ id, from, to, category, size, mtimeMs, include })) });
  // no folder given: a sample folder Studio makes in its own data, never the captain's files without asking. One per
  // Task, kept while the Task is open; a new one first clears those of ended Tasks.
  const openSamples = () => engine.list().filter(r => !["succeeded", "failed", "cancelled"].includes(r.status)).map(r => r.ctx?.sampleFolder).filter(Boolean);
  const newSample = () => { d.fileorg.sweepSamples?.(openSamples()); return d.fileorg.sampleFolder(); };
  engine.actions["fileorg.plan"] = x => { const folder = String(x.run.params.folder ?? "").trim() || (x.ctx.sampleFolder ??= newSample()); const p = safePlan(d.fileorg.plan(folder)); if (x.ctx.sampleFolder) x.rn.note = `sample folder ${x.ctx.sampleFolder}`; x.ctx.plan = { id: p.id, hash: hash(p), identity: moveIdentity(p) }; x.ctx.head = hash(p); return "ok"; };
  engine.natives["fileorg-plan"] = (_i, h) => { const x = h.x as X; try { const p = safePlan(d.fileorg.get(x.ctx.plan.id)); if (hash(p) !== x.ctx.plan.hash) throw new Error("plan changed"); return { verdict: "pass", score: 1, findings: [], proves: [0] } as any; } catch (e: any) { return { verdict: "fail", score: 0, findings: [{ locator: { type: "card", field: "moves" }, message: e.message, expected: "prepare a safe current move plan", class: "move-plan", severity: "blocking" }] } as any; } };
  engine.cardBodies.fileorg = x => { const p = safePlan(d.fileorg.get(x.ctx.plan.id)); return { captainOnly: true, title: `Apply ${p.moves.length} planned moves`, zhTitle: `套用 ${p.moves.length} 項搬移計畫`, body: `Plan / 搬移計畫: ${p.id}\nPlan hash / 計畫雜湊: ${x.ctx.plan.hash}\nProved by checks: moves stay inside the folder; no overwrite; move cap.\nNeeds your eye: the chosen categories.\n${p.moves.map((m: any) => `${relative(p.root, m.from)} → ${relative(p.root, m.to)}`).join("\n")}`, detail: acceptanceDetail(x, [], "file-plan"), options: [{ id: "apply", label: "Apply moves", labelZh: "套用搬移" }, { id: "discard", label: "Discard", labelZh: "捨棄", hold: true }] }; };
  engine.actions["fileorg.apply"] = x => { const stored = d.fileorg.get(x.ctx.plan.id); if (!x.ctx.plan.identity || moveIdentity(stored) !== x.ctx.plan.identity) throw new Error("reviewed move identity changed or predates pinning; prepare a new task"); const p = stored.status === "applied" ? stored : safePlan(stored); if (p.status !== "applied" && hash(p) !== x.ctx.plan.hash) throw new Error("reviewed plan changed"); const a = p.status === "applied" ? p : d.fileorg.apply(p.id); x.ctx.applied = { moved: a.moves.filter((m: any) => m.result === "moved").length, undo: `#/fileorg/${p.id}` }; return "ok"; };
  engine.actions["fileorg.discard"] = x => { d.fileorg.discard(x.ctx.plan.id); return "ok"; };
  engine.actions["lane.recipe"] = x => { const r = d.lane.repo(x.run.params.repo), a = st.approved(x.run.params.artifact); if (!r || r.remote || r.github) throw new Error("native trivial lane requires a registered local-only repository"); const target = realpathSync(r.path); for (const root of engine.deps.protectedRoots ?? []) if (existsSync(root)) { const protectedRoot = realpathSync(root); if (target === protectedRoot || target.startsWith(protectedRoot + "/")) throw new Error("lane target is protected"); } if (!a || st.verify(a.artifact, a.n).length) throw new Error("an intact approved image is required"); const c = d.lane.run({ artifact: a.artifact, repo: r.id }); if (c.state !== "ready") throw new Error(c.error ?? "recipe checks did not pass"); x.ctx.lane = { id: c.id, artifact: a.artifact, version: a.n, sha256: a.sha256, pin: c.pin }; return "ok"; };
  engine.natives["lane-ready"] = (_i, h) => { const x = h.x as X; const a = x.ctx.lane, c = a && d.lane.card(a.id), v = a && st.approved(a.artifact);
    let identity = false; try { d.lane.assertPin(c, a?.pin); identity = true; } catch {}
    const valid = identity && c?.state === "ready" && c.checks.length > 0 && c.checks.every((k: any) => k.ok !== false) && v?.n === a.version && v?.sha256 === a.sha256 && !st.verify(a.artifact, a.version).length;
    return { verdict: valid ? "pass" : "fail", score: valid ? 1 : 0, findings: valid ? [] : [{ locator: { type: "file", path: "README.md", line: 1 }, message: "recipe or approved image changed", expected: "prepare the recipe from the exact intact approved image", class: "lane-readiness", severity: "blocking" }], data: { card: c?.id, checks: c?.checks ?? [], artifact: a?.artifact, version: a?.version }, proves: valid ? [0] : [] } as any;
  };
  engine.cardBodies.lane = x => { const c = d.lane.card(x.ctx.lane.id); return { captainOnly: true, title: "Merge approved image into local README", zhTitle: "將已核准圖片合併到本機 README", body: `Repository / 儲存庫: ${c.pin.repo}\nBase / 基底: ${c.pin.base} @ ${c.pin.baseCommit}\nReviewed commit / 已審閱提交: ${c.pin.commit}\nRecipe / 修改計畫: ${c.id}\nProved by checks:\n${c.checks.filter((k: any) => k.ok).map((k: any) => k.label).join("\n")}\nNeeds your eye: README presentation.\n${c.diff}`, detail: acceptanceDetail(x, [], "lane"), options: [{ id: "merge", label: "Merge locally", labelZh: "本機合併" }, { id: "close", label: "Close", labelZh: "關閉", hold: true }] }; };
  engine.actions["lane.merge"] = async x => { const a = x.ctx.lane, v = st.approved(a.artifact); if (!v || v.n !== a.version || v.sha256 !== a.sha256 || st.verify(a.artifact, a.version).length) throw new Error("approved lane image changed"); const existing = d.lane.card(a.id); const repo = existing && d.lane.assertPin(existing, a.pin, true); if (!repo || repo.remote || repo.github) throw new Error("lane target is no longer local-only"); const c = existing.state === "merged" ? existing : await d.lane.merge(a.id, x.ctx.answers?.["merge-card"]?.by ?? "captain"); x.ctx.merged = { head: c.commit }; return "ok"; };
  engine.actions["lane.close"] = x => { d.lane.close(x.ctx.lane.id); return "ok"; };
}
