// The permission bridge. The main session's tool permission requests reach
// Studio here and wait for the captain (desktop or a paired phone) to allow or
// deny. Claude's --permission-prompt-tool runs src/permission-mcp.ts, which
// connects to this private unix socket (0700 dir, 0600 socket) and must show a
// random token; Codex approval requests arrive in-process. Anything that goes
// wrong - a bad token, a broken connection, no answer in time - is a deny.
import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PermissionAnswer, PermissionRequest } from "./types";

export type Pending = PermissionRequest & { at: number; expires: number };

export class PermissionBridge {
  readonly token = randomBytes(32).toString("hex");
  readonly dir: string;
  readonly socket: string;
  private server: Server | null = null;
  private waiting = new Map<string, { req: Pending; done: (a: PermissionAnswer) => void }>();
  onChange: (pending: Pending[]) => void = () => {};

  constructor(readonly timeoutMs = Number(process.env.CREW_PERMISSION_TIMEOUT_MS ?? 120_000)) {
    this.dir = mkdtempSync(join(tmpdir(), "crew-perm-"));
    chmodSync(this.dir, 0o700);
    this.socket = join(this.dir, "perm.sock");
  }

  pending(): Pending[] { return [...this.waiting.values()].map((w) => w.req); }

  /** Ask the captain. Resolves deny on timeout. */
  ask(r: PermissionRequest): Promise<PermissionAnswer> {
    return new Promise((resolve) => {
      const id = r.id && !this.waiting.has(r.id) ? r.id : `${r.id || "perm"}-${randomBytes(3).toString("hex")}`;
      const req: Pending = { ...r, id, at: Date.now(), expires: Date.now() + this.timeoutMs };
      const done = (a: PermissionAnswer) => { if (!this.waiting.delete(id)) return; clearTimeout(t); this.onChange(this.pending()); resolve(a); };
      const t = setTimeout(() => done({ allow: false, message: "no answer from the captain in time; denied" }), this.timeoutMs);
      this.waiting.set(id, { req, done });
      this.onChange(this.pending());
    });
  }

  answer(id: string, allow: boolean, message?: string, updatedInput?: unknown): boolean {
    const w = this.waiting.get(id);
    if (!w) return false;
    w.done({ allow, message: message ?? (allow ? undefined : "denied by the captain"), ...(allow && updatedInput !== undefined ? { updatedInput } : {}) });
    return true;
  }

  denyAll(message = "Studio let go of the session; denied") { for (const id of [...this.waiting.keys()]) this.answer(id, false, message); }

  /** The private socket the permission MCP server talks to. */
  listen(): Promise<void> {
    const tok = Buffer.from(this.token);
    this.server = createServer((c) => {
      let buf = "";
      c.setTimeout(this.timeoutMs + 5000, () => c.destroy());
      c.on("data", async (d) => {
        buf += d.toString();
        const i = buf.indexOf("\n");
        if (i < 0) { if (buf.length > 1 << 20) c.destroy(); return; }
        let m: any; try { m = JSON.parse(buf.slice(0, i)); } catch { c.end(JSON.stringify({ allow: false, message: "bad request" }) + "\n"); return; }
        const given = Buffer.from(String(m?.token ?? ""));
        if (given.length !== tok.length || !timingSafeEqual(given, tok)) { c.end(JSON.stringify({ allow: false, message: "bad token" }) + "\n"); return; }
        const a = await this.ask({ id: String(m.tool_use_id ?? ""), tool: String(m.tool_name ?? "tool"), summary: String(m.summary ?? ""), input: m.input ?? null });
        c.end(JSON.stringify(a) + "\n");
      });
      c.on("error", () => {});
    });
    return new Promise((res, rej) => {
      this.server!.once("error", rej);
      this.server!.listen(this.socket, () => { try { chmodSync(this.socket, 0o600); } catch {} res(); });
    });
  }

  close() { this.denyAll(); try { this.server?.close(); } catch {} try { rmSync(this.dir, { recursive: true, force: true }); } catch {} }
}
