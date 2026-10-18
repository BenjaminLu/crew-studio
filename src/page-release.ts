// Which page a Board tab runs (live S25): after a deploy an already-open tab kept the old page JS until a manual reload
// (R-069 still showed its old status). Studio names the page it serves with one id: a hash of every file in public/ (the
// copies embedded in a binary), taken once at boot. index.html carries it in <meta name="crew-release">, the stream's hello
// says the current one, and a tab whose id differs reloads itself when that loses nothing, else offers a reload bar.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** The id of the page files: `CREW_PAGE_RELEASE` when set (tests run two "versions" of one checkout), else their hash. */
export function pageRelease(o: { compiled: boolean; assets: Record<string, string>; publicDir: string }): string {
  if (process.env.CREW_PAGE_RELEASE) return process.env.CREW_PAGE_RELEASE.slice(0, 64);
  const h = createHash("sha256");
  const add = (rel: string, file: string) => { try { h.update(rel); h.update("\0"); h.update(readFileSync(file)); h.update("\0"); } catch {} };
  if (o.compiled) for (const rel of Object.keys(o.assets).sort()) add(rel, o.assets[rel]);
  else {
    const walk = (dir: string, rel: string): string[] => readdirSync(dir).sort().flatMap((n) => { const f = join(dir, n); return statSync(f).isDirectory() ? walk(f, `${rel}/${n}`) : [`${rel}/${n}`]; });
    try { for (const rel of walk(o.publicDir, "")) add(rel, join(o.publicDir, rel)); } catch {}
  }
  return h.digest("hex").slice(0, 16);
}

/** index.html as served: its crew-release meta filled with the id (the file itself ships it empty). */
export const withRelease = (html: string, id: string) => html.replace('<meta name="crew-release" content="">', `<meta name="crew-release" content="${id.replace(/[^A-Za-z0-9._-]/g, "")}">`);
