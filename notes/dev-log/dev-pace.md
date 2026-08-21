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

### 2026-08-21: dev-pace_publicのConnector Doctor接続

- 実体を`C:/Users/jingh/TLA/dev-pace-pcs-adapter`として特定。
- `docs/dev-pace-pcs-connector.manifest.json`を追加し、dev-paceは`submit_import`だけを
  必須とし、Snapshot読み取りやtemplate requestを要求しないことを宣言。
- PCS Integration Doctorの静的Manifest検証と、67件のimport fixture契約検証を実行し、
  Manifestエラー0件・import契約エラー0件を確認。
- `rust.yml`にPCSを固定SHAでcheckoutしてDoctorを実行する静的CIジョブを追加。
- checker 3（Authentication／Permission）は、PCS実サーバー停止中かつprofile ID未設定の
  ため未実行。秘密情報を自動CIから任意URLへ送信しないよう、明示実行用スクリプトに限定した。
- CIスクリプトをManifestの自動発見（`docs/*-connector.manifest.json`）へ変更。今後は
  新しいManifestを追加するだけで静的チェック対象に含まれる。
