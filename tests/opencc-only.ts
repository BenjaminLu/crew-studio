import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Traditional and Simplified Chinese convert through opencc-js only (CONTRIBUTING.md): no tracked file carries its
// own character mapping table. A table shows as many single-character pairs that differ ("說": "说", ["門", "门"])
// or as two long parallel strings of Han characters of the same length. The vendored opencc-js build is the one
// exception. The detector is checked on synthetic tables first, so a broken scan cannot pass.
//   bun tests/opencc-only.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
let pass = 0, fail = 0;
const ok = (c: boolean, name: string, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const root = join(import.meta.dir, "..");
const HAN = "\\u3400-\\u9fff\\uf900-\\ufaff";
const PAIR = new RegExp(`["'\`]([${HAN}])["'\`]\\s*[:,=]\\s*["'\`]([${HAN}])["'\`]`, "gu");
const RUN = new RegExp(`["'\`]([${HAN}]{30,})["'\`]`, "gu");
/** Why a text looks like an own conversion table, or null. */
function mappingTable(t: string): string | null {
  const pairs = [...t.matchAll(PAIR)].filter((m) => m[1] !== m[2]);
  if (pairs.length >= 12) return `${pairs.length} single-character pairs such as ${pairs[0][0]}`;
  const runs = [...t.matchAll(RUN)].map((m) => m[1]);
  for (let i = 0; i < runs.length; i++) for (let j = i + 1; j < runs.length; j++) if ([...runs[i]].length === [...runs[j]].length && runs[i] !== runs[j]) return `two parallel strings of ${[...runs[i]].length} Han characters`;
  return null;
}
// the detector on synthetic tables (built at run time, so this file is not one)
const t2s = "說说門门國国話话書书車车東东馬马鳥鸟魚鱼語语體体們们";
const asObject = `const T = {${[...Array([...t2s].length / 2).keys()].map((i) => `"${[...t2s][2 * i]}": "${[...t2s][2 * i + 1]}"`).join(", ")}};`;
const trad = [...t2s].filter((_, i) => i % 2 === 0).join("").repeat(3), simp = [...t2s].filter((_, i) => i % 2 === 1).join("").repeat(3);
ok(!!mappingTable(asObject) && !!mappingTable(`const A = "${trad}", B = "${simp}";`) && !mappingTable(`const label = "設定"; const zh = "這是一段很長的說明文字，裡面有標點。"; const a = "門", b = "門";`),
  "the detector finds an object table and parallel strings, and passes ordinary Chinese text");
const files = Bun.spawnSync(["git", "ls-files", "-z"], { cwd: root, stdout: "pipe" }).stdout.toString().split("\0").filter(Boolean)
  .filter((f) => /\.(?:[cm]?[jt]sx?|json|ya?ml|html|py)$/.test(f) && !/^public\/vendor\/opencc-js-/.test(f));
const hits: string[] = [];
for (const f of files) { let t = ""; try { t = readFileSync(join(root, f), "utf8"); } catch { continue; } const why = mappingTable(t); if (why) hits.push(`${f}: ${why}`); }
ok(files.length > 100, `the scan reads every tracked source file (${files.length})`);
ok(!hits.length, "no tracked file carries its own Traditional↔Simplified mapping table: conversion goes through opencc-js", hits.slice(0, 10).join(" | "));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
ok(!!pkg.devDependencies?.["opencc-js"] && /opencc-js\/t2cn/.test(readFileSync(join(root, "src/captain-script.ts"), "utf8")) && /OpenCC\.Converter/.test(readFileSync(join(root, "public/i18n.js"), "utf8")),
  "the converters in use are opencc-js (server: opencc-js/t2cn; UI: the vendored OpenCC build)");
console.log(`\nopencc-only: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
