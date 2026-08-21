import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DATASETS = [
  "DataFog/pii-small-en",
  "VytautoDidziojoUniversitetas/NUS-LT-PII-corpus",
  "ai4privacy/pii-masking-health-phi-400k",
  "ai4privacy/pii-masking-openpii-1.5m",
  "akiFQC/japanese-confidential-information-extraction-sft",
  "ai4privacy/pii-masking-300k",
  "ai4privacy/pii-masking-nano-1k",
];
let DATASET = DATASETS[0];
const API = (dataset: string, offset: number) => {
  const base = `dataset=${encodeURIComponent(dataset)}&config=default&split=train&offset=${offset}&length=100`;
  // The Japanese source dataset is already Japanese and its parquet viewer
  // does not expose the filter endpoint reliably; page it directly.
  return dataset.startsWith("akiFQC/") || dataset === "DataFog/pii-small-en" || dataset === "VytautoDidziojoUniversitetas/NUS-LT-PII-corpus"
    ? `https://datasets-server.huggingface.co/rows?${base}`
    : `https://datasets-server.huggingface.co/filter?${base}&where=${encodeURIComponent('"language"=\'ja\'')}`;
};
const outputRoot = join(process.cwd(), "tmp", "external-auto-confirm-eval");

type Row = { source_text?: string; text?: string; privacy_mask?: Array<{ label?: string }>; label?: Array<{ label?: string }>; language?: string; messages?: Array<{ role?: string; content?: string }>; semanticCategories?: string[] };
type EvaluationCase = { key: string; label: string; description: string; sensitive: boolean; source: string; sourceGroup?: string; category?: string; noise?: string };

function hash(value: string): string { return createHash("sha256").update(value).digest("hex").slice(0, 16); }
function normalizeRow(row: Row): Row {
  if (typeof row.text === "string" && typeof row.source_text !== "string") {
    row = { ...row, source_text: row.text, privacy_mask: row.label ?? [] };
  }
  if (typeof row.source_text === "string") {
    const labels = (row.privacy_mask ?? []).map((item) => String(item.label ?? "").toLowerCase());
    const semanticCategories = [...new Set([
      ...(labels.some((label) => /salary|income|financial|bank|credit|debt|家計|収入/.test(label)) ? ["income"] : []),
      ...(labels.some((label) => /medical|health|病|症状|medication|\bhealth\b/.test(label)) ? ["health"] : []),
      ...(labels.some((label) => /religion|creed|political|信条|宗教|^rel$/.test(label)) ? ["religion"] : []),
      ...(labels.some((label) => /sexual.?orientation|性的指向|^sex$/.test(label)) ? ["sexual_orientation"] : []),
    ])];
    return { ...row, semanticCategories };
  }
  const user = row.messages?.find((message) => message.role === "user")?.content;
  const assistant = row.messages?.find((message) => message.role === "assistant")?.content;
  let sensitive = false;
  let semanticCategories: string[] = [];
  if (assistant) { try {
    const parsed = JSON.parse(assistant) as Record<string, unknown>;
    const categoryMap: Record<string, string> = { financial_info: "income", health: "health", medical: "health", religion: "religion", creed: "religion", sexual_orientation: "sexual_orientation" };
    semanticCategories = Object.entries(parsed).flatMap(([key, value]) => Array.isArray(value) && value.length > 0 && categoryMap[key] ? [categoryMap[key]] : []);
    sensitive = Object.values(parsed).some((value) => Array.isArray(value) && value.length > 0);
  } catch { /* keep malformed source rows negative */ } }
  return { source_text: user, privacy_mask: sensitive ? [{ label: "external-confidential" }] : [], language: "ja", semanticCategories };
}
function noise(text: string, index: number): { text: string; kind: string } {
  const transforms: Array<[string, (value: string) => string]> = [
    ["remove-spaces", (value) => value.replace(/\s+/g, "")],
    ["prefix", (value) => `メモ: ${value}`],
    ["punctuation", (value) => value.replace(/[、。]/g, " ")],
    ["width-variation", (value) => value.replace(/アドレス/g, "ｱﾄﾞﾚｽ")],
    ["suffix", (value) => `${value}について`],
    ["question", (value) => `${value}は？`],
    ["brackets", (value) => `【${value}】`],
    ["lowercase", (value) => value.toLowerCase()],
  ];
  const first = transforms[index % transforms.length];
  const second = index >= transforms.length ? transforms[Math.floor(index / transforms.length) % transforms.length] : null;
  return { text: second ? second[1](first[1](text)) : first[1](text), kind: second ? `${first[0]}+${second[0]}` : first[0] };
}

let pages: Array<{ rows?: Array<{ row?: Row }> }> = [];
let lastError = "";
for (const candidate of DATASETS) {
  const candidatePages: Array<{ rows?: Array<{ row?: Row }> }> = [];
  // The dataset is multilingual; fetch enough pages to obtain a useful
  // Japanese slice without downloading the raw corpus.
  for (let offset = 0; offset < 5000; offset += 100) {
    const response = await fetch(API(candidate, offset));
    if (!response.ok) { lastError = `${candidate}:${response.status}:offset=${offset}`; break; }
    candidatePages.push(await response.json() as { rows?: Array<{ row?: Row }> });
  }
  // Viewer APIs can rate-limit later pages. A usable first page is still a
  // valid supplemental sample; do not discard it and silently fall back.
  if (candidatePages.length > 0) { DATASET = candidate; pages = candidatePages; break; }
}
let japanese = pages.flatMap((payload) => payload.rows ?? []).map((item) => normalizeRow(item.row ?? {})).filter((row) => (row.language === "ja" || DATASET === "DataFog/pii-small-en" || DATASET === "VytautoDidziojoUniversitetas/NUS-LT-PII-corpus") && typeof row.source_text === "string");
// Dataset Viewer can be temporarily unavailable for some repositories. For
// the small fallback corpus, use its public JSONL artifact directly.
if (japanese.length < 50) {
  for (const candidate of ["ai4privacy/pii-masking-nano-1k"]) {
    const rawUrl = `https://huggingface.co/datasets/${candidate}/resolve/main/data/train.jsonl?download=true`;
    const raw = await fetch(rawUrl);
    if (!raw.ok) continue;
    const lines = (await raw.text()).split(/\r?\n/).filter(Boolean);
    japanese = lines.map((line) => normalizeRow(JSON.parse(line) as Row)).filter((row) => row.language === "ja" && typeof row.source_text === "string");
    if (japanese.length > 0) { DATASET = candidate; break; }
  }
}
if (japanese.length === 0) throw new Error(`external_dataset_fetch_failed:${lastError}`);
if (japanese.length < 20) throw new Error(`external_dataset_too_small:${japanese.length}`);
if (japanese.length < 50) console.warn(`external_dataset_small:${japanese.length}; combining with synthetic/noise cases is recommended`);

const cases: EvaluationCase[] = [];
const semanticCases: EvaluationCase[] = [];
for (let index = 0; index < japanese.length; index += 1) {
  const row = japanese[index];
  const text = row.source_text!.trim();
  const sensitive = (row.privacy_mask ?? []).length > 0;
  cases.push({ key: `external_${hash(text)}_${index}`, label: text.slice(0, 120), description: "外部PIIデータセット由来の補助評価", sensitive, source: DATASET });
  for (const category of row.semanticCategories ?? []) semanticCases.push({ key: `semantic_external_case_${index}_${category}`, label: text.slice(0, 240), description: "外部データ由来のラベル付きsemantic評価", sensitive: true, source: DATASET, sourceGroup: `row_${index}`, category });
  for (let variant = 0; variant < 34; variant += 1) {
    const mutated = noise(text, variant);
    cases.push({ key: `external_${hash(mutated.text)}_${index}_${variant}_noise`, label: mutated.text.slice(0, 120), description: "外部データの決定的ノイズ変形", sensitive, source: DATASET, noise: mutated.kind });
  }
}
// Add hard negatives from rows that do not carry one of the target semantic categories.
for (let index = 0; index < japanese.length; index += 1) {
  const row = japanese[index];
  if (!(row.semanticCategories ?? []).length) semanticCases.push({ key: `semantic_external_negative_case_${index}`, label: row.source_text!.slice(0, 240), description: "外部データ由来の陰性semantic評価", sensitive: false, source: DATASET, sourceGroup: `row_${index}` });
}

await mkdir(outputRoot, { recursive: true });
await writeFile(join(outputRoot, "evaluation.json"), `${JSON.stringify(cases, null, 2)}\n`, "utf8");
await writeFile(join(outputRoot, "semantic-evaluation.json"), `${JSON.stringify(semanticCases, null, 2)}\n`, "utf8");
const sourceManifest = await readFile(join(process.cwd(), "tools", "external-eval-sources.json"), "utf8");
await writeFile(join(outputRoot, "source-manifest.json"), sourceManifest, "utf8");
await writeFile(join(outputRoot, "README.md"), `# External auto-confirm evaluation\n\nGenerated from ${DATASET} through the Hugging Face datasets-server API. The raw dataset is not copied into this repository. The source is supplemental PII/noise evaluation, not a PCS production-accuracy claim.\n\n- evaluation.json: broad PII/noise cases\n- semantic-evaluation.json: only mapped income/health/religion/sexual-orientation categories plus hard negatives\n`, "utf8");
console.log(JSON.stringify({ dataset: DATASET, sourceLanguage: DATASET === "VytautoDidziojoUniversitetas/NUS-LT-PII-corpus" ? "lt" : DATASET === "DataFog/pii-small-en" ? "en" : "ja", sourceRows: japanese.length, generatedCases: cases.length, semanticCases: semanticCases.length, output: outputRoot }, null, 2));
