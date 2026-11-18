// The one client of Studio's tool API (GET /api/tools, POST /api/tools/<name>, header x-crew-tool-token) that the
// crew-studio CLI (src/cli.ts) and the MCP helper (src/mcp.ts) both use, over Studio's private unix socket when one is given,
// else http://127.0.0.1:<port>: local only. And how a CLI finds its grant (docs/units/cli.md "Grants"):
//   --grant <name|path>  →  CREW_STUDIO_GRANT (a name or a path)  →  the one file in ~/.crew-studio/grants  →  none (exit 7)
// The token is read from the grant file only; it is never printed, never put on a command line or in an environment value.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { cliGrantsDir, type CliGrantFile } from "./studio-home";

export type Conn = { url: string; socket?: string | null; token: string };
export type Reply = { status: number; body: any; quota: any | null };
/** Studio is not answering at that address (not running, or another port). */
export class Unreachable extends Error { constructor(readonly where: string, cause: string) { super(`Studio is not answering at ${where} (${cause})`); } }

export async function request(c: Conn, path: string, body?: unknown, o: { timeoutMs?: number } = {}): Promise<Reply> {
  const where = c.socket ? `unix:${c.socket}` : c.url;
  let r: Response;
  try {
    r = await fetch((c.socket ? "http://localhost" : c.url.replace(/\/$/, "")) + path, { ...(c.socket ? { unix: c.socket } : {}), method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", "x-crew-tool-token": c.token }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(o.timeoutMs ?? 60_000) } as any);
  } catch (e: any) { throw new Unreachable(where, String(e?.code ?? e?.name ?? e?.message ?? e)); }
  const text = await r.text(); let parsed: any = null; try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { error: text.slice(0, 500) }; }
  let quota: any = null; try { const q = r.headers.get("x-crew-grant-quota"); quota = q ? JSON.parse(q) : null; } catch {}
  return { status: r.status, body: parsed, quota };
}

export type FoundGrant = { file: string; grant: CliGrantFile };
export class NoGrant extends Error {}
const isPath = (v: string) => v.includes("/") || v.endsWith(".json");
function readGrant(file: string): CliGrantFile {
  let g: any; try { g = JSON.parse(readFileSync(file, "utf8")); } catch { throw new NoGrant(`cannot read the grant file ${file}`); }
  if (!g || g.schema !== 1 || typeof g.token !== "string" || typeof g.url !== "string") throw new NoGrant(`${file} is not a Studio grant file`);
  return g;
}
/** The grant this CLI uses: --grant, then CREW_STUDIO_GRANT, then the only file in the grants folder. */
export function findGrant(flag: string | null, env = process.env): FoundGrant {
  const dir = cliGrantsDir(), pick = flag ?? env.CREW_STUDIO_GRANT ?? null;
  if (pick) { const file = isPath(pick) ? pick : join(dir, `${pick.replace(/\.json$/, "")}.json`);
    if (!existsSync(file)) throw new NoGrant(`no grant ${isPath(pick) ? file : `named ${pick}`} (${isPath(pick) ? "no such file" : `nothing in ${dir}`})`); return { file, grant: readGrant(file) }; }
  let files: string[] = []; try { files = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => join(dir, f)).filter((f) => statSync(f).isFile()); } catch {}
  if (files.length === 1) return { file: files[0], grant: readGrant(files[0]) };
  if (!files.length) throw new NoGrant(`no grant: issue one on Studio's board (Settings → External CLI grants); it lands in ${dir}`);
  throw new NoGrant(`${files.length} grants in ${dir}: say which with --grant <name> or CREW_STUDIO_GRANT (${files.map((f) => basename(f, ".json")).join(", ")})`);
}
