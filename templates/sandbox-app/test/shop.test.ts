import { expect, test } from "bun:test";
import { parseCart, renderShop, serverLinks, totals } from "../app/shop";

test("the shop page renders the products, the basket and the total in dollars", () => {
  const cart = parseCart("tea:1,mug:2");
  const html = renderShop({ currency: "USD", cart, links: serverLinks("USD", cart) });
  expect(html).toContain("Corner Shop");
  expect(html).toContain('data-product="plant"');
  expect(html).toContain('data-line="mug"');
  expect(html).toContain("<b data-total>$32.50</b>");
});

test("the currency switch links keep the basket", () => {
  const cart = parseCart("notebook:3");
  const html = renderShop({ currency: "USD", cart, links: serverLinks("USD", cart) });
  expect(html).toContain('href="/?currency=JPY&amp;cart=notebook%3A3"');
});

test("the yen view converts at the demo rate", () => {
  expect(totals(parseCart("tea:1"), "JPY").total).toBe(1275);
});

test("a basket ignores unknown products and bad counts", () => {
  expect(parseCart("tea:2,ghost:4,mug:x")).toEqual({ tea: 2 });
});
