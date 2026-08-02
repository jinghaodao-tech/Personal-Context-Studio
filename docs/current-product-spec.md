# Personal Context Studio 現行製品仕様

## 目的

Personal Context Studio（PCS）は、Markdownを人間が読む記録の正本として保持し、ユーザーが確認した構造化情報をローカルSQLiteで管理する個人コンテキスト基盤です。確定、更新、共有、撤回、削除を追跡可能にし、外部ツールやAIには許可された範囲のスナップショットだけを提供します。

MeTheoryを含む分析ツールは、Integration APIで取得したスコープ済みスナップショットを読むクライアントです。PCS Coreに特定の分析ロジックを組み込みません。

## 初期実用版の完成条件

- テンプレートを作成・検証し、ユーザー承認後に有効化できる
- Markdown Entryを記録し、値を項目単位でReview、承認、修正、撤回できる
- 各値にsource、provenance、revision、sensitivity、valid periodを保持する
- 矛盾値、古い値、未確認値を表示し、再確認を要求できる
- 目的、対象、項目、Providerごとに共有範囲を制限し、Previewと履歴を残せる
- バックアップ、復元、安全削除、暗号化、暗号鍵の再設定を実行できる
- 管理APIとIntegration APIを分離し、Read-only MCPを提供する
- ローカルAIが停止してもMarkdown記録と管理操作を継続できる
- `npm run verify` が成功する

## 設計原則

### MarkdownとSQLite

Markdownは人間が読む本文の正本です。PCSは本文を勝手に書き換えません。ただし、管理画面でテンプレートのプレビューを確認し、ユーザーが明示的に承認した場合だけ、テンプレート項目を本文末尾へ追記できます。SQLiteはメタデータ、検索インデックス、構造化候補、承認済み値、Revision、共有履歴、Backup metadataを保持する派生・管理ストアです。

### 値の確定

AI、外部ツール、手動入力は候補を作成できますが、確定値はユーザーの項目単位の承認を経て保存します。false、空文字、不明、未入力、欠損は別の状態として扱います。確定後の値はappend-only Revisionで追跡します。

### プライバシー

`normal`、`sensitive`、`highly_sensitive`、`prohibited`を区別します。秘密鍵、APIキー、パスワード、認証コードなどのprohibited値は構造化保存と外部共有を拒否します。highly sensitive値は暗号鍵なしで保存できません。外部AIへの送信は、目的と対象項目を明示した承認が必要です。

## APIと連携

- Management API: ローカル管理画面、テンプレート、Review、Profile、Backup、Privacyを操作する
- Integration API: 登録済みclientに許可された `read_snapshot`、template request、importだけを提供する
- MCP: 読み取り専用。外部エージェントからPCSへ勝手に書き込めない
- SDK/契約テスト: VS Code、Cursor、Obsidian、MeTheoryなどのクライアント境界を固定する
- Local AI: localhostの実行環境だけを対象にし、候補をReviewへ渡す。外部AIは送信先ごとの同意を要求する

## 現在実装済み

- Template Draftとimmutable Template Version
- Entry登録、項目単位Review、Revision、Conflict解決、再確認、staleness
- Purpose-limited Sharing Preview、fingerprint、Export履歴、target renderer
- provenance、sensitivity、暗号化保存、暗号化Backup/Restore、rekey script
- 管理APIとIntegration APIの権限分離、local session、Read-only MCP
- Markdown watcher、retry、supervisor、Windows自動起動定義
- Hybrid search（FTSと記録日時フィルターの組み合わせ）
- VS Code/Cursor read-only adapter、Obsidian read-only adapter、Electron shell
- ブラウザE2E、認証、マイグレーション、暗号化、ガバナンスのテスト
- Windows/macOS/Linuxの常駐定義、Electron Builder、VS Code/Obsidian配布補助

## 使い方の境界

VS Code、Cursor、Obsidianは本文編集または読み取り表示のクライアントです。構造化値の確定、共有、削除はPCSの管理画面で行います。MeTheoryはPCSから許可済みスナップショットを読み、分析結果を独自に管理します。

## 非目標

医学・心理学的診断、固定的な性格判定、クラウド同期、外部AIへの無断送信、PostgreSQLやベクトルDBへの移行、MCP書き込み、第三者の秘密の保存、ストアへの自動公開は行いません。

## 配布と常駐

- Windows: `scripts/install-pcs-autostart.ps1`でログオン時にsupervisorを起動する
- macOS: `scripts/install-pcs-launchagent.sh`をPCS_ROOTを指定して実行する
- Linux: `scripts/personal-context-studio.service`をユーザーsystemdへ配置して有効化する
- Desktop: `apps/desktop`のElectron Builder設定からNSIS、DMG、AppImageを生成できる
- VS Code/Cursor: `scripts/build-vscode-extension.ps1`でVSIXを生成する
- Obsidian: `scripts/package-obsidian.ps1`で配布ZIPを生成する

証明書、署名鍵、ストア登録、Marketplace掲載、OAuth本番登録は環境ごとの手動設定です。秘密情報はリポジトリへ保存しません。

## 検証

```powershell
npm run check:packaging
npm run verify
```

暗号鍵のローテーションは、旧鍵を `PCS_OLD_ENCRYPTION_KEY`、新鍵を `PCS_ENCRYPTION_KEY` に設定して `npm run crypto:rekey` を実行します。実行前にバックアップを取得してください。
