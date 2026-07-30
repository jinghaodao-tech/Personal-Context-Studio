export const CONTEXT_ANALYSIS_SNAPSHOT_VERSION = "pcs-context-analysis-snapshot-v1" as const;
export const INTEGRATION_TEMPLATE_REQUEST_VERSION = "pcs-integration-template-request-v1" as const;

export type ContextAnalysisValue = {
  fieldKey: string;
  label: string;
  valueType: "boolean" | "single_choice" | "number" | "integer" | "text" | "long_text" | "multi_choice" | "date" | "datetime" | "duration_minutes" | "scale";
  value: unknown;
  templateId: string;
  sourceDocumentId: string | null;
  analysisRole?: string;
  analysisRoleConfirmed?: boolean;
  analysisMergeAllowed?: boolean;
  minimum?: number;
  maximum?: number;
  unit?: string;
  allowedValues?: Array<{ key: string; label: string }>;
};

export type ContextAnalysisSnapshotV1 = {
  schemaVersion: typeof CONTEXT_ANALYSIS_SNAPSHOT_VERSION;
  generatedAt: string;
  records: Array<{ id: string; recordedAt: string; title: string; sourceDocumentId: string | null; values: ContextAnalysisValue[] }>;
  excluded: { unconfirmed: number; nonShareable: number; invalid: number };
};

export type IntegrationTemplateRequestV1 = {
  schemaVersion: typeof INTEGRATION_TEMPLATE_REQUEST_VERSION;
  id: string;
  sourceSystem: string;
  sourceReferenceId: string | null;
  title: string;
  purpose: string;
  durationDays: number | null;
  requestedFields: Array<{ fieldKey: string; label: string; valueType: "text" | "long_text" | "boolean" | "single_choice" | "multi_choice" | "number" | "integer" | "date" | "datetime" | "duration_minutes" | "scale"; required: boolean; options?: Array<{ key: string; label: string }>; reason: string }>;
  createdAt: string;
};

export type IntegrationImportV1 = { id: string; sourceSystem: string; sourceReferenceId?: string | null; payload: Record<string, unknown>; createdAt?: string };

function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function validTimestamp(value: unknown): value is string { return typeof value === "string" && !Number.isNaN(Date.parse(value)); }
function validSourceSystem(value: unknown): value is string { return typeof value === "string" && /^[a-z][a-z0-9_-]{0,63}$/.test(value); }

export function validateContextAnalysisSnapshot(value: unknown): ContextAnalysisSnapshotV1 {
  if (!isRecord(value) || value.schemaVersion !== CONTEXT_ANALYSIS_SNAPSHOT_VERSION || !validTimestamp(value.generatedAt) || !Array.isArray(value.records) || !isRecord(value.excluded)) throw new Error("context_analysis_snapshot_invalid");
  for (const record of value.records) if (!isRecord(record) || typeof record.id !== "string" || !validTimestamp(record.recordedAt) || typeof record.title !== "string" || !Array.isArray(record.values)) throw new Error("context_analysis_snapshot_invalid");
  return value as ContextAnalysisSnapshotV1;
}

export function validateIntegrationTemplateRequest(value: unknown): IntegrationTemplateRequestV1 {
  if (!isRecord(value) || value.schemaVersion !== INTEGRATION_TEMPLATE_REQUEST_VERSION || !validSourceSystem(value.sourceSystem) || typeof value.id !== "string" || !value.id || typeof value.title !== "string" || !value.title.trim() || typeof value.purpose !== "string" || !value.purpose.trim() || !validTimestamp(value.createdAt) || !Array.isArray(value.requestedFields)) throw new Error("integration_template_request_invalid");
  if (value.sourceReferenceId !== null && value.sourceReferenceId !== undefined && typeof value.sourceReferenceId !== "string") throw new Error("integration_template_request_invalid");
  if (value.durationDays !== null && value.durationDays !== undefined && (typeof value.durationDays !== "number" || !Number.isInteger(value.durationDays) || value.durationDays < 1 || value.durationDays > 366)) throw new Error("integration_template_request_invalid");
  return value as IntegrationTemplateRequestV1;
}

export function validateIntegrationImport(value: unknown): IntegrationImportV1 {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id || !validSourceSystem(value.sourceSystem) || !isRecord(value.payload) || (value.sourceReferenceId !== undefined && value.sourceReferenceId !== null && typeof value.sourceReferenceId !== "string") || (value.createdAt !== undefined && !validTimestamp(value.createdAt))) throw new Error("integration_import_invalid");
  return value as IntegrationImportV1;
}

export function localPcsUrl(value: string): URL { const url = new URL(value); if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("pcs_localhost_required"); return url; }
