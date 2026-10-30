import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// A figure the review room's tutor draws itself (src/domain/figure-svg.ts; workflows/skills/diagram-design): what Studio keeps
// of its SVG (an allowlist of elements and attributes, colours only as the room's tokens, size caps), and the geometric gate
// that refuses a figure a reader cannot follow: a label on a label, a label on a line, a connector through a box that is not
// one of its ends, a label outside the picture, Chinese under 12px, a label without its three languages. Also a transition's
// transaction (txOf) and the diff lines that write a state column (stateWrites).                bun tests/review-room-figures.ts
import { figureGate, sanitizeFigure, type FigNode } from "../src/domain/figure-svg";
import { stateWrites, txOf } from "../src/domain/review-room";
let pass = 0, fail = 0;
const ok = (c: boolean, name: string, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const t = (x: number, y: number, s: string, fs = 12, more = "") => `<text x="${x}" y="${y}" text-anchor="middle" font-size="${fs}" fill="var(--fig-ink)" data-en="${s}" data-hant="${s}" data-hans="${s}"${more}>${s}</text>`;
const box = (id: string, x: number, y: number, w = 100, h = 40) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="var(--fig-card)" stroke="var(--fig-ink)" data-node="${id}"/>`;
const fig = (body: string, vb = "0 0 400 200") => `<svg viewBox="${vb}" role="img"><defs><marker id="ar" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="var(--fig-muted)"/></marker></defs>${body}</svg>`;
const good = fig(`<path d="M120,60 H280" fill="none" stroke="var(--fig-muted)" marker-end="url(#ar)" data-edge="a>b"/>${box("a", 20, 40)}${t(70, 64, "Draft")}${box("b", 280, 40)}${t(330, 64, "Paid")}${t(200, 44, "pay")}`);
const gateOf = (svg: string) => { const r = sanitizeFigure(svg); return r.tree ? figureGate(r.tree) : r.errors; };
const all = (n: FigNode, out: FigNode[] = []) => { out.push(n); for (const c of n.c) if (typeof c !== "string") all(c, out); return out; };

// ---------- the sanitiser ----------
{ const r = sanitizeFigure(good);
  ok(!!r.tree && !r.errors.length && !r.stripped.length && JSON.stringify(r.nodes) === '["a","b"]' && JSON.stringify(r.edges) === '["a>b"]' && !gateOf(good).length,
    "a figure drawn by the rules is taken whole: its boxes and connectors named, nothing dropped, the gate passes", JSON.stringify({ e: r.errors, s: r.stripped, g: gateOf(good) })); }
{ const evil = fig(`<script>alert(1)</script><foreignObject><div>x</div></foreignObject><style>*{}</style><a href="https://x.example"><text>link</text></a><image href="https://x.example/i.png"/><use href="#ar"/>
    <rect x="1" y="1" width="2" height="2" fill="var(--fig-ink)" onclick="steal()" style="fill:red" href="javascript:x" class="c" filter="url(https://x.example/f)"/>
    <path d="M0,0 L10,10" fill="none" stroke="var(--fig-muted)" marker-end="url(https://x.example/m)" data-edge="a>b"/><text x="5" y="190" font-size="12" font-family="Comic Sans" data-en="ok" data-hant="ok" data-hans="ok">ok</text>`);
  const r = sanitizeFigure(evil), names = r.tree ? all(r.tree).map((n) => n.t) : [], attrs = r.tree ? all(r.tree).flatMap((n) => Object.keys(n.a)) : [];
  ok(!!r.tree && ["script", "foreignObject", "style", "a", "image", "use"].every((x) => !names.includes(x)) && !names.includes("div") && ["onclick", "style", "href", "class", "filter", "marker-end", "font-family"].every((x) => !attrs.includes(x)),
    "anything off the allowlist is dropped (script, foreignObject, style, links, images, use; on* handlers, style, href, class, filters, outside url() references, other fonts), and each drop reported", JSON.stringify({ names, attrs, stripped: r.stripped }));
  ok(["<script>", "<foreignObject>", "<style>", "<a>", "<image>", "<use>", "rect onclick", "rect style", "rect href"].every((x) => r.stripped.includes(x)), "the tutor is told what was dropped", JSON.stringify(r.stripped)); }
{ const red = sanitizeFigure(fig(`<rect x="1" y="1" width="2" height="2" fill="#ff0000"/>`)), rgb = sanitizeFigure(fig(`<path d="M0,0 L1,1" stroke="rgb(1,2,3)" fill="none"/>`));
  ok(red.errors.some((e) => /colours are only the room's tokens/.test(e)) && rgb.errors.length > 0, "a colour that is not one of the room's tokens is refused (the page owns light and dark)", JSON.stringify([red.errors, rgb.errors])); }
{ const doc = sanitizeFigure(`<!DOCTYPE svg><svg viewBox="0 0 10 10"></svg>`), big = sanitizeFigure(`<svg viewBox="0 0 10 10">${"<g></g>".repeat(12000)}</svg>`), open = sanitizeFigure(`<svg viewBox="0 0 10 10"><g>`), two = sanitizeFigure(`<svg viewBox="0 0 10 10"></svg><svg viewBox="0 0 10 10"></svg>`), nob = sanitizeFigure(`<svg></svg>`), huge = sanitizeFigure(`<svg viewBox="0 0 9000 10"></svg>`);
  ok(doc.errors.length && big.errors.length && open.errors.length && two.errors.length && nob.errors.length && huge.errors.length, "no DOCTYPE, no figure over its size caps, nothing unclosed, one <svg> with a viewBox of a sane size", JSON.stringify([doc.errors, big.errors[0], open.errors, two.errors, nob.errors, huge.errors])); }
{ const r = sanitizeFigure(fig(`<text x="10" y="20" font-size="12" data-en="&lt;b&gt;x" data-hant="x" data-hans="x">&lt;img src=x onerror=alert(1)&gt;</text>`)), txt = r.tree ? all(r.tree).find((n) => n.t === "text") : null;
  ok(!!txt && txt.c[0] === "<img src=x onerror=alert(1)>" && !("data-en" in txt.a), "text stays text: entities decoded into words, never markup (the page sets them as text nodes); a language attribute holding < or > is dropped", JSON.stringify(txt)); }

// ---------- the geometric gate ----------
{ const overlapG = gateOf(fig(`${t(100, 100, "one")}${t(110, 102, "two")}`)), onLine = gateOf(fig(`<path d="M10,100 H390" fill="none" stroke="var(--fig-muted)"/>${t(200, 104, "on the line")}`));
  const through = gateOf(fig(`<path d="M70,60 H330" fill="none" stroke="var(--fig-muted)" data-edge="a>b"/>${box("a", 20, 40)}${box("c", 160, 40, 80)}${box("b", 280, 40)}`)), outside = gateOf(fig(`${t(395, 100, "outside")}`));
  const small = gateOf(fig(`<text x="100" y="100" font-size="10" data-en="Paid" data-hant="已付款" data-hans="已付款">Paid</text>`)), langs = gateOf(fig(`<text x="100" y="100" font-size="12">Paid</text>`));
  ok(overlapG.some((e) => /overlaps text/.test(e)), "a label on another label is refused", JSON.stringify(overlapG));
  ok(onLine.some((e) => /sits on a line/.test(e)), "a label on a line is refused (6–10px off its connector)", JSON.stringify(onLine));
  ok(through.some((e) => /passes through "c"/.test(e)), "a connector through a box that is not one of its ends is refused", JSON.stringify(through));
  ok(outside.some((e) => /outside the viewBox/.test(e)), "a label outside the picture is refused", JSON.stringify(outside));
  ok(small.some((e) => /at least 12px/.test(e)), "Chinese text under 12px is refused", JSON.stringify(small));
  ok(langs.some((e) => /data-en, data-hant and data-hans/.test(e)), "a label without its three languages is refused", JSON.stringify(langs));
  const routed = gateOf(fig(`<path d="M70,80 V160 H330 V80" fill="none" stroke="var(--fig-muted)" data-edge="a>b"/>${box("a", 20, 40)}${box("c", 160, 40, 80)}${box("b", 280, 40)}`, "0 0 400 200"));
  ok(!routed.length, "routed around the box in the middle, the same connector passes", JSON.stringify(routed)); }

// ---------- the gate is bounded: a figure built to exhaust it is refused at once ----------
{ const zig = "M0,0" + " L99999,99999 L0,0".repeat(330), paths = Array.from({ length: 13 }, () => `<path d="${zig}" fill="none" stroke="var(--fig-muted)"/>`).join("");
  const svg = fig(paths), r = sanitizeFigure(svg); (globalThis as any).Bun?.gc?.(true);
  const heap0 = process.memoryUsage().heapUsed, t0 = performance.now(), g = r.tree ? figureGate(r.tree) : r.errors, ms = performance.now() - t0, grew = process.memoryUsage().heapUsed - heap0;
  ok(svg.length < 80_000 && !!r.tree && g.length === 1 && /outside the viewBox/.test(g[0]) && ms < 50 && grew < 32 * 1024 * 1024,
    "a path drawn far outside its picture (13 of them, under the size cap) is refused at its first coordinate: fast, nothing huge allocated", JSON.stringify({ len: svg.length, g, ms: Math.round(ms), grewMB: Math.round(grew / 1048576) }));
  const inside = "M0,0" + " L399,199 L0,0".repeat(400), many = Array.from({ length: 13 }, () => `<path d="${inside}" fill="none" stroke="var(--fig-muted)"/>`).join(""), r2 = sanitizeFigure(fig(many));
  const t1 = performance.now(), g2 = r2.tree ? figureGate(r2.tree) : r2.errors, ms2 = performance.now() - t1;
  ok(!!r2.tree && g2.length === 1 && /too much line to check/.test(g2[0]) && ms2 < 50, "inside the picture but too long to check: refused by the points budget, with a reason to redraw, fast", JSON.stringify({ g2, ms: Math.round(ms2) }));
  const far = gateOf(fig(`<rect x="0" y="0" width="99999" height="20" fill="var(--fig-card)"/>`)), farLine = gateOf(fig(`<line x1="0" y1="0" x2="9000" y2="10" stroke="var(--fig-muted)"/>`));
  ok(/outside the viewBox/.test(far[0] ?? "") && /outside the viewBox/.test(farLine[0] ?? ""), "a box or a line reaching far outside the viewBox is refused", JSON.stringify({ far, farLine })); }

// ---------- what the gate measures is what the page draws ----------
{ // pairs after a moveto are linetos (and every command repeats with its pairs): M20,20 380,180 is a line
  const implicit = gateOf(fig(`<path d="M20,20 380,180" fill="none" stroke="var(--fig-muted)" data-edge="a>b"/>${box("a", 0, 0, 30, 30)}${box("c", 170, 80, 60, 40)}${box("b", 370, 170, 30, 30)}`));
  const repeated = gateOf(fig(`<path d="M20,20 L100,20 380,180" fill="none" stroke="var(--fig-muted)" data-edge="a>b"/>${box("a", 0, 0, 30, 30)}${box("c", 220, 90, 60, 40)}${box("b", 370, 170, 30, 30)}`));
  ok(implicit.some((e) => /passes through "c"/.test(e)) && repeated.some((e) => /passes through "c"/.test(e)), "a path's implicit lines are lines: after a moveto, and a lineto's repeated pairs (through a box is refused)", JSON.stringify({ implicit, repeated })); }
{ // an open path is a connector whatever its fill; a closed filled shape is not
  const openFilled = gateOf(fig(`<path d="M70,60 H330" stroke="var(--fig-muted)" data-edge="a>b"/>${box("a", 20, 40)}${box("c", 160, 40, 80)}${box("b", 280, 40)}`));
  const closedShape = gateOf(fig(`<path d="M150,30 H250 V90 H150 Z" fill="var(--fig-card-2)"/>${t(200, 64, "inside a panel")}`));
  ok(openFilled.some((e) => /passes through "c"/.test(e)) && !closedShape.length, "a path without fill=\"none\" is still a connector (through a box is refused); a closed filled shape is a panel, not a line", JSON.stringify({ openFilled, closedShape }));
  // tspans: each line at its own x/y (dy below the last), measured with its own languages
  const L = (dy: number, s: string, more = "") => `<tspan x="200" dy="${dy}" data-en="${s}" data-hant="${s}" data-hans="${s}"${more}>${s}</tspan>`;
  const twoLines = gateOf(fig(`<text x="200" y="80" text-anchor="middle" font-size="12" fill="var(--fig-ink)">${L(0, "first line")}${L(18, "second line")}</text>`));
  const stacked = gateOf(fig(`<text x="200" y="80" text-anchor="middle" font-size="12" fill="var(--fig-ink)">${L(0, "first line")}${L(2, "second line")}</text>`));
  const offPicture = gateOf(fig(`<text x="200" y="80" font-size="12" fill="var(--fig-ink)">${L(0, "first")}<tspan x="390" dy="18" data-en="second" data-hant="second" data-hans="second">second</tspan></text>`));
  const noLangs = gateOf(fig(`<text x="200" y="80" font-size="12" fill="var(--fig-ink)">${L(0, "first")}<tspan x="200" dy="18">second</tspan></text>`));
  ok(!twoLines.length && stacked.some((e) => /overlaps text/.test(e)) && offPicture.some((e) => /"second" runs outside/.test(e)) && noLangs.some((e) => /"second" needs data-en/.test(e)),
    "a label of several lines (tspans) is measured line by line at each line's x/y/dy: two lines apart pass, two on each other, one past the edge or one without its languages are refused", JSON.stringify({ twoLines, stacked, offPicture, noLangs })); }

// ---------- a transition's transaction; the diff lines that move a state ----------
{ const tx = txOf({ tables: [{ table: "orders", op: "update", guard: "WHERE status='awaiting'", fields: [{ k: "status", was: "awaiting", now: "authorized" }] }], outside: [{ what: "PSP authorize", kind: "call" }] }) as any;
  const bad = txOf({ tables: [{ table: "orders", op: "MERGE", fields: [] }] }) as any, none = txOf(undefined);
  ok(tx?.tables[0].op === "UPDATE" && tx.tables[0].fields[0].was === "awaiting" && tx.outside[0].kind === "call" && "error" in bad && none === null, "a transaction is tables written (INSERT/UPDATE/DELETE, field was → now, the guard) and what is written outside it", JSON.stringify({ tx, bad })); }
{ const diff = ["diff --git a/src/orders.ts b/src/orders.ts", "+++ b/src/orders.ts", "@@ -10,2 +10,4 @@", " const x = 1;", "+  order.status = 'paid';", "+  await db.query(\"UPDATE orders SET status = 'void' WHERE id = $1\");",
    "+++ b/test/orders.test.ts", "@@ -1 +1,2 @@", "+  order.status = 'paid';", "+++ b/README.md", "@@ -1 +1 @@", "+status: 'documented'"].join("\n");
  const w = stateWrites(diff);
  ok(JSON.stringify(w) === JSON.stringify(["src/orders.ts:11", "src/orders.ts:12"]), "the lines that write a state or status column are found (tests and docs left out): a lifecycle is then owed", JSON.stringify(w)); }
{ const at = (lines: string[]) => stateWrites(["+++ b/src/x.ts", `@@ -1,0 +1,${lines.length} @@`, ...lines.map((l) => `+${l}`)].join("\n"));
  const not = ["if (order.status === 'paid') return;", "if (order.state == 'open') go();", "res.status = 404;", "res.status = code;", "response.status = 'error';", "const state = useReducer(r);", "return { state: loading };", "const s = { status: \"ok\" };", "const ok = a.status !== b.status;", "return res.status(404).json(err);", "if (o.Status == StatusPaid) {", "this.setState({ loading: true });", "setState(prev => ({ ...prev, loading: false }));", "let state = 0;"];
  const yes = ["await db.query(\"UPDATE orders SET updated_at = now(), status = 'void' WHERE id = $1\");", "  SET status = 'paid'", "INSERT INTO orders (id, status) VALUES ($1, 'new')", "await prisma.order.update({ where: { id }, data: { status: \"paid\" } });",
    "await Order.updateOne({ status: 'paid' });", "this.setState({ status: 'loading' });", "setState(prev => ({ ...prev, state: 'done' }));", "machine.transition(\"pay\");", "order.state = OrderState.Paid;", "invoice.status = 'sent';",
    "this.state = 'closed';", "self.status = :paid", "order.status = :paid", "job.state = 3;", "o.Status = StatusPaid", "o.Status = Status.PAID;", "order.STATE = 'x';", "order[\"status\"] = 'paid';", "order['state'] = 2",
    "Order.objects.filter(id=pk).update(status='paid')", "order.update(status: :paid)", "order.update!(status: :paid)", "db.Model(&o).Update(\"status\", \"paid\")", "db.Model(&o).Updates(map[string]interface{}{\"Status\": \"paid\"})", "await Invoice.create({ number, state: 'draft' });"];
  const fp = not.filter((l) => at([l]).length), tp = yes.filter((l) => !at([l]).length);
  ok(!fp.length, "not a state write: a comparison (== / ===), an HTTP response's status, a local called state, an object literal, React's own this.state", JSON.stringify(fp));
  ok(!tp.length, "a state write, the key in any case: UPDATE … SET status, INSERT INTO … (status), an ORM write naming it (JS, Django, Rails, GORM), setState with a status key, transition(), an entity's status or state assigned (this., self., [\"status\"], a symbol, a number, an enum)", JSON.stringify(tp));
  const atF = (file: string, lines: string[]) => stateWrites([`+++ b/${file}`, `@@ -1,0 +1,${lines.length} @@`, ...lines.map((l) => `+${l}`)].join("\n"));
  const notOrm = ["url.searchParams.set(\"status\", s);", "params.set('state', next);", "cache.set(\"status\", value);", "await cache.set({ status: 'warm' });", "form.status = 'dirty';", "form.setValue(\"status\", v);", "store.set({ status: 'x' });", "await api.patch({ status: 'paid' });"].filter((l) => at([l]).length);
  const reactTsx = atF("src/OrderPanel.tsx", ["    this.setState({ status: 'loading' });"]), reactClass = atF("src/panel.js", ["class Panel extends React.Component {", "  load() { this.setState({ status: 'loading' }); }"]);
  const plainSet = atF("src/orders.ts", ["    this.setState({ status: 'loading' });"]);
  ok(!notOrm.length && !reactTsx.length && !reactClass.length && plainSet.length === 1,
    "not a state write either: .set/.patch calls, a URL's or a cache's set, a form's fields, a React component's own this.setState({ status }) (a .jsx/.tsx file or a class extending Component); setState({ status }) elsewhere still counts", JSON.stringify({ notOrm, reactTsx, reactClass, plainSet }));
  const multi = at(["await prisma.order.update({", "  where: { id },", "  data: {", "    status: 'paid',", "  },", "});"]), plain = at(["return {", "  state: loading,", "  items,", "};"]);
  ok(JSON.stringify(multi) === JSON.stringify(["src/x.ts:4"]) && !plain.length, "a status key on its own line inside a multi-line ORM call (its data: { …) counts; the same key in a plain object literal does not", JSON.stringify({ multi, plain })); }

console.log(`\nreview-room-figures: ${pass} passed, ${fail} failed`); if (fail) process.exit(1);
