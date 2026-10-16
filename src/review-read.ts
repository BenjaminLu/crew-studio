// A reviewer's read-only view of any changed file, by its type (unit review-modes): the reviewer is not limited to
// text. Every view counts as "read" for review-depth; "not readable" only when a type truly has no view or a cap is
// hit, always with the reason.
//   text (lockfiles and generated files too)   by line range, chunked; the ranges read are recorded
//   image (png, jpg, gif, webp)                 the picture itself, through the provider's image input where the vendor
//                                               takes one (`__image` in the tool result); svg is text
//   pdf                                         page 1 as a picture (macOS Quick Look) and the text of its pages (best
//                                               effort: uncompressed and Flate streams), up to a page cap
//   any other binary                            a metadata view: type from the magic bytes, size, sha256, a hex head, and
//                                               the same view of the base version beside it
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { inflateSync } from "node:zlib";
import { insideDir } from "./agent";
import { gitArgv, gitEnv } from "./git";

export const READ_CAP_BYTES = 20_000_000, IMAGE_CAP_BYTES = 5_000_000, PDF_PAGE_CAP = 5, LINES_PER_READ = 800;
/** a PDF's streams are untrusted: each inflates to at most this, and all of them together to at most twice it (a Flate bomb stops there) */
export const INFLATE_CAP_BYTES = 4_000_000;
/** the helpers a read starts (Quick Look, git show) run off the event loop and are killed at this */
export const HELPER_TIMEOUT_MS = 15_000;
/** run a helper without blocking Studio's event loop, killed at the timeout; its stdout as bytes, or null */
export async function helper(argv: string[], o: { cwd?: string; timeoutMs?: number; maxBytes?: number; env?: Record<string, string> } = {}): Promise<Buffer | null> {
  try {
    const p = Bun.spawn(argv, { cwd: o.cwd, stdout: "pipe", stderr: "ignore", ...(o.env ? { env: o.env } : {}) }); const timer = setTimeout(() => { try { p.kill(9); } catch {} }, o.timeoutMs ?? HELPER_TIMEOUT_MS);
    const chunks: Buffer[] = []; let n = 0; const cap = o.maxBytes ?? READ_CAP_BYTES + 1;
    for await (const c of p.stdout as any) { n += c.length; if (n > cap) { try { p.kill(9); } catch {} break; } chunks.push(Buffer.from(c)); }
    const code = await p.exited; clearTimeout(timer); return code === 0 && n <= cap ? Buffer.concat(chunks) : null;
  } catch { return null; }
}
export type FileKind = "text" | "image" | "pdf" | "binary";

/** A changed path as git prints it, made comparable: posix, no "./", no trailing slash; null when it leaves the repository. */
export function normPath(p: string): string | null {
  const n = posix.normalize(String(p ?? "").replace(/\\/g, "/").replace(/^\.\//, "")).replace(/\/+$/, "");
  return !n || n === "." || n.startsWith("../") || n === ".." || n.startsWith("/") ? null : n;
}
const IMAGE_MAGIC: [string, number[]][] = [["image/png", [0x89, 0x50, 0x4e, 0x47]], ["image/jpeg", [0xff, 0xd8, 0xff]], ["image/gif", [0x47, 0x49, 0x46, 0x38]]];
export function magicType(b: Buffer): string {
  for (const [t, m] of IMAGE_MAGIC) if (m.every((x, i) => b[i] === x)) return t;
  if (b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (b.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return "application/zip";
  if (b[0] === 0x1f && b[1] === 0x8b) return "application/gzip";
  if (b.subarray(0, 4).toString("latin1") === "\x7fELF") return "application/x-elf";
  if ([0xfeedfacf, 0xcffaedfe, 0xfeedface, 0xcefaedfe, 0xcafebabe].includes(b.length >= 4 ? b.readUInt32BE(0) : 0)) return "application/x-mach-binary";
  if (b.subarray(0, 4).toString("latin1") === "\0asm") return "application/wasm";
  if (b.subarray(0, 16).toString("latin1") === "SQLite format 3\0") return "application/vnd.sqlite3";
  return "application/octet-stream";
}
const isText = (b: Buffer) => { const head = b.subarray(0, 8192); if (head.includes(0)) return false; try { new TextDecoder("utf-8", { fatal: true }).decode(b.length > 2_000_000 ? b.subarray(0, 2_000_000) : b); return true; } catch { return false; } };
export function kindOf(b: Buffer): FileKind { const t = magicType(b); return t.startsWith("image/") ? "image" : t === "application/pdf" ? "pdf" : isText(b) ? "text" : "binary"; }
const meta = (b: Buffer | null) => (b ? { type: magicType(b), size: b.length, sha256: createHash("sha256").update(b).digest("hex"), hexHead: b.subarray(0, 64).toString("hex").replace(/(..)/g, "$1 ").trim() } : null);

/** The text of a PDF's pages, best effort without a library: its uncompressed and Flate streams, the strings of their Tj / TJ operators. */
export const PDF_STREAM_SCAN_CAP = 4000;
/** the strings a content stream shows (Tj, and TJ arrays), in one linear pass: a string with escapes and nested parentheses */
function textOps(t: string): string[] {
  const parts: string[] = []; let last: string | null = null, arr: string[] | null = null, closed: string[] | null = null;
  const unesc: Record<string, string> = { n: "\n", r: "", t: "\t" };
  for (let i = 0; i < t.length;) {
    const c = t[i];
    if (c === "(") { let depth = 1, j = i + 1, out = "";
      while (j < t.length && depth) { const d = t[j]; if (d === "\\") { const e = t[j + 1] ?? ""; out += unesc[e] ?? e; j += 2; continue; } if (d === "(") depth++; else if (d === ")" && !--depth) break; out += d; j++; }
      if (arr) arr.push(out); else { last = out; closed = null; } i = j + 1; continue; }
    if (c === "[") { arr = []; last = null; closed = null; i++; continue; }
    if (c === "]") { closed = arr; arr = null; i++; continue; }
    if (c === "T" && (t[i + 1] === "j" || t[i + 1] === "J")) { if (t[i + 1] === "j" && last !== null && !arr) parts.push(last); if (t[i + 1] === "J" && closed) parts.push(...closed); last = null; closed = null; i += 2; continue; }
    if (!arr && !/\s/.test(c)) { last = null; closed = null; }
    i++;
  }
  return parts;
}
export function pdfText(b: Buffer, pageCap = PDF_PAGE_CAP): { pages: number; text: string; skipped: number } {
  // linear and bounded on any input: at most PDF_STREAM_SCAN_CAP stream keywords looked at, each dictionary within 4 KB
  // before its keyword, no backtracking pattern over the file (a crafted PDF cannot stall the event loop)
  const s = b.toString("latin1"); const pages = (s.match(/\/Type\s*\/Page(?!s)/g) ?? []).length; const out: string[] = []; let streams = 0, inflated = 0, skipped = 0, scanned = 0;
  for (let at = s.indexOf("stream"); at >= 0 && scanned < PDF_STREAM_SCAN_CAP; at = s.indexOf("stream", at + 6)) {
    if (s.startsWith("endstream", at - 3)) continue; scanned++;
    const nl = /^stream\r?\n/.exec(s.slice(at, at + 8)); if (!nl) continue;
    let k = at - 1; while (k >= 0 && k > at - 64 && /\s/.test(s[k])) k--; if (s.slice(k - 1, k + 1) !== ">>") continue;
    const win = s.slice(Math.max(0, at - 4096), k + 1); const dict = win.slice(Math.max(0, win.lastIndexOf("obj")));
    if (streams >= pageCap * 4) break; const start = at + nl[0].length; const end = s.indexOf("endstream", start); if (end < 0) break;
    let body = b.subarray(start, end); at = end;
    if (/\/FlateDecode/.test(dict)) { if (inflated >= 2 * INFLATE_CAP_BYTES) { skipped++; continue; }
      try { body = inflateSync(body, { maxOutputLength: INFLATE_CAP_BYTES }); inflated += body.length; } catch { skipped++; continue; } } // over the cap: skipped, never allocated
    else if (/\/Filter/.test(dict)) continue;
    const t = body.toString("latin1"); if (!/T[jJ]/.test(t)) continue; streams++;
    const parts = textOps(t);
    if (parts.length) out.push(parts.join(""));
  }
  return { pages, text: out.join("\n").slice(0, 20000), skipped };
}
/** Page 1 of a PDF as a PNG, by macOS Quick Look (qlmanage, built in), off the event loop; null where it is not there. */
export async function pdfPage1(file: string): Promise<Buffer | null> {
  if (process.platform !== "darwin" || !existsSync("/usr/bin/qlmanage")) return null;
  const d = mkdtempSync(join(tmpdir(), "crew-pdf-"));
  try { await helper(["/usr/bin/qlmanage", "-t", "-s", "1200", "-o", d, file]);
    const png = readdirSync(d).find((f) => f.endsWith(".png")); return png ? readFileSync(join(d, png)) : null; }
  catch { return null; } finally { rmSync(d, { recursive: true, force: true }); }
}

/**
 * Read one file of the head for a reviewer, by type. `base` and `repo` give the base version for a binary's metadata
 * diff. The result's `view` names what was seen; `__image` carries a picture for the provider (Studio strips it from
 * the logs). `lines` is the range of a text read.
 */
export async function typedRead(dir: string, rel: string, o: { start?: number; lines?: number; base?: string | null } = {}): Promise<any> {
  const path = normPath(rel); if (!path) return { error: `path not allowed: ${rel}` };
  let abs: string; try { abs = insideDir(dir, path, false); } catch (e: any) { return { error: e.message }; }
  if (!existsSync(abs)) return { error: `no such file: ${path}` };
  const st = lstatSync(abs); if (!st.isFile()) return { error: `not a regular file: ${path}` };
  if (st.size > READ_CAP_BYTES) return { path, view: "none", notReadable: `larger than ${READ_CAP_BYTES / 1e6} MB (${st.size} bytes)`, size: st.size };
  const b = Buffer.from(await Bun.file(abs).arrayBuffer()); const kind = kindOf(b);
  if (kind === "text") {
    const all = b.toString("utf8").split("\n"); const s = Math.max(1, Number(o.start) || 1), n = Math.min(LINES_PER_READ, Math.max(1, Number(o.lines) || 400));
    return { path, view: "text", totalLines: all.length, start: s, lines: [s, Math.min(all.length, s + n - 1)], text: all.slice(s - 1, s - 1 + n).map((l, i) => `${s + i}\t${l}`).join("\n") };
  }
  if (kind === "image") {
    const m = meta(b)!; if (b.length > IMAGE_CAP_BYTES) return { path, view: "metadata", kind, ...m, notReadable: `an image over ${IMAGE_CAP_BYTES / 1e6} MB: metadata only` };
    return { path, view: "image", kind, type: m.type, size: m.size, sha256: m.sha256, note: "the picture is attached (shown to models that take images)", __image: { mimeType: m.type, data: b.toString("base64") } };
  }
  if (kind === "pdf") {
    const t = pdfText(b); const png = await pdfPage1(abs);
    return { path, view: "pdf", kind, pages: t.pages, pagesRead: Math.min(t.pages, PDF_PAGE_CAP), text: t.text || "(no extractable text)", size: b.length, sha256: meta(b)!.sha256, ...(t.skipped ? { streamsSkipped: `${t.skipped} streams over the ${INFLATE_CAP_BYTES / 1e6} MB inflate cap were skipped` } : {}),
      ...(png ? { note: "page 1 is attached as a picture", __image: { mimeType: "image/png", data: png.toString("base64") } } : { note: "no page picture on this machine (Quick Look missing)" }) };
  }
  // any other binary: what it is, and how it differs from the base version
  let before: Buffer | null = null;
  if (o.base) before = await helper(gitArgv(["show", `${o.base}:${path}`]), { cwd: dir, env: gitEnv() }); // Studio's git: its config, no inherited GIT_DIR
  const now = meta(b)!, was = meta(before);
  return { path, view: "metadata", kind, ...now, base: was, changed: was ? { type: was.type !== now.type, size: now.size - was.size, sha256: was.sha256 !== now.sha256 } : "new file" };
}

/** the reviewer's listing and search of the head's checkout are bounded too: a tree of any size, files of any size */
export const LIST_CAP = 5000, SEARCH_FILE_CAP_BYTES = 2_000_000, SEARCH_TOTAL_CAP_BYTES = 64_000_000;
const yieldLoop = () => new Promise<void>((r) => setTimeout(r, 0));
/** every file of the checkout (no links, no .git), at most LIST_CAP entries, yielding to the event loop as it walks */
export async function listTree(dir: string): Promise<{ files: { path: string; size: number }[]; truncated: boolean }> {
  const files: { path: string; size: number }[] = []; let seen = 0;
  const walk = async (d: string): Promise<boolean> => {
    let names: string[]; try { names = readdirSync(d).sort(); } catch { return true; }
    for (const n of names) { if (n === ".git") continue; if (files.length >= LIST_CAP) return false; if (++seen % 500 === 0) await yieldLoop();
      const p = join(d, n); let st; try { st = lstatSync(p); } catch { continue; } if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) { if (!(await walk(p))) return false; } else if (st.isFile()) files.push({ path: p.slice(dir.length + 1).split("\\").join("/"), size: st.size }); }
    return true; };
  const complete = await walk(dir); return { files, truncated: !complete };
}
/** lines holding a text (case-insensitive) in the checkout's text files: files over SEARCH_FILE_CAP_BYTES are skipped, the whole search stops at SEARCH_TOTAL_CAP_BYTES or 50 hits */
export async function searchTree(dir: string, text: string): Promise<any> {
  const q = text.toLowerCase(); if (!q) return { error: "text is required" };
  const { files, truncated } = await listTree(dir); const hits: any[] = []; let bytes = 0; const skipped: string[] = [];
  for (const f of files) { if (hits.length >= 50) break;
    if (f.size > SEARCH_FILE_CAP_BYTES) { skipped.push(f.path); continue; } if (bytes + f.size > SEARCH_TOTAL_CAP_BYTES) { skipped.push(f.path); continue; } bytes += f.size;
    const b = Buffer.from(await Bun.file(join(dir, f.path)).arrayBuffer()); if (kindOf(b) !== "text") continue;
    b.toString("utf8").split("\n").forEach((l, i) => { if (hits.length < 50 && l.toLowerCase().includes(q)) hits.push({ path: f.path, line: i + 1, text: l.slice(0, 300) }); }); }
  return { hits, ...(skipped.length ? { skipped: `${skipped.length} files over the search caps were not searched (fs_read reads them by range)` } : {}), ...(truncated ? { truncated: `only the first ${LIST_CAP} files were searched` } : {}) };
}
