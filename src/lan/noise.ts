// The peer channel (docs/units/lan-relay.md): the Noise protocol framework (revision 34) with P-256 as its DH function,
// AES-256-GCM and SHA-256. Two patterns:
//   KK  every ordinary exchange. Both static keys are known before it starts (the introduced allowlist), so the first
//       message already proves the initiator holds an allowlisted key (es, ss), and a responder that cannot decrypt it
//       answers nothing: an unintroduced key learns nothing, not even this Studio's public key.
//   XX  only an introduction, and only while the captain has opened the introduction window on the desktop: both keys
//       are learned and authenticated in the handshake, and the short code is derived from its handshake hash.
// P-256 is not one of Noise's named DH functions; the construction is the framework's, with DHLEN = 32 (the x
// coordinate) and 65-byte uncompressed public keys in the messages. The protocol name says so.
import { aeadOpen, aeadSeal, dh, generateKeyPair, hmac, sha256, type KeyPair, checkPub } from "./crypto";

const DHLEN = 32, PUBLEN = 65, TAG = 16;
const EMPTY = Buffer.alloc(0);
const nonce = (n: bigint) => { const b = Buffer.alloc(12); b.writeBigUInt64BE(n, 4); return b; };
function hkdf2(ck: Buffer, ikm: Buffer): [Buffer, Buffer] { const t = hmac(ck, ikm), o1 = hmac(t, Buffer.from([1])), o2 = hmac(t, Buffer.concat([o1, Buffer.from([2])])); return [o1, o2]; }

export class CipherState {
  k: Buffer | null = null; n = 0n;
  constructor(k?: Buffer) { if (k) this.k = k; }
  encrypt(ad: Buffer, plain: Buffer): Buffer {
    if (!this.k) return plain;
    if (this.n >= 2n ** 64n - 1n) throw new Error("nonce exhausted");
    return aeadSeal(this.k, nonce(this.n++), plain, ad);
  }
  /** throws when the tag does not verify; the nonce advances only on success */
  decrypt(ad: Buffer, ct: Buffer): Buffer {
    if (!this.k) return ct;
    const p = aeadOpen(this.k, nonce(this.n), ct, ad); if (!p) throw new Error("decrypt failed"); this.n++; return p;
  }
}

class SymmetricState {
  ck: Buffer; h: Buffer; cs = new CipherState();
  constructor(name: string) { const b = Buffer.from(name); this.h = b.length <= 32 ? Buffer.concat([b, Buffer.alloc(32 - b.length)]) : sha256(b); this.ck = this.h; }
  mixKey(ikm: Buffer) { const [ck, k] = hkdf2(this.ck, ikm); this.ck = ck; this.cs = new CipherState(k); }
  mixHash(data: Buffer) { this.h = sha256(this.h, data); }
  encryptAndHash(p: Buffer) { const c = this.cs.encrypt(this.h, p); this.mixHash(c); return c; }
  decryptAndHash(c: Buffer) { const p = this.cs.decrypt(this.h, c); this.mixHash(c); return p; }
  split(): [CipherState, CipherState] { const [a, b] = hkdf2(this.ck, EMPTY); return [new CipherState(a), new CipherState(b)]; }
}

type Token = "e" | "s" | "ee" | "es" | "se" | "ss";
const PATTERNS: Record<"XX" | "KK", { pre: { i: Token[]; r: Token[] }; msgs: Token[][] }> = {
  XX: { pre: { i: [], r: [] }, msgs: [["e"], ["e", "ee", "s", "es"], ["s", "se"]] },
  KK: { pre: { i: ["s"], r: ["s"] }, msgs: [["e", "es", "ss"], ["e", "ee", "se"]] },
};
export const PROLOGUE = Buffer.from("crew-studio/lan/v1 prologue");

export class Handshake {
  readonly ss: SymmetricState; private msg = 0; private readonly tokens: Token[][];
  e: KeyPair | null = null; re: Buffer | null = null; rs: Buffer | null;
  constructor(readonly pattern: "XX" | "KK", readonly initiator: boolean, readonly s: KeyPair, rs: Uint8Array | null = null, private readonly fixedE?: KeyPair) {
    this.ss = new SymmetricState(`Noise_${pattern}_P256_AESGCM_SHA256`); this.ss.mixHash(PROLOGUE);
    this.rs = rs ? checkPub(rs) : null; this.tokens = PATTERNS[pattern].msgs;
    const pre = PATTERNS[pattern].pre;
    if (pattern === "KK" && !this.rs) throw new Error("KK needs the peer's static key");
    // pre-messages in order: the initiator's, then the responder's
    for (const t of pre.i) if (t === "s") this.ss.mixHash(initiator ? s.pub : this.rs!);
    for (const t of pre.r) if (t === "s") this.ss.mixHash(initiator ? this.rs! : s.pub);
  }
  get hash() { return this.ss.h; }
  get done() { return this.msg >= this.tokens.length; }
  private mine() { return (this.msg % 2 === 0) === this.initiator; }
  private dhFor(t: Token): Buffer {
    const I = this.initiator;
    // ee, es (initiator e, responder s), se (initiator s, responder e), ss
    if (t === "ee") return dh(this.e!.priv, this.re!);
    if (t === "ss") return dh(this.s.priv, this.rs!);
    if (t === "es") return I ? dh(this.e!.priv, this.rs!) : dh(this.s.priv, this.re!);
    return I ? dh(this.s.priv, this.re!) : dh(this.e!.priv, this.rs!);
  }
  writeMessage(payload: Buffer): Buffer {
    if (this.done || !this.mine()) throw new Error("not this side's message");
    const out: Buffer[] = [];
    for (const t of this.tokens[this.msg]) {
      if (t === "e") { this.e = this.fixedE ?? generateKeyPair(); out.push(this.e.pub); this.ss.mixHash(this.e.pub); }
      else if (t === "s") out.push(this.ss.encryptAndHash(this.s.pub));
      else this.ss.mixKey(this.dhFor(t));
    }
    out.push(this.ss.encryptAndHash(payload)); this.msg++;
    return Buffer.concat(out);
  }
  /** the payload; throws on any malformed or unauthenticated message */
  readMessage(m: Buffer): Buffer {
    if (this.done || this.mine()) throw new Error("not the peer's message");
    let off = 0; const take = (n: number) => { if (off + n > m.length) throw new Error("short message"); const b = m.subarray(off, off + n); off += n; return Buffer.from(b); };
    for (const t of this.tokens[this.msg]) {
      if (t === "e") { this.re = checkPub(take(PUBLEN)); this.ss.mixHash(this.re); }
      else if (t === "s") { const c = take(this.ss.cs.k ? PUBLEN + TAG : PUBLEN); this.rs = checkPub(this.ss.decryptAndHash(c)); }
      else this.ss.mixKey(this.dhFor(t));
    }
    const p = this.ss.decryptAndHash(m.subarray(off)); this.msg++;
    return p;
  }
  /** [send, receive] cipher states once the handshake is complete */
  split(): { send: CipherState; recv: CipherState } { if (!this.done) throw new Error("handshake not complete"); const [a, b] = this.ss.split(); return this.initiator ? { send: a, recv: b } : { send: b, recv: a }; }
}
export const NOISE = { DHLEN, PUBLEN };
