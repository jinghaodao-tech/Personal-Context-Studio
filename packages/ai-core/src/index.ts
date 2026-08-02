import { validateField, type ContextTemplateField, type ContextValueType } from "../../domain/src/index.ts";
import { isLoopbackUrl } from "../../local-ai-runtime/src/index.ts";

export type ExtractionDecision = "suggested" | "review_required" | "unanswered";
export type ContextTemplateDraft = { name: string; description: string; purpose: string; fields: ContextTemplateField[] };
export type GeneratedExtractionResult = { values: Record<string, unknown>; confidence: Record<string, number>; decisions: Record<string, ExtractionDecision>; sourceContentHash: string; providerId: string; model: string; warnings: string[] };
export type ExtractDocumentValuesInput = { content: string; template: { id: string; fields: ContextTemplateField[] }; sourceContentHash: string };
export type TemplateDraftRequest = { theme: string; purpose?: string; requestedFields?: string };
export type LocalAiProvider = { id: string; healthCheck(): Promise<{ providerId: string; available: boolean; running: boolean; model?: string; errorCode?: string }>; generateTemplateDraft(input: TemplateDraftRequest): Promise<ContextTemplateDraft>; extractDocumentValues(input: ExtractDocumentValuesInput): Promise<GeneratedExtractionResult>; manualTemplatePrompt?(input: TemplateDraftRequest): string; manualExtractionPrompt?(input: ExtractDocumentValuesInput): string };

export class LocalAiProviderError extends Error { readonly code: string; constructor(code: string) { super(code); this.code = code; } }

export function buildManualTemplatePrompt(input: TemplateDraftRequest): string {
  return JSON.stringify({
    instruction: "JSONだけを返してください。これはPersonal Context Studioの汎用テンプレートです。人が読み書きする記録項目、確定、更新、共有を支えるために使います。MeTheory固有の仮説、観測値、心理・健康分析、診断、スコアリング、EAV項目は作らないでください。テーマと目的に直接関係する項目だけを日本語で作成してください。valueTypeは候補一覧から1つだけ選び、fieldKeyは一意なlower_snake_caseにしてください。欲しい項目が指定されている場合は、それを優先し、無関係な項目を追加しないでください。",
    schema: { name: "string", description: "string", purpose: "string", fields: [{ fieldKey: "decision", label: "判断", valueType: "text", required: false, displayOrder: 1, options: [], sharingDefault: "purpose_only", sensitivity: "normal", reason: "記録する理由" }], allowedValueTypes: ["text", "long_text", "boolean", "single_choice", "multi_choice", "integer", "number", "date", "datetime", "duration_minutes", "scale"] },
    theme: input.theme,
    purpose: input.purpose?.trim() || "",
    requestedFields: input.requestedFields?.trim() || ""
  }, null, 2);
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
  async generateTemplateDraft(_input: TemplateDraftRequest): Promise<ContextTemplateDraft> { throw new LocalAiProviderError("disabled"); }
  async extractDocumentValues(_input: ExtractDocumentValuesInput): Promise<GeneratedExtractionResult> { throw new LocalAiProviderError("disabled"); }
}

class ManualProvider implements LocalAiProvider {
  id = "manual";
  async healthCheck() { return { providerId: this.id, available: true, running: false }; }
  manualTemplatePrompt(input: TemplateDraftRequest) { return buildManualTemplatePrompt(input); }
  manualExtractionPrompt(input: ExtractDocumentValuesInput) { return buildManualExtractionPrompt(input); }
  async generateTemplateDraft(_input: TemplateDraftRequest): Promise<ContextTemplateDraft> { throw new LocalAiProviderError("manual_input_required"); }
  async extractDocumentValues(_input: ExtractDocumentValuesInput): Promise<GeneratedExtractionResult> { throw new LocalAiProviderError("manual_input_required"); }
}

class MockProvider implements LocalAiProvider {
  id = "mock";
  async healthCheck() { return { providerId: this.id, available: true, running: true, model: "mock" }; }
  async generateTemplateDraft(input: TemplateDraftRequest) { return validateTemplateDraft({ name: input.theme, description: input.purpose || "Local mock template.", purpose: "personal_context", fields: [{ fieldKey: "summary", label: input.requestedFields?.split(/[\n,、]/)[0]?.trim() || `${input.theme}の要点`, valueType: "text", required: false, displayOrder: 1, sharingDefault: "purpose_only", sensitivity: "normal", reason: "明示的な要点を記録する" }] }); }
  async extractDocumentValues(input: ExtractDocumentValuesInput) { return extractionResult({}, input, this.id, "mock"); }
}

const generatedValueTypes: ContextValueType[] = ["text", "long_text", "boolean", "single_choice", "multi_choice", "integer", "number", "date", "datetime", "duration_minutes", "scale"];
function fallbackTemplateDraft(input: TemplateDraftRequest): ContextTemplateDraft {
  const theme = input.theme;
  const safeTheme = theme.trim().slice(0, 80) || "記録";
  const requested = (input.requestedFields ?? "").split(/[\n,、]/).map((item) => item.trim()).filter(Boolean).slice(0, 8);
  const requestedFields = requested.map((label, index) => ({ fieldKey: `requested_${index + 1}`, label, valueType: "text" as const, required: false, displayOrder: index + 1, options: [], sharingDefault: "purpose_only" as const, sensitivity: "normal" as const, reason: "指定された項目を記録する" }));
  const fields = requestedFields.length ? requestedFields : [
    { fieldKey: "summary", label: `${safeTheme}の要点`, valueType: "text" as const, required: false, displayOrder: 1, options: [], sharingDefault: "purpose_only" as const, sensitivity: "normal" as const, reason: "テーマの要点を記録する" },
    { fieldKey: "details", label: `${safeTheme}の詳細`, valueType: "long_text" as const, required: false, displayOrder: 2, options: [], sharingDefault: "purpose_only" as const, sensitivity: "normal" as const, reason: "テーマに関する具体的な内容を記録する" },
    { fieldKey: "next_action", label: `${safeTheme}について次にすること`, valueType: "text" as const, required: false, displayOrder: 3, options: [], sharingDefault: "purpose_only" as const, sensitivity: "normal" as const, reason: "次の行動を記録する" }
  ];
  return validateTemplateDraft({ name: safeTheme, description: input.purpose?.trim() || `${safeTheme}について記録するテンプレートです。`, purpose: "personal_context", fields });
}function normalizeGeneratedTemplateDraft(value: unknown, input: TemplateDraftRequest): ContextTemplateDraft {
  const theme = input.theme;
  const draft = value as any;
  if (!draft || typeof draft !== "object" || !Array.isArray(draft.fields)) throw new LocalAiProviderError("template_draft_invalid");
  const usedKeys = new Set<string>();
  const fields = draft.fields.map((field: any, index: number) => {
    const rawKey = typeof field?.fieldKey === "string" ? field.fieldKey.toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "") : "";
    const baseKey = rawKey && /^[a-z][a-z0-9_]{0,63}$/.test(rawKey) ? rawKey : `field_${index + 1}`;
    let fieldKey = baseKey; let suffix = 2; while (usedKeys.has(fieldKey)) fieldKey = `${baseKey}_${suffix++}`; usedKeys.add(fieldKey);
    const rawType = typeof field?.valueType === "string" ? field.valueType : "text";
    let valueType: ContextValueType = generatedValueTypes.includes(rawType as ContextValueType) ? rawType as ContextValueType : rawType.includes("boolean") ? "boolean" : rawType.includes("date") ? "date" : rawType.includes("number") ? "number" : "text";
    const options = Array.isArray(field?.options) ? field.options.filter((option: any) => option && typeof option.key === "string" && typeof option.label === "string").map((option: any) => ({ key: option.key.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_"), label: option.label.trim() })).filter((option: any) => option.key && option.label).filter((option: any, optionIndex: number, list: any[]) => list.findIndex((candidate) => candidate.key === option.key) === optionIndex) : [];
    if (["single_choice", "multi_choice"].includes(valueType) && !options.length) valueType = "text";
    return { fieldKey, label: typeof field?.label === "string" && field.label.trim() ? field.label.trim() : fieldKey, description: typeof field?.description === "string" ? field.description.trim() : "", valueType, required: Boolean(field?.required), displayOrder: index + 1, options, sharingDefault: ["always", "purpose_only", "private", "never"].includes(field?.sharingDefault) ? field.sharingDefault : "purpose_only", sensitivity: ["normal", "sensitive", "highly_sensitive"].includes(field?.sensitivity) ? field.sensitivity : "normal", reason: typeof field?.reason === "string" && field.reason.trim() ? field.reason.trim() : "記録する理由" };
  });
  const text = [draft.name, draft.description, ...fields.map((field: any) => field.label)].filter((item) => typeof item === "string").join(" ");
  const japaneseTheme = /[ぁ-んァ-ヶ一-龯]/.test(theme);
  const requested = (input.requestedFields ?? "").split(/[\n,、]/).map((item) => item.trim()).filter(Boolean).slice(0, 12);
  const requestedMatch = requested.length === 0 || requested.some((item) => text.includes(item) || fields.some((field: any) => field.label.includes(item)));
  if (!text.includes(theme.trim()) || (japaneseTheme && !/[ぁ-んァ-ヶ一-龯]/.test(text)) || !requestedMatch) return fallbackTemplateDraft(input);
  return validateTemplateDraft({ name: typeof draft.name === "string" && draft.name.trim() ? draft.name : theme, description: typeof draft.description === "string" ? draft.description : "", purpose: typeof draft.purpose === "string" && draft.purpose.trim() ? draft.purpose : "personal_context", fields });
}
class OpenAiCompatibleProvider implements LocalAiProvider {
  id = "openai-compatible-local";
  private readonly baseUrl: string;
  private readonly model: string;
  constructor(baseUrl: string, model: string) { this.baseUrl = baseUrl; this.model = model; if (!isLoopbackUrl(baseUrl)) throw new LocalAiProviderError("remote_local_ai_endpoint"); }
  async healthCheck() { try { const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/models`); return { providerId: this.id, available: response.ok, running: response.ok, model: this.model, errorCode: response.ok ? undefined : "unavailable" }; } catch { return { providerId: this.id, available: false, running: false, model: this.model, errorCode: "unavailable" }; } }
  private async chat(prompt: string) { const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: this.model, messages: [{ role: "user", content: prompt }], temperature: 0 }) }); if (!response.ok) throw new LocalAiProviderError("request_failed"); const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> }; const content = payload.choices?.[0]?.message?.content; if (typeof content !== "string") throw new LocalAiProviderError("invalid_response"); return content; }
  async generateTemplateDraft(input: TemplateDraftRequest) { return normalizeGeneratedTemplateDraft(parseJson(await this.chat(buildManualTemplatePrompt(input))), input); }
  async extractDocumentValues(input: ExtractDocumentValuesInput) { return extractionResult(parseJson(await this.chat(buildManualExtractionPrompt(input))), input, this.id, this.model); }
}

export function createLocalAiProvider(config: { provider?: string; model?: string; baseUrl?: string } = {}): LocalAiProvider {
  if (config.provider === "mock") return new MockProvider();
  if (config.provider === "manual") return new ManualProvider();
  if (config.provider === "ollama") return new OpenAiCompatibleProvider(config.baseUrl ?? "http://127.0.0.1:11434/v1", config.model ?? "llama3.2");
  if (config.provider === "openai-compatible-local") return new OpenAiCompatibleProvider(config.baseUrl ?? "http://127.0.0.1:1234/v1", config.model ?? "local-model");
  return new ManualProvider();
}
