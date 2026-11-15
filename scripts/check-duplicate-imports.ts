// Every source file under src/ binds each imported name once. Bun runs a file that imports one name twice (from two modules) and
// silently keeps the last binding, so a merge that adds the same name from another module changes behaviour with no
// error anywhere; TypeScript and Node refuse such a file. This check refuses it here, in test:core.
//                                                                         bun scripts/check-duplicate-imports.ts [files…]
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { Glob } from "bun";

const root = join(import.meta.dir, "..");
const files = process.argv.slice(2).length ? process.argv.slice(2) : [...new Glob("src/**/*.{ts,tsx,mts}").scanSync({ cwd: root, absolute: true })].filter((f) => !f.includes("/node_modules/") && !f.endsWith(".gen.ts"));
/** the local names one file's import statements bind, with the line of each */
export function importedNames(src: string): { name: string; line: number }[] {
  const out: { name: string; line: number }[] = [];
  // import <default>, { a, b as c, type d } from "x";  import * as ns from "x";  import type { a } from "x"
  const re = /(^|[\n;])\s*import\b\s*(type\s+)?([^'"`;()]*?)\s*from\s*['"][^'"]+['"]/g;
  for (const m of src.matchAll(re)) {
    const line = src.slice(0, m.index! + m[0].indexOf("import")).split("\n").length;
    let clause = m[3].trim();
    const ns = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(clause); if (ns) { out.push({ name: ns[1], line }); clause = clause.replace(ns[0], ""); }
    const braces = /\{([^}]*)\}/.exec(clause);
    if (braces) { for (const part of braces[1].split(",")) { const p = part.trim().replace(/^type\s+/, ""); if (!p) continue; const as = /\bas\s+([A-Za-z_$][\w$]*)$/.exec(p); out.push({ name: as ? as[1] : p.split(/\s+/)[0], line }); } clause = clause.replace(braces[0], ""); }
    const def = clause.replace(/,/g, " ").trim().split(/\s+/).filter(Boolean)[0]; if (def && /^[A-Za-z_$][\w$]*$/.test(def)) out.push({ name: def, line });
  }
  return out;
}
let bad = 0;
for (const f of files) {
  const seen = new Map<string, number>();
  for (const { name, line } of importedNames(readFileSync(f, "utf8"))) {
    const at = seen.get(name);
    if (at !== undefined) { bad++; console.log(`${relative(root, f)}:${line}: ${name} is imported again (first on line ${at})`); } else seen.set(name, line);
  }
}
if (bad) { console.log(`check-duplicate-imports: ${bad} duplicate import binding(s)`); process.exit(1); }
console.log(`check-duplicate-imports: ${files.length} files, no name imported twice`);
