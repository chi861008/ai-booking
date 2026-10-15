# 月月排｜AI 排課工作台

以 LINE 文字回覆為主的每月排課流程原型。介面為繁體中文、手機優先，包含老師時段公告、學生回覆整理、排課草稿、代課邀請和最終通知五個步驟。

## 目前可操作的部分

- 老師用自然語言描述可授課時間，AI 整理成星期與時段。
- 貼上學生 LINE 回覆，AI 擷取可上課時間、排除日期和需要追問的內容。
- 每則回覆分開保存示範訊息編號、收到時間與排課月份。訊息明確提到月份時會優先判斷；未提月份時才套用當時開放的排課月份；年份或月份仍不明確時，要求人工指定。單則訊息提到多個月份時，請拆成多則回覆。
- 同一學生同一月份再次回覆會保留訊息歷程。新增時段會合併，明確更改會取代舊時段，日期例外會附加到原時段；若原本已排課，系統會標記給老師檢查。
- 老師確認學生時段後，依每週一堂、老師有空、同時段不重複的規則產生排課草稿；已安排的學生不會在再次媒合時被改排。
- 查看未安排學生，整理可複製的代課邀請。
- 檢查學生通知預覽並完成本月確認。
- 操作狀態暫存在目前瀏覽器的 localStorage。
- LINE Messaging API webhook 可驗證簽章並收文字訊息，保留 LINE message ID、user ID 與時間；收件匣每 10 秒同步，老師按下 AI 整理後再確認是否納入排課。
- 已設定 LINE 憑證時，可在畫面先看清楚通知，再二次確認推播給官方帳號所有好友。

## 本機預覽

需要 Node.js 18 或更新版本。安裝環境後，啟動伺服器：

```sh
OPENAI_API_KEY="你的 API 金鑰" LINE_CHANNEL_SECRET="LINE channel secret" LINE_CHANNEL_ACCESS_TOKEN="LINE channel access token" PUBLIC_BASE_URL="https://你的公開網址" DASHBOARD_PASSWORD="管理看板密碼" npm run dev
```

開啟 <http://localhost:3000>。伺服器會將學生文字送到 OpenAI Responses API，以 Structured Outputs 取得符合格式的時段資料；API 金鑰只在伺服器端使用。可用 `OPENAI_MODEL` 指定模型，預設為 `gpt-4o-mini`。

## LINE 設定與銜接

LINE 設定完成並部署到可公開連線的 HTTPS 網址後，將 `PUBLIC_BASE_URL` 設為該網址，並把畫面顯示的 `/api/line/webhook` 設為 LINE Developers Console 的 webhook URL。請開啟 webhook 使用設定並按 Verify。收到文字後，後端先驗簽，再保留訊息 ID、來源 user ID、時間及內容；AI 不會自行回覆或排課，老師要在看板確認。LINE 訊息收件匣目前存在 `.local-data/line-inbox.json`，不納入 Git。正式環境須設定 `DASHBOARD_PASSWORD`；登入後才能查看收件匣、執行 AI 解析與推播。

**舊版銜接方式：**舊版已有 LIFF、LINE Login、Messaging API、Supabase 學生／課程／排課資料與 webhook。LINE 官方規定每個 Messaging API 頻道只能設定一個 bot server webhook endpoint，所以不要把正式頻道 webhook 改指向這個獨立原型；要真實測試，請使用另一個測試頻道。正式銜接時應把 AI 解析作為服務接入舊版 webhook 與排課資料流程，沿用舊版學生身分和資料庫，保留舊版其他功能。此原型尚未讀寫舊版 Supabase，也不會修改舊版專案。

目前尚未連接舊版資料庫或代課老師回覆。LINE 收件匣在此原型使用本機 JSON 檔保存，適合驗證流程，尚非正式多使用者儲存方式。若 LINE 憑證未設定，LINE 推播按鈕不會啟用，通知僅供預覽。正式接入舊版時，AI 解析應沿用舊版 Supabase 的學生、每月週期、時段和課表資料，不另建一套並行名單。

參考：[LINE 接收訊息與 webhook](https://developers.line.biz/en/docs/messaging-api/receiving-messages/)、[Webhook 簽章驗證](https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/)、[Webhook endpoint 設定](https://developers.line.biz/en/docs/messaging-api/building-bot/)、[發送訊息](https://developers.line.biz/en/docs/messaging-api/sending-messages/)。

AI 解析結果需要老師檢查；有歧義的回覆會顯示待確認。排課媒合由程式依規則計算，不讓 AI 自行決定正式課表。
