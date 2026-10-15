// M3 routes: artifacts and their versions, review notes, agent work runs, film
// renders, and the trivial lane. server.ts hands every request here first; a
// null return means "not mine".
//   CREW_FILM_SOURCE  folder holding firstmate-film.html and cast/ (imported once as the film's source)
import { existsSync, realpathSync, statSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import {MediaLibrary} from "./media-library";
import { ArtifactStore, type Note } from "./artifacts";
import { Lane } from "./recipes";
import { WorkRuns, filmScenes } from "./work";
import { renderEnv, runRender } from "./render";
import type { Provider } from "./providers";

type Who = { kind: "desktop" } | { kind: "phone"; device: { id: string; name: string } } | { kind: string };
export type M3Deps = { dataDir: string; fileAllow: string[]; studioUrl: () => string; provider: (id?: string, model?: string) => Provider; send: (type: string, data: unknown) => void;
  allowDrive: () => boolean };

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".mp4": "video/mp4", ".json": "application/json",
  ".wav":"audio/wav", ".mp3":"audio/mpeg", ".m4a":"audio/mp4", ".ogg":"audio/ogg", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8" };
// an artifact page runs with no network at all, and only inside Studio's own frame
const CSP = "default-src 'none'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self' 'unsafe-inline'; connect-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'";

export function createM3(d: M3Deps) {
  const store = new ArtifactStore(d.dataDir);
  const media=new MediaLibrary(d.dataDir,store);
  const runs = new WorkRuns(store, d.dataDir);
  const lane = new Lane(d.dataDir, store);
  // first start: the M2 Library entries become v1 artifacts (copies)
  if (!store.list().length) {
    try {
      const legacy = JSON.parse(readFileSync(join(d.dataDir, "artifacts.json"), "utf8"));
      const film = process.env.CREW_FILM_SOURCE ?? "";
      if (Array.isArray(legacy)) store.importLegacy(legacy, { filmSource: film && existsSync(film) ? film : null, allow: d.fileAllow });
    } catch {}
  }
  let sig = 0;
  store.onChange = () => { clearTimeout(sig as any); sig = setTimeout(() => d.send("artifacts", { at: Date.now() }), 150) as any; };
  store.onApproved = (a, v) => { const made = lane.proposeUpdates(a, v); if (made.length) d.send("lane", { cards: lane.cards() }); };
  runs.onChange = (r) => d.send("run", r);
  lane.onChange = () => d.send("lane", { at: Date.now() });

  const cropPin = (id: string, n: number, note: Note) => {
    const art = store.get(id); const v = store.version(id, n);
    if (!art || !v?.primary || (art.source !== "html" && art.source !== "md")) return;
    const html = store.file(id, n, v.primary); if (!html) return;
    const out = join(store.vdir(id, n), "crops", `${note.id}.png`);
    mkdirSync(join(store.vdir(id, n), "crops"), { recursive: true });
    const a: Record<string, string> = { html, out, width: "1280" };
    if (note.selector) a.selector = note.selector;
    if (note.bbox) a.bbox = [note.bbox.x, note.bbox.y, note.bbox.w, note.bbox.h].map((x) => Math.round(x)).join(",");
    runRender(d.dataDir, "crop", a).done.then((r) => { if (r.ok && existsSync(out)) { try { store.updateNote(id, n, note.id, { crop: `/api/artifacts/${id}/v/${n}/crops/${note.id}.png` }); } catch {} } });
  };

  const by = (who: Who) => (who.kind === "phone" ? `captain (phone: ${(who as any).device?.name ?? "?"})` : "captain");

  async function handle(req: Request, url: URL, who: Who, writing: boolean): Promise<Response | null> {
    const p = url.pathname;
    if (!p.startsWith("/api/artifacts") && !p.startsWith("/api/runs") && !p.startsWith("/api/lane") && !p.startsWith("/af/") && p !== "/api/render") return null;
    if (writing && who.kind === "phone") {
      if (p === "/api/lane/repos") return json({ error: "do this on the Mac", code: "desktopOnly" }, 403);
      if (!d.allowDrive()) return json({ error: "this phone may read only; allow phone driving on the Mac first", code: "noDrive" }, 403);
    }
    let b: any = {};
    if (writing) { try { b = await req.json(); } catch { b = {}; } }
    try {
      const managedTarget=/^\/api\/artifacts\/([^/]+)/.exec(p);
      if(writing&&managedTarget&&media.owns(decodeURIComponent(managedTarget[1])))return json({error:"Workflow-owned media requires its bound Task",code:"managedMedia"},409);
      // --- version files, served with no network and Studio-only framing ---
      if (p.startsWith("/af/")) {
        const [, , id, nStr, ...rest] = p.split("/");
        const file = store.file(decodeURIComponent(id), Number(nStr), decodeURIComponent(rest.join("/")));
        if (!file) return new Response("not found", { status: 404 });
        const type = TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
        const f = Bun.file(file), size = f.size;
        const base = { "content-type": type, "content-security-policy": CSP, "x-content-type-options": "nosniff", "cache-control": "no-cache", "accept-ranges": "bytes" };
        const r = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? ""); // players seek with byte ranges
        if (r) {
          const start = r[1] ? Number(r[1]) : Math.max(0, size - Number(r[2])), end = r[1] && r[2] ? Math.min(size - 1, Number(r[2])) : size - 1;
          if (start >= size || start > end) return new Response("", { status: 416, headers: { "content-range": `bytes */${size}` } });
          return new Response(f.slice(start, end + 1), { status: 206, headers: { ...base, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) } });
        }
        return new Response(f, { headers: { ...base, "content-length": String(size) } });
      }
      if (p === "/api/render") return json(renderEnv());
      if (p === "/api/artifacts" && !writing) return json({ artifacts: store.view(), runs: runs.list().slice(0, 30).map(slim), render: renderEnv() });
      if (p === "/api/artifacts" && writing) {
        // a new artifact from posted HTML (web) or a file already on this Mac under Studio's data folder
        const id = String(b?.id ?? "").trim(), title = String(b?.title ?? id).trim();
        if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(id)) return json({ error: "id: lowercase letters, digits and dashes" }, 400);
        const type = b?.type === "audio" ? "audio" : b?.type === "image" ? "image" : b?.type === "video" ? "video" : "web";
        const tmp = join(d.dataDir, "work", `new-${id}`); rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true });
        let entry: string;let audioBytes:Buffer|undefined;
        if (type === "web") { const html = String(b?.html ?? ""); if (!html.includes("<")) return json({ error: "html is required" }, 400); entry = "index.html"; writeFileSync(join(tmp, entry), html); }
        else { const src = String(b?.path ?? ""); const ok = src.startsWith(d.dataDir + "/") && existsSync(src); if (!ok) return json({ error: "path must be a file under Studio's data folder" }, 400);
          entry = `${type}${extname(src).toLowerCase()}`;
          if(type==="audio"){const real=realpathSync(src),base=realpathSync(d.dataDir);if(!real.startsWith(base+"/")||!statSync(real).isFile()||statSync(real).size>128*1024*1024)return json({error:"Unsafe audio import"},400);const mime=({".wav":"audio/wav",".mp3":"audio/mpeg",".m4a":"audio/mp4",".ogg":"audio/ogg"}as const)[extname(real).toLowerCase()];if(!mime)return json({error:"Unsupported audio format"},400);audioBytes=readFileSync(real);await media.validate({bytes:audioBytes,mime},"audio",{signal:req.signal,authorize(){if(req.signal.aborted)throw new Error("Import cancelled");}});}
          writeFileSync(join(tmp, entry), audioBytes??readFileSync(src)); }
        store.create({ id, title, type, source: type === "web" ? "html" : "file", entry, note: b?.note ?? null });
        const v = store.addVersion(id, { from: tmp, primary: entry, createdBy: { kind: type === "audio"?"import":"captain" }, status: "in-review", summary: b?.summary ?? null });
        rmSync(tmp, { recursive: true, force: true });
        return json({ artifact: store.get(id), version: v });
      }
      let m = /^\/api\/artifacts\/([^/]+)$/.exec(p);
      if (m && !writing) {
        const id = decodeURIComponent(m[1]); const a = store.get(id);
        if (!a) return json({ error: "no such artifact" }, 404);
        let scenes: any[] = [];
        if (a.source === "film") { const v = store.latest(id); const f = v && store.file(id, v.n, a.entry ?? "film.html"); if (f) scenes = filmScenes(readFileSync(f, "utf8")); }
        return json({ artifact: a, managedMedia:media.owns(id), versions: store.versions(id).map((v) => ({ ...v, notes: store.notes(id, v.n), integrity: store.verify(id, v.n) })),
          runs: runs.list(id).map(slim), cards: lane.cards().filter((c) => c.artifact === id), repos: lane.repos(), scenes, render: renderEnv() });
      }
      m = /^\/api\/artifacts\/([^/]+)\/versions$/.exec(p);
      if (m && writing) {
        // the captain supplies a new version: posted HTML (web) or a file under Studio's data folder
        const id = decodeURIComponent(m[1]); const a = store.get(id); const last = store.latest(id);
        if (!a || !last) return json({ error: "no such artifact" }, 404);
        const tmp = join(d.dataDir, "work", `up-${id}-${Date.now()}`); mkdirSync(tmp, { recursive: true });
        const entry = last.primary ?? a.entry ?? "index.html";
        if (a.source === "html") { const html = String(b?.html ?? ""); if (!html.includes("<")) return json({ error: "html is required" }, 400); writeFileSync(join(tmp, entry), html); }
        else { const src = String(b?.path ?? ""); if (!src.startsWith(d.dataDir + "/") || !existsSync(src)) return json({ error: "path must be a file under Studio's data folder" }, 400); writeFileSync(join(tmp, entry), readFileSync(src)); }
        const v = store.addVersion(id, { from: tmp, primary: entry, parent: last.n, createdBy: { kind: "captain" }, status: "in-review", summary: b?.summary ?? null, links: store.sharedLinks(id, last.n) });
        rmSync(tmp, { recursive: true, force: true });
        return json(v);
      }
      m = /^\/api\/artifacts\/([^/]+)\/v\/(\d+)\/(notes|approve|request|render|brief|crops|findings)(?:\/([^/]+))?$/.exec(p);
      if (m) {
        const id = decodeURIComponent(m[1]), n = Number(m[2]), what = m[3], sub = m[4] ? decodeURIComponent(m[4]) : null;
        if (!store.version(id, n)) return json({ error: "no such version" }, 404);
        if(media.owns(id)&&(writing||what==="brief"))return json({error:"This media is owned by its workflow. Review or refine it from the bound Task.",code:"managedMedia"},409);
        if (what === "crops" && sub && !writing) { const f = join(store.vdir(id, n), "crops", sub.replace(/[^\w.-]/g, "")); return existsSync(f) ? new Response(Bun.file(f), { headers: { "content-type": "image/png" } }) : new Response("not found", { status: 404 }); }
        if (what === "notes" && !writing) return json(store.notes(id, n));
        if (what === "findings" && !writing) return json(store.findings(id, n, url.searchParams.get("all") !== "1"));
        if (what === "notes" && writing && !sub) { const note = store.addNote(id, n, b); if (note.kind === "pin") cropPin(id, n, note); return json(note); }
        if (what === "notes" && writing && sub) return json(store.updateNote(id, n, sub, { status: b?.status, verified: b?.verified, comment: b?.comment }));
        if (what === "approve" && writing) return json(store.approve(id, n, by(who)));
        if (what === "brief") {
          const a = store.get(id)!; const v = store.version(id, n)!;
          const f = a.source === "film" ? store.file(id, n, a.entry ?? "film.html") : null;
          const notes = store.notes(id, n).filter((x) => x.status === "open");
          const text = runs.brief(a.source === "film" ? "film" : a.source === "md" ? "doc" : "web", v, notes, f ? filmScenes(readFileSync(f, "utf8")) : []);
          return json({ artifact: id, version: n, notes, brief: text, structured: notes.map(({ crop, ...x }) => x) });
        }
        if (what === "request" && writing) {
          if(store.get(id)?.type==="audio")return json({error:"Audio generation is not available; import another recorded audio version.",code:"audioGenerationUnavailable"},409);
          const provider = d.provider(b?.provider || undefined, b?.model || undefined);
          const r = runs.start({ artifact: id, n, noteIds: Array.isArray(b?.notes) ? b.notes.map(String) : undefined, provider, studioUrl: d.studioUrl() });
          return json(slim(r));
        }
        if (what === "render" && writing) {
          const a = store.get(id)!; if (a.source !== "film") return json({ error: "only an HTML film renders" }, 400);
          if (!renderEnv().canFilm) return json({ error: "the renderer is not installed (see Doctor)" }, 409);
          runs.renderFilm(null, n, id); return json({ ok: true });
        }
      }
      m = /^\/api\/runs\/([^/]+)(\/cancel)?$/.exec(p);
      if (m) {
        const r = runs.runs.get(decodeURIComponent(m[1])); if (!r) return json({ error: "no such run" }, 404);
        if (m[2] && writing) return runs.cancel(r.id) ? json({ ok: true }) : json({ error: "the run is not running" }, 409);
        return json(r);
      }
      // --- the trivial lane ---
      if (p === "/api/lane" && !writing) return json({ cards: lane.cards(), repos: lane.repos(), maxLines: lane.maxLines });
      if (p === "/api/lane/repos" && writing) return json(lane.addRepo(b));
      if (p === "/api/lane/run" && writing) return media.owns(String(b?.artifact??""))?json({error:"Workflow-owned media requires its bound Task",code:"managedMedia"},409):json(lane.run({ artifact: String(b?.artifact ?? ""), version: b?.version ? Number(b.version) : undefined, repo: String(b?.repo ?? ""), name: b?.name }));
      m = /^\/api\/lane\/([^/]+)\/(pr|merge|close|prepare|ci|blob|preview)$/.exec(p);
      if (m) {
        const id = decodeURIComponent(m[1]);
        if (m[2] === "blob") { const x = lane.blob(id, url.searchParams.get("path") ?? ""); return x ? new Response(x.bytes, { headers: { "content-type": x.type, "content-security-policy": CSP } }) : new Response("not found", { status: 404 }); }
        if (m[2] === "preview") {
          const c = lane.card(id); if (!c?.readme) return json({ error: "no README" }, 404);
          const { mdToHtml } = await import("./recipes");
          return json({ html: mdToHtml(c.readme, (u) => /^https?:/.test(u) ? "" : `/api/lane/${encodeURIComponent(id)}/blob?path=${encodeURIComponent(u.replace(/^\.\//, ""))}`) });
        }
        if (!writing) return json({ error: "POST only" }, 405);
        if (m[2] === "pr") return json(await lane.openPr(id));
        if (m[2] === "ci") return json(await lane.refreshCi(id));
        if (m[2] === "merge") return json(await lane.merge(id, by(who)));
        if (m[2] === "close") return json(lane.close(id));
        if (m[2] === "prepare") return json(lane.prepare(id));
      }
      if (p.startsWith("/api/lane/")) { const c = lane.card(decodeURIComponent(p.slice("/api/lane/".length))); return c ? json(c) : json({ error: "no such card" }, 404); }
      return json({ error: "not found" }, 404);
    } catch (e: any) { return json({ error: String(e?.message ?? e) }, 400); }
  }
  return { handle, store, runs, lane };
}

const slim = (r: any) => ({ ...r, log: r.log?.slice(-60) });
