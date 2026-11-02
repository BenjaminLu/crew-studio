// A stand-in for src/lan/se-helper.swift with the same line protocol, for tests and CI (macOS runners are VMs without a
// Secure Enclave). Its "blobs" are software keys, so it protects nothing: src/lan/keystore.ts refuses it unless the test
// environment is isolated (CREW_TEST_ENV_ISOLATED) and the data folder is under the temporary directory. Every admin
// signature with a presence key is a "prompt": its text is appended to CREW_SOFT_ENCLAVE_PROMPTS (one line each), and
// while the file CREW_SOFT_ENCLAVE_DENY names exists it is answered as a person who cancelled Touch ID.
import { appendFileSync, existsSync } from "node:fs";
import { createECDH, createHash, createPrivateKey, sign as edSign } from "node:crypto";

const DOMAIN = "crew-studio/lan/v2", DAILY = new Set(["entry", "cert-request"]), ADMIN = new Set(["cert", "introduce", "revoke", "successor", "replace"]);
const b64u = (b: Uint8Array) => Buffer.from(b).toString("base64url");
const fp = (pub: Buffer) => { const h = createHash("sha256").update(`${DOMAIN}\0fingerprint\0`).update(pub).digest(); return [0, 1, 2, 3, 4, 5].map((i) => String(h.readUIntBE(i * 5, 5) % 100000).padStart(5, "0")).join(" "); };
const keyOf = (blob: string) => { const j = JSON.parse(Buffer.from(String(blob).replace(/^soft1\./, ""), "base64").toString("utf8")); const e = createECDH("prime256v1"); e.setPrivateKey(Buffer.from(j.d, "base64url")); return { ...j, e, pub: e.getPublicKey() }; };
const sig = (k: any, purpose: string, msg: Buffer) => edSign("sha256", Buffer.concat([Buffer.from(`${DOMAIN}\0${purpose}\0`), msg]),
  { key: createPrivateKey({ key: { kty: "EC", crv: "P-256", x: b64u(k.pub.subarray(1, 33)), y: b64u(k.pub.subarray(33)), d: b64u(k.e.getPrivateKey()) }, format: "jwk" }), dsaEncoding: "ieee-p1363" });
function adminMessage(purpose: string, fields: unknown): { msg: Buffer; prompt: string } {
  if (!ADMIN.has(purpose)) throw new Error("not an admin purpose");
  if (!Array.isArray(fields) || !fields.length || fields.length > 8 || fields.some((f) => typeof f !== "string" || f.length < 1 || f.length > 200 || /[^\x21-\x7e]/.test(f))) throw new Error("bad field");
  const key = (i: number) => { const d = Buffer.from(String(fields[i] ?? ""), "base64url"); if (d.length !== 65) throw new Error(`field ${i} is not a key`); return fp(d); };
  const num = (i: number) => { if (!/^\d+$/.test(String(fields[i]))) throw new Error(`field ${i} is not a number`); return String(BigInt(String(fields[i]))); };
  const n = (want: number) => { if (fields.length !== want) throw new Error(`${purpose}: ${want} fields`); };
  let prompt = "";
  if (purpose === "cert") { n(4); prompt = `認證這台 Mac 的日常金鑰（簽章 ${key(0)} · 協商 ${key(1)}，自第 ${num(2)} 筆起）`; }
  if (purpose === "introduce") { n(3); prompt = `核准引介同事：對方指紋 ${key(0)}`; }
  if (purpose === "revoke") { n(4); prompt = fields[2] === "-" ? `作廢這台的身分 ${key(0)}（最後一筆 ${num(1)}）` : `作廢這台的身分 ${key(0)}（最後一筆 ${num(1)}），新身分 ${key(2)}`; }
  if (purpose === "successor") { n(3); prompt = `確認新身分 ${key(1)} 接替 ${key(0)}`; }
  if (purpose === "replace") { n(3); prompt = `以新身分 ${key(1)} 取代同事 ${key(0)}（當面確認過短碼）`; }
  return { msg: Buffer.from((fields as string[]).join("\0")), prompt };
}
function handle(q: any): any {
  for (const k of Object.keys(q)) if (!["id", "op", "kind", "presence", "blob", "purpose", "msg", "peer", "fields"].includes(k)) throw new Error(`unknown field ${k}`);
  switch (q.op) {
    case "available": return { ok: true, se: true };
    case "message": { const m = adminMessage(String(q.purpose ?? ""), q.fields); return { ok: true, msg: b64u(m.msg), prompt: m.prompt }; }
    case "create": { if (q.kind !== "sign" && q.kind !== "dh") throw new Error("kind is sign or dh"); if (q.kind === "dh" && q.presence) throw new Error("a key agreement key is never made with presence");
      const e = createECDH("prime256v1"); e.generateKeys();
      return { ok: true, blob: "soft1." + Buffer.from(JSON.stringify({ kind: q.kind, presence: !!q.presence, d: b64u(e.getPrivateKey()) })).toString("base64"), pub: b64u(e.getPublicKey()) }; }
    case "pub": return { ok: true, pub: b64u(keyOf(q.blob).pub) };
    case "sign": { if (!DAILY.has(q.purpose)) throw new Error("not a daily purpose"); const k = keyOf(q.blob); if (k.kind !== "sign" || k.presence) throw new Error("not a daily signing key");
      return { ok: true, sig: b64u(sig(k, q.purpose, Buffer.from(String(q.msg), "base64"))) }; }
    case "dh": { const k = keyOf(q.blob); if (k.kind !== "dh") throw new Error("not a key agreement key"); return { ok: true, secret: b64u(k.e.computeSecret(Buffer.from(String(q.peer), "base64url"))) }; }
    case "admin": { const { msg, prompt } = adminMessage(String(q.purpose ?? ""), q.fields), k = keyOf(q.blob); if (k.kind !== "sign") throw new Error("not a signing key");
      if (k.presence) { if (process.env.CREW_SOFT_ENCLAVE_PROMPTS) appendFileSync(process.env.CREW_SOFT_ENCLAVE_PROMPTS, `Crew Studio：${prompt}\n`); if (process.env.CREW_SOFT_ENCLAVE_DENY && existsSync(process.env.CREW_SOFT_ENCLAVE_DENY)) throw new Error("refused by the Secure Enclave: the person cancelled"); }
      return { ok: true, sig: b64u(sig(k, String(q.purpose), msg)) }; }
    default: throw new Error("unknown op");
  }
}
let buf = "";
process.stdin.on("data", (d) => {
  buf += d.toString("utf8"); let i: number;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1); let q: any = {};
    try { q = JSON.parse(line); process.stdout.write(JSON.stringify({ ...handle(q), id: q.id }) + "\n"); }
    catch (e: any) { process.stdout.write(JSON.stringify({ id: q?.id ?? -1, ok: false, error: String(e?.message ?? e) }) + "\n"); }
  }
});
