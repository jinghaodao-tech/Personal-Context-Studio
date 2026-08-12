# ADR-009: 廃止されたPythonランタイムを削除する

## 背景
MeTheoryは単一ユーザー向けのTypeScript/Nodeアプリであり、廃止されたPython MVPを残すとスキーマと挙動がずれる。

## 決定
Pythonランタイム、参照スキーマ、Python専用互換テストを削除する。対象は`backend/core.py`、`backend/server.py`、`backend/__init__.py`、`db/mvp_schema.sql`、`tools/test_mvp.py`である。TypeScript Node API、`db/ts_mvp_schema.sql`、バージョン管理されたマイグレーションランナーだけをランタイム経路とする。

## 代替案

- Pythonを第2のサポート対象ランタイムとして残す。
- Pythonコードを参照実装として残す。
- Pythonコードを別の互換性リポジトリへ移す。

最初の2案は、正本となるスキーマとライフサイクルルールを不明確にするため採用しない。一度限りの文書化されたリポジトリツールではPythonを使用できる。

## 影響
TypeScriptが唯一の実行可能なドメイン実装になる。既存のSQLite互換テストは残る。`observations`と`evidence_links`は現行クライアントが使うレガシーデータのため削除しない。

## 撤回方法
別のバージョン付きランタイムと移行計画を導入する。廃止ファイルをコピーして第2実装を復活させてはならない。
