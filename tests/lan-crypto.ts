import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Board-to-board work, protocol 2: the primitives and the peer listener (docs/units/lan-relay.md). Sealed boxes open only
// for their recipients' daily key agreement keys, signatures carry a purpose, the fingerprint is at least 80 bits, the
// Noise KK and XX handshakes over a static key whose private half may live in the Secure Enclave, an introduction that
// carries each side's certificate inside the hashed handshake, and the listener's gates: an unintroduced key, a browser
// request (Origin, Sec-Fetch, Cookie), a foreign Host, a replayed message, a skewed clock, protocol 1 and an
// introduction while the window is closed are all refused.                                     bun tests/lan-crypto.ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { b64u, canonical, fingerprint, generateKeyPair, open, sas, seal, sign, softStatic, unb64u, verify } from "../src/lan/crypto";
import { certHash, openKeystore, staticOf, type Keystore } from "../src/lan/keystore";
import { Handshake } from "../src/lan/noise";
import { entryHash, envelopeProblem, makeEnvelope, readBody, verifyEnvelope, cleanText } from "../src/lan/protocol";
import { LanWire, call, introduce, peerTargetProblem, type Me } from "../src/lan/wire";
import { sleep, suite } from "./rt-harness";
const { ok, end } = suite("lan-crypto");

const ks = async (n: string) => (await openKeystore(mkdtempSync(join(tmpdir(), `crew-lan-c-${n}-`)), { create: true, kind: "file" })).ks!;
const A = await ks("a"), B = await ks("b"), C = await ks("c");
const me = (k: Keystore): Me => ({ key: k.key, cert: k.cert, s: staticOf(k), storage: "file" });
const rec = (k: Keystore) => ({ id: k.key, dh: k.dhPub }), reader = (k: Keystore) => ({ id: k.key, dh: staticOf(k) });
const author = (k: Keystore) => ({ key: k.key, certHash: certHash(k.cert), dhPub: k.dhPub, sign: (p: "entry", m: Uint8Array) => k.sign(p, m) });
const allow = (...k: Keystore[]) => k.map((x) => ({ id: x.key, dh: b64u(x.dhPub) }));

{ const box = seal(Buffer.from("secret briefing"), [rec(B)], "blob");
  ok((await open(box, reader(B), "blob"))?.toString() === "secret briefing", "a sealed box opens for its recipient's daily key agreement key");
  ok(await open(box, reader(C), "blob") === null, "a sealed box does not open for anyone else");
  ok(await open(box, reader(B), "entry") === null, "a box sealed for one purpose does not open for another");
  ok(await open(box, { id: C.key, dh: staticOf(B) }, "blob") === null, "a box names its recipient's identity: B's key under another name does not open it");
  const t = JSON.parse(JSON.stringify(box)); t.ct = b64u(Buffer.from(Buffer.from(t.ct, "base64url").map((x, i) => i === 3 ? x ^ 1 : x)));
  ok(await open(t, reader(B), "blob") === null, "a tampered box does not open"); }
{ const K = generateKeyPair(), L = generateKeyPair(), s = sign(K, "entry", Buffer.from("x"));
  ok(verify(K.pub, "entry", Buffer.from("x"), s) && !verify(K.pub, "other", Buffer.from("x"), s) && !verify(L.pub, "entry", Buffer.from("x"), s), "a signature verifies only for its key and its purpose"); }
{ const f = fingerprint(A.identity); const digits = f.replace(/\D/g, "");
  ok(/^\d{5}( \d{5}){5}$/.test(f) && digits.length * Math.log2(10) >= 80, "the fingerprint is six groups of five digits (about 99.7 bits, at least 80)", f);
  ok(fingerprint(A.identity) !== fingerprint(B.identity) && A.fingerprint === fingerprint(A.identity), "two identities have different fingerprints; an identity's fingerprint is its admin key's"); }
{ // Noise KK both ways, XX with key discovery, over static keys whose DH is asynchronous
  const sa = staticOf(A), sb = staticOf(B), sc = staticOf(C);
  const i = new Handshake("KK", true, sa, B.dhPub), r = new Handshake("KK", false, sb, A.dhPub);
  const p1 = await r.readMessage(await i.writeMessage(Buffer.from("hello"))); const p2 = await i.readMessage(await r.writeMessage(Buffer.from("world")));
  ok(p1.toString() === "hello" && p2.toString() === "world" && i.hash.equals(r.hash), "KK: both sides authenticate and agree on the handshake hash");
  const wrong = new Handshake("KK", false, sb, C.dhPub); let threw = false; try { await wrong.readMessage(await new Handshake("KK", true, sa, B.dhPub).writeMessage(Buffer.from("x"))); } catch { threw = true; }
  ok(threw, "KK: a responder expecting another key cannot read the message");
  const xi = new Handshake("XX", true, sa), xr = new Handshake("XX", false, sc);
  await xr.readMessage(await xi.writeMessage(Buffer.alloc(0))); await xi.readMessage(await xr.writeMessage(Buffer.from("m2"))); await xr.readMessage(await xi.writeMessage(Buffer.from("m3")));
  ok(b64u(xi.rs!) === b64u(C.dhPub) && b64u(xr.rs!) === b64u(A.dhPub) && xi.hash.equals(xr.hash), "XX: each side learns the other's static key; hashes agree");
  const s1 = xi.split(), s2 = xr.split(); ok(s2.recv.decrypt(Buffer.alloc(0), s1.send.encrypt(Buffer.alloc(0), Buffer.from("t"))).toString() === "t", "XX: transport keys work");
  const soft = generateKeyPair(), k1 = new Handshake("KK", true, softStatic(soft), B.dhPub); ok((await k1.writeMessage(Buffer.from("x"))).length > 65, "a software static key works the same way (the file keystore)"); }
{ // envelopes: protocol 2, signed by the daily signing key the named certificate binds
  const e = await makeEnvelope(author(A), 1, null, [rec(B)], { kind: "done", thread: "thread-0001", round: 1, result: "a".repeat(64) });
  ok(!envelopeProblem(e) && e.v === 2 && e.a === A.key && e.c === certHash(A.cert) && verifyEnvelope(e, A.signPub), "an envelope names its author's identity and certificate, and its signature verifies with the certified daily key");
  ok(!verifyEnvelope(e, A.identity), "an entry's signature is the daily key's, never the admin key's");
  const t = { ...e, seq: 2 }; ok(!verifyEnvelope(t as any, A.signPub), "changing any signed field breaks the signature");
  const rb = await readBody(e, reader(B)); ok("body" in rb && rb.body.kind === "done", "the recipient reads the body");
  ok("problem" in await readBody(e, reader(C)), "a non-recipient cannot read the body");
  ok(entryHash(e) === entryHash(JSON.parse(JSON.stringify(e))), "the entry hash is canonical");
  ok(envelopeProblem({ ...e, v: 1 }) === "not an entry", "a protocol 1 entry is refused (no fallback)"); }
{ ok(cleanText("a‮b​c\u0007d", 100) === "a⟦U+202E⟧b⟦U+200B⟧cd", "bidi overrides and zero-width characters are shown, control characters dropped", cleanText("a‮b​c\u0007d", 100)); }
{ // the address guard: loopback only for the demo, never metadata, link-local, public or tailnet
  const saved = process.env.CREW_LAN_ALLOW_LOOPBACK; delete process.env.CREW_LAN_ALLOW_LOOPBACK;
  ok(!!peerTargetProblem("127.0.0.1", 7417) && !!peerTargetProblem("169.254.169.254", 80) && !!peerTargetProblem("8.8.8.8", 443) && !!peerTargetProblem("100.100.100.200", 80) && !!peerTargetProblem("my-mac.local", 7417) && !!peerTargetProblem("224.0.0.251", 5353),
    "the peer address guard refuses loopback, metadata, link-local, public, tailnet, multicast addresses and names");
  process.env.CREW_LAN_ALLOW_LOOPBACK = "1"; ok(peerTargetProblem("127.0.0.1", 7417) === null, "loopback is allowed only in the demo/test mode (CREW_LAN_ALLOW_LOOPBACK=1)");
  ok(!!peerTargetProblem("169.254.169.254", 80), "even then, metadata stays refused");
  if (saved === undefined) delete process.env.CREW_LAN_ALLOW_LOOPBACK; else process.env.CREW_LAN_ALLOW_LOOPBACK = saved; }

// the listener
process.env.CREW_LAN_ALLOW_LOOPBACK = "1";
const seen: string[] = []; let introOpen = false; const introduced: any[] = [];
const wireB = new LanWire({ me: () => me(B), allowlist: () => allow(A), introOpen: () => introOpen, self: () => ({ name: "B's Mac", port: wireB.port }),
  request: async (from, op) => { seen.push(`${from === A.key ? "A" : "?"}:${op}`); return { pong: true }; }, introduced: (r) => introduced.push(r) });
wireB.start("127.0.0.1", 0);
const peerB = { key: B.key, dh: b64u(B.dhPub), host: "127.0.0.1", port: wireB.port };
const kkMessage = async (from: Keystore, to: Keystore, v: unknown) => { const hs = new Handshake("KK", true, staticOf(from), to.dhPub); return { hs, m1: await hs.writeMessage(Buffer.from(JSON.stringify(v))) }; };
{ const r = await call(me(A), peerB, "ping", {}); ok(r?.pong === true && seen.includes("A:ping"), "an allowlisted identity's request is answered over KK"); }
{ let err: any = null; try { await call(me(C), peerB, "ping", {}); } catch (e: any) { err = e; }
  ok(err?.code === "unknown" && !seen.some((s) => s.startsWith("?")), "an unintroduced key gets a bare 403 (the client says the peer does not recognise it) and never reaches a handler", String(err?.message)); }
{ let err: any = null; try { await call(me(A), peerB, "ping", {}, { v: 1 }); } catch (e: any) { err = e; }
  ok(err?.code === "version", "an authenticated request of another protocol version is refused, encrypted, with code version (no fallback)", String(err?.message)); }
{ const { hs, m1 } = await kkMessage(A, B, { v: 2, op: "ping", ts: "not a date", body: {} });
  const r = await fetch(`http://127.0.0.1:${wireB.port}/lan/v2/kk`, { method: "POST", body: m1, headers: { "content-type": "application/octet-stream" } });
  const reply = JSON.parse((await hs.readMessage(Buffer.from(await r.arrayBuffer()))).toString());
  ok(r.status === 200 && reply.ok === false && reply.code === "skew", "a request whose time is not a date is refused after it authenticated: encrypted, code skew", JSON.stringify(reply)); }
{ const { m1 } = await kkMessage(A, B, { v: 2, op: "ping", ts: new Date().toISOString(), body: {} });
  const post = (headers: Record<string, string>, path = "/lan/v2/kk", body: Uint8Array = m1) => fetch(`http://127.0.0.1:${wireB.port}${path}`, { method: "POST", body, headers: { "content-type": "application/octet-stream", ...headers } });
  ok((await post({ origin: "http://evil.example" })).status === 403, "a request with an Origin header (a browser) is refused");
  ok((await post({ "sec-fetch-site": "cross-site" })).status === 403, "a request with Sec-Fetch-* headers is refused");
  ok((await post({ cookie: "crew_session=1" })).status === 403, "a request with a Cookie is refused");
  ok((await post({ "content-type": "text/plain" })).status === 415, "a simple-request content type (text/plain, what a page can send without preflight) is refused");
  ok((await post({}, "/lan/v1/kk")).status === 404, "the protocol 1 routes are gone");
  const r = await fetch(`http://127.0.0.1:${wireB.port}/lan/v2/kk`, { method: "POST", body: m1, headers: { "content-type": "application/octet-stream", host: "evil.example" } });
  ok(r.status === 421, "a foreign Host (DNS rebinding) is refused", String(r.status));
  ok(!r.headers.has("access-control-allow-origin"), "no CORS header is ever sent");
  ok((await fetch(`http://127.0.0.1:${wireB.port}/api/wruns`)).status === 404, "the listener serves none of Studio's routes");
  const n0 = seen.length, first = await post({}); ok(first.status === 200 && seen.length === n0 + 1, "the plain message is answered once");
  const again = await post({}); ok(again.status === 200 && seen.length === n0 + 1, "the same message again (a replay) never reaches a handler: its encrypted answer says replay"); }
{ let err = ""; try { await introduce(me(A), "127.0.0.1", wireB.port, { name: "A", port: 1 }); } catch (e: any) { err = e.message; }
  ok(/403/.test(err) && !introduced.length, "an introduction is refused while the window is closed"); }
{ introOpen = true; const r = await introduce(me(C), "127.0.0.1", wireB.port, { name: "C's Mac", port: 5555 });
  ok(introduced.length === 1 && introduced[0].sas === r.sas && /^\d{6}$/.test(r.sas) && introduced[0].key === C.key && r.key === B.key, "an introduction gives both sides the same 6-digit code and each other's identity", `${r.sas} ${introduced[0]?.sas}`);
  ok(certHash(introduced[0].cert) === certHash(C.cert) && certHash(r.cert) === certHash(B.cert), "each side receives the other's certificate (its admin key and both daily keys), inside the hashed handshake");
  ok(introduced[0].port === 5555 && introduced[0].claimed === "C's Mac" && introduced[0].storage === "file", "the responder records the introducer's callback port, its self-described name and its claimed keystore"); }
{ // a certificate that does not bind the Noise key it came with is refused (someone else's certificate)
  introOpen = true; const n = introduced.length; let err = "";
  try { await introduce({ ...me(C), cert: A.cert }, "127.0.0.1", wireB.port, { name: "forger", port: 5556 }); } catch (e: any) { err = e.message; }
  ok(introduced.length === n && /403|certificate/.test(err), "an introduction whose certificate does not bind its static key is refused", err); }
{ ok(sas(Buffer.alloc(32, 1), Buffer.alloc(32, 2), Buffer.alloc(32, 3)) !== sas(Buffer.alloc(32, 1), Buffer.alloc(32, 2), Buffer.alloc(32, 4)), "the short code depends on both nonces"); }
wireB.stop();
{ const gate = { open: null as null | (() => void) };
  // the replay cache is memory only (every operation is idempotent: tests/lan-store.ts sends each one twice): within a
  // listener's life a replay is refused; after a restart it reaches the relay, which changes nothing for it
  let handled = 0;
  const mk = () => new LanWire({ me: () => me(B), allowlist: () => allow(A), introOpen: () => false, self: () => ({ name: "B", port: 1 }), introduced: () => {}, request: async () => { handled++; return { ok: true }; } });
  const w = mk(); w.start("127.0.0.1", 0);
  const { m1 } = await kkMessage(A, B, { v: 2, op: "ping", ts: new Date().toISOString(), body: {} });
  const post = (port: number) => fetch(`http://127.0.0.1:${port}/lan/v2/kk`, { method: "POST", body: m1, headers: { "content-type": "application/octet-stream" } });
  await post(w.port); w.stop();
  const w2 = mk(); w2.start("127.0.0.1", 0); await post(w2.port); await post(w2.port);
  ok(handled === 2, "the replay cache is memory only: after a restart a replay reaches the (idempotent) relay once; a second one is refused", String(handled));
  // at most 32 requests in flight; the rest are refused at once
  const w3 = new LanWire({ me: () => me(B), allowlist: () => allow(A), introOpen: () => false, self: () => ({ name: "B", port: 1 }), introduced: () => {},
    request: async (_f, op) => { if (op === "hold") await new Promise<void>((res) => { const prev = gate.open; gate.open = () => { prev?.(); res(); }; }); return { ok: true }; } });
  w3.start("127.0.0.1", 0); const p3 = { key: B.key, dh: b64u(B.dhPub), host: "127.0.0.1", port: w3.port };
  const many = Array.from({ length: 40 }, () => call(me(A), p3, "hold", {}).then(() => "ok", (e) => String(e.message)));
  await sleep(1500); gate.open?.(); const res = await Promise.all(many);
  ok(res.filter((x) => /503/.test(x)).length === 8 && res.filter((x) => x === "ok").length === 32, "at most 32 requests are in flight at once; the rest are refused (503)", JSON.stringify(res.reduce((m: any, x) => { m[x] = (m[x] ?? 0) + 1; return m; }, {})));
  // a bounded rate table: thousands of source addresses do not grow it without end
  const req = () => new Request(`http://127.0.0.1:${w3.port}/x`, { method: "POST" });
  let last = 0; for (let i = 0; i < 4097; i++) last = (await w3.handle(req(), `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`)).status;
  ok(last === 429, "the per-address rate table is bounded: past 4096 fresh addresses a new one is refused", String(last));
  w2.stop(); w3.stop(); }
{ const { gateways } = await import("../src/lan/wire"); const gw = gateways()[0];
  if (gw) { const saved = process.env.CREW_LAN_ALLOW_LOOPBACK; delete process.env.CREW_LAN_ALLOW_LOOPBACK; const why = peerTargetProblem(gw, 7417); if (saved !== undefined) process.env.CREW_LAN_ALLOW_LOOPBACK = saved;
    ok(/gateway/.test(why ?? ""), "the network's gateway is never a peer", String(why)); }
  else ok(true, "no default gateway on this machine: the gateway refusal is not exercised here"); }
void canonical; void unb64u;
end();
