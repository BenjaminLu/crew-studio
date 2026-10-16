# R-044 historical draft recovery

- Source: native spec round 5 tool call, read on 2026-10-16.
- Revision input only; not current-head verification, signed approval, or completed work.
- Recheck source, captain corrections, scope, tests and all gates before dispatch.

```json
{
  "title": "Show verifiable crew progress in Captain",
  "what": "Show each evidenced working crew member's task short name, current phase, latest verifiable progress and native handling destination. Distinguish captain waits, dependency waits, queued and unconfirmed states. Keep failure summaries and complete native reasons reachable. Group work only through verifiable existing native proposal, childRun or intent ID relationships; absent evidence means separate tasks marked unconfirmed, never title-based guesses. Preserve original task and card destinations. Present phase colors with readable text or accessible icon labels. Remove unsupported active presentation after completion, cancellation or loss of current evidence while retaining history. Keep the skin read-only and retain the limited sanitized snapshot and native navigation scope.",
  "why": [
    "The Captain adapter creates working Firstmates from nonterminal tasks and maps every alive crew entry to working. Task status alone does not prove worker execution.",
    "The native skin projection collapses success and cancellation into done, selects one current node and omits progress evidence, failure detail references and wait reasons. The bridge opens pending cards but has no native task navigation contract.",
    "The current root projection follows parent parameters without verified dispatch evidence. Related work needs trustworthy grouping that preserves individual task, node, job, attempt and card identities."
  ],
  "zh": {
    "title": "在 Captain 顯示可驗證的船員工作進展",
    "why": [
      "Captain adapter 會從非終止任務產生 working Firstmate，並將每個 alive 船員標為 working。僅憑任務狀態無法證明 worker 已執行。",
      "原生 skin 投影將成功與取消合併為 done，只選取一個目前 node，並省略進展證據、完整失敗原因的參照及等待原因。Bridge 可開啟待決卡，但缺少原生任務導向契約。",
      "目前 root 投影沿用未經 dispatch 證據驗證的父層參數。相關工作需要可信分組，同時保留各 task、node、job、attempt 與 card 的身分。"
    ]
  },
  "done": [
    "Planned acceptance test `Captain evidenced crew` in `tests/captain-labels.mjs`: two concurrent isolated tasks retain distinct workers, nodes, jobs and attempts; each displayed task short name, phase and latest progress resolves to its own evidence, without invented busy crew, percentages or time-derived progress. planned fail-first: base creates working Firstmates from task status and exposes no bound latest progress.",
    "Planned acceptance test `Captain waiting states` in `tests/skins-native.ts`: a pending captain card, evidenced dependency wait, queued job and missing execution evidence produce distinct captain-wait, dependency-wait, queued and unconfirmed states. planned fail-first: base lacks these distinctions and treats a running agent node with a job reference as alive without current execution verification.",
    "Planned acceptance test `Captain failure destination` in `tests/captain-ui.mjs`: a failed task displays its concise reason with access to that task's complete native reason or correctly bound current handling card. planned fail-first: base removes failed tasks from the deck without a failure summary or task-opening action.",
    "Planned acceptance test `Captain trusted lineage` in `tests/skins-native.ts`: verifiable existing native proposal, childRun and intent ID relationships group related work while preserving original task and card identities; forged references, missing parents, cycles, conflicts and absent evidence leave tasks separate and explicitly unconfirmed, including tasks with similar titles. planned fail-first: base follows parent parameters without verified lineage and arbitrarily selects a cycle member.",
    "Planned acceptance test `Captain phase presentation` in `tests/captain-ui.mjs`: evidenced phase transitions display matching phase color with readable text or an accessible icon label in both themes. planned fail-first: base reduces crew activity to working or waiting and provides no evidence-bound phase presentation.",
    "Planned acceptance test `Captain terminal and stale reconciliation` in `tests/captain-labels.mjs`: success, cancellation, failure, removal, stale worker/card records, delayed events, missing fields, truncated snapshots and reload remove unsupported active crew or mark them unconfirmed while keeping history reachable without fabricated completion. planned fail-first: base maps native cancellation to done and can present a merged outcome, while orphan pending cards can recreate groups.",
    "Planned acceptance test `Captain native navigation binding` in `tests/skins.mjs`: mouse and keyboard activation across two tasks and their distinct pending cards opens the exact native destination; changed pending state, stale IDs and mismatched identities never substitute another target. planned fail-first: base provides no native task-opening contract in the kit or host.",
    "Planned acceptance test `Captain accessible details` in `tests/captain-ui.mjs`: task, phase, progress and complete details remain readable on hover, keyboard focus and phone touch without hover, with usable focus across repeated snapshots and long English and Traditional Chinese text. planned fail-first: base details omit verifiable progress and phase, and pending bubbles truncate task titles.",
    "Planned acceptance test `Captain visual matrix` in `tests/captain-ui.mjs`: actual rendered desktop and phone captures in light and dark themes and English and Traditional Chinese show readable progress and correct interactions for two concurrent tasks, waits, failure and an empty deck; each capture identifies its isolated fixture and evidence records. planned fail-first: base lacks the required progress, phase and failure content across this matrix. Production work is never fabricated for acceptance.",
    "Planned acceptance test `Captain read-only contract` in `tests/skins.mjs`: authorized native task viewing succeeds while denied permissions, foreign-frame messages, forged IDs and approve/dispatch requests grant no additional action or sensitive data. planned fail-first: base lacks authorized native task viewing. Existing hostile-skin, pinning, CSP, permission and sensitive-data assertions remain regression obligations."
  ],
  "scope": [
    "scripts/captain-adapter.js",
    "scripts/import-captain.py",
    "skins/captain/captain.js",
    "skins/captain/captain.css",
    "skins/captain/index.html",
    "skins/captain/manifest.json",
    "skins/kit/skin-kit.js",
    "skins/kit/README.md",
    "src/skins.ts",
    "src/server.ts",
    "public/skins.js",
    "tests/captain-labels.mjs",
    "tests/captain-ui.mjs",
    "tests/skins-native.ts",
    "tests/skins.mjs"
  ],
  "verificationScope": [
    "src/main.ts",
    "src/open.ts",
    "src/bundled.gen.ts",
    "src/runtime/engine.ts",
    "src/runtime/index.ts",
    "src/firstmate.ts",
    "public/app.js",
    "public/runtime.js",
    "skins/terminal/index.html",
    "skins/voyage/voyage.js"
  ],
  "door": {
    "kind": "one-way",
    "reason": "The shared server and skin message boundary expose native task evidence and navigation. Permission, identity-binding and data-disclosure review is required; captain-only approval, repository identity, signed ledger and artifact validation remain authoritative."
  },
  "explain": {
    "en": "The draft correction addresses every done line: each behavioral requirement names a planned test file, scenario and semantic base failure with the marker `planned fail-first`. These are proposed tests, not executed evidence. The current brief identifies missing markers and test references; it reports no remaining caller or overlap issue.\n\nThe inspected adapter creates active Firstmates from nonterminal tasks and loses phase distinctions. The native snapshot collapses cancellation into done, omits progress evidence and follows parent parameters without verified dispatch lineage. The host supports pending-card opening but lacks native task navigation. These gaps justify the retained limited shared contract scope. `src/server.ts` changes are restricted to the necessary sanitized skin snapshot and read-only navigation contract. Startup/session work for `R-038`, authentication, unrelated routes and Markdown rendering for `R-040` are excluded.\n\nLineage means an evidenced native relationship between task identities. Only verifiable existing proposal, `childRun` and intent ID relationships qualify. Missing, conflicting or unverifiable relationships leave tasks separate and explicitly unconfirmed. Titles never establish lineage. Grouping retains each task, node, job, attempt and pending-card identity.\n\nRequired release gate: update `skins/kit/README.md` with evidence provenance, trusted lineage, phase and state mapping, missing and stale values, bounded snapshots, read-only permissions and reproducible verification. Preserve attribution and source build reproducibility.\n\nRequired release gate: meaningful regression tests include executed semantic failures on base and results on the patch. An independent fresh-context reviewer and a designer provide separate verdicts. Every conclusion links test logs, actual screenshots and relevant event or step identities. Planned, executed, blocked and unverified results remain distinct; no invented PASS. Visual evidence covers desktop and phone, light and dark, English and Traditional Chinese. Use at least two concurrent real tasks or clearly labeled isolated fixtures; never fabricate production work.\n\nRead-only verification obligations: `src/main.ts` and `src/open.ts` retain compatible server imports, exports and entry behavior without sign-in or session changes. `src/bundled.gen.ts` retains compatible embedded asset paths. `src/runtime/engine.ts`, `src/runtime/index.ts` and `src/firstmate.ts` provide verification of authoritative node/job evidence, native task destinations and dispatch lineage. `public/app.js` and `public/runtime.js` retain host loading, event delivery and native task routing. `skins/terminal/index.html` and `skins/voyage/voyage.js` retain compatible snapshot and kit behavior. Record the compatibility evidence for each file; verificationScope grants no write permission.\n\nUse the approved Codex staffing and mandatory pinned skills from `R-036` for coordinator, worker, independent reviewer and designer without model reselection. Preserve repository identity, signed ledger, artifact validation, captain-only approvals and native merge authorization. Opening a card never approves it. No automatic remote push. Respect scope reservations and normal scheduling; never seize locks, release another task's locks or overwrite other work.\n\nTests use temporary isolated data and their own server; the live Studio server, its port, processes and data remain untouched. No authentication flow. Dependency installation is restricted to `/Users/meng-yingyang/workspace/src/github.com/OWNER/crew-studio`. Completion or failure reporting identifies this conversation and task with result and acceptance evidence links.\n\nScope questions: which existing intent ID relationships have sufficient authoritative evidence, and which reservation conflicts exist at dispatch time? Unverified lineage remains separate and unconfirmed. Reservation conflicts require normal scheduling waits. Any additional write path requires normal scope approval.",
    "zh-TW": "本次修訂涵蓋每條 done：每項行為要求均列出計畫測試檔、具體情境，以及含 `planned fail-first` 標記的 base 語意失敗。這些是計畫測試，不是已執行證據。目前 brief 指出標記與測試參照缺漏，未列出尚存的 caller 或範圍重疊問題。\n\n已查閱的 adapter 會從非終止任務產生活躍 Firstmate，並遺失階段差異。原生 snapshot 將取消合併為 done，缺少進展證據，且沿用未驗證 dispatch lineage 的父層參數。Host 支援開啟待決卡，但缺少原生任務導向。這些缺口支持保留有限的共用契約範圍。`src/server.ts` 僅限必要的已去除敏感資料 skin snapshot 與唯讀導向契約。排除啟動與 session 工作（`R-038`）、驗證身分、無關路由及 Markdown 渲染（`R-040`）。\n\nLineage 指任務身分之間有證據支持的原生關係。僅接受可驗證的既有 proposal、`childRun` 與 intent ID 關係。關係缺漏、衝突或無法驗證時，各任務獨立呈現並明確標示未確認。標題不得作為 lineage 證據。分組保留每個 task、node、job、attempt 與待決卡的身分。\n\n必要 release gate：更新 `skins/kit/README.md`，說明證據來源、可信 lineage、階段與狀態對應、缺值與過期資料、有界 snapshot、唯讀權限及可重現的驗證方式。保留來源標示與可重現的原始碼建置。\n\n必要 release gate：有意義的 regression tests 包含實際執行的 base 語意失敗與修改後結果。獨立 fresh-context reviewer 與 designer 分別提出驗收結論。每項結論附測試紀錄、實際截圖及相關 event 或 step 身分連結。計畫、已執行、受阻與未驗證結果分開列出，不捏造 PASS。視覺證據涵蓋 desktop 與 phone、light 與 dark、英文與繁體中文。使用至少兩個同時工作的真實任務，或明確標示的隔離 fixture；不得在正式環境虛構工作。\n\n唯讀驗證義務：`src/main.ts` 與 `src/open.ts` 的 server 匯入、匯出與入口行為保持相容，不啟動登入或變更 session。`src/bundled.gen.ts` 的內嵌資產路徑保持相容。`src/runtime/engine.ts`、`src/runtime/index.ts` 與 `src/firstmate.ts` 用於查證權威 node/job 證據、原生任務目的地與 dispatch lineage。`public/app.js` 與 `public/runtime.js` 保持 host 載入、事件傳送與原生任務路由相容。`skins/terminal/index.html` 與 `skins/voyage/voyage.js` 保持 snapshot 與 kit 行為相容。逐檔記錄相容性證據；verificationScope 不授予寫入權限。\n\n沿用已核准的 Codex staffing 與 mandatory pinned skills（`R-036`），安排 coordinator、worker、獨立 reviewer 與 designer，不重選模型。保留 repository identity、signed ledger、artifact validation、船長專屬核准與原生 merge 授權。開啟卡片不等於核准。不自動 remote push。遵守 scope reservation 與正常排程，不搶鎖、不釋放其他任務的鎖、不覆蓋其他工作。\n\n測試使用暫存隔離資料與專用 server；不觸碰運作中的 Studio server、port、process 或資料。不啟動驗證身分流程。僅可在 `/Users/meng-yingyang/workspace/src/github.com/OWNER/crew-studio` 安裝 dependency。完成或失敗回報須標明目前對話與任務，附成果及驗收證據連結。\n\n範圍問題：哪些既有 intent ID 關係具備足夠權威證據，以及 dispatch 時有哪些 reservation 衝突？未驗證的 lineage 保持獨立並標示未確認。Reservation 衝突依正常排程等待。任何新增寫入路徑須經正常 scope 核准。"
  }
}
```
