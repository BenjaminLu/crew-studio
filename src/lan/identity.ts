// This Studio's LAN identity (docs/units/lan-relay.md): one P-256 key pair. By default its private half lives in a 0600
// file under Studio's data folder (`lan/identity.key`, denied to every round's sandbox like the rest of Studio's data).
// The macOS Keychain is opt-in: only with CREW_KEYSTORE=keychain, and never for a test run (CREW_TEST_ENV_ISOLATED) or a
// data folder under the temporary directory, so no test, demo or script ever touches the captain's login Keychain (it
// raises access dialogs). The Keychain item is written through `security -i` on stdin, so the key is never on an argv.
// The identity is the full public key; its fingerprint is for people only.
import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, writeSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { b64u, fingerprint, generateKeyPair, keyPairOf, sha256hex, unb64u, type KeyPair } from "./crypto";
import { scrubEnv } from "../secure";

export type Identity = KeyPair & { key: string; fingerprint: string; store: "keychain" | "file" };
const SERVICE = "crew-studio-lan-identity";

/** The one way Studio runs the keychain tool (a test replaces it to prove it is never called by default). */
export const keychainSpawn: { run: (argv: string[], o: any) => { exitCode: number | null; stdout: Buffer; stderr: Buffer } } = { run: (argv, o) => Bun.spawnSync(argv, o) as any };
const real = (p: string) => { try { return realpathSync(p); } catch { return resolve(p); } };
/** The Keychain only when asked for (CREW_KEYSTORE=keychain), on macOS, outside tests and temporary data folders. */
export function keychainWanted(dataDir: string): boolean {
  if (process.env.CREW_KEYSTORE !== "keychain") return false;
  if (process.env.CREW_TEST_ENV_ISOLATED) return false;
  if (real(dataDir).startsWith(real(tmpdir()) + "/") || /^\/(private\/)?tmp\//.test(real(dataDir))) return false;
  return keychainAvailable();
}
function keychainAvailable(): boolean {
  if (process.platform !== "darwin") return false;
  return !!Bun.which(process.env.CREW_KEYCHAIN_TOOL && process.env.CREW_KEYCHAIN_TOOL !== "none" ? process.env.CREW_KEYCHAIN_TOOL : "security") && process.env.CREW_KEYCHAIN_TOOL !== "none";
}
const tool = () => process.env.CREW_KEYCHAIN_TOOL && process.env.CREW_KEYCHAIN_TOOL !== "none" ? process.env.CREW_KEYCHAIN_TOOL : "security";
/** One item per data folder, so two Studios on one Mac (the two-port demo, a test) never share an identity. */
const account = (dataDir: string) => `lan-${sha256hex(dataDir).slice(0, 16)}`;

function keychainRead(dataDir: string): Buffer | null {
  const r = keychainSpawn.run([tool(), "find-generic-password", "-s", SERVICE, "-a", account(dataDir), "-w"], { env: scrubEnv(), stdout: "pipe", stderr: "ignore", timeout: 10_000 });
  if (r.exitCode !== 0) return null;
  const v = r.stdout.toString().trim(); if (/^[0-9a-f]{64}$/.test(v)) return Buffer.from(v, "hex");
  try { return unb64u(v, 32); } catch { return null; }
}
function keychainWrite(dataDir: string, priv: Buffer): boolean {
  // `security -i` reads its command from stdin: the secret is never on an argv
  const cmd = `add-generic-password -U -s ${SERVICE} -a ${account(dataDir)} -l "Crew Studio LAN identity" -w ${Buffer.from(priv).toString("hex")}\n`; // hex: never a leading "-" the parser would take for an option
  const r = keychainSpawn.run([tool(), "-i"], { env: scrubEnv(), stdin: Buffer.from(cmd), stdout: "ignore", stderr: "pipe", timeout: 10_000 });
  return r.exitCode === 0 && !/error/i.test(r.stderr.toString()) && !!keychainRead(dataDir)?.equals(priv);
}

/** Write the key file: a random temporary name, synced, renamed into place, the folder synced. */
function writeKeyFile(file: string, body: string) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${randomBytes(8).toString("hex")}.tmp`, fd = openSync(tmp, "wx", 0o600);
  try { writeSync(fd, body); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, file);
  try { const d = openSync(dirname(file), "r"); try { fsyncSync(d); } finally { closeSync(d); } } catch {}
}
/** opts.keychain: tests only, with keychainSpawn replaced by a stand-in (never the real tool).
 *  A key file that exists but cannot be read is an error, never a reason to make a new identity (peers know the old one). */
export function loadIdentity(dataDir: string, opts: { keychain?: boolean } = {}): Identity {
  const file = join(dataDir, "lan", "identity.key");
  const done = (k: KeyPair, store: Identity["store"]): Identity => ({ ...k, key: b64u(k.pub), fingerprint: fingerprint(k.pub), store });
  const fromFile = (): { d: string } | { store: "keychain" } | null => {
    if (!existsSync(file)) return null;
    let j: any; try { j = JSON.parse(readFileSync(file, "utf8")); } catch { throw new Error(`the LAN identity file ${file} cannot be read: fix or remove it (peers know this Studio by that key)`); }
    if (j?.store === "keychain") return { store: "keychain" };
    if (typeof j?.d !== "string") throw new Error(`the LAN identity file ${file} holds no key: fix or remove it`);
    try { chmodSync(file, 0o600); } catch {} return { d: j.d };
  };
  const f = fromFile();
  if (opts.keychain ?? keychainWanted(dataDir)) {
    const have = keychainRead(dataDir); if (have) return done(keyPairOf(have), "keychain");
    if (f && "store" in f) throw new Error("the LAN identity was moved to the Keychain, and the Keychain no longer has it");
    // an identity made before the keychain was used: moved in, and the file replaced by a marker only once the keychain holds it
    const k = f ? keyPairOf(unb64u(f.d, 32)) : generateKeyPair();
    if (keychainWrite(dataDir, k.priv)) { writeKeyFile(file, JSON.stringify({ v: 1, store: "keychain" })); return done(k, "keychain"); }
    if (!f) { writeKeyFile(file, JSON.stringify({ v: 1, d: b64u(k.priv) })); }
    console.warn("crew-studio: the LAN identity could not be kept in the keychain; it is kept in a 0600 file in Studio's data folder");
    return done(k, "file");
  }
  if (f && "store" in f) throw new Error("the LAN identity is kept in the Keychain: start Studio with CREW_KEYSTORE=keychain");
  if (f) return done(keyPairOf(unb64u(f.d, 32)), "file");
  const k = generateKeyPair();
  writeKeyFile(file, JSON.stringify({ v: 1, d: b64u(k.priv) }));
  return done(k, "file");
}
