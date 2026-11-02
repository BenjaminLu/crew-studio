// This Studio's LAN identity (docs/units/lan-relay.md, Identity): three P-256 keys behind one asynchronous interface.
//   admin   the identity itself: its public key is what peers allowlist and its fingerprint is what people compare. It
//           signs only what a person decides on this Mac: the certificate of the daily keys, an introduction, a
//           revocation, a successor, a replacement. In the Secure Enclave it needs Touch ID or the login password each time.
//   daily signing key       signs every entry of the own log (no prompt)
//   daily key agreement key  the Noise static key and the key every sealed box is opened with (no prompt)
// One certificate, signed by the admin key, binds both daily keys to the identity from a sequence number on; peers check
// it during the introduction (it travels inside the hashed handshake) and on every entry (an entry names its hash).
// Three keystores, one contract (tests/lan-keys.ts):
//   enclave       macOS with a Secure Enclave: keys made inside it by src/lan/se-helper.swift (built here from source,
//                 ad-hoc signed, no entitlements, no Keychain); Studio keeps only the device-bound blobs (lan/enclave.json)
//   file          Linux, a Mac without one, or a helper that does not build: lan/identity.json and lan/admin.key, 0600;
//                 any program of this user can read them ("這台的身分可被本機程式讀取")
//   soft-enclave  tests only: the enclave's code over tests/lan/soft-enclave.ts; refused outside an isolated test
//                 environment with a temporary data folder
// Not a boundary against a process of this user while Studio runs: it can ask the helper to sign and decrypt as the
// daily keys. The enclave makes the keys uncopyable (taken to another machine they are useless) and puts a person in
// front of every admin signature.
import SRC from "./se-helper.swift" with { type: "text" };
import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { b64u, canonical, dh as softDh, fingerprint, generateKeyPair, keyPairOf, sha256, sha256hex, sign as softSign, unb64u, verify, DOMAIN, type KeyPair, type StaticKey } from "./crypto";
import { scrubEnv } from "../secure";

export type KeystoreKind = "enclave" | "file" | "soft-enclave";
export const ADMIN_PURPOSES = ["cert", "introduce", "revoke", "successor", "replace"] as const;
export type AdminPurpose = typeof ADMIN_PURPOSES[number];
/** daily signatures: entries only (an admin purpose is never signed by a daily key) */
export const DAILY_PURPOSES = ["entry"] as const;
/** The certificate that binds the daily keys to the identity, from `seq` (the first own entry they sign) on. */
export type Cert = { v: 2; id: string; sign: string; dh: string; seq: number; at: string; sig: string };
export const certFields = (c: Pick<Cert, "sign" | "dh" | "seq" | "at">) => [c.sign, c.dh, String(c.seq), c.at];
export const certHash = (c: Cert) => sha256hex(canonical(c));
/** an admin message's fields: 1 to 200 printable ASCII characters each, no separator (the helper checks the same) */
export function adminFieldsOk(fields: string[]) { return fields.length >= 1 && fields.length <= 8 && fields.every((f) => typeof f === "string" && f.length >= 1 && f.length <= 200 && !/[^\x21-\x7e]/.test(f)); }
/** what an admin signature covers: its fields joined by 0 (signed as DOMAIN 0 purpose 0 message, src/lan/crypto.ts) */
export const adminMessage = (fields: string[]) => Buffer.from(fields.join("\0"));
export function verifyAdmin(identity: Uint8Array, purpose: AdminPurpose, fields: string[], sig: Uint8Array) { return adminFieldsOk(fields) && verify(identity, purpose, adminMessage(fields), sig); }
export function verifyCert(c: any, identity: Uint8Array): c is Cert {
  try {
    if (!c || c.v !== 2 || c.id !== b64u(identity) || typeof c.sign !== "string" || typeof c.dh !== "string" || !Number.isSafeInteger(c.seq) || c.seq < 1 || typeof c.at !== "string" || typeof c.sig !== "string") return false;
    if (Object.keys(c).some((k) => !["v", "id", "sign", "dh", "seq", "at", "sig"].includes(k))) return false;
    return verifyAdmin(identity, "cert", certFields(c), unb64u(c.sig, 64));
  } catch { return false; }
}

/** the keystore's daily key agreement key as Noise and the boxes use it */
export const staticOf = (ks: Pick<Keystore, "dhPub" | "dh">): StaticKey => ({ pub: ks.dhPub, dh: (p) => ks.dh(p) });
export interface Keystore {
  readonly kind: KeystoreKind;
  /** the admin public key: the identity */
  readonly identity: Buffer;
  /** the identity as peers name it (base64url of the admin key) and as people compare it */
  readonly key: string; readonly fingerprint: string;
  readonly signPub: Buffer; readonly dhPub: Buffer; readonly cert: Cert;
  /** a daily signature (entries) */
  sign(purpose: typeof DAILY_PURPOSES[number], msg: Uint8Array): Promise<Buffer>;
  /** key agreement with the daily key (the x coordinate) */
  dh(peer: Uint8Array): Promise<Buffer>;
  /** an admin signature: a person decides on this Mac (Touch ID or the login password in the enclave) */
  admin(purpose: AdminPurpose, fields: string[]): Promise<Buffer>;
  /** the key this Studio's store is sealed with: from the daily key agreement key, so it never leaves the enclave either */
  storageKey(): Promise<Buffer>;
  close(): void;
}

const real = (p: string) => { try { return realpathSync(p); } catch { return resolve(p); } };
const underTmp = (dataDir: string) => real(dataDir).startsWith(real(tmpdir()) + "/") || /^\/(private\/)?tmp\//.test(real(dataDir)) || /^\/(private\/)?var\/folders\//.test(real(dataDir));
/** Write a key file: a random temporary name, synced, renamed into place, the folder synced. */
function writeKeyFile(file: string, body: string) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${randomBytes(8).toString("hex")}.tmp`, fd = openSync(tmp, "wx", 0o600);
  try { writeSync(fd, body); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, file);
  try { const d = openSync(dirname(file), "r"); try { fsyncSync(d); } finally { closeSync(d); } } catch {}
}
/** overwrite, sync, then remove: the old key file of an identity that was upgraded or replaced */
export function shred(file: string) {
  try { const n = statSync(file).size, fd = openSync(file, "r+"); try { writeSync(fd, randomBytes(Math.max(n, 64)), 0, Math.max(n, 64), 0); fsyncSync(fd); } finally { closeSync(fd); } } catch {}
  rmSync(file, { force: true });
}
/** where an identity's files live: <home>/identity.json and admin.key, or enclave.json (home: <data>/lan by default) */
const files = (home: string) => ({ dir: home, identity: join(home, "identity.json"), admin: join(home, "admin.key"), enclave: join(home, "enclave.json"), v1: join(home, "identity.key") });
/** which identity is in this home, if any */
export function storedKind(home: string): KeystoreKind | null {
  const f = files(home);
  if (existsSync(f.enclave)) { try { return JSON.parse(readFileSync(f.enclave, "utf8")).soft ? "soft-enclave" : "enclave"; } catch { return "enclave"; } }
  return existsSync(f.identity) || existsSync(f.admin) ? "file" : null;
}
const storage = async (ks: Pick<Keystore, "dh" | "dhPub">) => sha256(Buffer.from(`${DOMAIN}\0storage\0`), await ks.dh(ks.dhPub));

// ---------- the file keystore ----------
class FileKeystore implements Keystore {
  readonly kind = "file" as const; readonly key: string; readonly fingerprint: string; readonly identity: Buffer; readonly signPub: Buffer; readonly dhPub: Buffer;
  private sk?: Promise<Buffer>;
  constructor(private admin_: KeyPair, private sign_: KeyPair, private dh_: KeyPair, readonly cert: Cert) {
    this.identity = admin_.pub; this.key = b64u(admin_.pub); this.fingerprint = fingerprint(admin_.pub); this.signPub = sign_.pub; this.dhPub = dh_.pub;
  }
  async sign(purpose: "entry", msg: Uint8Array) { if (!(DAILY_PURPOSES as readonly string[]).includes(purpose)) throw new Error("not a daily purpose"); return softSign(this.sign_, purpose, msg); }
  async dh(peer: Uint8Array) { return softDh(this.dh_.priv, peer); }
  async admin(purpose: AdminPurpose, fields: string[]) { if (!(ADMIN_PURPOSES as readonly string[]).includes(purpose) || !adminFieldsOk(fields)) throw new Error("not an admin message"); return softSign(this.admin_, purpose, adminMessage(fields)); }
  storageKey() { return (this.sk ??= storage(this)); }
  close() {}
}
function openFile(home: string, create: boolean): FileKeystore | null {
  const f = files(home);
  if (!existsSync(f.identity) || !existsSync(f.admin)) {
    if (existsSync(f.identity) !== existsSync(f.admin)) throw new Error(`the LAN identity is incomplete (${existsSync(f.identity) ? f.admin : f.identity} is missing): it cannot be used`);
    if (!create) return null;
    const a = generateKeyPair(), s = generateKeyPair(), d = generateKeyPair(), at = new Date().toISOString();
    const unsigned = { v: 2 as const, id: b64u(a.pub), sign: b64u(s.pub), dh: b64u(d.pub), seq: 1, at };
    const cert: Cert = { ...unsigned, sig: b64u(softSign(a, "cert", adminMessage(certFields(unsigned)))) };
    writeKeyFile(f.admin, JSON.stringify({ v: 2, d: b64u(a.priv) }));
    writeKeyFile(f.identity, JSON.stringify({ v: 2, sign: b64u(s.priv), dh: b64u(d.priv), cert }));
    return new FileKeystore(a, s, d, cert);
  }
  let a: any, j: any; try { a = JSON.parse(readFileSync(f.admin, "utf8")); j = JSON.parse(readFileSync(f.identity, "utf8")); } catch { throw new Error(`the LAN identity files in ${f.dir} cannot be read: fix or restore them (peers know this Studio by that key)`); }
  try { chmodSync(f.admin, 0o600); chmodSync(f.identity, 0o600); } catch {}
  const admin = keyPairOf(unb64u(a.d, 32)), sign = keyPairOf(unb64u(j.sign, 32)), dh = keyPairOf(unb64u(j.dh, 32));
  if (!verifyCert(j.cert, admin.pub) || j.cert.sign !== b64u(sign.pub) || j.cert.dh !== b64u(dh.pub)) throw new Error("the LAN identity's certificate does not match its keys");
  return new FileKeystore(admin, sign, dh, j.cert);
}

// ---------- the enclave keystore (and its test stand-in) ----------
/** The helper, long-lived: one request per line, answered in order by id; every input is checked on both sides. */
export class Helper {
  private p: ReturnType<typeof Bun.spawn> | null = null; private n = 0; private wait = new Map<number, { ok: (v: any) => void; no: (e: Error) => void }>(); private buf = "";
  constructor(private readonly argv: string[]) {}
  private start() {
    if (this.p) return this.p;
    const p = Bun.spawn(this.argv, { stdin: "pipe", stdout: "pipe", stderr: "ignore", env: scrubEnv() });
    this.p = p;
    (async () => { const dec = new TextDecoder(); for await (const chunk of p.stdout as any) { this.buf += dec.decode(chunk, { stream: true }); let i: number;
      while ((i = this.buf.indexOf("\n")) >= 0) { const line = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1); let r: any; try { r = JSON.parse(line); } catch { continue; }
        const w = this.wait.get(r.id); if (!w) continue; this.wait.delete(r.id); if (r.ok) w.ok(r); else w.no(new Error(String(r.error ?? "the helper refused").slice(0, 300))); } } })()
      .catch(() => {}).finally(() => { if (this.p === p) this.p = null; for (const w of this.wait.values()) w.no(new Error("the identity helper stopped")); this.wait.clear(); });
    return p;
  }
  call(q: Record<string, unknown>, timeoutMs = 120_000): Promise<any> {
    const p = this.start(), id = ++this.n;
    return new Promise((ok, no) => {
      const t = setTimeout(() => { this.wait.delete(id); no(new Error("the identity helper did not answer")); }, timeoutMs); (t as any).unref?.();
      this.wait.set(id, { ok: (v) => { clearTimeout(t); ok(v); }, no: (e) => { clearTimeout(t); no(e); } });
      (p.stdin as any).write(JSON.stringify({ ...q, id }) + "\n"); (p.stdin as any).flush?.();
    });
  }
  close() { try { (this.p?.stdin as any)?.end?.(); this.p?.kill(); } catch {} this.p = null; }
}
const SE_KEY = (v: any) => !!v && typeof v.blob === "string" && v.blob.length <= 8192 && typeof v.pub === "string";
class EnclaveKeystore implements Keystore {
  readonly key: string; readonly fingerprint: string; readonly identity: Buffer; readonly signPub: Buffer; readonly dhPub: Buffer; private sk?: Promise<Buffer>;
  constructor(readonly kind: "enclave" | "soft-enclave", private h: Helper, private blobs: { admin: string; sign: string; dh: string }, pubs: { admin: Buffer; sign: Buffer; dh: Buffer }, readonly cert: Cert) {
    this.identity = pubs.admin; this.key = b64u(pubs.admin); this.fingerprint = fingerprint(pubs.admin); this.signPub = pubs.sign; this.dhPub = pubs.dh;
  }
  async sign(purpose: "entry", msg: Uint8Array) { const r = await this.h.call({ op: "sign", blob: this.blobs.sign, purpose, msg: Buffer.from(msg).toString("base64") }, 30_000); return unb64u(r.sig, 64); }
  async dh(peer: Uint8Array) { const r = await this.h.call({ op: "dh", blob: this.blobs.dh, peer: b64u(peer) }, 30_000); return unb64u(r.secret, 32); }
  async admin(purpose: AdminPurpose, fields: string[]) { if (!adminFieldsOk(fields)) throw new Error("not an admin message"); const r = await this.h.call({ op: "admin", blob: this.blobs.admin, purpose, fields }); return unb64u(r.sig, 64); }
  storageKey() { return (this.sk ??= storage(this)); }
  close() { this.h.close(); }
}
async function openEnclave(home: string, kind: "enclave" | "soft-enclave", h: Helper, create: boolean, presence: boolean): Promise<EnclaveKeystore | null> {
  const f = files(home);
  if (existsSync(f.enclave)) {
    let j: any; try { j = JSON.parse(readFileSync(f.enclave, "utf8")); } catch { throw new Error(`the LAN identity ${f.enclave} cannot be read`); }
    if (!SE_KEY(j?.admin) || !SE_KEY(j?.sign) || !SE_KEY(j?.dh)) throw new Error(`the LAN identity ${f.enclave} is not complete`);
    if (!!j.soft !== (kind === "soft-enclave")) throw new Error(kind === "enclave" ? "this data folder's identity is a test stand-in, not a Secure Enclave key" : "this data folder's identity is a Secure Enclave key");
    try { chmodSync(f.enclave, 0o600); } catch {}
    // the public keys are asked of the enclave (a blob it cannot load is an identity this Mac does not hold)
    const pub = async (kind2: "sign" | "dh", blob: string) => unb64u((await h.call({ op: "pub", kind: kind2, blob }, 30_000)).pub, 65);
    let pubs: { admin: Buffer; sign: Buffer; dh: Buffer };
    try { pubs = { admin: await pub("sign", j.admin.blob), sign: await pub("sign", j.sign.blob), dh: await pub("dh", j.dh.blob) }; }
    catch (e: any) { throw new Error(`this Mac's Secure Enclave does not hold the LAN identity kept in ${f.enclave} (${String(e?.message ?? e).slice(0, 120)}): it cannot be used here`); }
    if (!verifyCert(j.cert, pubs.admin) || j.cert.sign !== b64u(pubs.sign) || j.cert.dh !== b64u(pubs.dh)) throw new Error("the LAN identity's certificate does not match its keys");
    return new EnclaveKeystore(kind, h, { admin: j.admin.blob, sign: j.sign.blob, dh: j.dh.blob }, pubs, j.cert);
  }
  if (!create) return null;
  const mk = async (k: "sign" | "dh", p: boolean) => { const r = await h.call({ op: "create", kind: k, presence: p }, 60_000); return { blob: String(r.blob), pub: unb64u(r.pub, 65) }; };
  const admin = await mk("sign", presence), sign = await mk("sign", false), dh = await mk("dh", false), at = new Date().toISOString();
  const unsigned = { v: 2 as const, id: b64u(admin.pub), sign: b64u(sign.pub), dh: b64u(dh.pub), seq: 1, at };
  // the first admin signature: the person confirms the new identity once
  const sig = unb64u((await h.call({ op: "admin", blob: admin.blob, purpose: "cert", fields: certFields(unsigned) })).sig, 64);
  const cert: Cert = { ...unsigned, sig: b64u(sig) };
  if (!verifyCert(cert, admin.pub)) throw new Error("the Secure Enclave's certificate did not verify");
  writeKeyFile(f.enclave, JSON.stringify({ v: 2, ...(kind === "soft-enclave" ? { soft: true } : {}), admin: { blob: admin.blob, pub: b64u(admin.pub), presence }, sign: { blob: sign.blob, pub: b64u(sign.pub) }, dh: { blob: dh.blob, pub: b64u(dh.pub) }, cert }));
  return new EnclaveKeystore(kind, h, { admin: admin.blob, sign: sign.blob, dh: dh.blob }, { admin: admin.pub, sign: sign.pub, dh: dh.pub }, cert);
}

/** The helper binary for this Mac: built once per source version into Studio's data folder, ad-hoc signed; null when
 *  swiftc is not here or the build fails (Studio then keeps a file identity and says so). */
export function buildHelper(dataDir: string): string | null {
  if (process.platform !== "darwin") return null;
  const swiftc = Bun.which("swiftc"); if (!swiftc) return null;
  const dir = join(dataDir, "lan", "helper"), bin = join(dir, `crew-lan-se-${sha256hex(SRC).slice(0, 12)}`);
  if (existsSync(bin)) return bin;
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 }); const src = join(dir, "se-helper.swift"); writeFileSync(src, SRC, { mode: 0o600 });
    const tmp = `${bin}.${randomBytes(4).toString("hex")}.tmp`;
    const b = Bun.spawnSync([swiftc, "-O", "-o", tmp, src], { stdout: "ignore", stderr: "pipe", timeout: 300_000, env: scrubEnv() }); if (b.exitCode !== 0) return null;
    Bun.spawnSync(["/usr/bin/codesign", "--force", "-s", "-", tmp], { stdout: "ignore", stderr: "ignore", timeout: 60_000 });
    renameSync(tmp, bin); return bin;
  } catch { return null; }
}
/** May this Studio use the soft-enclave stand-in? Only an isolated test run with a temporary data folder. */
export function softAllowed(dataDir: string) { return !!process.env.CREW_TEST_ENV_ISOLATED && underTmp(dataDir); }

export type OpenResult = { ks: Keystore | null; why?: string; fallback?: string };
/**
 * Open this Studio's identity, or make one when `create` (Studio asks only when it has no own log and no peers: a missing
 * identity with state is an identity loss, src/lan/relay.ts). The kind on disk wins; a new identity goes in the Secure
 * Enclave when this Mac has one and the helper builds (never in a test run unless CREW_LAN_REAL_SE=1), else in files.
 * CREW_LAN_KEYSTORE=file|enclave|soft-enclave asks for one kind.
 */
export async function openKeystore(dataDir: string, o: { create: boolean; kind?: KeystoreKind; helper?: string[]; presence?: boolean; home?: string }): Promise<OpenResult> {
  const home = o.home ?? join(dataDir, "lan");
  const want = (o.kind ?? process.env.CREW_LAN_KEYSTORE ?? null) as KeystoreKind | null, have = storedKind(home);
  const kind: KeystoreKind = have ?? want ?? (defaultEnclave(dataDir) ? "enclave" : "file");
  if (have && want && have !== want) return { ks: null, why: `this data folder's LAN identity is a ${have} identity; it is not changed by asking for ${want}` };
  if (kind === "file") return { ks: openFile(home, o.create) };
  if (kind === "soft-enclave") {
    if (!softAllowed(dataDir)) return { ks: null, why: "the test stand-in for the Secure Enclave is refused outside an isolated test run with a temporary data folder" };
    const h = new Helper(o.helper ?? [process.execPath, join(import.meta.dir, "../../tests/lan/soft-enclave.ts")]);
    return { ks: await openEnclave(home, "soft-enclave", h, o.create, o.presence ?? true) };
  }
  const bin = o.helper ? null : buildHelper(dataDir);
  if (!o.helper && !bin) {
    if (have === "enclave") return { ks: null, why: "the Secure Enclave helper cannot be built on this Mac (swiftc is needed): the identity kept in the enclave cannot be used" };
    return { ks: openFile(home, o.create), fallback: "the Secure Enclave helper could not be built; the identity is kept in files" };
  }
  const h = new Helper(o.helper ?? [bin!]);
  try { const a = await h.call({ op: "available" }, 30_000); if (!a.se) { h.close(); if (have === "enclave") return { ks: null, why: "this Mac has no Secure Enclave: the identity kept in one cannot be used" }; return { ks: openFile(home, o.create), fallback: "this Mac has no Secure Enclave; the identity is kept in files" }; } }
  catch (e: any) { h.close(); if (have === "enclave") return { ks: null, why: `the Secure Enclave helper did not answer: ${e?.message ?? e}` }; return { ks: openFile(home, o.create), fallback: "the Secure Enclave helper did not answer; the identity is kept in files" }; }
  return { ks: await openEnclave(home, "enclave", h, o.create, o.presence ?? true) };
}
/** a new identity goes in the enclave on a Mac, outside tests (a test opts in with CREW_LAN_REAL_SE=1) */
function defaultEnclave(dataDir: string) {
  if (process.platform !== "darwin") return false;
  if (process.env.CREW_TEST_ENV_ISOLATED && process.env.CREW_LAN_REAL_SE !== "1") return false;
  if (underTmp(dataDir) && process.env.CREW_LAN_REAL_SE !== "1") return false;
  return true;
}
/** the old version 1 identity file: not read by this version (protocol 2 has no single-key identity) */
export const v1IdentityFile = (dataDir: string) => files(join(dataDir, "lan")).v1;
export const identityFiles = files;
