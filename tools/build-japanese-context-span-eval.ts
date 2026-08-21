import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

type Entity = { text: string; label: string; start: number; end: number };
type Case = { id: string; text: string; entities: Entity[]; subject: "owner" | "third_party" | "generic" | "unknown"; disposition: "include" | "exclude" | "on_hold"; category: string };

const categories = [
  { key: "health_history", owner: ["慢性腰痛の治療", "昨年のうつ病", "健康診断で高血圧"], third: ["母の糖尿病", "父の心臓病", "患者の服薬状況"], generic: ["糖尿病についての記事", "高血圧の統計", "健康ニュース"], hold: ["最近の体調", "健康状態", "体調の変化"], label: "personal health" },
  { key: "income_finance", owner: ["私の月収28万円", "自分の借金", "家計の赤字"], third: ["父の給与", "顧客の口座番号", "家族の借金"], generic: ["経済ニュース", "商品の価格", "家計調査の統計"], hold: ["お金のこと", "経済状況", "生活の余裕"], label: "income" },
  { key: "religion_belief", owner: ["私の宗教", "自分の信仰", "本人の政治的信条"], third: ["母の宗教", "顧客の信仰", "同僚の政治的信条"], generic: ["宗教ニュース", "宗教書の解説", "宗教に関する統計"], hold: ["宗教に関する活動", "思想的な内容", "信条について"], label: "religious belief" },
  { key: "sexual_orientation", owner: ["私の性的指向", "自分が惹かれる性別", "本人の恋愛対象"], third: ["友人の性的指向", "家族の恋愛対象", "顧客が惹かれる性別"], generic: ["性的指向の記事", "恋愛傾向の統計", "性的指向に関する解説"], hold: ["恋愛傾向", "好きなタイプ", "恋愛について"], label: "sexual orientation" },
] as const;

const wrappers = ["記録：", "メモとして保存する。", "この情報を確認：", "今日の文脈では"];
const cases: Case[] = [];
let sequence = 0;
function add(text: string, subject: Case["subject"], disposition: Case["disposition"], category: string, entityText: string, label: string) {
  const start = text.indexOf(entityText);
  cases.push({ id: `ja_ctx_${String(++sequence).padStart(4, "0")}`, text, entities: [{ text: entityText, label, start, end: start + entityText.length }], subject, disposition, category });
}
function addLong(text: string, subject: Case["subject"], disposition: Case["disposition"], category: string, entities: Array<[string, string]>) {
  cases.push({ id: `ja_ctx_${String(++sequence).padStart(4, "0")}`, text, entities: entities.map(([entityText, label]) => { const start = text.indexOf(entityText); return { text: entityText, label, start, end: start + entityText.length }; }), subject, disposition, category });
}
for (const category of categories) {
  for (let i = 0; i < 20; i++) {
    const wrapper = wrappers[i % wrappers.length];
    add(`${wrapper}${category.owner[i % category.owner.length]}。`, "owner", "include", category.key, category.owner[i % category.owner.length], category.label);
    add(`${wrapper}${category.third[i % category.third.length]}。`, "third_party", "include", category.key, category.third[i % category.third.length], `third-party ${category.label}`);
    add(`${wrapper}${category.generic[i % category.generic.length]}。`, "generic", "exclude", category.key, category.generic[i % category.generic.length], `generic ${category.label}`);
    add(`${wrapper}${category.hold[i % category.hold.length]}。`, "unknown", "on_hold", category.key, category.hold[i % category.hold.length], category.label);
  }
}
const longCases: Array<[string, string, string, string, Array<[string, string]>]> = [
  ["health_history", "owner", "include", "先週の診察で医師から慢性腰痛と説明された。私は仕事の後に痛みが強くなり、処方された鎮痛薬を服用している。来月の健康診断までに生活習慣も見直したい。", [["慢性腰痛", "personal health"], ["処方された鎮痛薬", "personal health"]]],
  ["health_history", "third_party", "include", "母は数年前から糖尿病の治療を続けている。家族で通院を支えているが、これは私自身の病歴ではない。病院から受け取った服薬の説明を整理した。", [["母", "family member"], ["糖尿病の治療", "third-party personal health"], ["服薬の説明", "third-party personal health"]]],
  ["health_history", "generic", "exclude", "ニュースで糖尿病の予防に関する特集を読んだ。記事には一般的な統計と運動習慣の例が載っていたが、私や家族の診療記録ではない。", [["糖尿病の予防に関する特集", "generic personal health"], ["一般的な統計", "generic personal health"]]],
  ["health_history", "unknown", "on_hold", "最近は体調が安定しているように感じる。ただ、睡眠不足の日には疲れやすく、健康状態をどこまで記録すべきか迷っている。", [["体調が安定している", "personal health"], ["健康状態", "personal health"]]],
  ["income_finance", "owner", "include", "今月の給与は28万円で、家賃と食費を払うと貯蓄に回せる金額は限られる。クレジットカードの支払いも確認し、家計の赤字を避けるために来週から予算を調整する。", [["給与は28万円", "income"], ["家計の赤字", "financial information"]]],
  ["income_finance", "third_party", "include", "父の給与明細を整理する必要があるが、本人の許可なく共有しないよう注意する。家族の借金についても、私の家計とは分けて管理する。", [["父の給与明細", "third-party income"], ["家族の借金", "third-party financial information"]]],
  ["income_finance", "generic", "exclude", "経済ニュースでは物価上昇と家計調査の統計が紹介されていた。記事中の商品価格は一般的な情報であり、私の収入や口座情報を示すものではない。", [["経済ニュース", "generic income"], ["家計調査の統計", "generic financial information"], ["商品価格", "generic financial information"]]],
  ["income_finance", "unknown", "on_hold", "最近のお金のことを考える時間が増えた。生活の余裕があるのかは自分でも判断しづらく、まずは支出の記録から始めることにした。", [["お金のこと", "income"], ["生活の余裕", "income"]]],
  ["religion_belief", "owner", "include", "私は特定の宗教を信仰しており、週末には礼拝に参加している。政治的な話題についても自分なりの信条があるため、外部AIへ送る前に確認したい。", [["特定の宗教を信仰", "religious belief"], ["自分なりの信条", "religious belief"]]],
  ["religion_belief", "third_party", "include", "同僚が自分の信仰について話してくれた。これは同僚の個人的な情報なので、議事録には一般化した表現だけを残す。", [["同僚", "third party"], ["自分の信仰", "third-party religious belief"]]],
  ["religion_belief", "generic", "exclude", "宗教書の解説記事を読み、複数の宗派の歴史を比較した。これは一般的な知識の整理で、私の宗教や信条を記録したものではない。", [["宗教書の解説記事", "generic religious belief"], ["複数の宗派の歴史", "generic religious belief"]]],
  ["religion_belief", "unknown", "on_hold", "最近、思想的な内容の本を読むことが増えた。どこまでが趣味で、どこからが自分の信条なのかはまだ整理できていない。", [["思想的な内容", "religious belief"], ["自分の信条", "religious belief"]]],
  ["sexual_orientation", "owner", "include", "私は自分の性的指向について少しずつ理解を深めている。恋愛対象について誰に話すかは自分で決めたいので、記録の共有範囲を限定する。", [["自分の性的指向", "sexual orientation"], ["恋愛対象", "sexual orientation"]]],
  ["sexual_orientation", "third_party", "include", "友人が自身の恋愛対象について相談してきた。本人の同意なしに記録を共有しないよう、第三者の情報として扱う。", [["友人", "third party"], ["自身の恋愛対象", "third-party sexual orientation"]]],
  ["sexual_orientation", "generic", "exclude", "性的指向に関する解説を読み、社会調査の結果を確認した。記事の内容は一般論であり、特定の個人の恋愛対象を示していない。", [["性的指向に関する解説", "generic sexual orientation"], ["社会調査の結果", "generic sexual orientation"]]],
  ["sexual_orientation", "unknown", "on_hold", "最近の恋愛傾向について考えることがある。ただし、好きなタイプというだけでセンシティブな属性と断定してよいかは保留にした。", [["恋愛傾向", "sexual orientation"], ["好きなタイプ", "sexual orientation"]]],
];
for (let repeat = 0; repeat < 5; repeat++) for (const [category, subject, disposition, text, entities] of longCases) addLong(`${text} 記録番号${repeat + 1}として、後で内容を見直す。外部のサービスへ送信する前に、誰の情報なのか、一般的な説明なのか、保存してよい範囲なのかを確認する。必要がなければ値を伏せ、判断に迷う場合は保留として人が確認する。`, subject as Case["subject"], disposition as Case["disposition"], category, entities);
const pii = [
  ["連絡先は test.user@example.invalid です。", "test.user@example.invalid", "email address"],
  ["電話番号は090-0000-0000です。", "090-0000-0000", "phone number"],
  ["住所は東京都千代田区です。", "東京都千代田区", "address"],
  ["設定値は sk-test-abcdefghijklmnopqrstuvwxyz です。", "sk-test-abcdefghijklmnopqrstuvwxyz", "api key"],
  ["Authorization: Bearer test-token-abcdefghijklmnopqrstuvwxyz", "Bearer test-token-abcdefghijklmnopqrstuvwxyz", "access token"],
] as const;
for (let i = 0; i < 20; i++) for (const [text, entityText, label] of pii) add(text, "owner", "include", "direct_identifier", entityText, label);

// Hard negatives for person-name precision: these are deliberately plausible
// Japanese strings, but the surrounding cue identifies a place, company, or
// product rather than a person.
const personNegatives = [
  "地名は山田町です。", "会場は佐々木市役所です。", "会社名は山田製作所です。",
  "株式会社佐藤商事の商品を比較した。", "商品名は田中ウォーターです。", "アプリ名は小林メモです。",
  "記事では鈴木県の人口統計を紹介していた。", "店舗名は高橋屋です。", "ブランド名は中村電気です。",
  "プロジェクトコードは山田太郎ではなくYAMADA-01です。",
];
for (let repeat = 0; repeat < 4; repeat++) for (const text of personNegatives) cases.push({ id: `ja_ctx_${String(++sequence).padStart(4, "0")}`, text: `${text} 負例番号${repeat + 1}。`, entities: [], subject: "generic", disposition: "exclude", category: "person_name_negative" });

const outDir = join(process.cwd(), "data", "gliner-eval");
await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, "japanese-context-span-evaluation.jsonl"), cases.map((item) => JSON.stringify(item)).join("\n") + "\n", "utf8");
await writeFile(join(outDir, "manifest.json"), JSON.stringify({ dataset: "synthetic-japanese-context-span-v1", language: "ja", sampleCount: cases.length, categoryCounts: Object.fromEntries([...new Set(cases.map((item) => item.category))].map((category) => [category, cases.filter((item) => item.category === category).length])), note: "Synthetic evaluation data; contains no real PII or credentials." }, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ dataset: "synthetic-japanese-context-span-v1", sampleCount: cases.length, output: outDir }));
