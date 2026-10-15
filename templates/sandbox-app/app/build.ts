// `bun app/build.ts [out]`: Corner Shop as static pages (out/app by default): index.html
// in dollars and jpy.html in yen, the default basket, linked to each other. Crew
// Studio captures these on the base and on the head of a change to show what moved.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_CART, renderShop, type Currency } from "./shop";

const out = process.argv[2] ?? "out/app";
mkdirSync(out, { recursive: true });
const file = (c: Currency) => (c === "USD" ? "index.html" : "jpy.html");
for (const currency of ["USD", "JPY"] as Currency[]) {
  writeFileSync(join(out, file(currency)), renderShop({ currency, cart: { ...DEFAULT_CART }, links: { currency: file, cart: null } }));
}
console.log(`built ${out}/index.html and ${out}/jpy.html`);
