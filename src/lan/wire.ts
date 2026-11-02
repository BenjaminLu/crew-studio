// The peer listener and its client (docs/units/lan-relay.md). A listener of its own, on its own port, with its own server
// and a fixed table of four routes; it never reaches Studio's handle(req, …) routes, session, cookies or /api. Every
// request is a Noise message (src/lan/noise.ts) in an HTTP POST body:
//   POST /lan/v1/kk     a KK handshake carrying one request; the answer is the second KK message carrying the reply
//   POST /lan/v1/xx/1   an introduction: XX message 1 → a session id and XX message 2 (only while the window is open)
//   POST /lan/v1/xx/3   XX message 3 with the introducer's commitment → the responder's nonce (on the transport keys)
//   POST /lan/v1/xx/4   the introducer's revealed nonce → ok; both sides now hold the same short code
// Before any cryptography: the Host must be this listener's own address literal; a request carrying Origin, Referer,
// Cookie, Authorization or any Sec-Fetch-* header (a browser's) is refused; the body is application/octet-stream and at
// most 1 MiB; there are no CORS headers, so no page can read an answer, and a browser cannot produce the handshake
// anyway (it needs an allowlisted private key). Requests are rate-limited per source address, handshakes in flight are
// capped, and a KK message is accepted once (its ephemeral key is remembered) and only near this Mac's clock.
import { isIP } from "node:net";
import { networkInterfaces } from "node:os";
import { denial, localAddresses } from "../egress-guard";
import { b64u, canonical, randomBytes, sas, sha256, sha256hex, eq, unb64u, type KeyPair } from "./crypto";
import { Handshake, CipherState } from "./noise";

export const MAX_BODY = 1024 * 1024;
const SKEW_MS = 5 * 60_000, REPLAY_MS = 10 * 60_000, XX_TTL_MS = 20_000, RATE = { perMin: 240, addresses: 4096 }, MAX_IN_FLIGHT = 32;
const BROWSER_HEADERS = ["origin", "referer", "cookie", "authorization"];
export type Peer = { key: string; host: string; port: number };
export type IntroResult = { key: string; sas: string; claimed: string; host: string; port: number };
export type WireDeps = {
  me: () => KeyPair;
  /** the full keys this Studio exchanges with: introduced, not revoked */
  allowlist: () => string[];
  /** the captain opened the introduction window on the desktop */
  introOpen: () => boolean;
  /** this Studio's own description of itself during an introduction (its device name, its LAN port) */
  self: () => { name: string; port: number };
  /** one authenticated request from an allowlisted key */
  request: (from: string, op: string, body: unknown, ip: string) => Promise<unknown>;
  /** an introduction finished on this side (the responder); the captain still has to confirm the code */
  introduced: (r: IntroResult) => void;
  /** an introduction got this side's nonce and did not reveal a matching one (a wrong reveal, an abort, a timeout): it
   *  could have been an attempt to match a short code; the captain sees it, and three close the window */
  introFailed?: (ip: string, why: string) => void;
  /** the KK replay cache, kept across restarts (ephemeral key → when it was seen) */
  replay?: { load(): Record<string, number>; save(m: Record<string, number>): void };
  /** a refusal, for the Studio log and the tests (never the payload) */
  refused?: (why: string, ip: string) => void;
};

const bin = (b: Uint8Array, status = 200) => new Response(b, { status, headers: { "content-type": "application/octet-stream", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
const no = (status = 403) => new Response(null, { status, headers: { "cache-control": "no-store" } });
const json = (v: unknown) => Buffer.from(canonical(v));
const parse = (b: Buffer) => JSON.parse(b.toString("utf8"));

export class LanWire {
  private server: ReturnType<typeof Bun.serve> | null = null;
  private seenE = new Map<string, number>(); private inFlight = 0;
  private xx = new Map<string, { hs: Handshake; at: number; ip: string; stage: 2 | 3; tx?: { send: CipherState; recv: CipherState }; commit?: Buffer; nonce?: Buffer; claimed?: string; port?: number }>();
  private rate = new Map<string, { at: number; n: number }>();
  host = ""; port = 0;
  constructor(private readonly d: WireDeps) { try { for (const [k, v] of Object.entries(d.replay?.load() ?? {})) if (Date.now() - Number(v) < REPLAY_MS) this.seenE.set(k, Number(v)); } catch {} }
  get listening() { return !!this.server; }
  start(bind: string, port: number) {
    if (this.server) return;
    if (!isIP(bind)) throw new Error("the LAN listener binds an IP address literal");
    this.server = Bun.serve({ hostname: bind, port, maxRequestBodySize: MAX_BODY, idleTimeout: 15, fetch: (req, srv) => this.handle(req, srv?.requestIP(req)?.address ?? "") });
    this.host = bind; this.port = this.server.port!;
  }
  stop() { this.server?.stop(true); this.server = null; this.xx.clear(); }
  /** The Host this listener answers to: its own address literal and port, nothing else (DNS rebinding sends another name). */
  private hostOk(h: string | null) { const want = isIP(this.host) === 6 ? `[${this.host}]:${this.port}` : `${this.host}:${this.port}`; return (h ?? "").toLowerCase() === want; }
  private limited(ip: string) {
    const now = Date.now(), r = this.rate.get(ip);
    if (!r || now - r.at > 60_000) { if (this.rate.size >= RATE.addresses) { for (const [k, v] of this.rate) if (now - v.at > 60_000) this.rate.delete(k); if (this.rate.size >= RATE.addresses) return true; } this.rate.set(ip, { at: now, n: 1 }); return false; }
    return ++r.n > RATE.perMin;
  }
  private refuse(why: string, ip: string, status = 403) { this.d.refused?.(why, ip); return no(status); }
  async handle(req: Request, ip: string): Promise<Response> {
    if (this.inFlight >= MAX_IN_FLIGHT) return this.refuse("too many requests in flight", ip, 503);
    this.inFlight++;
    try { return await this.handleOne(req, ip); } finally { this.inFlight--; }
  }
  private async handleOne(req: Request, ip: string): Promise<Response> {
    const url = new URL(req.url), p = url.pathname;
    if (this.limited(ip)) return this.refuse("rate limit", ip, 429);
    if (req.method !== "POST" || !["/lan/v1/kk", "/lan/v1/xx/1", "/lan/v1/xx/3", "/lan/v1/xx/4"].includes(p) || url.search) return this.refuse("unknown route", ip, 404);
    if (!this.hostOk(req.headers.get("host"))) return this.refuse("unknown Host", ip, 421);
    for (const h of req.headers.keys()) if (BROWSER_HEADERS.includes(h) || h.startsWith("sec-fetch-")) return this.refuse(`a browser request (${h})`, ip);
    if ((req.headers.get("content-type") ?? "") !== "application/octet-stream") return this.refuse("not application/octet-stream", ip, 415);
    if (req.headers.get("transfer-encoding")) return this.refuse("chunked bodies are not accepted", ip, 411);
    const len = Number(req.headers.get("content-length") ?? NaN); if (!Number.isSafeInteger(len) || len < 1 || len > MAX_BODY) return this.refuse("body size", ip, 413);
    let body: Buffer; try { body = Buffer.from(await req.arrayBuffer()); } catch { return this.refuse("unreadable body", ip, 400); }
    if (body.length !== len) return this.refuse("body size", ip, 400);
    try {
      if (p === "/lan/v1/kk") return await this.kk(body, ip);
      return await this.intro(p, body, ip);
    } catch (e: any) { return this.refuse(`handshake failed: ${String(e?.message ?? e).slice(0, 80)}`, ip); }
  }
  private kkFails = new Map<string, { at: number; n: number; blocked?: number }>();
  /** the limiter's key: an IPv4 address, or an IPv6 address's /64 (a host may own all of it) */
  private kkKey(ip: string) {
    const a = ip.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, ""); if (!a.includes(":")) return a;
    const [h, t] = a.split("::"), head = h ? h.split(":") : [], tail = t !== undefined ? (t ? t.split(":") : []) : [];
    const groups = t === undefined ? head : [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill("0"), ...tail];
    return groups.slice(0, 4).map((g) => parseInt(g || "0", 16).toString(16)).join(":") + "::/64";
  }
  private async kk(m1: Buffer, ip: string): Promise<Response> {
    // an address that keeps sending messages no allowlisted key made is cut off before the key work (one DH per key)
    const now0 = Date.now(), key = this.kkKey(ip), f = this.kkFails.get(key);
    if (f?.blocked && now0 - f.blocked < 60_000) return this.refuse("too many unauthenticated messages", ip, 429);
    const me = this.d.me(); let hs: Handshake | null = null, from = "", req: any = null;
    // which allowlisted key made this message: only the holder of one of them can produce a payload that decrypts
    for (const k of this.d.allowlist()) {
      const t = new Handshake("KK", false, me, unb64u(k, 65));
      try { req = parse(t.readMessage(m1)); hs = t; from = k; break; } catch {}
    }
    if (!hs) {
      let g = this.kkFails.get(key);
      if (!g || (now0 - g.at >= 60_000 && !(g.blocked && now0 - g.blocked < 60_000))) {
        // a full table drops its oldest entries that hold no block (never a block it holds)
        if (this.kkFails.size >= RATE.addresses) for (const [k, v] of this.kkFails) { if (!(v.blocked && now0 - v.blocked < 60_000)) this.kkFails.delete(k); if (this.kkFails.size < RATE.addresses) break; }
        this.kkFails.delete(key); g = { at: now0, n: 0 }; this.kkFails.set(key, g);
      }
      if (++g.n >= 8 && !g.blocked) g.blocked = now0; // the minute starts at the eighth failure
      return this.refuse("not an introduced key", ip);
    }
    const e = b64u(hs.re!), now = Date.now();
    for (const [k, at] of this.seenE) if (now - at > REPLAY_MS) this.seenE.delete(k);
    if (this.seenE.has(e)) return this.refuse("replayed message", ip);
    this.seenE.set(e, now); try { this.d.replay?.save(Object.fromEntries(this.seenE)); } catch {}
    const ts = Date.parse(String(req?.ts));
    if (!req || req.v !== 1 || typeof req.op !== "string" || !Number.isFinite(ts) || Math.abs(ts - now) > SKEW_MS) return this.refuse("stale or malformed request", ip);
    let reply: unknown; try { reply = { ok: true, body: await this.d.request(from, req.op, req.body, ip) }; } catch (x: any) { reply = { ok: false, error: String(x?.message ?? x).slice(0, 300) }; }
    return bin(hs.writeMessage(json(reply)));
  }
  private async intro(p: string, body: Buffer, ip: string): Promise<Response> {
    const now = Date.now();
    for (const [k, s] of this.xx) if (now - s.at > XX_TTL_MS) { this.xx.delete(k); this.d.introFailed?.(s.ip, s.stage === 3 ? "it stopped after receiving this Studio's nonce" : "it stopped before sending its commitment, holding the only introduction slot"); }
    if (p === "/lan/v1/xx/1") {
      if (!this.d.introOpen()) return this.refuse("introductions are closed on this Studio", ip);
      if (this.xx.size >= 1) return this.refuse("another introduction is in progress", ip, 429); // one at a time
      const hs = new Handshake("XX", false, this.d.me()); hs.readMessage(body);
      const sid = randomBytes(16), m2 = hs.writeMessage(json({ v: 1 }));
      this.xx.set(sid.toString("hex"), { hs, at: now, ip, stage: 2 });
      return bin(Buffer.concat([sid, m2]));
    }
    if (body.length < 17) return this.refuse("short message", ip, 400);
    const sid = body.subarray(0, 16).toString("hex"), s = this.xx.get(sid), rest = Buffer.from(body.subarray(16));
    if (!s || s.ip !== ip || !this.d.introOpen()) return this.refuse("no such introduction", ip);
    if (p === "/lan/v1/xx/3" && s.stage === 2) {
      const pay = parse(s.hs.readMessage(rest)); s.tx = s.hs.split();
      const key = b64u(s.hs.rs!);
      if (key === b64u(this.d.me().pub)) { this.xx.delete(sid); return this.refuse("an introduction to itself", ip); }
      const commit = unb64u(pay?.commit, 32), port = Number(pay?.port);
      if (!Number.isSafeInteger(port) || port < 1 || port > 65535) { this.xx.delete(sid); return this.refuse("bad port", ip, 400); }
      Object.assign(s, { stage: 3, commit, nonce: randomBytes(32), claimed: String(pay?.name ?? "").slice(0, 200), port });
      const self = this.d.self();
      return bin(s.tx.send.encrypt(Buffer.alloc(0), json({ nonce: b64u(s.nonce!), name: self.name })));
    }
    if (p === "/lan/v1/xx/4" && s.stage === 3) {
      this.xx.delete(sid);
      let reveal: Buffer;
      try { const pay = parse(s.tx!.recv.decrypt(Buffer.alloc(0), rest)); reveal = unb64u(pay?.reveal, 32); }
      catch { this.d.introFailed?.(ip, "its reveal could not be read"); return this.refuse("unreadable reveal", ip); }
      if (!eq(sha256(Buffer.from("crew-studio/lan/v1 commit\0"), reveal), s.commit!)) { this.d.introFailed?.(ip, "its revealed nonce does not match its commitment"); return this.refuse("the introducer's commitment does not match", ip); }
      this.d.introduced({ key: b64u(s.hs.rs!), sas: sas(s.hs.hash, reveal, s.nonce!), claimed: s.claimed ?? "", host: ip.replace(/^::ffff:/, ""), port: s.port! });
      return bin(s.tx!.send.encrypt(Buffer.alloc(0), json({ ok: true })));
    }
    if (s.stage === 3) { this.xx.delete(sid); this.d.introFailed?.(ip, "it sent its messages out of order"); }
    return this.refuse("out of order", ip, 400);
  }
}

// ---------- the client: whom Studio may dial ----------
/** Interfaces' own subnets, as [address, netmask] pairs, IPv4 only (the v1 LAN). */
function subnets(): [number, number][] {
  const out: [number, number][] = [];
  for (const list of Object.values(networkInterfaces())) for (const n of list ?? []) if (n.family === "IPv4" && !n.internal) out.push([v4(n.address), v4(n.netmask)]);
  return out;
}
/** This Mac's default gateways (route -n get default on macOS, ip route on Linux), read once a minute. */
let gw: { at: number; list: string[] } | null = null;
export function gateways(): string[] {
  if (gw && Date.now() - gw.at < 60_000) return gw.list;
  const list: string[] = [];
  try { const r = Bun.spawnSync(process.platform === "darwin" ? ["/sbin/route", "-n", "get", "default"] : ["ip", "-4", "route", "show", "default"], { stdout: "pipe", stderr: "ignore", timeout: 3000 });
    const t = r.stdout.toString(); for (const m of t.matchAll(/(?:gateway:\s*|via\s+)(\d+\.\d+\.\d+\.\d+)/g)) list.push(m[1]); } catch {}
  gw = { at: Date.now(), list }; return list;
}
const v4 = (a: string) => a.split(".").reduce((n, o) => ((n << 8) | Number(o)) >>> 0, 0);
/**
 * The SSRF guard for a peer address (CSO B3.5): an IP literal (never a name: mDNS and DNS answers are not trusted), on a
 * private network this Mac is on (one of its own IPv4 subnets), never loopback, this Mac's own address, link-local,
 * multicast, broadcast, a cloud metadata endpoint, the tailnet range or the public internet. Loopback is allowed only
 * when Studio was started for the two-port demo or a test (CREW_LAN_ALLOW_LOOPBACK=1). The reason, or null.
 */
export function peerTargetProblem(host: string, port: number): string | null {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) return "not a port";
  if (isIP(host) !== 4) return "a peer is an IPv4 address literal on this network";
  const loopOk = process.env.CREW_LAN_ALLOW_LOOPBACK === "1";
  if (loopOk && host.startsWith("127.")) return null;
  const why = denial(host, host, localAddresses());
  if (why && why !== "a private-network address") return `refused: ${why}`;
  if (!why) return "refused: not a private-network address";
  const a = v4(host); if (!subnets().some(([net, mask]) => (a & mask) === (net & mask))) return "refused: not on a network this Mac is on";
  if (gateways().includes(host)) return "refused: the network's gateway (a router, never a Studio)";
  return null;
}
const post = async (p: Peer, path: string, body: Buffer) => {
  const why = peerTargetProblem(p.host, p.port); if (why) throw new Error(why);
  const r = await fetch(`http://${p.host}:${p.port}${path}`, { method: "POST", body, redirect: "manual", signal: AbortSignal.timeout(15_000), headers: { "content-type": "application/octet-stream" } });
  if (r.status !== 200) throw new Error(`peer answered ${r.status}`);
  const len = Number(r.headers.get("content-length") ?? 0); if (len > MAX_BODY) throw new Error("peer answer too large");
  const b = Buffer.from(await r.arrayBuffer()); if (b.length > MAX_BODY) throw new Error("peer answer too large");
  return b;
};
/** One request to an introduced peer over a fresh KK handshake; the reply's body, or a thrown error. */
export async function call(me: KeyPair, p: Peer, op: string, body: unknown): Promise<any> {
  const hs = new Handshake("KK", true, me, unb64u(p.key, 65));
  const m1 = hs.writeMessage(json({ v: 1, op, ts: new Date().toISOString(), body }));
  const reply = parse(hs.readMessage(await post(p, "/lan/v1/kk", m1)));
  if (!reply?.ok) throw new Error(String(reply?.error ?? "refused"));
  return reply.body;
}
/** Introduce this Studio to the one listening at host:port (its window must be open): the peer's key and the short code. */
export async function introduce(me: KeyPair, host: string, port: number, self: { name: string; port: number }): Promise<IntroResult> {
  const p: Peer = { key: "", host, port };
  const hs = new Handshake("XX", true, me);
  const r2 = await post(p, "/lan/v1/xx/1", hs.writeMessage(Buffer.alloc(0)));
  const sid = r2.subarray(0, 16); hs.readMessage(Buffer.from(r2.subarray(16)));
  if (b64u(hs.rs!) === b64u(me.pub)) throw new Error("that address is this Studio");
  const nonce = randomBytes(32), commit = sha256(Buffer.from("crew-studio/lan/v1 commit\0"), nonce);
  const m3 = hs.writeMessage(json({ commit: b64u(commit), name: self.name, port: self.port })), tx = hs.split();
  const pay = parse(tx.recv.decrypt(Buffer.alloc(0), await post(p, "/lan/v1/xx/3", Buffer.concat([sid, m3]))));
  const theirs = unb64u(pay?.nonce, 32);
  const fin = parse(tx.recv.decrypt(Buffer.alloc(0), await post(p, "/lan/v1/xx/4", Buffer.concat([sid, tx.send.encrypt(Buffer.alloc(0), json({ reveal: b64u(nonce) }))]))));
  if (!fin?.ok) throw new Error("the peer did not finish the introduction");
  return { key: b64u(hs.rs!), sas: sas(hs.hash, nonce, theirs), claimed: String(pay?.name ?? "").slice(0, 200), host, port };
}
export { sha256hex };
