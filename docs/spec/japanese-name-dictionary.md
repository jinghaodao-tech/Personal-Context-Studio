# 日本語名辞書の再生成と評価

辞書の元データは [shuheilocale/japanese-personal-name-dataset](https://github.com/shuheilocale/japanese-personal-name-dataset) です。リポジトリのMIT表記に従い、生成物には出典・ライセンス・生成時刻を記録します。元データを再配布するのではなく、CIまたはローカルで `npm run build:japanese-name-dictionary` を実行して再生成します。

生成処理は姓、男性名、女性名、各読みを別セットに分離し、許可した日本語文字種・長さ・ノイズ語で候補を除外します。姓と名の組み合わせは検証用サンプルとして別に出力します。

GLiNERの評価は `npm run evaluate:gliner-context-span` で人名・住所・秘密情報だけを対象に実行し、`npm run compare:gliner-context-span` で辞書なし/辞書ありを同一セットで比較します。評価セットには地名・会社名・商品名を人名と誤認しない負例を含めます。
