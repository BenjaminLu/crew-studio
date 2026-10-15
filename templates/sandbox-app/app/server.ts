// `bun run dev`: Corner Shop on http://localhost:4310 (PORT to change it). The
// currency and the basket live in the query string, so every view is a link.
import { CURRENCIES, parseCart, renderShop, serverLinks, type Currency } from "./shop";

const port = Number(process.env.PORT ?? 4310);
const server = Bun.serve({
  port, hostname: "127.0.0.1",
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname !== "/") return new Response("not found", { status: 404 });
    const c = url.searchParams.get("currency") as Currency;
    const currency: Currency = CURRENCIES.includes(c) ? c : "USD";
    const cart = parseCart(url.searchParams.get("cart"));
    return new Response(renderShop({ currency, cart, links: serverLinks(currency, cart) }), { headers: { "content-type": "text/html; charset=utf-8" } });
  },
});
console.log(`Corner Shop: http://localhost:${server.port}`);
