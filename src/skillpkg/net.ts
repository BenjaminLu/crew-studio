// The hosts a skill's scripts and a prepare may reach (docs/units/skill-packages.md §6): DNS names only. An IP literal,
// a loopback or local name, or a cloud metadata name never gets onto a skill's list; at connect time every address a
// listed name resolves to is judged again, and a skill or prepare credential ("strict") also refuses private ranges
// (10/8, 172.16/12, 192.168/16, 100.64/10, fc00::/7) on top of the egress guard's classes (src/egress-guard.ts).
import { BlockList, isIP } from "node:net";
import { denial, embeddedIPv4 } from "../egress-guard";

const NAME = /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
const LOCAL_NAMES = /(^|\.)(localhost|local|internal|localdomain|home\.arpa|lan|intranet|corp)$/;
const METADATA_NAMES = new Set(["metadata.google.internal", "metadata", "instance-data", "metadata.azure.com"]);
/** A host a skill list may carry: a lower-case DNS name (or *.domain) that is not an IP literal, a local name or a metadata name. */
export function checkHost(raw: string): { ok: true; host: string } | { ok: false; why: string } {
  const h = String(raw ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!h) return { ok: false, why: "empty" };
  if (isIP(h.replace(/^\[|\]$/g, ""))) return { ok: false, why: "an IP address, not a host name" };
  if (!NAME.test(h)) return { ok: false, why: "not a DNS name" };
  if (LOCAL_NAMES.test(h.replace(/^\*\./, ""))) return { ok: false, why: "a local name" };
  if (METADATA_NAMES.has(h)) return { ok: false, why: "a cloud metadata name" };
  if (h.startsWith("*.") && h.split(".").length < 3) return { ok: false, why: "a wildcard over a whole top-level domain" };
  return { ok: true, host: h };
}
const PRIVATE = (() => { const l = new BlockList(); for (const [a, p] of [["10.0.0.0", 8], ["172.16.0.0", 12], ["192.168.0.0", 16], ["100.64.0.0", 10]] as const) l.addSubnet(a, p, "ipv4"); l.addSubnet("fc00::", 7, "ipv6"); return l; })();
/** Why a strict credential may not dial `address` for `hostname`: the egress guard's classes, any IP literal, and private ranges. */
export function strictDenial(hostname: string, address: string): string | null {
  if (isIP(hostname)) return "an IP address (a skill or prepare reaches names only)";
  const g = denial(hostname, address); if (g) return g;
  const a = address.split("%")[0], v4 = embeddedIPv4(a);
  if ((isIP(a) === 4 && PRIVATE.check(a, "ipv4")) || (isIP(a) === 6 && PRIVATE.check(a, "ipv6")) || (v4 && PRIVATE.check(v4, "ipv4"))) return "a private address";
  return null;
}
