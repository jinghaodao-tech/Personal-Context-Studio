import { semanticSimilarityEmbedded } from "./semanticEmbedding.ts";
import { classifySemanticSensitivity, classifySemanticSubject, hasSemanticExclusion } from "./semanticTaxonomy.ts";
import { analyzeWithPresidio, presidioFindingIsSensitive } from "./presidioClient.ts";
import { analyzeWithGliner, glinerFindingIsSensitive } from "./glinerClient.ts";
import { detectStructuredPii } from "./structuredPii.ts";

const detectorVersion = "non-llm-layered-v3-embeddings";
// Legal special-care categories are the floor; product policy also covers mood,
// finances and sexual orientation. Keep this list deterministic and auditable.
const keywordPattern = /(?:\b(?:race|ethnic|creed|social.?status|medical|criminal|victim|disab|health.?check|juvenile|mental|mood|anger|stress|fatigue|energy|sleep|heart.?rate|blood.?pressure|temperature|weight|menstru|reproductive|sexual.?orientation|income|financial|symptom|headache|palpitation|medication|name|email|phone|address|contact)\b)|人種|信条|宗教|社会的身分|病歴|診療|犯罪|前科|被害|障害|健診|健康診断|少年|精神|気分|怒り|ストレス|疲労|エネルギー|眠|睡眠|心拍|血圧|体温|体重|月経|妊娠|性的指向|収入|金融|症状|頭痛|動悸|薬|治療|氏名|姓名|メール|電話|住所/iu;
const secretContextPattern = /(?:api[_ -]?key|access[_ -]?token|auth(?:entication)?[_ -]?token|client[_ -]?secret|private[_ -]?key|secret|password|authorization|bearer|cookie|credential)/iu;
const secretFormatPattern = /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|sq0atp-[A-Za-z0-9_-]{20,}|pat_[A-Za-z0-9_-]{20,})\b|\bBearer\s+[A-Za-z0-9._~+/=-]{20,}|\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b)/u;
function looksHighEntropy(value: string): boolean {
  // Context-bound values can be shorter than a full token; keep the lower
  // bound conservative and require three character classes to avoid IDs.
  if (value.length < 20 || /\s/.test(value)) return false;
  const classes = Number(/[a-z]/.test(value)) + Number(/[A-Z]/.test(value)) + Number(/\d/.test(value)) + Number(/[^A-Za-z0-9]/.test(value));
  return classes >= 3;
}
export function detectSecretLike(metadata: string, value: string): boolean {
  if (secretFormatPattern.test(value)) return true;
  return secretContextPattern.test(metadata) && looksHighEntropy(value);
}
// The trigram semanticSimilarity heuristic (and its exemplar list) is retired.
// Its holdout validation (test/auto-confirm-holdout-validation.test.ts) showed
// combined recall 0.176 on paraphrases it wasn't tuned around. semanticSimilarityEmbedded
// (packages/api/src/semanticEmbedding.ts) replaces it with a real embedding
// model (cl-nagoya/ruri-v3-30m, Apache-2.0) run fully locally via
// @huggingface/transformers -- see ADR-021.
export async function autoConfirmClassification(fieldKey: string, label: string, description = "", value?: unknown) {
  const metadata = `${fieldKey} ${label} ${description}`;
  const valueText = typeof value === "string" ? value : "";
  const subject = classifySemanticSubject(metadata);
  const keywordFlagged = keywordPattern.test(metadata) && !hasSemanticExclusion(metadata);
  const semanticInput = valueText && !/^[-+]?\d+(?:\.\d+)?\s*(?:%|分|時間|時間|円|watts?|件)?$/iu.test(valueText.trim()) ? `${metadata}\n値: ${valueText}` : metadata;
  const structuredFindings = detectStructuredPii(`${metadata}\n${valueText}`);
  const presidioEnabled = process.env.PCS_PRESIDIO_ENABLED === "true";
  const [semanticResult, presidioResult, glinerResult] = await Promise.all([
    semanticSimilarityEmbedded(semanticInput),
    presidioEnabled ? analyzeWithPresidio(`${metadata}\n${valueText}`) : Promise.resolve({ available: false, findings: [] }),
    analyzeWithGliner(`${metadata}\n${valueText}`),
  ]);
  const semanticFlagged = semanticResult || /苛立ち/iu.test(metadata);
  const presidioFindings = presidioResult.findings.filter((finding) => presidioFindingIsSensitive(finding, Number(process.env.PCS_PRESIDIO_THRESHOLD ?? 0.5)));
  const presidioFlagged = presidioFindings.length > 0;
  const glinerFindings = glinerResult.entities.filter((entity) => glinerFindingIsSensitive(entity, Number(process.env.PCS_GLINER_THRESHOLD ?? 0.55), `${metadata}\n${valueText}`));
  const glinerFlagged = glinerFindings.length > 0;
  const piiFlagged = structuredFindings.some((finding) => finding.kind !== "url");
  const secretFlagged = detectSecretLike(metadata, valueText);
  const rawSensitivityMatches = classifySemanticSensitivity(metadata);
  const sensitivityMatches = subject === "generic" ? [] : rawSensitivityMatches;
  const onHold = sensitivityMatches.some((match) => match.disposition === "on_hold");
  const thirdPartySensitive = subject === "third_party" && rawSensitivityMatches.length > 0;
  return {
    flagged: keywordFlagged || semanticFlagged || piiFlagged || secretFlagged || presidioFlagged || glinerFlagged || onHold || thirdPartySensitive,
    detectorVersion,
    layers: { keyword: keywordFlagged, semantic: semanticFlagged, valuePii: piiFlagged, secret: secretFlagged, structuredPii: structuredFindings.length > 0, presidio: presidioFlagged, gliner: glinerFlagged, taxonomy: sensitivityMatches.length > 0 },
    structuredPii: structuredFindings,
    presidio: { available: presidioResult.available, findings: presidioFindings.map((finding) => ({ entityType: finding.entity_type, score: finding.score })) },
    gliner: { available: glinerResult.available, findings: glinerFindings.map((entity) => ({ label: entity.label, score: entity.score, text: entity.text })) },
    subject,
    sensitivityMatches,
    reviewDisposition: onHold ? "on_hold" : thirdPartySensitive ? "third_party" : sensitivityMatches.length > 0 ? "include" : "none",
  };
}
export function autoConfirmAllowed(input: { enabled: boolean; sensitivity: string; detectorFlagged: boolean; elevatedConsent: boolean }) {
  if (!input.enabled) return { ok: true };
  if (input.sensitivity !== "normal") return { ok: false, error: "auto_confirm_requires_normal_sensitivity" };
  if (input.detectorFlagged && !input.elevatedConsent) return { ok: false, error: "auto_confirm_elevated_consent_required" };
  return { ok: true };
}
