import test from "node:test";
import assert from "node:assert/strict";
import { autoConfirmClassification, autoConfirmAllowed } from "../apps/api/src/autoConfirm.ts";

test("detector does not flag an ordinary task field", () => {
  const result = autoConfirmClassification("task_clarity", "Task clarity", "How clear was the task");
  assert.equal(result.flagged, false);
  assert.equal(result.detectorVersion, "physiological-personal-v1");
});

test("detector flags physiological fields in English and Japanese", () => {
  assert.equal(autoConfirmClassification("sleep_hours", "Sleep hours").flagged, true);
  assert.equal(autoConfirmClassification("energy", "Today's energy", "エネルギー").flagged, true);
  assert.equal(autoConfirmClassification("hr", "Heart rate reading").flagged, true);
  assert.equal(autoConfirmClassification("field1", "睡眠時間").flagged, true);
  assert.equal(autoConfirmClassification("field2", "気分の記録").flagged, true);
  assert.equal(autoConfirmClassification("field3", "月経周期").flagged, true);
});

test("detector flags personal-info fields (name, contact, address)", () => {
  assert.equal(autoConfirmClassification("full_name", "氏名").flagged, true);
  assert.equal(autoConfirmClassification("contact_email", "Email address").flagged, true);
  assert.equal(autoConfirmClassification("home_address", "住所").flagged, true);
});

test("detector classification is driven by fieldKey/label/description together", () => {
  // Neither key nor label mentions anything sensitive, but the description does.
  const result = autoConfirmClassification("q1", "Question 1", "How many hours did you sleep?");
  assert.equal(result.flagged, true);
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
