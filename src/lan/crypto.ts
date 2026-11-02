// Board-to-board collaboration (docs/units/lan-relay.md): the primitives. Everything is P-256 (the curve the Keychain and the
// Secure Enclave hold), SHA-256, HKDF-SHA256 and AES-256-GCM from node:crypto; nothing here is hand-rolled cryptography
// beyond the composition. Every signature and every derived key carries a domain string, so a byte string signed or sealed
// for one purpose never verifies or opens for another (CSO M2).
import { createCipheriv, createDecipheriv, createECDH, createHash, createHmac, createPrivateKey, createPublicKey, hkdfSync, randomBytes, sign as edSign, timingSafeEqual, verify as edVerify } from "node:crypto";

export const DOMAIN = "crew-studio/lan/v1";
export type KeyPair = { pub: Buffer; priv: Buffer };

export const b64u = (b: Uint8Array) => Buffer.from(b).toString("base64url");
export const unb64u = (s: unknown, len?: number): Buffer => {
  if (typeof s !== "string" || !/^[A-Za-z0-9_-]*$/.test(s) || s.length > 200_000) throw new Error("not base64url");
  const b = Buffer.from(s, "base64url"); if (len !== undefined && b.length !== len) throw new Error(`expected ${len} bytes`); return b;
};
export const sha256 = (...parts: (Uint8Array | string)[]) => { const h = createHash("sha256"); for (const p of parts) h.update(p); return h.digest(); };
export const sha256hex = (...parts: (Uint8Array | string)[]) => sha256(...parts).toString("hex");
export const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && timingSafeEqual(a, b);

/** An uncompressed P-256 point (65 bytes, 0x04 || x || y) that lies on the curve; anything else throws. */
export function checkPub(pub: Uint8Array): Buffer {
  const b = Buffer.from(pub);
  if (b.length !== 65 || b[0] !== 4) throw new Error("not an uncompressed P-256 public key");
  createPublicKey({ key: jwkPub(b), format: "jwk" }); // throws for a point off the curve
  return b;
}
const jwkPub = (pub: Buffer) => ({ kty: "EC", crv: "P-256", x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) });
export function generateKeyPair(): KeyPair { const e = createECDH("prime256v1"); e.generateKeys(); return { pub: e.getPublicKey(), priv: e.getPrivateKey() }; }
/** The key pair of a stored private scalar (its public half is derived, never trusted from storage). */
export function keyPairOf(priv: Uint8Array): KeyPair { const e = createECDH("prime256v1"); e.setPrivateKey(Buffer.from(priv)); return { pub: e.getPublicKey(), priv: Buffer.from(priv) }; }
/** ECDH on P-256: the x coordinate (32 bytes). A peer key off the curve throws. */
export function dh(priv: Uint8Array, pub: Uint8Array): Buffer { const e = createECDH("prime256v1"); e.setPrivateKey(Buffer.from(priv)); return e.computeSecret(checkPub(pub)); }

/** ECDSA P-256 / SHA-256 over DOMAIN || 0 || purpose || 0 || message; 64-byte r||s. */
export function sign(k: KeyPair, purpose: string, msg: Uint8Array): Buffer {
  const key = createPrivateKey({ key: { ...jwkPub(k.pub), d: b64u(k.priv) }, format: "jwk" });
  return edSign("sha256", Buffer.concat([Buffer.from(`${DOMAIN}\0${purpose}\0`), msg]), { key, dsaEncoding: "ieee-p1363" });
}
export function verify(pub: Uint8Array, purpose: string, msg: Uint8Array, sig: Uint8Array): boolean {
  try { if (sig.length !== 64) return false;
    return edVerify("sha256", Buffer.concat([Buffer.from(`${DOMAIN}\0${purpose}\0`), msg]), { key: createPublicKey({ key: jwkPub(checkPub(pub)), format: "jwk" }), dsaEncoding: "ieee-p1363" }, sig);
  } catch { return false; }
}

export function aeadSeal(key: Uint8Array, nonce: Uint8Array, plain: Uint8Array, ad: Uint8Array = Buffer.alloc(0)): Buffer {
  const c = createCipheriv("aes-256-gcm", key, nonce); c.setAAD(ad); return Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
}
/** null when the tag does not verify. */
export function aeadOpen(key: Uint8Array, nonce: Uint8Array, sealed: Uint8Array, ad: Uint8Array = Buffer.alloc(0)): Buffer | null {
  if (sealed.length < 16) return null;
  try { const d = createDecipheriv("aes-256-gcm", key, nonce); d.setAAD(ad); d.setAuthTag(Buffer.from(sealed.subarray(sealed.length - 16)));
    return Buffer.concat([d.update(sealed.subarray(0, sealed.length - 16)), d.final()]); } catch { return null; }
}
export const hmac = (key: Uint8Array, data: Uint8Array) => createHmac("sha256", key).update(data).digest();
const derive = (ikm: Uint8Array, salt: Uint8Array, info: string, len = 32) => Buffer.from(hkdfSync("sha256", ikm, salt, `${DOMAIN}\0${info}`, len));

/**
 * A sealed box for named recipients: a fresh content key encrypts the bytes once (AES-256-GCM), and the content key is
 * wrapped for each recipient with a key from ECDH(ephemeral, recipient) (HKDF bound to both points and the purpose).
 * Only a holder of one of the recipients' private keys opens it; the box names recipients by full public key.
 */
export type Box = { alg: "p256-hkdf-aesgcm"; epk: string; iv: string; ct: string; keys: { to: string; iv: string; w: string }[] };
export function seal(plain: Uint8Array, recipients: Uint8Array[], purpose: string): Box {
  if (!recipients.length || recipients.length > 8) throw new Error("a box has 1 to 8 recipients");
  const e = generateKeyPair(), cek = randomBytes(32), iv = randomBytes(12);
  const ad = Buffer.from(`${DOMAIN}\0box\0${purpose}`);
  const keys = [...new Map(recipients.map((r) => [b64u(r), checkPub(r)])).values()].map((r) => {
    const kek = derive(dh(e.priv, r), Buffer.concat([e.pub, r]), `wrap\0${purpose}`), wiv = randomBytes(12);
    return { to: b64u(r), iv: b64u(wiv), w: b64u(aeadSeal(kek, wiv, cek, ad)) };
  });
  return { alg: "p256-hkdf-aesgcm", epk: b64u(e.pub), iv: b64u(iv), ct: b64u(aeadSeal(cek, iv, plain, ad)), keys };
}
/** The plaintext, or null when this key is not a recipient or anything fails to verify. */
export function open(box: any, me: KeyPair, purpose: string): Buffer | null {
  try {
    if (!box || box.alg !== "p256-hkdf-aesgcm" || !Array.isArray(box.keys) || box.keys.length > 8) return null;
    const mine = box.keys.find((k: any) => k?.to === b64u(me.pub)); if (!mine) return null;
    const epk = checkPub(unb64u(box.epk, 65)), ad = Buffer.from(`${DOMAIN}\0box\0${purpose}`);
    const kek = derive(dh(me.priv, epk), Buffer.concat([epk, me.pub]), `wrap\0${purpose}`);
    const cek = aeadOpen(kek, unb64u(mine.iv, 12), unb64u(mine.w), ad); if (!cek) return null;
    return aeadOpen(cek, unb64u(box.iv, 12), unb64u(box.ct), ad);
  } catch { return null; }
}

/**
 * The human-checkable fingerprint of a public key: 30 decimal digits in six groups of five (about 99.7 bits), from
 * SHA-256 of the full key, the way Signal's safety numbers are made. It is for people to compare; every decision in
 * Studio is keyed by the full key, never by this.
 */
export function fingerprint(pub: Uint8Array): string {
  const h = sha256(Buffer.from(`${DOMAIN}\0fingerprint\0`), pub), out: string[] = [];
  for (let i = 0; i < 6; i++) out.push(String(h.readUIntBE(i * 5, 5) % 100000).padStart(5, "0"));
  return out.join(" ");
}
/** The short code both screens show during an introduction: 6 digits from the handshake hash and both committed nonces. */
export function sas(handshakeHash: Uint8Array, initiatorNonce: Uint8Array, responderNonce: Uint8Array): string {
  const h = sha256(Buffer.from(`${DOMAIN}\0sas\0`), handshakeHash, initiatorNonce, responderNonce);
  return String(h.readUInt32BE(0) % 1_000_000).padStart(6, "0");
}

/** Canonical JSON: sorted keys, no whitespace; only plain data (strings, finite numbers, booleans, null, arrays, objects). */
export function canonical(v: unknown): string {
  if (v === null || typeof v === "boolean") return JSON.stringify(v);
  if (typeof v === "number") { if (!Number.isFinite(v)) throw new Error("not a finite number"); return JSON.stringify(v); }
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (typeof v === "object") { const o = v as Record<string, unknown>; return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`; }
  throw new Error(`not canonical data: ${typeof v}`);
}
export { randomBytes, derive };
