// The one client of Studio's tool API (GET /api/tools, POST /api/tools/<name>, header x-crew-tool-token) that the
// crew-studio CLI (src/cli.ts) and the MCP helper (src/mcp.ts) both use, over Studio's private unix socket when one is given,
// else http://127.0.0.1:<port>: local only. And how a CLI finds its grant (docs/units/cli.md "Grants"):
//   --grant <name|path>  →  CREW_STUDIO_GRANT (a name or a path)  →  the one file in ~/.crew-studio/grants  →  none (exit 7)
// The token is read from the grant file only; it is never printed, never put on a command line or in an environment value.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { privateProblem } from "./instance";
import { basename, join, resolve } from "node:path";
import { cliGrantsDir, type CliGrantFile } from "./studio-home";

export type Conn = { url: string; socket?: string | null; token: string };
export type Reply = { status: number; body: any; quota: any | null };
/** Studio is not answering at that address (not running, or another port). */
export class Unreachable extends Error { constructor(readonly where: string, cause: string) { super(`Studio is not answering at ${where} (${cause})`); } }

/** Studio is only ever on this Mac: a token goes to a loopback address or a unix socket, never anywhere else. */
export class NotLocal extends Error {}
export function loopbackUrl(u: string): boolean {
  try { const x = new URL(u); return x.protocol === "http:" && ["127.0.0.1", "[::1]", "localhost"].includes(x.hostname) && !x.username && !x.password; } catch { return false; }
}
const shown = (u: string) => u.replace(/\/\/[^/@]*@/, "//");
export async function request(c: Conn, path: string, body?: unknown, o: { timeoutMs?: number } = {}): Promise<Reply> {
  if (!c.socket && !loopbackUrl(c.url)) throw new NotLocal(`refusing to send a Studio token to ${shown(c.url)}: Studio is reached only at http://127.0.0.1, http://[::1] or http://localhost`);
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
/** A grant file is read only when it and its folder are this user's own, not links, and private (0600 in a 0700 folder). */
function privateGrant(file: string) {
  const fix = (p: string, dir: boolean, x: { kind: string; mode: string }) => x.kind === "mode" ? `${p} can be read by other users (mode ${x.mode}); fix: chmod ${dir ? "700" : "600"} '${p}'`
    : x.kind === "owner" ? `${p} belongs to another user` : `${p} must be a ${dir ? "folder" : "file"}, not a link: remove it and issue the grant again on Studio's board`;
  for (const [p, dir] of [[join(file, ".."), true], [file, false]] as const) {
    let x; try { x = privateProblem(p, dir); } catch { throw new NoGrant(`cannot read the grant file ${file}`); }
    if (x) throw new NoGrant(`not using the grant: ${fix(p, dir, x)}`); }
}
function readGrant(file: string): CliGrantFile {
  privateGrant(file);
  let g: any; try { g = JSON.parse(readFileSync(file, "utf8")); } catch { throw new NoGrant(`cannot read the grant file ${file}`); }
  if (!g || g.schema !== 1 || typeof g.token !== "string" || typeof g.url !== "string") throw new NoGrant(`${file} is not a Studio grant file`);
  if (!loopbackUrl(g.url)) throw new NoGrant(`not using the grant ${file}: its address ${shown(g.url)} is not this Mac (Studio is reached only at 127.0.0.1, [::1] or localhost)`);
  return g;
}
/** The grant this CLI uses: --grant, then CREW_STUDIO_GRANT, then the only file in the grants folder. */
export function findGrant(flag: string | null, env = process.env): FoundGrant {
  const dir = cliGrantsDir(), pick = flag ?? env.CREW_STUDIO_GRANT ?? null;
  // a path is shown and checked as the absolute path it resolves to (a relative CREW_STUDIO_GRANT reads from the current folder)
  if (pick) { const file = isPath(pick) ? resolve(pick) : join(dir, `${pick.replace(/\.json$/, "")}.json`);
    if (!existsSync(file)) throw new NoGrant(`no grant ${isPath(pick) ? file : `named ${pick}`} (${isPath(pick) ? "no such file" : `nothing in ${dir}`})`); return { file, grant: readGrant(file) }; }
  let files: string[] = []; try { files = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => join(dir, f)).filter((f) => statSync(f).isFile()); } catch {}
  if (files.length === 1) return { file: files[0], grant: readGrant(files[0]) };
  if (!files.length) throw new NoGrant(`no grant: issue one on Studio's board (Settings → External CLI grants); it lands in ${dir}`);
  throw new NoGrant(`${files.length} grants in ${dir}: say which with --grant <name> or CREW_STUDIO_GRANT (${files.map((f) => basename(f, ".json")).join(", ")})`);
}
