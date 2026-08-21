export type PresidioFinding = { entity_type?: string; score?: number; start?: number; end?: number };

const sensitiveEntityTypes = new Set(["PERSON", "EMAIL_ADDRESS", "PHONE_NUMBER", "LOCATION", "STREET_ADDRESS", "MEDICAL_LICENSE", "MEDICAL_RECORD_NUMBER", "US_SSN", "CREDIT_CARD", "IBAN_CODE", "IP_ADDRESS", "URL", "CRYPTO", "API_KEY", "PASSWORD", "HEALTH", "RELIGION", "SEXUAL_ORIENTATION", "POLITICAL_AFFILIATION"]);

export function presidioFindingIsSensitive(finding: PresidioFinding, threshold = 0.5): boolean {
  return typeof finding.entity_type === "string" && sensitiveEntityTypes.has(finding.entity_type.toUpperCase()) && Number(finding.score ?? 0) >= threshold;
}

function localPresidioUrl(raw: string): URL | null {
  try { const url = new URL(raw); return ["localhost", "127.0.0.1", "::1"].includes(url.hostname) ? url : null; } catch { return null; }
}

export async function analyzeWithPresidio(text: string): Promise<{ available: boolean; findings: PresidioFinding[] }> {
  const baseUrl = process.env.PCS_PRESIDIO_URL ? localPresidioUrl(process.env.PCS_PRESIDIO_URL) : null;
  if (!baseUrl || !text) return { available: false, findings: [] };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.PCS_PRESIDIO_TIMEOUT_MS ?? 3000));
  try {
    const response = await fetch(new URL("analyze", baseUrl), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, language: process.env.PCS_PRESIDIO_LANGUAGE ?? "ja" }), signal: controller.signal });
    if (!response.ok) return { available: false, findings: [] };
    const payload = await response.json() as unknown;
    return { available: true, findings: Array.isArray(payload) ? payload as PresidioFinding[] : [] };
  } catch { return { available: false, findings: [] }; } finally { clearTimeout(timeout); }
}
