import type { IncomingMessage, ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";

type Context = {
  db: DatabaseSync;
  send: (response: ServerResponse, status: number, value: unknown) => unknown;
  body: (request: IncomingMessage) => Promise<Record<string, unknown>>;
  text: (value: unknown) => string;
  now: () => string;
  newId: (prefix: string) => string;
  audit: (action: string, summary: unknown) => void;
};

type Preset = {
  name: string;
  description: string;
  fields: Array<{ key: string; label: string; type: string }>;
};

const PRESETS: Record<string, Preset> = {
  wellbeing: {
    name: "日々の調子",
    description: "気分、疲労、エネルギー、睡眠の変化を無理なく記録します。",
    fields: [
      { key: "mood", label: "気分", type: "scale" },
      { key: "fatigue", label: "疲労", type: "scale" },
      { key: "energy", label: "エネルギー", type: "scale" },
      { key: "sleep_quality", label: "睡眠の質", type: "scale" },
    ],
  },
  work: {
    name: "勉強・作業の傾向",
    description: "作業の開始、集中、完了しやすい条件を記録します。",
    fields: [
      { key: "task_clarity", label: "作業の明確さ", type: "scale" },
      { key: "start_delay", label: "開始までの時間", type: "duration_minutes" },
      { key: "focus", label: "集中", type: "scale" },
      { key: "completion", label: "完了度", type: "scale" },
      { key: "satisfaction", label: "満足度", type: "scale" },
    ],
  },
  self_understanding: {
    name: "MeTheoryで仮説を確かめる",
    description: "MeTheoryから届く仮説検証要求に使う基礎記録です。",
    fields: [
      { key: "mood", label: "気分", type: "scale" },
      { key: "fatigue", label: "疲労", type: "scale" },
      { key: "task_clarity", label: "作業の明確さ", type: "scale" },
      { key: "start_delay", label: "開始までの時間", type: "duration_minutes" },
    ],
  },
  free: {
    name: "自由記録",
    description: "形式を決めず、日記やメモを残します。",
    fields: [{ key: "note", label: "メモ", type: "long_text" }],
  },
};

function parse(value: unknown, fallback: unknown) {
  try { return value ? JSON.parse(String(value)) : fallback; } catch { return fallback; }
}

function ensurePreset(db: DatabaseSync, key: string, preset: Preset, timestamp: string, newId: (prefix: string) => string) {
  const purpose = db.prepare("SELECT id,name FROM context_sharing_purposes WHERE name IN (?,?) ORDER BY CASE WHEN name=? THEN 0 ELSE 1 END LIMIT 1").get(preset.name, key, preset.name) as { id: string; name: string } | undefined;
  const purposeId = purpose?.id ?? newId("purpose");
  if (!purpose) db.prepare("INSERT INTO context_sharing_purposes(id,name,description,created_at,updated_at) VALUES(?,?,?,?,?)").run(purposeId, preset.name, preset.description, timestamp, timestamp);
  else if (purpose.name === key) db.prepare("UPDATE context_sharing_purposes SET name=?,description=?,updated_at=? WHERE id=?").run(preset.name, preset.description, timestamp, purpose.id);

  let template = db.prepare("SELECT * FROM context_templates WHERE purpose=? AND status='active' ORDER BY version DESC LIMIT 1").get(key) as any;
  if (!template) {
    const templateId = newId("template");
    db.prepare("INSERT INTO context_templates(id,name,description,purpose,status,version,template_family_id,immutable,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)").run(templateId, preset.name, preset.description, key, "active", 1, templateId, 1, timestamp, timestamp);
    const insert = db.prepare("INSERT INTO context_template_fields(id,template_id,field_key,label,description,value_type,required,display_order,options_json,minimum_value,maximum_value,unit,analysis_role,analysis_role_confirmed,analysis_usage,analysis_merge_allowed,positive_value_keys_json,ordered_value_keys_json,numeric_mapping_json,reconfirmation_mode,reconfirmation_interval_days,sharing_default,sensitivity,reason) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    preset.fields.forEach((field, index) => insert.run(
      newId("field"), templateId, field.key, field.label, `${field.label}を記録します。`, field.type, 0, index + 1,
      "[]", field.type === "scale" ? 1 : null, field.type === "scale" ? 5 : null,
      field.type === "duration_minutes" ? "分" : null, null, 0, "excluded", 0, "[]", "[]", "{}", "none", null,
      "purpose_only", "normal", "初回プリセット",
    ));
    template = db.prepare("SELECT * FROM context_templates WHERE id=?").get(templateId);
  }

  const profileName = `${preset.name}用データ`;
  let profile = db.prepare("SELECT id FROM context_profiles WHERE name=? AND is_active=1").get(profileName) as { id: string } | undefined;
  if (!profile) {
    const profileId = newId("profile");
    db.prepare("INSERT INTO context_profiles(id,name,target,purpose_id,detail_level,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run(profileId, profileName, "metheory", purposeId, "standard", timestamp, timestamp);
    profile = { id: profileId };
  }
  const fields = db.prepare("SELECT field_key FROM context_template_fields WHERE template_id=? ORDER BY display_order").all(template.id) as Array<{ field_key: string }>;
  for (const field of fields) db.prepare("INSERT OR IGNORE INTO context_profile_fields(profile_id,template_id,field_key) VALUES(?,?,?)").run(profile.id, template.id, field.field_key);
  return { purposeId, templateId: template.id, profileId: profile.id, fieldKeys: fields.map((field) => field.field_key) };
}

export async function handleExperienceRoute(request: IncomingMessage, response: ServerResponse, url: URL, context: Context): Promise<boolean> {
  const { db, send, body, text, now, newId, audit } = context;
  if (request.method === "GET" && url.pathname === "/v1/experience/onboarding") {
    const state = db.prepare("SELECT * FROM pcs_onboarding_state WHERE id='local'").get() as any;
    const hasExistingData = Boolean(db.prepare("SELECT 1 FROM context_entries LIMIT 1").get() || db.prepare("SELECT 1 FROM context_documents LIMIT 1").get());
    send(response, 200, { state: { ...state, quickFields: parse(state?.quick_fields_json, []), dashboardPreferences: parse(state?.dashboard_preferences_json, {}) }, hasExistingData });
    return true;
  }
  if (request.method === "POST" && url.pathname === "/v1/experience/onboarding") {
    const input = await body(request); const key = text(input.purposeKey); const preset = PRESETS[key];
    if (!preset) { send(response, 400, { error: "onboarding_purpose_invalid" }); return true; }
    const timestamp = now(); db.exec("BEGIN IMMEDIATE");
    try {
      const result = ensurePreset(db, key, preset, timestamp, newId);
      db.prepare("UPDATE pcs_onboarding_state SET selected_purpose=?,completed=1,skipped=0,preset_version='v1',quick_fields_json=?,updated_at=? WHERE id='local'").run(key, JSON.stringify(result.fieldKeys), timestamp);
      db.exec("COMMIT"); audit("complete_onboarding", { purposeKey: key }); send(response, 200, { completed: true, ...result });
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    return true;
  }
  if (request.method === "POST" && url.pathname === "/v1/experience/onboarding/skip") {
    db.prepare("UPDATE pcs_onboarding_state SET skipped=1,updated_at=? WHERE id='local'").run(now()); send(response, 200, { skipped: true }); return true;
  }
  if (request.method === "GET" && url.pathname === "/v1/experience/home") {
    const day = `${now().slice(0, 10)}%`;
    const count = (sql: string, ...args: unknown[]) => Number((db.prepare(sql).get(...args as any[]) as any)?.count ?? 0);
    send(response, 200, {
      todayCount: count("SELECT COUNT(*) AS count FROM context_entries WHERE created_at LIKE ? AND status='active'", day),
      pendingReviews: count("SELECT COUNT(*) AS count FROM context_values WHERE user_confirmed=0 AND reviewed_at IS NULL"),
      reconfirmationsDue: count("SELECT COUNT(*) AS count FROM context_values WHERE user_confirmed=1 AND reconfirm_after IS NOT NULL AND reconfirm_after<=?", now()),
      integrationRequests: count("SELECT COUNT(*) AS count FROM integration_template_requests WHERE status IN('pending_user_review','partially_matched','submitted')"),
      activeTemplates: count("SELECT COUNT(*) AS count FROM context_templates WHERE status='active'"),
      shareableProfiles: count("SELECT COUNT(*) AS count FROM context_profiles WHERE is_active=1"),
      metheory: { available: false, message: "MeTheoryの状態を取得できないため、PCS内の記録状況を表示しています。" },
    });
    return true;
  }
  if (request.method === "POST" && url.pathname === "/v1/experience/review-classifications") {
    const input = await body(request); const valueId = text(input.valueId); const classification = text(input.classification); const confidence = Number(input.confidence);
    const reasons = Array.isArray(input.reasons) ? input.reasons.filter((reason): reason is string => typeof reason === "string" && /^[a-z0-9_:-]{1,80}$/i.test(reason)).slice(0, 10) : [];
    const value = db.prepare("SELECT id,sensitivity FROM context_values WHERE id=? AND user_confirmed=0 AND reviewed_at IS NULL").get(valueId) as { id: string; sensitivity: string } | undefined;
    if (!value || !["high_confidence", "needs_review", "sensitive_or_conflict"].includes(classification) || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) { send(response, 400, { error: "review_classification_invalid" }); return true; }
    const conflict = (db.prepare("SELECT value_ids_json FROM context_conflicts WHERE status='unresolved'").all() as Array<{ value_ids_json: string }>).some((row) => (parse(row.value_ids_json, []) as unknown[]).includes(valueId));
    if (classification === "high_confidence" && (confidence < 0.9 || reasons.length === 0 || value.sensitivity !== "normal" || conflict)) { send(response, 409, { error: "review_high_confidence_not_allowed" }); return true; }
    db.prepare("INSERT INTO pcs_review_classifications(value_id,classification,confidence,reason_json,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(value_id) DO UPDATE SET classification=excluded.classification,confidence=excluded.confidence,reason_json=excluded.reason_json,updated_at=excluded.updated_at").run(valueId, classification, confidence, JSON.stringify(reasons), now());
    audit("classify_review_value", { valueId, classification }); send(response, 200, { valueId, classification, confidence }); return true;
  }
  if (request.method === "GET" && url.pathname === "/v1/experience/review-summary") {
    const rows = db.prepare("SELECT v.id,v.entry_id,v.field_key,v.value_json,v.source,v.sharing,v.sensitivity,v.recorded_at,v.updated_at,c.classification AS stored_classification,c.confidence,c.reason_json FROM context_values v LEFT JOIN pcs_review_classifications c ON c.value_id=v.id WHERE v.user_confirmed=0 AND v.reviewed_at IS NULL ORDER BY v.updated_at DESC").all() as any[];
    const conflicts = new Set((db.prepare("SELECT value_ids_json FROM context_conflicts WHERE status='unresolved'").all() as any[]).flatMap((row) => parse(row.value_ids_json, [])));
    const items = rows.map((row) => {
      const forcedSensitive = row.sensitivity !== "normal" || conflicts.has(row.id);
      const classification = forcedSensitive ? "sensitive_or_conflict" : row.stored_classification === "high_confidence" && Number(row.confidence) >= 0.9 ? "high_confidence" : "needs_review";
      return { ...row, classification, confidence: row.confidence ?? null, reasons: parse(row.reason_json, []), hasConflict: conflicts.has(row.id) };
    });
    send(response, 200, { items, counts: {
      highConfidence: items.filter((item) => item.classification === "high_confidence").length,
      needsReview: items.filter((item) => item.classification === "needs_review").length,
      sensitiveOrConflict: items.filter((item) => item.classification === "sensitive_or_conflict").length,
    } });
    return true;
  }
  if (request.method === "GET" && url.pathname === "/v1/experience/field-catalog") {
    send(response, 200, { items: db.prepare("SELECT f.field_key,f.label,f.description,f.value_type,f.minimum_value,f.maximum_value,f.unit,f.analysis_role,f.analysis_role_confirmed,f.analysis_usage,f.analysis_merge_allowed,f.sharing_default,f.sensitivity,t.id AS template_id,t.name AS template_name,t.purpose,t.status,t.version FROM context_template_fields f JOIN context_templates t ON t.id=f.template_id ORDER BY COALESCE(f.analysis_role,f.field_key),t.name,f.display_order").all() }); return true;
  }
  return false;
}
