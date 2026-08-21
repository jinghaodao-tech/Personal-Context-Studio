import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { autoConfirmClassification } from "../apps/api/src/autoConfirm.ts";

type Case = { key: string; label: string; description?: string; sensitive: boolean; category?: string; noise?: string };
const filename = process.env.EXTERNAL_EVAL_FILE ?? "evaluation.json";
const path = join(process.cwd(), "tmp", "external-auto-confirm-eval", filename);
const allCases = JSON.parse(await readFile(path, "utf8")) as Case[];
const limit = Number(process.env.EXTERNAL_EVAL_LIMIT ?? 10000);
const baseCases = allCases.filter((item) => !item.noise);
const noiseCases = allCases.filter((item) => item.noise).slice(0, Math.max(0, limit - baseCases.length));
const cases = [...baseCases.slice(0, limit), ...noiseCases];
const caseCategory = (item: Case) => item.category ?? categoryNames.find((category) => item.key.startsWith(`semantic_external_${category}_`));
const outputs = await Promise.all(cases.map((item) => autoConfirmClassification(item.key, item.label, item.description)));
const labels = cases.map((item) => item.sensitive);
const metrics = (predicted: boolean[]) => {
  const tp = predicted.filter((value, index) => value && labels[index]).length;
  const fp = predicted.filter((value, index) => value && !labels[index]).length;
  const fn = predicted.filter((value, index) => !value && labels[index]).length;
  const precision = tp / Math.max(1, tp + fp);
  const recall = tp / Math.max(1, tp + fn);
  return { precision, recall, f1: (2 * precision * recall) / Math.max(1e-9, precision + recall), tp, fp, fn };
};
const categoryNames = ["income", "health", "religion", "sexual_orientation"];
const categoryMetrics = Object.fromEntries(categoryNames.map((category) => {
  const indices = cases.map((item, index) => caseCategory(item) === category || (!caseCategory(item) && !item.sensitive) ? index : -1).filter((index) => index >= 0);
  const categoryLabels = indices.map((index) => caseCategory(cases[index]) === category);
  const categoryOutputs = indices.map((index) => outputs[index]);
  const tp = categoryOutputs.filter((value, index) => value.layers.semantic && categoryLabels[index]).length;
  const fp = categoryOutputs.filter((value, index) => value.layers.semantic && !categoryLabels[index]).length;
  const fn = categoryOutputs.filter((value, index) => !value.layers.semantic && categoryLabels[index]).length;
  const precision = tp / Math.max(1, tp + fp), recall = tp / Math.max(1, tp + fn);
  return [category, { sampleCount: indices.length, positiveCount: categoryLabels.filter(Boolean).length, precision, recall, f1: (2 * precision * recall) / Math.max(1e-9, precision + recall), tp, fp, fn }];
}));
console.log(JSON.stringify({ sampleCount: cases.length, positiveCount: labels.filter(Boolean).length, semantic: metrics(outputs.map((item) => item.layers.semantic)), combined: metrics(outputs.map((item) => item.flagged)), categoryMetrics }, null, 2));
