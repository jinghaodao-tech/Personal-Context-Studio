import assert from "node:assert/strict";
import test from "node:test";
import { detectStructuredPii } from "../apps/api/src/structuredPii.ts";

test("detects common structured Japanese PII and secrets", () => {
  const findings = detectStructuredPii("連絡先 yamada@example.co.jp、電話 090-1234-5678、〒100-0001。鍵は ghp_123456789012345678901234567890123456。詳細 https://example.com/a");
  assert.deepEqual(new Set(findings.map((item) => item.kind)), new Set(["email", "phone", "postal_code", "secret", "url"]));
});

test("does not flag ordinary numbers as structured PII", () => {
  assert.equal(detectStructuredPii("売上は2026年8月20日に1200円、件数は1234567件").some((item) => item.kind === "phone" || item.kind === "postal_code"), false);
});
