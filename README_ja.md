# Personal Context Studio

Personal Context Studio（PCS）は、Markdownを人間が読む記録の正本として管理し、AIや他のアプリへ渡す構造化情報をユーザー確認付きで確定する、ローカルファーストの個人コンテキスト基盤です。

## 役割

- Markdownの記録日時と外部ファイル更新日時を分離
- ローカル検索、テンプレート、AI抽出候補、項目単位のReviewを管理
- 確定値、Provenance、Revision、適用期間、再確認を保存
- 目的別共有、外部AI同意、プライバシー除外、バックアップ、安全削除を管理
- MeTheoryなどへは検証済みのIntegration APIスナップショットだけを提供

Markdown本文はPCSが勝手に書き換えません。VS Code、Cursor、Obsidianなどで編集し、PCSの管理画面で構造化値を確認・承認します。テンプレートを使う場合だけ、管理画面のプレビューを確認して明示的に承認したときに限り、テンプレートの項目を本文末尾へ追記できます。追記は重複せず、プレビュー後に本文が変わった場合は拒否されます。MCPは読み取り専用です。

## 開発

```powershell
npm ci
npm run verify
```

管理画面は `http://127.0.0.1:8300/` で開きます。詳細は [README.md](README.md) と [docs/current-product-spec.md](docs/current-product-spec.md) を参照してください。

### 外部ツールからの限定追記
Codex、CursorなどのIntegration Clientには、必要な場合だけ ppend_markdown_template 権限を付与できます。この権限は、承認済みテンプレートを指定済みMarkdownへ追記する専用APIだけに使えます。DBの直接操作、任意本文の上書き、テンプレート以外の書き込みはできません。

POST /v1/integration/documents/:documentId/template-apply を使い、プレビュー時の本文ハッシュと pproved: true を渡します。既存本文が変わっていれば拒否され、同じテンプレートは重複追記されません。
