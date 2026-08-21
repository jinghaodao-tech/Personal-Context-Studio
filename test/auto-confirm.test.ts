import test from "node:test";
import assert from "node:assert/strict";
import { autoConfirmClassification, autoConfirmAllowed } from "../apps/api/src/autoConfirm.ts";

test("detector does not flag an ordinary task field", async () => {
  const result = await autoConfirmClassification("task_clarity", "Task clarity", "How clear was the task");
  assert.equal(result.flagged, false);
  assert.equal(result.detectorVersion, "non-llm-layered-v3-embeddings");
});

test("detector flags physiological fields in English and Japanese", async () => {
  assert.equal((await autoConfirmClassification("sleep_hours", "Sleep hours")).flagged, true);
  assert.equal((await autoConfirmClassification("energy", "Today's energy", "エネルギー")).flagged, true);
  assert.equal((await autoConfirmClassification("hr", "Heart rate reading")).flagged, true);
  assert.equal((await autoConfirmClassification("field1", "睡眠時間")).flagged, true);
  assert.equal((await autoConfirmClassification("field2", "気分の記録")).flagged, true);
  assert.equal((await autoConfirmClassification("field3", "月経周期")).flagged, true);
});

test("detector flags personal-info fields (name, contact, address)", async () => {
  assert.equal((await autoConfirmClassification("full_name", "氏名")).flagged, true);
  assert.equal((await autoConfirmClassification("contact_email", "Email address")).flagged, true);
  assert.equal((await autoConfirmClassification("home_address", "住所")).flagged, true);
});

test("keyword layer does not match English tokens inside compound identifiers", async () => {
  assert.equal((await autoConfirmClassification("username", "Account handle")).layers.keyword, false);
  assert.equal((await autoConfirmClassification("filename", "Export file")).layers.keyword, false);
  assert.equal((await autoConfirmClassification("name", "Name")).layers.keyword, true);
});

test("detector classification is driven by fieldKey/label/description together", async () => {
  // Neither key nor label mentions anything sensitive, but the description does.
  const result = await autoConfirmClassification("q1", "Question 1", "How many hours did you sleep?");
  assert.equal(result.flagged, true);
});

test("layered detector covers adversarial metadata and value PII", async () => {
  assert.equal((await autoConfirmClassification("q", "怒りの強さ")).flagged, true);
  assert.equal((await autoConfirmClassification("q", "収入の範囲")).flagged, true);
  assert.equal((await autoConfirmClassification("q", "連絡先", "", "user@example.com")).flagged, true);
  assert.equal((await autoConfirmClassification("q", "端末の電力", "", "42 watts")).flagged, false);
});

test("semantic layer catches paraphrases without keyword matches", async () => {
  // Requires the real embedding model (network access to download
  // onnx-community/ruri-v3-30m-ONNX on first run, then cached locally).
  // Not runnable in a network-restricted sandbox -- run on a normal machine.
  const irritation = await autoConfirmClassification("irritation_level", "苛立ちレベル");
  assert.equal(irritation.layers.keyword, false);
  assert.equal(irritation.layers.semantic, true);
  const margin = await autoConfirmClassification("household_margin", "家計の余裕");
  assert.equal(margin.layers.keyword, false);
  assert.equal(margin.layers.semantic, true);
});

test("autoConfirmAllowed: disabled auto-confirm is always allowed regardless of sensitivity or flags", () => {
  assert.deepEqual(autoConfirmAllowed({ enabled: false, sensitivity: "highly_sensitive", detectorFlagged: true, elevatedConsent: false }), { ok: true });
});

test("autoConfirmAllowed: enabling requires sensitivity normal", () => {
  const result = autoConfirmAllowed({ enabled: true, sensitivity: "sensitive", detectorFlagged: false, elevatedConsent: false });
  assert.deepEqual(result, { ok: false, error: "auto_confirm_requires_normal_sensitivity" });
});

test("autoConfirmAllowed: normal sensitivity, not flagged, no consent needed", () => {
  assert.deepEqual(autoConfirmAllowed({ enabled: true, sensitivity: "normal", detectorFlagged: false, elevatedConsent: false }), { ok: true });
});

test("autoConfirmAllowed: normal sensitivity but detector-flagged requires elevated consent", () => {
  const result = autoConfirmAllowed({ enabled: true, sensitivity: "normal", detectorFlagged: true, elevatedConsent: false });
  assert.deepEqual(result, { ok: false, error: "auto_confirm_elevated_consent_required" });
});

test("autoConfirmAllowed: normal sensitivity, flagged, with elevated consent is allowed", () => {
  assert.deepEqual(autoConfirmAllowed({ enabled: true, sensitivity: "normal", detectorFlagged: true, elevatedConsent: true }), { ok: true });
});

test("autoConfirmAllowed: sensitivity check is evaluated before the consent check", () => {
  // Both violations present at once -- the sensitivity error must win, since it is checked first
  // and a caller only sees one error per request.
  const result = autoConfirmAllowed({ enabled: true, sensitivity: "highly_sensitive", detectorFlagged: true, elevatedConsent: false });
  assert.equal(result.ok, false);
  assert.equal((result as { error: string }).error, "auto_confirm_requires_normal_sensitivity");
});
