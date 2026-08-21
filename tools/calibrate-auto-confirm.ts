import { AUTO_CONFIRM_EVALUATION_SET } from "../test/auto-confirm-evaluation.test.ts";
import { semanticSimilarityScore } from "../apps/api/src/semanticEmbedding.ts";

const rows = await Promise.all(AUTO_CONFIRM_EVALUATION_SET.map(async (item) => ({
  sensitive: item.sensitive,
  score: await semanticSimilarityScore(`${item.key} ${item.label} ${item.description ?? ""}`),
})));
for (let threshold = 0.55; threshold <= 0.91; threshold += 0.02) {
  const predicted = rows.map((row) => row.score >= threshold);
  const tp = predicted.filter((value, index) => value && rows[index].sensitive).length;
  const fp = predicted.filter((value, index) => value && !rows[index].sensitive).length;
  const fn = predicted.filter((value, index) => !value && rows[index].sensitive).length;
  const precision = tp / Math.max(1, tp + fp);
  const recall = tp / Math.max(1, tp + fn);
  const f1 = (2 * precision * recall) / Math.max(1e-9, precision + recall);
  console.log(JSON.stringify({ threshold: Number(threshold.toFixed(2)), precision, recall, f1, tp, fp, fn }));
}
