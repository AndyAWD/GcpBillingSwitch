import { execSync } from 'child_process';
import { readFileSync, appendFileSync, existsSync } from 'fs';
import { join } from 'path';
import os from 'os';

/**
 * 設定：Gemini CLI 配置路徑
 */
const GEMINI_DIR = join(os.homedir(), '.gemini');
const USED_FILE = join(GEMINI_DIR, 'used_accounts.txt');
const log = (msg, colorCode = '0') => console.log(`\x1b[${colorCode}m${msg}\x1b[0m`);

/**
 * 執行指令並抓取詳細錯誤 (包含 stderr)
 */
function safeExec(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (error) {
    throw {
      message: error.message,
      stdout: error.stdout?.toString(),
      stderr: error.stderr?.toString()
    };
  }
}

/**
 * 環境檢查：確認 gcloud 已安裝並登入
 */
function ensureGcloudAccount() {
  try {
    try {
      execSync('gcloud --version', { stdio: 'ignore' });
    } catch (e) {
      log("❌ 尚未安裝 gcloud CLI。請至官網下載: https://cloud.google.com/sdk", '31');
      process.exit(1);
    }

    let activeAccount = "";
    try {
      activeAccount = execSync('gcloud config get-value account', { encoding: 'utf8' }).trim();
    } catch (e) { /* ignore */ }

    if (!activeAccount || activeAccount === "(unset)") {
      log("⚠️ 偵測到尚未登入。正在啟動登入程序...", '33');
      execSync('gcloud auth login', { stdio: 'inherit' });
      activeAccount = execSync('gcloud config get-value account', { encoding: 'utf8' }).trim();
    }

    log(`👤 目前登入身分: ${activeAccount}`, '35');
    return activeAccount;
  } catch (error) {
    log("身分檢查失敗: " + error.message, '31');
    process.exit(1);
  }
}

async function run() {
  ensureGcloudAccount();

  try {
    // --- 【動態專案偵測】 ---
    let targetProject = "";
    try {
      targetProject = execSync('gcloud config get-value project', { encoding: 'utf8' }).trim();
      if (!targetProject || targetProject === "(unset)") {
        log("❌ 偵測不到目前活躍的 GCP 專案 ID！", '31');
        process.exit(1);
      }
    } catch (e) {
       log("無法偵測目前的 GCP 專案。", '31');
       process.exit(1);
    }
    log(`📂 目前活躍專案: ${targetProject}`, '36');

    if (!existsSync(USED_FILE)) appendFileSync(USED_FILE, '');
    const usedAccounts = readFileSync(USED_FILE, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);

    // 更新腳本名稱為 [帳戶管理系統]
    log("[Gemini CLI] 啟動帳戶管理系統 (偵測/偵錯模式)...", '36');

    // --- 【檢查目前帳單連結狀態】 ---
    let currentAccountFull = execSync(`gcloud billing projects describe ${targetProject} --format="value(billingAccountName)"`, { encoding: 'utf8' }).trim();
    const currentAccountId = currentAccountFull.split('/').pop();

    // --- 【電力測試 (修正指令參數)】 ---
    // 改用新版支援的 -p 參數進行非互動式測試
    const testCmd = 'gemini -p "hi"';
    
    try {
      execSync(testCmd, { stdio: 'pipe' });
      log(`✅ 目前帳戶 [${currentAccountId}] 額度充足，無需切換。`, '32');
      return; 
    } catch (error) {
      const errMsg = error.stdout?.toString() || error.stderr?.toString() || "";
      
      // 如果是因為參數錯誤，則嘗試備援測試指令
      if (errMsg.includes("Unknown arguments")) {
         log("⚠️ 偵測到 CLI 版本參數差異，嘗試備援測試方式...", '33');
         try {
            execSync('gemini "hi" --approval-mode plan', { stdio: 'pipe' });
            log(`✅ 備援測試成功。目前帳戶 [${currentAccountId}] 額度充足。`, '32');
            return;
         } catch (innerError) { /* 繼續往下判斷真正原因 */ }
      }

      log(`🪫 目前帳戶 [${currentAccountId}] 測試失敗。分析原因中...`, '33');
      
      if (errMsg.includes("Billing disabled") || errMsg.includes("402") || errMsg.includes("Payment Required") || errMsg.includes("Quota exceeded")) {
        log(`   💡 確定為額度問題。正在尋找下一個備用帳戶...`, '33');
        if (!usedAccounts.includes(currentAccountId)) {
          appendFileSync(USED_FILE, `${currentAccountId}\n`);
        }
      } else {
        log(`   🔍 Gemini 報錯詳細內容：`, '90');
        log(`   ---------------------------------------`, '90');
        log(errMsg.trim() || "無具體報錯訊息", '31');
        log(`   ---------------------------------------`, '90');
        log(`   ❌ 這看起來不像是額度問題。請確認 API 是否已在專案中啟用。`, '31');
        process.exit(1); 
      }
    }

    // --- 【切換邏輯】 ---
    log("正在掃描可用帳戶...", '90');
    const billingJson = JSON.parse(execSync('gcloud billing accounts list --format="json"', { encoding: 'utf8' }));

    for (const accObj of billingJson) {
      const accId = accObj.name.split('/').pop();
      const displayName = accObj.displayName || "未命名帳戶";

      if (usedAccounts.includes(accId) || accId === currentAccountId) continue;

      log(`🔋 嘗試啟用帳戶: [${displayName}] (${accId})`, '34');

      try {
        safeExec(`gcloud billing projects link ${targetProject} --billing-account=${accId} --quiet`);
        log("⏳ 等待 15 秒同步...", '90');
        await new Promise(r => setTimeout(r, 15000));

        try {
          execSync(testCmd, { stdio: 'pipe' });
          log(`✅ 成功切換至帳戶: [${displayName}]。服務已恢復。`, '32');
          return;
        } catch (error) {
          const errMsg = error.stdout?.toString() || error.stderr?.toString() || "";
          if (errMsg.includes("402") || errMsg.includes("Billing") || errMsg.includes("Quota")) {
            log(`🪫 帳戶 [${displayName}] 額度已耗盡。標記並跳過。`, '33');
            appendFileSync(USED_FILE, `${accId}\n`);
          } else {
            log(`⚠️ 帳戶 [${displayName}] 測試失敗：${errMsg.slice(0, 100)}...`, '31');
          }
        }
      } catch (err) {
        log(`❌ 無法連結帳戶 [${displayName}]: ${err.stderr?.slice(0, 100) || err.message}`, '31');
      }
    }

    log("❌ 警報：名下所有帳戶皆已耗盡或無法連結！", '31');
    process.exit(1);

  } catch (err) {
    log("致命錯誤: " + err.message, '31');
    process.exit(1);
  }
}

run();
