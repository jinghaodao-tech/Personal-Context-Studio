import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

test("experience onboarding is idempotent and exposes next actions", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pcs-experience-"));
  const databasePath = join(directory, "experience.sqlite3");
  const port = 21006;
  const child = spawn(process.execPath, ["--experimental-strip-types", "apps/api/src/server.ts"], { env: { ...process.env, PCS_PORT: String(port), PCS_DB: databasePath, PCS_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64") }, stdio: "ignore" });
  const url = (path: string) => `http://127.0.0.1:${port}${path}`;
  const request = async (path: string, init?: RequestInit) => fetch(url(path), { headers: { "content-type": "application/json" }, ...init });
  try {
    for (let attempt = 0; attempt < 30; attempt += 1) { try { if ((await fetch(url("/health"))).ok) break; } catch {} await new Promise((resolve) => setTimeout(resolve, 75)); }
    const before = await request("/v1/experience/onboarding"); assert.equal(before.status, 200); assert.equal((await before.json() as any).state.completed, 0);
    const first = await request("/v1/experience/onboarding", { method: "POST", body: JSON.stringify({ purposeKey: "work" }) }); const firstText = await first.text(); assert.equal(first.status, 200, firstText); const firstBody = JSON.parse(firstText) as any;
    const second = await request("/v1/experience/onboarding", { method: "POST", body: JSON.stringify({ purposeKey: "work" }) }); assert.equal(second.status, 200); assert.equal((await second.json() as any).templateId, firstBody.templateId);
    const templateDetail = await request(`/v1/context-templates/${firstBody.templateId}`); assert.equal((await templateDetail.json() as any).item.immutable, 1);
    const purposes = await request("/v1/sharing-purposes"); assert.ok(((await purposes.json() as any).items as Array<{ name: string }>).some((item) => item.name === "勉強・作業の傾向"));
    const home = await request("/v1/experience/home"); assert.equal(home.status, 200); assert.equal(typeof (await home.json() as any).todayCount, "number");
    const catalog = await request("/v1/experience/field-catalog"); assert.equal(catalog.status, 200); assert.ok(((await catalog.json() as any).items as unknown[]).length >= 5);
    const requestBody = { clientRequestId: "quick-record-test-1", templateId: firstBody.templateId, values: {}, recordedAt: "2026-08-04T00:00:00.000Z" };
    const created = await request("/v1/context-entries", { method: "POST", body: JSON.stringify(requestBody) }); assert.equal(created.status, 201);
    const duplicate = await request("/v1/context-entries", { method: "POST", body: JSON.stringify(requestBody) }); assert.equal(duplicate.status, 200); assert.equal((await duplicate.json() as any).duplicate, true);
    const database = new DatabaseSync(databasePath);
    const timestamp = "2026-08-04T01:00:00.000Z";
    database.prepare("INSERT INTO context_entries(id,template_id,template_version,status,created_at,updated_at) VALUES(?,?,?,?,?,?)").run("candidate-entry", firstBody.templateId, 1, "active", timestamp, timestamp);
    const insertValue = database.prepare("INSERT INTO context_values(id,entry_id,field_key,value_json,encrypted,source,source_id,user_confirmed,sharing,sensitivity,recorded_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)");
    insertValue.run("candidate-normal", "candidate-entry", "task_clarity", "4", 0, "manual_import", null, 0, "purpose_only", "normal", timestamp, timestamp);
    insertValue.run("candidate-sensitive", "candidate-entry", "start_delay", "10", 0, "manual_import", null, 0, "purpose_only", "sensitive", timestamp, timestamp);
    database.close();
    const classified = await request("/v1/experience/review-classifications", { method: "POST", body: JSON.stringify({ valueId: "candidate-normal", classification: "high_confidence", confidence: 0.95, reasons: ["schema_valid", "source_stable"] }) }); assert.equal(classified.status, 200);
    const unsafeClassification = await request("/v1/experience/review-classifications", { method: "POST", body: JSON.stringify({ valueId: "candidate-sensitive", classification: "high_confidence", confidence: 0.99 }) }); assert.equal(unsafeClassification.status, 409);
    const review = await request("/v1/experience/review-summary"); const reviewBody = await review.json() as any; assert.equal(reviewBody.counts.highConfidence, 1); assert.equal(reviewBody.counts.sensitiveOrConflict, 1);
  } finally { child.kill(); await new Promise((resolve) => setTimeout(resolve, 100)); rmSync(directory, { recursive: true, force: true }); }
});
