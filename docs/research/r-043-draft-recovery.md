# R-043 historical draft recovery

- Source: native spec round 5 tool call, read on 2026-10-16.
- Revision input only; not current-head verification, signed approval, or completed work.
- Recheck source, captain corrections, scope, tests and all gates before dispatch.

```json
{
  "title": "Order unstarted tasks and revise unapproved proposals without replacing their IDs",
  "what": "Provide formal captain card actions for durable ordering of pristine, never-admitted code tasks and revision of an unapproved Firstmate proposal within its original run. A signed reservation is authenticated write authority, distinct from a draft scope. Ordering respects existing reservations, rejects cycles and stale decisions, and preserves normal dispatch and merge approval. Proposal revisions preserve historical content, cards and signed audit; each approval authorizes only the displayed revision. Provide actionable conflict and spec-check diagnostics. Retain the completed bootstrap behavior as regression obligations, not new implementation. Preserve the approved Codex staffing and pinned skills from R-036. Exclude R-038/R-040 product changes and R-041/R-044 lineage grouping or phase styling implementation. The R-041 supplement is revision test content only. Preserve the current write scope and read-only verification scope. Required reviewer, designer and original-card acceptance obligations appear in explain as release gates.",
  "why": [
    "Draft scope overlap previously created mutual waits. Bootstrap removes false reservations, but the current card flow has no durable captain ordering action.",
    "Unapproved proposal cards offer approval or closure only. Requirements need revision within the original run, with approval tied to the exact version and preserved audit history.",
    "Caller verification must remain separate from write authority, and specification judgments must remain separate from executed test evidence.",
    "Conflict and check failures need concrete observations and available recovery actions so existing tasks can continue through formal approval."
  ],
  "done": [
    "Planned test tests/code-task-ordering.ts, 'captain order survives restart': for two clean, never-admitted tasks with overlapping draft scopes, a formal card decision selects A before B; after isolated restart and ordinary approvals, signed evidence shows A completes its verified merge before B starts work, with both original run IDs retained. Expected fail-first on base: no formal durable ordering action exists.",
    "Planned test tests/code-task-ordering.ts, 'ordering preserves authority': attempts involving an active or terminal-unmerged reservation, dirty unadmitted worktree, unknown signed authority, dependency cycle, stale preview or different project produce refusal with no reservation transfer or release; an unrelated clean task remains eligible. Expected fail-first on base: the new ordering decision contract is absent; existing reservation protection is a regression assertion.",
    "Planned test tests/firstmate-proposal-revision.ts, 'revise before approval': a captain adds requirements to an open unapproved proposal through its card; the original run contains a new pending version and no child starts until that exact version receives fresh approval. Expected fail-first on base: the proposal has no revision action.",
    "Planned test tests/firstmate-proposal-revision.ts, 'stale approval and competing answers': stale UI approval, concurrent revision and approval, duplicate submissions and restart replay never apply an old approval to new content or create more than one child for the accepted revision. Expected fail-first on base: approval has no proposal revision binding.",
    "Planned test tests/firstmate-proposal-revision.ts, 'history and identity': after revision and isolated restart, original and successor cards expose their exact historical content and authenticated revision chain; another proposal remains unchanged, tampered evidence blocks launch, and an already dispatched proposal rejects revision. Expected fail-first on base: no preserved proposal revision chain exists.",
    "Planned test tests/firstmate-proposal-revision.ts, 'R-041 supplement': an isolated historical unapproved proposal accepts the full supplement in the same run: grouping only by proven source proposal, childRun or intent lineage; no title inference; independent history without lineage; original R/SC drill-down; consistent configuration, awaiting dispatch, production, awaiting captain acceptance, completed and blocked labels with color plus text or icon, readable in light/dark and with color blindness; unchanged approval gates. Assert exact retained requirements and preserved staffing pins, without implementing the requested skin. Expected fail-first on base: same-run supplement revision is unavailable.",
    "Planned test tests/code-blocker-diagnostics.ts, 'actionable current failure': supplied signed conflict evidence renders holder, overlapping paths, reason and only currently valid card actions; a supplied defective done line renders the exact quote, rule, input identity, missing observation and an actionable replacement; absent or stale brief evidence renders an explicit gap without invented findings. Expected fail-first on base: code handoff reduces overlap to generic rescope advice and has no structured current-failure recovery contract.",
    "Regression acceptance gate 'bootstrap caller boundary': node tests/caller-coverage.mjs, bun tests/spec-verification-scope.ts and bun tests/spec-scope-blockers.ts retain assertions for nonrecursive read-only verification, omitted real callers, invalid verification paths and authenticated holds. Expected fail-first on integrated bootstrap base: none; this gate rejects regression. The prior d2f55a70 fail-first recorded in docs/units/spec-scope-bootstrap.md is historical evidence only, not execution evidence for this draft.",
    "Regression acceptance gate 'plan is not execution': bun tests/done-lines-observable.ts retains acceptance of new planned tests and rejection of missing test or failure expectations; missing, stale or failed execution keeps completion unproved and build fail-first closed. Expected fail-first on integrated bootstrap base: none for this existing contract; no spec PASS counts as executed acceptance.",
    "Planned test tests/task-recovery-ui.mjs, 'formal recovery cards': an isolated server with temporary data exposes ordering and revision from Captain, Board and task details; assertions cover keyboard access, Traditional Chinese input, light/dark legibility, explicit pending/stale feedback and historical drill-down, with before/after captures tied to the tested head. Expected fail-first on base: ordering and revision controls are absent."
  ],
  "scope": [
    "src/domain/code.ts",
    "src/domain/code-queue.ts",
    "src/domain/code-handoff.ts",
    "src/domain/code-ordering.ts",
    "src/firstmate.ts",
    "src/firstmate-revision.ts",
    "public/scard.js",
    "workflows/v2/firstmate-proposal.wf.yaml",
    "packs/firstmate/workflows/code-firstmate.wf.yaml",
    "tests/code-task-ordering.ts",
    "tests/firstmate-proposal-revision.ts",
    "tests/code-blocker-diagnostics.ts",
    "tests/task-recovery-ui.mjs",
    "tests/code-handoff.ts",
    "docs/units/task-ordering-proposal-revision.md"
  ],
  "verificationScope": [
    "src/domain/code-recovery.ts",
    "src/runtime/engine.ts",
    "src/runtime/cards.ts",
    "src/runtime/index.ts",
    "src/server.ts",
    "src/firstmate-projects.ts",
    "src/firstmate-staffing.ts",
    "public/board.js",
    "public/runtime.js",
    "public/index.html",
    "skins/captain/captain.js",
    "tests/spec-scope-blockers.ts",
    "tests/spec-verification-scope.ts",
    "tests/caller-coverage.mjs",
    "tests/done-lines-observable.ts",
    "tests/code-rescope-recovery.ts",
    "tests/firstmate-dispatch-refresh.ts",
    "tests/firstmate-native.ts",
    "tests/firstmate-project-registration.ts",
    "tests/native-onboarding.ts",
    "tests/native-coffee-kit.ts",
    "tests/operating-rules.ts",
    "tests/startup-recursion.ts",
    "tests/board-start.ts",
    "tests/code-worker-evidence.ts",
    "tests/native-backbone-integration.ts",
    "tests/native-queue.ts",
    "tests/pack-genesis-interview.ts",
    "tests/pack-genesis-native.ts",
    "tests/remote-gates-naming.ts",
    "tests/remote-gates-pending-naming.ts",
    "tests/remote-gates-r3.ts",
    "tests/agent-skills.ts",
    "tests/brief-evidence.ts",
    "tests/card-zh.ts",
    "tests/git-config-guard.ts",
    "tests/github-foundation.ts",
    "tests/remote-ci-lifecycle.ts",
    "tests/remote-ci-reconcile.ts",
    "tests/remote-gates-approval.ts",
    "tests/remote-gates-card-fixture.ts",
    "tests/remote-gates-context-race.ts",
    "tests/remote-gates-intent.ts",
    "tests/remote-gates-readiness.ts",
    "tests/review-depth.ts",
    "tests/round-paths.ts",
    "tests/smoke-code.ts",
    "tests/visual-sandbox.ts",
    "tests/scard-ime-ui.mjs",
    "tests/proposal-state.mjs"
  ],
  "door": {
    "kind": "one-way",
    "reason": "Ordering and proposal revision affect signed approval and dispatch authority. A source revert cannot undo an accepted revision or a started child; preserve historical records and require a fresh explicit captain decision for further changes."
  },
  "explain": {
    "en": "The proposal card in `src/firstmate.ts` offers approval or closure, and its launch selection has no proposal revision binding. The prior diagnosis identifies dependency reads without a captain ordering action in `src/runtime/engine.ts` and generic conflict advice in `src/domain/code-handoff.ts`. The bootstrap already separates draft scopes from signed reservations and `verificationScope` from write scope; its observability prompt accepts planned tests. No tests ran in this draft.\n\nThe captain's SC-083 correction identifies three remaining draft defects: `relevant` in `explain.en` and two human acceptance lines without test files. This is not a reported scope conflict. The rule in `packs/firstmate/checks/done-lines-provable/check.yaml` requires both a test path and a fail-first marker on every done line, while `packs/firstmate/checks/done-lines-observable/check.yaml` permits human gates. Keeping human release decisions in done therefore fails the deterministic contract despite the judged allowance. Human obligations now appear below as required release gates; done retains named automated behavior checks. Existing bootstrap regression gates expect no base failure; new behavior tests name the missing base behavior. None claims executed fail-first evidence. A fresh judged result must identify the exact defective line, rule, supplied input and missing observation with an actionable replacement, or the report must state that judge evidence is unavailable.\n\nScope questions remain limited to current original-card status and formal signed evidence of the reported refresh to `701b7d8c`. The supplied round 4 brief and captain correction govern this wording revision. The older `d2f55a70` brief provides no current failure authority. The captain reports bootstrap merged and Studio restarted; older bootstrap document status is historical. The prior duplicate git import observation in `src/domain/code-queue.ts` is unexecuted; compilation evidence is required before attributing a runtime failure to it.\n\n`verificationScope` requires compatibility review of each listed existing caller and isolated regressions, especially unchanged code installation, proposal registration and staffing, queue recovery, card rendering and remote gates. These exact files grant no write authority and seed no recursive scope. A verified defect that needs another file requires an explicit scope question before edits. Local validation uses temporary data; the documented missing historical parent for `tests/native-queue.ts` remains BLOCKED unless actual execution resolves it. Record commands, head, assertion results and UI captures in `docs/units/task-ordering-proposal-revision.md`, separating isolated evidence, captain operations and unknowns.\n\nRequired release gates: an independent fresh-context reviewer reviews the exact candidate diff and signed evidence for version binding, race handling, reservation protection and caller compatibility; release requires no unresolved blocking finding. An independent designer reviews head-bound before/after captures of the recovery cards for keyboard use, Traditional Chinese input, light/dark and color-blind readability, pending/stale feedback and historical drill-down. Test-plan PASS does not satisfy either gate. All existing scope, branch, rebase, CI, fail-first and approval gates remain required; no GitHub PR is required.\n\nRequired original-card release gate: after isolated acceptance, the captain records formal UI evidence for ordering the existing tasks (R-038 and R-040) and revising the original proposal (R-041), retaining original IDs, cards, versions and signed history. A current-card blocker is reported as blocked, never completion. During repair, R-038 and R-040 remain undispatched; the independent task (R-044) proceeds only without actual write conflicts. Workers have no authority to access the live server, live data or runtime JSON. Replacement tasks, worker mutation of live state and runtime JSON edits do not qualify. If the repair blocks on the same mechanism, report the minimal bootstrap file list, observed root cause and reproduction evidence, required changes, local verification commands and limits for captain CLI repair followed by formal UI acceptance. Preserve signed ledger and reservation authority.",
    "zh-TW": "`src/firstmate.ts` 的提案卡只有核准或關閉選項，啟動時選取核准卡也未綁定提案修訂版本。先前診斷指出，`src/runtime/engine.ts` 讀取相依關係，但沒有船長排序操作；`src/domain/code-handoff.ts` 只提供籠統的衝突建議。Bootstrap 已分開草稿範圍與已簽署保留權，也已分開 `verificationScope` 與寫入範圍；可觀察性檢查的提示詞接受計畫中的測試。本輪草稿未執行測試。\n\n船長對 SC-083 的更正指出，草稿只剩三項缺失：`explain.en` 的 `relevant`，以及兩條未列出測試檔的人工驗收條件；目前回報的問題不是範圍衝突。`packs/firstmate/checks/done-lines-provable/check.yaml` 要求每條 done 同時列出測試路徑及 fail-first 標記，`packs/firstmate/checks/done-lines-observable/check.yaml` 卻允許人工 gate。因此，把人工放行決策留在 done，即使符合判斷式檢查，仍不符合確定式檢查。人工義務現列於下方必要 release gates，done 保留具名的自動化行為檢查。既有 bootstrap regression gates 不預期在 base 失敗；新行為測試則指明 base 缺少的行為。這些條件都不宣稱已執行 fail-first。新的判斷結果必須指出具體缺失條件、規則、輸入與缺少的觀察，並提供可執行的替代條件；若無判斷證據，報告必須明確註記。\n\n待確認事項僅保留原卡目前狀態，以及回報已更新至 `701b7d8c` 的正式簽署證據。本次文字修訂以提供的 round 4 brief 與船長更正為準。較舊的 `d2f55a70` brief 不能作為目前失敗的依據。船長回報 bootstrap 已 merge 且 Studio 已重啟；舊 bootstrap 文件的狀態屬歷史紀錄。先前在 `src/domain/code-queue.ts` 觀察到重複 git import，但尚未執行驗證；取得編譯證據前，不可據此歸因 runtime 失敗。\n\n`verificationScope` 要求逐一檢查所列既有 caller 的相容性及隔離 regression，尤其是既有程式安裝、提案註冊與 staffing、佇列恢復、卡片呈現及 remote gates。這些確切路徑不授予寫入權，也不遞迴擴張範圍。若已驗證的缺陷需要其他檔案，編輯前必須提出明確的範圍問題。本機驗證使用暫存資料；`tests/native-queue.ts` 已記錄的歷史 parent 缺失維持 BLOCKED，除非實際執行證明已解決。命令、head、斷言結果及 UI 截圖記錄於 `docs/units/task-ordering-proposal-revision.md`，分清隔離證據、船長操作及未知事項。\n\n必要 release gates：獨立且使用 fresh context 的 reviewer 檢查確切候選 diff 與簽署證據，涵蓋版本綁定、競態處理、保留權保護及 caller 相容性；所有阻塞發現解決後才能放行。獨立 designer 檢查綁定測試 head 的恢復卡片前後截圖，驗收鍵盤操作、繁體中文輸入、light/dark 與色盲可讀性、待處理及過期回饋、歷史 drill-down。測試計畫的 PASS 不滿足任一人工 gate。既有 scope、branch、rebase、CI、fail-first 與核准 gates 全數保留；不要求 GitHub PR。\n\n必要原卡 release gate：隔離驗收完成後，船長透過正式 UI 記錄既有任務（R-038 與 R-040）的排序及原提案（R-041）的修訂證據，保留原 ID、卡片、版本與簽署歷史。原卡若仍受阻，必須回報阻塞，不可宣稱完成。修復期間，R-038 與 R-040 維持未派工；獨立任務（R-044）僅在沒有實際寫入衝突時續行。Worker 無權存取正式服務、正式資料或 runtime JSON。重建任務、worker 修改正式狀態或編輯 runtime JSON 都不符合驗收。若修復仍卡在同一機制，必須回報最小 bootstrap 檔案清單、已觀察根因與重現證據、必要修改、本機驗證命令及限制，供船長以 CLI 修復後回到正式 UI 驗收。簽署帳本與保留權授權均須保留。"
  },
  "zh": {
    "title": "排序尚未開始的任務，並在保留原 ID 下修訂未核准提案",
    "why": [
      "草稿範圍重疊曾造成任務互等。Bootstrap 已移除不成立的保留權，但目前卡片流程仍缺少可持久保存的船長排序操作。",
      "未核准提案卡只有核准或關閉選項。需求必須能在原 run 修訂，核准須綁定確切版本，並保留稽核歷史。",
      "Caller 驗證必須與寫入授權分開，規格判斷也必須與已執行的測試證據分開。",
      "衝突與檢查失敗需要具體觀察及可用的恢復操作，讓既有任務能經正式核准續行。"
    ]
  }
}
```
