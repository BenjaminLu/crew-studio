// Copies xterm.js, its fit addon and its Unicode 11 addon into public/vendor, where Studio serves them and the binary
// embeds them (no CDN). Run after changing a pinned @xterm/* version in package.json; tests/terminals-ui.mjs fails while
// the copies and node_modules differ.
//   bun scripts/vendor-xterm.ts
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const root = join(import.meta.dir, ".."), vendor = join(root, "public/vendor");
const ver = (p: string) => JSON.parse(readFileSync(join(root, "node_modules", p, "package.json"), "utf8")).version;
const x = ver("@xterm/xterm"), f = ver("@xterm/addon-fit"), u = ver("@xterm/addon-unicode11");
copyFileSync(join(root, "node_modules/@xterm/xterm/lib/xterm.js"), join(vendor, `xterm-${x}.min.js`));
copyFileSync(join(root, "node_modules/@xterm/xterm/css/xterm.css"), join(vendor, `xterm-${x}.css`));
copyFileSync(join(root, "node_modules/@xterm/addon-fit/lib/addon-fit.js"), join(vendor, `xterm-addon-fit-${f}.min.js`));
copyFileSync(join(root, "node_modules/@xterm/addon-unicode11/lib/addon-unicode11.js"), join(vendor, `xterm-addon-unicode11-${u}.min.js`));
const lic = (p: string) => readFileSync(join(root, "node_modules", p, "LICENSE"), "utf8");
writeFileSync(join(vendor, "xterm-LICENSE.txt"), [`@xterm/xterm ${x}`, lic("@xterm/xterm"), "----", `@xterm/addon-fit ${f}`, lic("@xterm/addon-fit"), "----", `@xterm/addon-unicode11 ${u}`, lic("@xterm/addon-unicode11")].join("\n\n"));
console.log(`vendored @xterm/xterm ${x}, @xterm/addon-fit ${f} and @xterm/addon-unicode11 ${u} -> public/vendor`);
