// This Studio's LAN identity (docs/units/lan-relay.md): one P-256 key pair. Its private half lives in the macOS Keychain
// where there is one (a generic-password item of this account, written through `security -i` on stdin so the key never
// appears on a process's argv, which every same-uid process can read), otherwise in a 0600 file under Studio's data
// folder (`lan/identity.key`, denied to every round's sandbox like the rest of Studio's data). Tests and the two-port
// demo use the file (CREW_LAN_KEYSTORE=file). The identity is the full public key; its fingerprint is for people only.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { b64u, fingerprint, generateKeyPair, keyPairOf, sha256hex, unb64u, type KeyPair } from "./crypto";
import { scrubEnv } from "../secure";

export type Identity = KeyPair & { key: string; fingerprint: string; store: "keychain" | "file" };
const SERVICE = "crew-studio-lan-identity";

function keychainAvailable(): boolean {
  const mode = process.env.CREW_LAN_KEYSTORE;
  if (mode === "file") return false;
  if (process.platform !== "darwin") return false;
  return !!Bun.which(process.env.CREW_KEYCHAIN_TOOL && process.env.CREW_KEYCHAIN_TOOL !== "none" ? process.env.CREW_KEYCHAIN_TOOL : "security") && process.env.CREW_KEYCHAIN_TOOL !== "none";
}
const tool = () => process.env.CREW_KEYCHAIN_TOOL && process.env.CREW_KEYCHAIN_TOOL !== "none" ? process.env.CREW_KEYCHAIN_TOOL : "security";
/** One item per data folder, so two Studios on one Mac (the two-port demo, a test) never share an identity. */
const account = (dataDir: string) => `lan-${sha256hex(dataDir).slice(0, 16)}`;

function keychainRead(dataDir: string): Buffer | null {
  const r = Bun.spawnSync([tool(), "find-generic-password", "-s", SERVICE, "-a", account(dataDir), "-w"], { env: scrubEnv(), stdout: "pipe", stderr: "ignore", timeout: 10_000 });
  if (r.exitCode !== 0) return null;
  try { return unb64u(r.stdout.toString().trim(), 32); } catch { return null; }
}
function keychainWrite(dataDir: string, priv: Buffer): boolean {
  // `security -i` reads its command from stdin: the secret is never on an argv
  const cmd = `add-generic-password -U -s ${SERVICE} -a ${account(dataDir)} -l "Crew Studio LAN identity" -w ${b64u(priv)}\n`;
  const r = Bun.spawnSync([tool(), "-i"], { env: scrubEnv(), stdin: Buffer.from(cmd), stdout: "ignore", stderr: "pipe", timeout: 10_000 });
  return r.exitCode === 0 && !/error/i.test(r.stderr.toString()) && !!keychainRead(dataDir)?.equals(priv);
}

export function loadIdentity(dataDir: string): Identity {
  const file = join(dataDir, "lan", "identity.key");
  const done = (k: KeyPair, store: Identity["store"]): Identity => ({ ...k, key: b64u(k.pub), fingerprint: fingerprint(k.pub), store });
  if (keychainAvailable()) {
    const have = keychainRead(dataDir); if (have) return done(keyPairOf(have), "keychain");
    // an identity made before the keychain was used: moved in, and the file removed only once the keychain holds it
    const k = existsSync(file) ? keyPairOf(unb64u(JSON.parse(readFileSync(file, "utf8")).d, 32)) : generateKeyPair();
    if (keychainWrite(dataDir, k.priv)) { if (existsSync(file)) writeFileSync(file, "", { mode: 0o600 }); return done(k, "keychain"); }
    console.warn("crew-studio: the LAN identity could not be kept in the keychain; it is kept in a 0600 file in Studio's data folder");
  }
  if (existsSync(file)) {
    const raw = readFileSync(file, "utf8");
    if (raw.trim()) { try { chmodSync(file, 0o600); } catch {} return done(keyPairOf(unb64u(JSON.parse(raw).d, 32)), "file"); }
  }
  const k = generateKeyPair();
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp`; writeFileSync(tmp, JSON.stringify({ v: 1, d: b64u(k.priv) }), { mode: 0o600 }); renameSync(tmp, file);
  return done(k, "file");
}
