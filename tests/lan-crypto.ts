import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Board-to-board work, the primitives and the peer listener (docs/units/lan-relay.md): sealed boxes open only for their
// recipients, signatures carry a purpose, the fingerprint is at least 80 bits, the Noise KK and XX handshakes, and the
// listener's gates: an unintroduced key, a browser request (Origin, Sec-Fetch, Cookie), a foreign Host, a replayed
// message and an introduction while the window is closed are all refused.     bun tests/lan-crypto.ts
import { b64u, fingerprint, generateKeyPair, open, sas, seal, sign, verify } from "../src/lan/crypto";
import { Handshake } from "../src/lan/noise";
import { entryHash, envelopeProblem, makeEnvelope, readBody, verifyEnvelope, cleanText } from "../src/lan/protocol";
import { LanWire, call, introduce, peerTargetProblem } from "../src/lan/wire";
import { suite } from "./rt-harness";
const { ok, end } = suite("lan-crypto");

const A = generateKeyPair(), B = generateKeyPair(), C = generateKeyPair();
{ const box = seal(Buffer.from("secret briefing"), [B.pub], "blob");
  ok(open(box, B, "blob")?.toString() === "secret briefing", "a sealed box opens for its recipient");
  ok(open(box, C, "blob") === null, "a sealed box does not open for anyone else");
  ok(open(box, B, "entry") === null, "a box sealed for one purpose does not open for another");
  const t = JSON.parse(JSON.stringify(box)); t.ct = b64u(Buffer.from(Buffer.from(t.ct, "base64url").map((x, i) => i === 3 ? x ^ 1 : x)));
  ok(open(t, B, "blob") === null, "a tampered box does not open"); }
{ const s = sign(A, "entry", Buffer.from("x"));
  ok(verify(A.pub, "entry", Buffer.from("x"), s) && !verify(A.pub, "other", Buffer.from("x"), s) && !verify(B.pub, "entry", Buffer.from("x"), s), "a signature verifies only for its key and its purpose"); }
{ const f = fingerprint(A.pub); const digits = f.replace(/\D/g, "");
  ok(/^\d{5}( \d{5}){5}$/.test(f) && digits.length * Math.log2(10) >= 80, "the fingerprint is six groups of five digits (about 99.7 bits, at least 80)", f);
  ok(fingerprint(A.pub) !== fingerprint(B.pub), "two keys have different fingerprints"); }
{ // Noise KK both ways, XX with key discovery
  const i = new Handshake("KK", true, A, B.pub), r = new Handshake("KK", false, B, A.pub);
  const p1 = r.readMessage(i.writeMessage(Buffer.from("hello"))); const p2 = i.readMessage(r.writeMessage(Buffer.from("world")));
  ok(p1.toString() === "hello" && p2.toString() === "world" && i.hash.equals(r.hash), "KK: both sides authenticate and agree on the handshake hash");
  const wrong = new Handshake("KK", false, B, C.pub); let threw = false; try { wrong.readMessage(new Handshake("KK", true, A, B.pub).writeMessage(Buffer.from("x"))); } catch { threw = true; }
  ok(threw, "KK: a responder expecting another key cannot read the message");
  const xi = new Handshake("XX", true, A), xr = new Handshake("XX", false, B);
  xr.readMessage(xi.writeMessage(Buffer.alloc(0))); xi.readMessage(xr.writeMessage(Buffer.from("m2"))); xr.readMessage(xi.writeMessage(Buffer.from("m3")));
  ok(b64u(xi.rs!) === b64u(B.pub) && b64u(xr.rs!) === b64u(A.pub) && xi.hash.equals(xr.hash), "XX: each side learns the other's static key; hashes agree");
  const s1 = xi.split(), s2 = xr.split(); ok(s2.recv.decrypt(Buffer.alloc(0), s1.send.encrypt(Buffer.alloc(0), Buffer.from("t"))).toString() === "t", "XX: transport keys work"); }
{ // envelopes
  const e = makeEnvelope(A, 1, null, [b64u(B.pub)], { kind: "done", thread: "thread-0001", round: 1, result: "a".repeat(64) });
  ok(!envelopeProblem(e) && verifyEnvelope(e), "an envelope is well formed and its signature verifies");
  const t = { ...e, seq: 2 }; ok(!verifyEnvelope(t as any), "changing any signed field breaks the signature");
  const rb = readBody(e, B); ok("body" in rb && rb.body.kind === "done", "the recipient reads the body");
  ok("problem" in readBody(e, C), "a non-recipient cannot read the body");
  ok(entryHash(e) === entryHash(JSON.parse(JSON.stringify(e))), "the entry hash is canonical"); }
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
const wireB = new LanWire({ me: () => B, allowlist: () => [b64u(A.pub)], introOpen: () => introOpen, self: () => ({ name: "B's Mac", port: wireB.port }),
  request: async (from, op) => { seen.push(`${from === b64u(A.pub) ? "A" : "?"}:${op}`); return { pong: true }; }, introduced: (r) => introduced.push(r) });
wireB.start("127.0.0.1", 0);
const peerB = { key: b64u(B.pub), host: "127.0.0.1", port: wireB.port };
{ const r = await call(A, peerB, "ping", {}); ok(r?.pong === true && seen.includes("A:ping"), "an allowlisted key's request is answered over KK"); }
{ let err = ""; try { await call(C, peerB, "ping", {}); } catch (e: any) { err = e.message; }
  ok(/403/.test(err) && !seen.some((s) => s.startsWith("?")), "an unintroduced key is refused (403) and never reaches a handler", err); }
{ const hs = new Handshake("KK", true, A, B.pub); const m1 = hs.writeMessage(Buffer.from(JSON.stringify({ v: 1, op: "ping", ts: new Date().toISOString(), body: {} })));
  const post = (headers: Record<string, string>, path = "/lan/v1/kk", body: Uint8Array = m1) => fetch(`http://127.0.0.1:${wireB.port}${path}`, { method: "POST", body, headers: { "content-type": "application/octet-stream", ...headers } });
  ok((await post({ origin: "http://evil.example" })).status === 403, "a request with an Origin header (a browser) is refused");
  ok((await post({ "sec-fetch-site": "cross-site" })).status === 403, "a request with Sec-Fetch-* headers is refused");
  ok((await post({ cookie: "crew_session=1" })).status === 403, "a request with a Cookie is refused");
  ok((await post({ "content-type": "text/plain" })).status === 415, "a simple-request content type (text/plain, what a page can send without preflight) is refused");
  const r = await fetch(`http://127.0.0.1:${wireB.port}/lan/v1/kk`, { method: "POST", body: m1, headers: { "content-type": "application/octet-stream", host: "evil.example" } });
  ok(r.status === 421, "a foreign Host (DNS rebinding) is refused", String(r.status));
  ok(!r.headers.has("access-control-allow-origin"), "no CORS header is ever sent");
  ok((await fetch(`http://127.0.0.1:${wireB.port}/api/wruns`)).status === 404, "the listener serves none of Studio's routes");
  const first = await post({}); ok(first.status === 200, "the plain message is answered once");
  ok((await post({})).status === 403, "the same message again (a replay) is refused"); }
{ let err = ""; try { await introduce(A, "127.0.0.1", wireB.port, { name: "A", port: 1 }); } catch (e: any) { err = e.message; }
  ok(/403/.test(err) && !introduced.length, "an introduction is refused while the window is closed"); }
{ introOpen = true; const r = await introduce(C, "127.0.0.1", wireB.port, { name: "C's Mac", port: 5555 });
  ok(introduced.length === 1 && introduced[0].sas === r.sas && /^\d{6}$/.test(r.sas) && introduced[0].key === b64u(C.pub) && r.key === b64u(B.pub), "an introduction gives both sides the same 6-digit code and each other's full key", `${r.sas} ${introduced[0]?.sas}`);
  ok(introduced[0].port === 5555 && introduced[0].claimed === "C's Mac", "the responder records the introducer's callback port and its self-described name"); }
{ ok(sas(Buffer.alloc(32, 1), Buffer.alloc(32, 2), Buffer.alloc(32, 3)) !== sas(Buffer.alloc(32, 1), Buffer.alloc(32, 2), Buffer.alloc(32, 4)), "the short code depends on both nonces"); }
wireB.stop();
end();
