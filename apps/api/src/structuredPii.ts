export type StructuredPiiKind = "email" | "phone" | "postal_code" | "url" | "date" | "secret";

export type StructuredPiiFinding = {
  kind: StructuredPiiKind;
  text: string;
  reason: string;
};

const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const phonePattern = /(?<!\d)(?:\+81[-\s]?(?:0[-\s]?)?|0)(?:\d[-\s()]?){8,12}\d(?!\d)/gu;
// Require either the postal marker or a separator; a bare seven-digit number
// is too often an ordinary count or identifier.
const postalPattern = /(?:〒\s*\d{3}[-ー]?\d{4}|\b\d{3}[-ー]\d{4}\b)/gu;
const urlPattern = /\bhttps?:\/\/[^\s<>"']+/giu;
const datePattern = /(?:(?:19|20)\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2}日?|令和|平成|昭和)\s*\d{1,2}(?:年\d{1,2}月\d{1,2}日?|[-/.]\d{1,2}[-/.]\d{1,2})/gu;
const secretPattern = /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})\b|\bBearer\s+[A-Za-z0-9._~+/=-]{20,}|\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/gu;

function collect(text: string, pattern: RegExp, kind: StructuredPiiKind, reason: string, out: StructuredPiiFinding[]) {
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    if (match[0]) out.push({ kind, text: match[0], reason });
  }
}

export function detectStructuredPii(text: string): StructuredPiiFinding[] {
  const out: StructuredPiiFinding[] = [];
  collect(text, emailPattern, "email", "email_format", out);
  collect(text, phonePattern, "phone", "phone_format", out);
  collect(text, postalPattern, "postal_code", "postal_code_format", out);
  collect(text, urlPattern, "url", "url_format", out);
  collect(text, datePattern, "date", "date_format", out);
  collect(text, secretPattern, "secret", "known_secret_format", out);
  return out;
}
