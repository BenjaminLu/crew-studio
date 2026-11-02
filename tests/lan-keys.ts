import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The LAN identity's three keystores behind one contract (src/lan/keystore.ts): file, soft-enclave (the Secure Enclave
// helper's protocol over software keys, tests only) and, opt-in on a Mac with one, the real Secure Enclave
// (CREW_LAN_REAL_SE=1: it shows Touch ID or password prompts). Golden vectors check that the Swift helper builds the same
// admin message and prompt as TypeScript. No test touches the login Keychain: the enclave keys are made with
// dataRepresentation, never stored there.                                                         bun tests/lan-keys.ts
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { b64u, dh, fingerprint, generateKeyPair, verify } from "../src/lan/crypto";
import { adminMessage, buildHelper, certHash, Helper, openKeystore, softAllowed, verifyAdmin, verifyCert, type Keystore, type KeystoreKind } from "../src/lan/keystore";

let pass = 0, fail = 0;
const ok = (c: unknown, what: string, detail = "") => { if (c) { pass++; console.log(`  ok    ${what}`); } else { fail++; console.log(`  FAIL  ${what}${detail ? `\n        ${detail}` : ""}`); } };
const dirOf = (n: string) => mkdtempSync(join(tmpdir(), `crew-lan-keys-${n}-`));
const prompts = join(dirOf("prompts"), "prompts.txt"), deny = join(dirOf("deny-flag"), "deny"); process.env.CREW_SOFT_ENCLAVE_PROMPTS = prompts; process.env.CREW_SOFT_ENCLAVE_DENY = deny;
const promptLines = () => (existsSync(prompts) ? readFileSync(prompts, "utf8").trim().split("\n").filter(Boolean) : []);

async function contract(kind: KeystoreKind) {
  const d = dirOf(kind), made = await openKeystore(d, { create: true, kind });
  const ks = made.ks!; ok(!!ks && ks.kind === kind, `${kind}: a new identity is made`, made.why ?? "");
  if (!ks) return;
  ok(ks.identity.length === 65 && ks.key === b64u(ks.identity) && ks.fingerprint === fingerprint(ks.identity), `${kind}: the identity is the admin public key, and its fingerprint is what people compare`);
  ok(verifyCert(ks.cert, ks.identity) && ks.cert.sign === b64u(ks.signPub) && ks.cert.dh === b64u(ks.dhPub) && ks.cert.seq === 1, `${kind}: one certificate, signed by the admin key, binds both daily keys from the first entry on`);
  ok(!ks.signPub.equals(ks.identity) && !ks.dhPub.equals(ks.identity) && !ks.signPub.equals(ks.dhPub), `${kind}: three different keys (admin, daily signing, daily key agreement)`);
  const msg = Buffer.from("an entry"), sig = await ks.sign("entry", msg);
  ok(verify(ks.signPub, "entry", msg, sig) && !verify(ks.identity, "entry", msg, sig), `${kind}: a daily signature verifies with the daily key, never as the admin key`);
  let e1 = ""; try { await ks.sign("cert" as any, msg); } catch (x: any) { e1 = String(x?.message ?? x); }
  ok(/daily purpose/.test(e1), `${kind}: the daily key never signs an admin purpose`, e1);
  const peer = generateKeyPair(), s1 = await ks.dh(peer.pub);
  ok(s1.equals(dh(peer.priv, ks.dhPub)), `${kind}: key agreement with the daily key matches the peer's side`);
  const fields = [b64u(peer.pub), "a".repeat(64), new Date().toISOString()], before = promptLines().length;
  const a = await ks.admin("introduce", fields);
  ok(verifyAdmin(ks.identity, "introduce", fields, a) && !verifyAdmin(ks.identity, "revoke", fields, a), `${kind}: an admin signature verifies for its purpose only`);
  if (kind === "soft-enclave") ok(promptLines().length === before + 1 && promptLines().at(-1)!.includes(fingerprint(peer.pub)), "soft-enclave: each admin signature is a prompt, and its text names the peer's fingerprint (built from the fields, never from the caller)", promptLines().at(-1));
  let e2 = ""; try { await ks.admin("introduce", ["has a space"]); } catch (x: any) { e2 = String(x?.message ?? x); }
  ok(!!e2, `${kind}: an admin message with a field that is not plain ASCII is refused`, e2);
  const k1 = await ks.storageKey(); ks.close();
  const again = (await openKeystore(d, { create: false, kind })).ks!;
  ok(again.key === ks.key && certHash(again.cert) === certHash(ks.cert) && (await again.storageKey()).equals(k1), `${kind}: reopened, it is the same identity, certificate and storage key`);
  for (const f of ["identity.json", "admin.key", "enclave.json"]) { const p = join(d, "lan", f); if (existsSync(p)) ok((statSync(p).mode & 0o777) === 0o600, `${kind}: ${f} is 0600`); }
  if (kind !== "file") ok(!readFileSync(join(d, "lan", "enclave.json"), "utf8").includes(b64u(ks.identity).slice(0, 0) + '"d"'), `${kind}: enclave.json holds blobs and public keys, no private scalar`);
  again.close();
  return d;
}

await contract("file");
await contract("soft-enclave");
// the soft enclave is refused outside an isolated test with a temporary data folder
{ const iso = process.env.CREW_TEST_ENV_ISOLATED; delete process.env.CREW_TEST_ENV_ISOLATED;
  const r = await openKeystore(dirOf("noiso"), { create: true, kind: "soft-enclave" });
  ok(!r.ks && /refused/.test(r.why ?? "") && !softAllowed(dirOf("x")), "the soft enclave is refused outside an isolated test run", r.why);
  process.env.CREW_TEST_ENV_ISOLATED = iso; }
// a person who cancels Touch ID: no admin signature
{ const d = dirOf("deny"), ks = (await openKeystore(d, { create: true, kind: "soft-enclave" })).ks!; writeFileSync(deny, "");
  let e = ""; try { await ks.admin("revoke", [ks.key, "3", "-", new Date().toISOString()]); } catch (x: any) { e = String(x?.message ?? x); }
  ok(/cancelled/.test(e), "an admin signature the person cancels is refused (nothing is signed)", e); Bun.spawnSync(["rm", deny]); ks.close(); }
// a Touch ID prompt that waits for the person does not hold up the daily keys: the admin key has a helper process of its
// own (each helper answers one request at a time, as the Swift helper does)
{ const hold = join(dirOf("hold"), "hold"); process.env.CREW_SOFT_ENCLAVE_HOLD = hold;
  const ks = (await openKeystore(dirOf("twohelpers"), { create: true, kind: "soft-enclave" })).ks!; writeFileSync(hold, "");
  const pending = ks.admin("introduce", [b64u(generateKeyPair().pub), "a".repeat(64), new Date().toISOString()]).then(() => "signed", (e: any) => String(e?.message ?? e));
  await Bun.sleep(200);
  const daily = await Promise.race([Promise.all([ks.sign("entry", Buffer.from("x")), ks.dh(generateKeyPair().pub)]).then(() => "answered"), Bun.sleep(3000).then(() => "waited")]);
  Bun.spawnSync(["rm", hold]); const adm = await pending;
  ok(daily === "answered" && adm === "signed", "a daily signature and a key agreement are answered while an admin signature waits for Touch ID (two helper processes)", JSON.stringify([daily, adm]));
  ks.close(); delete process.env.CREW_SOFT_ENCLAVE_HOLD; }
// opt-in biometry only: the admin key is made for the fingerprints enrolled now (shown as such), daily keys unchanged
{ const d = dirOf("bio"), ks = (await openKeystore(d, { create: true, kind: "soft-enclave", presence: "biometry" })).ks!;
  const j = JSON.parse(readFileSync(join(d, "lan", "enclave.json"), "utf8")); ks.close();
  const again = (await openKeystore(d, { create: false, kind: "soft-enclave" })).ks!;
  ok(j.admin.presence === "biometry" && again.adminGuard === "biometry" && (await openKeystore(dirOf("pres"), { create: true, kind: "soft-enclave" })).ks!.adminGuard === "presence", "biometry only is an opt-in for the admin key (kept and shown); the default is Touch ID or the password"); again.close(); }
// the default in a test run is the file keystore (never the Secure Enclave, never the Keychain)
{ const r = await openKeystore(dirOf("default"), { create: true }); ok(r.ks?.kind === "file", "a test run's default identity is the file keystore", r.ks?.kind); r.ks?.close(); }
// a kind on disk is never silently changed
{ const d = dirOf("kind"); (await openKeystore(d, { create: true, kind: "file" })).ks!.close();
  const r = await openKeystore(d, { create: false, kind: "soft-enclave" }); ok(!r.ks && /file identity/.test(r.why ?? ""), "asking for another keystore never replaces the identity on disk", r.why); }
// an incomplete file identity is an error, never a reason to make a new one
{ const d = dirOf("half"); (await openKeystore(d, { create: true, kind: "file" })).ks!.close(); writeFileSync(join(d, "lan", "admin.key.gone"), ""); Bun.spawnSync(["rm", join(d, "lan", "admin.key")]);
  let e = ""; try { await openKeystore(d, { create: true, kind: "file" }); } catch (x: any) { e = String(x?.message ?? x); }
  ok(/incomplete/.test(e), "a file identity missing its admin key is refused, never replaced", e); }

// golden vectors: the Swift helper builds the same admin message and prompt as TypeScript (no Secure Enclave needed)
// the helper builds without blocking Studio (a background build while the relay waits), with the compiler found at a fixed
// place (xcode-select's developer folder, or /usr/bin/xcrun), never from PATH
{ const { swiftcPath } = await import("../src/lan/keystore") as any;
  if (process.platform === "darwin") { const path0 = process.env.PATH; process.env.PATH = "/nonexistent"; const sw = swiftcPath(); process.env.PATH = path0;
    ok(sw === null || (sw[0] === "/usr/bin/xcrun" && sw.at(-1) === "swiftc"), "the Swift compiler runs from a fixed place (/usr/bin/xcrun), not from PATH", JSON.stringify(sw));
    if (sw) { let ticks = 0; const iv = setInterval(() => ticks++, 20); const t0 = Date.now(); const built = await buildHelper(dirOf("bg")); clearInterval(iv);
      ok(!!built && ticks >= Math.floor((Date.now() - t0) / 20 / 3), "building the helper does not block the event loop (it runs in the background)", JSON.stringify({ ms: Date.now() - t0, ticks })); } } }
{ const bin = process.platform === "darwin" && Bun.which("swiftc") ? await buildHelper(dirOf("build")) : null;
  if (!bin) console.log("  skip  golden vectors: no swiftc on this machine (the helper is built only on a Mac)");
  else {
    const swift = new Helper([bin]), soft = new Helper([process.execPath, join(import.meta.dir, "lan/soft-enclave.ts")]);
    const k1 = b64u(generateKeyPair().pub), k2 = b64u(generateKeyPair().pub), at = "2026-11-02T08:00:00.000Z";
    const vectors: [string, string[]][] = [["cert", [k1, k2, "1", at]], ["introduce", [k1, "f".repeat(64), at]], ["revoke", [k1, "42", "-", at]], ["revoke", [k1, "42", k2, at]], ["successor", [k1, k2, at]], ["replace", [k1, k2, at]], ["reviewed", ["0123456789abcdef0123456789abcdef01234567", at]]];
    for (const [purpose, fields] of vectors) {
      const a = await swift.call({ op: "message", purpose, fields }), b = await soft.call({ op: "message", purpose, fields });
      ok(a.msg === b64u(adminMessage(fields)) && a.msg === b.msg && a.prompt === b.prompt, `golden: ${purpose} (${fields.length} fields): the Swift helper's message and prompt equal TypeScript's`, JSON.stringify([a.prompt, b.prompt]));
    }
    for (const [purpose, fields] of [["cert", ["not a key", k2, "1", at]], ["introduce", [k1, "x y", at]], ["entry", [k1]], ["revoke", [k1, "-3", "-", at]], ["reviewed", ["not-a-commit", at]], ["reviewed", ["0123456789ABCDEF0123456789ABCDEF01234567", at]]] as [string, string[]][]) {
      let e = ""; try { await swift.call({ op: "message", purpose, fields }); } catch (x: any) { e = String(x?.message ?? x); }
      ok(!!e, `golden: the Swift helper refuses ${purpose} with ${JSON.stringify(fields).slice(0, 40)}`, e);
    }
    let e = ""; try { await swift.call({ op: "available", extra: 1 }); } catch (x: any) { e = String(x?.message ?? x); }
    ok(/unknown field/.test(e), "golden: the Swift helper refuses a field it does not know", e);
    // a daily signature is an entry only: "cert-request" is not a daily purpose any more (the admin key certifies)
    if ((await swift.call({ op: "available" })).se) { let e2 = ""; try { await swift.call({ op: "sign", blob: "AAAA", purpose: "cert-request", msg: "" }); } catch (x: any) { e2 = String(x?.message ?? x); }
      ok(/not a daily purpose/.test(e2), "the Swift helper signs no daily purpose but entries (cert-request refused)", e2); }
    { let e3 = ""; try { await soft.call({ op: "sign", blob: "AAAA", purpose: "cert-request", msg: "" }); } catch (x: any) { e3 = String(x?.message ?? x); }
      ok(/not a daily purpose/.test(e3), "the stand-in signs no daily purpose but entries (cert-request refused)", e3); }
    swift.close(); soft.close();
  }
}
// opt-in, on a Mac with a Secure Enclave: the real thing (Touch ID or the login password will be asked)
if (process.env.CREW_LAN_REAL_SE === "1") { console.log("  ...   real Secure Enclave: answer the prompts"); await contract("enclave"); }
else console.log("  skip  real Secure Enclave (opt in with CREW_LAN_REAL_SE=1 on a Mac; it asks for Touch ID or the password)");

console.log(`\nlan-keys: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
