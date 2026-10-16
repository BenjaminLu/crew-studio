# R-038：Codex session resume 調研

- 結論：Codex CLI 0.162.1 與現有 adapter 已提供真正 `thread/resume`；R-038 應補 Studio 的持久策略、精確 thread binding、身份檢查及失敗狀態，無須把 transcript 重新貼入 fresh thread 模擬 resume。
- 調研者：獨立 Codex agent `/root/r038_codex_research`。這是 captain bootstrap 研究，不是 Studio native worker 執行證據，也不是 R-036 signed grant。
- 日期：2026-10-16（Asia/Taipei）；repo 基準：`701b7d8c3e3079c207d070a6cdf69f12febe0ab7`。
- 範圍：唯讀程式與 CLI help/schema；僅新增本報告。不操作現有 vendor session、正式 Studio 卡片、登入或 credential；未 commit。

## 已完成驗證

| 證據 | 結果 |
| --- | --- |
| `codex --version` | `codex-cli 0.162.1` |
| `codex exec --help` | 有 `resume`、`fork`、`--json`、`--ephemeral`、`--ignore-user-config`、`--ignore-rules`、`--sandbox` |
| `codex exec resume --help` | `codex exec resume [OPTIONS] [SESSION_ID] [PROMPT]`；支援 UUID 或 thread name；UUID 優先；有 `--model` |
| `codex app-server --help` | stdio JSON-RPC；有 `generate-json-schema`；app-server tooling 標為 experimental |
| `codex app-server generate-json-schema --out /private/tmp/r038-codex-schema-20261016` | 成功產生本機版本 stable schema，沒有啟動模型或 resume 任何 thread |
| `v2/ThreadResumeParams.json` | 必填 `threadId`；支援 `excludeTurns`、`model`、`modelProvider`、`cwd`、`sandbox`、approval/config/instruction overrides |
| `v2/ThreadResumeResponse.json` | 回傳 `thread`、`model`、`modelProvider`、`cwd`、approval 與 sandbox；`reasoningEffort` 可為 null |

- CLI help/schema 指令均有 PATH alias 建立權限 warning，但 exit 0 且輸出有效；沒有據此宣稱模型可用或 resume E2E 通過。
- 官方頁於調研當日實際開啟；網站內容可能比 0.162.1 新，欄位契約以本機產生 schema 交叉核對。

## 可用的整合方式

| 方式 | fresh | resume | 適用性 |
| --- | --- | --- | --- |
| 現有 app-server | `thread/start`，保存 `result.thread.id` | `thread/resume {threadId, excludeTurns:true}`，再 `turn/start` | 建議沿用；已接 Studio streaming、approval、native tools |
| CLI | `codex exec --json ...` | `codex exec resume --json <EXACT_UUID> <PROMPT>` | 可做隔離 oracle；不得用 `--last` 或 thread name 作產品綁定 |
| TypeScript SDK | `startThread()` | `resumeThread(threadId)`，再 `run()` | 官方支援；本次未安裝或執行，R-038 不需要遷移 SDK |

- CLI 指定 ID 的用法已由 [Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode) 核對；SDK 用法由 [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk) 核對。
- `--ephemeral` 不適合跨程序持久 resume：help 定義它不保存 session files。
- `--ignore-user-config` 只忽略 config，help 明確說 auth 仍使用 `CODEX_HOME`；不能把這個 flag 當成完整身份／副作用隔離。

## ID 與 context 的必要區分

- **resume key 是 `thread.id`**。本機 schema 說 Codex 產生 UUIDv7；`thread.sessionId` 則是同一 session tree 共用的 ID。root 時可能相同，fork／子 thread 不可假定相同。
- Studio 現有 `Driver.sessionId` 實際保存 adapter 的 `AttachedSession.id`，目前源於 `thread.id`。若維持舊欄位名，必須明文標註語意；不要改讀 vendor `thread.sessionId` 取代它。
- `excludeTurns:true` 只縮小回傳 payload，不表示清空模型 context；schema 明確說只回 metadata/live-resume state，歷史可另外分頁取得。
- 官方確認 resume 復原持久 thread，且動態工具會從 rollout metadata 恢復；模型改變會有警告與下一 turn 的 model-switch instruction。[Codex App Server](https://learn.chatgpt.com/docs/app-server#start-or-resume-a-thread)
- `thread/turns/list` 顯示舊訊息、UI 重畫 transcript、文字 handoff 都不是模型成功恢復 context 的充分證據。最終 oracle 應為不同程序對相同 `thread.id` 的 nonce recall。

## 現有 repo 實作與差距

| 程式位置 | 已核實行為 | R-038 含義 |
| --- | --- | --- |
| `src/host/codex.ts:214-239` | fresh -> `thread/start`；plain attach／程序重開 -> `thread/resume`；resume catch 會 close + throw | 真 resume 底層已存在；沒有 resume 失敗自動 fresh |
| `src/host/codex.ts:218-229` | fork 失敗 catch 任意錯誤，讀最近 6 turns 後 `thread/start`，標為 handoff | 這是另一條 legacy takeover 路徑；R-038 resume 不得導入此 fallback |
| `src/host/codex.ts:205,233-234` | resume 回傳不同 ID 時 `follow()` 接受新 ID，發 `forked` | 明確 resume 應拒絕 ID mismatch，不能把新 ID 當同一對話 |
| `src/host/codex.ts:97-108` | list 限 50、沒有 pagination，失敗回空陣列 | 空列表不等於 session 不存在；已知 binding 應按 exact ID 查詢 |
| `src/host/main.ts:175-216` | attach 先 discover、occupancy check，再 adapter attach；錯誤有 `unknown/terminalDriving/attachFailed/startupFailed` | 可借用流程，但 native resume 不能直接繞過 native capability／account admission |
| `src/host/main.ts:187-192,312-313` | plain attach 沒傳 `nativeTools`；native fresh 有傳 | 新 native resume 必須建立相同授權的工具 handler，不能只恢復工具名稱 |
| `src/host/main.ts:304-352` | fresh 驗證 model/effort 後寫 driver、seed、pump | resume 要有等強 admission；不可重新送 fresh onboarding seed |
| `src/takeover.ts:127-139` | `/api/main/start` Codex 固定呼叫 `startFresh`，先驗證 account/model/quota | 目前原生入口尚未提供持久三策略 |
| `src/host/types.ts:72,85-88` | path 區分 resume/fork/handoff/fresh；opts 用兩個 booleans | 建議改為不可歧義的 discriminated intent，避免 fresh+fork 或缺 ID |
| `src/host/types.ts:108-117` | 清除 parent thread 與多種 token env，但保留 `CODEX_HOME` | session store namespace 應是 binding 一部分；不要靠 parent env 辨識對話 |
| `src/server.ts:269` | `chatSettings` 型別只有 provider/models | 本次搜尋未找到 sessionPolicy/sessionMode/resumePolicy；R-038 需新增儲存契約 |

## 建議的策略契約（設計建議，未實作）

- Settings 持久欄位 `sessionPolicy: "ask" | "fresh" | "resume"`；缺值 migrate 為 `ask`，避免舊使用者被自動接入歷史 context。
- 單次 override 只覆寫當次 start intent，不能改寫 Settings；記錄 effective mode 及來源 `settings/one-shot`。
- `ask`：在實際啟動前顯示有資格的明確 thread 選項及 fresh；尚未選擇時不啟動模型，不建立 thread。
- `fresh`：建立新 thread，成功驗證回傳身份後更新本地綁定；保留舊 binding/history，不刪 vendor thread。
- `resume`：只使用已保存且同 namespace 的 exact `thread.id`；沒有 binding -> `resume_target_missing`，保留選擇畫面；不存在、busy、auth/model mismatch 都停止，讓使用者明確選 fresh 才可重新開始。
- 建議 binding：`schemaVersion/provider/vendorThreadId/vendorSessionTreeId?/canonicalCwd/codexHomeNamespace/authMode/accountBinding?/model/effort/createdAt/lastConfirmedAt`。不存 token；tree ID 只用於顯示/關聯。
- 恢復順序：resolve intent -> validate binding -> acquire Studio ownership -> account/model admission -> exact `thread/resume` -> 檢查回傳 ID/cwd/model/effort -> 安裝 native capability ownership -> 顯示 resumed -> 接受 user turn。
- 用持久的 Studio ownership/lease 保護同 thread 的 attach/send；單一 JS `busy` 只能約束該物件。失敗不可提前改寫成功 binding。
- 停止／重啟保留 binding；provider 切換不能把 Codex ID 送入 Claude；切回時用該 provider 自己的 binding。是否跨 project 切換保留多份 binding 是產品待決，建議按 project/provider 分隔。

## 身份、錯誤與占用界線

| 邊界 | 證據與未確認處 | 建議 fail-closed 行為 |
| --- | --- | --- |
| 帳號未登入／配額不足 | `codex-account.ts:39-41` 檢查 ChatGPT/account、model/list、rateLimits；只代表當次 readiness | 保留 thread binding，顯示重新驗證；不得開 fresh 或換 provider |
| 帳號是否同一個 | 0.162.1 `GetAccountResponse` stable schema 的 ChatGPT account 只有 type/email/planType，沒有穩定 account ID；現有 CodexAccount 未保存 account fingerprint | 不把 `authenticated:true` 當成同帳號；需定義登入切換的 binding invalidation，無法證明時 hold；email 可 null 且不等於 account ID |
| model／effort | resume schema 容許 model override；回應提供實際 model/effort；現有 fresh admission 比較設定與實際值 | resume 同樣核對；明確規定是否准許使用者切模型，不能暗中套用預設模型 |
| session 不存在 | 本次未送 bogus resume，精確 vendor error code 未確認；discover 空陣列也可能是錯誤或 pagination | 保留 structured RPC code/data + 安全訊息；區分 missing 與 unavailable，不依「空列表」推斷 deleted |
| 已占用 | `probe.ts:52-63` 是 process name/cwd/mtime heuristic；app-server 不帶 ID 時未必可辨識；mtime 近 3 分鐘也可能是假陽性 | Studio ownership + vendor runtime 狀態；未知外部 writer 應 hold，不能宣稱跨程序互斥已被 vendor 保證 |
| runtime busy／crash | `codex.ts:248` 有物件內 BUSY；start/send 錯誤回傳 failed；RPC timeout 30 秒 | 保存可重試 binding；區分正在執行、程序退出、timeout，禁止 fresh fallback |
| native tools | `codex.ts:178-186` 使用 thread/turn identity 驗證 handler；不支援 dynamic tool 會拒絕 | resume 要重建 handler/授權；舊 context 內的文字授權不構成新的 card/grant |
| context compacted | `HostEvent.compacted` 已存在；持久 context 可能是 vendor 的摘要 | 不承諾逐字無損歷史；nonce 測試只驗證指定案例，UI 應承認 compaction |

- 現有 `rpc()` 把 vendor JSON-RPC error 縮成 `Error(message)`（`codex.ts:30-32`）；若要穩定分類，應保留 code/data 與 method/correlation，避免只比對英文訊息。
- 官方 account methods 及 model discovery 可供 admission 使用，但未提供本機跨帳號 resume 的安全保證；本次不將它推論為自動拒絕跨帳號。[Codex App Server](https://learn.chatgpt.com/docs/app-server#authentication-modes)

## 驗收建議

1. Settings 三值保存、重啟/readback；one-shot override 不持久；invalid enum 拒絕；舊設定預設 ask。
2. ask 不觸發 `thread/start/resume/turn/start`；fresh 取得新 ID；resume RPC 僅用保存的 exact thread ID。
3. resume 失敗、ID mismatch、missing target、帳號未知、model mismatch、外部占用時，斷言零 `thread/start`、零 fork、零 seed、零未授權 queue pump。
4. 超過 50 個 threads、list 暫時錯誤、archived/missing transcript 皆不能被誤判成「沒有歷史所以 fresh」。
5. adapter mock 要覆蓋 crash 後重新 resume、dynamic tool handler 重建、同 thread 兩個 start 請求互斥；mock PASS 不冒稱真實 context restoration。
6. 真實 oracle：在全新隔離工作目錄與專用可持久 session store 建立 thread A；第一 turn 只提供隨機 nonce N，禁止任何工具／hooks／MCP 副作用；等待 completed，關閉該 app-server。
7. 啟動新程序，以明確保存的 A 執行 resume；第二 prompt 只問前一 turn 的 nonce、不包含 N、不貼歷史；要求同 ID、回 N、completed。另建 fresh B 作負控制，B 不應知道 N。
8. 保存版本、namespace、A/B IDs、經遮罩事件、tool count=0、第二 prompt、同 ID 與 nonce comparison 結果。不得讀其他 session；不得 `--last`；只停止自己啟動的程序。
9. 可分階段補模型切換、auth 失效、同 ID 併發、不存在 ID 的隔離 live 測試；不要在 captain 正在使用的 session 上探測。

## 未驗證與待決

- **真實 fresh -> 新程序 resume nonce recall：未執行，未確認。** 本次沒有建立經驗證的獨立登入／session store 隔離，不借用現有 session 或複製 credential 來充當安全性證據；本報告的 PASS 僅限 help/schema/程式查核。
- 跨 account／不同 CODEX_HOME 的精確失敗型態、同 thread 多程序競爭、失去 transcript 後的恢復能力：未做 live 測試。
- Settings scope（全 Studio 或 project/provider）、resume 帳號識別策略、允許 model switch 的產品政策：待 R-038 spec 收斂。
- 建議正式 R-038 DoD 必須有第 6-8 項真實 oracle 與獨立驗收，不以本調研取代正式 worker grant 或驗收。
