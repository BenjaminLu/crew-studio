// Copies opencc-js's browser build into public/vendor, where Studio serves it and the
// binary embeds it (no CDN). Run after changing the pinned opencc-js version in
// package.json; tests/zh-cn.ts fails while the copy and node_modules differ.
//   bun scripts/vendor-opencc.ts
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const root = join(import.meta.dir, ".."), pkg = join(root, "node_modules/opencc-js");
const version = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8")).version;
const out = join(root, "public/vendor", `opencc-js-${version}-t2cn.min.js`);
copyFileSync(join(pkg, "dist/umd/t2cn.js"), out);
writeFileSync(join(root, "public/vendor/opencc-js-LICENSE.txt"), [readFileSync(join(pkg, "LICENSE"), "utf8"), "\n----\n\n", readFileSync(join(pkg, "THIRD_PARTY_LICENSES.md"), "utf8")].join(""));
console.log(`vendored opencc-js ${version} -> ${out}`);
