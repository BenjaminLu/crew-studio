// The egress proxy (architecture §10 "network by policy"; firstmate's proxy-only
// egress): agent rounds run in a sandbox whose only way out is this local proxy.
// Studio owns each upstream credential; a child receives only its scoped listener
// URL (src/egress-client.ts). Each credential has its own host list: its provider's API hosts plus what policy
// `egress.allow` grants that round (e.g. a package registry). The list lives only as
// long as the round; a request with no credential, an unknown one, or a host off that
// round's list is refused and logged. A host on the list is dialed only at an address the resolved-address guard allows
// (src/egress-guard.ts): never loopback, this host's own addresses, link-local or a metadata endpoint, so an allowed name
// pointed at 127.0.0.1 cannot reach Studio or another local service through the proxy.
//   data/egress.log   one JSON line per refused connection
import { appendFileSync, mkdirSync } from "node:fs";
import { createServer, connect, isIP, type Server, type Socket } from "node:net";
import { dirname } from "node:path";
import { lookup as dnsLookup } from "node:dns";
import { lookup } from "node:dns/promises";
import { BROKER_PORTS } from "./egress-client";
import { guardedLookup, isLoopbackAddress, localAddresses } from "./egress-guard";

export type EgressMeta = { purpose?: "round" | "skill" | "prepare"; run?: string; node?: string; visit?: number; skill?: string; script?: string; strict?: boolean };
export type EgressEvent = { at: string; host: string; port: number; allowed: boolean; method: string; round: string | null; why?: string; run?: string; node?: string; skill?: string; script?: string; purpose?: string };
export class Egress {
  private server: Server | null = null;
  private starting: Promise<number> | null = null;
  port = 0;
  /** credential → that round's hosts */
  private rounds = new Map<string, Set<string>>();
  private localPolicies = new Map<string, {origins: Set<string>; blocked: Set<number>}>();
  private connections = new Map<Socket, {token: string | null; upstream: Socket | null}>();
  private metas = new Map<string, EgressMeta>();
  private listeners = new Set<(e: EgressEvent) => void>();
  listen(f: (e: EgressEvent) => void) { this.listeners.add(f); return () => { this.listeners.delete(f); }; }
  taskLog: ((run: string) => string | null) | null = null;
  lookup: typeof dnsLookup = dnsLookup;
  onEvent: (e: EgressEvent) => void = () => {};
  constructor(readonly logFile: string | null = null, private readonly dial: (port: number, address: string) => Socket = (port, address) => connect(port, address)) {}
  open(token: string, hosts: string[], options: EgressMeta & {localOrigins?: string[]; blockedPorts?: number[]} = {}) {
    this.rounds.set(token, new Set(hosts.filter(Boolean).map((h) => String(h).toLowerCase())));
    this.metas.set(token, options);
    const origins = new Set<string>(); for (const origin of options.localOrigins ?? []) { try { const u = new URL(origin); if (/^https?:$/.test(u.protocol) && !u.username && !u.password) origins.add(u.origin); } catch {} }
    this.localPolicies.set(token, {origins, blocked: new Set([4210, this.port, ...BROKER_PORTS, ...(options.blockedPorts ?? [])])});
  }
  close(token: string) { this.rounds.delete(token); this.metas.delete(token); this.localPolicies.delete(token); for (const [client, state] of this.connections) if (state.token === token) { client.destroy(); state.upstream?.destroy(); } }
  /** A host is allowed for a round when it is on that round's list, or a subdomain of a "*.domain" entry. */
  allowed(host: string, token: string | null): boolean {
    const list = token ? this.rounds.get(token) : null; if (!list) return false;
    const h = host.toLowerCase(); return list.has(h) || [...list].some((x) => x.startsWith("*.") && (h === x.slice(2) || h.endsWith(x.slice(1))));
  }
  status() { return { running: !!this.server, port: this.port, rounds: this.rounds.size }; }
  private record(host: string, port: number, allowed: boolean, method: string, round: string | null, why?: string, meta: EgressMeta = {}) {
    const e: EgressEvent = { at: new Date().toISOString(), host, port, allowed, method, round, why, ...(meta.run ? { run: meta.run } : {}), ...(meta.node ? { node: meta.node } : {}), ...(meta.skill ? { skill: meta.skill } : {}), ...(meta.script ? { script: meta.script } : {}), ...(meta.purpose ? { purpose: meta.purpose } : {}) };
    if (!allowed && this.logFile) { try { mkdirSync(dirname(this.logFile), { recursive: true }); appendFileSync(this.logFile, JSON.stringify(e) + "\n"); } catch {} }
    const task = meta.run && /^[\w-]+$/.test(meta.run) ? this.taskLog?.(meta.run) : null;
    if (task) { try { mkdirSync(dirname(task), { recursive: true }); appendFileSync(task, JSON.stringify(e) + "\n"); } catch {} }
    this.onEvent(e); for (const f of this.listeners) { try { f(e); } catch {} }
  }
  async start(): Promise<number> {
    if (this.starting) return this.starting;
    if (this.server) return this.port;
    this.server = createServer((client: Socket) => {
      if (this.connections.size >= 256) { client.destroy(); return; }
      const state = {token: null as string | null, upstream: null as Socket | null}; this.connections.set(client, state);
      client.once("close", () => { state.upstream?.destroy(); this.connections.delete(client); });
      client.setTimeout(10000, () => client.destroy());
      let head = Buffer.alloc(0);
      const onData = (d: Buffer) => {
        head = Buffer.concat([head, d]);
        const end = head.indexOf("\r\n\r\n"); if (end < 0) { if (head.length > 16384) client.destroy(); return; }
        if (end > 16384) { client.destroy(); return; }
        client.off("data", onData);
        // Backpressure while DNS/connect is pending; no unbounded JS pending buffer.
        client.pause();
        const lines = head.slice(0, end).toString("latin1").split("\r\n"); const [method, target] = lines[0].split(" ");
        let host = "", port = 80, protocol = method === "CONNECT" ? "https:" : "http:";
        if (method === "CONNECT") { const m = /^\[?([^\]]+?)\]?:(\d+)$/.exec(target ?? ""); host = m?.[1] ?? ""; port = Number(m?.[2] ?? 443); }
        else { try { const u = new URL(target); host = u.hostname; protocol = u.protocol; port = Number(u.port || (protocol === "https:" ? 443 : 80)); } catch { client.end("HTTP/1.1 400 Bad Request\r\n\r\n"); return; } }
        // the round's credential: Proxy-Authorization: Basic base64("round:<token>")
        const auth = lines.find((l) => /^proxy-authorization:/i.test(l))?.split(":").slice(1).join(":").trim() ?? "";
        let token: string | null = null; const m2 = /^Basic\s+(.+)$/i.exec(auth); if (m2) { try { token = Buffer.from(m2[1], "base64").toString("utf8").split(":").slice(1).join(":") || null; } catch {} }
        if (!Number.isInteger(port) || port < 1 || port > 65535) { client.end("HTTP/1.1 400 Bad Request\r\n\r\n"); return; }
        const known = !!token && this.rounds.has(token); state.token = known ? token : null;
        const round = known ? token!.slice(0, 6) : null;
        const meta = known ? this.metas.get(token!) ?? {} : {};
        if (!known) { this.record(host, port, false, method, null, token ? "unknown round credential" : "no round credential");
          client.end(`HTTP/1.1 407 Proxy Authentication Required\r\nproxy-authenticate: Basic realm="crew-studio"\r\ncontent-type: text/plain\r\nconnection: close\r\n\r\nStudio's egress proxy serves only agent rounds, each with its own credential\n`); return; }
        const ok = !!host && this.allowed(host, token);
        if (!ok) this.record(host, port, false, method, round, meta.purpose === "skill" ? `not in ${meta.skill}'s approved hosts` : "not on the round's list", meta);
        if (!ok) { client.end(`HTTP/1.1 403 Forbidden\r\ncontent-type: text/plain\r\nconnection: close\r\n\r\nStudio's egress proxy refuses ${host}: not on this round's list (its provider's hosts and policy egress.allow)\n`); return; }
        const resolve = async () => {
          if (meta.strict && isIP(host)) return {refused: "an IP address (a skill or prepare reaches names only)"};
          const checked = await guardedLookup(host, this.lookup);
          if (!("refused" in checked) || !token || meta.strict) return checked;
          const policy = this.localPolicies.get(token); let origin = "";
          try { origin = new URL(`${protocol}//${host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}:${port}`).origin; } catch { return checked; }
          if (!policy?.origins.has(origin) || policy.blocked.has(port) || port === this.port) return checked;
          try {
            const addresses = await lookup(host, {all: true}), mine = localAddresses();
            const to = addresses.find(a => isLoopbackAddress(a.address) || mine.includes(a.address));
            return to ? {address: to.address, family: to.family} : checked;
          } catch { return checked; }
        };
        void resolve().then((to) => {
        if (client.destroyed || !token || !this.rounds.has(token)) { client.destroy(); return; }
        if ("unresolved" in to) { try { client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"); } catch {} return; }
        if ("refused" in to) { this.record(host, port, false, method, round, to.refused, meta);
          client.end(`HTTP/1.1 403 Forbidden\r\ncontent-type: text/plain\r\nconnection: close\r\n\r\nStudio's egress proxy refuses ${host}: ${to.refused}\n`); return; }
        this.record(host, port, true, method, round, undefined, meta);
        const up = this.dial(port, to.address); up.once("connect", () => {
          if (client.destroyed || !token || !this.rounds.has(token)) { up.destroy(); return; }
          client.setTimeout(120000, () => { client.destroy(); up.destroy(); }); up.setTimeout(120000, () => { client.destroy(); up.destroy(); });
          if (method === "CONNECT") { client.write("HTTP/1.1 200 Connection Established\r\n\r\n"); const rest = head.slice(end + 4); if (rest.length) up.write(rest); }
          else { // a plain request: send it on as origin-form
            const u = new URL(target); lines[0] = `${method} ${u.pathname}${u.search} ${lines[0].split(" ")[2] ?? "HTTP/1.1"}`;
            up.write(Buffer.concat([Buffer.from([...lines.filter((l) => !/^(proxy-|connection:|keep-alive:)/i.test(l)), "connection: close"].join("\r\n") + "\r\n\r\n", "latin1"), head.slice(end + 4)]));
          }
          client.pipe(up); up.pipe(client); client.resume();
        });
        state.upstream = up; up.setTimeout(10000, () => up.destroy()); up.once("close", () => { if (!client.destroyed && !client.writableEnded) client.end(); });
        up.on("error", () => { try { client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n"); } catch {} });
        client.on("error", () => up.destroy());
        });
      };
      client.on("data", onData); client.on("error", () => {});
    });
    const server = this.server;
    this.starting = new Promise<number>((resolve, reject) => {
      const fail = (error: Error) => { if (this.server === server) this.server = null; this.port = 0; reject(error); };
      server.once("error", fail);
      try { server.listen(0, "127.0.0.1", () => { server.off("error", fail); this.port = (server.address() as any).port; resolve(this.port); }); }
      catch (error) { server.off("error", fail); fail(error as Error); }
    });
    try { return await this.starting; } finally { this.starting = null; }
  }
  stop() { for (const [client, state] of this.connections) { client.destroy(); state.upstream?.destroy(); } this.connections.clear(); this.rounds.clear(); this.metas.clear(); this.localPolicies.clear(); this.server?.close(); this.server = null; this.port = 0; }
}
