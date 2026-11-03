import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// A Studio's identity and what happens when it changes (docs/units/lan-relay.md, Identity): the identity is the admin
// key, which signs every introduction (the allowlist holds only peers it vouched for), a revocation and a successor; a
// peer that revokes its identity is frozen at its last vouched entry and its successor is trusted only after an
// introduction in person; a lost Mac's identity is replaced in person, at the short code. Runs on the soft-enclave
// stand-in (the Secure Enclave helper's protocol over software keys) so every admin signature is a counted "prompt".
//                                                                                              bun tests/lan-identity.ts
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { b64u, randomBytes } from "../src/lan/crypto";
import { openKeystore, staticOf, certHash } from "../src/lan/keystore";
import { makeEnvelope, type Body } from "../src/lan/protocol";
import { Lan, type LanRunner } from "../src/lan/relay";
import { call } from "../src/lan/wire";

process.env.CREW_LAN_ALLOW_LOOPBACK = "1";
const prompts = join(mkdtempSync(join(tmpdir(), "crew-lan-id-prompts-")), "prompts.txt"), deny = join(mkdtempSync(join(tmpdir(), "crew-lan-id-deny-")), "deny");
process.env.CREW_SOFT_ENCLAVE_PROMPTS = prompts; process.env.CREW_SOFT_ENCLAVE_DENY = deny;
const promptLines = () => (existsSync(prompts) ? readFileSync(prompts, "utf8").trim().split("\n").filter(Boolean) : []);
let pass = 0, fail = 0;
const ok = (c: unknown, what: string, detail = "") => { if (c) { pass++; console.log(`  ok    ${what}`); } else { fail++; console.log(`  FAIL  ${what}${detail ? `\n        ${detail}` : ""}`); } };
const until = async (f: () => boolean, ms = 8000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) return false; await Bun.sleep(25); } return true; };
const runner = (): LanRunner => ({ workflows: () => [{ id: "documents", version: 1, name: "Documents", defHash: "a".repeat(64), eligible: true, why: [], notRun: [], staffing: null }],
  start: async () => ({ run: `R-${Math.floor(Math.random() * 1e6)}`, workflow: { id: "documents", version: 1, defHash: "a".repeat(64) } }), status: () => ({ state: "running", result: null, spent: { usd: 0, rounds: 0 }, stopped: null }), output: async () => { throw new Error("no"); }, cancel: () => {} });
const mk = (name: string, dir?: string) => Lan.open({ dataDir: dir ?? mkdtempSync(join(tmpdir(), `crew-lan-id-${name}-`)), runner: runner(), bind: "127.0.0.1", port: 0, keystore: "soft-enclave" });
const meOf = (x: Lan) => (x as any).me(), peerOf = (x: Lan) => ({ key: x.id.key, dh: b64u((x as any).ks.dhPub), host: "127.0.0.1", port: x.wire.port });
const st = (x: Lan) => (x as any).st;
async function pairUp(A: Lan, B: Lan, o: { replaces?: string } = {}) { B.openIntro(1); const ia = await A.startIntro("127.0.0.1", B.wire.port); const ib = B.view().intros.find((i: any) => i.key === A.id.key); await A.confirmIntro(ia.id, ib.sas, "B"); await B.confirmIntro(ib.id, ia.sas, "A", { replaces: o.replaces }); return { ia, ib }; }

// 1. an introduction is signed by the admin key (one prompt per side, naming the other's fingerprint); a cancelled prompt adds nobody
{ const A = await mk("a"), B = await mk("b"); A.setEnabled(true); B.setEnabled(true);
  const before = promptLines().length; await pairUp(A, B); const lines = promptLines().slice(before);
  ok(lines.length === 2 && lines.some((l) => l.includes(B.id.fingerprint)) && lines.some((l) => l.includes(A.id.fingerprint)), "each side's admin key signs the introduction once, and the prompt names the other side's fingerprint (built from the fields)", JSON.stringify(lines));
  const C = await mk("c"); C.setEnabled(true); B.openIntro(1); const ic = await C.startIntro("127.0.0.1", B.wire.port); const ib = B.view().intros.find((i: any) => i.key === C.id.key);
  writeFileSync(deny, ""); let e = ""; try { await B.confirmIntro(ib.id, ic.sas, "C"); } catch (x: any) { e = String(x?.code ?? x?.message); } Bun.spawnSync(["rm", deny]);
  ok(e === "admin" && !B.peer(C.id.key), "an introduction whose admin signature the person cancels adds nobody", e);
  // 2. the allowlist holds only peers this Studio vouched for: a peer written into the state without a person's admin signature is not on it
  st(B).peers.push({ ...st(B).peers[0], key: C.id.key, fp: C.id.fingerprint, petname: "smuggled", certs: [(C as any).ks.cert], vouch: null, state: "trusted" });
  let e2 = ""; try { await call(meOf(C), peerOf(B), "ping", {}); } catch (x: any) { e2 = String(x?.code); }
  ok(e2 === "unknown" && !B.view().peers.find((p: any) => p.key === C.id.key)?.vouched, "a peer added to the state without this Studio's admin signature is not on the allowlist (a same-user edit is a tripwire, not a pairing)", e2);
  st(B).peers = st(B).peers.filter((p: any) => p.key !== C.id.key);
  A.close(); B.close(); C.close(); }

// 3. 作廢並換新身分: the old identity's revocation reaches the peer (signed by both admin keys), the peer freezes it at its
//    last vouched entry, refuses anything after it, shows the notice; the successor is trusted only after the code
{ const A = await mk("ra"), B = await mk("rb"); A.setEnabled(true); B.setEnabled(true); await pairUp(A, B);
  const t = await A.dispatch({ to: B.id.key, title: "before", briefing: "work before the change" }); await A.flush(); await until(() => B.view().items.length === 1);
  const old = A.id.key, oldDir = (A as any).o.dataDir, lastSeq = st(A).logs[old].seq, before = promptLines().length;
  writeFileSync(join(oldDir, "lan", "identity.key"), "a protocol 1 key left behind\n", { mode: 0o600 });
  await A.retireIdentity();
  ok(!existsSync(join(oldDir, "lan", "identity.key")), "retiring the identity also overwrites and removes a protocol 1 key left in lan/identity.key"); await A.flushIds(); await until(() => B.peer(old)?.state === "retired");
  const pb = B.view().peers.find((p: any) => p.key === old), lines = promptLines().slice(before);
  ok(A.id.key !== old && lines.length === 3, "retiring makes a new identity (its certificate signed) and signs the revocation with the old admin key and the successor with the new one: three prompts", JSON.stringify(lines));
  ok(pb?.state === "retired" && pb?.retired?.lastSeq === lastSeq && /換了身分/.test(pb?.notice?.zh ?? "") && pb?.retired?.successor?.key === A.id.key && pb?.retired?.successor?.certified === true,
    "the peer freezes the old identity at its last vouched entry, says it changed identity, and names the certified successor", JSON.stringify(pb?.retired));
  ok(B.thread(t.id)?.state === "closed" && A.thread(t.id)?.state === "closed", "open threads close on both sides (they are never moved to the new identity)", `${B.thread(t.id)?.state} ${A.thread(t.id)?.state}`);
  // a stolen daily key signing after the cut-off (the old keys are still on disk until the revocation was delivered, then deleted)
  ok(!existsSync(join(oldDir, "lan", "retired")) || !require("node:fs").readdirSync(join(oldDir, "lan", "retired")).length, "once the revocation reached every peer, the old identity's key files are overwritten and removed");
  const forged = await openKeystore(mkdtempSync(join(tmpdir(), "crew-lan-id-forger-")), { create: true, kind: "file" });
  let e = ""; try { await call({ key: old, cert: forged.ks!.cert, s: staticOf(forged.ks!), storage: "file" }, peerOf(B), "ping", {}); } catch (x: any) { e = String(x?.code); }
  ok(e === "unknown", "the retired identity is off the allowlist: nothing more is exchanged with it", e);
  ok(!B.view().peers.some((p: any) => p.key === A.id.key && p.state === "trusted"), "the successor is not trusted from the revocation alone");
  // the new identity introduces itself in person: labelled certified successor, and the work goes on with it
  B.openIntro(1); const ia = await A.startIntro("127.0.0.1", B.wire.port); const ib = B.view().intros.find((i: any) => i.key === A.id.key);
  ok(ib?.successorOf?.[0]?.key === old && ib.successorOf[0].certified === true, "its introduction is labelled the certified successor of the old identity (still confirmed with the code)", JSON.stringify(ib?.successorOf));
  await A.confirmIntro(ia.id, ib.sas, "B"); await B.confirmIntro(ib.id, ia.sas, "A again", { replaces: old, keepName: false });
  const t2 = await A.dispatch({ to: B.id.key, title: "after", briefing: "work after the change" }); await A.flush();
  ok(await until(() => B.view().items.some((i: any) => i.thread === t2.id)), "after the new introduction, work goes on with the new identity");
  ok(B.peer(old)?.state === "revoked" && B.peer(old)?.replacedBy === A.id.key && B.auditView().rows.some((r) => r.what === "replace") && B.auditView().rows.some((r) => r.what === "peer-retired"), "the old identity is revoked for good once replaced, and the audit records the revocation and the replacement");
  A.close(); B.close(); }

// 4. a revocation not signed by the identity's admin key is refused; a forged successor is not certified
{ const A = await mk("fa"), B = await mk("fb"); A.setEnabled(true); B.setEnabled(true); await pairUp(A, B);
  const other = (await openKeystore(mkdtempSync(join(tmpdir(), "crew-lan-id-other-")), { create: true, kind: "file" })).ks!, at = new Date().toISOString();
  const sig = b64u(await other.admin("revoke", [A.id.key, "1", "-", at]));
  let e = ""; try { await call(meOf(A), peerOf(B), "retire", { v: 2, id: A.id.key, lastSeq: 1, at, sig, successor: null }); } catch (x: any) { e = String(x?.message); }
  ok(/not signed/.test(e) && B.peer(A.id.key)?.state === "trusted", "a revocation not signed by the identity's own admin key is refused", e);
  const aks = (A as any).ks, real = b64u(await aks.admin("revoke", [A.id.key, "0", other.key, at]));
  await call(meOf(A), peerOf(B), "retire", { v: 2, id: A.id.key, lastSeq: 0, at, sig: real, successor: other.cert, ssig: b64u(randomBytes(64)) });
  ok(B.peer(A.id.key)?.state === "retired" && B.peer(A.id.key)?.retired?.successor?.certified === false, "a successor whose own admin key did not sign is named but not certified", JSON.stringify(B.peer(A.id.key)?.retired));
  A.close(); B.close(); }

// 5. a lost Mac: its owner cannot sign anything, so a peer replaces it in person (only at the code), and the old one is gone for good
{ const A = await mk("la"), B = await mk("lb"); A.setEnabled(true); B.setEnabled(true); await pairUp(A, B);
  const t = await A.dispatch({ to: B.id.key, title: "open work", briefing: "x" }); await A.flush(); await until(() => B.view().items.length === 1);
  const oldKey = A.id.key; A.close();
  const A2 = await mk("la2"); A2.setEnabled(true);
  B.openIntro(1); const ia = await A2.startIntro("127.0.0.1", B.wire.port); const ib = B.view().intros.find((i: any) => i.key === A2.id.key);
  ok(!ib.successorOf?.length, "a new identity that no revocation named carries no successor label (confirm in person)");
  await A2.confirmIntro(ia.id, ib.sas, "B"); await B.confirmIntro(ib.id, ia.sas, "A's new Mac", { replaces: oldKey, keepName: true });
  ok(B.peer(A2.id.key)?.petname === "A", "the replaced peer's name carries over only when chosen", B.peer(A2.id.key)?.petname);
  ok(B.peer(oldKey)?.state === "revoked" && B.thread(t.id)?.state === "closed" && B.view().items.every((i: any) => i.from.key !== oldKey) && B.peer(A2.id.key)?.replaces === oldKey,
    "replacing a peer at the code revokes the old identity for good, closes its threads and withdraws its items", JSON.stringify([B.peer(oldKey)?.state, B.thread(t.id)?.state]));
  let e = ""; try { await B.confirmIntro("nope", "000000", "x", { replaces: oldKey }); } catch (x: any) { e = String(x?.code); }
  ok(e === "intro", "a replacement happens only through an introduction's code (there is no other way to name one)", e);
  A2.close(); B.close(); }

// 6. a retired peer's result from before its cut-off can still be accepted; nothing new is exchanged
{ const A = await mk("xa"), B = await mk("xb"); A.setEnabled(true); B.setEnabled(true); await pairUp(A, B);
  const t = await B.dispatch({ to: A.id.key, title: "for A", briefing: "x" }); await B.flush(); await until(() => A.view().items.length === 1);
  await A.retireIdentity(); await A.flushIds(); await until(() => B.peer(st(A).retired[0]?.key ?? "")?.state === "retired" || B.view().peers.some((p: any) => p.state === "retired"));
  let e = ""; try { await B.dispatch({ to: (B.view().peers.find((p: any) => p.state === "retired") as any).key, title: "x", briefing: "x" }); } catch (x: any) { e = String(x?.message); }
  ok(/introduced/.test(e), "nothing new is dispatched to a retired identity", e); void t;
  A.close(); B.close(); }

void makeEnvelope; void certHash; void (null as unknown as Body);
// retiring an identity survives a crash at any point: before the database step it rolls back (the old identity stays,
// the half-made one is removed); after it, the next start finishes moving the key files (the new identity, its
// revocation queued). Never an identity loss.
for (const at of ["journal", "committed", "old-moved"] as const) {
  const A = await mk(`crash-${at}`), B = await mk(`crash-${at}-b`); A.setEnabled(true); B.setEnabled(true); await pairUp(A, B);
  const dir = (A as any).o.dataDir, old = A.id.key; (A as any).crashAt = (p: string) => { if (p === at) throw new Error(`crash at ${p}`); };
  let e = ""; try { await A.retireIdentity(); } catch (x: any) { e = String(x?.message ?? x); }
  (A as any).crashAt = null; A.close(); B.close();
  const again = await Lan.open({ dataDir: dir, runner: runner(), bind: "127.0.0.1", port: 0 }), st2: any = (again as any).st;
  const rolled = at === "journal", key = again.id.key;
  ok(/crash at/.test(e) && !again.lost && (rolled ? key === old && !st2.retired.length : key !== old && st2.retired.some((r: any) => r.key === old) && st2.idOut.some((x: any) => x.from === old)) && !existsSync(join(dir, "lan", "retire.pending.json")),
    `a crash ${rolled ? "before the retirement is committed rolls it back (the old identity stays)" : `after it is committed (${at}) is finished at the next start (the new identity, its revocation queued)`}: never an identity loss`, JSON.stringify([e, again.lost, key === old, st2.retired.length, st2.idOut.length]));
  again.close(); }
console.log(`\nlan-identity: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
