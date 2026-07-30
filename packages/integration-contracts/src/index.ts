export const PCS_ANALYSIS_SNAPSHOT_VERSION = "pcs-analysis-snapshot-v1" as const;
export const PCS_EXPERIMENT_TEMPLATE_REQUEST_VERSION = "pcs-experiment-template-request-v1" as const;

export type PcsAnalysisValue = {
  fieldKey: string;
  label: string;
  valueType: "boolean" | "single_choice" | "number" | "integer" | "text" | "long_text" | "multi_choice" | "date";
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

export type PcsAnalysisRecord = {
  id: string;
  recordedAt: string;
  title: string;
  sourceDocumentId: string | null;
  values: PcsAnalysisValue[];
};

export type PcsAnalysisSnapshotV1 = {
  schemaVersion: typeof PCS_ANALYSIS_SNAPSHOT_VERSION;
  generatedAt: string;
  records: PcsAnalysisRecord[];
  excluded: { unconfirmed: number; nonShareable: number; invalid: number };
};

export type ExperimentTemplateRequestV1 = {
  schemaVersion: typeof PCS_EXPERIMENT_TEMPLATE_REQUEST_VERSION;
  id: string;
  sourceSystem: "metheory";
  hypothesisId: string | null;
  title: string;
  purpose: string;
  durationDays: number | null;
  requestedFields: Array<{
    fieldKey: string;
    label: string;
    valueType: "text" | "long_text" | "boolean" | "single_choice" | "multi_choice" | "number" | "date";
    required: boolean;
    options?: Array<{ key: string; label: string }>;
    reason: string;
  }>;
  createdAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

export function validateAnalysisSnapshot(value: unknown): PcsAnalysisSnapshotV1 {
  if (!isRecord(value) || value.schemaVersion !== PCS_ANALYSIS_SNAPSHOT_VERSION || !validTimestamp(value.generatedAt) || !Array.isArray(value.records) || !isRecord(value.excluded)) {
    throw new Error("pcs_analysis_snapshot_invalid");
  }
  for (const record of value.records) {
    if (!isRecord(record) || typeof record.id !== "string" || !validTimestamp(record.recordedAt) || typeof record.title !== "string" || !Array.isArray(record.values)) {
      throw new Error("pcs_analysis_snapshot_invalid");
    }
  }
  return value as PcsAnalysisSnapshotV1;
}

export function validateExperimentTemplateRequest(value: unknown): ExperimentTemplateRequestV1 {
  if (!isRecord(value) || value.schemaVersion !== PCS_EXPERIMENT_TEMPLATE_REQUEST_VERSION || value.sourceSystem !== "metheory" || typeof value.id !== "string" || !value.id || typeof value.title !== "string" || !value.title.trim() || typeof value.purpose !== "string" || !value.purpose.trim() || !validTimestamp(value.createdAt) || !Array.isArray(value.requestedFields)) {
    throw new Error("pcs_experiment_template_request_invalid");
  }
  const durationDays = value.durationDays;
  if (durationDays !== null && durationDays !== undefined && (typeof durationDays !== "number" || !Number.isInteger(durationDays) || durationDays < 1 || durationDays > 366)) {
    throw new Error("pcs_experiment_template_request_invalid");
  }
  return value as ExperimentTemplateRequestV1;
}

export function localPcsUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("pcs_localhost_required");
  }
  return url;
}
