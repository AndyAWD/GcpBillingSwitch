# GCP Billing Switch (GcpBillingSwitch)

這是一個用於自動偵測與切換 Google Cloud Platform (GCP) 專案帳單帳戶的 Node.js 工具。
特別針對使用 `Gemini` CLI 時可能遇到的額度耗盡 (Quota exceeded) 或需要付費 (402 Payment Required) 錯誤，提供自動化的備用帳戶切換機制。

## 功能特色
* **自動化環境檢查**：自動確認 `gcloud` CLI 是否已安裝並完成登入。
* **動態專案偵測**：自動抓取目前 `gcloud` 活躍的專案 ID。
* **智慧化額度測試**：透過呼叫 `Gemini` CLI 指令測試目前帳單狀態，若額度充足則保持不變。
* **無縫切換備用帳戶**：當偵測到額度耗盡時，會自動列出名下所有可用的 GCP 帳單帳戶，並嘗試將專案連結至新的有效帳戶。
* **狀態記憶**：將已經耗盡額度的帳戶自動記錄在 `~/.gemini/used_accounts.txt` 中，避免重複嘗試無效的帳戶。

## 系統需求
* [Node.js](https://nodejs.org/)
* [Google Cloud CLI (gcloud)](https://cloud.google.com/sdk/docs/install)
* 已安裝並設定好的 `Gemini` CLI

## 使用方式

1. 確保已登入 Google Cloud CLI 並具備相關權限：
   ```bash
   gcloud auth login
   ```

2. 確認目前 `gcloud` 活躍的 GCP 專案是你想要操作的專案：
   ```bash
   gcloud config set project <YOUR_PROJECT_ID>
   ```

3. 執行檢查與自動切換腳本：
   ```bash
   node check-billing.mjs
   ```

## 運作原理
1. 腳本會先確認 `gcloud` 登入狀態，並取得目前的活躍專案與已綁定的帳單帳戶。
2. 嘗試執行 `gemini -p "hi"` 進行 API 額度測試。
3. 若捕捉到包含 `402`、`Billing disabled` 或 `Quota exceeded` 的錯誤，腳本會認定該帳戶額度耗盡，並寫入黑名單（耗盡名單）。
4. 自動掃描 `gcloud billing accounts list`，尋找尚未耗盡的帳單帳戶。
5. 呼叫 `gcloud billing projects link` 動態將專案切換至新帳戶，等待 15 秒同步後重新測試，直到服務恢復為止。

## 整合至 Gemini CLI Hooks (進階用法)

您可以將此腳本註冊為 Gemini CLI 的 `SessionStart` Hook。這樣一來，每次啟動 Gemini CLI 對話時，系統都會在背景自動執行此腳本，確保 GCP 帳單額度充足，不會中斷您的對話。

### 設定步驟

1. **建立存放目錄**
   在您的全域 Gemini 設定資料夾中建立 `hooks` 目錄（若尚未建立）：
   ```bash
   mkdir -p ~/.gemini/hooks
   ```

2. **複製腳本**
   將專案中的 `check-billing.mjs` 複製到該目錄：
   ```bash
   cp check-billing.mjs ~/.gemini/hooks/check-billing.mjs
   ```

3. **修改全域設定檔**
   開啟全域設定檔 `~/.gemini/settings.json`（若無此檔案請自行建立），加入 `SessionStart` hook 的設定。這樣設定會套用到所有的專案目錄：

   ```json
   {
     "hooks": {
       "SessionStart": [
         {
           "matcher": ".*",
           "hooks": [
             {
               "name": "gcp-billing-switch",
               "type": "command",
               "command": "node ~/.gemini/hooks/check-billing.mjs",
               "description": "自動檢查並切換 GCP 帳單帳戶，確保 API 額度充足"
             }
           ]
         }
       ]
     }
   }
   ```
