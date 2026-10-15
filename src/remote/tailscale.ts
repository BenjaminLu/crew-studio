// Tailscale, behind an interface. Reading `tailscale status --json` is safe
// and shows what the phone URL WOULD be. Changing Tailscale state (serve on or
// off) goes through a runner the captain confirms; tests use a stub runner,
// and in this build the server uses the stub too unless CREW_TAILSCALE_LIVE=1.
export type TsStatus = { installed: boolean; running: boolean; dnsName: string | null; url: string | null; error: string | null };
export interface TsRunner { readonly live: boolean; run(argv: string[]): { ok: boolean; out: string }; }

export const SERVE_PORT = 8443;
export const serveCommand = (port: number) => ["tailscale", "serve", "--bg", `--https=${SERVE_PORT}`, `http://127.0.0.1:${port}`];
export const serveOffCommand = () => ["tailscale", "serve", `--https=${SERVE_PORT}`, "off"];

export function readStatus(bin = process.env.CREW_TAILSCALE_BIN ?? "tailscale"): TsStatus {
  try {
    const r = Bun.spawnSync([bin, "status", "--json"], { stdout: "pipe", stderr: "pipe" });
    if (!r.success) return { installed: true, running: false, dnsName: null, url: null, error: r.stderr.toString().trim().slice(0, 200) || "tailscale is not running" };
    const s = JSON.parse(r.stdout.toString());
    const dns = String(s?.Self?.DNSName ?? "").replace(/\.$/, "") || null;
    return { installed: true, running: s?.BackendState === "Running", dnsName: dns, url: dns ? `https://${dns}:${SERVE_PORT}/` : null, error: null };
  } catch (e: any) {
    return { installed: false, running: false, dnsName: null, url: null, error: "tailscale is not installed" };
  }
}

/** Records what it would run; never touches Tailscale. */
export class StubRunner implements TsRunner {
  readonly live = false;
  readonly ran: string[][] = [];
  run(argv: string[]) { this.ran.push(argv); return { ok: true, out: `(stub) would run: ${argv.join(" ")}` }; }
}

export class LiveRunner implements TsRunner {
  readonly live = true;
  run(argv: string[]) { const r = Bun.spawnSync(argv, { stdout: "pipe", stderr: "pipe" }); return { ok: r.success, out: (r.stdout.toString() + r.stderr.toString()).trim().slice(0, 600) }; }
}
