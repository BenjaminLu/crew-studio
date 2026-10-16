// Files the captain gives Firstmate in the chat: images (PNG, JPEG, WebP, GIF) and PDFs.
// The type comes from the file's own first bytes, never from its name or a browser claim.
// Bytes live in Studio's data folder under their SHA-256 (data/chat-attachments/<sha>.<ext>),
// written once with O_EXCL through a temporary file; the display name is only a label, never a path.
// Each host gets them the way its CLI really takes them (see deliveryFor):
//   claude  image and document (PDF) content blocks, base64, in the stream-json user message
//   codex   images as localImage turn input (the app-server reads the file); a PDF has no
//           input item in the app-server protocol, so Codex gets the stored file's path in the
//           turn text and is told it has not seen the contents unless it reads the file itself
// Retention: a file that was never sent goes after ATTACH_UNSENT_TTL_MS (an upload that was removed,
// refused by the host, or abandoned); a sent file stays, because the chat history shows it. Stray
// temporary files go after ATTACH_TMP_TTL_MS. Studio sweeps at start and every hour (sweep()).
import { createHash, randomBytes } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const ATTACH_MAX_PER_MESSAGE = 5;
export const ATTACH_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const ATTACH_MAX_PDF_BYTES = 20 * 1024 * 1024;
/** Claude CLI 2.1.301 refuses an image whose base64 is over 5,242,880 characters (its maxBase64Size; targetRawSize 3,932,160). */
export const CLAUDE_MAX_IMAGE_BYTES = 3_932_160;
/** The Claude request cap is 32 MiB; one message's files stay at 18 MiB raw (24 MiB base64), leaving room for the conversation. */
export const CLAUDE_MAX_MESSAGE_BYTES = 18 * 1024 * 1024;
/** The Claude API refuses an image over 8000 px on a side and a PDF over 100 pages. */
export const CLAUDE_MAX_IMAGE_SIDE = 8000;
export const CLAUDE_MAX_PDF_PAGES = 100;
/** Retention of uploads that were never sent, and of stray temporary files. */
export const ATTACH_UNSENT_TTL_MS = 24 * 3600_000;
export const ATTACH_TMP_TTL_MS = 3600_000;
/** An upload body (base64 in JSON) may be at most this long before Studio reads it. */
export const ATTACH_MAX_BODY = Math.ceil(ATTACH_MAX_PDF_BYTES / 3) * 4 + 4096;

export type AttachmentMime = "image/png" | "image/jpeg" | "image/webp" | "image/gif" | "application/pdf";
export type AttachmentKind = "image" | "pdf";
export type AttachmentRef = { id: string; mime: AttachmentMime; kind: AttachmentKind; size: number; name: string;
  /** read from the bytes when Studio can: image size in pixels, PDF page count (null when unknown) */
  width?: number | null; height?: number | null; pages?: number | null };
/** A stored attachment with the path a host may read it from. */
export type AttachmentFile = AttachmentRef & { path: string };

export type AttachmentRefusalCode = "attachmentType" | "attachmentEmpty" | "attachmentTooLarge" | "attachmentCount" | "attachmentMissing"
  | "attachmentNoHost" | "attachmentChanged" | "claudeImageTooLarge" | "claudeMessageTooLarge" | "claudeImageDimensions" | "claudePdfPages";
export type AttachmentRefusal = { ok: false; code: AttachmentRefusalCode; reason: { en: string; "zh-TW": string } };
/** A new file through a fresh temporary one (O_EXCL, no symlink followed), renamed into place: rename replaces a link, never writes through it. */
function writeNew(dir: string, file: string, bytes: Uint8Array) {
  const tmp = join(dir, `.tmp-${randomBytes(8).toString("hex")}`);
  const fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
  try { writeFileSync(fd, bytes); } finally { closeSync(fd); }
  renameSync(tmp, file);
}
const no = (code: AttachmentRefusalCode, en: string, zh: string): AttachmentRefusal => ({ ok: false, code, reason: { en, "zh-TW": zh } });

const EXT: Record<AttachmentMime, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "application/pdf": "pdf" };
const MB = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;

/** The type from the file's magic bytes, or null. */
export function sniff(b: Uint8Array): AttachmentMime | null {
  const at = (i: number, s: string) => b.length >= i + s.length && [...s].every((c, k) => b[i + k] === c.charCodeAt(0));
  if (b.length >= 8 && b[0] === 0x89 && at(1, "PNG\r\n\x1a\n")) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (at(0, "GIF87a") || at(0, "GIF89a")) return "image/gif";
  if (at(0, "RIFF") && at(8, "WEBP")) return "image/webp";
  if (at(0, "%PDF-")) return "application/pdf";
  return null;
}

/** A label to show, never used as a path: no directories, no control characters, at most 120 characters. */
export function displayName(raw: unknown, mime: AttachmentMime): string {
  const base = String(raw ?? "").split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, "").trim().slice(0, 120);
  return clean && clean !== "." && clean !== ".." ? clean : `attachment.${EXT[mime]}`;
}

/** An image's size in pixels from its header (PNG, GIF, WebP, JPEG), or null. */
export function imageSize(b: Uint8Array, mime: AttachmentMime): { width: number; height: number } | null {
  const buf = Buffer.from(b.buffer, b.byteOffset, b.byteLength);
  try {
    if (mime === "image/png" && buf.length >= 24) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (mime === "image/gif" && buf.length >= 10) return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    if (mime === "image/webp" && buf.length >= 30) {
      const kind = buf.toString("ascii", 12, 16);
      if (kind === "VP8 ") return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      if (kind === "VP8L") return { width: 1 + (((buf[22] & 0x3f) << 8) | buf[21]), height: 1 + (((buf[24] & 0x0f) << 10) | (buf[23] << 2) | ((buf[22] & 0xc0) >> 6)) };
      if (kind === "VP8X") return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
      return null;
    }
    if (mime === "image/jpeg") {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const m = buf[i + 1];
        if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { i += m === 0xff ? 1 : 2; continue; }
        if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
  } catch {}
  return null;
}
/** A PDF's page count: the /Count of the root /Type /Pages dictionary the catalog names (the newest revision of each
 *  object, so an incremental save is not counted twice; outline /Count values are never read). null when that dictionary
 *  cannot be read (compressed object streams, an indirect /Count): Studio then does not check the page count. */
export function pdfPages(b: Uint8Array): number | null {
  const t = Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString("latin1");
  const objs = new Map<string, string>();
  for (const m of t.matchAll(/(\d+)\s+(\d+)\s+obj\b([\s\S]*?)\bendobj\b/g)) objs.set(`${m[1]} ${m[2]}`, m[3]); // the last revision wins
  let catalog: string | undefined;
  for (const body of objs.values()) if (/\/Type\s*\/Catalog\b/.test(body)) catalog = body;
  const ref = catalog && /\/Pages\s+(\d+)\s+(\d+)\s+R\b/.exec(catalog);
  const root = ref ? objs.get(`${ref[1]} ${ref[2]}`) : undefined;
  if (!root || !/\/Type\s*\/Pages\b/.test(root)) return null;
  const count = /\/Count\s+(\d{1,7})\b(?!\s+\d+\s+R)/.exec(root);
  return count ? Number(count[1]) : null;
}

export const kindOf = (mime: AttachmentMime): AttachmentKind => mime === "application/pdf" ? "pdf" : "image";
const capOf = (mime: AttachmentMime) => mime === "application/pdf" ? ATTACH_MAX_PDF_BYTES : ATTACH_MAX_IMAGE_BYTES;

/** Check one file's bytes: its real type and its size cap. */
export function checkBytes(bytes: Uint8Array): { ok: true; mime: AttachmentMime } | AttachmentRefusal {
  if (!bytes.length) return no("attachmentEmpty", "The file is empty.", "檔案是空的。");
  const mime = sniff(bytes);
  if (!mime) return no("attachmentType", "Only PNG, JPEG, WebP, GIF images and PDF files can be attached (checked by the file's content, not its name).", "只能附加 PNG、JPEG、WebP、GIF 圖片和 PDF（依檔案內容判斷，不看副檔名）。");
  const cap = capOf(mime);
  if (bytes.length > cap) return no("attachmentTooLarge", `${mime === "application/pdf" ? "A PDF" : "An image"} may be at most ${MB(cap)}.`, `${mime === "application/pdf" ? "PDF" : "圖片"}最大 ${MB(cap)}。`);
  return { ok: true, mime };
}

export class AttachmentStore {
  readonly dir: string;
  constructor(dataDir: string) { this.dir = join(dataDir, "chat-attachments"); }

  /** The folder, created 0700; refused when it is (or became) a symlink or not a directory. */
  private folder(): string {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const st = lstatSync(this.dir);
    if (st.isSymbolicLink() || !st.isDirectory()) throw new Error("the attachments folder is not a plain directory");
    return this.dir;
  }

  /** Store one file under its content hash. The same bytes are stored once. */
  put(bytes: Uint8Array, rawName: unknown): { ok: true; ref: AttachmentRef } | AttachmentRefusal {
    const c = checkBytes(bytes);
    if (!c.ok) return c;
    const id = createHash("sha256").update(bytes).digest("hex");
    const dir = this.folder(), name = displayName(rawName, c.mime);
    const file = join(dir, `${id}.${EXT[c.mime]}`);
    if (!this.regular(file, bytes.length)) {
      rmSync(file, { force: true }); // a leftover that is not our plain file (a symlink, a partial write) goes
      writeNew(dir, file, bytes);
    }
    const dims = c.mime === "application/pdf" ? { pages: pdfPages(bytes) } : { ...(imageSize(bytes, c.mime) ?? { width: null, height: null }) };
    const ref: AttachmentRef = { id, mime: c.mime, kind: kindOf(c.mime), size: bytes.length, name, ...dims };
    // the record is per content and written once; the label belongs to each upload and each message, never overwritten here
    const mf = join(dir, `${id}.json`);
    if (!this.regular(mf)) writeNew(dir, mf, Buffer.from(JSON.stringify(ref))); // the first label is only a fallback
    else { const now = new Date(); try { utimesSync(mf, now, now); } catch {} } // a fresh upload restarts the unsent clock
    return { ok: true, ref };
  }

  /** The files of a queued message: kept by retention from now on. */
  markSent(ids: string[]) {
    for (const id of ids) if (/^[a-f0-9]{64}$/.test(id)) { try { this.folder(); const f = join(this.dir, `${id}.sent`); if (!this.regular(f)) writeNew(this.dir, f, Buffer.alloc(0)); } catch {} }
  }

  /** Retention. A file the retained chat history (or a queued message) references stays. A sent file the history no longer
   *  references (it rotated out) goes. An upload never sent goes after ATTACH_UNSENT_TTL_MS; a .tmp-* file after ATTACH_TMP_TTL_MS.
   *  Without `referenced` (no history known) sent files stay. Returns how many files went. */
  sweep(o: { referenced?: Set<string> | null; now?: number; unsentMs?: number; tmpMs?: number } = {}): number {
    const now = o.now ?? Date.now(), unsentMs = o.unsentMs ?? ATTACH_UNSENT_TTL_MS, tmpMs = o.tmpMs ?? ATTACH_TMP_TTL_MS, referenced = o.referenced ?? null;
    let names: string[]; try { this.folder(); names = readdirSync(this.dir); } catch { return 0; }
    const age = (f: string) => { try { return now - lstatSync(join(this.dir, f)).mtimeMs; } catch { return 0; } };
    const sent = new Set(names.filter((f) => /^[a-f0-9]{64}\.sent$/.test(f)).map((f) => f.slice(0, 64)));
    const fresh = new Set(names.filter((f) => /^[a-f0-9]{64}\.json$/.test(f) && age(f) <= unsentMs).map((f) => f.slice(0, 64)));
    const keep = (id: string) => referenced ? referenced.has(id) || (!sent.has(id) && fresh.has(id)) : sent.has(id) || fresh.has(id);
    let n = 0;
    for (const f of names) {
      const id = /^[a-f0-9]{64}(?=\.)/.exec(f)?.[0];
      const drop = f.startsWith(".tmp-") ? age(f) > tmpMs : id ? !keep(id) && (sent.has(id) || age(f) > unsentMs || !fresh.has(id)) : false;
      if (drop) { try { rmSync(join(this.dir, f), { force: true }); n++; } catch {} }
    }
    return n;
  }

  private regular(file: string, size?: number) {
    try { const st = lstatSync(file); return st.isFile() && !st.isSymbolicLink() && (size === undefined || st.size === size); } catch { return false; }
  }

  /** A stored attachment by id, re-checked from its bytes; null when the id is malformed, missing, or not a plain file. */
  get(id: unknown): AttachmentFile | null {
    if (typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id)) return null;
    let meta: AttachmentRef;
    try { this.folder(); const mf = join(this.dir, `${id}.json`); if (!this.regular(mf)) return null; meta = JSON.parse(readFileSync(mf, "utf8")); } catch { return null; }
    if (!meta || !(meta.mime in EXT)) return null;
    const extra = { width: meta.width ?? null, height: meta.height ?? null, pages: meta.pages ?? null };
    const path = join(this.dir, `${id}.${EXT[meta.mime]}`);
    if (!this.regular(path)) return null;
    // the bytes still are what they claim: type by magic bytes, size from the file itself
    let head: Buffer, size: number;
    try {
      const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try { size = fstatSync(fd).size; head = Buffer.alloc(16); readSync(fd, head, 0, 16, 0); } finally { closeSync(fd); }
    } catch { return null; }
    if (sniff(head) !== meta.mime || size !== meta.size) return null;
    return { id, mime: meta.mime, kind: kindOf(meta.mime), size, name: displayName(meta.name, meta.mime), path, ...(meta.mime === "application/pdf" ? { pages: extra.pages } : { width: extra.width, height: extra.height }) };
  }


  /** Resolve the files a message names (an id, or {id, name} with the label of that upload): every one must exist; at most ATTACH_MAX_PER_MESSAGE. */
  resolve(list: unknown): { ok: true; files: AttachmentFile[] } | AttachmentRefusal {
    if (list === undefined || list === null) return { ok: true, files: [] };
    if (!Array.isArray(list)) return no("attachmentMissing", "The attachments are not a list.", "附件格式不對。");
    const seen = new Map<string, unknown>();
    for (const x of list) { const id = typeof x === "string" ? x : (x as any)?.id; if (!seen.has(id)) seen.set(id, typeof x === "object" && x ? (x as any).name : undefined); }
    if (seen.size > ATTACH_MAX_PER_MESSAGE) return no("attachmentCount", `At most ${ATTACH_MAX_PER_MESSAGE} files per message.`, `每則訊息最多 ${ATTACH_MAX_PER_MESSAGE} 個檔案。`);
    const files: AttachmentFile[] = [];
    for (const [id, name] of seen) {
      const f = this.get(id); if (!f) return no("attachmentMissing", "An attached file is no longer available; attach it again.", "有附件已不存在，請重新附加。");
      files.push(typeof name === "string" && name.trim() ? { ...f, name: displayName(name, f.mime) } : f);
    }
    return { ok: true, files };
  }
}

const changed = () => Object.assign(new Error("an attached file changed after it was stored"), { refusal: no("attachmentChanged", "An attached file changed after it was stored; attach it again.", "附件在儲存後被改動，請重新附加。") });
/** The bytes of a stored attachment, read without following a symlink, re-checked against its id (sha256 and type). */
export function readAttachment(f: AttachmentFile): Buffer {
  let b: Buffer;
  try { const fd = openSync(f.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); try { b = readFileSync(fd); } finally { closeSync(fd); } } catch { throw changed(); }
  if (createHash("sha256").update(b).digest("hex") !== f.id || sniff(b) !== f.mime) throw changed();
  return b;
}
/** Re-check a stored file against its id before a host is handed its path (Codex reads the file itself). */
export function verifyAttachment(f: AttachmentFile): void { readAttachment(f); }

/** A warning when Studio could not read what the Claude API checks: the captain hears it before Claude refuses. */
export function unknownNote(f: AttachmentRef): { en: string; "zh-TW": string; warn: true } | null {
  if (f.kind === "pdf" && (f.pages ?? null) === null) return { en: `Page count unknown — Claude refuses PDFs over ${CLAUDE_MAX_PDF_PAGES} pages.`, "zh-TW": `讀不出頁數——Claude 會拒收超過 ${CLAUDE_MAX_PDF_PAGES} 頁的 PDF。`, warn: true };
  if (f.kind === "image" && ((f.width ?? null) === null || (f.height ?? null) === null)) return { en: `Image size unknown — Claude refuses images over ${CLAUDE_MAX_IMAGE_SIDE} px on a side.`, "zh-TW": `讀不出圖片尺寸——Claude 會拒收每邊超過 ${CLAUDE_MAX_IMAGE_SIDE} px 的圖片。`, warn: true };
  return null;
}
/** How a host gets each file, or the typed reason it cannot. Never a silent drop. */
export type Delivery = { id: string; mode: "native" | "file"; note: { en: string; "zh-TW": string; warn?: true } | null };
export function deliveryFor(host: "claude" | "codex" | null, files: AttachmentRef[]): { ok: true; deliveries: Delivery[] } | AttachmentRefusal {
  if (!files.length) return { ok: true, deliveries: [] };
  if (files.length > ATTACH_MAX_PER_MESSAGE) return no("attachmentCount", `At most ${ATTACH_MAX_PER_MESSAGE} files per message.`, `每則訊息最多 ${ATTACH_MAX_PER_MESSAGE} 個檔案。`);
  if (host === "claude") {
    const big = files.find((f) => f.kind === "image" && f.size > CLAUDE_MAX_IMAGE_BYTES);
    if (big) return no("claudeImageTooLarge", `Claude takes images up to 3.75 MB; ${big.name} is larger. Studio does not shrink or drop it.`, `Claude 只收 3.75 MB 以內的圖片；${big.name} 太大。Studio 不會縮小或略過它。`);
    const wide = files.find((f) => f.kind === "image" && Math.max(f.width ?? 0, f.height ?? 0) > CLAUDE_MAX_IMAGE_SIDE);
    if (wide) return no("claudeImageDimensions", `Claude takes images up to ${CLAUDE_MAX_IMAGE_SIDE} px on a side; ${wide.name} is ${wide.width}×${wide.height}.`, `Claude 只收每邊 ${CLAUDE_MAX_IMAGE_SIDE} px 以內的圖片；${wide.name} 是 ${wide.width}×${wide.height}。`);
    const long = files.find((f) => f.kind === "pdf" && (f.pages ?? 0) > CLAUDE_MAX_PDF_PAGES);
    if (long) return no("claudePdfPages", `Claude takes PDFs up to ${CLAUDE_MAX_PDF_PAGES} pages; ${long.name} has ${long.pages}.`, `Claude 只收 ${CLAUDE_MAX_PDF_PAGES} 頁以內的 PDF；${long.name} 有 ${long.pages} 頁。`);
    if (files.reduce((n, f) => n + f.size, 0) > CLAUDE_MAX_MESSAGE_BYTES) return no("claudeMessageTooLarge", `Claude takes at most ${MB(CLAUDE_MAX_MESSAGE_BYTES)} of files in one message. Send fewer files at a time.`, `Claude 一則訊息的附件總共最多 ${MB(CLAUDE_MAX_MESSAGE_BYTES)}，請分次傳送。`);
    return { ok: true, deliveries: files.map((f) => ({ id: f.id, mode: "native" as const, note: unknownNote(f) })) };
  }
  if (host === "codex") return { ok: true, deliveries: files.map((f) => f.kind === "image" ? { id: f.id, mode: "native" as const, note: null }
    : { id: f.id, mode: "file" as const, note: { en: "Codex cannot read PDFs directly; it opens the file itself.", "zh-TW": "Codex 不能直接讀 PDF，會自己開檔。" } }) };
  return no("attachmentNoHost", "Start Firstmate before sending files.", "請先啟動 Firstmate 再傳檔案。");
}

/** Claude stream-json content blocks for one captain message: the text, then each file as a base64 block. */
export function claudeContent(text: string, files: AttachmentFile[], read: (f: AttachmentFile) => Buffer): any[] {
  const d = deliveryFor("claude", files);
  if (!d.ok) throw Object.assign(new Error(d.reason.en), { refusal: d });
  const blocks: any[] = [];
  for (const f of files) {
    const data = read(f).toString("base64");
    if (f.kind === "image") blocks.push({ type: "image", source: { type: "base64", media_type: f.mime, data } });
    else blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data }, title: f.name });
  }
  return [{ type: "text", text: text || filesLine(files) }, ...blocks];
}

/** Codex turn input for one captain message: any Studio notice, the text (or the files line when there is none), a line per PDF, then each image as localImage. */
export function codexInput(text: string, files: AttachmentFile[], prefix = ""): any[] {
  for (const f of files) verifyAttachment(f); // Codex reads the files itself: they must still be what was stored
  const pdfs = files.filter((f) => f.kind === "pdf"), images = files.filter((f) => f.kind === "image");
  const notes = pdfs.map((f) => `[Attached PDF "${f.name}" (${f.size} bytes): Codex cannot take a PDF as input, so you have NOT seen its contents. The file is at ${f.path} (Studio's copy). Open it with your own tools if you need its contents, and say so if you cannot.]`);
  const body = [prefix, text || (files.length ? filesLine(files) : ""), ...notes].filter(Boolean).join("\n\n");
  return [{ type: "text", text: body, text_elements: [] }, ...images.map((f) => ({ type: "localImage", path: f.path }))];
}

/** What a message with files but no text says, to the model and to captain-only tools. */
export const filesLine = (files: AttachmentRef[]) => `(The captain sent ${files.length === 1 ? "a file" : `${files.length} files`} without text.)`;

/** A request body read up to `max` bytes: a longer one is refused before it is all read. */
export async function readCapped(req: Request, max: number): Promise<{ ok: true; text: string } | { ok: false }> {
  const declared = Number(req.headers.get("content-length") ?? "NaN");
  if (Number.isFinite(declared) && declared > max) return { ok: false };
  if (!req.body) return { ok: true, text: "" };
  const reader = req.body.getReader(), parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) { try { await reader.cancel(); } catch {} return { ok: false }; }
    parts.push(value);
  }
  return { ok: true, text: Buffer.concat(parts).toString("utf8") };
}

/** Upload one file: JSON {name, data: base64}. The store checks the type by magic bytes and the size cap. */
export async function uploadAttachment(req: Request, store: AttachmentStore, host: "claude" | "codex" | null):
  Promise<{ status: number; body: { ok: true; attachment: AttachmentRef; delivery: Delivery | null } | (AttachmentRefusal & { error: string }) }> {
  const refuse = (status: number, r: AttachmentRefusal) => ({ status, body: { ...r, error: `${r.reason.en} / ${r.reason["zh-TW"]}` } });
  const got = await readCapped(req, ATTACH_MAX_BODY);
  if (!got.ok) return refuse(413, no("attachmentTooLarge", `A file may be at most ${MB(ATTACH_MAX_IMAGE_BYTES)} (image) or ${MB(ATTACH_MAX_PDF_BYTES)} (PDF).`, `圖片最大 ${MB(ATTACH_MAX_IMAGE_BYTES)}，PDF 最大 ${MB(ATTACH_MAX_PDF_BYTES)}。`));
  let b: any; try { b = JSON.parse(got.text); } catch { b = null; }
  const data = typeof b?.data === "string" ? b.data : null;
  if (data === null || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) return refuse(400, no("attachmentType", "Send the file as base64 in `data`.", "請把檔案以 base64 放在 data。"));
  const put = store.put(Buffer.from(data, "base64"), b?.name);
  if (!put.ok) return refuse(put.code === "attachmentTooLarge" ? 413 : 415, put);
  const d = host ? deliveryFor(host, [put.ref]) : null;
  return { status: 200, body: { ok: true, attachment: put.ref, delivery: d?.ok ? d.deliveries[0] : null, ...(d && !d.ok ? { hostRefusal: { code: d.code, reason: d.reason } } : {}) } as any };
}
