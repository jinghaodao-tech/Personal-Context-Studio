import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

type SearchItem = { title: string };
type QueryCase = { query: string; relevantTitles: string[] };

const queries: QueryCase[] = [
  { query: "focus", relevantTitles: ["Focus planning"] },
  { query: "privacy", relevantTitles: ["Privacy consent"] },
  { query: "break", relevantTitles: ["Break recovery"] },
  { query: "review", relevantTitles: ["Review checklist"] },
];

function reciprocalRank(items: SearchItem[], relevantTitles: string[]) {
  const index = items.findIndex((item) => relevantTitles.includes(item.title));
  return index < 0 ? 0 : 1 / (index + 1);
}

test("PCS hybrid document search meets the measured quality floor", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pcs-search-quality-"));
  const notes = join(directory, "notes");
  mkdirSync(join(notes, "quality"), { recursive: true });
  const documents = [
    ["focus.md", "Focus planning", "focus blocks and deliberate planning improve deep work."],
    ["privacy.md", "Privacy consent", "privacy consent controls sharing and external access."],
    ["break.md", "Break recovery", "break recovery protects attention after deep work."],
    ["review.md", "Review checklist", "review checklist records evidence and decisions."],
    ["noise.md", "General notes", "daily notes contain context without the target concepts."],
  ];
  for (const [file, title, body] of documents) writeFileSync(join(notes, "quality", file), `---\ntitle: ${title}\nrecorded_at: 2026-08-01T09:00:00.000Z\n---\n${body}\n`, "utf8");
  const port = 18900 + Math.floor(Math.random() * 100);
  const child = spawn(process.execPath, ["--experimental-strip-types", "apps/api/src/server.ts"], { env: { ...process.env, PCS_PORT: String(port), PCS_DB: join(directory, "context.sqlite3"), PCS_NOTES_DIR: notes }, stdio: "ignore" });
  const api = async (path: string, value?: unknown) => { const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: value ? "POST" : "GET", headers: value ? { "content-type": "application/json" } : undefined, body: value ? JSON.stringify(value) : undefined }); return { response, body: await response.json() as any }; };
  try {
    for (let attempt = 0; attempt < 40; attempt += 1) { try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break; } catch { /* wait */ } await new Promise((resolve) => setTimeout(resolve, 75)); }
    for (const file of documents) assert.equal((await api("/v1/documents", { filePath: `quality/${file[0]}` })).response.status, 201);
    const scores = [];
    for (const query of queries) {
      const result = await api("/v1/documents/search", { query: query.query, mode: "hybrid", limit: 5 });
      assert.equal(result.response.status, 200);
      const items = result.body.items as SearchItem[];
      scores.push({ pAt1: query.relevantTitles.includes(items[0]?.title) ? 1 : 0, rr: reciprocalRank(items, query.relevantTitles) });
    }
    const precisionAt1 = scores.reduce((sum, score) => sum + score.pAt1, 0) / scores.length;
    const mrr = scores.reduce((sum, score) => sum + score.rr, 0) / scores.length;
    assert.ok(precisionAt1 >= 0.75, `P@1=${precisionAt1.toFixed(3)}`);
    assert.ok(mrr >= 0.875, `MRR=${mrr.toFixed(3)}`);
  } finally { child.kill(); await new Promise((resolve) => setTimeout(resolve, 100)); rmSync(directory, { recursive: true, force: true }); }
});
