import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

type EvalCase = { key: string; label: string; description: string; sensitive: boolean; category?: string; expectedDisposition?: "include" | "exclude" | "on_hold"; source: string; sourceGroup: string };
const source = "synthetic-japanese-policy-v1";
const definitions: Record<string, { positive: string[]; negative: string[]; hold: string[] }> = {
  income: {
    positive: ["本人の年収は{n}万円", "今月の給与と手取りを記録", "家計の貯蓄残高を確認", "借金の返済状況を整理", "生活費の不足が続いている"],
    negative: ["商品の価格を比較した", "電気代の一般的な推移を調べた", "物価ニュースを読んだ", "経済ニュースを保存した", "家計簿アプリの機能を比較した"],
    hold: ["最近のお金のことが心配", "経済状況について考えた", "家計についてメモした"],
  },
  health: {
    positive: ["本人の病歴を記録", "診断された病名を整理", "服薬と治療の予定を確認", "健康診断の結果を保存", "症状と診療内容を振り返る"],
    negative: ["健康記事を読んだ", "運動時間を記録", "健康番組を見た", "他人の病気について調べた", "一般的な睡眠の解説を読んだ"],
    hold: ["最近の体調についてメモ", "健康状態が少し気になる", "体調管理を考えた"],
  },
  religion: {
    positive: ["本人の宗教と信仰について記録", "自分の信条を整理", "政治的信条を確認", "自分の思想について考えた", "信仰上の理由で予定を変更した"],
    negative: ["宗教ニュースを読んだ", "宗教書の購入を検討", "宗教施設への訪問方法を調べた", "宗教に関する記事を保存", "歴史上の宗教を学んだ"],
    hold: ["宗教に関する活動に参加した", "思想的な内容を読んだ", "宗教について考えた"],
  },
  sexual_orientation: {
    positive: ["自分の性的指向を記録", "自分の恋愛対象について整理", "性的な指向を本人が明示", "惹かれる性別について考えた", "自分の性的指向を更新"],
    negative: ["交際状況を記録", "過去の恋愛経験を振り返った", "デート履歴を整理", "恋人との予定を確認", "一般的な恋愛記事を読んだ"],
    hold: ["好きなタイプについて考えた", "恋愛傾向をメモ", "恋愛について少し迷っている"],
  },
};
const cases: EvalCase[] = [];
for (const [category, definition] of Object.entries(definitions)) {
  for (let index = 0; index < 60; index += 1) {
    const positive = definition.positive[index % definition.positive.length].replace("{n}", String(280 + (index % 20)));
    const negative = definition.negative[index % definition.negative.length];
    const hold = definition.hold[index % definition.hold.length];
    cases.push({ key: `jp_semantic_${category}_positive_${index}`, label: positive, description: "日本語合成評価・陽性", sensitive: true, category, expectedDisposition: "include", source, sourceGroup: `${category}_positive_${index}` });
    cases.push({ key: `jp_semantic_${category}_negative_${index}`, label: negative, description: "日本語合成評価・陰性", sensitive: false, source, sourceGroup: `${category}_negative_${index}` });
    cases.push({ key: `jp_semantic_${category}_hold_${index}`, label: hold, description: "日本語合成評価・要確認", sensitive: true, category, expectedDisposition: "on_hold", source, sourceGroup: `${category}_hold_${index}` });
  }
}
const outputRoot = join(process.cwd(), "tmp", "external-auto-confirm-eval");
await mkdir(outputRoot, { recursive: true });
await writeFile(join(outputRoot, "japanese-semantic-evaluation.json"), `${JSON.stringify(cases, null, 2)}\n`, "utf8");
await writeFile(join(outputRoot, "japanese-semantic-evaluation-README.md"), `# Japanese semantic evaluation (synthetic)\n\nThis is a deterministic synthetic policy-boundary set, not human-labeled production data. It must not be presented as proof of real-world accuracy.\n\n- ${cases.length} cases\n- 4 categories\n- include, exclude and on_hold examples\n- source: ${source}\n`, "utf8");
console.log(JSON.stringify({ dataset: source, language: "ja", sampleCount: cases.length, positiveCount: cases.filter((item) => item.sensitive).length, output: outputRoot }, null, 2));
