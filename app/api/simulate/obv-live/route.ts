import { NextResponse } from "next/server";
import { chromium } from "playwright";
import { existsSync } from "fs";
import { loadWorkerConfig } from "@/src/worker/config";
import { lookupObvBrowser, type ObvBrowserResult } from "@/src/worker/obv-lookup";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Playwright lookups take ~10-25s

export async function POST(request: Request) {
  const started = Date.now();
  let browser = null;

  try {
    const body = await request.json();
    const { make, model, variant, year, kmsDriven } = body;

    if (!make || !model || !variant) {
      return NextResponse.json(
        { error: "Make, model, and variant are required for live OBV query." },
        { status: 400 }
      );
    }

    const config = loadWorkerConfig({ headless: true });
    const runId = `sim-obv-${Date.now()}`;

    // Launch Playwright using Google Chrome installed on system
    browser = await chromium
      .launch({
        channel: "chrome",
        headless: true,
        args: [
          "--disable-blink-features=AutomationControlled",
          "--no-sandbox",
          "--disable-setuid-sandbox",
        ],
      })
      .catch(() =>
        chromium.launch({
          headless: true,
          args: [
            "--disable-blink-features=AutomationControlled",
            "--no-sandbox",
            "--disable-setuid-sandbox",
          ],
        })
      );

    const contextOptions: Parameters<typeof browser.newContext>[0] = {
      viewport: { width: 1366, height: 768 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    };

    if (existsSync(config.sessionStoragePath)) {
      contextOptions.storageState = config.sessionStoragePath;
    }

    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();

    const obvResult: ObvBrowserResult = await lookupObvBrowser(
      page,
      {
        make: String(make).trim(),
        model: String(model).trim(),
        variant: String(variant).trim(),
        year: year ? String(year).trim() : "2022",
        kmsDriven: kmsDriven ? String(kmsDriven).trim() : "15000",
      },
      config,
      runId
    );

    await browser.close();
    browser = null;

    if (!obvResult.success || !obvResult.idv) {
      return NextResponse.json(
        {
          success: false,
          reasonCode: obvResult.reasonCode,
          latencyMs: Date.now() - started,
          message:
            "OBV website did not return a definitive valuation. Switching to intelligent estimation model.",
          raw: obvResult.raw,
        },
        { status: 200 }
      );
    }

    return NextResponse.json({
      success: true,
      idv: obvResult.idv,
      conditions: obvResult.conditions,
      sourceUrl: obvResult.sourceUrl,
      reasonCode: obvResult.reasonCode,
      latencyMs: Date.now() - started,
    });
  } catch (err: unknown) {
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("Live OBV Simulation API error:", message);
    return NextResponse.json(
      {
        success: false,
        error: message,
        reasonCode: "NAVIGATION_ERROR",
        latencyMs: Date.now() - started,
      },
      { status: 500 }
    );
  }
}
