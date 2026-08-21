import { AUTO_CONFIRM_EVALUATION_SET } from "../test/auto-confirm-evaluation.test.ts";
import { autoConfirmClassification } from "../apps/api/src/autoConfirm.ts";

const metrics = (results: boolean[], labels: boolean[]) => {
  const tp = results.filter((result, index) => result && labels[index]).length;
  const fp = results.filter((result, index) => result && !labels[index]).length;
  const fn = results.filter((result, index) => !result && labels[index]).length;
  return { precision: tp / Math.max(1, tp + fp), recall: tp / Math.max(1, tp + fn), tp, fp, fn };
};
const labels = AUTO_CONFIRM_EVALUATION_SET.map((item) => item.sensitive);
const outputs = await Promise.all(AUTO_CONFIRM_EVALUATION_SET.map((item) => autoConfirmClassification(item.key, item.label, item.description, item.value)));
console.log(JSON.stringify({ detectorVersion: outputs[0]?.detectorVersion, sampleCount: outputs.length, keyword: metrics(outputs.map((item) => item.layers.keyword), labels), semantic: metrics(outputs.map((item) => item.layers.semantic), labels), valuePii: metrics(outputs.map((item) => item.layers.valuePii), labels), combined: metrics(outputs.map((item) => item.flagged), labels) }, null, 2));
