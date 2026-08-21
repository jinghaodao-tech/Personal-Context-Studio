---
title: MeTheory 開発ログ
template: dev-log-v1
source_repository: C:/Users/jingh/MeTheory
updated_at: 2026-08-21
---

# MeTheory 開発ログ

PCS連携、Self Understanding、API、検証、運用上の発見を記録する。ADRとは分離する。

## 主要な実装・検証

- PCSを記録・Snapshotの外部ソースとして接続し、分析Snapshot v2/v3の型・契約・クライアントを実装。
- `read_snapshot`を分析用の基本権限とし、template requestはユーザー確認後の別経路として扱う。MeTheoryからPCS importを直接送らない。
- Connector ManifestとIntegration Doctor（Manifest、Transport、Authentication、Permission、Snapshot Contract）を起動時・CLI・CIで利用可能にした。
- PCS固定SHAをCIで検証し、複数クライアントを`docs/connectors.json`へ登録できる更新CLIと自動PR workflowを追加。
- 仮説の`fits`／`does not fit`／`on hold`評価、Self Model候補の明示的承認、承認履歴、rejected、重複承認、未検証target拒否をHTTPレベルで検証。
- Deterministic Evaluationと有意性評価を検証し、連続値順列検定の不要な係数バグを修正。
- OpenAPI、JSON Schema、migration、rollback、エラー契約、Demo Web、HTTP／live cross-repository testを整備。

## 制約

- 実PCS接続はPCSの起動状態、token、profile設定に依存する。
- 固定SHA更新の自動PRはGitHub APIアクセスが必要。
- 外部評価セットは本番分布との一致を保証しない。

## 追記形式

```markdown
### YYYY-MM-DD: 作業名
- 目的:
- 変更ファイル:
- 検証:
- 未確認／残課題:
- commit／push:
```
