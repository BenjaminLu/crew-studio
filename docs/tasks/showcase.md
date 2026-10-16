# Crew Studio：全新使用者 Coffee-kit showcase

- 狀態：2026-10-16 已完成 fresh-data E2E 與實際錄製；R-003 / site v3 已核准入庫。包含一次原生來源修復與一次影片修改，並非無錯誤首跑。詳見第 14 節。
- 研究基準：2026-10-16，repo `d58fa93f`；實際錄製前記錄新的 commit SHA。
- 目標：觀眾看見全新的 Studio，從第一次開啟、模型連接、Firstmate 引導，到產生網站／圖片／影片、修改、驗收，最後在成品庫重新開啟。
- 成功定義：同一個全新資料集內完成真實任務與一輪修改；最後核准版本可從成品庫開啟；錄影、截圖與任務證據對得上。
- 不保證模型服務第一次生成一定成功；以預檢、完整彩排、正式錄製與已驗證影片備援提高 pitch 成功率。任何尚未通過項目不得當作完成。

## 1. 展示邊界與空白定義

- [ ] 正式展示使用全新 `CREW_DATA`，沒有舊對話、任務、代理配置、作品或既有驗收紀錄。
- [ ] 使用專用 Chrome profile，首次啟動前清空展示站台的 cookies、localStorage、IndexedDB 與 service worker；避免舊 onboarding 完成旗標跳過導覽。
- [ ] 原本 4210 的資料保留為備份；正式展示時切換 4210 到新資料目錄，不能讓舊任務混入畫面。
- [ ] 舊資料不搬進新資料集；不預塞成品、staffing 核准或工作成功狀態。
- [ ] Bun、固定依賴、瀏覽器與既有模型 CLI 帳號可事先準備，畫面需說明「工具已安裝，Studio 是第一次使用」。這不是全新作業系統安裝教學。
- [ ] 如果模型帳號本來已登入，據實顯示已登入；不要假裝重新登入成功，也不為錄影刪除共用 CLI 憑證。
- [ ] 錄下 Studio 的模型連接／確認與首次導覽；OAuth 或私人帳號頁可暫停錄製，恢復後標記省略登入細節。
- [ ] 所有工作使用真實 provider；不使用 stub、測試 fixture、手改 ledger 或 DOM 偽造狀態。
- [ ] 本機 unrestricted 已獲授權；依賴只裝此 repo。Captain 卡片與驗收仍保留，不宣稱完全無人介入。
- [ ] Coffee-kit 主秀；創業辯論為獨立備選。正式主秀錄製期間不並跑其他工作，避免配額、CPU 與畫面干擾。

## 2. 目前已知事實與必須先解決的缺口

| 項目 | 已確認 | 展示前要做 |
| --- | --- | --- |
| 原始碼 | unrestricted 支援 `5694aa47` 已在 origin/main；啟用值在 ignored `.env` | 確認新程序實際繼承設定，不將「程式已推送」當作「環境已啟用」 |
| 工具 | repo-local Bun、HyperFrames、GSAP、Node 路徑存在；ffmpeg 與 screencapture 可找到 | 執行 renderer readiness 與錄影試片，存在不等於可用 |
| 既有 Coffee | R-031 已有 site v6、image v1、video v2 | 歷史檢查時仍 waiting；現已修復至 v10 succeeded，詳見第 13 節 |
| 審查阻塞 | SC-059 指出文字 reviewer 沒有 site v6／video v2 的實際視覺與播放證據；先前 v4 驗證不能替代 v6 | 先驗證精確版本；確認如何把真人／瀏覽器證據帶回審查，避免「需視覺驗收才能進驗收卡」循環 |
| 入庫 | `coffee.library` 要求當代 bundle 的 signed captain approval 與 artifact approved 狀態 | 真實跑通 library -> done；僅有預覽 URL 不算入庫 |
| 首次體驗 | main 已有新的 first-workflow tutorial | 以乾淨瀏覽器實際確認入口；不能假設舊三步 quick tour 就是首次體驗 |
| 帳號能力 | CLI 安裝、登入、模型可用與圖片生成是不同層次 | 新 Studio 逐項確認，成功 staffing 不等於媒體生成成功 |
| 錄影 | 系統工具支援螢幕錄影與點擊顯示 | 螢幕錄製權限、輸出編碼、畫面尺寸與片尾完整性尚待試片驗證 |
| 隱含前提 | 新 data 不會清掉瀏覽器 onboarding；共享 CLI 帳號不是 Studio 初始設定 | data 與 browser 兩邊都重置，保留真實帳號狀態 |
| 鄰接風險 | 第二個 instance、過期 staffing、媒體相依版本、重載重送、睡眠／配額 | 每個風險都有下列停損與檢查；不靠不停重試掩蓋 |

- 最新決定：影片靜音自動播放並保留暫停；reduced-motion 顯示 poster。Coffee-kit 保持 12 秒，取消五秒需求。錄影工具試片仍為 10 秒。Captain 暫免人工視覺驗證；技術完整性、版本綁定與最終核准保留。視覺項目記為「依授權暫免／未驗證」，不得寫 PASS。

## 3. 工作順序與時間安排

- [ ] 預檢與解決已知 blocker：預留 30–45 分鐘；超時先整理真實狀態，不急著正式錄製。
- [ ] 在獨立 rehearsal data 跑一次完整小白流程：預留 45–90 分鐘，實際耗時待測。
- [ ] 彩排成功後凍結 commit、依賴、模型與講稿；關閉無關任務。
- [ ] 再建立另一個真正空白的 recording data，正式錄製完整流程；不沿用已跑過彩排的資料。
- [ ] 剪出 3–4 分鐘 pitch 版本，保留完整原片；等待可加速並標示倍速／實際耗時。
- [ ] 最後 20–30 分鐘只做播放、檔案與備援檢查，不更新 main、不調整模型、不重設成功環境。

## 4. 預檢與環境切換

### 4.1 保存既有環境與固定版本

- [ ] 記錄 `git rev-parse HEAD`、`git status --short`，確認預期程式已提交；錄製期間不 pull。
- [ ] 查目前 worker／renderer 是否仍在工作；等它們結束或按正式流程停止，再停止舊 Studio 程序。
- [ ] 保存舊 `CREW_DATA` 路徑、啟動參數與最後狀態。原資料不刪除、不覆寫。
- [ ] 如需複製備份，只在 server 與 jobs 都停止後複製完整資料目錄，避免不一致快照。
- [ ] 確認展示用 4210 無其他 server，且沒有兩個程序共用一份 data。

### 4.2 準備此次路徑

- [ ] 在 repo root 的兩個 terminal 分別設定相同值；每次正式錄製使用新名稱。

```sh
export SHOWCASE_ROOT="$PWD/.tmp/showcase/2026-10-16-take01"
export CREW_DATA="$SHOWCASE_ROOT/studio-data"
export CREW_PORT=4210
export CREW_LOCAL_UNRESTRICTED=1
export CREW_LOCAL_DEPENDENCY_ROOT="$PWD"
export CREW_HYPERFRAMES_ROOT="$PWD"
export SHOWCASE_BUN="$PWD/.crew-studio/tools/bun/bun-darwin-aarch64/bun"
mkdir -p "$SHOWCASE_ROOT/evidence/screenshots" "$SHOWCASE_ROOT/evidence/video"
test ! -e "$CREW_DATA"  # 首次啟動前必須成功；失敗就改 take 名稱，不刪舊資料
```

- [ ] `.tmp` 已被 git ignore；錄影、憑證與 runtime 資料不納入 commit。
- [ ] 確認 ignored `.env` 的 `HYPERFRAMES_BROWSER_PATH`、`CREW_PLAYWRIGHT_MODULE`、`CREW_PLAYWRIGHT_EXECUTABLE_PATH`、`CREW_NODE_BIN` 指向存在的檔案。
- [ ] 不照通用 setup 文件安裝到 HOME 或 global；缺依賴時僅在 repo 使用已固定 lockfile 的安裝流程。
- [ ] 確認磁碟至少保留足夠錄影空間，建議 10 GB；電源接上、關閉自動睡眠與通知。

### 4.3 啟動與首次登入

- [ ] Terminal A 啟動，保存 log；不得把完整 log／session link 直接放上公開影片。

```sh
"$SHOWCASE_BUN" src/main.ts > "$SHOWCASE_ROOT/evidence/server.log" 2>&1
```

- [ ] Terminal B 使用同一組環境參數開啟具寫入權限的 session。

```sh
"$SHOWCASE_BUN" src/main.ts open
```

- [ ] 確保開到專用 Chrome profile；若 opener 開錯 profile，使用正常 launch 流程處理，不手工偽造 cookie。這項要在彩排確認。
- [ ] 進入後確認網址已沒有 session secret，才錄可分享畫面；不要錄 terminal 中的認證 URL。
- [ ] 首屏應為真正首次體驗，任務與成品庫為空；若不是，停止並檢查 data／站台儲存狀態。
- [ ] 在 UI 確認模型連接、Codex 可用性、renderer readiness、GitHub off、本機 execution mode。
- [ ] 新 data 的 renderer discovery／模型配置不從舊 settings 偷搬；依 UI 真實設定。

## 5. 錄影與截圖準備

- [ ] 主錄影選 macOS `Shift-Command-5`，只框住 Chrome 展示區；固定 16:9，建議 1920x1080。
- [ ] 顯示點擊、游標與必要的網址／導航；關閉書籤列、通知、私人分頁及帳號選單。
- [ ] 螢幕錄影權限需先完成並測試；授權失敗不得開始正式 take。
- [ ] 先錄 10 秒試片：開 Firstmate、點一次、捲動、停止；播放確認清楚、不黑屏、沒有憑證、可正常結尾。
- [ ] 可先錄無旁白完整操作，再配講稿；若要同步旁白，先測麥克風。不要把生成影片的無聲當作錄音故障。
- [ ] 如採 CLI，以下命令須先在此機試片驗證；正式錄影以互動工具選區與停止較直覺。

```sh
/usr/sbin/screencapture -v -V 10 -k "$SHOWCASE_ROOT/evidence/video/capture-smoke.mov"
/usr/sbin/screencapture -i -x "$SHOWCASE_ROOT/evidence/screenshots/capture-smoke.png"
ffprobe -v error -show_entries format=duration -show_entries stream=codec_name,width,height -of json "$SHOWCASE_ROOT/evidence/video/capture-smoke.mov"
```

- [ ] 截圖固定相同尺寸、theme 與繁體中文；長頁另存 full-page 圖，不拿長圖充當影片畫格。
- [ ] Playwright 可補精確 viewport 截圖／播放數據；現有測試使用此方法，但 fixture 圖不能當 live showcase 證據。
- [ ] 不把「截圖串成影片」稱為完整操作錄影。若剪掉等待，保留原片並在成片標示。
- [ ] 每個關鍵節點記錄：時間、影片 timecode、task/card ID、artifact/version、動作、結果、截圖檔名。

## 6. 正式 E2E：逐步執行與擷取畫面

| 步驟 | 要做的事 | 預期結果／停止條件 | 截圖與錄影重點 |
| --- | --- | --- | --- |
| 01 | 開全新 Studio，展示首次歡迎與空白任務／成品庫 | 沒有舊任務與成品；否則停止 | `01-first-use.png`、`02-empty-library.png` |
| 02 | 依首次引導連接／確認 Codex | 狀態真實，登入不等於所有能力已通過 | `03-model-ready.png`；跳過私人 OAuth 畫面時註明 |
| 03 | 進 Firstmate，送下方固定需求 | 對話產生設計討論；不能只秀命令列直建任務 | `04-firstmate-intent.png` |
| 04 | 回答必要澄清並確認完整設計方向 | 網頁、圖片、影片共用一致計畫 | `05-design-plan.png` |
| 05 | 確認四個角色 provider/model/effort/skills | 原生 staffing 卡核准成功；如失敗先修原因 | `06-staffing.png` |
| 06 | 核對 Firstmate 派工卡並批准；記下新 task ID | 真實 child task 建立，不能只停在 proposal | `07-dispatch.png` |
| 07 | 核准該任務的創作方向卡 | 正確 plan 與任務開始流轉 | `08-direction.png` |
| 08 | 展示 Board 與船員頁的實際進度 | 頁面／圖片可並行；不要宣稱四角色同時都在跑 | `09-workers.png`；顯示真實 job/provider |
| 09 | 等圖片／網頁完成及影片 renderer 執行 | 顯示 local renderer 與 LLM 的差異；不是空等動畫 | `10-rendering.png` |
| 10 | 開整合預覽，檢查圖、文案、影片 | 真實 12 秒 MP4，無壞圖；記下精確 bundle version | `11-preview-v1.png`；實際播放片段 |
| 11 | 驗證當代影片可播放與版本；人工視覺品質依 Captain 決定暫免 | 暫免不記為視覺 PASS；技術缺陷仍需修正 | `12-mobile.png`、`13-playback.png` |
| 12 | 在正式修改卡要求「降低運鏡幅度」 | 一次真實 video revision，不手改產物 | `14-revision-request.png` |
| 13 | 等影片新版、重組與重新審查 | video/site 版本更新；原 image/page 可復用 | `15-revision-result.png`；前後運鏡對比 |
| 14 | 驗證新版，核准整個網站 | 精確當代 bundle 被 captain 核准 | `16-final-approval.png` |
| 15 | 任務走完 library -> done，開成品庫 | succeeded、artifact approved、版本一致 | `17-complete.png`、`18-library.png` |
| 16 | 從成品庫開作品，重新播放；回原始對話 | 有可用結果連結與正確原始 task 關係 | `19-library-open.png`、`20-chat-result.png` |
| 17 | 重整頁面，再開任務／作品 | 不新增任務、不重跑生成、不重複批准 | `21-after-reload.png` |

### 首次需求稿

```text
我是第一次使用 Crew Studio。請用 coffee-kit 幫虛構品牌「慢日咖啡 Slow Day Coffee」
製作繁體中文單頁網站，包含品牌故事、菜單介紹、到訪說明、一張真正生成的咖啡圖片，
以及一支可播放的 12 秒影片。風格是奶油白、咖啡棕、橄欖綠，溫暖晨光，圖片不要文字。
影片三段各 4 秒，溫和運鏡，靜音自動播放，支援減少動態效果；CTA 導向頁內品牌故事。
不要虛構真實地址、營業時間、價格或顧客評價，也不發布到外部網站、不需要 GitHub PR。
請先帶我確認設計與代理配置，再用正式卡片讓我核准派工；完成後我要看作品、修改一次、
驗收並存入成品庫。所有模型角色先使用 Codex，以實際可用模型為準。
```

- [ ] artifact project 使用簡單 ID，例如 `slow-day-coffee-showcase`；Coffee artifact project 不應強迫註冊 Git repo。
- [ ] 候選角色可沿用已跑過的搭配：worker `gpt-6.1-sol/high`、image-worker `gpt-6.1-sol/medium`、reviewer／designer `gpt-6-astra/high`。必須先確認實際可用性，不假設名稱或配額永遠有效。
- [ ] UI 新 tutorial 與 Firstmate 正常入口若不同，彩排記錄實際路徑；不為符合講稿跳過首次流程。

### 修改稿

```text
請只降低影片的平移與縮放幅度，保留 12 秒三段節奏、原文案、CTA 與圖片。
完成後重建相依網站並重新審查，我會檢查新版後再核准整個網站。
```

### Captain 外觀：正式流程必備

- [ ] 首次導覽後到 `#/skins`，首次先按「顯示實驗功能」，再選 Captain ->「使用這個外觀」，錄下切換。
- [ ] 工作中以 Captain 為主畫面，擷取執行、等待核准、修改後再執行、完成四種真實狀態。
- [ ] Captain 是唯讀狀態呈現；點待辦開啟正式卡片，由 Pro mode 核准後返回 Captain，不假裝外觀自行核准。
- [ ] 驗證任務與船員狀態同步、文字不爆版、hover 資訊可讀、已結束任務不留下誤導性的阻塞圖示。
- [ ] 追加截圖 `captain-working.png`、`captain-awaiting-approval.png`、`captain-revision.png`、`captain-complete.png`。
- [ ] 如 Captain 狀態不正確，列為正式錄製 blocker，修好後重測。

## 7. 精確版本的人工與瀏覽器驗證

- 本次人工視覺品質驗收暫免；下列視覺檢查保留為未來完整驗收清單，不阻擋此次入庫。技術播放能力、檔案完整性、相依版本與正式核准仍為必填。

- [ ] 記錄 site、page、image、video artifact ID 與 version；截圖必須來自本次當代版本。
- [ ] 桌機：無橫向溢出、文字清楚、圖片載入、CTA 確實到 story，沒有假地址等內容。
- [ ] 手機：以 390px viewport 檢查；hero 堆疊、圖片裁切、字幕與控制按鈕不重疊。
- [ ] 播放：從 0 播到結尾，長度約 12 秒；播放／暫停／seek 可用，靜音 autoplay 可用；reduced-motion 時不自動播放。
- [ ] 影片三個段落、文案與 CTA 正確；修改後運鏡比初版低，不能只看生成成功紀錄。
- [ ] 鍵盤：Tab focus 可見，播放按鈕可操作；中文 label 跟隨播放狀態。
- [ ] reduced motion：初始載入顯示 poster；播放中切換偏好能停止並回 poster；明確 opt-in 後可播放。
- [ ] 圖片是真實產出而非 placeholder；網站使用的圖片／影片版本與 receipts 一致。
- [ ] 證據記錄實際操作與結果，不把 source review 當作看過畫面。

## 8. 失敗處理與錄製停損

| 問題 | 處理 | 不可做 |
| --- | --- | --- |
| 首屏不是空白 | 檢查 data 路徑與專用 browser storage；換新 take | 刪幾張卡冒充首次體驗 |
| 模型／配額不可用 | 保存診斷；恢復能力或明確更改配置後再核准 | 默默換 vendor、連按重試 |
| staffing 過期／已變更 | 重新取得當前 facts，核准正確任務綁定 | 改 hash／ledger 或套舊卡 |
| renderer 不可用 | 修好 repo-local 路徑，安全重啟，使用正式 capability recovery | 宣稱 HTML 預覽就是 MP4 |
| reviewer 缺視覺證據 | 來源審查標記視覺未驗證；帶入 Captain 暫免決定，技術檢查通過後再最終核准 | 把舊版本證據貼成新版；把 warn 改 pass |
| 視覺驗收循環 | 彩排先確認是否仍發生；若證據無法正常送達，列 blocker 並修復來源流程後重測 | 一直 retry 重建新版本造成證據再次過期 |
| 任務中途停止 | 錄下錯誤／卡片；使用 native recovery；未知原因不宣稱已修復 | 直接寫入成功狀態 |
| 原始對話沒收到結果 | 檢查 source conversation 綁定、結果回傳與 reload | 手動貼連結後宣稱自動回傳成功 |
| 入庫失敗 | 保留任務與 receipts，查 library node／approval version | 只把預覽加入書籤充當成品庫 |
| 正式錄製遇錯 | 結束此 take，保留原片與原因，修完再開新空白 take | 把不同任務拼接成同一次連續成功 |

- [ ] 第一個未解釋的重複錯誤就停止盲目重試；記下原因和修復，重跑相關驗證。
- [ ] 只有已完成真實 E2E 的錄影片段可當 pitch 成功備援；R-031 是歷史恢復成品，本次 fresh-data 證據以 R-003 為準。
- [ ] 現場服務不穩時播放標示為「事先實際錄製」的成功影片，再開已核准作品；不冒充即時生成。

## 9. 證據包與 pitch 剪輯

```text
.tmp/showcase/<take>/
  studio-data/                  # 完整 runtime 資料，私人，不公開
  evidence/
    manifest.md                 # SHA、時間、環境、ID、版本、結果、待解問題
    timeline.csv                # timecode,action,task,card,artifact,version,screenshot,result
    server.log                  # 私人原始紀錄；對外另做遮罩版本
    screenshots/01-...png
    video/capture-smoke.mov
    video/full-take.mov         # 不剪原片
    video/pitch-cut.mp4         # 3–4 分鐘，標示加速／省略
    checks.md                   # 最終逐項 PASS/FAIL 與證據
```

- [ ] pitch 順序：首次開啟 20 秒 -> 一句需求與設計 35 秒 -> 角色／派工 30 秒 -> 自動製作 35 秒 -> 成品與修改 50 秒 -> 驗收／成品庫 30 秒。
- [ ] 實際等待另註明耗時；不要用剪輯暗示影像／影片瞬間生成。
- [ ] 片尾留成品庫與成功任務各至少 3 秒；必須看得出來完成在哪裡。
- [ ] 影片中標示 Captain 核准與 agent 自動工作兩種動作。
- [ ] 分享包只包含去敏感的截圖、影片、必要證據；不包含 data、session token、帳號資訊、完整 HAR 或帶認證 URL。
- [ ] 對影片與圖做 SHA256 清單；將錄影複製到另一個本機資料夾／展示機並實際離線播放。
- [ ] 成功資料集保留，收尾停止 server 後做一致備份；記錄如何用相同 `CREW_DATA` 重開，不能再重設這份成功資料。

## 10. 最後檢查（初始清單；本次結果見第 14 節及 evidence/checks.md）

| 檢查 | 結果 | 證據／檔名 |
| --- | --- | --- |
| 固定 commit，依賴只在 repo；沒有錄製期間更新 | 未驗證 | |
| 全新 Studio data + 全新站台儲存，首屏與空庫有錄到 | 未驗證 | |
| 模型連接與首次引導完整，私人認證未曝光 | 未驗證 | |
| Firstmate 真實討論、設計、角色確認與原生 dispatch | 未驗證 | |
| 實際 provider/job 與核准配置一致 | 未驗證 | |
| Captain 外觀四階段同步、無爆版、卡片跳轉正常 | 未驗證 | |
| 自動階段與 Captain 操作分清楚 | 未驗證 | |
| 真實圖片、網頁、12 秒影片全部成功 | 未驗證 | |
| 精確版本桌機／手機／播放／seek／reduced-motion 通過 | 未驗證 | |
| 一次真實修改完成，版本變化與要求一致 | 未驗證 | |
| reviewer／designer 問題有處理，無未解阻塞 | 未驗證 | |
| Captain 核准精確當代整站版本 | 未驗證 | |
| library 與 done passed，run succeeded | 未驗證 | |
| 成品庫可見 approved 版本，從庫開啟可播放 | 未驗證 | |
| 原始 Firstmate 對話收到正確 outcome／連結 | 未驗證 | |
| 重整不重複派工／生成／批准 | 未驗證 | |
| 原片完整、截圖節點齊全、timecode 與 ID 對應 | 未驗證 | |
| 成片可離線播放、字清楚、片尾完整、無敏感資訊 | 未驗證 | |
| 成功 data 與影音均備份，恢復命令可用 | 未驗證 | |
| Pitch 備援作品與成功錄影已實際打開驗證 | 未驗證 | |

- 放行規則：技術、派工、核准、入庫與錄影必填項全部 PASS 才標記「showcase ready」。人工視覺品質依本次 Captain 明確決定可填「暫免／未驗證」，不得冒充 PASS；其餘 FAIL 或未驗證仍須處理。
- 結案記錄：完成時間、最終 SHA、take 名稱、run ID、artifact/version、成片路徑、已知限制。

## 11. 本次研究依據

- `docs/setup-and-reference.md`：啟動、open session、CREW_DATA／CREW_PORT、renderer discovery。
- `docs/local-execution.md`：unrestricted 範圍、依賴限制與 job 證據。
- `src/main.ts`、`src/instance.ts`、`src/server.ts`：程序入口、instance 選擇、renderer 搜尋路徑。
- `workflows/v2/coffee-kit.wf.yaml`：direction -> 生產 -> checks -> review -> library -> done；修改回 round。
- `src/domain/coffee-kit.ts`：精確版本核准、`coffee-approved-v1`、成品庫與完成判斷。
- `tests/beginner-coffee-kit-ui.mjs`、`tests/coffee-playback-ui.ts`：可參照的 UI／播放檢查；測試成功不取代真實執行。
- `docs/units/local-coffee-e2e.md`：歷史 E2E 紀錄；以當前 runtime 為準。
- 本次只讀查詢：R-031 waiting、SC-059 visual evidence hold；`screencapture` 本機 usage；repo-local 工具路徑存在。

## 12. 第 4／5 節實際預檢紀錄（2026-10-16）

- 已切換：4210 現在是 `.tmp/showcase/2026-10-16-preflight/studio-data`，舊 data 完整備份於同層 `previous-data-backup`。
- 已確認：0 tasks／0 cards、空成品庫、專用新 Chrome profile、首次歡迎畫面、Codex account/model/quota UI 驗證、film readiness=true、GitHub off。
- Captain：全新瀏覽器必須先開啟「顯示實驗功能」才可選外觀；已經由 UI 選用並截圖。工作中四階段仍待真正 E2E 驗證。
- 錄影：指定主螢幕後成功錄下 Chrome，10 秒 H.264，3024x1964；完整解碼通過且已檢視抽樣畫格。截圖亦成功。
- 尚未放行正式錄製：需固定 16:9 展示區、排除桌面／Dock 與 automation banner；R-031 審查循環已修復並入庫；五秒需求已撤回。
- 詳細結果：`.tmp/showcase/2026-10-16-preflight/evidence/checks.md`；目前這份資料是預檢用，正式 take 仍須再用全新 data/profile。
- 未開始正式派工、未生成新成品、未錄製正式 E2E。

## 13. R-031 修復與新展示設定

- 影片保持 12 秒；正式 demo 要求靜音自動播放，保留暫停；reduced-motion 保留 poster 與明確 opt-in。
- Source review 先於 Captain 最終驗收：未提供視覺輸入不應阻擋來源審查，也不能宣稱已看過畫面。
- 恢復卡的 Captain 備註現在帶簽章來源傳入後續審查；歷史 findings 不刪除。
- 圖片產生失敗可在同任務刷新並核准 fresh-image；保留已完成頁面，不自動重複收費重試。
- 自動播放先檢查 reduced-motion，再由 host script 啟動；初始 HTML 不直接啟動 autoplay。
- R-031 修復使用 4211 與舊 data；4210 保留全新預檢 data。正式展示不要混用兩份資料或把舊任務放入新資料集。
- 最終實際結果與版本見 `docs/units/local-coffee-e2e.md`；本節不是 fresh-data E2E 完成證明。

- R-031 完成結果：site v10、SC-068 核准、run succeeded、library/done passed、ledgerOk=true、無未處理卡片；可作歷史成功成品備援。
- 真正空白 Studio 的完整錄影尚未執行；不要以本次 R-031 恢復取代首次上手 showcase。


## 14. Fresh-data 實際錄製結果（2026-10-16）

- 固定原始碼：`3dae967647fa3d88cebed801dec6db5553e7b849`；錄製期間未修改 Studio 原始碼或重啟服務。
- 資料集：`.tmp/showcase/2026-10-16-take01/studio-data`，專用全新 Chrome profile；原始資料與 R-031 保留在另外的 instance。
- Firstmate 對話：`01a1430d-0312-7e42-9b9d-5183251479b1`。首次問候、需求輸入、設計與三輪 staffing 討論皆包含在原始錄影；關鍵 UI 另有截圖。
- 正式鏈路：R-001 / SC-001 配置 -> R-002 / SC-002 派工 -> R-003 / SC-003 方向 -> 真實網頁、圖片、12 秒影片。
- 原生修復：v1 的 worker CSS 與 host reduced-motion 封面重複，六個獨立來源審查攔下；SC-004 修改網頁 -> v2 技術驗證及來源審查通過。
- 展示修改：SC-005 要求更柔和運鏡（less motion）-> film/site v3；保留 page v2 與 image v1。renderer 的 motion factor 從 1 變為 .35；新影片 hash 與舊版不同。
- 最終核准：SC-006 核准 site v3，bundle `0735dd177133afed1a260712797842077a16125f913d9da52e1e20bee0196cba`。R-003 succeeded，library/done passed，ledgerOk=true；R-001、R-002 也 succeeded，無待處理卡片。
- 技術 PASS：H.264 960x540、12.000 秒、完整解碼；Chrome 靜音 autoplay、完整循環、pause、seek、reduced-motion 單一首幀 poster、手動 opt-in；390/1440 無橫向溢出；圖片載入正常。
- 原始對話自動回傳 PASS：`native-outcome:R-002:R-003`，附 Task R-003 與 Approved website v3 連結；重整不新增任務或重跑。重啟後完成 receipt 仍存在。
- 成品庫 PASS：可見 approved v3，開啟與重整皆為同版本。安全 iframe 停用作品 script，使用成品庫外層播放按鈕；直接開網站會靜音自動播放。
- Captain PASS：錄到工作、待核准、修改與完成；SC-005 外觀待辦實際開啟正確原生卡；完成後清掉工作／待辦。
- 人工視覺品質：依 Captain 明確決定暫免，未宣稱通過。
- 主原片：`evidence/video/page@080312817346ac916a6fccc62e87d118.webm`，18:01，1440x810，無聲；真實瀏覽器 frames，非截圖串接。
- 快速切頁的錄影畫面與 screenshot 時點有差異；短版依實際畫面調整字幕，所有截圖與原片保留，不假裝每張 screenshot 都在原片停留。
- 補錄：`evidence/video/delivery/` 為完成後的 45 秒交付重播（成品庫、播放、持久化結果），短版明確標示 `Delivery replay after completion`，不冒充首次產出。
- 短版：`evidence/video/coffee-kit-showcase.mp4`，3:43.04、1440x810 H.264；已完整解碼且離線播放通過，保留真實操作片段，明確標示等待省略；無旁白。完整原片與短版均需保留。
- 成品副本：`deliverables/slow-day-coffee/index.html` 與 `deliverables/coffee-film-12s.mp4`。
- 成功資料備份：確認所有任務及 Firstmate 空閒後停止服務，複製至 `success-data-backup`，再用原成功資料重啟 4210。此資料不能再當空白 take 使用。
- 詳細驗證：同 take 的 `evidence/manifest.md`、`checks.md`、`timeline.jsonl`、`site-v3-technical.json`、`run-complete.json`、`firstmate-complete.json` 與 screenshots。
- 展示入口：`http://127.0.0.1:4210/#/library`；直接網站 `http://127.0.0.1:4210/af/coffee-r-003-site/3/index.html`。
- 限制：沒有在另一台實體展示機驗證，也未加入旁白；raw runtime、完整 server log 與 session credentials 保持本地私人，不納入分享包或 Git。

- 影片與圖片 SHA256 清單：`evidence/SHA256SUMS`；備援影片位於 `presentation-backup/`，已以離線 Chrome 播放到結尾。統一觀看入口：同 take 的 `watch.html`。

## 15. 新版 onboarding 重錄：預檢與剪輯要求（2026-10-16）

- 最新指示：先將既有修復停在可交接點，確認最新 origin 的 onboarding，再開始錄製。R-038／R-040／R-043／R-044 未完成，不因錄影而宣稱結案。
- 已推送階段基準：`49a0a04487723aed536cd9fbf673aa6e3ca93511`；本次 fetch 後 local 與 origin/main 一致。正式錄製前再核對並固定 SHA。
- 預檢 instance：`http://127.0.0.1:4212`，data `.tmp/showcase/2026-10-16-onboarding-preflight/studio-data`。原 4210 與既有任務保留。此資料只供預檢，正式錄製另建空白資料。
- 已實際看到：全新 Board 為 0 tasks／0 crew；Codex account、configured model 與 quota 驗證成功。這不代表 worker 或媒體已驗證。
- 新版教學入口：Workflows -> First workflow tutorial；步驟為 Interview -> Generated graph and preview -> Edit each node's model -> Confirm staffing at Run。
- 教學頁的 Compare and refine、Save as template 明確標為 Roadmap；不得剪成已可用功能。Coffee shop 現為 Advanced example，不可直接沿用舊 Coffee-kit 腳本冒充新版教學。
- 首次 journey 遮罩開啟時，預檢點教學連結未導航；收起 guide 後成功。正式預檢需由 Firstmate greeting 後的正常教學入口確認，不以隱藏遮罩當作首次導覽成功。

### 錄製前放行檢查

- [ ] 現有 R-044 本輪交回並記錄交接點；不為錄影中斷活躍 worker，也不續派下一輪。
- [ ] 啟動 Firstmate 並收到真實 greeting，走正常新版 onboarding 入口。
- [ ] 實際驗證訪談、生成圖、節點模型編輯、儲存、Run 與正式配置核准；區分草稿與實際任務。
- [ ] 預檢獨立工作可否並行，爭取 3 位以上真實工作船員；以 job、節點與時間戳確認重疊，不以配置角色或等待中卡片湊數。
- [ ] 核對 Captain 外觀的真實工作狀態，準備 hover／進度與多船員畫面。
- [ ] 正式錄影另開全新資料與站台狀態，固定 theme、viewport、模型與版本；保留預檢資料。
- [ ] 成功交付需作品能從成品庫重新開啟，不能只錄素材或草稿。

### 前次回饋全部沿用

- [ ] 全程保留 Firstmate 訪談、需求與派工對話原片；剪輯呈現必要步驟。
- [ ] 真正點擊收件匣／正式卡片核准，不能用聊天「確認」替代核准畫面。
- [ ] Captain 外觀直接進入工作畫面，省略 skins 選擇操作；固定 theme，刪除跳 theme 與抖動畫格。
- [ ] 簡體中文標題只保留 title，依順序編號 1、2、3、4；與實際操作對齊。
- [ ] 核准點擊至綠框結果共留約 2.5 秒，拉長真正狀態變化與結果停留，刪除前面的空等；必要時用清楚的游標標記。
- [ ] 等待核准的前導最多約 3 秒；刪除無法解釋目的的中間段，不沿用舊片時間碼盲剪。
- [ ] 完成核准的關鍵段可用約 0.7 倍，讓完成結果可辨認。
- [ ] 進網站前加入單頁文字轉場，說明「在浏览器打开成品」，同時銜接音樂。
- [ ] 真正開啟完整網站、捲動與播放影片，不以素材重放取代成品展示；生成影片維持 12 秒、靜音 autoplay 與 reduced-motion 行為。
- [ ] 配樂輸出兩版：全片 Tech House vibes；前段 Tech House vibes、網站段原輕柔配樂。沿用已驗證素材與授權紀錄。
- [ ] 保留原始錄影、關鍵變化點截圖、task/card/job/artifact 版本與時間碼，剪輯不能偽造同一次成功流程。
- [ ] 最終以 macOS 可播放 MP4 驗證音畫、文字、影片結尾與兩版配樂；交付前完整看一遍。

### Codex `/goal` 重錄目標 prompt

- 將以下完整內容貼入 Codex `/goal` 作為新目標；此文件更新不會自動替換 CLI 的 active goal。
- 原四個任務保留未完成狀態與交接紀錄，不因切換錄影目標而結案。

```text
依最新 origin/main，重新錄製 Crew Studio 新版 onboarding 的完整 demo。

先將目前修復工作停在可恢復的交接點：已完成且驗證通過的修正 commit、push 並讀回 origin；執行中的 worker 等本輪交回，不續派下一輪。記錄 R-038、R-040、R-043、R-044 的未完成事項，不宣稱結案。

先在獨立預檢環境確認新版 onboarding 的真實流程，再開始正式錄製：
首次進入 -> 連接 Firstmate -> 訪談 -> 生成流程圖與預覽 -> 設定節點模型 -> Run 時正式核准配置 -> 執行 -> 驗收 -> 成品庫。
標為 Roadmap 的功能不得當作已可用功能展示。

範圍已由 Captain 確認：在舊版影片完整 scope 前加入新版 onboarding，不擴充動態流程功能。新版教學以前導呈現，使用其現有支援的簡單任務驗證訪談、流程圖與模型設定；接著明確轉場到 Coffee-kit 進階範例。不要要求動態草稿直接生成圖片與影片，也不要因此另開功能開發。

Coffee-kit 主案例沿用「慢日咖啡 Slow Day Coffee」：繁體中文單頁網站、真正生成的圖片、12 秒可播放影片，保留原影片的派工、修改、驗收、成品庫與完整網站展示。兩段使用同一正式錄製資料集，從全新空白開始，不拼接不同資料集冒充同一次流程。

預檢多船員協作，爭取至少 3 位船員實際並行工作；以真實 job 與執行時間證明，不用配置角色、等待狀態或動畫湊數。工作畫面使用 Captain 外觀。

預檢通過後固定 commit、模型、theme 與 viewport，另建全新正式錄製資料；保留原本 dogfooding 環境，不搬入舊任務或成品。全程使用真實模型、正式卡片與成品庫，不偽造執行或驗收狀態。

完整錄下 Firstmate 對話、流程圖、模型設定、收件匣正式核准點擊、多船員工作、修改與驗收、成品入庫，以及從成品庫實際開啟完整網站、捲動與播放影片。保留原片、關鍵截圖、時間碼及 task/card/job/artifact 版本證據。

沿用前次剪輯要求：
- 簡體中文、依序編號的 title，不加冗長說明。
- 固定 theme，刪除跳 theme、抖動、無意義等待及 skins 選擇操作。
- 核准點擊至綠框結果約留 2.5 秒，拉長真正變化與結果，不保留多餘空等。
- 核准前等待約 3 秒即可；必要的完成段可用 0.7 倍速度。
- 進成品前加文字轉場，例如「在浏览器打开成品」。
- 展示真正完整網站，不以素材重放取代。
- 配樂輸出兩版：全片 Tech House vibes；前段 Tech House vibes、網站段原輕柔配樂。

更新 docs/tasks/showcase.md，逐項記錄實際結果與未完成項目。遇到阻擋錄製的 bug 可在既有授權內修正、驗證並分階段 commit/push；重大取捨或缺少必要資訊才詢問。

完成標準：新版流程實際跑通、成果已驗收入庫且可重新開啟、兩版 MP4 在 macOS 完整播放驗證通過、原片與截圖保存、文件及必要修正已推送並確認 origin。不得把預檢完成或開始錄影當成整個任務完成。
```

### 新版教學實際預檢補記（2026-10-16）

- 基準 `7f0d4b4a`：修正 Studio 自動注入執行說明造成的 `brief-path` 誤判；重新 fetch 後與 origin/main 一致。
- 原生新草稿 `d-0be77e030a0e` revision 1 的 readiness 1–4 通過；UI 儲存為 `my-workflow-0be77e@1`，正式 staffing dialog 確認六個製作／修訂節點均為 Codex、`gpt-6.1-sol`、medium、Writer。
- 預檢 R-001 已真實執行三位 Writer，品牌故事、菜單文案、三則社群草稿均可從成品庫預覽。這是依序執行，不能剪成三人同時工作；已經 SC-001／SC-002／SC-003 分別精確核准 brand/menu/social v1，R-001 succeeded、9 筆 ledger 簽章正常，成品庫三份均 Approved；不是正式錄影成品。
- `accept: true` 的既有契約為列出全部 pinned 產出並選一份核准；卡片名稱不會自動綁定 producer。正式操作需辨識來源後逐份核准，不宣稱系統自動限定單份。
- 新的修訂節點會建立自己的 producer 產出；只有重跑原 producer 節點才增加原 artifact 的版本。新版教學不宣稱尚未驗證的修訂行為；Coffee-kit 的真實修改與版本驗收仍完整保留在主展示範圍。
- Captain 待辦實測可從外觀開啟正確的 SC-001 原生收件匣卡；工作中多人畫面仍待驗證。
- 實際 encoder smoke 通過：HyperFrames `0.8.159`、H.264、960x540、12 秒。使用測試色塊素材，只證明編碼能力，不能代替真實圖片生成或 Coffee-kit 端到端驗證。
- 多產出核准按鈕及版本連結重名已以最小標籤修正處理，包含既存卡片；48 項原生流程及 26 項 UI 標籤測試通過、獨立審查通過，4212 瀏覽器已驗證三張正式卡正常流轉。正式 take 尚未開始。
