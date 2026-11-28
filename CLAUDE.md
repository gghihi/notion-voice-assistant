# CLAUDE.md

Notion 請助手🫰（「請住手」的諧音）：個人用 PWA，用語音／文字把專案、任務、影片存進使用者自己的 Notion。給使用者的白話說明在 `使用與維護說明.md`。

## 與使用者合作的規則

- 使用者沒有程式背景：說明、註解、介面文字一律**繁體中文**、白話，術語第一次出現要解釋。
- 能自己做的就自己做；帳號、授權、付費才請使用者動手，並給編號步驟。任何要付費的事先停下來問。
- 一次最多問 3 個問題，附選項與建議。
- **程式庫公開**，絕對不能放金鑰、密碼、資料庫編號。使用者不希望金鑰存成檔案或貼在對話裡；需要時用 Cloudflare 加密設定（Secrets）或安全輸入框。

## 架構

```
docs/（GitHub Pages，main 分支）──Bearer 通行證──► worker/（Cloudflare Worker notion-voice-worker）
                                                      ├─► Notion API（NOTION_TOKEN，版本 2025-09-03，data_source_id）
                                                      ├─► Durable Object `Store`（SQLite：推播訂閱、提醒、公佈欄；用 alarm 準時提醒）
                                                      └─(service binding GEMINI_PROXY)─► guamie-ledger-gemini（呱咩小窩帳的美國轉送站）
```

- **登入**：`APP_PASSWORD` → 簽 30 天通行證（`SESSION_SECRET` HMAC）。登入有 Cloudflare rate limit（每分鐘 5 次）。只接受 `ALLOWED_ORIGIN`。
- **三個資料庫**：`NOTES_DS`＝工作專案規劃 新版（分頁「專案庫」）、`TASKS_DS`＝所有任務清單（「任務庫」）、`KNOWLEDGE_DS`＝知識庫。都是 Secrets。
- **欄位白名單**：`worker/src/fields.js` 的 `DBS`。只有列出的欄位能寫入；選項由 `/api/fields` 即時讀 Notion。
- **範本**：`/api/templates`、`/api/template-values`（只能讀該資料庫自己的範本）。用範本建頁時 Notion 背景套用，等內容出現再 append 區塊。
- **確認卡優先順序**：使用者手動 > AI 建議 > 影片自動資料 > 範本預設 > APP 預設。前端 `applyAi` 會先 `await tplJobs[db]`，避免範本晚到洗掉資料。
- **AI**（`worker/src/ai.js`）：Gemini 經轉送站，`thinkingBudget: 0`、8 秒逾時、主／備用模型。只從現有選項挑（`filterSuggestions`）。失敗或額度用完回 `notice`，退回規則版（`when.js`）。`AI_SIMULATE_QUOTA="1"` 可模擬額度用完（測完要改回，不要 commit）。
- **影片**（`worker/src/video.js`）：YouTube 用 oEmbed＋watch 頁；Threads 用 og 標籤（通路選項名稱是小寫 `threads`）；IG 用 og 標籤，拿不到內文改抓 `embed/captioned/`。作者＝影片發布者；上傳日期＝傳進 APP 的那天（台灣時間）。內文只給 AI 取標題，**不存進 Notion**。
- **公佈欄**：存檔成功記到 Store（7 天）。`/api/board` 會檢查 Notion 是否已 in_trash 並同步移除。刪 Notion 只能刪公佈欄上的紀錄（`in_trash: true`）。
- **整理庫**（`worker/src/organize.js`，表格 `organize`，和公佈欄分開）：知識庫存檔時加入，7 天後移除（Notion 保留）。狀態看 Notion：`Done` 勾選或觀看性質＝完成 → 完成；正在看／作筆記/做作業／看到一個段落 → 整理中；其他 → 還沒整理。APP 改狀態會寫回 Notion（只限整理庫裡的頁面）。`/api/organize/outline` 讀頁面第一層的標題／收合區塊當範本格式；`/api/organize/note` 依段落寫入（收合區塊放進裡面、一般標題插在該段最後一個區塊之後，只接受該頁的區塊 id），其他補充 append 到頁尾，並改成整理中／完成。Store 的 alarm 同時負責「每天台灣 22:00」的提醒（`digestAt`），全部完成就不推播。
- **前端**：無建置步驟。`app.js`（主程式）、`fields.js`（欄位選擇器）、`sound.js`（WebAudio 合成音效與配樂）、`theme.js`。改前端後要把 `docs/sw.js` 的 `VERSION` 加一。

## 常用指令（在 `worker/` 內）

```bash
npm test                                            # 單元測試（node:test）
CLOUDFLARE_API_TOKEN=proxy-injected npx wrangler deploy   # 部署（雲端環境的代理會注入真正的鑰匙）
node --check ../docs/app.js                         # 前端語法檢查（沒有 lint）
```

- 雲端環境連不到 `*.workers.dev`、IG、YouTube，也開不了 `wrangler tail`；前端用 Playwright＋假資料（route 攔截 `*.workers.dev`）測。
- 改了 `migrations/0001_init.sql` 要重新產生 `src/schema.js`（Store 建構時用 `CREATE ... IF NOT EXISTS`，**加欄位不會生效**，要另外處理）。
- 推送：開發分支和 `main` 一起推（GitHub Pages 發布 `main` 的 `docs/`）。
