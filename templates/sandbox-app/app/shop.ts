// Corner Shop: a small shop page that shows money-kit on screen. Every price, the
// cart lines and the total go through format() from ../src/money, so a change to
// the library shows here. Prices are kept in US cents; the yen view converts at a
// fixed demo rate and asks format() for yen.
import { add, format } from "../src/money";

export type Currency = "USD" | "JPY";
export const CURRENCIES: Currency[] = ["USD", "JPY"];
export type Product = { id: string; name: string; note: string; cents: number; hue: number; mark: string };
export const PRODUCTS: Product[] = [
  { id: "tea", name: "Loose-leaf tea", note: "100 g tin, green", cents: 850, hue: 150, mark: "Te" },
  { id: "mug", name: "Stoneware mug", note: "350 ml, glazed", cents: 1200, hue: 205, mark: "Mu" },
  { id: "notebook", name: "Dot notebook", note: "A5, 120 pages", cents: 475, hue: 40, mark: "No" },
  { id: "plant", name: "Desk plant", note: "pothos in a clay pot", cents: 1999, hue: 110, mark: "Pl" },
  { id: "candle", name: "Soy candle", note: "fig and cedar, 30 h", cents: 1550, hue: 15, mark: "Ca" },
  { id: "socks", name: "Wool socks", note: "one pair, size M", cents: 925, hue: 265, mark: "So" },
];
/** Yen per US cent at the demo rate (150 yen to the dollar). */
export const YEN_PER_CENT = 1.5;
export const amountIn = (cents: number, currency: Currency): number => (currency === "JPY" ? Math.round(cents * YEN_PER_CENT) : cents);
/** A price in the chosen currency, written by money-kit's format(). */
export const price = (cents: number, currency: Currency): string =>
  currency === "JPY" ? (format as (amount: number, currency?: string) => string)(amountIn(cents, "JPY"), "JPY") : format(cents);

export type Cart = Record<string, number>;
export const DEFAULT_CART: Cart = { tea: 1, mug: 2, notebook: 1 };
export function parseCart(s: string | null | undefined): Cart {
  if (s == null) return { ...DEFAULT_CART };
  const cart: Cart = {};
  for (const part of s.split(",")) { const [id, n] = part.split(":"); const q = Math.max(0, Math.min(99, Number(n) || 0)); if (q && PRODUCTS.some((p) => p.id === id)) cart[id] = q; }
  return cart;
}
export const cartText = (cart: Cart) => Object.entries(cart).filter(([, n]) => n > 0).map(([id, n]) => `${id}:${n}`).join(",");
export function totals(cart: Cart, currency: Currency) {
  const lines = PRODUCTS.filter((p) => cart[p.id]).map((p) => ({ product: p, qty: cart[p.id], amount: amountIn(p.cents, currency) * cart[p.id] }));
  const total = add(...lines.map((l) => l.amount));
  return { lines, total, count: lines.reduce((n, l) => n + l.qty, 0) };
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** How the page links: the dev server keeps the state in the query; a static build links its pages and has no cart buttons. */
export type Links = { currency: (c: Currency) => string; cart: ((cart: Cart) => string) | null };
export const serverLinks = (currency: Currency, cart: Cart): Links => ({
  currency: (c) => `/?currency=${c}&cart=${encodeURIComponent(cartText(cart))}`,
  cart: (next) => `/?currency=${currency}&cart=${encodeURIComponent(cartText(next))}`,
});

export function renderShop(o: { currency: Currency; cart: Cart; links: Links }): string {
  const { currency, cart, links } = o; const t = totals(cart, currency);
  const amount = (n: number) => (currency === "JPY" ? (format as (amount: number, currency?: string) => string)(n, "JPY") : format(n));
  const step = (id: string, d: number) => { const next = { ...cart, [id]: Math.max(0, (cart[id] ?? 0) + d) }; return links.cart ? links.cart(next) : null; };
  const btn = (href: string | null, label: string, cls: string, aria: string) => (href ? `<a class="${cls}" href="${esc(href)}" aria-label="${esc(aria)}">${label}</a>` : `<span class="${cls} off" aria-hidden="true">${label}</span>`);
  const cards = PRODUCTS.map((p) => `
      <article class="item" data-product="${p.id}">
        <div class="art" style="--h:${p.hue}"><span>${p.mark}</span></div>
        <div class="meta"><h3>${esc(p.name)}</h3><p>${esc(p.note)}</p></div>
        <div class="buy"><b class="price" data-price="${p.id}">${esc(price(p.cents, currency))}</b>${btn(step(p.id, 1), "Add", "add", `Add ${p.name}`)}</div>
      </article>`).join("");
  const lines = t.lines.length ? t.lines.map((l) => `
        <li data-line="${l.product.id}"><span class="dot" style="--h:${l.product.hue}"></span><span class="ln">${esc(l.product.name)}</span>
          <span class="qty">${btn(step(l.product.id, -1), "−", "q", `One less ${l.product.name}`)}<b>${l.qty}</b>${btn(step(l.product.id, 1), "+", "q", `One more ${l.product.name}`)}</span>
          <span class="la">${esc(amount(l.amount))}</span></li>`).join("") : `<li class="empty">Your basket is empty.</li>`;
  const seg = CURRENCIES.map((c) => `<a href="${esc(links.currency(c))}" class="${c === currency ? "on" : ""}" data-currency="${c}"${c === currency ? ' aria-current="true"' : ""}>${c === "USD" ? "$ USD" : "¥ JPY"}</a>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Corner Shop</title>
<style>
  :root { --bg: #f7f5f0; --card: #ffffff; --ink: #1d2433; --soft: #667085; --line: #e7e3da; --accent: #2f6fed; --accent-ink: #ffffff; }
  * { box-sizing: border-box; } body { margin: 0; font: 15px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--ink); }
  header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 18px 28px; background: var(--card); border-bottom: 1px solid var(--line); position: sticky; top: 0; }
  .brand { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 18px; } .logo { width: 30px; height: 30px; border-radius: 9px; background: linear-gradient(135deg, #ffb547, #ff6a3d); }
  .seg { display: inline-flex; background: #eef0f4; border-radius: 999px; padding: 3px; } .seg a { padding: 6px 14px; border-radius: 999px; color: var(--soft); text-decoration: none; font-weight: 600; font-size: 13px; }
  .seg a.on { background: var(--card); color: var(--ink); box-shadow: 0 1px 3px rgba(16, 24, 40, .12); }
  main { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 24px; padding: 28px; max-width: 1180px; margin: 0 auto; }
  .hero h1 { margin: 0 0 4px; font-size: 28px; letter-spacing: -.01em; } .hero p { margin: 0 0 20px; color: var(--soft); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; }
  .item { background: var(--card); border: 1px solid var(--line); border-radius: 16px; overflow: hidden; display: flex; flex-direction: column; }
  .art { height: 120px; display: grid; place-items: center; background: linear-gradient(140deg, hsl(var(--h) 70% 88%), hsl(var(--h) 60% 74%)); }
  .art span { font-size: 30px; font-weight: 800; color: hsl(var(--h) 45% 30%); opacity: .8; }
  .meta { padding: 12px 14px 4px; } .meta h3 { margin: 0; font-size: 15px; } .meta p { margin: 2px 0 0; color: var(--soft); font-size: 13px; }
  .buy { display: flex; align-items: center; justify-content: space-between; padding: 10px 14px 14px; margin-top: auto; } .price { font-size: 17px; }
  .add { background: var(--accent); color: var(--accent-ink); text-decoration: none; padding: 6px 14px; border-radius: 999px; font-weight: 600; font-size: 13px; }
  .off { opacity: .45; } aside { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 18px; align-self: start; position: sticky; top: 88px; }
  aside h2 { margin: 0 0 12px; font-size: 17px; display: flex; justify-content: space-between; } aside h2 small { color: var(--soft); font-weight: 500; font-size: 13px; }
  ul { list-style: none; margin: 0; padding: 0; } li { display: grid; grid-template-columns: 10px minmax(0, 1fr) auto auto; gap: 10px; align-items: center; padding: 10px 0; border-bottom: 1px dashed var(--line); }
  li.empty { display: block; color: var(--soft); } .dot { width: 10px; height: 10px; border-radius: 50%; background: hsl(var(--h) 60% 60%); } .ln { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .qty { display: inline-flex; align-items: center; gap: 6px; } .q { width: 24px; height: 24px; display: grid; place-items: center; border-radius: 50%; background: #eef0f4; color: var(--ink); text-decoration: none; font-weight: 700; }
  .la { font-variant-numeric: tabular-nums; min-width: 72px; text-align: right; }
  .total { display: flex; justify-content: space-between; align-items: baseline; margin-top: 14px; font-size: 15px; } .total b { font-size: 24px; letter-spacing: -.01em; }
  .checkout { display: block; text-align: center; margin-top: 14px; background: var(--ink); color: #fff; padding: 11px; border-radius: 12px; font-weight: 600; text-decoration: none; }
  .rate { margin-top: 10px; color: var(--soft); font-size: 12px; text-align: center; }
  @media (max-width: 760px) { main { grid-template-columns: 1fr; padding: 16px; } header { padding: 14px 16px; } aside { position: static; } .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; } }
</style></head>
<body>
  <header><div class="brand"><span class="logo"></span>Corner Shop</div><nav class="seg" aria-label="Currency">${seg}</nav></header>
  <main>
    <section><div class="hero"><h1>Small things, well made</h1><p>Prices shown in ${currency === "USD" ? "US dollars" : "Japanese yen"}.</p></div>
      <div class="grid">${cards}
      </div></section>
    <aside aria-label="Basket"><h2>Basket <small>${t.count} item${t.count === 1 ? "" : "s"}</small></h2>
      <ul>${lines}
      </ul>
      <div class="total"><span>Total</span><b data-total>${esc(amount(t.total))}</b></div>
      <span class="checkout">Check out</span>
      ${currency === "JPY" ? `<p class="rate">Demo rate: ¥150 to the dollar.</p>` : ""}
    </aside>
  </main>
</body></html>
`;
}
