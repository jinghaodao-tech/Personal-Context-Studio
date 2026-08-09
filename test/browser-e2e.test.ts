import assert from "node:assert/strict";
import test from "node:test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

test("dashboard completes the six core experience scenarios in a real browser", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pcs-browser-"));
  const notes = join(directory, "notes"); mkdirSync(notes, { recursive: true });
  const port = 19800 + Math.floor(Math.random() * 100);
  const child: ChildProcess = spawn(process.execPath, ["--experimental-strip-types", "apps/api/src/server.ts"], {
    env: { ...process.env, PCS_PORT: String(port), PCS_DB: join(directory, "context.sqlite3"), PCS_NOTES_DIR: notes },
    stdio: "ignore",
  });
  const browser = await chromium.launch({ headless: true });
  try {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break; } catch { /* API startup */ }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });

    // 1. Japanese dashboard and onboarding.
    assert.match(await page.title(), /Personal Context Studio/);
    assert.match(await page.locator("body").innerText(), /確定済みの個人コンテキスト/);
    await page.locator('#tabs button[data-tab="home"]').click();
    await page.getByRole("button", { name: "目的を選ぶ" }).click();
    assert.match(await page.locator("#dialog").innerText(), /記録する目的を選ぶ/);
    await page.getByRole("button", { name: "勉強・作業", exact: true }).click();

    // 2. Quick record: zero and false remain valid values and save once.
    await page.getByRole("button", { name: "30秒で記録" }).click();
    await page.locator("#quickRecordForm").waitFor({ state: "visible" });
    assert.match(await page.locator("#dialog").innerText(), /空欄は未回答/, `page errors: ${pageErrors.join(" | ")}; notice: ${await page.locator("#notice").innerText()}`);
    const numeric = page.locator('#quickRecordForm input[type="number"]');
    await numeric.first().fill("3");
    await numeric.nth(1).fill("0");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.locator("#dialog").waitFor({ state: "hidden" });
    assert.match(await page.locator("body").innerText(), /今日の記録/);

    // 3. Field catalog exposes type, sharing and sensitivity metadata.
    await page.getByRole("button", { name: "項目カタログ" }).click();
    await page.locator('#dialog section[role="dialog"]').waitFor({ state: "visible" });
    const catalogText = await page.locator("#dialog").innerText();
    assert.match(catalogText, /型/); assert.match(catalogText, /共有/); assert.match(catalogText, /感度/);
    await page.getByRole("button", { name: "閉じる", exact: true }).click();

    // 4. Review remains explicit and grouped by risk.
    await page.locator('#tabs button[data-tab="review"]').click({ force: true });
    await page.locator("#content h2", { hasText: "確認" }).waitFor({ state: "visible" });
    const reviewText = await page.locator("#content").innerText();
    assert.match(reviewText, /センシティブ・競合/); assert.match(reviewText, /高信頼候補/);

    // 5. Sharing preview remains available as an explicit step.
    await page.locator('#tabs button[data-tab="sharing"]').click({ force: true });
    await page.locator("#content h2", { hasText: "共有 / Export" }).waitFor({ state: "visible" });
    assert.match(await page.locator("#content").innerText(), /共有 \/ Export/);

    // 6. MeTheory requests and operational views stay reachable.
    for (const [tab, heading] of [["integration", "連携"], ["backup", "バックアップ"], ["audit", "監査"]] as const) {
      await page.locator(`#tabs button[data-tab="${tab}"]`).click({ force: true });
      await page.locator("#content h2", { hasText: heading }).waitFor({ state: "visible" });
      assert.match(await page.locator("#content").innerText(), new RegExp(heading));
    }
  } finally {
    await browser.close(); child.kill(); await new Promise((resolve) => setTimeout(resolve, 100)); rmSync(directory, { recursive: true, force: true });
  }
});
