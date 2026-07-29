import { createHash } from "node:crypto";
import { newId, type ContextTemplateField } from "../../domain/src/index.ts";
import type { ExtractDocumentValuesInput, GeneratedExtractionResult, LocalAiProvider } from "../../ai-core/src/index.ts";

export type ExtractionRecord = { id: string; documentId: string; templateId: string; sourceContentHash: string; sourceUpdatedAt: string; status: "review_required" | "stale" | "applied"; result: GeneratedExtractionResult; createdAt: string };
export function contentHash(content: string) { return createHash("sha256").update(content).digest("hex"); }
export async function extractDocumentValues(input: { documentId: string; template: { id: string; fields: ContextTemplateField[] }; content: string; sourceUpdatedAt: string; provider: LocalAiProvider }): Promise<ExtractionRecord> {
  const sourceContentHash = contentHash(input.content);
  const result = await input.provider.extractDocumentValues({ content: input.content, template: input.template, sourceContentHash } satisfies ExtractDocumentValuesInput);
  return { id: newId("extraction"), documentId: input.documentId, templateId: input.template.id, sourceContentHash, sourceUpdatedAt: input.sourceUpdatedAt, status: "review_required", result, createdAt: new Date().toISOString() };
}
export function extractionIsStale(record: ExtractionRecord, content: string) { return record.sourceContentHash !== contentHash(content); }
