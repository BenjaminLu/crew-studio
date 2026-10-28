import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Board routes share one `routes` table (public/app.js): a script that registers a name another script owns silently
// takes its page, as the review room once took the Library's #/review/<artifact>/<n>. Every name is registered by one
// script, unless it is listed here with the scripts that layer on it on purpose (each wraps or replaces the one before).
//                                                                                          bun tests/route-names.ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const dir = join(import.meta.dir, "..", "public");
const LAYERED: Record<string, string[]> = {
  board: ["app.js", "backbone.js", "board.js"], inbox: ["app.js", "board.js"], crew: ["app.js", "takeover.js", "team.js", "transcripts.js"],
  workflow: ["app.js", "gates.js"], library: ["m2.js", "m3.js", "skills.js"], remote: ["m25.js", "ootb.js"], runs: ["backbone.js", "runtime.js", "transcripts.js"],
  settings: ["backbone.js", "onboarding.js"], firstmate: ["backbone.js", "takeover.js"], workflows: ["backbone.js", "runtime.js"], run: ["compare.js", "runtime.js"],
};
let pass = 0, fail = 0;
const ok = (c: boolean, name: string, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
// the top-level keys of the object literal that opens at src[at] ("{")
function keys(src: string, at: number): string[] {
  const out: string[] = []; let depth = 0, expectKey = false;
  for (let i = at; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === "`") { const q = ch; for (i++; i < src.length && src[i] !== q; i++) if (src[i] === "\\") i++; continue; }
    if ("{([".includes(ch)) { depth++; if (depth === 1) expectKey = true; continue; }
    if ("})]".includes(ch)) { depth--; if (depth === 0) return out; continue; }
    if (depth === 1 && ch === ",") { expectKey = true; continue; }
    if (depth === 1 && expectKey && /\S/.test(ch)) { const m = /^(?:"([^"]+)"|'([^']+)'|([\w$-]+))\s*:/.exec(src.slice(i)); if (m) out.push(m[1] ?? m[2] ?? m[3]); expectKey = false; }
  }
  return out;
}
const owners = new Map<string, Set<string>>();
const claim = (name: string, f: string) => { if (!owners.has(name)) owners.set(name, new Set()); owners.get(name)!.add(f); };
for (const f of readdirSync(dir).filter((f) => f.endsWith(".js"))) {
  const src = readFileSync(join(dir, f), "utf8");
  for (const m of src.matchAll(/\broutes\.([\w$]+)\s*=(?!=)/g)) claim(m[1], f);
  for (const m of src.matchAll(/\broutes\[\s*["']([^"']+)["']\s*\]\s*=(?!=)/g)) claim(m[1], f);
  for (const m of src.matchAll(/Object\.assign\(\s*routes\s*,\s*\{/g)) for (const k of keys(src, m.index! + m[0].length - 1)) claim(k, f);
  for (const m of src.matchAll(/\bconst routes\s*=\s*\{/g)) for (const k of keys(src, m.index! + m[0].length - 1)) claim(k, f);
}
ok(owners.size > 30, "the scan finds the Board's routes", String(owners.size));
const clashes = [...owners].filter(([n, fs]) => fs.size > 1 && JSON.stringify([...fs].sort()) !== JSON.stringify(LAYERED[n] ?? null)).map(([n, fs]) => `${n}: ${[...fs].sort().join(", ")}`);
ok(!clashes.length, "no script registers a route name another script owns, beyond the listed layering", JSON.stringify(clashes));
ok(JSON.stringify([...(owners.get("review") ?? [])]) === '["m3.js"]', "#/review/<artifact>/<n> is the Library's review page alone", JSON.stringify([...(owners.get("review") ?? [])]));
ok(JSON.stringify([...(owners.get("room") ?? [])]) === '["review-room.js"]', "#/room/<merge card> is the review room's own route", JSON.stringify([...(owners.get("room") ?? [])]));
console.log(`route-names: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
