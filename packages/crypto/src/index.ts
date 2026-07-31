import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const prefix = "pcs:v1:";
function keyFromValue(value: string | undefined): Buffer | undefined {
  if (!value?.trim()) return undefined;
  const trimmed = value.trim();
  const key = /^[0-9a-f]{64}$/i.test(trimmed) ? Buffer.from(trimmed, "hex") : Buffer.from(trimmed, "base64");
  if (key.length !== 32) throw new Error("encryption_key_invalid");
  return key;
}
export function encryptionKey(value = process.env.PCS_ENCRYPTION_KEY): Buffer | undefined { return keyFromValue(value); }
export function encryptText(value: string, key = encryptionKey()): string {
  if (!key) throw new Error("encryption_key_required");
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return prefix + [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}
export function decryptText(value: string, key = encryptionKey()): string {
  if (!value.startsWith(prefix)) return value;
  if (!key) throw new Error("encryption_key_required");
  const parts = value.slice(prefix.length).split(".");
  if (parts.length !== 3) throw new Error("encrypted_value_invalid");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parts[0], "base64url"));
  decipher.setAuthTag(Buffer.from(parts[1], "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(parts[2], "base64url")), decipher.final()]).toString("utf8");
}
export function encryptFileBytes(value: Buffer, key = encryptionKey()): Buffer { return Buffer.from(encryptText(value.toString("base64"), key), "utf8"); }
export function decryptFileBytes(value: Buffer, key = encryptionKey()): Buffer { return Buffer.from(decryptText(value.toString("utf8"), key), "base64"); }
export function encryptionFingerprint(key = encryptionKey()): string | null { return key ? createHash("sha256").update(key).digest("hex") : null; }
