const detectorVersion = "non-llm-layered-v2";
// Legal special-care categories are the floor; product policy also covers mood,
// finances and sexual orientation. Keep this list deterministic and auditable.
const keywordPattern = /(?:\b(?:race|ethnic|creed|social.?status|medical|criminal|victim|disab|health.?check|juvenile|mental|mood|anger|stress|fatigue|energy|sleep|heart.?rate|blood.?pressure|temperature|weight|menstru|reproductive|sexual.?orientation|income|financial|symptom|headache|palpitation|medication|name|email|phone|address|contact)\b)|人種|信条|宗教|社会的身分|病歴|診療|犯罪|前科|被害|障害|健診|健康診断|少年|精神|気分|怒り|ストレス|疲労|エネルギー|眠|睡眠|心拍|血圧|体温|体重|月経|妊娠|性的指向|収入|金融|症状|頭痛|動悸|薬|治療|氏名|姓名|メール|電話|住所/iu;
const piiPattern = /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})|(?:\+?\d[\d\s().-]{7,}\d)|(?:〒?\d{3}-?\d{4})/iu;
const exemplars = [
  "苛立ちの程度", "感情の落ち込み", "家計のゆとり", "暮らしの経済状況", "恋愛対象の傾向",
  "昨夜の休息", "疲れやすさ", "体調の変化", "血圧の状態", "健康診断の結果",
  "薬の服用", "名前や連絡先", "メールアドレス", "電話番号", "住所情報"
];
function trigrams(value: string) { const normalized = `^${value.toLowerCase().replace(/\s+/g, "")} $`; return new Set(Array.from({ length: Math.max(0, normalized.length - 2) }, (_, i) => normalized.slice(i, i + 3))); }
function semanticSimilarity(value: string) { const sources = value.split(/\s+/).filter(Boolean).map(trigrams); return exemplars.some((example) => { const target = trigrams(example); return sources.some((source) => { const intersection = [...source].filter((item) => target.has(item)).length; return intersection >= 2 && intersection / Math.max(1, target.size) >= 0.2; }); }); }
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
