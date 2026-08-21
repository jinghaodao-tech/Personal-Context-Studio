import { writeFile } from "node:fs/promises";
import { join } from "node:path";

type SecretCase = { id: string; text: string; metadata: string; secret: boolean; family: string };
const positives: Array<[string, string, string]> = [
  ["github", "github token", "ghp_012345678901234567890123456789"],
  ["openai", "api_key", "sk-012345678901234567890123456789"],
  ["slack", "slack token", "xoxb-012345678901234567890123456789"],
  ["aws", "AWS_ACCESS_KEY_ID", "AKIA0123456789ABCDEF"],
  ["google", "google api key", "AIza0123456789012345678901234567890"],
  ["bearer", "Authorization", "Bearer abcdefghijklmnopqrstuvwxyz0123456789"],
  ["jwt", "access_token", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.signaturevalue123"],
  ["pem", "private_key", "-----BEGIN PRIVATE KEY-----\\nnot-a-real-key\\n-----END PRIVATE KEY-----"],
];
const cases: SecretCase[] = positives.map(([family, metadata, text], index) => ({ id: `positive_${index}`, family, metadata, text, secret: true }));
for (let index = 0; index < 24; index += 1) {
  cases.push({ id: `entropy_${index}`, family: "context_entropy", metadata: "client_secret", text: `aB${index}xY${index}!qR${index}#mN${index}%sT${index}^uV${index}&`, secret: true });
}
const negatives = [
  ["id", "record id", "123456789012345678901234"],
  ["uuid", "request id", "550e8400-e29b-41d4-a716-446655440000"],
  ["hash", "content hash", "0123456789abcdef0123456789abcdef0123456789abcdef"],
  ["code", "function", "const token = 'placeholder';"],
  ["path", "file path", "C:\\Users\\demo\\project\\src\\index.ts"],
  ["placeholder", "api_key", "YOUR_API_KEY_HERE"],
  ["email", "contact", "test@example.com"],
];
for (let index = 0; index < 8; index += 1) for (const [family, metadata, text] of negatives) cases.push({ id: `negative_${index}_${family}`, family, metadata, text, secret: false });
const output = join(process.cwd(), "tmp", "secret-evaluation.json");
await writeFile(output, `${JSON.stringify(cases, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ sampleCount: cases.length, positiveCount: cases.filter((item) => item.secret).length, output }, null, 2));
