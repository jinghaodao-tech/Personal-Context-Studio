export type GlinerEntity = {
  text?: string;
  label?: string;
  score?: number;
  start?: number;
  end?: number;
};

const sensitiveLabels = new Set([
  "health", "personal health", "medical condition", "income", "financial information",
  "religion", "religious belief", "generic religious belief", "sexual orientation", "generic sexual orientation", "person", "person name",
  "third-party personal health", "third-party income", "third-party financial information", "third-party religious belief", "third-party sexual orientation", "generic personal health", "generic income", "generic financial information",
  "email", "email address", "phone", "phone number", "address", "secret", "api key",
  "access token", "private key", "family member", "third party",
]);

function localUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname) ? url : null;
  } catch { return null; }
}

export function glinerFindingIsSensitive(entity: GlinerEntity, threshold = 0.55): boolean {
  if (typeof entity.label !== "string" || !sensitiveLabels.has(entity.label.toLocaleLowerCase()) || Number(entity.score ?? 0) < threshold) return false;
  const label = entity.label.toLocaleLowerCase();
  const text = entity.text ?? "";
  if (label.includes("email") && !/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/u.test(text)) return false;
  if (label.includes("phone") && (text.match(/\d/g)?.length ?? 0) < 10) return false;
  if (label === "address" && !/(?:〒\s*\d{3}[-ー]?\d{4}|都|道|府|県|市|区|町|村|丁目)/u.test(text)) return false;
  if (label === "person name") {
    // Japanese names can be longer than a simple surname+given-name pair.
    // Length alone is insufficient, so reject particles and sentence-like
    // cue words while allowing up to seven Japanese characters.
    if (text.length < 2 || text.length > 7 || !/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}・]+$/u.test(text)) return false;
    if (/[をにはがでとへやも]/u.test(text) || /(状態|確認|情報|記録|内容|について|する|した|して)/u.test(text)) return false;
  }
  return true;
}

export async function analyzeWithGliner(text: string): Promise<{ available: boolean; entities: GlinerEntity[] }> {
  const baseUrl = process.env.PCS_GLINER_URL ? localUrl(process.env.PCS_GLINER_URL) : null;
  if (!baseUrl || !text) return { available: false, entities: [] };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.PCS_GLINER_TIMEOUT_MS ?? 3000));
  try {
    const response = await fetch(new URL("extract", baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text,
        // DataSign/gliner-ja-pii-v1's trained label vocabulary. Semantic
        // categories (health/income/etc.) remain handled by the local
        // embedding taxonomy layer.
        labels: ["person name", "address", "secret"],
      }),
      signal: controller.signal,
    });
    if (!response.ok) return { available: false, entities: [] };
    const payload = await response.json() as { entities?: unknown };
    return { available: true, entities: Array.isArray(payload.entities) ? payload.entities as GlinerEntity[] : [] };
  } catch { return { available: false, entities: [] }; }
  finally { clearTimeout(timeout); }
}
