---
title: dev-pace 開発ログ
template: dev-log-v1
source_repository: C:/Users/jingh/TLA/dev-pace
updated_at: 2026-08-21
---

# dev-pace 開発ログ

日次測定、状態分類、PCS連携の実装と検証を記録する。ADRや仕様書とは分離する。

## 主要な実装・検証

- 日次測定値をdeep thinking、通常作業、thinking、break、awayなどの状態へ分類。
- idle stateを見直し、thinking／breakを単純な「何もしていない」と同一視しない方針を文書化。
- 日次測定値をPCSの`accept-machine-measurement`経由で取り込む契約を整備。重複import防止、日付、sourceTool、必須値の検証をPCS側で確認。
- MeTheoryで利用する分析Snapshotに必要な状態分布と観測値を出力。
- dev-paceとdev-pace_publicの公開範囲を分離し、新規追加分の同期を明示的に扱う。

## 検証上の注意

- `total_observed`は5状態すべてを分母に含める。状態を絞った集計では分母と陽性数を併記する。
- PCSやMeTheoryへの取り込み失敗は測定処理の失敗と分けて記録する。
- ローカルのログ・SQLite・生成物は公開前に除外を確認する。
