export declare const CONTEXT_ANALYSIS_SNAPSHOT_VERSION: "pcs-context-analysis-snapshot-v1";
export declare const CONTEXT_ANALYSIS_SNAPSHOT_V2_VERSION: "pcs-analysis-snapshot-v2";
export declare const PCS_ANALYSIS_CONTRACT_REVISION: "pcs-analysis-snapshot-v2.1";
export declare const CONTEXT_ANALYSIS_SNAPSHOT_V3_VERSION: "pcs-analysis-snapshot-v3";
export declare const PCS_ANALYSIS_CONTRACT_V3_REVISION: "pcs-analysis-snapshot-v3.0";
export declare const INTEGRATION_TEMPLATE_REQUEST_VERSION: "pcs-integration-template-request-v1";
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
    allowedValues?: Array<{
        key: string;
        label: string;
    }>;
};
export type ContextAnalysisSnapshotV1 = {
    schemaVersion: typeof CONTEXT_ANALYSIS_SNAPSHOT_VERSION;
    generatedAt: string;
    records: Array<{
        id: string;
        recordedAt: string;
        title: string;
        sourceDocumentId: string | null;
        values: ContextAnalysisValue[];
    }>;
    excluded: {
        unconfirmed: number;
        nonShareable: number;
        invalid: number;
    };
};
export type ContextAnalysisValueV2 = {
    fieldKey: string;
    label: string;
    valueType: "boolean" | "single_choice" | "number" | "integer" | "scale" | "duration_minutes";
    value: boolean | string | number;
    templateId: string;
    templateVersionId: string;
    analysisRole: string;
    analysisRoleConfirmed: true;
    analysisUsage: "condition" | "outcome" | "both" | "excluded";
    analysisMergeAllowed: boolean;
    scaleFingerprint: string;
    applicability?: Array<{
        condition: string | null;
        validFrom: string | null;
        validTo: string | null;
    }>;
    unit?: string;
    minimum?: number;
    maximum?: number;
    allowedValues?: Array<{
        key: string;
        label: string;
    }>;
    positiveValueKeys?: string[];
    orderedValueKeys?: string[];
    numericMapping?: Record<string, number>;
    provenance: {
        source: "user_input" | "reviewed_ai_extraction" | "manual_import";
        sourceId: string;
        userConfirmed: true;
        recordedAt: string;
        transformVersion: string;
        privacyLevel: "normal" | "sensitive";
    };
};
export type ContextAnalysisSnapshotV2 = {
    schemaVersion: typeof CONTEXT_ANALYSIS_SNAPSHOT_V2_VERSION;
    contractRevision: typeof PCS_ANALYSIS_CONTRACT_REVISION;
    snapshotId: string;
    profileId: string;
    generatedAt: string;
    period: {
        startAt: string;
        endAt: string;
        timezone: string;
    };
    records: Array<{
        id: string;
        recordedAt: string;
        title?: string;
        sourceDocumentId: string | null;
        values: ContextAnalysisValueV2[];
    }>;
    excluded: Record<string, number>;
};
export type ConfirmationMode = "user_confirmed" | "machine_measured";
export type MeasurementMetadata = {
    definitionVersion: string;
    sourceTool: string;
    sourceToolVersion: string;
    measuredAt: string;
};
export type ContextAnalysisValueV3 = Omit<ContextAnalysisValueV2, "provenance"> & {
    confirmationMode: ConfirmationMode;
    measurement?: MeasurementMetadata;
    provenance: Omit<ContextAnalysisValueV2["provenance"], "userConfirmed" | "source"> & {
        source: "user_input" | "reviewed_ai_extraction" | "manual_import" | "system";
        userConfirmed: boolean;
    };
};
export type ContextAnalysisSnapshotV3 = {
    schemaVersion: typeof CONTEXT_ANALYSIS_SNAPSHOT_V3_VERSION;
    contractRevision: typeof PCS_ANALYSIS_CONTRACT_V3_REVISION;
    snapshotId: string;
    profileId: string;
    generatedAt: string;
    period: {
        startAt: string;
        endAt: string;
        timezone: string;
    };
    records: Array<{
        id: string;
        recordedAt: string;
        title?: string;
        sourceDocumentId: string | null;
        values: ContextAnalysisValueV3[];
    }>;
    excluded: Record<string, number>;
};
export type ContextAnalysisSnapshot = ContextAnalysisSnapshotV1 | ContextAnalysisSnapshotV2 | ContextAnalysisSnapshotV3;
export type IntegrationTemplateRequestV1 = {
    schemaVersion: typeof INTEGRATION_TEMPLATE_REQUEST_VERSION;
    id: string;
    sourceSystem: string;
    sourceReferenceId: string | null;
    title: string;
    purpose: string;
    durationDays: number | null;
    minimumObservations?: number;
    minimumPerGroup?: number;
    requestedFields: Array<{
        fieldKey: string;
        label: string;
        valueType: "text" | "long_text" | "boolean" | "single_choice" | "multi_choice" | "number" | "integer" | "date" | "datetime" | "duration_minutes" | "scale";
        required: boolean;
        options?: Array<{
            key: string;
            label: string;
        }>;
        positiveValueKeys?: string[];
        orderedValueKeys?: string[];
        numericMapping?: Record<string, number>;
        reason: string;
        semanticRole?: string;
        analysisUsage?: "condition" | "outcome" | "both";
        minimum?: number;
        maximum?: number;
        unit?: string;
        collectionTiming?: "task_start" | "before_activity" | "during_activity" | "after_activity" | "daily" | "follow_up";
        questionText?: string;
        sharingDefault?: "always" | "purpose_only" | "private" | "never";
        sensitivity?: "normal" | "sensitive" | "highly_sensitive";
    }>;
    createdAt: string;
};
export type IntegrationImportV1 = {
    id: string;
    sourceSystem: string;
    sourceReferenceId?: string | null;
    payload: Record<string, unknown>;
    createdAt?: string;
};
export declare function validateContextAnalysisSnapshot(value: unknown): ContextAnalysisSnapshot;
export declare function validateIntegrationTemplateRequest(value: unknown): IntegrationTemplateRequestV1;
export declare function validateIntegrationImport(value: unknown): IntegrationImportV1;
export declare function localPcsUrl(value: string): URL;
