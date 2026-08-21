export type SemanticSensitivityCategory = "income_finance" | "health_history" | "religion_belief" | "sexual_orientation";
export type SemanticSensitivityDisposition = "include" | "exclude" | "on_hold";

export const SEMANTIC_SENSITIVITY_TAXONOMY: Record<SemanticSensitivityCategory, {
  label: string;
  include: readonly string[];
  exclude: readonly string[];
  onHold: readonly string[];
}> = {
  income_finance: {
    label: "収入・家計",
    include: ["給与", "年収", "収入", "借金", "貯蓄", "家計", "生活費"],
    exclude: ["商品価格", "電気代", "物価", "経済ニュース"],
    onHold: ["経済状況", "お金のこと"],
  },
  health_history: {
    label: "健康・病歴",
    include: ["病名", "病歴", "既往症", "症状", "診療", "服薬", "健康診断"],
    exclude: ["健康記事", "運動時間", "他人の病気"],
    onHold: ["体調", "健康状態"],
  },
  religion_belief: {
    label: "宗教・信条",
    include: ["宗教", "信仰", "信条", "思想", "政治的信条"],
    exclude: ["宗教書の購入", "宗教施設への訪問", "宗教ニュース"],
    onHold: ["宗教に関する活動", "思想的な内容"],
  },
  sexual_orientation: {
    label: "性的指向",
    include: ["性的指向", "恋愛対象", "性的な指向", "惹かれる性別"],
    exclude: ["交際状況", "恋愛経験", "デート履歴"],
    onHold: ["恋愛傾向", "好きなタイプ"],
  },
};

export type SemanticSensitivityMatch = {
  category: SemanticSensitivityCategory;
  disposition: SemanticSensitivityDisposition;
  matchedTerms: string[];
};

export type SemanticSubject = "owner" | "third_party" | "generic" | "unknown";
export function classifySemanticSubject(text: string): SemanticSubject {
  if (/(?:母|父|家族|患者|顧客|同僚|他人|第三者|他人の|患者の|顧客の)/u.test(text)) return "third_party";
  if (/(?:ニュース|記事|統計|一般的な|一般論|解説|商品|価格)/u.test(text)) return "generic";
  if (/(?:本人|自分|私の|当事者)/u.test(text)) return "owner";
  return "owner";
}

/** Deterministic policy pass used alongside the embedding detector. */
export function classifySemanticSensitivity(text: string): SemanticSensitivityMatch[] {
  const source = text.toLocaleLowerCase();
  const matches: SemanticSensitivityMatch[] = [];
  for (const [category, policy] of Object.entries(SEMANTIC_SENSITIVITY_TAXONOMY) as Array<[SemanticSensitivityCategory, typeof SEMANTIC_SENSITIVITY_TAXONOMY[SemanticSensitivityCategory]]>) {
    const excluded = policy.exclude.filter((term) => source.includes(term.toLocaleLowerCase()));
    if (excluded.length > 0) continue;
    const onHold = policy.onHold.filter((term) => source.includes(term.toLocaleLowerCase()));
    const included = policy.include.filter((term) => source.includes(term.toLocaleLowerCase()));
    if (onHold.length > 0) matches.push({ category, disposition: "on_hold", matchedTerms: onHold });
    else if (included.length > 0) matches.push({ category, disposition: "include", matchedTerms: included });
  }
  return matches;
}

export function hasSemanticExclusion(text: string): boolean {
  const source = text.toLocaleLowerCase();
  return Object.values(SEMANTIC_SENSITIVITY_TAXONOMY).some((policy) => policy.exclude.some((term) => source.includes(term.toLocaleLowerCase())));
}
