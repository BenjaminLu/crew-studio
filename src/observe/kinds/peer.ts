// Peers (peer:lan-<fingerprint>, peer:phone-<id>): the Studios this one was introduced to on the LAN and the phones paired to
// it, redacted: the captain's petname, the state, when it was introduced or last seen, a short fingerprint. Never a key, an
// address or port, a pairing code, or what a peer calls itself (its own words). No external CLI grant ever reaches a peer.
import { registerKind, type Entity, type Sources } from "../registry";

const src = (s: Sources) => { try { return s.peers?.() ?? null; } catch { return null; } };
const short = (fp: unknown) => String(fp ?? "").replace(/[^0-9a-zA-Z]/g, "").slice(0, 16).toLowerCase();
/** A LAN peer as an agent reads it (src/lan/relay.ts PeerRec), redacted. */
export function lanPeerRow(p: any) {
  return { id: `lan-${short(p.fp ?? p.key)}`, kind: "lan", petname: p.petname ?? null, state: p.state ?? null, introducedAt: p.introducedAt ?? null, fingerprint: short(p.fp ?? p.key),
    vouched: p.vouched ?? null, unreachableSince: p.unreachableSince ?? null, frozen: !!p.frozen };
}
/** A paired phone (src/remote/pairing.ts devices()), redacted: never its token's hash. */
export function phoneRow(d: any) { return { id: `phone-${String(d.id).replace(/[^0-9a-zA-Z-]/g, "").slice(0, 40)}`, kind: "phone", deviceName: d.name ?? null, paired: d.paired ?? null, lastSeen: d.lastSeen ?? null }; }
const all = (s: Sources): any[] => { const p = src(s); if (!p) return []; return [...(p.lan ?? []).map(lanPeerRow), ...(p.phones ?? []).map(phoneRow)]; };
const entity = (r: any): Entity => ({ id: r.id, title: r.kind === "lan" ? `${r.petname ?? r.id} (LAN Studio, ${r.state})` : `${r.id} (paired phone)`, updatedAt: r.lastSeen ?? r.introducedAt ?? null, project: null, data: r });

registerKind({
  kind: "peer", route: "#/lan", listRoute: "#/lan", idPattern: /^(lan|phone)-[0-9a-zA-Z-]{1,40}$/, idExample: "lan-3f2a9c0d1e7b6a54",
  pages: ["remote"],
  about: "A Studio this one was introduced to on the LAN, or a paired phone, redacted: its petname, state and when it was last seen; never a key or an address.",
  scope: () => null, grantable: false, viewer: "desktop",
  fields: [
    ...["id", "kind", "state", "introducedAt", "fingerprint", "vouched", "unreachableSince", "frozen", "paired", "lastSeen"].map((path) => ({ path, trust: "studio" as const })),
    { path: "petname", trust: "captain" },
    { path: "deviceName", trust: "untrusted", source: "the name a phone gave itself when it paired" },
  ],
  list: (s) => all(s).map(entity),
  get: (s, id) => { const r = all(s).find((x) => x.id === id); return r ? entity(r) : null; },
});
