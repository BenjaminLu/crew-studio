// Phone access. Studio listens on 127.0.0.1; `tailscale serve` (when the
// captain enables it) forwards the tailnet name to it, and LAN mode (built in,
// off by default) adds a second listener on this Mac's LAN address whose
// requests are always treated as a phone. Requests are
// told apart by their Host header: loopback is this Mac, the tailnet name is a
// phone, anything else is refused (DNS rebinding). A phone pairs once with a
// 6-digit code shown on the Mac (5 minutes, 5 tries, compared timing-safe) and
// gets a 32-byte bearer token; only its SHA-256 is stored, in
// data/remote-devices.json (0600, atomic). Devices can be revoked, which also
// cuts their live stream. Reading and interrupt are always allowed for a
// paired phone; driving firstmate needs the "allow phone to drive" setting.
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type Device = { id: string; name: string; hash: string; paired: string; lastSeen: string | null };
type Store = { devices: Device[]; allowDrive: boolean };
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const eq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

export type Who = { kind: "desktop" } | { kind: "phone"; device: Device } | { kind: "refused"; status: number; error: string };

export class Remote {
  private code: { value: string; expires: number; tries: number } | null = null;
  private file: string;
  tailnetNames = new Set<string>();
  /** "ip:port" of the LAN listener while LAN mode is on; requests that arrive on it are always phones. */
  lanHost: string | null = null;
  onRevoke: (deviceId: string) => void = () => {};

  constructor(dataDir: string, readonly port: number) { this.file = join(dataDir, "remote-devices.json"); }

  private load(): Store { try { const s = JSON.parse(readFileSync(this.file, "utf8")); return { devices: Array.isArray(s.devices) ? s.devices : [], allowDrive: s.allowDrive === true }; } catch { return { devices: [], allowDrive: false }; } }
  private save(s: Store) { const tmp = this.file + ".tmp"; writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600 }); renameSync(tmp, this.file); }

  devices() { return this.load().devices.map(({ hash, ...d }) => d); }
  get allowDrive() { return this.load().allowDrive; }
  setAllowDrive(v: boolean) { const s = this.load(); s.allowDrive = v; this.save(s); }

  /** Desktop only: a fresh 6-digit code for 5 minutes. */
  startPairing(now = Date.now()) {
    this.code = { value: String(randomInt(0, 1_000_000)).padStart(6, "0"), expires: now + 5 * 60_000, tries: 0 };
    return { code: this.code.value, expires: this.code.expires };
  }

  pair(code: string, name: string, now = Date.now()): { ok: true; token: string; device: Omit<Device, "hash"> } | { ok: false; status: number; error: string } {
    const c = this.code;
    if (!c || now > c.expires) { this.code = null; return { ok: false, status: 410, error: "no pairing code is active; start pairing on the Mac" }; }
    if (c.tries >= 5) { this.code = null; return { ok: false, status: 429, error: "too many tries; start pairing again on the Mac" }; }
    c.tries++;
    if (!eq(String(code ?? "").padStart(6, "0").slice(0, 6), c.value)) {
      if (c.tries >= 5) this.code = null;
      return { ok: false, status: 401, error: "wrong code" };
    }
    this.code = null;
    const token = randomBytes(32).toString("base64url");
    const s = this.load();
    const d: Device = { id: randomBytes(6).toString("hex"), name: String(name || "phone").slice(0, 40), hash: sha(token), paired: new Date(now).toISOString(), lastSeen: null };
    s.devices.push(d); this.save(s);
    const { hash, ...pub } = d;
    return { ok: true, token, device: pub };
  }

  revoke(id: string): boolean {
    const s = this.load(); const n = s.devices.length;
    s.devices = s.devices.filter((d) => d.id !== id);
    if (s.devices.length === n) return false;
    this.save(s); this.onRevoke(id); return true;
  }

  private hostOk(host: string, via: "loopback" | "lan"): "desktop" | "tailnet" | "lan" | null {
    const h = host.toLowerCase();
    const name = h.replace(/:\d+$/, "");
    // the LAN listener never serves this Mac: a phone cannot claim to be loopback there
    if (via === "lan") return this.lanHost && (h === this.lanHost || h === this.lanHost.replace(/:80$/, "")) ? "lan" : null;
    if (["127.0.0.1", "localhost", "[::1]"].includes(name) && (h === name || h.endsWith(`:${this.port}`))) return "desktop";
    if (this.tailnetNames.has(name)) return "tailnet";
    return null;
  }

  /** Who is asking. A bearer token (header, or ?token= for SSE) is required from the tailnet name. */
  who(req: Request, url: URL, via: "loopback" | "lan" = "loopback"): Who {
    const where = this.hostOk(req.headers.get("host") ?? "", via);
    if (!where) return { kind: "refused", status: 421, error: "unknown Host; Crew Studio answers only on loopback, its LAN address (LAN mode) or its tailnet name" };
    const auth = req.headers.get("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : url.searchParams.get("token") ?? "";
    if (where === "desktop" && !token) return { kind: "desktop" };
    if (!token) return { kind: "refused", status: 401, error: "pair this phone first" };
    const h = sha(token);
    const s = this.load();
    const d = s.devices.find((x) => eq(x.hash, h));
    if (!d) return { kind: "refused", status: 401, error: "this phone is not paired (or was revoked); pair again" };
    const last = d.lastSeen ? Date.parse(d.lastSeen) : 0;
    if (Date.now() - last > 60_000) { d.lastSeen = new Date().toISOString(); this.save(s); }
    return { kind: "phone", device: d };
  }
}
