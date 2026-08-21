import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { semanticSimilarityScore } from "../apps/api/src/semanticEmbedding.ts";

type Case = { key: string; label: string; description?: string; sensitive: boolean; sourceGroup?: string };
const filename = process.env.EXTERNAL_EVAL_FILE ?? "semantic-evaluation.json";
const cases = JSON.parse(await readFile(join(process.cwd(), "tmp", "external-auto-confirm-eval", filename), "utf8")) as Case[];
const bucket = (group: string) => Number.parseInt(createHash("sha256").update(group).digest("hex").slice(0, 2), 16) % 100;
const scored = await Promise.all(cases.map(async (item) => ({ ...item, score: await semanticSimilarityScore(`${item.key} ${item.label} ${item.description ?? ""}`) })));
const metrics = (rows: typeof scored, threshold: number) => {
  const tp = rows.filter((row) => row.score >= threshold && row.sensitive).length;
  const fp = rows.filter((row) => row.score >= threshold && !row.sensitive).length;
  const fn = rows.filter((row) => row.score < threshold && row.sensitive).length;
  const precision = tp / Math.max(1, tp + fp);
  const recall = tp / Math.max(1, tp + fn);
  return { precision, recall, f1: (2 * precision * recall) / Math.max(1e-9, precision + recall), tp, fp, fn };
};
const tune = scored.filter((row) => bucket(row.sourceGroup ?? row.key) >= 70 && bucket(row.sourceGroup ?? row.key) < 85);
const test = scored.filter((row) => bucket(row.sourceGroup ?? row.key) >= 85);
let best = { threshold: 0, ...metrics(tune, 0) };
for (let threshold = 0.70; threshold <= 0.95; threshold += 0.01) {
  const result = metrics(tune, threshold);
  if (result.recall >= 0.9 && result.f1 > best.f1) best = { threshold: Number(threshold.toFixed(2)), ...result };
}
if (!best.threshold) { for (let threshold = 0.70; threshold <= 0.95; threshold += 0.01) { const result = metrics(tune, threshold); if (result.f1 > best.f1) best = { threshold: Number(threshold.toFixed(2)), ...result }; } }
console.log(JSON.stringify({ counts: { total: scored.length, tune: tune.length, test: test.length }, selected: best, heldOutTest: metrics(test, best.threshold) }, null, 2));
