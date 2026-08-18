import test from "node:test";
import assert from "node:assert/strict";
import { autoConfirmClassification } from "../apps/api/src/autoConfirm.ts";

type Case = { key: string; label: string; description?: string; value?: string; sensitive: boolean };

// Small, versioned hold-out set. These examples are deliberately not copied from
// the detector's implementation list; they are the regression/evaluation set for
// the product boundary and must grow with reviewed false positives/negatives.
export const AUTO_CONFIRM_EVALUATION_SET: Case[] = [
  { key: "怒りの強さ", label: "今日の感情", sensitive: true },
  { key: "annual_income", label: "暮らしの余裕", sensitive: true },
  { key: "irritation_level", label: "苛立ちレベル", sensitive: true },
  { key: "household_margin", label: "家計の余裕", sensitive: true },
  { key: "contact", label: "連絡先", value: "user@example.com", sensitive: true },
  { key: "postal", label: "配送先", value: "〒100-0001", sensitive: true },
  { key: "sleep_quality", label: "昨夜の休息", sensitive: true },
  { key: "task_clarity", label: "作業の明確さ", sensitive: false },
  { key: "device_power_draw", label: "端末の電力", value: "42 watts", sensitive: false },
  { key: "reading_minutes", label: "読書時間", value: "30", sensitive: false },
  { key: "meeting_count", label: "会議の回数", value: "3", sensitive: false },
  { key: "completion", label: "作業の完了度", description: "仕事の進み具合", sensitive: false },
];

function metrics(results: boolean[], labels: boolean[]) {
  const tp = results.filter((result, index) => result && labels[index]).length;
  const fp = results.filter((result, index) => result && !labels[index]).length;
  const fn = results.filter((result, index) => !result && labels[index]).length;
  return { precision: tp / Math.max(1, tp + fp), recall: tp / Math.max(1, tp + fn), tp, fp, fn };
}

test("ADR-021 labeled evaluation reports layer and OR-gate quality", () => {
  const outputs = AUTO_CONFIRM_EVALUATION_SET.map((item) => autoConfirmClassification(item.key, item.label, item.description, item.value));
  const labels = AUTO_CONFIRM_EVALUATION_SET.map((item) => item.sensitive);
  const keyword = metrics(outputs.map((output) => output.layers.keyword), labels);
  const semantic = metrics(outputs.map((output) => output.layers.semantic), labels);
  const valuePii = metrics(outputs.map((output) => output.layers.valuePii), labels);
  const combined = metrics(outputs.map((output) => output.flagged), labels);
  assert.ok(combined.precision >= 0.75, JSON.stringify({ keyword, semantic, valuePii, combined }));
  assert.ok(combined.recall >= 0.8, JSON.stringify({ keyword, semantic, valuePii, combined }));
});
