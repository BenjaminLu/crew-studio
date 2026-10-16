// Chat attachments for the Firstmate chat: the captain's images and PDFs.
//   1. the store: type by magic bytes, size and count caps, content-hash names, no traversal, no symlink write-through
//   2. the turn payload each host really takes, through the stub CLIs: Codex localImage items (+ a PDF named by path),
//      Claude image and document blocks (base64); a typed refusal before anything is sent
//   3. the server: CSRF, session, phone drive gate, upload caps, serving, send, history in /api/main
// Offline: stub CLIs only, a temporary HOME and data folder.
//   bun tests/chat-attachments.ts
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, symlinkSync, utimesSync, writeFileSync, appendFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freePort, waitUp } from "./boot.mjs";
import { heads, pdf, png } from "./fixture/attachment-files.mjs";

const here = import.meta.dir, root = join(here, "..");
const TMP = mkdtempSync(join(tmpdir(), "crew-chat-att-"));
let pass = 0, fail = 0;
const ok = (c: unknown, name: string, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`.trimEnd()); } };
const until = async (f: () => boolean | Promise<boolean>, ms = 10000) => { const t = Date.now(); while (!(await f()) && Date.now() - t < ms) await Bun.sleep(40); return await f(); };
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const PNG = png(48, 48, [220, 30, 30]), PDF = pdf("Attachment fixture"), TXT = Buffer.from("<html><script>alert(1)</script></html>");

// src/attachments.ts is new: before it exists every check below still runs (and fails) instead of the file crashing
let A: any = null;
try { A = await import("../src/attachments"); } catch (e: any) { console.log(`  (src/attachments.ts missing: ${String(e?.message ?? e).slice(0, 120)})`); }

// ---------- 1. the store ----------
try {
  const data = join(TMP, "unit"); mkdirSync(data);
  const s = A ? new A.AttachmentStore(data) : null;
  const sniff = (b: Buffer) => A?.sniff(b) ?? null;
  ok(sniff(PNG) === "image/png" && sniff(heads.jpeg) === "image/jpeg" && sniff(heads.gif) === "image/gif" && sniff(heads.webp) === "image/webp" && sniff(PDF) === "application/pdf", "magic bytes name PNG, JPEG, GIF, WebP and PDF");
  ok(sniff(TXT) === null && sniff(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")) === null && sniff(Buffer.from("RIFF\0\0\0\0WAVEfmt ")) === null && sniff(Buffer.alloc(0)) === null, "HTML, SVG, WAV and empty files are no allowed type");
  const named = s?.put(TXT, "looks-like.png");
  ok(named && !named.ok && named.code === "attachmentType", "a file named .png that is HTML inside is refused as attachmentType", JSON.stringify(named));
  const pdfAsPng = s?.put(PDF, "report.png");
  ok(pdfAsPng?.ok && pdfAsPng.ref.mime === "application/pdf" && pdfAsPng.ref.kind === "pdf", "the type comes from the content: a PDF named .png is a PDF");
  const big = Buffer.concat([PNG, Buffer.alloc(A ? A.ATTACH_MAX_IMAGE_BYTES - PNG.length + 1 : 1)]);
  const r1 = s?.put(big, "big.png");
  ok(A && A.ATTACH_MAX_IMAGE_BYTES === 10 * 1024 * 1024 && A.ATTACH_MAX_PDF_BYTES === 20 * 1024 * 1024 && A.ATTACH_MAX_PER_MESSAGE === 5 && r1 && !r1.ok && r1.code === "attachmentTooLarge", "an image over 10 MB is refused (attachmentTooLarge); the caps are constants");
  const pdfAtCap = A ? Buffer.concat([PDF, Buffer.alloc(A.ATTACH_MAX_PDF_BYTES - PDF.length)]) : PDF;
  ok(s?.put(pdfAtCap, "cap.pdf")?.ok === true && s?.put(Buffer.concat([pdfAtCap, Buffer.alloc(1)]), "over.pdf")?.code === "attachmentTooLarge", "a PDF of exactly 20 MB is stored, one byte more is refused");
  ok(s?.put(Buffer.alloc(0), "empty.png")?.code === "attachmentEmpty", "an empty file is refused");
  const r = s?.put(PNG, "../../etc/passwd‮.png");
  const dir = join(data, "chat-attachments");
  ok(r?.ok && r.ref.id === sha(PNG) && existsSync(join(dir, `${sha(PNG)}.png`)) && readFileSync(join(dir, `${sha(PNG)}.png`)).equals(PNG), "a file is stored under its SHA-256 with the extension of its real type");
  ok(r?.ok && r.ref.name === "passwd.png" && !existsSync(join(TMP, "etc")) && readdirSync(dir).every((f: string) => /^[a-f0-9]{64}\.(png|jpg|gif|webp|pdf|json)$/.test(f)), "the captain's file name is only a label: no directories, no control characters, never part of a path", JSON.stringify(r?.ref?.name));
  ok(existsSync(dir) && (statSync(dir).mode & 0o777) === 0o700 && (statSync(join(dir, `${sha(PNG)}.png`)).mode & 0o777) === 0o600, "the folder is 0700 and each file 0600");
  const again = s?.put(PNG, "again.png");
  ok(again?.ok && again.ref.name === "again.png" && readdirSync(dir).filter((f: string) => f.startsWith(sha(PNG))).length === 2, "the same bytes are stored once (one file, one record); each upload keeps its own label");
  const r5 = s?.resolve([{ id: sha(PNG), name: "first.png" }]), r6 = s?.resolve([{ id: sha(PNG), name: "../second\u0007.png" }]);
  ok(r5?.ok && r5.files[0].name === "first.png" && r6?.ok && r6.files[0].name === "second.png" && s?.get(sha(PNG))?.name !== "again.png", "a message keeps the label it was sent with; a later upload of the same bytes does not rename it");
  ok(s && s.get("../session-token") === null && s.get(sha(PNG).toUpperCase()) === null && s.get(`${sha(PNG)}/../x`) === null && s.get(sha(PNG))?.path === join(dir, `${sha(PNG)}.png`), "only a 64-hex id resolves; traversal and odd ids resolve to nothing");
  // a symlink planted where a stored file goes is replaced, never written through
  const outside = join(TMP, "outside.txt"); writeFileSync(outside, "keep me");
  const gifId = sha(heads.gif); mkdirSync(dir, { recursive: true }); symlinkSync(outside, join(dir, `${gifId}.gif`));
  const g = s?.put(heads.gif, "x.gif");
  ok(g?.ok && readFileSync(outside, "utf8") === "keep me" && !lstatSync(join(dir, `${gifId}.gif`)).isSymbolicLink() && readFileSync(join(dir, `${gifId}.gif`)).equals(heads.gif), "a symlink at a stored name is replaced by the file; its target is untouched");
  const webp = s?.put(heads.webp, "w.webp");
  if (webp?.ok) { const p = join(dir, `${webp.ref.id}.webp`); writeFileSync(p, Buffer.concat([heads.webp, Buffer.from("x")])); }
  ok(webp?.ok && s?.get(webp.ref.id) === null, "a stored file that changed size or type no longer resolves");
  // the folder itself must not be a link
  const data2 = join(TMP, "unit2"); mkdirSync(data2); const elsewhere = join(TMP, "elsewhere"); mkdirSync(elsewhere); symlinkSync(elsewhere, join(data2, "chat-attachments"));
  let threw = false; try { new A.AttachmentStore(data2).put(PNG, "a.png"); } catch { threw = true; }
  ok(!!A && threw && readdirSync(elsewhere).length === 0, "a symlinked attachments folder is refused; nothing is written through it");
  const six = s ? [PNG, heads.jpeg, heads.gif, heads.webp, PDF, png(2, 2, [0, 0, 255])].map((b, i) => s.put(b, `f${i}`).ref?.id) : [];
  ok(s?.resolve(six)?.code === "attachmentCount" && s?.resolve(six.slice(0, 5))?.ok === true && s?.resolve(["f".repeat(64)])?.code === "attachmentMissing", "a message takes at most 5 files, each one stored");
  // what each host can take
  const ref = (kind: string, size: number) => ({ id: "0".repeat(64), mime: kind === "pdf" ? "application/pdf" : "image/png", kind, size, name: `x.${kind}` });
  const d = (h: any, files: any[]) => A?.deliveryFor(h, files);
  const MiB = 1024 * 1024;
  ok(d("claude", [ref("image", 3_932_160)])?.ok === true && d("claude", [ref("image", 3_932_161)])?.code === "claudeImageTooLarge", "Claude: the image cap is the CLI's 3,932,160 raw bytes (5,242,880 base64); one byte more is claudeImageTooLarge");
  ok([3.75 * MiB + 1, 4 * MiB, 4.5 * MiB, 5 * MiB].every((n) => d("claude", [ref("image", Math.round(n))])?.code === "claudeImageTooLarge"), "Claude: images between 3.75 and 5 MiB are refused (the CLI would throw on them)");
  ok(d("claude", [ref("pdf", 10 * MiB), ref("pdf", 8 * MiB)])?.ok === true && d("claude", [ref("pdf", 10 * MiB), ref("pdf", 8 * MiB + 1)])?.code === "claudeMessageTooLarge" && A?.CLAUDE_MAX_MESSAGE_BYTES === 18 * MiB, "Claude: at most 18 MiB of files per message (24 MiB base64, under the 32 MiB request cap)");
  // 6: what the Claude API refuses besides bytes, read from the files themselves
  const pngHead = (w: number, h: number) => { const b = Buffer.from(PNG.subarray(0, 33)); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
  ok(A?.imageSize(pngHead(9000, 40), "image/png")?.width === 9000 && A?.imageSize(heads.gif, "image/gif")?.width === 1 && A?.imageSize(PNG, "image/png")?.height === 48 && A?.pdfPages(PDF) === 1, "image size and PDF pages are read from the bytes");
  const wide = s?.put(pngHead(8001, 10), "wide.png");
  ok(wide?.ok && wide.ref.width === 8001 && d("claude", [wide.ref])?.code === "claudeImageDimensions" && d("claude", [{ ...wide.ref, width: 8000 }])?.ok === true && d("codex", [wide.ref])?.ok === true, "Claude: an image over 8000 px on a side is claudeImageDimensions (Codex resizes and takes it)");
  // page counts come from the catalog's root /Pages only: outline (bookmark) counts and incremental revisions never inflate them
  const multi = (pages: number, o: { bookmarks?: number; revise?: boolean } = {}) => {
    const objs: string[] = [], kids = Array.from({ length: pages }, (_, i) => `${4 + i} 0 R`).join(" ");
    objs[1] = `<< /Type /Catalog /Pages 2 0 R${o.bookmarks ? " /Outlines 3 0 R" : ""} >>`;
    objs[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`;
    objs[3] = `<< /Type /Outlines /Count ${o.bookmarks ?? 0} >>`;
    for (let i = 0; i < pages; i++) objs[4 + i] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>";
    let out = "%PDF-1.6\n"; for (let i = 1; i < objs.length; i++) out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
    out += "trailer\n<< /Root 1 0 R >>\n%%EOF\n";
    if (o.revise) { for (let i = 2; i < objs.length; i++) if (i !== 3) out += `${i} 0 obj\n${objs[i].replace("612 792", "595 842")}\nendobj\n`; out += "trailer\n<< /Root 1 0 R /Prev 9 >>\n%%EOF\n"; }
    return Buffer.from(out, "latin1");
  };
  ok(A?.pdfPages(multi(10, { bookmarks: 150 })) === 10, "10 pages with 150 bookmarks count 10 (the outline /Count is not a page count)", String(A?.pdfPages(multi(10, { bookmarks: 150 }))));
  ok(A?.pdfPages(multi(60, { revise: true })) === 60, "60 pages after an incremental update count 60 (rewritten pages are not counted twice)", String(A?.pdfPages(multi(60, { revise: true }))));
  ok(A?.pdfPages(Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /ObjStm /N 3 >>\nstream\nxx\nendstream\nendobj\n")) === null && A?.pdfPages(Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Count 12 0 R >>\nendobj\n")) === null, "a page tree Studio cannot read is unknown (null), never guessed");
  ok(d("claude", [{ ...ref("pdf", 1000), pages: null }])?.ok === true && /Page count unknown — Claude refuses PDFs over 100 pages/.test(d("claude", [{ ...ref("pdf", 1000), pages: null }])?.deliveries?.[0]?.note?.en ?? ""), "an unknown page count is not refused; the captain is told Claude refuses over 100 pages");
  const longPdf = multi(120);
  const lp = s?.put(longPdf, "long.pdf");
  ok(lp?.ok && lp.ref.pages === 120 && d("claude", [lp.ref])?.code === "claudePdfPages" && d("claude", [{ ...lp.ref, pages: 100 }])?.ok === true, "Claude: a PDF over 100 pages is claudePdfPages");
  const cx = d("codex", [ref("image", 9e6), ref("pdf", 1000)]);
  ok(cx?.ok && cx.deliveries[0].mode === "native" && cx.deliveries[1].mode === "file" && /cannot read PDFs directly/.test(cx.deliveries[1].note.en), "Codex: images natively; a PDF as a file path, said so");
  ok(d(null, [ref("image", 10)])?.code === "attachmentNoHost", "no Firstmate running: a typed refusal");
} catch (e: any) { ok(false, "the store section ran", String(e?.message ?? e).slice(0, 300)); }

// ---------- 2. the turn payload each host takes (stub CLIs) ----------
try {
  const H = join(TMP, "hosts"); mkdirSync(H);
  const prevHome = process.env.HOME; process.env.HOME = H;
  const { claudeHost, encodeCwd } = await import("../src/host/claude");
  const { codexHost } = await import("../src/host/codex");
  const PROJ = join(H, "proj"); mkdirSync(PROJ);
  const PROJECTS = join(H, ".claude/projects"), PDIR = join(PROJECTS, encodeCwd(PROJ)); mkdirSync(PDIR, { recursive: true });
  writeFileSync(join(PDIR, "sess-att.jsonl"), JSON.stringify({ type: "user", isSidechain: false, cwd: PROJ, sessionId: "sess-att", message: { role: "user", content: "hi" } }) + "\n");
  const store = A ? new A.AttachmentStore(join(H, "data")) : null;
  const files = store ? [store.put(PNG, "red.png").ref, store.put(PDF, "brief.pdf").ref].map((x: any) => store.get(x.id)) : [];
  const inputFile = join(H, "claude-input.jsonl"); process.env.STUB_INPUT_FILE = inputFile;
  const claude = claudeHost(join(here, "stub-host-claude.mjs"), PROJECTS);
  const ev: any[] = [];
  const cs = await claude.attach("sess-att", { cwd: PROJ, onEvent: (e) => ev.push(e), onPermission: async () => ({ allow: false }) });
  const r = await (cs.send as any)("What is in these?", files);
  const got = existsSync(inputFile) ? readFileSync(inputFile, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
  const last = got.at(-1);
  ok(r.status === "completed" && last?.text === "What is in these?", "Claude: the captain's text is the message's text block");
  ok(last?.files?.[0]?.type === "image" && last.files[0].source === "base64" && last.files[0].media_type === "image/png" && last.files[0].bytes === PNG.length, "Claude: the image is an image block, base64, image/png, every byte", JSON.stringify(last?.files));
  ok(last?.files?.[1]?.type === "document" && last.files[1].source === "base64" && last.files[1].media_type === "application/pdf" && last.files[1].bytes === PDF.length && last.files[1].title === "brief.pdf", "Claude: the PDF is a document block, base64, application/pdf, titled with its label");
  ok(ev.filter((e) => e.type === "delta").map((e) => e.text).join("").includes("[image image/png") , "Claude: the stub CLI answers about both blocks");
  const bigPng = store ? store.get(store.put(Buffer.concat([PNG, Buffer.alloc(4 * 1024 * 1024)]), "huge.png").ref.id) : null;
  const before = got.length; let refusal: any = null;
  try { await (cs.send as any)("too big", [bigPng]); } catch (e: any) { refusal = e?.refusal; }
  await Bun.sleep(300);
  const after = existsSync(inputFile) ? readFileSync(inputFile, "utf8").trim().split("\n").length : 0;
  ok(refusal?.code === "claudeImageTooLarge" && after === before && !cs.busy, "Claude: a 4 MiB image (over the CLI's 3.75 MiB) is refused with a typed reason before anything reaches the CLI", JSON.stringify(refusal));
  await cs.detach();

  const log = join(H, "codex.log"); process.env.STUB_CODEX_LOG = log;
  const codex = codexHost(join(here, "stub-host-codex.mjs"));
  const xs = await codex.attach("th-stub-1", { cwd: PROJ, onEvent: (e) => ev.push(e), onPermission: async () => ({ allow: false }) });
  ev.length = 0;
  const r2 = await (xs.send as any)("What is in these?", files);
  const msgs = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const start = msgs.filter((m) => m.dir === "in" && m.msg.method === "turn/start").at(-1)?.msg.params;
  const input = start?.input ?? [];
  ok(r2.status === "completed" && input[0]?.type === "text" && input[0].text.startsWith("What is in these?"), "Codex: the captain's text is the first input item");
  ok(input[1]?.type === "localImage" && input[1].path === files[0]?.path && Object.keys(input[1]).sort().join() === "path,type", "Codex: the image is a localImage item naming Studio's stored file", JSON.stringify(input[1]));
  ok(input.length === 2 && /Codex cannot take a PDF as input/.test(input[0]?.text ?? "") && input[0].text.includes(files[1]?.path ?? "\0") && /NOT seen its contents/.test(input[0].text), "Codex: the PDF has no input item; the text names its path and says Codex has not seen it");
  ok(!msgs.some((m) => m.dir === "problem"), "Codex: every message matches the installed app-server protocol (0.162.1 fixture)", JSON.stringify(msgs.filter((m) => m.dir === "problem").slice(0, 2)));
  ok(ev.filter((e) => e.type === "delta").map((e) => e.text).join("").includes(`[images: ${PNG.length}B]`), "Codex: the app-server could read the image file it was given");
  ok(!/read-only/.test(input[0]?.text ?? "x"), "Codex: the PDF note does not claim the path is read-only");
  // 8: a files-only message says so even when Studio prefixes a notice (local unrestricted mode)
  const only = A?.codexInput("", [files[0]], "LOCAL-NOTICE");
  ok(only?.[0]?.text.startsWith("LOCAL-NOTICE") && /The captain sent a file without text/.test(only[0].text) && only[1]?.type === "localImage", "Codex: a files-only message carries the files line after a Studio notice");
  // 4: a stored file changed on disk is not handed to Codex
  const blue = store?.get(store.put(png(48, 48, [0, 0, 255]), "blue.png").ref.id);
  if (blue) writeFileSync(blue.path, png(48, 48, [0, 255, 0])); // same type, different bytes
  const starts = () => readFileSync(log, "utf8").split("\n").filter((l) => l.includes('"turn/start"') && l.includes('"dir":"in"')).length;
  const n0 = starts(); let changed: any = null;
  try { await (xs.send as any)("tampered", [blue]); } catch (e: any) { changed = e?.refusal; }
  await Bun.sleep(300);
  ok(changed?.code === "attachmentChanged" && starts() === n0 && !xs.busy, "Codex: a file whose bytes no longer match its hash is refused (attachmentChanged) before turn/start", JSON.stringify(changed));
  await xs.detach();
  process.env.HOME = prevHome; delete process.env.STUB_INPUT_FILE; delete process.env.STUB_CODEX_LOG;
} catch (e: any) { ok(false, "the host section ran", String(e?.message ?? e).slice(0, 300)); }

// ---------- 2b. the queue: a queued message whose files cannot go is a typed refusal, never a send without them ----------
try {
  const { MainSession } = await import("../src/host/main");
  const M = join(TMP, "main"); mkdirSync(join(M, "data"), { recursive: true });
  const store = A ? new A.AttachmentStore(join(M, "data")) : null;
  const sent: { text: string; files: any[] }[] = [];
  const fake = (id: "claude" | "codex") => ({ id, resumeCommand: (x: string) => `${id} ${x}`,
    discover: async () => [{ host: id, id: "s1", title: "t", cwd: M, updated: 0, possiblyOpen: false, openReason: null, file: null }],
    attach: async () => ({ host: id, id: "s1", model: "fake", busy: false, pid: null, send: async (text: string, files: any[] = []) => { sent.push({ text, files }); return { status: "completed" as const }; }, interrupt: async () => {}, detach: async () => `${id} s1` }) });
  let resolveAs: "store" | "gone" = "store";
  const m = new MainSession({ dataDir: join(M, "data"), projectDir: M, stateDir: join(M, "state"), probe: { list: () => [] }, hosts: { claude: fake("claude"), codex: fake("codex") } as any, pollMs: 200,
    permissionMcp: () => ({ command: ["true"], env: {} }), attachmentFiles: (ids) => resolveAs === "gone" ? { ok: false, code: "attachmentMissing", reason: { en: "gone", "zh-TW": "不見了" } } as any : store!.resolve(ids) } as any);
  await m.start();
  const at = await m.attach("claude", "s1"); ok(at.ok, "a fake Claude session is attached", JSON.stringify(at));
  const small = store?.put(PNG, "red.png").ref, big = store?.put(Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)]), "big.png").ref;
  (m as any).enqueue("chat", "with small", "desktop", small ? [small] : undefined);
  await until(() => sent.length === 1);
  ok(sent[0]?.files?.[0]?.path?.endsWith(".png") && sent[0].files[0].id === small?.id, "a queued captain message is sent with its stored file");
  ok(m.view().log.some((x: any) => x.kind === "captain" && x.text === "with small" && x.attachments?.[0]?.id === small?.id && !("path" in x.attachments[0])), "the history line carries the file's id and label, not its path");
  (m as any).enqueue("chat", "with big", "desktop", big ? [big] : undefined);
  await until(() => m.view().log.some((x: any) => x.attachmentRefusal));
  ok(sent.length === 1 && m.view().log.some((x: any) => x.attachmentRefusal === "claudeImageTooLarge"), "a file the host cannot take stops that turn with claudeImageTooLarge; nothing is sent without it");
  resolveAs = "gone"; (m as any).enqueue("chat", "file vanished", "desktop", small ? [small] : undefined);
  await until(() => m.view().log.some((x: any) => x.attachmentRefusal === "attachmentMissing"));
  ok(sent.length === 1 && m.view().log.some((x: any) => x.attachmentRefusal === "attachmentMissing"), "a file that vanished before its turn is a typed refusal (attachmentMissing)");
  resolveAs = "store"; (m as any).enqueue("chat", "plain text", "desktop");
  await until(() => sent.length === 2);
  ok(sent[1]?.text === "plain text" && sent[1].files.length === 0, "the queue goes on: a plain message after a refusal is sent as before");
  m.stop();

  // 2: a files-only captain message is captain input for captain-only native tools
  const N = join(TMP, "native"); mkdirSync(join(N, "data"), { recursive: true });
  const owners: any[] = [];
  const nativeFake = { id: "codex", resumeCommand: (x: string) => `codex ${x}`, discover: async () => [],
    attach: async (_: string, opts: any) => ({ host: "codex", id: "n1", model: "fake", busy: false, pid: null, interrupt: async () => {}, detach: async () => "codex n1",
      send: async (text: string, files: any[] = []) => { if (files.length || text === "") await opts.nativeTools?.call("captain_probe", {}, { thread: "n1", turn: "t1", call: "c1", live: () => true }); return { status: "completed" as const }; } }) };
  const n = new MainSession({ dataDir: join(N, "data"), projectDir: join(N, "ws"), stateDir: join(N, "state"), probe: { list: () => [] }, hosts: { claude: nativeFake, codex: nativeFake } as any, pollMs: 200, nativeWorkspace: true,
    nativeTools: () => ({ specs: [{ type: "function", name: "captain_probe", description: "probe", inputSchema: { type: "object" } }], call: async (_name: string, _args: unknown, owner: any) => {
      owners.push({ captain: owner.captain, text: owner.text }); if (!owner.captain || !owner.text.trim()) throw new Error("captain_confirmation_required"); return { ok: true }; } }),
    permissionMcp: () => ({ command: ["true"], env: {} }), attachmentFiles: (ids: string[]) => store!.resolve(ids) } as any);
  await n.start();
  const fs = await n.startFresh("codex");
  ok(fs.ok, "a fresh native Firstmate on a fake Codex host", JSON.stringify(fs));
  await until(() => !n.view().busy && !n.view().queue.length);
  (n as any).enqueue("chat", "", "desktop", small ? [small] : undefined);
  await until(() => owners.length >= 1);
  ok(owners.at(-1)?.captain === true && /The captain sent a file without text/.test(owners.at(-1)?.text ?? ""), "a files-only captain message passes captain-only tools: captain, with the files line as its words", JSON.stringify(owners.at(-1)));
  n.stop();

  // 7: retention: unsent uploads and stray temporary files go after their age; sent files stay
  const R = join(TMP, "retention"); const rs = A ? new A.AttachmentStore(R) : null;
  const keep = rs?.put(png(4, 4, [9, 9, 9]), "sent.png").ref, drop = rs?.put(png(5, 5, [8, 8, 8]), "unsent.png").ref, young = rs?.put(png(6, 6, [7, 7, 7]), "young.png").ref;
  rs?.markSent([keep!.id]);
  const rdir = join(R, "chat-attachments"); writeFileSync(join(rdir, ".tmp-deadbeef"), "x");
  const old = (Date.now() - 2 * 24 * 3600_000) / 1000;
  for (const f of readdirSync(rdir)) if (!f.startsWith(young?.id ?? "-")) utimesSync(join(rdir, f), old, old);
  const gone = rs?.sweep() ?? 0;
  ok(gone === 3 && rs?.get(keep!.id) && !rs?.get(drop!.id) && rs?.get(young!.id) && !existsSync(join(rdir, ".tmp-deadbeef")), "retention: an unsent upload older than a day and a stray .tmp go; sent and recent files stay", `${gone} ${readdirSync(rdir).join(",")}`);
  // tied to the history: a sent file stays while the kept history references it, and goes once it rotated out
  ok(rs?.sweep({ referenced: new Set([keep!.id]) }) === 0 && rs?.get(keep!.id), "retention: a sent file the history references stays, however old");
  ok(rs?.sweep({ referenced: new Set() }) === 3 && !rs?.get(keep!.id) && rs?.get(young!.id), "retention: a sent file the history no longer references goes (file, record and sent mark); a recent unsent upload stays");
} catch (e: any) { ok(false, "the queue section ran", String(e?.message ?? e).slice(0, 300)); }

// ---------- 3. the server ----------
{
  const S = join(TMP, "server"), home = join(S, "home"), proj = join(S, "proj"), state = join(S, "state"), data = join(S, "data");
  for (const d of [home, proj, state, data, join(home, ".codex")]) mkdirSync(d, { recursive: true });
  const projects = join(home, ".claude/projects"), pdir = join(projects, proj.replace(/[^a-zA-Z0-9]/g, "-")); mkdirSync(pdir, { recursive: true });
  const cfile = join(pdir, "sess-srv.jsonl"); writeFileSync(cfile, JSON.stringify({ type: "user", isSidechain: false, cwd: proj, sessionId: "sess-srv", message: { role: "user", content: "firstmate" } }) + "\n");
  const old = (Date.now() - 3_600_000) / 1000; utimesSync(cfile, old, old);
  const TOKEN = "chat-att-session", TAILNET = "studio.tail-att.ts.net", port = await freePort(), base = `http://127.0.0.1:${port}`;
  const codexLog = join(S, "codex.log"), claudeInput = join(S, "claude-input.jsonl");
  const env: any = { ...process.env }; for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "CREW_GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR"]) delete env[k];
  const app = spawn("bun", ["src/server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...env, HOME: home, CODEX_HOME: join(home, ".codex"), CREW_SESSION_TOKEN: TOKEN, CREW_PORT: String(port), CREW_DATA: data,
    CREW_FM_STATE: state, CREW_MAIN_PROJECT: proj, CREW_GH: "0", CREW_GH_NO_CLI: "1", CREW_CHAT_PROVIDER: "stub", CREW_INSTALL_RUNNER: "mock", CREW_NO_REAL_INSTALL: "1", CREW_SANDBOX: "0",
    CREW_TAILNET_NAME: TAILNET, CREW_WAKE_GRACE_MS: "600000", CREW_HOST_CODEX_BIN: join(here, "stub-host-codex.mjs"), CREW_HOST_CLAUDE_BIN: join(here, "stub-host-claude.mjs"), CREW_HOST_CLAUDE_PROJECTS: projects,
    STUB_CODEX_LOG: codexLog, STUB_INPUT_FILE: claudeInput, STUB_CODEX_THREADS: JSON.stringify([{ id: "th-srv", cwd: proj, preview: "firstmate", updatedAt: Math.floor(Date.now() / 1000) - 3600 }]) } });
  const raw = (method: string, path: string, o: { host?: string; token?: string; body?: unknown; bodyText?: string; headers?: Record<string, string>; session?: boolean } = {}) => new Promise<{ status: number; body: any; buf: Buffer; headers: any }>((resolve) => {
    const data = o.bodyText ?? (o.body === undefined ? (method === "GET" ? undefined : "{}") : JSON.stringify(o.body));
    const headers: Record<string, any> = { host: o.host ?? `127.0.0.1:${port}`, ...(o.token ? { authorization: `Bearer ${o.token}` } : o.session === false ? {} : { "x-crew-session": TOKEN }),
      ...(data !== undefined ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}), ...(o.headers ?? {}) };
    const r = httpRequest({ host: "127.0.0.1", port, method, path, headers, agent: false }, (res) => {
      const parts: Buffer[] = []; res.on("data", (c) => parts.push(c)); res.on("end", () => { const buf = Buffer.concat(parts); let j = null; try { j = JSON.parse(buf.toString("utf8")); } catch {} resolve({ status: res.statusCode ?? 0, body: j, buf, headers: res.headers }); });
    });
    r.on("error", (e) => resolve({ status: 0, body: { error: String(e) }, buf: Buffer.alloc(0), headers: {} })); if (data !== undefined) r.write(data); r.end();
  });
  const up = (bytes: Buffer, name: string, o: any = {}) => raw("POST", "/api/main/attachments", { ...o, body: { name, data: bytes.toString("base64") } });
  try {
    await waitUp(base, app);
    // the write guard and the session, as every write
    ok((await up(PNG, "a.png", { session: false })).body?.code === "session", "an upload without Studio's session is refused (session)");
    ok((await up(PNG, "a.png", { headers: { origin: "https://evil.example" } })).body?.code === "crossSite", "a cross-site upload is refused (crossSite)");
    ok((await raw("POST", "/api/main/attachments", { bodyText: PNG.toString("base64"), headers: { "content-type": "text/plain" } })).body?.code === "json", "an upload that is not JSON is refused (json)");
    const u = await up(PNG, "red square.png");
    ok(u.status === 200 && u.body?.ok && u.body.attachment.id === sha(PNG) && u.body.attachment.mime === "image/png" && u.body.attachment.name === "red square.png" && !("path" in u.body.attachment), "a PNG upload is stored under its hash and answered without a local path", JSON.stringify(u.body));
    ok(existsSync(join(data, "chat-attachments", `${sha(PNG)}.png`)), "the file lands in Studio's data folder (chat-attachments)");
    const t = await up(TXT, "photo.png");
    ok(t.status === 415 && t.body?.code === "attachmentType", "HTML named .png is refused by its content (415 attachmentType)");
    const tooBig = await up(Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]), "big.png");
    ok(tooBig.status === 413 && tooBig.body?.code === "attachmentTooLarge", "an image over 10 MB is refused (413 attachmentTooLarge)");
    const huge = await raw("POST", "/api/main/attachments", { bodyText: `{"name":"x.pdf","data":"${"A".repeat(28 * 1024 * 1024)}"}` });
    ok(huge.status === 413 && huge.body?.code === "attachmentTooLarge", "a body over the cap is refused before it is parsed");
    ok((await raw("POST", "/api/main/attachments", { body: { name: "x.png", data: "@@@" } })).status === 400 && (await raw("POST", "/api/main/attachments", { body: { name: "x.png" } })).status === 400, "data that is missing or not base64 is refused");
    const p = await up(PDF, "brief.pdf");
    ok(p.status === 200 && p.body?.attachment?.kind === "pdf", "a PDF upload is stored");
    // serving: only to this Mac's session (or a paired phone), as the stored type, never sniffed
    const g = await raw("GET", `/api/main/attachments/${sha(PNG)}`);
    ok(g.status === 200 && g.buf.equals(PNG) && g.headers["content-type"] === "image/png" && g.headers["x-content-type-options"] === "nosniff" && /sandbox/.test(g.headers["content-security-policy"] ?? ""), "the stored file is served back as its own type, nosniff, sandboxed");
    ok(g.headers["cache-control"] === "private, no-store", "the read-back is never cached (a revoked phone keeps no copy)", String(g.headers["cache-control"]));
    ok((await raw("GET", `/api/main/attachments/${sha(PNG)}`, { session: false })).status === 401, "serving needs Studio's session");
    const trav = await raw("GET", "/api/main/attachments/..%2F..%2Fsession-token");
    const trav2 = await raw("GET", `/api/main/attachments/${sha(PNG)}.png`);
    ok(trav.status !== 200 && !trav.buf.includes(TOKEN) && trav2.status !== 200, "a traversal or file-name path serves nothing");
    // send: every id must exist, at most 5, a running Firstmate
    ok((await raw("POST", "/api/main/send", { body: { text: "hi", attachments: [sha(PNG)] } })).body?.code === "detached", "with no Firstmate running nothing is queued");
    ok((await raw("POST", "/api/main/send", { body: { text: "hi", attachments: ["f".repeat(64)] } })).body?.code === "attachmentMissing", "an unknown attachment id is refused (attachmentMissing)");
    const ids6 = [];
    for (const b of [PNG, PDF, heads.gif, heads.jpeg, heads.webp, png(3, 3, [1, 2, 3])]) ids6.push((await up(b, "f")).body.attachment.id);
    ok((await raw("POST", "/api/main/send", { body: { text: "hi", attachments: ids6 } })).body?.code === "attachmentCount", "six files in one message are refused (attachmentCount)");
    // a phone follows the chat's own rule: it may send only when the Mac allows phones to drive
    const code = (await raw("POST", "/api/remote/pair/start")).body.code;
    const ptok = (await raw("POST", "/api/remote/pair", { host: TAILNET, body: { code, name: "Pixel" } })).body?.token;
    ok((await up(PNG, "p.png", { host: TAILNET, token: ptok })).body?.code === "noDrive", "a phone cannot upload until phone driving is allowed (noDrive)");
    ok((await up(PNG, "p.png", { host: TAILNET })).body?.code === "pair", "an unpaired phone cannot upload");
    await raw("POST", "/api/remote/settings", { body: { allowDrive: true } });
    ok((await up(PNG, "p.png", { host: TAILNET, token: ptok })).status === 200 && (await raw("GET", `/api/main/attachments/${sha(PNG)}`, { host: TAILNET, token: ptok })).status === 200, "with phone driving allowed, a paired phone uploads and sees the file, as it sends");
    await raw("POST", "/api/remote/settings", { body: { allowDrive: false } });

    // Codex: attach, send an image and a PDF, the history keeps them
    ok((await raw("POST", "/api/main/attach", { body: { host: "codex", id: "th-srv" } })).body?.ok === true, "Codex session attached");
    const s1 = await raw("POST", "/api/main/send", { body: { text: "What is in these?", attachments: [sha(PNG), sha(PDF)] } });
    ok(s1.status === 200 && s1.body?.queued?.attachments?.length === 2 && s1.body.deliveries?.[1]?.mode === "file", "the send is queued with both files; the PDF is marked as a file path for Codex", JSON.stringify(s1.body));
    ok(await until(async () => (await raw("GET", "/api/main")).body?.log?.some((x: any) => x.kind === "firstmate" && x.text.includes(`[images: ${PNG.length}B]`))), "Codex's reply shows it got the image");
    const v = (await raw("GET", "/api/main")).body;
    const cap = v.log.find((x: any) => x.kind === "captain" && x.text === "What is in these?");
    ok(cap?.attachments?.map((a: any) => a.id).join() === [sha(PNG), sha(PDF)].join() && cap.attachments.every((a: any) => !("path" in a) && a.name && a.size), "the history keeps the captain's message with its files (ids and labels, no local paths)");
    const startIn = readFileSync(codexLog, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((m) => m.dir === "in" && m.msg.method === "turn/start").at(-1)?.msg.params.input;
    ok(startIn?.[1]?.type === "localImage" && startIn[1].path === join(data, "chat-attachments", `${sha(PNG)}.png`) && startIn[0].text.includes(join(data, "chat-attachments", `${sha(PDF)}.pdf`)), "through the server, Codex gets a localImage and the PDF's stored path");
    const only = await raw("POST", "/api/main/send", { body: { text: "", attachments: [sha(PNG)] } });
    ok(only.status === 200 && await until(async () => (await raw("GET", "/api/main")).body?.log?.some((x: any) => x.kind === "captain" && x.text === "" && x.attachments?.length === 1)), "files alone, without text, can be sent");
    await until(async () => !(await raw("GET", "/api/main")).body?.busy);
    await raw("POST", "/api/main/detach");

    // Claude: the same files as image and document blocks; a too-large image is a typed refusal, not a drop
    ok((await raw("POST", "/api/main/attach", { body: { host: "claude", id: "sess-srv" } })).body?.ok === true, "Claude session attached");
    const s2 = await raw("POST", "/api/main/send", { body: { text: "Read these", attachments: [{ id: sha(PNG), name: "label-one.png" }, sha(PDF)] } });
    ok(s2.status === 200 && await until(() => existsSync(claudeInput) && readFileSync(claudeInput, "utf8").includes("Read these")), "the Claude send is queued and reaches the CLI");
    const cin = readFileSync(claudeInput, "utf8").trim().split("\n").map((l) => JSON.parse(l)).find((x) => x.text === "Read these");
    ok(cin?.files?.map((f: any) => `${f.type}:${f.media_type}:${f.bytes}`).join() === `image:image/png:${PNG.length},document:application/pdf:${PDF.length}`, "through the server, Claude gets an image block and a document block", JSON.stringify(cin?.files));
    await until(async () => !(await raw("GET", "/api/main")).body?.busy);
    await up(PNG, "renamed-later.png");
    const lab = (await raw("GET", "/api/main")).body.log.find((x: any) => x.kind === "captain" && x.text === "Read these");
    ok(lab?.attachments?.[0]?.name === "label-one.png", "the history keeps the label the message was sent with, after a later upload of the same bytes", JSON.stringify(lab?.attachments?.[0]));
    const bigId = (await up(Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)]), "big.png")).body;
    ok(bigId?.ok && bigId.hostRefusal?.code === "claudeImageTooLarge", "an upload Claude cannot take is stored but flagged for the running host (claudeImageTooLarge)");
    const linesBefore = readFileSync(claudeInput, "utf8").trim().split("\n").length;
    const s3 = await raw("POST", "/api/main/send", { body: { text: "big one", attachments: [bigId?.attachment?.id] } });
    await Bun.sleep(400);
    ok(s3.status === 409 && s3.body?.code === "claudeImageTooLarge" && s3.body.reason?.["zh-TW"] && readFileSync(claudeInput, "utf8").trim().split("\n").length === linesBefore && !(await raw("GET", "/api/main")).body.log.some((x: any) => x.text === "big one"), "Claude cannot take it: the send is refused with a typed reason and nothing is queued or sent");
    // a reload reads the same history
    const again = (await raw("GET", "/api/main")).body;
    ok(again.log.filter((x: any) => x.kind === "captain" && x.attachments?.length).length >= 3, "re-reading /api/main (a page reload) shows every sent message's files");
    await raw("POST", "/api/main/detach");
  } catch (e: any) { ok(false, "server section ran", String(e?.stack ?? e).slice(0, 600)); }
  finally { app.kill("SIGTERM"); await Bun.sleep(200); app.kill("SIGKILL"); }
}

console.log(`chat-attachments: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
