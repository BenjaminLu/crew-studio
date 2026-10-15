// This Mac's address on the local network, for LAN phone mode (no extra software):
// a phone on the same Wi-Fi opens http://<LAN-IP>:<port>/remote/ and pairs.
//   CREW_LAN_IP    use this address instead of detecting one (tests)
//   CREW_LAN_PORT  port of the LAN listener (default: Studio's port)
import { networkInterfaces } from "node:os";

export function lanIp(): string | null {
  if (process.env.CREW_LAN_IP) return process.env.CREW_LAN_IP;
  const nets = networkInterfaces();
  const order = Object.keys(nets).sort((a, b) => (a === "en0" ? -1 : b === "en0" ? 1 : /^(en|eth|wlan)/.test(a) ? -1 : /^(en|eth|wlan)/.test(b) ? 1 : 0));
  for (const name of order) {
    if (/^(utun|bridge|awdl|llw|lo|docker|veth|tailscale)/.test(name)) continue;
    for (const n of nets[name] ?? []) if (n.family === "IPv4" && !n.internal && !n.address.startsWith("169.254.")) return n.address;
  }
  return null;
}
