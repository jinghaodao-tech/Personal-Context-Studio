import type { DatabaseSync } from "node:sqlite";
import { parseDashboardOverview, type DashboardOverview, type DashboardValue } from "../dashboard/contracts.ts";

type JsonDecoder = (row: { value_json: string }) => string;
type DashboardValueRow = Omit<DashboardValue, "purpose_ids">;

export function readDashboardOverview(db: DatabaseSync): DashboardOverview {
  const count = (sql: string) => Number((db.prepare(sql).get() as { count: number }).count);
  return parseDashboardOverview({
    confirmedValues: count("SELECT COUNT(*) AS count FROM context_values v JOIN context_entries e ON e.id=v.entry_id WHERE e.status='active' AND v.user_confirmed=1 AND v.lifecycle_state='active'"),
    pendingValues: count("SELECT COUNT(*) AS count FROM context_values v JOIN context_entries e ON e.id=v.entry_id WHERE e.status='active' AND v.user_confirmed=0"),
    shareableValues: count("SELECT COUNT(*) AS count FROM context_values v JOIN context_entries e ON e.id=v.entry_id WHERE e.status='active' AND v.user_confirmed=1 AND v.lifecycle_state='active' AND v.sharing IN ('always','purpose_only') AND v.sensitivity!='highly_sensitive'"),
    retractedValues: count("SELECT COUNT(*) AS count FROM context_values v JOIN context_entries e ON e.id=v.entry_id WHERE e.status='active' AND v.lifecycle_state='retracted'")
  });
}

export function readDashboardValues(db: DatabaseSync, decode: JsonDecoder) {
  return (db.prepare("SELECT v.id AS value_id,v.entry_id,v.field_key,v.value_json,v.user_confirmed,v.sharing,v.sensitivity,v.lifecycle_state,v.current_revision_id,v.recorded_at,v.updated_at,e.template_id,t.name AS template_name,f.label FROM context_values v JOIN context_entries e ON e.id=v.entry_id JOIN context_templates t ON t.id=e.template_id JOIN context_template_fields f ON f.template_id=e.template_id AND f.field_key=v.field_key WHERE e.status='active' ORDER BY v.updated_at DESC").all() as DashboardValueRow[]).map((value) => ({
    ...value,
    value_json: decode(value),
    purpose_ids: (db.prepare("SELECT purpose_id FROM context_value_purposes WHERE value_id=? ORDER BY purpose_id").all(value.value_id) as Array<{ purpose_id: string }>).map((item) => item.purpose_id)
  }));
}
