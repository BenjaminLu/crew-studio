import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// A card is answered once it is ready (fix-smoke-r1 #3): a card shows as soon as it is
// raised, and its node finishes raising it (its STE checks) a moment later. An answer
// that arrives in between waits for that, through a readiness promise (no polling),
// and goes through; one that would wait longer than cardReadyMs is refused with a
// clear error, and the same answer later goes through.      bun tests/card-ready.ts
import { harness, suite, until, Y } from "./rt-harness";
const { ok, end } = suite("card-ready");
const flow = (id: string, extra: any = {}) => Y({ id, name: id, roles: [], nodes: [{ id: "c", kind: "card", label: "Q", ...extra, card: { title: "Ship it?", options: [{ id: "go", label: "Go" }] }, x: 0, y: 0 }, { id: "e", kind: "hook", label: "E", x: 1, y: 0 }], edges: [["c", "e", "go"]] });
const H = await harness([flow("q"), flow("qr", { retries: 1 })]);
const E = H.engine as any;
// the card's STE check takes a while
let delay = 800; const orig = E.runCheck.bind(E);
E.runCheck = async (x: any, ref: any, at: string, input: any) => { if (String(at).startsWith("card:")) await new Promise((r) => setTimeout(r, delay)); return orig(x, ref, at, input); };
{ const r = E.start({ workflow: "q", text: "x" }); await until(() => E.cards.list({ run: r.id }).length > 0, 5000);
  const c = E.cards.list({ run: r.id })[0]; const t0 = Date.now(); let err = "";
  await E.answer(c.id, { choice: "go", by: "captain" }).catch((e: any) => (err = e.message));
  await until(() => E.get(r.id).status === "succeeded", 5000);
  ok(!err && Date.now() - t0 >= 300 && E.get(r.id).status === "succeeded", "an answer that arrives while the card is still being raised waits for it, then goes through", err); }
{ delay = 1500; E.cardReadyMs = 200;
  const r = E.start({ workflow: "q", text: "x" }); await until(() => E.cards.list({ run: r.id }).length > 0, 5000);
  const c = E.cards.list({ run: r.id })[0]; let err = "";
  await E.answer(c.id, { choice: "go", by: "captain" }).catch((e: any) => (err = e.message));
  ok(/still being raised/.test(err) && E.cards.get(c.id).status === "open", "one that would wait longer than cardReadyMs is refused with a clear error; the card stays open", err);
  await until(() => E.get(r.id).nodes.c.waiting === "card", 5000);
  await E.answer(c.id, { choice: "go", by: "captain" }); await until(() => E.get(r.id).status === "succeeded", 5000);
  ok(E.get(r.id).status === "succeeded", "the same answer, once the card is ready, goes through"); }
// a card node with retries: its first attempt raised a card, then failed; the stale card is refused at once, and nothing is left raising
{ delay = 0; E.cardReadyMs = 30_000; const origCard = E.card.bind(E); let first = true;
  E.card = async (x: any, kind: any, b: any) => { const c = await origCard(x, kind, b); if (x.run.workflow === "qr" && first) { first = false; throw new Error("raising failed after the card was made"); } return c; };
  const r = E.start({ workflow: "qr", text: "x" }); await until(() => E.get(r.id).nodes.c.waiting === "card", 10000);
  const cards = E.cards.list({ run: r.id }).sort((a: any, b: any) => a.createdAt.localeCompare(b.createdAt)); const stale = cards[0]; const t0 = Date.now(); let err = "";
  await E.answer(stale.id, { choice: "go", by: "captain" }).catch((e: any) => (err = e.message));
  ok(cards.length === 2 && E.cards.get(stale.id).status === "cancelled" && /not the one its node waits on|cancelled/.test(err) && Date.now() - t0 < 1000, "a card raised by a failed attempt is cancelled, and an answer to it is refused at once (not after cardReadyMs)", JSON.stringify([cards.length, err, Date.now() - t0]));
  await E.answer(E.get(r.id).nodes.c.card, { choice: "go", by: "captain" }); await until(() => E.get(r.id).status === "succeeded", 5000);
  ok(E.raising.size === 0, "every card's readiness is settled: nothing is left raising", String(E.raising.size)); E.card = origCard; }
{ const src = await Bun.file(new URL("../src/runtime/engine.ts", import.meta.url)).text();
  ok(!/for \(let i = 0; i < \d+ && this\.live\.has/.test(src), "the answer path does not poll"); }
H.stop();
end();
