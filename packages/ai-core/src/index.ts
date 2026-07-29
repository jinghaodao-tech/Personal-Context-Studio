import { validateField, type ContextTemplateField } from "../../domain/src/index.ts";
import { isLoopbackUrl } from "../../local-ai-runtime/src/index.ts";

export type ExtractionDecision = "suggested" | "review_required" | "unanswered";
export type ContextTemplateDraft = { name: string; description: string; purpose: string; fields: ContextTemplateField[] };
export type GeneratedExtractionResult = { values: Record<string, unknown>; confidence: Record<string, number>; decisions: Record<string, ExtractionDecision>; sourceContentHash: string; providerId: string; model: string; warnings: string[] };
export type ExtractDocumentValuesInput = { content: string; template: { id: string; fields: ContextTemplateField[] }; sourceContentHash: string };
export type LocalAiProvider = { id: string; healthCheck(): Promise<{ providerId: string; available: boolean; running: boolean; model?: string; errorCode?: string }>; generateTemplateDraft(input: { theme: string }): Promise<ContextTemplateDraft>; extractDocumentValues(input: ExtractDocumentValuesInput): Promise<GeneratedExtractionResult>; manualTemplatePrompt?(input: { theme: string }): string; manualExtractionPrompt?(input: ExtractDocumentValuesInput): string };

export class LocalAiProviderError extends Error { readonly code: string; constructor(code: string) { super(code); this.code = code; } }

export function buildManualTemplatePrompt(input: { theme: string }): string {
  return JSON.stringify({ instruction: "Return JSON only. Create a concise reusable personal-context template. Do not diagnose or infer sensitive facts.", schema: { name: "string", description: "string", purpose: "string", fields: [{ fieldKey: "lower_snake_case", label: "string", valueType: "text|long_text|boolean|single_choice|multi_choice|number|date", required: "boolean", displayOrder: "integer", options: [{ key: "string", label: "string" }], sharingDefault: "always|purpose_only|private|never", sensitivity: "normal|sensitive|highly_sensitive", reason: "string" }] }, theme: input.theme }, null, 2);
}

export function buildManualExtractionPrompt(input: ExtractDocumentValuesInput): string {
  return JSON.stringify({ instruction: "Return JSON only. Extract only explicit facts for the listed fields. Do not diagnose, invent values, or copy secrets.", content: input.content, fields: input.template.fields.map((field) => ({ fieldKey: field.fieldKey, label: field.label, valueType: field.valueType, options: field.options ?? [] })) }, null, 2);
}

export function validateTemplateDraft(value: unknown): ContextTemplateDraft {
  const draft = value as Partial<ContextTemplateDraft>;
  if (!draft || typeof draft.name !== "string" || !draft.name.trim() || typeof draft.description !== "string" || typeof draft.purpose !== "string" || !Array.isArray(draft.fields) || !draft.fields.length) throw new LocalAiProviderError("template_draft_invalid");
  return { name: draft.name.trim(), description: draft.description.trim(), purpose: draft.purpose.trim() || "personal_context", fields: draft.fields.map((field) => validateField(field)) };
}

function parseJson(value: string): unknown { try { return JSON.parse(value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim()); } catch { throw new LocalAiProviderError("invalid_json"); } }
function extractionResult(value: unknown, input: ExtractDocumentValuesInput, providerId: string, model: string): GeneratedExtractionResult {
  if (!value || typeof value !== "object") throw new LocalAiProviderError("extraction_invalid");
  const source = value as Record<string, unknown>;
  const confidenceSource = typeof source._confidence === "object" && source._confidence ? source._confidence as Record<string, unknown> : {};
  const values: Record<string, unknown> = {}, confidence: Record<string, number> = {}, decisions: Record<string, ExtractionDecision> = {};
  for (const field of input.template.fields) if (Object.hasOwn(source, field.fieldKey)) {
    values[field.fieldKey] = source[field.fieldKey];
    const score = typeof confidenceSource[field.fieldKey] === "number" ? Math.max(0, Math.min(1, confidenceSource[field.fieldKey] as number)) : 0.5;
    confidence[field.fieldKey] = score;
    decisions[field.fieldKey] = score >= 0.85 ? "suggested" : score >= 0.6 ? "review_required" : "unanswered";
  }
  return { values, confidence, decisions, sourceContentHash: input.sourceContentHash, providerId, model, warnings: [] };
}

class DisabledProvider implements LocalAiProvider {
  id = "disabled";
  async healthCheck() { return { providerId: this.id, available: false, running: false, errorCode: "disabled" }; }
  async generateTemplateDraft(_input: { theme: string }): Promise<ContextTemplateDraft> { throw new LocalAiProviderError("disabled"); }
  async extractDocumentValues(_input: ExtractDocumentValuesInput): Promise<GeneratedExtractionResult> { throw new LocalAiProviderError("disabled"); }
}

class ManualProvider implements LocalAiProvider {
  id = "manual";
  async healthCheck() { return { providerId: this.id, available: true, running: false }; }
  manualTemplatePrompt(input: { theme: string }) { return buildManualTemplatePrompt(input); }
  manualExtractionPrompt(input: ExtractDocumentValuesInput) { return buildManualExtractionPrompt(input); }
  async generateTemplateDraft(_input: { theme: string }): Promise<ContextTemplateDraft> { throw new LocalAiProviderError("manual_input_required"); }
  async extractDocumentValues(_input: ExtractDocumentValuesInput): Promise<GeneratedExtractionResult> { throw new LocalAiProviderError("manual_input_required"); }
}

class MockProvider implements LocalAiProvider {
  id = "mock";
  async healthCheck() { return { providerId: this.id, available: true, running: true, model: "mock" }; }
  async generateTemplateDraft(input: { theme: string }) { return validateTemplateDraft({ name: `${input.theme} record`, description: "Local mock template.", purpose: "personal_context", fields: [{ fieldKey: "summary", label: "Summary", valueType: "text", required: false, displayOrder: 1, sharingDefault: "purpose_only", sensitivity: "normal", reason: "Capture an explicit summary." }] }); }
  async extractDocumentValues(input: ExtractDocumentValuesInput) { return extractionResult({}, input, this.id, "mock"); }
}

class OpenAiCompatibleProvider implements LocalAiProvider {
  id = "openai-compatible-local";
  private readonly baseUrl: string;
  private readonly model: string;
  constructor(baseUrl: string, model: string) { this.baseUrl = baseUrl; this.model = model; if (!isLoopbackUrl(baseUrl)) throw new LocalAiProviderError("remote_local_ai_endpoint"); }
  async healthCheck() { try { const response = await fetch(`${this.baseUrl.replace(/\/v1\/?$/, "")}/models`); return { providerId: this.id, available: response.ok, running: response.ok, model: this.model, errorCode: response.ok ? undefined : "unavailable" }; } catch { return { providerId: this.id, available: false, running: false, model: this.model, errorCode: "unavailable" }; } }
  private async chat(prompt: string) { const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: this.model, messages: [{ role: "user", content: prompt }], temperature: 0 }) }); if (!response.ok) throw new LocalAiProviderError("request_failed"); const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> }; const content = payload.choices?.[0]?.message?.content; if (typeof content !== "string") throw new LocalAiProviderError("invalid_response"); return content; }
  async generateTemplateDraft(input: { theme: string }) { return validateTemplateDraft(parseJson(await this.chat(buildManualTemplatePrompt(input)))); }
  async extractDocumentValues(input: ExtractDocumentValuesInput) { return extractionResult(parseJson(await this.chat(buildManualExtractionPrompt(input))), input, this.id, this.model); }
}

export function createLocalAiProvider(config: { provider?: string; model?: string; baseUrl?: string } = {}): LocalAiProvider {
  if (config.provider === "mock") return new MockProvider();
  if (config.provider === "manual") return new ManualProvider();
  if (config.provider === "ollama") return new OpenAiCompatibleProvider(config.baseUrl ?? "http://127.0.0.1:11434/v1", config.model ?? "llama3.2");
  if (config.provider === "openai-compatible-local") return new OpenAiCompatibleProvider(config.baseUrl ?? "http://127.0.0.1:1234/v1", config.model ?? "local-model");
  return new DisabledProvider();
}
