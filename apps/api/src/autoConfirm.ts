const detectorVersion = "physiological-personal-v1";
const flagged = /sleep|眠|睡眠|fatigue|疲労|energy|エネルギー|mood|気分|heart.?rate|心拍|blood.?pressure|血圧|temperature|体温|weight|体重|menstru|月経|妊娠|reproductive|symptom|症状|headache|頭痛|palpitation|動悸|medication|薬|治療|name|氏名|姓名|email|メール|phone|電話|address|住所|contact/i;
export function autoConfirmClassification(fieldKey: string, label: string, description = "") { return { flagged: flagged.test(`${fieldKey} ${label} ${description}`), detectorVersion }; }
export function autoConfirmAllowed(input: { enabled: boolean; sensitivity: string; detectorFlagged: boolean; elevatedConsent: boolean }) {
  if (!input.enabled) return { ok: true };
  if (input.sensitivity !== "normal") return { ok: false, error: "auto_confirm_requires_normal_sensitivity" };
  if (input.detectorFlagged && !input.elevatedConsent) return { ok: false, error: "auto_confirm_elevated_consent_required" };
  return { ok: true };
}
