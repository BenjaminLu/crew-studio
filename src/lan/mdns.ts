// Discovery (docs/units/lan-relay.md): Bonjour `_crewstudio._tcp`, through macOS's own dns-sd. What is advertised is an
// opaque instance name that changes every 15 minutes and the listener's port, with one TXT key (v=1): no device name,
// no key, no fingerprint. What is found is listed as "nearby, not introduced" and nothing more: discovery never
// connects, never introduces and never trusts. Turning a nearby Studio into an address to introduce is a person's
// click, and the address still has to pass the peer address guard (src/lan/wire.ts peerTargetProblem).
// Not covered here (stated in the unit spec): Bonjour's own SRV record names this Mac's .local host name.
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";

export type Nearby = { id: string; host: string | null; port: number | null; seen: string };
const SERVICE = "_crewstudio._tcp";

/** One `dns-sd -B` line: an instance added or removed, or null. */
export function parseBrowse(line: string): { op: "add" | "rmv"; id: string } | null {
  const m = /^\s*\S+\s+(Add|Rmv)\s+\S+\s+\S+\s+\S+\s+_crewstudio\._tcp\.\s+(\S.*)$/.exec(line); // time, A/R, flags, if, domain, type, name
  if (!m) return null; const id = m[2].trim();
  return /^cs-[0-9a-f]{12}$/.test(id) ? { op: m[1] === "Add" ? "add" : "rmv", id } : null;
}

export class Discovery {
  private ad: ChildProcess | null = null; private br: ChildProcess | null = null; private rot: any = null;
  private found = new Map<string, Nearby>(); id = "";
  constructor(private readonly o: { enabled: boolean; tool?: string } = { enabled: true }) {}
  private get tool() { return this.o.tool ?? "/usr/bin/dns-sd"; }
  start(port: number) {
    if (!this.o.enabled || process.platform !== "darwin") return;
    this.stop();
    const advertise = () => { this.ad?.kill(); this.id = `cs-${randomBytes(6).toString("hex")}`; this.ad = spawn(this.tool, ["-R", this.id, SERVICE, "local", String(port), "v=1"], { stdio: "ignore" }); this.ad.on("error", () => {}); };
    advertise(); this.rot = setInterval(advertise, 15 * 60_000); this.rot.unref?.();
    this.br = spawn(this.tool, ["-B", SERVICE, "local"], { stdio: ["ignore", "pipe", "ignore"] }); this.br.on("error", () => {});
    let buf = ""; this.br.stdout?.on("data", (d) => { buf += String(d); const lines = buf.split("\n"); buf = lines.pop() ?? ""; for (const l of lines) this.feed(l); });
  }
  /** A browse line (or a test's): the nearby list changes, nothing else does. */
  feed(line: string) {
    const r = parseBrowse(line); if (!r || r.id === this.id) return;
    if (r.op === "rmv") this.found.delete(r.id); else this.found.set(r.id, { id: r.id, host: null, port: null, seen: new Date().toISOString() });
    if (this.found.size > 64) this.found.delete(this.found.keys().next().value!);
  }
  stop() { this.ad?.kill(); this.br?.kill(); this.ad = this.br = null; if (this.rot) clearInterval(this.rot); this.rot = null; }
  nearby(): Nearby[] { return [...this.found.values()]; }
}
