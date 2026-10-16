# R-040 historical draft recovery

- Source: native spec round 4 tool call, read on 2026-10-16.
- Revision input only; not current-head verification, signed approval, or completed work.
- Recheck source, captain corrections, scope, tests and all gates before dispatch.

```json
{
  "title": "Render task intents as safe Markdown and structure new intent drafts",
  "what": "Task intent bodies display headings, paragraphs, ordered and unordered nested lists, emphasis, inline code, fenced code blocks and safe links. Intent-derived list titles and summaries remain concise plain text; details retain the complete meaning and access to the original source. New native proposals and captured intents use applicable Markdown sections for goals, scope, acceptance conditions, constraints and open questions without empty templates or invented decisions. Existing plain-text intents remain readable. Historical records, Task identity, signed ledger, repository authority, staffing pins and captain-only decisions remain unchanged.",
  "why": [
    "The shared card displays intent bodies as plain paragraphs, so Markdown structure appears as punctuation and long text is hard to scan.",
    "Intent-derived titles and summaries expose source formatting, while the writing guidance lacks a consistent structure for new work.",
    "Readable intent details help the captain inspect constraints before deciding; formatting carries no approval authority."
  ],
  "zh": {
    "title": "以安全 Markdown 呈現任務意圖，並整理新意圖草稿的結構",
    "why": [
      "共用卡片把意圖正文當成一般段落顯示，Markdown 結構因此變成標點符號，長文也難以快速閱讀。",
      "從意圖擷取的標題與摘要會露出原始格式，而編寫指引缺乏一致的新工作組織方式。",
      "易讀的意圖詳情讓船長在決定前看清楚限制；文字格式不代表核准權限。"
    ]
  },
  "scope": [
    "public/scard.js",
    "public/runtime.js",
    "public/board.js",
    "public/m2.js",
    "public/index.html",
    "src/host/main.ts",
    "src/firstmate.ts",
    "src/chat.ts",
    "tests/intent-markdown-ui.mjs",
    "tests/intent-authoring.ts",
    "tests/fixture/intent-markdown.json",
    "package.json",
    "docs/units/intent-markdown.md"
  ],
  "verificationScope": [
    "src/server.ts",
    "src/takeover.ts",
    "src/runtime/index.ts",
    "src/runtime/engine.ts",
    "src/runtime/cards.ts",
    "src/domain/code.ts",
    "src/firstmate-projects.ts",
    "src/tools.ts",
    "src/assets.gen.ts",
    "public/app.js",
    "public/compare.js",
    "public/takeover.js",
    "public/transcripts.js",
    "public/m25.js",
    "public/ootb.js",
    "public/i18n.js",
    "tests/chat-attachments.ts",
    "tests/chat-history.ts",
    "tests/first-workflow-draft.ts",
    "tests/firstmate-generated-media.ts",
    "tests/firstmate-native.ts",
    "tests/host.ts",
    "tests/native-outcomes.ts",
    "tests/native-tool-errors.ts",
    "tests/operating-rules.ts",
    "tests/takeover-codex.ts",
    "tests/takeover.ts",
    "tests/zh-cn.ts",
    "tests/firstmate-project-registration.ts",
    "tests/intent-card.ts",
    "tests/intent-card-ui.mjs",
    "tests/board-ui.mjs",
    "tests/scard-ime-ui.mjs",
    "tests/startup-accept-card-ui.mjs",
    "tests/startup-run-output-ui.mjs",
    "tests/image-refine-context-ui.mjs",
    "tests/native-queue.ts",
    "tests/non-code-workflows.ts",
    "tests/onboarding-ui.mjs",
    "tests/runtime-ui.mjs",
    "tests/run-graph-navigation-ui.mjs",
    "tests/backbone-ui.mjs",
    "tests/native-standalone-binary.ts"
  ],
  "door": {
    "kind": "two-way",
    "reason": "The intended edits concern display, authoring guidance and tests. No migration, authentication, permission, signed-record or approval change is in scope. Reverting the change restores the prior presentation without rewriting stored intents."
  },
  "done": [
    "Planned acceptance test `tests/intent-markdown-ui.mjs` case `intent semantics across card hosts`: the same English and Chinese intent on the real Task page, Inbox and expanded Board card exposes heading levels, separate paragraphs, correctly nested ordered and unordered lists, emphasis and exact inline and fenced code content. Expected base failure: intent bodies are plain paragraphs and nested Markdown has no corresponding semantic structure.",
    "Planned acceptance test `tests/intent-markdown-ui.mjs` case `safe intent navigation`: intent Markdown offers keyboard-operable Studio fragment links and HTTP or HTTPS links with safe external navigation, while script HTML, event attributes, dangerous or obfuscated URL schemes and embedded external resources remain inert; rendering causes no external resource request. Expected base failure: permitted Markdown links in intent bodies are not navigable. The existing inert-text behavior is a regression guard, not a claimed base vulnerability.",
    "Planned acceptance test `tests/intent-markdown-ui.mjs` case `readable summaries`: Markdown-led native Task titles, Board decision summaries and captured-intent list entries display bounded readable text without heading, emphasis, fence or link-syntax noise, with complete content still available in details. Expected base failure: these views expose raw source markers or raw first-line titles.",
    "Planned acceptance test `tests/intent-markdown-ui.mjs` case `source and legacy fidelity`: formatted details and an exact original-source view coexist for long English and Chinese intents, while plain text, special characters, code and explicit constraints retain their content. Expected base failure: the formatted detail and original-source pair is absent; existing plain-text fidelity remains a regression guard.",
    "Planned acceptance test `tests/intent-authoring.ts` case `authoring guidance reaches proposal and capture`: the native Firstmate prompt, proposal tool guidance and status-chat capture guidance describe applicable goal, scope, acceptance, constraint and open-question sections, with no forced empty sections or invented facts. Expected base failure: the delivered guidance lacks this Markdown authoring contract.",
    "Planned acceptance test `tests/intent-authoring.ts` case `structured new-intent acceptance`: recorded new English and Chinese proposals produced under the revised guidance organize supplied multi-part requirements into applicable Markdown sections, retain each supplied constraint and unanswered question, and omit unsupported decisions; a short single-goal request remains concise. Expected base failure: the base guidance lacks the required structure contract. A fixture proves transport only; actual generation requires separately identified fresh-context acceptance evidence.",
    "Planned acceptance test `tests/intent-markdown-ui.mjs` case `responsive intent matrix`: real card views at 1440 px and 390 px, in light and dark themes and en, zh-TW and zh-CN, keep long prose, nested lists and code readable without page overflow or hidden constraints, with visible keyboard focus. Expected base failure: the required Markdown hierarchy is absent from intent content in this matrix.",
    "Planned acceptance test `tests/intent-markdown-ui.mjs` case `formatting has no authority`: displaying a Markdown intent leaves its original record and Task identity intact and leaves alignment ticks, door confirmation and answer submission under the existing captain controls. Expected base failure: the formatted-intent scenario lacks semantic Markdown; unchanged data and approval behavior are regression guards, not claimed base failures.",
    "Planned acceptance test `tests/intent-markdown-ui.mjs` case `traceable comparison` and the existing `firstmate/ui-captures`, `firstmate/designer-compare` and `firstmate/review-verdict` gates: the evidence record contains real-card before/after captures bound to the tested revisions and fixture, plus independent fresh-context reviewer and designer findings for the intended Markdown behavior. Expected base failure: the base captures lack the required intent hierarchy; absence of new evidence is not an executed test failure. Reports distinguish executed, failed, blocked and unexecuted checks."
  ],
  "explain": {
    "en": "This spec covers the intent presentation task (R-040) only. The captain approved refresh to main `701b7d8c`. The startup-strategy task (R-038, proposal R-037) remains separate and incomplete. Drafts may coexist; implementation awaits formal captain dispatch in the order R-043, R-038, R-040. No lock release is claimed. The approved `code-firstmate@1` configuration from R-036 and its pinned skills remain in force; no staffing interview is part of this change.\n\nDiagnosis: the intent sections in `public/scard.js` present full intent strings as paragraphs, including detailed, plain and artifact cards. Its existing Markdown view is text-node based, has partial inline formatting, treats nested items as visual indentation and creates no links. `public/m2.js` has a separate limited safe inline renderer and plain captured-intent details. `public/board.js` and `public/runtime.js` display supplied titles directly. The runtime derives a default title from the first source line. Native proposal text passes through `src/firstmate.ts` and project registration into Task text and card intent sections; legacy capture uses `src/chat.ts` and `src/tools.ts`. The defect class is inconsistent presentation of structured intent text and insufficient guidance at new-intent authoring entry points. The intended result covers all these intent surfaces without changing stored title or source semantics. Existing Markdown and safety behavior is the preferred reuse basis; document export and recipe rendering remain outside the edit scope.\n\nWrite boundaries: `src/host/main.ts`, `src/firstmate.ts` and `src/chat.ts` admit authoring wording only. UI changes concern intent bodies and intent-derived summaries; unrelated workflow behavior and startup output remain compatible. `public/index.html` admits only loading changes needed by these existing UI files. `package.json` admits the owning test commands and their normal test-chain registration. The new fixture, tests and unit document contain acceptance cases and evidence references, not runtime state. No historical intent rewrite, ledger edit, authorization change, Task replacement, role-pin change or dependency installation is proposed.\n\nEvery exact file in `verificationScope` is read-only. The server, runtime, card, proposal-registration and capture callers require verification that original text, serialized inputs, Task identity, repository identity and approval controls retain their contracts. The asset importer and UI hosts require verification of load order, exported interfaces, shared-card mounting, summary display and live-update behavior. The listed existing suites require compatibility review and relevant regression execution for native prompts, project registration, operating rules, locales, intent cards, Board state, IME input, startup cards, artifact cards, runtime navigation and bundled assets. These callers confer no write authority and create no additional changed roots. The focused tests cover the changed behavior; existing tests cover preserved contracts.\n\nEvidence limits and scope questions: no round 4 brief is bound to `701b7d8c`; the brief at `d2f55a70` is stale and supplies no current failure diagnosis. The accessible bootstrap document records its own validation, not this task's acceptance. The available tools expose repository reads and spec submission, not current round check records. Which current-head findings, if any, remain after this submission? That question remains open until Studio returns current results. Which write reservations remain at formal dispatch? Signed reservation admission and the captain's order decide that then; this spec grants no exception. No acceptance test, screenshot or independent review ran in this drafting turn. Proposed tests and expected base failures are plans, not fail-first evidence. Later evidence must come from isolated temporary test data and an owned server, never the live Studio instance. Completion or failure reporting includes the task and actual evidence links, and the captain alone answers dispatch and merge cards.",
    "zh-TW": "本規格只涵蓋意圖呈現任務（R-040）。船長已核准將 base 刷新至 main `701b7d8c`。啟動策略任務（R-038，提案 R-037）仍獨立追蹤且尚未完成。草稿可以共存；實作必須等待船長依 R-043、R-038、R-040 的順序正式 dispatch。本規格不宣稱任何鎖定已解除。沿用 R-036 核准的 `code-firstmate@1` 配置與 pinned skills；本次變更不包含 staffing 訪談。\n\n診斷：`public/scard.js` 的意圖區塊把完整意圖字串當成段落呈現，涵蓋詳情卡、一般卡與成品卡。既有 Markdown view 使用文字節點，只支援部分行內格式，以視覺縮排呈現巢狀項目，也不建立連結。`public/m2.js` 另有功能有限的安全行內 renderer，擷取意圖的詳情則顯示為純文字。`public/board.js` 與 `public/runtime.js` 直接顯示傳入的標題。runtime 以原文第一行產生預設標題。原生提案文字經過 `src/firstmate.ts` 與專案註冊流程，進入 Task 正文及卡片意圖區塊；舊有擷取流程使用 `src/chat.ts` 與 `src/tools.ts`。問題類型是結構化意圖文字的呈現不一致，以及新意圖編寫入口缺少指引。預期結果涵蓋這些意圖介面，並保留儲存的標題與原文語義。優先復用既有 Markdown 與安全處理；文件匯出與 recipe rendering 不在編輯範圍內。\n\n寫入邊界：`src/host/main.ts`、`src/firstmate.ts` 與 `src/chat.ts` 只允許修改編寫指引。UI 變更限於意圖正文與意圖摘要；其他 workflow 行為及 startup 輸出保持相容。`public/index.html` 只允許調整這些既有 UI 檔案所需的載入設定。`package.json` 只允許加入本項測試指令與正常測試鏈的註冊。新增 fixture、測試與單元文件記錄驗收案例及證據連結，不包含 runtime 狀態。本規格不提議回寫歷史意圖、修改 ledger、變更授權、替換 Task、更動角色 pin 或安裝 dependency。\n\n`verificationScope` 中每個確切檔案都屬唯讀。server、runtime、卡片、提案註冊與擷取流程的 caller 必須驗證原文、序列化輸入、Task 身分、repository identity 與核准控制仍符合既有契約。asset importer 與 UI host 必須驗證載入順序、匯出介面、共用卡片掛載、摘要顯示與即時更新行為。列出的既有測試須檢查相容性，並執行相關 regression tests，涵蓋原生 prompt、專案註冊、operating rules、語系、意圖卡、Board 狀態、IME 輸入、startup 卡片、成品卡、runtime 導覽與 bundled assets。這些 caller 不授予寫入權限，也不產生額外的變更根目錄。專用測試驗證新行為，既有測試驗證保留的契約。\n\n證據限制與範圍待決事項：目前沒有綁定 `701b7d8c` 的第 4 輪 brief；`d2f55a70` 的 brief 已過期，不能當成本輪失敗診斷。可讀取的 bootstrap 文件記錄的是它自身的驗證結果，不是本任務的驗收。現有工具提供 repository 讀取與規格提交，沒有本輪檢查紀錄的讀取介面。本次提交後，目前 head 還有哪些檢查意見？在 Studio 回傳目前結果前，此問題維持未決。正式 dispatch 時還有哪些寫入範圍被保留？屆時由 signed reservation 判定與船長指定順序決定，本規格不授予例外。本輪草擬未執行驗收測試、截圖或獨立審查。提議的測試與預期 base failure 都是計畫，不是 fail-first 證據。後續證據必須使用隔離的暫存測試資料與自有 server，不得使用 live Studio。完成或失敗回報須附上任務與實際證據連結；dispatch 與 merge 卡片僅由船長回答。"
  }
}
```
