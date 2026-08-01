export type DashboardOverview = {
  confirmedValues: number;
  pendingValues: number;
  shareableValues: number;
  retractedValues: number;
};

export type DashboardValue = {
  value_id: string;
  entry_id: string;
  field_key: string;
  value_json: string;
  user_confirmed: number;
  sharing: string;
  sensitivity: string;
  lifecycle_state: string;
  current_revision_id: string | null;
  recorded_at: string;
  updated_at: string;
  template_id: string;
  template_name: string;
  label: string;
  purpose_ids: string[];
};

function nonNegativeInteger(value: unknown, key: string) {
  if (!Number.isInteger(value) || Number(value) < 0) throw new Error(`dashboard_${key}_invalid`);
  return Number(value);
}

export function parseDashboardOverview(value: unknown): DashboardOverview {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("dashboard_overview_invalid");
  const item = value as Record<string, unknown>;
  return {
    confirmedValues: nonNegativeInteger(item.confirmedValues, "confirmed_values"),
    pendingValues: nonNegativeInteger(item.pendingValues, "pending_values"),
    shareableValues: nonNegativeInteger(item.shareableValues, "shareable_values"),
    retractedValues: nonNegativeInteger(item.retractedValues, "retracted_values")
  };
}
