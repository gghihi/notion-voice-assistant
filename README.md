# Notion 請助手🫰（個人用）

用語音或打字快速記筆記，存進自己的 Notion。網頁放在 GitHub Pages（`docs/`），後端是 Cloudflare Worker（`worker/`）。

## 安全設計（為什麼這個公開程式庫是安全的）

- **程式庫裡沒有任何金鑰、密碼或資料庫編號。** 全部存在 Cloudflare 的加密設定（Secrets），只有後端讀得到。
- 網頁不直接碰 Notion，只和自己的後端說話。後端只接受 `ALLOWED_ORIGIN`（自己的網頁）發出的請求。
- 除了登入，每個動作都要有效的「通行證」。通行證用只存在 Cloudflare 的秘密簽章，30 天到期，別人造不出來。
- 登入每分鐘最多試 5 次，防止別人一直猜密碼。
- 後端只開放「存筆記」「檢查連線」這幾個動作，沒有讀取、刪除 Notion 內容的功能。
- `.gitignore` 擋住 `.dev.vars` 等本機設定檔，避免不小心上傳。

## 需要存進 Cloudflare 的秘密（`npx wrangler secret put 名稱`）

| 名稱 | 內容 |
|---|---|
| `NOTION_TOKEN` | Notion 內部整合金鑰 |
| `APP_PASSWORD` | 登入這個 APP 用的密碼（自己想一組長一點的） |
| `SESSION_SECRET` | 隨機長字串，用來簽通行證 |
| `NOTES_DS` | 「工作專案規劃 新版」的資料來源編號 |
| `TASKS_DS` | 「所有任務清單」的資料來源編號 |
| `KNOWLEDGE_DS` | 「知識庫」的資料來源編號 |

## 開發

```bash
cd worker && npm test     # 單元測試
```
