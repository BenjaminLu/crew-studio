// Built-in workflows, domain packs and skins: read from the checkout, or from the
// copies embedded in the single binary (src/bundled.gen.ts).
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { COMPILED, SRC_ROOT } from "./self";

let embedded: Record<string, string> | null = null;
const emb = async () => (embedded ??= (await import("./bundled.gen")).BUNDLED);
if (COMPILED) await emb();

/** Every bundled file path (relative to the checkout) under a prefix such as "packs/". */
export function bundledList(prefix: string): string[] {
  if (COMPILED) return Object.keys(embedded!).filter((k) => k.startsWith(prefix)).sort();
  const out: string[] = [];
  const walk = (d: string) => { if (!existsSync(d)) return; for (const f of readdirSync(d).sort()) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (!f.startsWith(".")) out.push(relative(SRC_ROOT, p).split(sep).join("/")); } };
  walk(join(SRC_ROOT, prefix));
  return out;
}
export function bundledBytes(rel: string): Buffer | null {
  try { return COMPILED ? (embedded![rel] ? readFileSync(embedded![rel]) : null) : readFileSync(join(SRC_ROOT, rel)); } catch { return null; }
}
export const bundledText = (rel: string) => bundledBytes(rel)?.toString("utf8") ?? null;
export const parseYaml = (t: string): any => (Bun as any).YAML.parse(t);
