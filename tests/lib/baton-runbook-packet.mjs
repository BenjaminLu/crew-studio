// A baton packet shaped the way Studio's adapter asks for it in a pull request's room (src/domain/review-baton.ts,
// BATON_ADAPTER): one system map, a chain card, a runbook whose rows sit on that map, and the boundary map last with its
// one pin. Every failure row's evidence is a permalink built from the room's head commit (H in
// tests/lib/review-room-download-fixture.mjs), never a branch. A neutral sample: sample-org/money-kit, "Add percent".
// Used by tests/review-baton-page-ui.mjs.
import { H, REPO } from "./review-room-download-fixture.mjs";

const t = (en, hant, hans) => ({ en, hant, hans: hans ?? hant });
const ref = (path, a, b) => `https://github.com/${REPO}/blob/${H}/${path}#L${a}-L${b}`;

/** the runbook's rows (each one failure mode, at the system or link where it fails) */
export const ROWS = [
  { at: "web>api", mode: t("Stale price — the cached quote is older than 30 s", "價格過期 —— 快取的報價超過 30 秒", "价格过期 —— 缓存的报价超过 30 秒"),
    detect: t("`quote_age_seconds` over 30", "`quote_age_seconds` 超過 30", "`quote_age_seconds` 超过 30"),
    impact: t("The checkout shows yesterday's total", "結帳頁顯示舊的總價", "结账页显示旧的总价"),
    action: t("Refetch the quote; the page asks again", "重新取報價；頁面會再問一次", "重新取报价；页面会再问一次"),
    ref: ref("src/web/quote.ts", 40, 52), state: "handled" },
  { at: "api", mode: t("ROUNDING_MISMATCH — percent() and the ledger disagree by a cent", "ROUNDING_MISMATCH —— percent() 和帳本差一分", "ROUNDING_MISMATCH —— percent() 和账本差一分"),
    detect: t("`rounding_mismatch_total`", "`rounding_mismatch_total`", "`rounding_mismatch_total`"),
    impact: t("The order is held for review", "訂單被擋下等人工檢查", "订单被挡下等人工检查"),
    action: t("Compare both totals in the order log; refund the cent", "在訂單日誌比對兩個總價；退回那一分", "在订单日志比对两个总价；退回那一分"),
    ref: ref("src/percent.ts", 12, 18), state: "handled" },
  { at: "api>pay", mode: t("RATE_LIMITED — the provider answers 429", "RATE_LIMITED —— 金流商回 429", "RATE_LIMITED —— 支付商回 429"),
    detect: t("`pay_http_status{code=\"429\"}`", "`pay_http_status{code=\"429\"}`", "`pay_http_status{code=\"429\"}`"),
    impact: t("Checkout waits up to 8 s, then asks to try again", "結帳最多等 8 秒，然後請使用者再試一次", "结账最多等 8 秒，然后请用户再试一次"),
    action: t("Back off; page on-call when it lasts over 5 minutes", "退避重試；持續超過 5 分鐘就呼叫值班", "退避重试；持续超过 5 分钟就呼叫值班"),
    ref: ref("src/pay/client.ts", 88, 104), state: "handled" },
  { at: "api>pay", mode: t("Timeout with unknown outcome — the charge may have gone through", "逾時且結果未知 —— 可能已經扣款", "超时且结果未知 —— 可能已经扣款"),
    impact: t("A retry can charge the card twice", "重試可能讓同一張卡被扣兩次", "重试可能让同一张卡被扣两次"),
    action: t("Query the charge by its order id before any retry", "重試前先用訂單編號查這筆扣款", "重试前先用订单编号查这笔扣款"),
    state: "unhandled", introduced: true, finding: 1 },
];

const chainHeading = "A timed-out charge is retried blind";

export function packet() {
  return {
    title: t("Add percent, handed on", "加上 percent()，交棒", "加上 percent()，交棒"),
    subtitle: t("The checkout total now comes from percent(); one retry path is still blind", "結帳總價改由 percent() 算；有一條重試路徑還是盲的", "结账总价改由 percent() 算；有一条重试路径还是盲的"),
    repo: REPO, branch: "percent", range: `${"b".repeat(7)}..${H.slice(0, 7)}`, layer: "L1", filename: "add-percent",
    systems: { state: "after",
      systems: [{ id: "web", name: t("Checkout web", "結帳網頁", "结账网页"), kind: "client" }, { id: "api", name: t("Pricing API", "計價 API", "计价 API") },
        { id: "pay", name: t("Payment provider", "金流商", "支付商"), kind: "external" }],
      sub: { web: "quote.ts", api: "percent()", pay: "/charges" }, hops: { 0: "HTTPS", 1: "HTTPS" } },
    sections: [
      { kind: "chain", heading: chainHeading, tag: "must handle", tone: "risk",
        claim: t("A charge that timed out should be retried only after the provider says it did not go through", "逾時的扣款要先確認沒成功才重試", "超时的扣款要先确认没成功才重试"),
        nodes: [{ id: "web", name: t("Checkout web", "結帳網頁", "结账网页"), kind: "client" }, { id: "api", name: t("Pricing API", "計價 API", "计价 API"), kind: "service" },
          { id: "pay", name: t("Payment provider", "金流商", "支付商"), kind: "external" }],
        before: { sub: { web: "submit()", api: "charge()", pay: "POST /charges" }, hot: ["api"], hops: { 0: "order", 1: "charge" },
          why: { at: "api", text: t("`charge()` retries on any timeout, without asking whether the first `POST /charges` landed", "`charge()` 只要逾時就重試，沒先問第一次 `POST /charges` 有沒有成功", "`charge()` 只要超时就重试，没先问第一次 `POST /charges` 有没有成功") },
          outcome: t("A slow provider can charge one order twice", "金流商一慢，同一筆訂單可能被扣兩次", "支付商一慢，同一笔订单可能被扣两次") },
        after: { sub: { web: "submit()", api: "charge()", pay: "POST /charges" }, hot: ["api"], hops: { 0: "order", 1: "charge" },
          why: { at: "api", text: t("The pull request leaves `charge()` as it was: the retry still sends a second `POST /charges`", "這個 PR 沒改 `charge()`：重試仍會送第二次 `POST /charges`", "这个 PR 没改 `charge()`：重试仍会送第二次 `POST /charges`") },
          outcome: t("Still open: two `POST /charges` for one order id", "仍未處理：同一個訂單編號有兩次 `POST /charges`", "仍未处理：同一个订单编号有两次 `POST /charges`") },
        proof: [{ type: "source", label: t("charge() read in head/src/pay/client.ts", "讀過 head/src/pay/client.ts 的 charge()", "读过 head/src/pay/client.ts 的 charge()"), state: "code-only" },
          { type: "test", label: t("no test covers a timed-out charge", "沒有測試涵蓋逾時扣款", "没有测试涵盖超时扣款"), state: "absent" }] },
      { kind: "runbook", heading: t("Runbook — checkout errors", "排障手冊 —— 結帳錯誤", "排障手册 —— 结账错误"),
        caption: t("Each row is numbered where it fails on the map; search an error code with /", "每一列都在地圖上標出出事的位置；按 / 搜尋錯誤碼", "每一行都在地图上标出出事的位置；按 / 搜索错误码"),
        rows: structuredClone(ROWS) },
      { kind: "boundary", role: "boundary-review", heading: t("Where it can break", "可能壞在哪裡", "可能坏在哪里"),
        findings: [{ n: 1, at: "api>pay", lens: "dependency", tone: "risk", title: t("a timed-out charge is retried blind", "逾時的扣款被盲目重試", "超时的扣款被盲目重试"), card: chainHeading }] },
    ],
    context: [
      "# Add percent, handed on",
      "",
      "If something below does not answer your question, say you do not know rather than guess.",
      "",
      "## (a) What this is",
      `Pull request 7 of ${REPO}, head ${H}, base ${"b".repeat(40)}. It adds percent(amount, pct), rounded half up to the cent, and moves the checkout total onto it.`,
      "",
      "## (b) The record, reconstructed",
      "Reconstructed from the pull request's record (its description, diff, commits and reviews), not from the author's session.",
      "The diff touches src/percent.ts, src/web/quote.ts and src/pay/client.ts. No review round asked for changes. CI is not connected for this room.",
      "The retry in charge() predates this pull request; the pull request routes more orders through it, so a timed-out charge is retried more often.",
      "",
      "## Boundary review",
      "Boundaries: Checkout web to Pricing API (HTTPS), Pricing API to Payment provider (HTTPS).",
      "Lenses: identity n/a (no new id); truth: the quote's age is checked; effect: a retried charge is not idempotent (finding 1);",
      "dependency: the provider's 429 is backed off; coexist: old and new clients read the same total; edges: one cent rounding is logged.",
      "",
      "| boundary | mode | detect | impact | action | ref | state |",
      "|---|---|---|---|---|---|---|",
      ...ROWS.map((r) => `| ${r.at} | ${r.mode.en} | ${r.detect?.en ?? "no signal today"} | ${r.impact.en} | ${r.action.en} | ${r.ref ?? "no code reference"} | ${r.state} |`),
      "",
      "Review comment (paste-ready, not posted): charge() retries a timed-out POST /charges without asking whether it landed; query the charge by its order id first.",
      "",
      "## (c) How to pull more",
      `gh pr view 7 --repo ${REPO}; gh pr diff 7 --repo ${REPO}; git log ${"b".repeat(7)}..${H.slice(0, 7)}`,
      "",
      ...Array.from({ length: 12 }, (_, i) => `Note ${i + 1}: every number above was read from the diff or the materials; anything else is an open question.`),
    ].join("\n"),
  };
}
