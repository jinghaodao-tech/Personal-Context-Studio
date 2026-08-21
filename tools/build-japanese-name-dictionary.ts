import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const base = "https://raw.githubusercontent.com/shuheilocale/japanese-personal-name-dataset/main/japanese_personal_name_dataset/dataset";
const sources = [
  { file: "last_name_org.csv", kind: "surname" as const },
  { file: "first_name_man_org.csv", kind: "male_given" as const },
  { file: "first_name_woman_org.csv", kind: "female_given" as const },
];
const sets = { surnames: new Set<string>(), maleGivenNames: new Set<string>(), femaleGivenNames: new Set<string>(), surnameReadings: new Set<string>(), maleGivenReadings: new Set<string>(), femaleGivenReadings: new Set<string>() };
const japanese = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々・]+$/u;
const reading = /^[\p{Script=Hiragana}\p{Script=Katakana}ー・]+$/u;
const noise = /(?:状態|確認|情報|記録|内容|について|する|した|して|一般|記事|統計|ニュース|商品|会社|株式会社|サービス)/u;
function valid(value: string, pattern: RegExp, max = 7): boolean { return value.length >= 1 && value.length <= max && pattern.test(value) && !noise.test(value); }
for (const source of sources) {
  const response = await fetch(`${base}/${source.file}`);
  if (!response.ok) throw new Error(`name_dataset_fetch_failed:${source.file}:${response.status}`);
  for (const line of (await response.text()).split(/\r?\n/)) {
    const columns = line.split(",").map((item) => item.trim().replace(/^"|"$/g, "")).filter(Boolean);
    const kana = source.kind === "surname" ? columns[2] : columns[0];
    const kanjiValues = source.kind === "surname" ? [columns[0]] : columns.slice(2);
    if (!kana || !valid(kana, reading)) continue;
    const target = source.kind === "surname" ? [sets.surnames, sets.surnameReadings] : source.kind === "male_given" ? [sets.maleGivenNames, sets.maleGivenReadings] : [sets.femaleGivenNames, sets.femaleGivenReadings];
    for (const kanji of kanjiValues) if (kanji && valid(kanji, japanese)) target[0].add(kanji);
    if (kanjiValues.some((value) => value && valid(value, japanese))) target[1].add(kana);
  }
}
const surnames = [...sets.surnames].sort();
const givenNames = [...new Set([...sets.maleGivenNames, ...sets.femaleGivenNames])].sort();
const pairs: string[] = [];
for (const surname of surnames.slice(0, 5000)) for (const given of givenNames.slice(0, 5000)) pairs.push(`${surname}${given}`);
const output = join(process.cwd(), "data", "name-dictionary");
await mkdir(output, { recursive: true });
await writeFile(join(output, "names.json"), `${JSON.stringify({ source: "shuheilocale/japanese-personal-name-dataset", license: "MIT", generatedAt: new Date().toISOString(), surnames, maleGivenNames: [...sets.maleGivenNames].sort(), femaleGivenNames: [...sets.femaleGivenNames].sort(), surnameReadings: [...sets.surnameReadings].sort(), maleGivenReadings: [...sets.maleGivenReadings].sort(), femaleGivenReadings: [...sets.femaleGivenReadings].sort(), givenNames, names: [...new Set([...surnames, ...givenNames])].sort(), validatedPairsSample: pairs.slice(0, 10000) }, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ source: "shuheilocale/japanese-personal-name-dataset", license: "MIT", surnames: surnames.length, maleGivenNames: sets.maleGivenNames.size, femaleGivenNames: sets.femaleGivenNames.size, validatedPairsSample: Math.min(pairs.length, 10000), output: join(output, "names.json") }));
