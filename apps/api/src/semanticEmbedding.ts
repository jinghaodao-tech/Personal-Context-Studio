// Embedding-based semantic-similarity layer for the ADR-021 non-LLM sensitivity
// detector. Replaces the earlier trigram-overlap heuristic, whose holdout
// validation (test/auto-confirm-holdout-validation.test.ts) showed it could not
// generalize past its fixed exemplar phrases (combined recall 0.176 on independent
// paraphrases). This module is deterministic (no generation, no sampling) and
// runs fully locally via an ONNX embedding model -- it never sends field text
// to an external service, matching the same boundary ADR-016 draws for AI use.
//
// Model: cl-nagoya/ruri-v3-30m (Apache-2.0, Japanese-specific embeddings,
// JMTEB avg 74.51 with 37M params -- see ADR-021 for the comparison against
// multilingual-e5-small, which scores lower at 3x the parameter count).
// Loaded via the official ONNX conversion (onnx-community/ruri-v3-30m-ONNX)
// through @huggingface/transformers, so no Python runtime or manual ONNX
// conversion step is required.

import { AutoModel, AutoTokenizer } from "@huggingface/transformers";

export const SEMANTIC_MODEL_ID = "onnx-community/ruri-v3-30m-ONNX";
// The ONNX conversion currently publishes weights/config but not tokenizer
// assets at the repository root. Reuse the tokenizer from the original Ruri
// model, which is architecturally identical to the converted encoder.
export const SEMANTIC_TOKENIZER_MODEL_ID = "cl-nagoya/ruri-v3-30m";

// Exemplar phrases, one per category, covering the eleven 要配慮個人情報
// legal categories (Act on the Protection of Personal Information, Article
// 2(3)) cited in ADR-021, plus this product's own stated extensions (mood,
// income, sexual orientation) and the original PII-metadata exemplars.
// Unlike the retired trigram layer, embeddings compare meaning rather than
// character overlap, so one representative phrase per category is expected
// to generalize to paraphrases -- this is the property the holdout
// validation exists to check, not assume.
export const SEMANTIC_EXEMPLARS: string[] = [
  "人種や民族に関すること",
  "信仰する宗教や信条",
  "社会的身分や生まれ育ち",
  "病歴や既往症",
  "犯罪歴や前科",
  "犯罪の被害を受けた経験",
  "身体的または精神的な障害",
  "健康診断の結果",
  "精神的な状態や気分の変化",
  "未成年時の補導や保護処分歴",
  "収入や家計の状況",
  "恋愛や性的指向",
  "氏名",
  "メールアドレス",
  "住所",
  "電話番号",
];

// The model now runs locally and this threshold has been checked against the
// repository's labeled regression and independent holdout sets. It is not a
// production-accuracy calibration: the independent holdout is only 22 cases.
// The current repository holdout measures semantic recall 0.706 at 0.85
// (combined detector recall 0.706 on the untouched 22-case paraphrase set).
// An earlier 0.984 figure came from a different external/tuning split and is
// deliberately not presented as this repository's validation result.
// Explicit short Japanese terms remain covered by the deterministic keyword layer.
export const SEMANTIC_SIMILARITY_THRESHOLD = 0.85;

type Extractor = {
  tokenizer: (text: string | string[], options?: Record<string, unknown>) => any;
  model: (inputs: any) => Promise<any>;
};

let extractorPromise: Promise<Extractor> | null = null;
function getExtractor(): Promise<Extractor> {
  if (!extractorPromise) {
    extractorPromise = Promise.all([
      AutoTokenizer.from_pretrained(SEMANTIC_TOKENIZER_MODEL_ID),
      AutoModel.from_pretrained(SEMANTIC_MODEL_ID),
    ]).then(([tokenizer, model]) => ({ tokenizer: tokenizer as Extractor["tokenizer"], model: model as Extractor["model"] }));
  }
  return extractorPromise;
}

let exemplarEmbeddingsPromise: Promise<Float32Array[]> | null = null;
async function getExemplarEmbeddings(): Promise<Float32Array[]> {
  if (!exemplarEmbeddingsPromise) {
    exemplarEmbeddingsPromise = (async () => {
      const extractor = await getExtractor();
      const embeddings: Float32Array[] = [];
      for (const exemplar of SEMANTIC_EXEMPLARS) {
        embeddings.push(await embed(extractor, exemplar));
      }
      return embeddings;
    })();
  }
  return exemplarEmbeddingsPromise;
}

async function embed(extractor: Extractor, text: string): Promise<Float32Array> {
  const inputs = extractor.tokenizer(text, { padding: true, truncation: true });
  const output = await extractor.model(inputs);
  const hidden = output.last_hidden_state as { data: Float32Array; dims: number[] };
  const mask = inputs.attention_mask as { data: BigInt64Array | Int32Array; dims: number[] };
  const [, sequenceLength, dimensions] = hidden.dims;
  const vector = new Float32Array(dimensions);
  let count = 0;
  for (let token = 0; token < sequenceLength; token += 1) {
    if (Number(mask.data[token]) === 0) continue;
    count += 1;
    for (let dimension = 0; dimension < dimensions; dimension += 1) vector[dimension] += hidden.data[token * dimensions + dimension];
  }
  for (let dimension = 0; dimension < dimensions; dimension += 1) vector[dimension] /= Math.max(1, count);
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm > 0) for (let dimension = 0; dimension < dimensions; dimension += 1) vector[dimension] /= norm;
  return vector;
}

function dotProduct(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let index = 0; index < a.length; index += 1) sum += a[index] * b[index];
  return sum;
}

/**
 * Embedding-based replacement for the retired trigram `semanticSimilarity`.
 * Vectors are L2-normalized on extraction (`normalize: true`), so cosine
 * similarity reduces to a plain dot product.
 */
export async function semanticSimilarityEmbedded(text: string): Promise<boolean> {
  return (await semanticSimilarityScore(text)) >= SEMANTIC_SIMILARITY_THRESHOLD;
}

/** Returns the highest cosine similarity against the sensitive exemplars. */
export async function semanticSimilarityScore(text: string): Promise<number> {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const extractor = await getExtractor();
  const [queryEmbedding, exemplarEmbeddings] = await Promise.all([
    embed(extractor, trimmed),
    getExemplarEmbeddings(),
  ]);
  return Math.max(...exemplarEmbeddings.map((exemplarEmbedding) => dotProduct(queryEmbedding, exemplarEmbedding)));
}

/** Test-only hook: lets tests inject a fake extractor instead of loading the real model. */
export function __setExtractorForTests(factory: (() => Promise<Extractor>) | null): void {
  extractorPromise = factory ? factory() : null;
  exemplarEmbeddingsPromise = null;
}
