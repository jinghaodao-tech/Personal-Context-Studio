import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dictionaryPath = process.env.PCS_NAME_DICTIONARY ?? join(process.cwd(), "data", "name-dictionary", "names.json");
let names: Set<string> | null = null;

function loadNames(): Set<string> {
  if (names) return names;
  names = new Set<string>();
  if (!existsSync(dictionaryPath)) return names;
  try {
    const parsed = JSON.parse(readFileSync(dictionaryPath, "utf8")) as { names?: unknown; surnames?: unknown; maleGivenNames?: unknown; femaleGivenNames?: unknown; validatedPairsSample?: unknown };
    for (const key of ["names", "surnames", "maleGivenNames", "femaleGivenNames", "validatedPairsSample"] as const) {
      const values = parsed[key];
      if (Array.isArray(values)) for (const value of values) if (typeof value === "string") names.add(value);
    }
  } catch { /* Optional dictionary: deterministic heuristics remain active. */ }
  return names;
}

export function isKnownJapaneseName(value: string): boolean {
  const dictionary = loadNames();
  if (dictionary.has(value)) return true;
  // The source lists surnames and given names separately. Accept a full name
  // when at least one plausible surname/given-name split is present.
  for (let split = 1; split < value.length; split++) {
    if (dictionary.has(value.slice(0, split)) && dictionary.has(value.slice(split))) return true;
  }
  return false;
}
