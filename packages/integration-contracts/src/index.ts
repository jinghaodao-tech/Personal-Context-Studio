export const CONTEXT_ANALYSIS_SNAPSHOT_VERSION = "pcs-context-analysis-snapshot-v1" as const;
export const CONTEXT_ANALYSIS_SNAPSHOT_V2_VERSION = "pcs-analysis-snapshot-v2" as const;
export const PCS_ANALYSIS_CONTRACT_REVISION = "pcs-analysis-snapshot-v2.1" as const;
export const INTEGRATION_TEMPLATE_REQUEST_VERSION = "pcs-integration-template-request-v1" as const;

export type ContextAnalysisValue = { fieldKey: string; label: string; valueType: "boolean" | "single_choice" | "number" | "integer" | "text" | "long_text" | "multi_choice" | "date" | "datetime" | "duration_minutes" | "scale"; value: unknown; templateId: string; sourceDocumentId: string | null; analysisRole?: string; analysisRoleConfirmed?: boolean; analysisMergeAllowed?: boolean; minimum?: number; maximum?: number; unit?: string; allowedValues?: Array<{ key: string; label: string }> };
export type ContextAnalysisSnapshotV1 = { schemaVersion: typeof CONTEXT_ANALYSIS_SNAPSHOT_VERSION; generatedAt: string; records: Array<{ id: string; recordedAt: string; title: string; sourceDocumentId: string | null; values: ContextAnalysisValue[] }>; excluded: { unconfirmed: number; nonShareable: number; invalid: number } };
export type ContextAnalysisValueV2 = { fieldKey: string; label: string; valueType: "boolean" | "single_choice" | "number" | "integer" | "scale" | "duration_minutes"; value: boolean | string | number; templateId: string; templateVersionId: string; analysisRole: string; analysisRoleConfirmed: true; analysisUsage: "condition" | "outcome" | "both" | "excluded"; analysisMergeAllowed: boolean; scaleFingerprint: string; unit?: string; minimum?: number; maximum?: number; allowedValues?: Array<{ key: string; label: string }>; positiveValueKeys?: string[]; orderedValueKeys?: string[]; numericMapping?: Record<string, number>; provenance: { source: "user_input" | "reviewed_ai_extraction" | "manual_import"; sourceId: string; userConfirmed: true; recordedAt: string; transformVersion: string; privacyLevel: "normal" | "sensitive" } };
export type ContextAnalysisSnapshotV2 = { schemaVersion: typeof CONTEXT_ANALYSIS_SNAPSHOT_V2_VERSION; contractRevision: typeof PCS_ANALYSIS_CONTRACT_REVISION; snapshotId: string; profileId: string; generatedAt: string; period: { startAt: string; endAt: string; timezone: string }; records: Array<{ id: string; recordedAt: string; title?: string; sourceDocumentId: string | null; values: ContextAnalysisValueV2[] }>; excluded: Record<string, number> };
export type ContextAnalysisSnapshot = ContextAnalysisSnapshotV1 | ContextAnalysisSnapshotV2;

export type IntegrationTemplateRequestV1 = { schemaVersion: typeof INTEGRATION_TEMPLATE_REQUEST_VERSION; id: string; sourceSystem: string; sourceReferenceId: string | null; title: string; purpose: string; durationDays: number | null; requestedFields: Array<{ fieldKey: string; label: string; valueType: "text" | "long_text" | "boolean" | "single_choice" | "multi_choice" | "number" | "integer" | "date" | "datetime" | "duration_minutes" | "scale"; required: boolean; options?: Array<{ key: string; label: string }>; reason: string }>; createdAt: string };
export type IntegrationImportV1 = { id: string; sourceSystem: string; sourceReferenceId?: string | null; payload: Record<string, unknown>; createdAt?: string };
const keyPattern = /^[a-z][a-z0-9_]{0,63}$/;
const maxJsonBytes = 200_000;

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function validTimestamp(value: unknown): value is string { return typeof value === "string" && !Number.isNaN(Date.parse(value)); }
function validTimezone(value: unknown): value is string { if (typeof value !== "string" || !value) return false; try { new Intl.DateTimeFormat("en-US", { timeZone: value }).format(); return true; } catch { return false; } }
function validSourceSystem(value: unknown): value is string { return typeof value === "string" && /^[a-z][a-z0-9_-]{0,63}$/.test(value); }
const analysisValueKeys = new Set(["fieldKey", "label", "valueType", "value", "templateId", "templateVersionId", "analysisRole", "analysisRoleConfirmed", "analysisUsage", "analysisMergeAllowed", "scaleFingerprint", "unit", "minimum", "maximum", "allowedValues", "positiveValueKeys", "orderedValueKeys", "numericMapping", "provenance"]);
function validateAnalysisValue(value: unknown): ContextAnalysisValueV2 {
  if (!isRecord(value) || Object.keys(value).some((key) => !analysisValueKeys.has(key)) || typeof value.fieldKey !== "string" || !keyPattern.test(value.fieldKey) || typeof value.label !== "string" || typeof value.templateId !== "string" || typeof value.templateVersionId !== "string" || typeof value.analysisRole !== "string" || value.analysisRoleConfirmed !== true || !["condition", "outcome", "both", "excluded"].includes(String(value.analysisUsage)) || typeof value.analysisMergeAllowed !== "boolean" || typeof value.scaleFingerprint !== "string" || !analysisValueTypes.has(String(value.valueType))) throw new Error("context_analysis_value_invalid");
  const type = String(value.valueType);
  const validValue = type === "boolean" ? typeof value.value === "boolean" : type === "single_choice" ? typeof value.value === "string" : typeof value.value === "number" && Number.isFinite(value.value) && (type !== "integer" || Number.isInteger(value.value));
  if (!validValue) throw new Error("context_analysis_value_invalid");
  if ((value.minimum !== undefined && (typeof value.minimum !== "number" || !Number.isFinite(value.minimum))) || (value.maximum !== undefined && (typeof value.maximum !== "number" || !Number.isFinite(value.maximum))) || (value.minimum !== undefined && value.maximum !== undefined && value.minimum > value.maximum)) throw new Error("context_analysis_value_range_invalid");
  const minimum = typeof value.minimum === "number" ? value.minimum : undefined; const maximum = typeof value.maximum === "number" ? value.maximum : undefined; if (typeof value.value === "number" && ((minimum !== undefined && value.value < minimum) || (maximum !== undefined && value.value > maximum))) throw new Error("context_analysis_value_out_of_range");
  if (type === "single_choice" && (!Array.isArray(value.allowedValues) || !value.allowedValues.some((item) => isRecord(item) && item.key === value.value))) throw new Error("context_analysis_choice_invalid");
  if (value.allowedValues !== undefined && (!Array.isArray(value.allowedValues) || new Set(value.allowedValues.map((item) => isRecord(item) ? item.key : "")).size !== value.allowedValues.length || value.allowedValues.some((item) => !isRecord(item) || typeof item.key !== "string" || typeof item.label !== "string"))) throw new Error("context_analysis_value_choices_invalid");
  const keys = new Set((Array.isArray(value.allowedValues) ? value.allowedValues : []).map((item) => isRecord(item) ? String(item.key) : ""));
  for (const name of ["positiveValueKeys", "orderedValueKeys"]) if (value[name] !== undefined && (!Array.isArray(value[name]) || new Set(value[name]).size !== value[name].length || value[name].some((item) => typeof item !== "string" || !keys.has(item)))) throw new Error("context_analysis_value_semantics_invalid");
  if (value.numericMapping !== undefined && (!isRecord(value.numericMapping) || Object.entries(value.numericMapping).some(([key, item]) => !keys.has(key) || typeof item !== "number" || !Number.isFinite(item)))) throw new Error("context_analysis_value_semantics_invalid");
  if (!isRecord(value.provenance) || !["user_input", "reviewed_ai_extraction", "manual_import"].includes(String(value.provenance.source)) || typeof value.provenance.sourceId !== "string" || value.provenance.userConfirmed !== true || !validTimestamp(value.provenance.recordedAt) || typeof value.provenance.transformVersion !== "string" || !["normal", "sensitive"].includes(String(value.provenance.privacyLevel))) throw new Error("context_analysis_value_provenance_invalid");
  return value as ContextAnalysisValueV2;
}
const analysisValueTypes = new Set(["boolean", "single_choice", "number", "integer", "scale", "duration_minutes"]);

export function validateContextAnalysisSnapshot(value: unknown): ContextAnalysisSnapshot {
  if (!isRecord(value) || !validTimestamp(value.generatedAt)) throw new Error("context_analysis_snapshot_invalid");
  if (value.schemaVersion === CONTEXT_ANALYSIS_SNAPSHOT_VERSION && Array.isArray(value.records) && isRecord(value.excluded)) {
    for (const record of value.records) {
      if (!isRecord(record) || typeof record.id !== "string" || !validTimestamp(record.recordedAt) || typeof record.title !== "string" || record.title.length > 500 || !Array.isArray(record.values)) throw new Error("context_analysis_snapshot_invalid");
      for (const item of record.values) if (!isRecord(item) || typeof item.fieldKey !== "string" || !keyPattern.test(item.fieldKey) || typeof item.label !== "string" || typeof item.templateId !== "string" || !("value" in item)) throw new Error("context_analysis_snapshot_invalid");
    }
    return value as unknown as ContextAnalysisSnapshotV1;
  }
  if (value.schemaVersion === CONTEXT_ANALYSIS_SNAPSHOT_V2_VERSION && value.contractRevision === PCS_ANALYSIS_CONTRACT_REVISION && typeof value.snapshotId === "string" && typeof value.profileId === "string" && isRecord(value.period) && validTimestamp(value.period.startAt) && validTimestamp(value.period.endAt) && validTimezone(value.period.timezone) && Array.isArray(value.records) && isRecord(value.excluded)) {
    if (JSON.stringify(value).length > maxJsonBytes) throw new Error("context_analysis_snapshot_too_large");
    const excludedValid = Object.values(value.excluded).every((item) => typeof item === "number" && Number.isInteger(item) && item >= 0); if (JSON.stringify(value).length > maxJsonBytes || Date.parse(value.period.startAt) >= Date.parse(value.period.endAt) || !excludedValid) throw new Error("context_analysis_snapshot_invalid");
    return value as unknown as ContextAnalysisSnapshotV2;
  }
  throw new Error("context_analysis_snapshot_invalid");
}

export function validateIntegrationTemplateRequest(value: unknown): IntegrationTemplateRequestV1 {
  if (!isRecord(value) || value.schemaVersion !== INTEGRATION_TEMPLATE_REQUEST_VERSION || !validSourceSystem(value.sourceSystem) || typeof value.id !== "string" || !value.id || typeof value.title !== "string" || !value.title.trim() || typeof value.purpose !== "string" || !value.purpose.trim() || !validTimestamp(value.createdAt) || !Array.isArray(value.requestedFields)) throw new Error("integration_template_request_invalid");
  if (value.sourceReferenceId !== null && value.sourceReferenceId !== undefined && typeof value.sourceReferenceId !== "string") throw new Error("integration_template_request_invalid");
  if (value.durationDays !== null && value.durationDays !== undefined && (typeof value.durationDays !== "number" || !Number.isInteger(value.durationDays) || value.durationDays < 1 || value.durationDays > 366)) throw new Error("integration_template_request_invalid");
  for (const field of value.requestedFields) {
    if (!isRecord(field) || typeof field.fieldKey !== "string" || !keyPattern.test(field.fieldKey) || typeof field.label !== "string" || !field.label.trim() || typeof field.valueType !== "string" || typeof field.required !== "boolean" || typeof field.reason !== "string" || !field.reason.trim()) throw new Error("integration_template_request_invalid");
    if (field.options !== undefined && (!Array.isArray(field.options) || field.options.some((option) => !isRecord(option) || typeof option.key !== "string" || typeof option.label !== "string"))) throw new Error("integration_template_request_invalid");
  }
  if (JSON.stringify(value).length > maxJsonBytes) throw new Error("integration_template_request_too_large");
  return value as IntegrationTemplateRequestV1;
}

export function validateIntegrationImport(value: unknown): IntegrationImportV1 {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id || !validSourceSystem(value.sourceSystem) || !isRecord(value.payload) || (value.sourceReferenceId !== undefined && value.sourceReferenceId !== null && typeof value.sourceReferenceId !== "string") || (value.createdAt !== undefined && !validTimestamp(value.createdAt))) throw new Error("integration_import_invalid");
  if (JSON.stringify(value).length > maxJsonBytes || Object.keys(value.payload).length > 100 || Object.keys(value.payload).some((key) => !key || key.length > 120)) throw new Error("integration_import_too_large");
  if (/(api[_ -]?key|password|private[_ -]?key|secret|authorization|bearer\s+)/i.test(JSON.stringify(value.payload))) throw new Error("integration_import_secret_like");
  return value as IntegrationImportV1;
}

export function localPcsUrl(value: string): URL { const url = new URL(value); if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("pcs_localhost_required"); return url; }
