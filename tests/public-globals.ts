import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Board scripts are classic scripts sharing one global scope: a top-level const named like a
// browser global (scard.js once had `const CSS = …`) shadows it for every script, so CSS.escape broke.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const dir = join(import.meta.dir, "..", "public");
const GLOBALS = ["CSS", "URL", "Image", "Event", "Node", "Element", "Map", "Set", "JSON", "Math", "Date", "Intl", "Option", "Audio", "File", "Blob", "Request", "Response", "Headers", "Location", "History", "Storage", "Text", "Range", "Selection", "Notification", "Worker"];
let pass = 0, fail = 0;
const bad: string[] = [];
for (const f of readdirSync(dir).filter((f) => f.endsWith(".js"))) {
  const src = readFileSync(join(dir, f), "utf8");
  for (const g of GLOBALS) if (new RegExp(`^(?:const|let|var|function|class)\\s+${g}\\b`, "m").test(src)) bad.push(`${f}: top-level ${g}`);
}
if (bad.length) { fail++; console.log("  FAIL  no public script shadows a browser global", JSON.stringify(bad)); } else { pass++; console.log("  ok    no public script shadows a browser global"); }
const scard = readFileSync(join(dir, "scard.js"), "utf8");
if (/CSS\.escape\(/.test(scard) && !/^const CSS\b/m.test(scard)) { pass++; console.log("  ok    scard.js keeps the browser's CSS for CSS.escape"); } else { fail++; console.log("  FAIL  scard.js keeps the browser's CSS for CSS.escape"); }
console.log(`public-globals: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
