import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, readdirSync, statSync } from "node:fs";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";

export type MarkdownSnapshot = {
  absolutePath: string;
  relativePath: string;
  title: string;
  content: string;
  contentHash: string;
  recordedAt: string;
  sourceUpdatedAt: string;
  size: number;
};

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function frontmatterValue(content: string, key: string): string | undefined {
  if (!content.startsWith("---")) return undefined;
  const end = content.indexOf("\n---", 3);
  if (end < 0) return undefined;
  for (const line of content.slice(3, end).split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*?)\s*$/);
    if (match?.[1] === key) return match[2].replace(/^['"]|['"]$/g, "");
  }
  return undefined;
}

function validDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

export function resolveMarkdownPath(workspaceRoot: string, inputPath: string): string {
  const root = realpathSync(resolve(workspaceRoot));
  const requested = resolve(root, inputPath);
  if (!inside(root, requested) || extname(requested).toLowerCase() !== ".md" || !existsSync(requested)) throw new Error("document_path_invalid");
  const actual = realpathSync(requested);
  if (!inside(root, actual)) throw new Error("document_path_invalid");
  return actual;
}

export function readMarkdownSnapshot(workspaceRoot: string, inputPath: string): MarkdownSnapshot {
  const root = realpathSync(resolve(workspaceRoot));
  const absolutePath = resolveMarkdownPath(root, inputPath);
  const before = statSync(absolutePath);
  const content = readFileSync(absolutePath, "utf8");
  const after = statSync(absolutePath);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error("document_write_in_progress");
  const filename = basename(absolutePath, extname(absolutePath));
  const filenameDate = /^\d{4}-\d{2}-\d{2}$/.test(filename) ? `${filename}T00:00:00.000Z` : undefined;
  const recordedAt = validDate(frontmatterValue(content, "recorded_at")) ?? validDate(frontmatterValue(content, "date")) ?? validDate(filenameDate) ?? after.birthtime.toISOString();
  return {
    absolutePath,
    relativePath: relative(root, absolutePath).replaceAll("\\", "/"),
    title: frontmatterValue(content, "title")?.trim() || filename,
    content,
    contentHash: createHash("sha256").update(content).digest("hex"),
    recordedAt,
    sourceUpdatedAt: after.mtime.toISOString(),
    size: after.size
  };
}

export function listMarkdownFiles(workspaceRoot: string): string[] {
  const root = realpathSync(resolve(workspaceRoot));
  const result: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === ".pcs" || entry.name === "node_modules") continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") result.push(relative(root, path).replaceAll("\\", "/"));
    }
  };
  visit(root);
  return result.sort();
}

export function excerpt(content: string, maximumCharacters: number): string {
  const limit = Math.max(200, Math.min(8_000, maximumCharacters));
  return content.length <= limit ? content : `${content.slice(0, limit)}\n...`;
}
