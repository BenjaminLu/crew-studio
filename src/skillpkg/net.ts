// The hosts a skill's scripts and a prepare may reach (docs/units/skill-packages.md §6): DNS names only. An IP literal,
// a loopback or local name, or a cloud metadata name never gets onto a skill's list; at connect time every address a
// listed name resolves to is judged again, and a skill or prepare credential ("strict") also refuses private ranges
// (10/8, 172.16/12, 192.168/16, 100.64/10, fc00::/7) on top of the egress guard's classes (src/egress-guard.ts).
import { isIP } from "node:net";

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
