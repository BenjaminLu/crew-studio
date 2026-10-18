// The resolved-address guard of Studio's egress proxy (architecture §10 "network by policy"). Ported from Anthropic
// sandbox-runtime 0.0.78 (dist/sandbox/resolved-address-guard.js and address.js, Apache-2.0; THIRD_PARTY_NOTICES.md).
// The host list decides by name, but whoever controls an allowed name's DNS decides what it resolves to: without this
// check, an allowed name pointed at 127.0.0.1 would reach Studio's own port, or any local service, through the proxy.
// A hostname may connect only to an address that is none of: loopback, unspecified, link-local, multicast, broadcast, a
// cloud metadata endpoint, or one of this host's own interface addresses; an IPv6 form carrying an IPv4 address
// (IPv4-mapped, IPv4-compatible, NAT64 64:ff9b::/96, 6to4 2002::/16) is judged by that IPv4 address too. The loopback
// names (localhost, *.localhost) resolve to loopback and nothing else. An IP literal on a round's list is an explicit
// choice and is not judged here (as in sandbox-runtime). The address that passed is the address dialed.
import { lookup as dnsLookup } from "node:dns";
import { BlockList, isIP } from "node:net";
import { networkInterfaces } from "node:os";

const LOOPBACK = ["127.0.0.0/8", "::1"];
const CLOUD_METADATA = ["100.100.100.200", "168.63.129.16", "192.0.0.192", "fd00:ec2::/32", "fd20:ce::254", "fd00:c1::a9fe:a9fe", "fd00:42::42", "fd00:a9fe:a9fe::1", "fd00:100::100:200"];
const DENIED: [string, string[]][] = [
  ["a loopback address", LOOPBACK],
  ["an unspecified address", ["0.0.0.0/8", "::"]],
  ["a link-local address", ["169.254.0.0/16", "fe80::/10"]],
  ["a multicast address", ["224.0.0.0/4", "ff00::/8"]],
  ["the broadcast address", ["255.255.255.255"]],
  ["a cloud metadata address", CLOUD_METADATA],
];
const stripZone = (a: string) => { const i = a.indexOf("%"); return i < 0 ? a : a.slice(0, i); };
const family = (a: string) => (isIP(a) === 4 ? "ipv4" : isIP(a) === 6 ? "ipv6" : undefined);
/** The eight 16-bit groups of an IPv6 literal, or undefined. */
function groups(address: string): number[] | undefined {
  let host: string; try { host = new URL(`http://[${stripZone(address)}]/`).hostname.slice(1, -1); } catch { return undefined; }
  const [head = "", tail] = host.split("::"); const lead = head ? head.split(":") : [], rest = tail ? tail.split(":") : [];
  const fill = tail === undefined ? 0 : 8 - lead.length - rest.length; if (fill < 0 || lead.length + fill + rest.length !== 8) return undefined;
  return [...lead, ...Array(fill).fill("0"), ...rest].map((g) => parseInt(g, 16));
}
const quad = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
/** The IPv4 address an IPv6 address delivers to (mapped, compatible, translated, NAT64 well-known, 6to4), or undefined. */
export function embeddedIPv4(address: string): string | undefined {
  if (isIP(stripZone(address)) !== 6) return undefined; const g = groups(address); if (!g) return undefined;
  const zero = (from: number, to: number) => g.slice(from, to).every((x) => x === 0);
  if (g[0] === 0x2002) return quad(g[1], g[2]);
  const low = quad(g[6], g[7]);
  if (g[0] === 0x64 && g[1] === 0xff9b && zero(2, 6)) return low; // NAT64 /96
  if (zero(0, 5) && (g[5] === 0 || g[5] === 0xffff)) return low;
  if (zero(0, 4) && g[4] === 0xffff && g[5] === 0) return low;
  return undefined;
}
function set(ranges: string[]): BlockList {
  const l = new BlockList();
  for (const r of ranges) { const [a, p] = r.split("/"); const f = family(stripZone(a)); if (!f) continue; const v4 = f === "ipv6" ? embeddedIPv4(a) : undefined;
    try { if (v4 && /ffff/i.test(a)) l.addSubnet(v4, p ? Number(p) - 96 : 32, "ipv4"); else l.addSubnet(stripZone(a), p ? Number(p) : f === "ipv4" ? 32 : 128, f); } catch {} }
  return l;
}
const inSet = (l: BlockList, a: string) => { const x = stripZone(a), f = family(x); return !!f && l.check(x, f); };
const deniedSets = DENIED.map(([why, r]) => [why, set(r)] as const), loopbackSet = set(LOOPBACK);
export const isLoopbackName = (h: string) => { const n = h.toLowerCase().replace(/\.$/, ""); return n === "localhost" || n.endsWith(".localhost"); };
export const localAddresses = () => { try { return Object.values(networkInterfaces()).flat().flatMap((i) => (i ? [i.address] : [])); } catch { return []; } };
/** Why `hostname` may not connect to `address` (the class, never the address), or null. */
export function denial(hostname: string, address: string, local: string[] = localAddresses()): string | null {
  if (isIP(hostname)) return null;
  if (!isIP(stripZone(address))) return "an unparsable address";
  const v4 = embeddedIPv4(address), hits = (l: BlockList) => inSet(l, address) || (v4 !== undefined && inSet(l, v4));
  if (isLoopbackName(hostname)) return inSet(loopbackSet, address) ? null : "a non-loopback address";
  const why = deniedSets.find(([, l]) => hits(l))?.[0]; if (why) return why;
  const mine = set(local); if (hits(mine)) return "one of this host's addresses";
  return null;
}
/** Resolve a hostname once and keep the addresses the guard allows: the one to dial, or the reason none may be. */
export function guardedLookup(hostname: string, resolve: typeof dnsLookup = dnsLookup): Promise<{ address: string; family: number } | { refused: string } | { unresolved: string }> {
  if (isIP(hostname)) return Promise.resolve({ address: hostname, family: isIP(hostname) });
  return new Promise((res) => resolve(hostname, { all: true }, (err: any, addresses: any) => {
    if (err) return res({ unresolved: `${hostname} does not resolve (${err.code ?? err.message})` }); // not a refusal: the dial fails as it would have
    const local = localAddresses(), whys = new Set<string>(); let kept: { address: string; family: number } | null = null;
    for (const a of addresses as { address: string; family: number }[]) { const why = denial(hostname, a.address, local); if (why) whys.add(why); else if (!kept) kept = a; }
    res(kept ?? { refused: `${hostname} resolved to ${[...whys].join(" / ") || "nothing"}` });
  }));
}
