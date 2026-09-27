/**
 * CoreHub Interactive Login Utility
 *
 * Launches a visible browser for you to log in to CoreHub manually.
 * Once logged in, your session (cookies, tokens, localStorage) is saved to:
 *   .session/corehub-state.json
 *
 * All subsequent worker runs will reuse this saved session automatically.
 * No hardcoded credentials required!
 *
 * Usage:
 *   npm run worker:login
 */

import { chromium } from "playwright";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import * as readline from "readline";
import { loadWorkerConfig } from "./config";

function promptUser(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans);
    })
  );
}

async function main() {
  const config = loadWorkerConfig({ headless: false });

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("🔐 CoreHub Interactive Session Login");
  console.log(`   Portal URL: ${config.corehubBaseUrl}`);
  console.log(`   Session Target: ${config.sessionStoragePath}`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  const sessionExists = existsSync(config.sessionStoragePath);
  if (sessionExists) {
    console.log("📂 Existing session file found. Launching browser with saved state...\n");
  } else {
    console.log("🆕 No previous session found. Starting fresh login session...\n");
  }

  const browser = await chromium
    .launch({
      channel: "chrome",
      headless: false,
      slowMo: 100,
    })
    .catch(() =>
      chromium.launch({
        headless: false,
        slowMo: 100,
      })
    );

  const contextOptions: Parameters<typeof browser.newContext>[0] = {
    viewport: { width: 1366, height: 768 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  };

  if (sessionExists) {
    contextOptions.storageState = config.sessionStoragePath;
  }

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  console.log(`🌐 Opening ${config.corehubReferralUrl}...`);
  try {
    await page.goto(config.corehubReferralUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
  } catch (e) {
    console.log("ℹ️ Page is still loading in browser. Please continue logging in.");
  }

  console.log("\n👉 Please interact with the opened browser:");
  console.log("   1. Log in with your email/phone, password, SSO, or OTP.");
  console.log("   2. Wait for the page to fully load and ensure you are on the CoreHub dashboard/referral tab.");
  console.log("   3. Take as much time as you need — the browser will NOT auto-close.\n");

  // Wait strictly for user to press ENTER in terminal
  await promptUser("👉 Press ENTER in this terminal once you have successfully logged in: ");

  console.log("\n💾 Saving authenticated session cookies and state...");
  const dir = dirname(config.sessionStoragePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Allow any pending network requests/tokens to finalize
  await page.waitForTimeout(1000);
  await context.storageState({ path: config.sessionStoragePath });
  console.log(`✅ Session successfully saved to: ${config.sessionStoragePath}`);

  console.log("\n🎉 Setup complete! You do NOT need to store usernames or passwords in .env.");
  console.log("   You can now run:");
  console.log("   👉 npm run worker:visible   (to watch the worker scrape with your session)");
  console.log("   👉 npm run worker           (to run in background/headless mode)\n");

  await page.waitForTimeout(1000);
  await browser.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Login utility error:", err);
  process.exit(1);
});
