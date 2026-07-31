import { randomUUID } from "node:crypto";
export type Sharing = "always" | "purpose_only" | "private" | "never";
export type Sensitivity = "normal" | "sensitive" | "highly_sensitive";
export type ContextValueType = "text" | "long_text" | "boolean" | "single_choice" | "multi_choice" | "integer" | "number" | "date" | "datetime" | "duration_minutes" | "scale";
export type ContextTemplateField = { fieldKey: string; label: string; description?: string; valueType: ContextValueType; required: boolean; displayOrder: number; options?: Array<{ key: string; label: string }>; minimum?: number; maximum?: number; unit?: string; analysisRole?: string; analysisRoleConfirmed?: boolean; analysisUsage?: "condition" | "outcome" | "both" | "excluded"; analysisMergeAllowed?: boolean; reconfirmationMode?: "none" | "default" | "explicit"; reconfirmationIntervalDays?: number | null; sharingDefault: Sharing; sensitivity: Sensitivity; reason: string };
const secretPattern = /(api[_ -]?key|password|passphrase|secret|private[_ -]?key|authorization|bearer\s+|-----begin [^-]+private key-----|(?:gh[pousr]|sk|xox[baprs])[_-][a-z0-9_-]{12,})/i;
const keyPattern = /^[a-z][a-z0-9_]{0,63}$/;
export function newId(prefix: string) { return `${prefix}_${randomUUID().replaceAll("-", "")}`; }
export function isSecretLike(value: unknown): boolean {
  if (typeof value === "string") return secretPattern.test(value);
  if (Array.isArray(value)) return value.some((item) => isSecretLike(item));
  if (value && typeof value === "object") return Object.entries(value).some(([key, item]) => secretPattern.test(key) || isSecretLike(item));
  return false;
}
export function validateField(field: ContextTemplateField): ContextTemplateField { if (!keyPattern.test(field.fieldKey) || !field.label.trim() || !field.reason.trim() || !Number.isInteger(field.displayOrder)) throw new Error("context_field_invalid"); if (!field.options && ["single_choice", "multi_choice"].includes(field.valueType)) throw new Error("context_field_options_required"); if (field.options && new Set(field.options.map((item) => item.key)).size !== field.options.length) throw new Error("context_field_options_invalid"); if ((field.minimum !== undefined || field.maximum !== undefined) && (!Number.isFinite(field.minimum) || !Number.isFinite(field.maximum) || field.minimum! > field.maximum!)) throw new Error("context_field_range_invalid"); if (field.analysisRole !== undefined && !/^[a-z][a-z0-9_]{0,63}$/.test(field.analysisRole)) throw new Error("context_field_analysis_role_invalid"); if (field.analysisUsage !== undefined && !["condition","outcome","both","excluded"].includes(field.analysisUsage)) throw new Error("context_field_analysis_usage_invalid"); if (field.reconfirmationMode !== undefined && !["none","default","explicit"].includes(field.reconfirmationMode)) throw new Error("context_field_reconfirmation_mode_invalid"); if (field.reconfirmationIntervalDays !== undefined && field.reconfirmationIntervalDays !== null && (!Number.isInteger(field.reconfirmationIntervalDays) || field.reconfirmationIntervalDays < 1 || field.reconfirmationIntervalDays > 3650)) throw new Error("context_field_reconfirmation_interval_invalid"); if (field.reconfirmationMode === "none" && field.reconfirmationIntervalDays) throw new Error("context_field_reconfirmation_invalid"); return field; }
export function eligibleForExport(value: { sharing: Sharing; sensitivity: Sensitivity; userConfirmed: boolean }) { return value.userConfirmed && value.sharing !== "private" && value.sharing !== "never" && value.sensitivity !== "highly_sensitive"; }
export type DisclosureReason = "included" | "unconfirmed" | "retracted" | "private_or_never" | "highly_sensitive" | "purpose_not_allowed" | "invalid" | "secret_like";
export type DisclosureDecision = { included: boolean; reason: DisclosureReason };
export type DisclosureValue = { userConfirmed: boolean; lifecycleState?: "active" | "retracted"; sharing: Sharing; sensitivity: Sensitivity; purposeAllowed?: boolean; value?: unknown };
export function evaluateDisclosure(value: DisclosureValue): DisclosureDecision {
  if (!value.userConfirmed) return { included: false, reason: "unconfirmed" };
  if (value.lifecycleState === "retracted") return { included: false, reason: "retracted" };
  if (value.sharing === "private" || value.sharing === "never") return { included: false, reason: "private_or_never" };
  if (value.sensitivity === "highly_sensitive") return { included: false, reason: "highly_sensitive" };
  if (value.sharing === "purpose_only" && value.purposeAllowed !== true) return { included: false, reason: "purpose_not_allowed" };
  if (isSecretLike(value.value)) return { included: false, reason: "secret_like" };
  return { included: true, reason: "included" };
}
export function collectEligibleValues<T extends DisclosureValue>(values: T[]) {
  const included: T[] = [];
  const omitted = { unconfirmed: 0, retracted: 0, private_or_never: 0, highly_sensitive: 0, purpose_not_allowed: 0, invalid: 0, secret_like: 0 };
  for (const value of values) {
    let decision = evaluateDisclosure(value);
    if (decision.included && value.value === undefined) decision = { included: false, reason: "invalid" };
    if (decision.included) included.push(value);
    else if (decision.reason !== "included") omitted[decision.reason] += 1;
  }
  return { included, omitted };
}
export function buildOmissionManifest(omitted: Record<string, number>) { return Object.fromEntries(Object.entries(omitted).filter(([, count]) => count > 0)); }
export function validateContextValue(field: ContextTemplateField, value: unknown): void {
  if (isSecretLike(value)) throw new Error("secret_value_prohibited");
  if (field.valueType === "boolean" && typeof value !== "boolean") throw new Error("context_value_type_invalid");
  if (["integer", "duration_minutes"].includes(field.valueType) && (typeof value !== "number" || !Number.isInteger(value))) throw new Error("context_value_type_invalid");
  if (["number", "scale"].includes(field.valueType) && (typeof value !== "number" || !Number.isFinite(value))) throw new Error("context_value_type_invalid");
  if (["text", "long_text", "date", "datetime"].includes(field.valueType) && typeof value !== "string") throw new Error("context_value_type_invalid");
  if (field.valueType === "single_choice" && (typeof value !== "string" || !(field.options ?? []).some((item) => item.key === value))) throw new Error("context_value_choice_invalid");
  if (field.valueType === "multi_choice" && (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !(field.options ?? []).some((option) => option.key === item)))) throw new Error("context_value_choice_invalid");
  if ((field.valueType === "date" || field.valueType === "datetime") && typeof value === "string" && Number.isNaN(Date.parse(value))) throw new Error("context_value_date_invalid");
  if (typeof value === "number" && ((field.minimum !== undefined && value < field.minimum) || (field.maximum !== undefined && value > field.maximum))) throw new Error("context_value_range_invalid");
}
export function calculateReconfirmAfter(lastReconfirmedAt: string, intervalDays: number | null | undefined): string | null {
  if (intervalDays === null || intervalDays === undefined) return null;
  if (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 3650 || Number.isNaN(Date.parse(lastReconfirmedAt))) throw new Error("reconfirmation_interval_invalid");
  return new Date(Date.parse(lastReconfirmedAt) + intervalDays * 86400000).toISOString();
}
export function formatExport(fields: Array<{ label: string; value: unknown }>, format: "markdown" | "json" | "agents" | "chatgpt") { if (format === "json") return JSON.stringify(Object.fromEntries(fields.map((item) => [item.label, item.value])), null, 2); const lines = fields.map((item) => `- ${item.label}: ${typeof item.value === "string" ? item.value : JSON.stringify(item.value)}`); if (format === "agents") return `# User Context\n\n${lines.join("\n")}`; if (format === "chatgpt") return `Use the following user-approved context when it is relevant:\n${lines.join("\n")}`; return `# Personal Context\n\n${lines.join("\n")}`; }
