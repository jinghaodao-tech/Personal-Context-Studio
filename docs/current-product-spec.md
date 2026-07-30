# Personal Context Studio 現行製品仕様

## 目的
PCSは、Markdownを人間が編集する正本として保持し、ユーザーが確認した構造化Contextの確定・更新・共有・撤回・削除をローカルで管理する。MeTheoryや他のツールは、許可されたIntegration APIを介してsnapshotを読むクライアントであり、PCS Coreに特定製品の分析ロジックを持ち込まない。

## 完成体験

1. ブラウザでテーマからTemplate Draftを作成する。AIを使う場合もJSON Schema/ドメイン検証を通し、ユーザーが保存・有効化する。
2. 有効なTemplate Versionを選び、ブラウザからEntryを手入力する。Markdown本文は変更しない。
3. ローカルAIや外部Importの候補は、項目単位で承認・修正・不明・拒否する。
4. Valueはappend-only Revision、source、provenance、sharing、sensitivity、valid periodを持つ。
5. purposeとtargetを持つProfileでPreviewを作り、除外理由・文字数・概算token・fingerprintを確認してからExportする。
6. 未解決Conflict、未確認値、private/never、highly_sensitive、secret-like値は出力から除外または停止する。

## 責務

- Markdown: 人間が読む記録の正本。PCSは本文を書き換えない。
- SQLite: 文書メタデータ、再生成可能な検索index、Template/Entry/Value/Review/Revision/Sharing/Profile/Exportを保持する導出・管理基盤。
- Integration API: `read_snapshot`、`submit_template_request`、`submit_import`だけ。外部ClientはTemplate有効化・Value確定・削除を行えない。
- MCP: 読み取り専用。書き込みは持たせない。
- Local AI: localhostに限定。Manual外部AIは明示的な文書/項目/Provider/送信先承認と候補Reviewが必要。

## 状態

- Implemented: Template Draft/immutable version、手入力Entry、項目Review、Revision、Conflict/再確認、purpose-limited Sharing、target renderer、Preview/Export履歴、秘密検出、Integration権限、read-only MCP、Markdown watcher、backup/restore plan、CLI、encoding check。
- Experimental: Ollama等のローカル実行ファイル自動起動、テンプレート生成品質、Watcherの長期常駐運用。
- Planned: UI/APIの完全なroute/service/repository分割、暗号化保管、複雑な差分export、配布アプリ。
- Removed: Obsidian/VS Code専用の正本同期、クラウド同期、PCS Core内のMeTheory固有型、外部AIの自動送信。

## 非目標

医学・心理学的診断、固定的な性格断定、秘密情報の保存、外部ツールによる勝手な書き込み、クラウド同期、PostgreSQL/ベクトルDB/MCP書き込み、自動的なSelf Model更新は行わない。

## 15分デモ

`npm install`、`$env:PCS_NOTES_DIR=...`、`npm run dev`でAPIを起動し、`http://127.0.0.1:8300/`を開く。テンプレート作成→有効化→手入力→Review→purpose/Profile→Preview→Exportをブラウザで実行する。CLIは同じAPIを使い、`--json`時だけ機械向けJSONを返す。