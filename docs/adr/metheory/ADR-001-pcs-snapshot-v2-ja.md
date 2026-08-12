# ADR-001: 分析境界としてのPCS Snapshot V2

## 背景
MeTheoryはMarkdown編集体験を所有せずに、構造化データを分析する必要がある。

## 決定
API境界では厳格にバージョン管理された`pcs-analysis-snapshot-v2`契約を使用し、契約リビジョンは`pcs-analysis-snapshot-v2.1`とする。Snapshotには、ユーザーが確認し共有を許可した値、Provenance、除外情報だけを含める。

## 代替案
PCSのSQLiteを直接読む、MarkdownをMeTheoryへ取り込む、バージョンなしのJSONを使う。

## 影響
PCSとMeTheoryを独立してデプロイできる。分析前に契約検証が必要になり、新しいバージョンを追加しても既存データを暗黙に再解釈しない。

## 撤回方法
新しいアダプターと契約バージョンを追加する。V2の検証をその場で緩めてはならない。V1は互換性用途だけで、主分析フローでは使用しない。
