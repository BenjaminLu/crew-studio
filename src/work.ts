// Agent work runs (M3): a designer (web) or film editor revises ONE artifact
// version. It works in an isolated copy, through Studio's work_* tools only:
// no shell, no web, no file outside the copy, and only text files it may edit.
// The same vendor-neutral providers as the chat run it (claude, codex, or a
// direct API). A finished run becomes v(N+1) of the artifact; a film is then
// rendered to MP4. Guardrails: a time limit, a tool-call limit, a path
// allowlist, and the spend the provider reports.
//   CREW_WORK_TIMEOUT_MS (default 15 min)   CREW_WORK_MAX_TOOLS (default 80)
import { withSafetyRules } from "./skills";
import { OperatingRules, withOperatingRules } from "./operating-rules";
import { roundEnv } from "./secure";
import { randomBytes } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { extname, join, normalize, relative, resolve, sep } from "node:path";
import type { ArtifactStore, Cost, Note, Version } from "./artifacts";
import { sha256File } from "./artifacts";
import type { Provider } from "./providers";
import { helperCommand } from "./self";
import { runRender } from "./render";
import { blockAt, mdToDocHtml } from "./docrender";

export type WorkEvent = { ts: string; kind: "start" | "tool" | "result" | "text" | "end" | "render" | "version" | "error"; text: string };
export type WorkRun = {
  id: string; artifact: string; from: number; kind: "web" | "film" | "doc"; provider: string; model: string; notes: string[];
  status: "running" | "done" | "failed" | "cancelled" | "rendering"; started: string; ended: string | null; tools: number;
  cost: Cost | null; claims: { id: string; addressed: boolean; how: string }[]; summary: string | null; version: number | null; error: string | null;
  log: WorkEvent[]; changed: string[]; renderProgress: number | null;
  /** the hash of the operating-rules section the agent received */
  operatingRules?: string;
};

const EDITABLE = new Set([".html", ".htm", ".css", ".js", ".mjs", ".svg", ".md", ".txt", ".json"]);
const MAX_FILE = 600_000;
const now = () => new Date().toISOString();

export const WORK_TOOLS = [
  { name: "work_list", description: "List the files in your work folder with their sizes and whether you may edit them. Folders that are links (shared assets) are read-only.",
    schema: { type: "object", properties: {} } },
  { name: "work_read", description: "Read a text file from the work folder, by line range. Lines are numbered from 1. Large files: read in ranges.",
    schema: { type: "object", properties: { path: { type: "string" }, start: { type: "number", description: "first line (default 1)" }, lines: { type: "number", description: "how many lines (default 400, max 800)" } }, required: ["path"] } },
  { name: "work_search", description: "Find lines containing a text (case-insensitive) in one file or all editable files. Returns path, line number and the line (cut to 300 chars).",
    schema: { type: "object", properties: { text: { type: "string" }, path: { type: "string" } }, required: ["text"] } },
  { name: "work_replace", description: "Replace an exact piece of text in an editable file. `old` must occur exactly once unless all=true. Prefer this to small, precise edits.",
    schema: { type: "object", properties: { path: { type: "string" }, old: { type: "string" }, new: { type: "string" }, all: { type: "boolean" } }, required: ["path", "old", "new"] } },
  { name: "work_write", description: "Write a whole editable text file (creates it if new). Only .html .css .js .svg .md .txt .json, not inside a shared-asset link.",
    schema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
  { name: "work_report", description: "Call once when you are done: for each captain note id, whether you addressed it and how (one sentence), plus a short summary of the change.",
    schema: { type: "object", properties: { notes: { type: "array", items: { type: "object", properties: { id: { type: "string" }, addressed: { type: "boolean" }, how: { type: "string" } }, required: ["id", "addressed", "how"] } },
      summary: { type: "string" } }, required: ["notes", "summary"] } },
];

const SYSTEM_WEB = `You are a designer agent working for the captain in Crew Studio.
You revise ONE web page (an HTML artifact) in a work folder, using ONLY the work_* tools. You have no shell and no web access.
- Address every captain note. Each note names an element (a CSS selector and its box) and what to change.
- Change only what the notes ask; keep the rest of the page as it is. Prefer small, exact edits with work_replace.
- Keep the page self-contained: no external URLs, scripts, fonts or images from the network.
- Keep it working at desktop and phone widths, and in light and dark if the page supports both.
- When done, call work_report once (each note id: addressed true/false and how), then answer with 2–3 short lines.`;
const SYSTEM_FILM = `You are a film editor agent working for the captain in Crew Studio.
The work folder holds film.html: a film rendered frame by frame. The page defines DUR (total seconds), render(t) and scene functions; render(t) may shift time (for example render(t){renderAt(t-OFF)}), so read how global time maps to scene time before editing.
You use ONLY the work_* tools. You have no shell and no web access. cast/ (images) is read-only.
- Each captain note gives a time range in FILM time (seconds from the start, as the viewer sees it), the scene functions active then, and what to change.
- Make the smallest edit that does it. If you change the film's length, keep DUR, every later timing and the audio schedule consistent.
- Do not break the start or the end of the film.
- When done, call work_report once (each note id: addressed true/false and how), then answer with 2–3 short lines.`;

const SYSTEM_DOC = `You are a writer agent revising ONE document for the captain in Crew Studio.
The work folder holds doc.md (Markdown, the source) and doc.html (rendered from it by Studio; never edit it). Use ONLY the work_* tools; no shell, no web.
- Each captain note names a block of the document (its line in doc.md and its text) and what to change. Address every note.
- Change only what the notes ask; keep the rest, its headings and its voice. Prefer small, exact edits with work_replace on doc.md.
- When done, call work_report once (each note id: addressed true/false and how), then answer with 2–3 short lines.`;

/** Film scene windows in film time, read from the page source (no browser needed). */
export function filmScenes(html: string): { name: string; t0: number; t1: number }[] {
  const pre = /PRE\s*=\s*([\d.]+)\s*,\s*OFF\s*=\s*PRE\s*-\s*([\d.]+)/.exec(html);
  const off = pre ? Number(pre[1]) - Number(pre[2]) : /render\(t\)\{\s*renderAt\(t-OFF\)/.test(html) ? Number(/OFF\s*=\s*([\d.]+)/.exec(html)?.[1] ?? 0) : 0;
  const out: { name: string; t0: number; t1: number }[] = [];
  const re = /function (scene\w+)\(t\)\{\s*if\(!vis\(t,\s*(-?OFF|-?[\d.]+)\s*,\s*([\d.]+)\)\)return;/g;
  let m;
  while ((m = re.exec(html))) { const a = m[2].includes("OFF") ? -off : Number(m[2]); out.push({ name: m[1], t0: Math.round((a + off) * 100) / 100, t1: Math.round((Number(m[3]) + off) * 100) / 100 }); }
  const end = /function (scene\w+)\(t\)\{if\(t<([\d.]+)\)return;/.exec(html);
  const dur = /DUR\s*=\s*([\d.]+)\s*\+\s*OFF/.exec(html);
  if (end) out.push({ name: end[1], t0: Math.round((Number(end[2]) + off) * 100) / 100, t1: dur ? Math.round((Number(dur[1]) + off) * 100) / 100 : Infinity });
  return out;
}

export class WorkRuns {
  runs = new Map<string, WorkRun>();
  private tokens = new Map<string, { run: string; dir: string; calls: number; max: number; expires: number }>();
  private live = new Map<string, () => void>();
  onChange: (r: WorkRun) => void = () => {};
  /** The writer's instructions for documents (the documents pack's writer skill), when set. */
  docSystem: (() => string) | null = null;
  constructor(readonly store: ArtifactStore, readonly dataDir: string) {
    mkdirSync(join(dataDir, "runs"), { recursive: true });
    for (const f of readdirSync(join(dataDir, "runs")).filter((x) => x.endsWith(".json"))) {
      try { const r = JSON.parse(readFileSync(join(dataDir, "runs", f), "utf8")) as WorkRun; if (r.status === "running" || r.status === "rendering") { r.status = "failed"; r.error = "Studio restarted during the run"; } this.runs.set(r.id, r); } catch {}
    }
  }
  private save(r: WorkRun) { writeFileSync(join(this.dataDir, "runs", `${r.id}.json`), JSON.stringify(r, null, 1)); this.onChange(r); }
  private log(r: WorkRun, kind: WorkEvent["kind"], text: string) { r.log.push({ ts: now(), kind, text: text.slice(0, 600) }); if (r.log.length > 400) r.log.shift(); this.save(r); }
  list(artifact?: string) { return [...this.runs.values()].filter((r) => !artifact || r.artifact === artifact).sort((a, b) => b.started.localeCompare(a.started)); }

  // --- the scoped tools ---
  hasToken(t: string) { const s = this.tokens.get(t); return !!s && s.expires > Date.now(); }
  toolList() { return WORK_TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.schema })); }
  /** A path inside the work folder: no "..", no absolute path, not through a link (shared assets). */
  private inside(dir: string, p: unknown, forWrite: boolean): string {
    const rel = String(p ?? "").replace(/^\.\//, "");
    if (!rel || rel.startsWith("/") || rel.split(/[\\/]/).includes("..")) throw new Error(`path not allowed: ${rel}`);
    const abs = normalize(resolve(dir, rel));
    if (!abs.startsWith(dir + sep)) throw new Error(`path not allowed: ${rel}`);
    let cur = dir;
    for (const part of relative(dir, abs).split(sep).slice(0, forWrite ? undefined : -1)) {
      cur = join(cur, part);
      if (existsSync(cur) && lstatSync(cur).isSymbolicLink()) { if (forWrite) throw new Error(`${rel} is inside a read-only shared folder`); }
    }
    if (forWrite && !EDITABLE.has(extname(abs).toLowerCase())) throw new Error(`${extname(abs) || "this file type"} is not editable here (text files only)`);
    return abs;
  }
  callTool(token: string, name: string, a: any): any {
    const s = this.tokens.get(token);
    if (!s || s.expires < Date.now()) return { error: "no valid work token" };
    if (++s.calls > s.max) return { error: `tool limit reached (${s.max} per run)` };
    const r = this.runs.get(s.run);
    if (!r || r.status !== "running") return { error: "this run is not running" };
    r.tools = s.calls;
    const dir = s.dir;
    try {
      if (name === "work_list") {
        const out: any[] = [];
        const walk = (d: string) => { for (const n of readdirSync(d).sort()) { const p = join(d, n); const st = lstatSync(p); const rel = relative(dir, p);
          if (st.isSymbolicLink()) out.push({ path: rel + "/", shared: true, editable: false });
          else if (st.isDirectory()) walk(p); else out.push({ path: rel, size: st.size, editable: EDITABLE.has(extname(p).toLowerCase()) }); } };
        walk(dir); return out;
      }
      if (name === "work_read") {
        const p = this.inside(dir, a?.path, false);
        if (!existsSync(p) || !statSync(p).isFile()) return { error: `no such file: ${a?.path}` };
        if (!EDITABLE.has(extname(p).toLowerCase())) return { error: "binary file: not readable here" };
        const all = readFileSync(p, "utf8").split("\n");
        const start = Math.max(1, Number(a?.start) || 1), n = Math.min(800, Math.max(1, Number(a?.lines) || 400));
        return { path: a.path, totalLines: all.length, start, end: Math.min(all.length, start + n - 1), text: all.slice(start - 1, start - 1 + n).map((l, i) => `${start + i}\t${l}`).join("\n") };
      }
      if (name === "work_search") {
        const needle = String(a?.text ?? "").toLowerCase();
        if (!needle) return { error: "text is required" };
        const files = a?.path ? [this.inside(dir, a.path, false)] : (this.callTool(token, "work_list", {}) as any[]).filter((f) => f.editable).map((f) => join(dir, f.path));
        s.calls--; // the inner listing is free
        const hits: any[] = [];
        for (const f of files) { if (!existsSync(f)) continue; readFileSync(f, "utf8").split("\n").forEach((l, i) => { if (hits.length < 50 && l.toLowerCase().includes(needle)) hits.push({ path: relative(dir, f), line: i + 1, text: l.slice(0, 300) }); }); }
        return hits;
      }
      if (name === "work_replace") {
        const p = this.inside(dir, a?.path, true);
        if (!existsSync(p)) return { error: `no such file: ${a?.path}` };
        const old = String(a?.old ?? ""), nu = String(a?.new ?? "");
        if (!old) return { error: "old is required" };
        const text = readFileSync(p, "utf8");
        const count = text.split(old).length - 1;
        if (!count) return { error: "old text not found (it must match exactly, including spaces)" };
        if (count > 1 && !a?.all) return { error: `old text occurs ${count} times; add more context or set all=true` };
        const next = a?.all ? text.split(old).join(nu) : text.replace(old, () => nu);
        if (next.length > MAX_FILE) return { error: "file would be too large" };
        writeFileSync(p, next);
        this.log(r, "tool", `edited ${a.path} (${count} replacement${count > 1 ? "s" : ""})`);
        return { ok: true, replaced: a?.all ? count : 1 };
      }
      if (name === "work_write") {
        const p = this.inside(dir, a?.path, true);
        const content = String(a?.content ?? "");
        if (content.length > MAX_FILE) return { error: "content too large" };
        mkdirSync(join(p, ".."), { recursive: true });
        writeFileSync(p, content);
        this.log(r, "tool", `wrote ${a.path} (${content.length} chars)`);
        return { ok: true };
      }
      if (name === "work_report") {
        const ids = new Set(r.notes);
        r.claims = (Array.isArray(a?.notes) ? a.notes : []).filter((x: any) => ids.has(String(x?.id))).map((x: any) => ({ id: String(x.id), addressed: x.addressed === true, how: String(x.how ?? "").slice(0, 400) }));
        r.summary = String(a?.summary ?? "").slice(0, 1000) || r.summary;
        this.save(r);
        return { ok: true, recorded: r.claims.length };
      }
      return { error: `no such tool ${name}` };
    } catch (e: any) { return { error: String(e?.message ?? e) }; }
  }

  /** The brief the agent gets: the captain's notes on this version, structured. */
  brief(kind: "web" | "film" | "doc", v: Version, notes: Note[], scenes: { name: string; t0: number; t1: number }[] = []): string {
    const docFiles = kind === "doc" ? (() => { const hp = this.store.file(v.artifact, v.n, "doc.html"), mp = this.store.file(v.artifact, v.n, "doc.md"); return hp && mp ? { html: readFileSync(hp, "utf8"), md: readFileSync(mp, "utf8") } : null; })() : null;
    const lines = notes.map((n) => {
      if (kind === "doc" && n.kind === "pin") { const at = docFiles ? blockAt(docFiles.html, docFiles.md, n.selector) : null;
        return `- ${n.id}: ${at ? `doc.md line ${at.line} ("${at.text}")` : `block \`${n.selector ?? "?"}\``}: ${n.comment}`; }
      if (n.kind === "pin") return `- ${n.id}: element \`${n.selector ?? "?"}\`${n.bbox ? ` (box x=${Math.round(n.bbox.x)} y=${Math.round(n.bbox.y)} w=${Math.round(n.bbox.w)} h=${Math.round(n.bbox.h)} px at 1280 wide)` : ""}: ${n.comment}`;
      const t0 = n.t0 ?? 0, t1 = n.t1 ?? t0;
      const sc = scenes.filter((s) => (t1 > t0 ? t1 > s.t0 && t0 < s.t1 : t0 >= s.t0 && t0 < s.t1)).map((s) => `${s.name} [${s.t0}–${s.t1 === Infinity ? "end" : s.t1}s]`);
      return `- ${n.id}: ${fmt(n.t0)}–${fmt(n.t1)}${n.box ? ` (frame area x=${pct(n.box.x)} y=${pct(n.box.y)} w=${pct(n.box.w)} h=${pct(n.box.h)})` : ""}${sc.length ? `, scenes: ${sc.join(", ")}` : ""}: ${n.comment}`;
    });
    return `Revise ${kind === "film" ? "the film" : kind === "doc" ? "the document" : "the page"} "${v.artifact}" version ${v.n} (your work folder is a copy of it).\nCaptain's notes:\n${lines.join("\n")}\n\nStart with work_list, read what you need, make the changes, then call work_report.`;
  }

  /** Start a run: copy version n to a work folder and let the provider work on it. */
  start(o: { artifact: string; n: number; noteIds?: string[]; provider: Provider; timeoutMs?: number; maxTools?: number; studioUrl: string }): WorkRun {
    const art = this.store.get(o.artifact); const v = this.store.version(o.artifact, o.n);
    if (!art || !v) throw new Error("no such version");
    if (art.source !== "html" && art.source !== "film" && art.source !== "md") throw new Error("this artifact has no source to revise (plain files take notes and briefs only)");
    if ([...this.runs.values()].some((r) => r.artifact === o.artifact && (r.status === "running" || r.status === "rendering"))) throw new Error("a run is already working on this artifact");
    const open = this.store.notes(o.artifact, o.n).filter((n) => n.status === "open" && (!o.noteIds?.length || o.noteIds.includes(n.id)));
    if (!open.length) throw new Error("no open notes to work on");
    const kind = art.source === "film" ? "film" : art.source === "md" ? "doc" : "web";
    const id = `W${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
    const dir = join(this.dataDir, "work", id);
    mkdirSync(dir, { recursive: true });
    const src = this.store.filesDir(o.artifact, o.n);
    for (const name of readdirSync(src)) {
      const p = join(src, name);
      if (lstatSync(p).isSymbolicLink()) symlinkSync(realpathSync(p), join(dir, name)); // shared assets stay shared and read-only
      else if (!(kind === "film" && name === "render.mp4")) cpSync(p, join(dir, name), { recursive: true });
    }
    const real = realpathSync(dir);
    const run: WorkRun = { id, artifact: o.artifact, from: o.n, kind, provider: o.provider.id, model: o.provider.model, notes: open.map((n) => n.id), status: "running",
      started: now(), ended: null, tools: 0, cost: null, claims: [], summary: null, version: null, error: null, log: [], changed: [], renderProgress: null };
    this.runs.set(id, run);
    const token = randomBytes(24).toString("hex");
    const timeoutMs = o.timeoutMs ?? Number(process.env.CREW_WORK_TIMEOUT_MS ?? 15 * 60_000);
    const maxTools = o.maxTools ?? Number(process.env.CREW_WORK_MAX_TOOLS ?? 80);
    this.tokens.set(token, { run: id, dir: real, calls: 0, max: maxTools, expires: Date.now() + timeoutMs + 60_000 });
    const film = kind === "film" ? readFileSync(join(dir, art.entry ?? "film.html"), "utf8") : "";
    const text = this.brief(kind, v, open, film ? filmScenes(film) : []);
    this.log(run, "start", `${o.provider.id} · ${o.provider.model} on v${o.n}: ${open.map((n) => n.id).join(", ")}`);
    const system = kind === "film" ? SYSTEM_FILM : kind === "doc" ? (this.docSystem ? `${this.docSystem()}\n\n${SYSTEM_DOC}` : SYSTEM_DOC) : SYSTEM_WEB;
    void this.drive(run, token, real, text, system, o.provider, timeoutMs, o.studioUrl);
    return run;
  }

  cancel(id: string) { const stop = this.live.get(id); if (!stop) return false; stop(); return true; }

  private async drive(run: WorkRun, token: string, dir: string, text: string, system: string, provider: Provider, timeoutMs: number, studioUrl: string) {
    const env = roundEnv(provider.envKeys ?? [], { CREW_STUDIO_URL: studioUrl, CREW_TOOL_TOKEN: token, CREW_HTTP_MAX_ROUNDS: "40" });
    const cwd = join(this.dataDir, "work-cwd"); mkdirSync(cwd, { recursive: true }); // empty: the agent reaches files only through the work tools
    const tokenFile = join(cwd, ".crew-tool-token"); writeFileSync(tokenFile, token, { mode: 0o600 }); // never on the CLI's argv (CREW_TOOL_TOKEN_FILE)
    const rules = new OperatingRules(this.dataDir).section(null); run.operatingRules = rules.hash; // a library artifact belongs to no project: the Studio-wide rules
    const session = provider.start(withOperatingRules(withSafetyRules(system), rules), WORK_TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.schema })), { studioUrl, token, tokenFile, cwd, env, mcpCommand: helperCommand("mcp") });
    let why: string | null = null;
    const stop = (reason: string) => { if (!why) { why = reason; session.interrupt(); } };
    this.live.set(run.id, () => stop("cancelled"));
    const timer = setTimeout(() => stop("timeout"), timeoutMs);
    let said = "";
    try {
      for await (const e of session.send(text)) {
        if (e.type === "toolStart") this.log(run, "tool", `${e.name} ${JSON.stringify(e.args ?? {}).slice(0, 160)}`);
        else if (e.type === "toolEnd" && e.error) this.log(run, "result", `error: ${e.error}`);
        else if (e.type === "delta") said += e.text;
        else if (e.type === "turnEnd") {
          const u = (e as any).usage;
          if (u) run.cost = { usd: u.usd ?? null, inTokens: u.inTokens ?? null, outTokens: u.outTokens ?? null };
          if (said.trim()) this.log(run, "text", said.trim());
          if (why === "cancelled") { run.status = "cancelled"; run.error = "cancelled by the captain"; }
          else if (why === "timeout") { run.status = "failed"; run.error = `no result within ${Math.round(timeoutMs / 60000)} min`; }
          else if (e.status !== "ok") { run.status = "failed"; run.error = e.message ?? e.code ?? "the agent run failed"; }
          break;
        }
      }
    } catch (err: any) { run.status = "failed"; run.error = String(err?.message ?? err); }
    finally { clearTimeout(timer); this.live.delete(run.id); this.tokens.delete(token); }
    if (run.status === "running") this.finish(run, dir, said);
    else { run.ended = now(); this.log(run, "error", run.error ?? run.status); }
  }

  private finish(run: WorkRun, dir: string, said: string) {
    if (run.kind === "doc" && existsSync(join(dir, "doc.md"))) writeFileSync(join(dir, "doc.html"), mdToDocHtml(readFileSync(join(dir, "doc.md"), "utf8"))); // the page always follows the source
    const prev = this.store.version(run.artifact, run.from)!;
    const before = new Map(prev.files.map((f) => [f.path, f.sha256]));
    const changed: string[] = [];
    const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); const st = lstatSync(p); if (st.isSymbolicLink()) continue; if (st.isDirectory()) walk(p);
      else { const rel = relative(dir, p).split(sep).join("/"); if (before.get(rel) !== sha256File(p)) changed.push(rel); } } };
    walk(dir);
    run.changed = changed;
    if (!changed.length) { run.status = "failed"; run.error = "the agent changed nothing"; run.ended = now(); this.log(run, "error", run.error); return; }
    run.summary = run.summary ?? (said.trim().slice(0, 1000) || null);
    const links = this.store.sharedLinks(run.artifact, run.from);
    const v = this.store.addVersion(run.artifact, { from: dir, parent: run.from, createdBy: { kind: "agent", provider: run.provider, model: run.model, run: run.id },
      annotations: run.notes, status: "in-review", cost: run.cost, summary: run.summary, links });
    run.version = v.n;
    for (const c of run.claims) { try { this.store.updateNote(run.artifact, run.from, c.id, { addressed: { claim: c.addressed, how: c.how, by: `${run.provider}`, version: v.n } }); } catch {} }
    this.log(run, "version", `v${v.n} created (${changed.join(", ")})`);
    rmSync(dir, { recursive: true, force: true });
    if (run.kind === "film") this.renderFilm(run, v.n); else { run.status = "done"; run.ended = now(); this.save(run); }
  }

  /** Render a film version's MP4 (also used to re-render after Doctor installs the renderer). */
  renderFilm(run: WorkRun | null, n: number, artifact = run?.artifact) {
    if (!artifact) return;
    const art = this.store.get(artifact)!;
    const html = this.store.file(artifact, n, art.entry ?? "film.html");
    if (!html) { if (run) { run.status = "done"; run.ended = now(); this.log(run, "render", "no film.html to render"); } return; }
    if (run) { run.status = "rendering"; run.renderProgress = 0; this.save(run); }
    this.store.setRender(artifact, n, { state: "running", detail: null, ms: null });
    const tmp = join(this.dataDir, "work", `render-${artifact}-v${n}.mp4`);
    mkdirSync(join(this.dataDir, "work"), { recursive: true });
    const prevMp4 = this.store.file(artifact, Math.max(1, n - 1), "render.mp4") ?? "";
    const job = runRender(this.dataDir, "film", { html, out: tmp, fps: process.env.CREW_RENDER_FPS ?? "30", width: process.env.CREW_RENDER_WIDTH ?? "1600", workers: process.env.CREW_RENDER_WORKERS ?? "4", copyFrom: prevMp4 },
      (f) => { if (run) { run.renderProgress = Math.round(f * 100) / 100; this.onChange(run); } });
    job.done.then((r) => {
      if (r.ok && existsSync(tmp)) { this.store.attach(artifact, n, "render.mp4", tmp); rmSync(tmp, { force: true }); this.store.setRender(artifact, n, { state: "done", detail: (r.info?.notes ?? []).join("; ") || null, ms: r.ms, ...(r.info?.width ? { orient: Number(r.info.height) > Number(r.info.width) ? "portrait" as const : "landscape" as const } : {}), ...(r.info?.notes?.length ? { normalized: !!r.info.normalized, notes: r.info.notes.map(String).slice(0, 8) } : {}) }); }
      else this.store.setRender(artifact, n, { state: "failed", detail: r.error ?? "render failed", ms: r.ms });
      if (run) { run.status = "done"; run.renderProgress = r.ok ? 1 : null; run.ended = now(); this.log(run, "render", r.ok ? `rendered in ${Math.round(r.ms / 1000)} s` : `render failed: ${r.error}`); }
    });
  }
}

const fmt = (t: number | null | undefined) => (t == null ? "?" : `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`);
const pct = (x: number) => `${Math.round(x * 100)}%`;
