// Copies xterm.js and its fit addon into public/vendor, where Studio serves them and the binary embeds them (no CDN).
// Run after changing the pinned @xterm/xterm or @xterm/addon-fit version in package.json; tests/terminals-ui.mjs fails
// while the copies and node_modules differ.
//   bun scripts/vendor-xterm.ts
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const root = join(import.meta.dir, ".."), vendor = join(root, "public/vendor");
const ver = (p: string) => JSON.parse(readFileSync(join(root, "node_modules", p, "package.json"), "utf8")).version;
const x = ver("@xterm/xterm"), f = ver("@xterm/addon-fit");
copyFileSync(join(root, "node_modules/@xterm/xterm/lib/xterm.js"), join(vendor, `xterm-${x}.min.js`));
copyFileSync(join(root, "node_modules/@xterm/xterm/css/xterm.css"), join(vendor, `xterm-${x}.css`));
copyFileSync(join(root, "node_modules/@xterm/addon-fit/lib/addon-fit.js"), join(vendor, `xterm-addon-fit-${f}.min.js`));
writeFileSync(join(vendor, "xterm-LICENSE.txt"), [`@xterm/xterm ${x}`, readFileSync(join(root, "node_modules/@xterm/xterm/LICENSE"), "utf8"), "----", `@xterm/addon-fit ${f}`, readFileSync(join(root, "node_modules/@xterm/addon-fit/LICENSE"), "utf8")].join("\n\n"));
console.log(`vendored @xterm/xterm ${x} and @xterm/addon-fit ${f} -> public/vendor`);
