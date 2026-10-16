# R-038 Claude session resume 調研

- 結論：Claude Code 原生支援以確切 UUID 恢復 context；R-038 可沿用既有 CLI transport，但必須新增 Studio-owned primary resume admission，不能直接把現有一般 attach 當成完整恢復。
- 研究日期：2026-10-16（Asia/Taipei）。
- 獨立研究 agent：`/root/r038_claude_research`，Codex 獨立 context；屬 captain bootstrap 調研，不是 Studio native worker，不代表 R-036 signed grant。
- 範圍：唯讀程式與官方文件，僅新增本檔；沒有呼叫正式 Studio API、操作既有 vendor session、讀出 credential、commit 或部署。
- 程式快照：`701b7d8c3e3079c207d070a6cdf69f12febe0ab7`；開始時 `git status --short` 為空。

## 四象限盤點

| 類型 | 結果 |
| --- | --- |
| known knowns | 本機 CLI 支援 `--session-id`、`--resume`、stream-json；目前 adapter 已有對應參數與事件處理，見下列命令及程式位置。 |
| known unknowns | 隔離真模型 nonce recall、帳號更換後 resume、CLI 錯誤結構穩定性、Studio 重啟後 native permission bridge 恢復，均未完成實測。 |
| unknown knowns | UUID 不等於帳號身分；聊天記錄顯示不等於模型 context；`attached` 不等於 vendor init；`/api/main/resume` 現有命名不代表跨程序 session restore。 |
| unknown unknowns | 掃描發現 fresh-only native tool 綁定、變更 ID 被接受為 fork、Settings 覆寫未知欄位、CLI 非互動權限恢復差異、背景 session busy 與前景 transcript 競爭。 |

## 本機證據與版本

| 命令／讀取 | 已觀察結果 |
| --- | --- |
| `command -v claude` | `/Users/meng-yingyang/.local/bin/claude` |
| `claude --version` | `2.1.299 (Claude Code)` |
| `claude --help` | `--resume [value]` 接受 session ID；`--session-id <uuid>` 明確 UUID；`--fork-session` 產生新 ID；`--continue` 取目前目錄最近 conversation。 |
| `claude --help` | `--input-format stream-json`、`--output-format stream-json`、`--tools ""`、`--strict-mcp-config`、`--safe-mode`、`--bare`、`--no-session-persistence` 均存在。 |
| `claude --help` | `--bare` 不使用 OAuth/keychain；`--safe-mode` 保留正常 auth、關閉 customizations；`--no-session-persistence` 明載不能 resume。 |
| `claude --help` | `--permission-mode` 列出 `acceptEdits/auto/bypassPermissions/manual/dontAsk/plan`，未列現有程式使用的 `default`；是否仍接受舊 alias 未實測，不可僅由 help 推斷拒絕。 |
| 僅查環境變數是否存在 | `ANTHROPIC_API_KEY`、`CLAUDE_CODE_OAUTH_TOKEN`、`CLAUDE_CONFIG_DIR` 均 absent；未印出任何值，未查 keychain 或 credential file。 |
| 規範 | 已逐層檢查適用 AGENTS；實際找到 `/Users/meng-yingyang/AGENTS.md`，內容與使用者提供 Constitution 一致。 |

## 可行 CLI / SDK 路徑

- 建議維持目前 CLI transport，降低 R-038 改動範圍：

```text
# fresh：只有新建時指定新 UUID
claude -p --session-id <new-uuid> \
  --input-format stream-json --output-format stream-json --verbose

# resume：只使用先前持久化並驗證的 UUID
claude -p --resume <saved-uuid> \
  --input-format stream-json --output-format stream-json --verbose
```

- 上述是 session selector 最小骨架，正式啟動還須重新注入相同 config directory、授權的 credential source、Studio MCP、permission bridge、deny rules 與模型契約；不要移除現有隔離控制。
- `--session-id` 不會替代 `--resume`；R-038 resume 不加 `--fork-session`，也不使用 `--continue`、名稱搜尋或最近 session 猜測。
- 官方 Agent SDK 亦提供 `query({ prompt, options: { resume: sessionId } })`，`session_id` 可從 result 取得，TypeScript init 亦有該欄位；`forkSession` 是另一個 session。這是可行替代介面，沒有必要為 R-038 換 transport。未安裝或執行 SDK。來源：[Agent SDK sessions](https://code.claude.com/docs/en/agent-sdk/sessions)。
- CLI init 與 result 的 `session_id`、init `model` 應作為 runtime evidence；上層 UI 狀態、設定 model、舊 transcript 檔名不能單獨當恢復成功證據。

## 官方契約及限制

- resume 載入既有 conversation/tool history；啟動時的 `--mcp-config`、`--settings` 等需重傳。非互動 `-p` 的 permission mode 不普遍沿用舊值，應顯式指定並回讀。背景 session 在帶配置或 JSON output flags 時可拒絕、exit 1；兩個前景程序同 ID 則可能混寫 transcript。找不到 UUID 會報 not-found；不應改試 fresh。來源：[Manage sessions](https://code.claude.com/docs/en/sessions)。
- 預設 transcript 屬本機 config scope；實際 storage 可由 `CLAUDE_CONFIG_DIR` 調整。長路徑、retention、compaction 都會影響查找與可用 context。內部 JSONL 格式不屬穩定 API。來源：[session storage](https://code.claude.com/docs/en/sessions#where-transcripts-are-stored)。
- `--system-prompt-snapshot` 預設可保留首次 prompt，直到 compaction；resume 時改 system prompt 不代表立即生效。R-038 不能只靠重送 system prompt 更新權限，強制控制須在 host。來源：[CLI system prompt flags](https://code.claude.com/docs/en/cli-reference#system-prompt-flags-in-resumed-conversations)及本機 help。
- 模型通常沿用舊 session，但 CLI flags、環境及管理設定會影響選擇；以實際 init/assistant model 核驗，不能以相同 session ID 推論相同模型。來源：[Model configuration](https://code.claude.com/docs/en/model-config)。
- 官方 authentication 文件與 CLI session 文件並未提供「UUID 綁定某一帳號且 resume 自動驗證相同帳號」的可採信保證。本次沒有實測跨帳號；應由 Studio 自行保存及比較非機密 account/config identity。來源：[Authentication](https://code.claude.com/docs/en/authentication)；此項是缺口判定，不是聲稱 vendor 允許跨帳號。

## 現有程式：已核實

| 位置 | 行為及 R-038 含意 |
| --- | --- |
| `src/host/claude.ts:98-128` | discovery 預設掃 `~/.claude/projects`，不是 Studio primary 的 `DATA/claude-firstmate`；`encodeCwd` 也僅 replace，沒有官方長路徑 hash 規則。應從持久化 native primary metadata 精確定位，不依賴一般 session picker。 |
| `src/host/claude.ts:130-141,178-202` | fresh 選 random UUID；named 時用 `--resume`；fresh 的 native tools、strict MCP、settings scope、deny edits 綁定不同分支。恢復 primary 須把「Studio-owned」與「fresh」拆開。 |
| `src/host/claude.ts:208-214` | fresh 首次 init ID 不符會拒絕；其他 ID 改變直接更新並發出 `forked`。R-038 exact resume 必須拒絕未明確要求的 re-ID，不能悄悄接受新 session。 |
| `src/host/claude.ts:244-282` | general attach lazy spawn；fresh/fork 立即 spawn 但沒有 await init admission。`file` 僅 fresh 有值；同一物件 respawn 仍保持 fresh 隔離，不代表程序重啟後能還原該物件。 |
| `src/host/main.ts:175-207` | attach 只接受 discover 找到的 ID、檢查 terminalDriving；傳入的 opts 沒有 nativeTools/studioMcp/primary env/model/denyEdits；回傳 attached 可早於 CLI 啟動。 |
| `src/host/main.ts:303-353` | startFresh 注入 native capability、建立 driver/handoff 並 seed 新 Firstmate；恢復不能再次執行 fresh seed，也不能以該路徑替代 resume。 |
| `src/host/main.ts:124-126` | 重啟保留 driver session ID，但 native fresh primary 刻意不提供 terminal resume command；存在 ID 不是已有 native restore UX。 |
| `src/host/claude-primary.ts:76-103` | readiness 分離普通 account status 與允許的 crew/env OAuth/API key；配置用 Studio 自己的 folder。相同登入顯示不等於兩個 credential source 帳號相同。 |
| `src/host/types.ts:43-44,76-97` | refusal code 尚無 resumeMissing/resumeBusy/identityMismatch；AttachOpts 有 fresh/fork，沒有顯式 native resume identity contract。 |
| `src/server.ts:269-275,714-724` | Settings 目前只讀寫 provider/models；POST 重建 JSON，新增 session 策略時須避免被模型設定更新覆寫。 |
| `src/server.ts:643`、`src/host/main.ts:544-550` | `/api/main/resume` 只將已有 session 的 paused 狀態改成 attached 並 pump；不是跨程序 session restore。 |
| `src/takeover.ts:117-124` | Claude Start 經 readiness 後仍只呼叫 `startFresh`；native resume 需要獨立入口或明確 mode。 |
| `tests/claude-firstmate-primary.ts:1-3,118-148` | 現有測試使用 stub CLI，覆蓋 fresh UUID/config/MCP/permission；不是 vendor context recall 實證。本次僅閱讀，未重跑。 |

## 建議產品及持久化契約（設計建議，尚未實作）

| 策略 | 啟動決策 | 無可恢復 session／恢復失敗 |
| --- | --- | --- |
| `ask` | 每次顯示這次 fresh 或 resume 的明確選擇，以及目標 vendor/session/model；選定後才啟動。 | 顯示缺口；fresh 需當次明確選擇。 |
| `fresh` | 產生新 vendor UUID，不帶 resume，保留舊 session 記錄。 | fresh 自身失敗要呈現失敗，不切換 vendor/model。 |
| `resume` | 只恢復對應 provider/account/config/workspace 的最後一個合格 owned primary。 | 明確拒絕、保留原 ID 及待發內容；提供「本次 fresh」選項，不自動執行。 |

- Settings：持久化 enum `ask | fresh | resume`；建議新安裝／舊設定遷移採 `ask`。此預設為建議，不宣稱使用者已定案。
- 單次 override：只影響當次 startup request，不寫回 Settings；不得以 override 變更 account、vendor 或 model。
- effective policy：`request.override ?? persistedPolicy`。`ask` 產生的選擇綁 request ID；重送同 request 不可再開第二個 CLI。
- resume metadata 至少包含：schema version、vendor、vendorSessionId、Studio ownership、config scope、canonical cwd、非機密 account identity/reference、credential kind（不是 credential）、requested/effective model、effort、CLI version、permission profile、最後成功時間、transcript reference。
- 原子持久化：requested ID 與已確認 ID 分開；init identity 未驗證前不要覆寫 last resumable pointer。result 失敗時仍保存診斷，不把新 ID 升格為成功。
- 成功定義：同一 vendor UUID 的 init/result、正確 model/config/ownership、bridge 重建完成；context 實證另以 nonce recall 驗收。
- 正式 resume 不重播舊 side effects、不復原過期 permission answers、工具 token 或 R-036 grants；重新建立有效工具授權且維持 captain gate。歷史 context 只是資料，不是新授權。

## 錯誤與身分界線

| 邊界 | 建議結果／不可假設 |
| --- | --- |
| 不存在、被清除、截斷或不可讀的 session | `resumeUnavailable`，保留原 ID；不換目錄猜最近 session，不建新 UUID。官方具 not-found 行為，但本機具體輸出尚未實測。 |
| 同 ID init/result 回傳不同 ID | `sessionIdentityMismatch`；拒絕交付 queued captain turn、native tool authority；不能標成成功 resume。 |
| account/config identity 不同或未知 | `identityMismatch` / `identityUnverified`；不能只用 email、UUID 或 token kind 推論。若 vendor 無穩定 account identifier，必須明示未驗證並要求帳號確認。 |
| 登入失效、401/403 | 現有 `claudeNotSignedIn` 可用於通知，但 403 也可能是政策或權限問題；保留 vendor 原始錯誤分類、不要保證重新登入必解。 |
| 額度、429/402 | 現有 `claudeQuotaExhausted`；保留 context，等待或明確重試，禁止轉 fresh/Codex。 |
| 模型不符或舊模型已不可用 | `modelMismatch` / `modelUnavailable`；same ID 不足以放行；另行明確變更模型後重試。 |
| vendor background busy | `resumeBusy`，保留目標；不自動 attach 其他程序、不 stop、不 fork。 |
| 另一前景程序占用 | Studio driver lease + vendor process/transcript observation；不依賴 CLI 排他鎖。TOCTOU 仍須持續偵測並 pause。 |
| timeout、network、未知格式 | `resumeUnverified`；不能把未收到 init 當成功，也不能把所有失敗都歸因 session missing。 |
| 恢復歷史含 active goal / scheduled work | 額外驗證不會啟動未重新授權的背景工作；nonce測試不能涵蓋此風險，正式 primary 驗收須獨立覆蓋。 |

## 驗收矩陣

| 測試 | 必要 oracle |
| --- | --- |
| Settings 三策略＋重啟 | enum 可讀回；改 model/provider 不掉 policy；無效 enum 拒絕；ask 未選前零 CLI。 |
| 單次 override | 例如 persisted resume + override fresh 只新建一次；設定仍 resume；下一次按持久策略。 |
| 真模型 fresh -> process exit -> resume | 隔離 cwd/config，新 UUID S，首輪存一次隨機 nonce；停止新建程序；第二程序 `--resume S` 問 nonce，prompt 不含答案；init/result 仍 S、回答精確匹配。 |
| fresh negative control | 新 UUID T 回答不知道 nonce；不能注入 S transcript、HANDOFF 或 ChatLog；禁用 memory/工具/MCP，避免由檔案讀答案。 |
| missing / damaged | 使用僅測試夾內的不存在 UUID／自建損壞 transcript；失敗、零 fresh retry、pointer 未變、輸入未丟。 |
| busy / concurrent | 用自建 session 驗證兩次同時啟動只有一個 driver；禁止碰既有 session。CLI raw 並行結果與 Studio lock 結果分開記錄。 |
| wrong identity/model/config | mock 必拒絕；真模型僅在受控測試帳號可用時驗證，不把 mock 宣稱 vendor 保證。 |
| native resume | MCP helper 與 permission bridge 重建、tool names 相同、deny rules 保留；舊 token/approval 不能重用。 |
| crash and retry | init 前／後 crash、result 前 crash、重複 request：無隱式 fresh、無重複 captain turn、明確 unknown outcome。 |
| version drift | 固定 CLI version fixture；`default` permission alias、init/result shape、超長 cwd storage 與 CLI upgrade 各有檢查。 |

## 真模型測試狀態與可重現步驟

- 本次未執行真模型請求。原因：環境沒有可直接注入隔離 config 的 API key/OAuth token；`--bare` 不使用既有 OAuth/keychain。沒有為取得測試能力而讀取／複製登入資料，也沒有把一般使用者 config 當測試區。
- 因此「Claude 本機成功恢復 nonce」是未確認，CLI help＋官方文件只證明介面與契約，不證明本機端到端成功。
- 後續受控驗證：由測試 harness 接收已授權的 credential，不印出內容；新建 `/private/tmp/r038-claude-<random>/` 的 cwd/config，使用 `--safe-mode --strict-mcp-config --tools "" --disable-slash-commands --no-chrome --permission-prompts none`，固定精確 model，保留 session persistence；不要使用 `--no-session-persistence`。
- `--safe-mode` 仍受 managed settings；啟動前確認無會執行的管理 hook，若無法證明即停止測試。fresh/resume 只使用這次新 UUID，不使用 `--continue`。
- 用 JSON output 做最小 recall，再用現有 stream-json transport 做 native integration；保存 CLI version、參數（無 secret）、新 session ID、model、exit code、nonce digest 和 exact match 結果。原始測試 transcript 僅屬這次隔離資料。
- 最終還需獨立驗收者重跑 native resume；研究產出者不自行宣告 R-038 acceptance。

## 已驗證／未驗證

- 已驗證：本機 CLI version/help；現有 source 的 fresh/attach/refusal/settings 行為；官方 CLI/SDK session 契約；指定文件已產出。
- 未驗證：真模型 recall、Studio native 重啟 restore、跨帳號阻擋、占用錯誤實測、SDK runtime、permission `default` alias 相容性。
- 沒有修改產品碼、正式設定、現有 session 或正式卡片；沒有 R-038 實作或完成宣告。

## 來源索引

- 本機 primary sources：上述 CLI help/version、repo source 與既有測試；所有程式行號以本報告 SHA 為準。
- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference)
- [Claude Code Manage sessions](https://code.claude.com/docs/en/sessions)
- [Claude Agent SDK Work with sessions](https://code.claude.com/docs/en/agent-sdk/sessions)
- [Claude Code Model configuration](https://code.claude.com/docs/en/model-config)
- [Claude Code Authentication](https://code.claude.com/docs/en/authentication)
- 官方來源於本次查閱；搜尋遇到的第三方轉載、論壇不作技術依據。
