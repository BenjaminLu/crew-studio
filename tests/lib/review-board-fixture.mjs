// An invented lesson for the lesson board's page tests and screenshots (tests/review-room-board-ui.mjs): a card-payment change
// on an invented shop ("example/lumen-pay"), every chapter kind with Studio's drawings, and questions asked on it (threads of
// cards answered by turns, one understood, one folded in, one rephrased, one code card). No real names, nothing live.
export const H = "a".repeat(40), B = "b".repeat(40);
const ok1 = (ref) => ({ ref, ok: true });
const cl = (text, cites = [], basis = cites.some((c) => c.ok) ? "cited" : "inference") => ({ text, kind: "claim", basis, cites });
const tx = (table, op, fields, guard = "", outside = []) => ({ tables: [{ table, op, guard, fields: fields.map(([k, was, now]) => ({ k, was, now })) }], outside: outside.map(([kind, what]) => ({ kind, what })) });

/** the room as the page reads it, in en or zh-TW; seeded: whether the reader already asked questions on it */
export function boardRoom(lang = "zh-TW", { seeded = true, visited = null } = {}) {
  const zh = lang !== "en", T = (en, tw) => (zh ? tw : en), P = (en, tw, c = []) => cl(T(en, tw), c), C = ok1, n = 1;
  const arch = { id: "B1-1", turn: n, type: "arch", title: T("Paying for an order", "替一張訂單付款"), inferred: true, basis: "cited",
    nodes: [{ id: "app", label: T("Shopper app", "購物 App"), kind: "actor", mark: null }, { id: "api", label: T("Payments API", "付款 API"), kind: "service", mark: "changed" }, { id: "worker", label: T("Recheck job", "回查工作"), kind: "service", mark: "new" },
      { id: "db", label: "Postgres", kind: "store", mark: null }, { id: "psp", label: T("Card gateway", "收單閘道"), kind: "external", mark: null }],
    edges: [{ from: "app", to: "api", label: "POST /pay", cite: C("diff:src/pay.ts:L40-58") }, { from: "api", to: "psp", label: "authorize", cite: C("diff:src/pay.ts:L40-58") },
      { from: "psp", to: "api", label: "webhook", cite: C("diff:src/webhook.ts:L5-30") }, { from: "worker", to: "psp", label: T("ask again", "再問一次"), cite: C("diff:src/recheck.ts:L10-30") }, { from: "api", to: "db", label: T("CAS write", "CAS 寫入"), cite: C("diff:src/settle.ts:L8-30") }],
    cites: [C("diff:src/pay.ts:L40-58")] };
  const decision = { id: "B1-2", turn: n, type: "decision", title: T("A late success", "晚到的成功"), question: T("What if the gateway says paid after we expired it?", "閘道在我們判逾時後才說付款成功？"), chosen: T("Check once more first", "判逾時前再查一次"),
    because: T("No paid order is ever lost", "不會丟掉任何已付款的訂單"), rejected: [{ option: T("Let EXPIRED go back to PAID", "允許 EXPIRED 回到 PAID"), why: T("Stock would have to come back", "庫存得要回補"), cite: C("review:r12") }], cites: [C("diff:src/recheck.ts:L40-52")], basis: "cited" };
  const item = { id: "B1-3", turn: n, type: "item", title: T("The recheck", "回查"), name: T("recheck job", "回查工作"), before: T("Waited for the webhook only", "只等 webhook"), after: T("Asks the gateway after 5 min", "5 分鐘後主動去問"), mechanism: "next_check_at", basis: "cited", cites: [C("diff:src/recheck.ts:L10-30")] };
  const item2 = { id: "B1-4", turn: n, type: "item", title: T("Settling once", "只結算一次"), name: "settle()", before: T("Two writers could both settle", "兩邊都可能結算"), after: T("Only one CAS wins", "只有一個 CAS 會贏"), mechanism: "WHERE version = :v", basis: "cited", cites: [C("diff:src/settle.ts:L8-30")] };
  const states = { id: "B1-5", turn: n, type: "states", title: T("A payment", "一筆付款"), entity: "payments.status",
    states: [["created", T("Created", "已建立")], ["pending", T("Pending", "等待中")], ["paid", T("Paid", "已付款")], ["failed", T("Failed", "失敗")], ["expired", T("Expired", "已逾時")]].map(([id, label]) => ({ id, label, ...(id === "expired" ? { mark: "new" } : {}) })),
    transitions: [
      { from: "created", to: "pending", label: T("charge", "扣款"), cite: C("diff:src/pay.ts:L40-58"), tx: tx("payments", "UPDATE", [["status", "created", "pending"], ["next_check_at", null, "now()+5m"]], "WHERE status='created'", [["call", "gateway charge, before the write"]]) },
      { from: "pending", to: "paid", label: T("settle", "結算"), cite: C("diff:src/settle.ts:L8-30"), tx: tx("payments", "UPDATE", [["status", "pending", "paid"], ["version", "2", "3"]], "WHERE version = :v", [["event", "order.paid, outside the transaction"]]) },
      { from: "pending", to: "failed", label: T("declined", "被拒"), cite: C("diff:src/webhook.ts:L5-30"), tx: tx("payments", "UPDATE", [["status", "pending", "failed"]], "WHERE status='pending'") },
      { from: "pending", to: "expired", label: T("30 min", "30 分鐘"), cite: C("diff:src/recheck.ts:L40-52"), tx: tx("payments", "UPDATE", [["status", "pending", "expired"]], "WHERE created_at < now()-30m") }],
    basis: "cited", cites: [C("diff:src/settle.ts:L8-30")] };
  const seq = { id: "B1-6", turn: n, type: "sequence", title: T("One payment", "一次付款"), actors: ["App", "API", "DB", "Gateway", "Job"], basis: "cited", cites: [],
    steps: [["App", "API", "POST /pay", "call"], ["API", "Gateway", "charge", "call"], ["Gateway", "API", "202", "return"], ["API", "DB", T("PENDING, recheck in 5m", "PENDING，5 分鐘後回查"), "call"],
      ["Gateway", "API", T("webhook (lost)", "webhook（掉了）"), "async"], ["Job", "Gateway", T("ask again", "再問一次"), "call", "loop", T("every 5 min", "每 5 分鐘")], ["Gateway", "Job", "paid", "return", "loop"], ["Job", "DB", T("CAS v2→v3", "CAS v2→v3"), "call"]]
      .map(([from, to, label, kind, frame, frameLabel]) => ({ from, to, label, kind, ...(frame ? { frame, frameLabel: frameLabel || "" } : {}) })) };
  const calls = { id: "B1-7", turn: n, type: "calls", title: T("Every call", "每個呼叫"), basis: "cited", cites: [],
    calls: [{ name: "/orders/:id/pay", method: "POST", request: [{ k: "idempotency_key", v: "uuid" }, { k: "amount", v: "1280" }], response: [{ k: "status", v: "202" }, { k: "payment.status", v: "pending" }], errors: [{ code: "409", when: T("same key, other body", "同一個鍵、不同內容") }], tx: tx("payments", "INSERT", [["status", null, "created"]], "UNIQUE(idempotency_key)"), cite: C("diff:src/pay.ts:L40-58") },
      { name: "/webhooks/gateway", method: "POST", request: [{ k: "event", v: "charge.paid" }, { k: "signature", v: "hmac" }], response: [{ k: "status", v: "200" }], errors: [{ code: "401", when: T("bad signature", "簽章不對") }], tx: null, cite: C("diff:src/webhook.ts:L5-30") }] };
  const scenes = [
    { n: 1, chapter: "what", title: T("A payment that asks again", "會再問一次的付款"), picture: "", points: [P("A payment no longer waits only for the gateway's webhook [diff:src/recheck.ts:L10-30]. After five minutes a job asks the gateway itself.", "付款不再只等閘道的 webhook [diff:src/recheck.ts:L10-30]。五分鐘後由工作主動去問閘道。", [C("diff:src/recheck.ts:L10-30")]), P("The same payment is settled once, whoever comes first [diff:src/settle.ts:L8-30].", "同一筆付款只結算一次，誰先到就用誰 [diff:src/settle.ts:L8-30]。", [C("diff:src/settle.ts:L8-30")])] },
    { n: 2, chapter: "talks", title: T("The API in the middle", "API 在中間"), picture: arch.id, points: [P("The API writes only after the gateway answers [diff:src/pay.ts:L40-58].", "API 等閘道回覆後才寫入 [diff:src/pay.ts:L40-58]。", [C("diff:src/pay.ts:L40-58")]), P("A new job asks the gateway when the webhook is late [diff:src/recheck.ts:L10-30].", "webhook 晚到時，新的工作會去問閘道 [diff:src/recheck.ts:L10-30]。", [C("diff:src/recheck.ts:L10-30")])] },
    { n: 3, chapter: "decisions", title: T("Check once more", "再查一次"), picture: decision.id, points: [P("Before expiring, the job asks one more time [diff:src/recheck.ts:L40-52].", "判逾時前，工作會再問一次 [diff:src/recheck.ts:L40-52]。", [C("diff:src/recheck.ts:L40-52")]), P("A late success is still settled.", "晚到的成功仍會結算。")] },
    { n: 4, chapter: "change", title: T("The recheck", "回查"), picture: item.id, points: [P("Each pending payment gets a time to be checked again [diff:src/recheck.ts:L10-30].", "每筆等待中的付款都有下次回查的時間 [diff:src/recheck.ts:L10-30]。", [C("diff:src/recheck.ts:L10-30")]), P("The interval is five minutes.", "間隔是五分鐘。")] },
    { n: 5, chapter: "change", title: T("Settling once", "只結算一次"), picture: item2.id, points: [P("Both paths call the same settle() [diff:src/settle.ts:L8-30].", "兩條路都呼叫同一個 settle() [diff:src/settle.ts:L8-30]。", [C("diff:src/settle.ts:L8-30")]), P("The loser writes nothing.", "輸的那個什麼都不寫。")] },
    { n: 6, chapter: "lifecycle", title: T("A payment", "一筆付款"), picture: states.id, points: [P("Every edge is one guarded UPDATE [diff:src/settle.ts:L8-30].", "每條邊都是一個有條件的 UPDATE [diff:src/settle.ts:L8-30]。", [C("diff:src/settle.ts:L8-30")]), P("Expired is new and final [diff:src/recheck.ts:L40-52].", "已逾時是新的終點 [diff:src/recheck.ts:L40-52]。", [C("diff:src/recheck.ts:L40-52")])] },
    { n: 7, chapter: "sequence", title: T("One payment", "一次付款"), picture: seq.id, points: [P("A lost webhook is caught by the job.", "掉了的 webhook 會被工作接住。"), P("The job settles with the same CAS [diff:src/settle.ts:L8-30].", "工作用同一個 CAS 結算 [diff:src/settle.ts:L8-30]。", [C("diff:src/settle.ts:L8-30")])] },
    { n: 8, chapter: "calls", title: T("Two calls", "兩個呼叫"), picture: calls.id, points: [P("A replayed key returns the first answer [diff:src/pay.ts:L40-58].", "重送同一個鍵會拿到第一次的回覆 [diff:src/pay.ts:L40-58]。", [C("diff:src/pay.ts:L40-58")]), P("The webhook checks its signature [diff:src/webhook.ts:L5-30].", "webhook 會檢查簽章 [diff:src/webhook.ts:L5-30]。", [C("diff:src/webhook.ts:L5-30")])] },
    { n: 9, chapter: "watch", title: T("What to watch", "要注意的地方"), picture: "", points: [P("Thirty minutes may drop a late success [diff:src/recheck.ts:L40-52].", "30 分鐘判逾時可能丟掉晚到的成功 [diff:src/recheck.ts:L40-52]。", [C("diff:src/recheck.ts:L40-52")]), P("The order update runs outside the transaction [diff:src/settle.ts:L8-30].", "訂單更新在交易之外 [diff:src/settle.ts:L8-30]。", [C("diff:src/settle.ts:L8-30")])] },
    { n: 10, chapter: "questions", title: T("Open questions", "待解問題"), picture: "", points: [P("Should the order update move into an outbox in this change?", "訂單更新要不要在這次就改成 outbox？")] }];
  const lesson = { n, action: "teach", text: T("Teach me this change.", "教我這個改動。"), lang, status: "done", provider: "codex", model: "gpt-6", cost: { usd: 0.21 }, answer: "z", head: H, claims: [cl("x")], scenes };
  // a drawing the tutor made for one of the answers on the board (a rephrasing): it shows in that answer's card
  const board = [arch, decision, item, item2, states, seq, calls, { id: "B5-1", turn: 5, type: "mermaid", title: T("A ticket, served once", "號碼牌只叫一次"), code: "flowchart LR\n  A[ticket 2] --> B[served]\n  B --> C[void]", basis: "inference", cites: [] }];
  // questions asked on the board: each answer a turn, as Studio keeps them (src/domain/review-room.ts)
  const ans = (nn, text, cites, thread, extra = {}) => ({ n: nn, action: "ask", text: "q", lang, status: "done", provider: "codex", model: "gpt-6", cost: { usd: 0.02 }, answer: text, head: H, claims: [cl(text, cites)], thread, ...extra });
  const turns = [lesson];
  const threads = [];
  if (seeded) {
    turns.push(ans(2, T("The job reads next_check_at and asks the gateway for each pending payment [diff:src/recheck.ts:L10-30]. A paid answer settles it.", "工作讀 next_check_at，對每筆等待中的付款去問閘道 [diff:src/recheck.ts:L10-30]。回覆已付款就結算。"), [C("diff:src/recheck.ts:L10-30")], { n: 1, node: "n1" }),
      ans(3, T("Order 7731 at 14:02: the webhook hit a 502; at 14:07 the job asked and settled it [diff:src/recheck.ts:L10-30].", "訂單 7731 在 14:02 的 webhook 遇到 502；14:07 工作去問，然後結算 [diff:src/recheck.ts:L10-30]。"), [C("diff:src/recheck.ts:L10-30")], { n: 1, node: "n2" }),
      ans(4, T("Version 2 is read by both; the first UPDATE makes it 3, so the second matches no row [diff:src/settle.ts:L8-30].", "兩邊都讀到 version 2；先 UPDATE 的把它改成 3，後到的對不到任何列 [diff:src/settle.ts:L8-30]。"), [C("diff:src/settle.ts:L8-30")], { n: 2, node: "n1" }),
      ans(5, T("Like a ticket number at a counter: once it is served, the same ticket is void [diff:src/settle.ts:L8-30].", "像櫃台的號碼牌：叫過一次，同一張牌就作廢 [diff:src/settle.ts:L8-30]。"), [C("diff:src/settle.ts:L8-30")], { n: 2, node: "n1" }),
      ans(6, T("Thirty minutes comes from the checkout page's timeout, not from the gateway's numbers [diff:src/recheck.ts:L40-52].", "30 分鐘沿用結帳頁的逾時，不是依閘道的數字訂的 [diff:src/recheck.ts:L40-52]。"), [C("diff:src/recheck.ts:L40-52")], { n: 3, node: "n1" }),
      ans(8, T("The first one tells what changed: a job now asks the gateway itself [diff:src/recheck.ts:L10-30].", "第一句說改了什麼：工作現在會自己去問閘道 [diff:src/recheck.ts:L10-30]。"), [C("diff:src/recheck.ts:L10-30")], { n: 5, node: "n1" }),
      ans(7, T("Because the gateway retries a webhook only on a non-2xx answer [diff:src/webhook.ts:L5-30].", "因為閘道只在非 2xx 時才重送 webhook [diff:src/webhook.ts:L5-30]。"), [C("diff:src/webhook.ts:L5-30")], { n: 4, node: "n1" }, { action: "why" }));
    const anc = (scene, chapter, kind, item, part, text) => ({ turn: 1, scene, chapter, kind, item, part, text, start: null, end: null });
    const key = (a) => `${a.chapter}/${a.scene}/${a.kind}${a.item ? `/${a.item}` : ""}${a.part ? `#${a.part}` : ""}`;
    const th = (nn, a, nodes, state = "open", merged = null) => ({ n: nn, key: key(a), anchor: a, locator: { type: "text", section: key(a), start: null, end: null }, nodes, state, at: "t", resolvedAt: state === "resolved" ? "t" : null, merged });
    const nd = (id, parent, rel, chip, versions, q = null, code = null) => ({ id, parent, rel, chip, q, versions, code, at: "t" });
    threads.push(
      th(1, anc("t1", "what", "sentence", null, "p0.s1", T("After five minutes a job asks the gateway itself.", "五分鐘後由工作主動去問閘道。")), [nd("n1", null, "root", "deeper", [2]), nd("n2", "n1", "side", "example", [3])]),
      th(2, anc("t1-5", "change", "sentence", null, "p0.s0", T("Both paths call the same settle()", "兩條路都呼叫同一個 settle()")), [nd("n1", null, "root", "rephrase", [4, 5])], "resolved"),
      { ...th(3, anc("t1-6", "lifecycle", "transition", "B1-5", "transition:3", T("Pending → Expired · 30 min", "等待中 → 已逾時 · 30 分鐘")), [nd("n1", null, "root", "why", [6]), nd("n2", "n1", "below", "code", [], null, "diff:src/recheck.ts:L40-52")]), confused: true },
      th(5, anc("t1", "what", "sentence", null, "p0.s0", T("A payment no longer waits only for the gateway's webhook", "付款不再只等閘道的 webhook")), [nd("n1", null, "root", "free", [8], T("What is new here?", "這裡新的是什麼？"))]),
      th(4, anc("t1-8", "calls", "field", "B1-7", "c1.request.1", T("request: signature hmac", "request: signature hmac")), [nd("n1", null, "root", "why", [7])], "resolved", { at: "t", gist: T("Because the gateway retries a webhook only on a non-2xx answer [diff:src/webhook.ts:L5-30].", "因為閘道只在非 2xx 時才重送 webhook [diff:src/webhook.ts:L5-30]。"), cites: [C("diff:src/webhook.ts:L5-30")] }));
  }
  const keys = ["t1", "t1-2", "t1-3", "t1-4", "t1-5", "t1-6", "t1-7", "t1-8", "t1-9", "t1-10", "end"];
  return { card: { id: "SC-60", run: "R-060", node: "merge-card", title: { en: "Merge: payments ask again", "zh-TW": "合併：付款會再問一次" }, status: "open" }, task: { id: "R-060", title: "Payments ask again" }, pr: { id: 318, url: null },
    subject: { kind: "merge", room: "SC-60" }, head: H, base: B, open: true, running: null,
    offer: { provider: "codex", model: "gpt-6", effort: "high", paid: true, independence: { level: "vendor", adaptive: false, en: "Different vendor from the author.", zh: "和作者不同供應商。" }, hash: "feedc0ffee654321", voice: null },
    actions: [["how", "How does this change work?", "這個改動是怎麼運作的？"], ["why", "Why?", "為什麼？"], ["teach", "Teach me", "教我"], ["quiz", "Quiz", "考我"]].map(([id, en, zh]) => ({ id, en, zh })),
    board, turns, sources: [], illustrations: [], check: { questions: [] }, translations: {}, translating: null, langs: ["en", "zh-TW"], images: false, tutors: [], library: null, translate: null, progress: null, notes: [],
    diffstat: { files: [{ path: "src/recheck.ts", added: 80, removed: 0 }, { path: "src/settle.ts", added: 20, removed: 6 }], total: { files: 2, added: 100, removed: 6 }, from: "git" },
    lesson: { threads, visited: visited ?? (seeded ? keys : ["t1"]) }, summary: null };
}
