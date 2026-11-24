// A review room's page version as a file for the captain to keep (docs/units/review-room.md, "Downloading a page"): the bytes
// exactly as Studio kept them, each file checked against the sha256 it was kept with. A version of one file downloads as that
// file (baton's page is one self-contained HTML file); a version with more files (a page and its pictures) as a zip of them, at
// the paths the page refers to them by. The room's frame stays sandboxed: Studio serves the file as an attachment, never shown
// in Studio's origin, and the page's own controls (a "download context" button) work once the file is opened on its own.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import type { ArtifactStore } from "../artifacts";
import { insideDir } from "../agent";
import { zip } from "../zip";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const refuse = (message: string, code: string) => Object.assign(new Error(message), { code });
const TYPE: Record<string, string> = { ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".md": "text/markdown; charset=utf-8", ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".mp4": "video/mp4", ".webm": "video/webm" };

/** one part of a file name: ASCII letters, digits, ".", "_" and "-" only (no path, no quote, no control), never empty */
const part = (s: unknown, max: number, empty: string) => String(s ?? "").normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/\.{2,}/g, ".").replace(/-{2,}/g, "-").replace(/^[.-]+|[.-]+$/g, "").slice(0, max).replace(/[.-]+$/, "") || empty;
/** `<room>-v<n>-<skill><ext>`: the name the browser saves the file as */
export const downloadName = (room: string, n: number, skill: string, ext: string) => {
  const e = /^\.[A-Za-z0-9]{1,8}$/.test(ext) ? ext.toLowerCase() : ".bin";
  return `${part(room, 80, "room")}-v${Math.max(0, Math.floor(Number(n) || 0))}-${part(skill, 60, "page")}${e}`;
};

export type PageFile = { path: string; sha256: string; read: () => Buffer };
export type PageDownload = { name: string; type: string; body: Buffer };

/** the version's files read and checked (a file missing or changed since it was kept refuses the download: `integrity`), as one
 *  file or a zip of them */
export function packPage(room: string, n: number, skill: string, entry: string, files: PageFile[]): PageDownload {
  if (!files.length || !files.some((f) => f.path === entry)) throw refuse("No such page version / 沒有這個頁面版本", "not_found");
  const got = files.map((f) => { let b: Buffer; try { b = f.read(); } catch { throw refuse(`v${n}'s ${f.path} is missing: nothing was downloaded / v${n} 的 ${f.path} 不見了：沒有下載`, "integrity"); }
    if (sha(b) !== f.sha256) throw refuse(`v${n}'s ${f.path} changed since it was made: nothing was downloaded / v${n} 的 ${f.path} 產生後被改過：沒有下載`, "integrity");
    return { name: f.path, data: b }; });
  if (got.length === 1) { const e = extname(entry).toLowerCase(); return { name: downloadName(room, n, skill, e), type: TYPE[e] ?? "application/octet-stream", body: got[0].data }; }
  return { name: downloadName(room, n, skill, ".zip"), type: "application/zip", body: zip(got, { store: true }) }; // stored: pictures and videos are compressed already, and nothing is deflated on the request path
}

/** a room's version as kept (the explainer's `pages`: each version's folder and its files with their sha256) */
export function roomPageDownload(room: string, pages: { n: number; dir: string; entry: string; skill: { id: string }; files: { path: string; sha256: string }[] }[], v: unknown): PageDownload {
  const x = pages.find((p) => p.n === Number(v)); if (!x) throw refuse("No such page version / 沒有這個頁面版本", "not_found");
  return packPage(room, x.n, x.skill.id, x.entry, x.files.map((f) => ({ path: f.path, sha256: f.sha256, read: () => readFileSync(insideDir(x.dir, f.path, false)) })));
}

/** a page version of a room saved in the Library (`pages/v<n>/…` of that save), checked against the save's own manifest */
export function libraryPageDownload(store: ArtifactStore, aid: string, n: number, v: unknown): PageDownload {
  const a = store.get(aid), ver = a?.source === "room" ? store.version(aid, n) : null, f = ver ? store.file(aid, n, "room.json") : null;
  if (!f) throw refuse("No such saved room / 沒有這個存下來的審查室", "not_found");
  // the manifest names the entry and the skill (the file's type and name): it is checked like the pages
  const raw = readFileSync(f), want = ver!.files.find((x) => x.path === "room.json")?.sha256;
  if (!want || sha(raw) !== want) throw refuse("This save's room.json changed since it was saved: nothing was downloaded / 這次存檔的 room.json 存下來之後被改過：沒有下載", "integrity");
  const snap = JSON.parse(raw.toString("utf8")), pv = Number(v), page = Array.isArray(snap?.pages) ? snap.pages.find((p: any) => p?.n === pv) : null;
  if (!page) throw refuse("No such page version in this save / 這次存檔沒有這個頁面版本", "not_found");
  const pre = `pages/v${pv}/`, entry = String(page.entry ?? "").startsWith(pre) ? String(page.entry).slice(pre.length) : "";
  const files = ver!.files.filter((x) => x.path.startsWith(pre)).map((x) => ({ path: x.path.slice(pre.length), sha256: x.sha256,
    read: () => { const p = store.file(aid, n, x.path); if (!p) throw new Error("missing"); return readFileSync(p); } }));
  return packPage(String(snap.room ?? aid), pv, String(page.skill?.id ?? ""), entry, files);
}

/** the response: an attachment, never rendered in Studio's origin (and sandboxed with no network should anything render it) */
export const downloadResponse = (d: PageDownload) => new Response(d.body, { headers: { "content-type": d.type, "content-disposition": `attachment; filename="${d.name}"`,
  "cache-control": "no-store", "x-content-type-options": "nosniff", "content-security-policy": "sandbox; default-src 'none'", "referrer-policy": "no-referrer", "cross-origin-resource-policy": "same-origin" } });
