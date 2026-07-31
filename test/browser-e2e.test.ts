import assert from "node:assert/strict";
import test from "node:test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

test("dashboard opens and exposes the management navigation in a real browser", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pcs-browser-"));
  const notes = join(directory, "notes"); mkdirSync(notes, { recursive: true });
  const port = 19800 + Math.floor(Math.random() * 100);
  const child: ChildProcess = spawn(process.execPath, ["--experimental-strip-types", "apps/api/src/server.ts"], { env: { ...process.env, PCS_PORT: String(port), PCS_DB: join(directory, "context.sqlite3"), PCS_NOTES_DIR: notes }, stdio: "ignore" });
  const browser = await chromium.launch({ headless: true });
  try {
    for (let attempt = 0; attempt < 60; attempt += 1) { try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break; } catch { /* wait for API */ } await new Promise((resolve) => setTimeout(resolve, 50)); }
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
    assert.match(await page.title(), /Personal Context Studio/);
    assert.match(await page.locator("body").innerText(), /Review/);
    await page.locator('#tabs button[data-tab="privacy"]').click({ force: true });
    assert.match(await page.locator("body").innerText(), /Privacy/);
    for (const [tab, heading] of [["sharing", "共有 / Export"], ["integration", "連携"], ["backup", "バックアップ"], ["audit", "監査"]] as const) {
      await page.locator(`#tabs button[data-tab="${tab}"]`).click({ force: true });
      await page.waitForTimeout(20);
      assert.match(await page.locator("body").innerText(), new RegExp(heading));
    }
  } finally {
    await browser.close(); child.kill(); await new Promise((resolve) => setTimeout(resolve, 100)); rmSync(directory, { recursive: true, force: true });
  }
});
