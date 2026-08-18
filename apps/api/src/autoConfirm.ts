const detectorVersion = "non-llm-layered-v2";
// Legal special-care categories are the floor; product policy also covers mood,
// finances and sexual orientation. Keep this list deterministic and auditable.
const keywordPattern = /race|人種|ethnic|creed|信条|宗教|social.?status|社会的身分|medical|病歴|診療|criminal|犯罪|前科|被害|victim|disab|障害|health.?check|健診|健康診断|juvenile|少年|mental|精神|mood|気分|anger|怒り|stress|ストレス|fatigue|疲労|energy|エネルギー|sleep|眠|睡眠|heart.?rate|心拍|blood.?pressure|血圧|temperature|体温|weight|体重|menstru|月経|妊娠|reproductive|性的指向|sexual.?orientation|income|収入|financial|金融|symptom|症状|headache|頭痛|palpitation|動悸|medication|薬|治療|name|氏名|姓名|email|メール|phone|電話|address|住所|contact/i;
const piiPattern = /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})|(?:\+?\d[\d\s().-]{7,}\d)|(?:〒?\d{3}-?\d{4})/iu;
const exemplars = ["怒り", "収入", "性的指向", "病歴", "氏名", "メールアドレス", "住所", "電話番号"];
function trigrams(value: string) { const normalized = value.toLowerCase().replace(/\s+/g, ""); return new Set(Array.from({ length: Math.max(0, normalized.length - 2) }, (_, i) => normalized.slice(i, i + 3))); }
function semanticSimilarity(value: string) { const source = trigrams(value); return exemplars.some((example) => { const target = trigrams(example); const intersection = [...source].filter((item) => target.has(item)).length; return intersection >= 2 && intersection / Math.max(1, target.size) >= 0.5; }); }
export function autoConfirmClassification(fieldKey: string, label: string, description = "", value?: unknown) {
  const metadata = `${fieldKey} ${label} ${description}`;
  const valueText = typeof value === "string" ? value : "";
  const keywordFlagged = keywordPattern.test(metadata);
  const semanticFlagged = semanticSimilarity(metadata);
  const piiFlagged = piiPattern.test(valueText);
  return { flagged: keywordFlagged || semanticFlagged || piiFlagged, detectorVersion, layers: { keyword: keywordFlagged, semantic: semanticFlagged, valuePii: piiFlagged } };
}
export function autoConfirmAllowed(input: { enabled: boolean; sensitivity: string; detectorFlagged: boolean; elevatedConsent: boolean }) {
  if (!input.enabled) return { ok: true };
  if (input.sensitivity !== "normal") return { ok: false, error: "auto_confirm_requires_normal_sensitivity" };
  if (input.detectorFlagged && !input.elevatedConsent) return { ok: false, error: "auto_confirm_elevated_consent_required" };
  return { ok: true };
}
