# ADR-016: ブラウザAIとの文書入出力

## 決定

### PCSからブラウザAIへのエクスポート

`GET /v1/documents/:id/export-for-external-ai` を追加する。`providerId` と
`destinationHost` を指定し、既存の `context_external_ai_consents` にある文書単位の
有効な同意がある場合だけ、8,000文字制限のない全文を返す。同意がなければ403を返す。
エクスポートは監査ログとprovenanceに記録する。

### ブラウザAIからPCSへのインポート

`POST /v1/documents/raw` は生Markdownを受け取り、サーバーが生成したファイル名で
`notesRoot/webai-import/` に保存し、既存の `upsertDocument` 経路で即時インデックスする。
クライアントのパスは使わないため、パストラバーサルを許可しない。人間が画面で内容を
確認して保存操作を開始するため、構造化されたAI候補に適用されるADR-002の承認ゲートは
この経路には追加しない。

## 根拠と影響

全文の外部開示は明示的な同意・送信先・監査記録に限定し、同意の失効もそのまま反映する。
インポートは既存のローカルMarkdown保存と同じ信頼境界に置く。`webai-import/` は通常の
`notesRoot` 配下なので、既存のバックアップと保持方針の対象になる。

## 検証

`test/external-ai-document-io.test.ts` が、空本文拒否、危険なタイトルの安全な保存、
同意なし403、同意後の長文全文取得、送信先ホスト不一致、同意失効後の拒否をHTTPレベルで
確認する。
