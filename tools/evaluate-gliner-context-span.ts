import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { glinerFindingIsSensitive } from "../apps/api/src/glinerClient.ts";

type Entity = { text: string; label: string; start: number; end: number };
type Item = { text: string; entities: Entity[] };
const base = process.env.PCS_GLINER_URL ?? "http://127.0.0.1:3001";
const file = process.env.GLINER_EVAL_FILE ?? join(process.cwd(), "data", "gliner-eval", "japanese-context-span-evaluation.jsonl");
const limit = Number(process.env.GLINER_EVAL_LIMIT ?? 0);
const offset = Number(process.env.GLINER_EVAL_OFFSET ?? 0);
const items = (await readFile(file, "utf8")).trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Item).slice(offset, offset + (limit || undefined));
function family(label: string): string {
  const value = label.toLocaleLowerCase();
  if (value.includes("health")) return "health";
  if (value.includes("income") || value.includes("financial")) return "finance";
  if (value.includes("relig")) return "religion";
  if (value.includes("sexual")) return "sexual_orientation";
  if (value.includes("email")) return "email";
  if (value.includes("phone")) return "phone";
  if (value.includes("person")) return "person";
  if (value.includes("address")) return "address";
  if (value.includes("secret") || value.includes("token") || value.includes("key")) return "secret";
  return value;
}
function overlaps(a: Entity, b: Entity): boolean {
  const intersection = Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
  const shorter = Math.max(1, Math.min(a.end - a.start, b.end - b.start));
  return intersection / shorter >= 0.5;
}
let expected = 0, tp = 0, fp = 0, fn = 0;
let unsupportedExpected = 0;
const supportedFamilies = new Set(["person", "address", "secret"]);
for (const item of items) {
  const response = await fetch(new URL("extract", base), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: item.text, labels: ["person name", "phone number", "address", "email address", "date", "url", "account number", "secret"], threshold: Number(process.env.PCS_GLINER_THRESHOLD ?? 0.55) }) });
  const payload = await response.json() as { entities?: Entity[] };
  const predicted = (Array.isArray(payload.entities) ? payload.entities : []).filter((candidate) => supportedFamilies.has(family(String(candidate.label ?? ""))) && glinerFindingIsSensitive(candidate, Number(process.env.PCS_GLINER_THRESHOLD ?? 0.55), item.text));
  const used = new Set<number>();
  const supportedTruth = item.entities.filter((truth) => supportedFamilies.has(family(truth.label)));
  unsupportedExpected += item.entities.length - supportedTruth.length;
  expected += supportedTruth.length;
  for (const truth of supportedTruth) {
    const index = predicted.findIndex((candidate, candidateIndex) => !used.has(candidateIndex) && family(String(candidate.label ?? "")) === family(truth.label) && overlaps(truth, candidate));
    if (index >= 0) { used.add(index); tp++; } else fn++;
  }
  fp += predicted.filter((_, index) => !used.has(index)).length;
}
const precision = tp + fp ? tp / (tp + fp) : 0;
const recall = expected ? tp / expected : 0;
console.log(JSON.stringify({ sampleCount: items.length, expectedEntities: expected, unsupportedExpected, precision, recall, f1: precision + recall ? 2 * precision * recall / (precision + recall) : 0, tp, fp, fn }, null, 2));
