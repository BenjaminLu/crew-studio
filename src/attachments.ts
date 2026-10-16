// Files the captain gives Firstmate in the chat: images (PNG, JPEG, WebP, GIF) and PDFs.
// The type comes from the file's own first bytes, never from its name or a browser claim.
// Bytes live in Studio's data folder under their SHA-256 (data/chat-attachments/<sha>.<ext>),
// written once with O_EXCL through a temporary file; the display name is only a label, never a path.
// Each host gets them the way its CLI really takes them (see deliveryFor):
//   claude  image and document (PDF) content blocks, base64, in the stream-json user message
//   codex   images as localImage turn input (the app-server reads the file); a PDF has no
//           input item in the app-server protocol, so Codex gets the stored file's path in the
//           turn text and is told it has not seen the contents unless it reads the file itself
import { createHash, randomBytes } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const ATTACH_MAX_PER_MESSAGE = 5;
export const ATTACH_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const ATTACH_MAX_PDF_BYTES = 20 * 1024 * 1024;
/** The Claude API refuses a base64 image over 5 MB. */
export const CLAUDE_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** The Claude API takes at most 32 MB per request; base64 adds a third, so one message's files stay under 24 MB. */
export const CLAUDE_MAX_MESSAGE_BYTES = 24 * 1024 * 1024;
/** An upload body (base64 in JSON) may be at most this long before Studio reads it. */
export const ATTACH_MAX_BODY = Math.ceil(ATTACH_MAX_PDF_BYTES / 3) * 4 + 4096;

export type AttachmentMime = "image/png" | "image/jpeg" | "image/webp" | "image/gif" | "application/pdf";
export type AttachmentKind = "image" | "pdf";
export type AttachmentRef = { id: string; mime: AttachmentMime; kind: AttachmentKind; size: number; name: string };
/** A stored attachment with the path a host may read it from. */
export type AttachmentFile = AttachmentRef & { path: string };

export type AttachmentRefusalCode = "attachmentType" | "attachmentEmpty" | "attachmentTooLarge" | "attachmentCount" | "attachmentMissing"
  | "attachmentNoHost" | "claudeImageTooLarge" | "claudeMessageTooLarge";
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
    const ref: AttachmentRef = { id, mime: c.mime, kind: kindOf(c.mime), size: bytes.length, name };
    writeNew(dir, join(dir, `${id}.json`), Buffer.from(JSON.stringify(ref)));
    return { ok: true, ref };
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
    const path = join(this.dir, `${id}.${EXT[meta.mime]}`);
    if (!this.regular(path)) return null;
    // the bytes still are what they claim: type by magic bytes, size from the file itself
    let head: Buffer, size: number;
    try {
      const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try { size = fstatSync(fd).size; head = Buffer.alloc(16); readSync(fd, head, 0, 16, 0); } finally { closeSync(fd); }
    } catch { return null; }
    if (sniff(head) !== meta.mime || size !== meta.size) return null;
    return { id, mime: meta.mime, kind: kindOf(meta.mime), size, name: displayName(meta.name, meta.mime), path };
  }


  /** Resolve the ids a message names: every one must exist; at most ATTACH_MAX_PER_MESSAGE. */
  resolve(ids: unknown): { ok: true; files: AttachmentFile[] } | AttachmentRefusal {
    if (ids === undefined || ids === null) return { ok: true, files: [] };
    if (!Array.isArray(ids)) return no("attachmentMissing", "The attachments are not a list.", "附件格式不對。");
    const uniq = [...new Set(ids)];
    if (uniq.length > ATTACH_MAX_PER_MESSAGE) return no("attachmentCount", `At most ${ATTACH_MAX_PER_MESSAGE} files per message.`, `每則訊息最多 ${ATTACH_MAX_PER_MESSAGE} 個檔案。`);
    const files: AttachmentFile[] = [];
    for (const id of uniq) { const f = this.get(id); if (!f) return no("attachmentMissing", "An attached file is no longer available; attach it again.", "有附件已不存在，請重新附加。"); files.push(f); }
    return { ok: true, files };
  }
}

/** The bytes of a stored attachment, read without following a symlink, re-checked against its id. */
export function readAttachment(f: AttachmentFile): Buffer {
  const fd = openSync(f.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let b: Buffer; try { b = readFileSync(fd); } finally { closeSync(fd); }
  if (createHash("sha256").update(b).digest("hex") !== f.id || sniff(b) !== f.mime) throw new Error("an attached file changed after it was stored");
  return b;
}

/** How a host gets each file, or the typed reason it cannot. Never a silent drop. */
export type Delivery = { id: string; mode: "native" | "file"; note: { en: string; "zh-TW": string } | null };
export function deliveryFor(host: "claude" | "codex" | null, files: AttachmentRef[]): { ok: true; deliveries: Delivery[] } | AttachmentRefusal {
  if (!files.length) return { ok: true, deliveries: [] };
  if (files.length > ATTACH_MAX_PER_MESSAGE) return no("attachmentCount", `At most ${ATTACH_MAX_PER_MESSAGE} files per message.`, `每則訊息最多 ${ATTACH_MAX_PER_MESSAGE} 個檔案。`);
  if (host === "claude") {
    const big = files.find((f) => f.kind === "image" && f.size > CLAUDE_MAX_IMAGE_BYTES);
    if (big) return no("claudeImageTooLarge", `Claude takes images up to ${MB(CLAUDE_MAX_IMAGE_BYTES)}; ${big.name} is larger. Studio does not shrink or drop it.`, `Claude 只收 ${MB(CLAUDE_MAX_IMAGE_BYTES)} 以內的圖片；${big.name} 太大。Studio 不會縮小或略過它。`);
    if (files.reduce((n, f) => n + f.size, 0) > CLAUDE_MAX_MESSAGE_BYTES) return no("claudeMessageTooLarge", `Claude takes at most ${MB(CLAUDE_MAX_MESSAGE_BYTES)} of files in one message. Send fewer files at a time.`, `Claude 一則訊息的附件總共最多 ${MB(CLAUDE_MAX_MESSAGE_BYTES)}，請分次傳送。`);
    return { ok: true, deliveries: files.map((f) => ({ id: f.id, mode: "native" as const, note: null })) };
  }
  if (host === "codex") return { ok: true, deliveries: files.map((f) => f.kind === "image" ? { id: f.id, mode: "native" as const, note: null }
    : { id: f.id, mode: "file" as const, note: { en: "Codex cannot take a PDF as input. It gets the file's path and must open the file itself to read it.", "zh-TW": "Codex 無法直接讀 PDF；它只會拿到檔案路徑，要自己打開檔案才讀得到內容。" } }) };
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

/** Codex turn input for one captain message: the text (with a line per PDF), then each image as localImage. */
export function codexInput(text: string, files: AttachmentFile[]): any[] {
  const pdfs = files.filter((f) => f.kind === "pdf"), images = files.filter((f) => f.kind === "image");
  const notes = pdfs.map((f) => `[Attached PDF "${f.name}" (${f.size} bytes): Codex cannot take a PDF as input, so you have NOT seen its contents. The file is at ${f.path} (read-only, Studio's copy). Open it with your own tools if you need its contents, and say so if you cannot.]`);
  const body = [text || (images.length && !pdfs.length ? filesLine(files) : ""), ...notes].filter(Boolean).join("\n\n");
  return [{ type: "text", text: body, text_elements: [] }, ...images.map((f) => ({ type: "localImage", path: f.path }))];
}

const filesLine = (files: AttachmentRef[]) => `(The captain sent ${files.length === 1 ? "a file" : `${files.length} files`} without text.)`;

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
