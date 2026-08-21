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

### 2026-08-21: Coding-Agent Telemetry v1 offline実装

- 添付設計書に基づきADR-002を追加。
- `AgentEvent`のcontent-free正規化、verification分類、FAIL→PASSの
  `RecoveryEpisode`、`DevelopmentSession`、Git snapshot、privacy-reduced aggregateを実装。
- Codex／Claude Code／Gemini CLIを共通source_agentとして扱い、未知agent・未知eventは
  crashせずunknownへ落とす。
- prompt、source code、raw command、tool outputを正規化済みイベントとPCS exportから除外。
- 既存PCS adapterのdaily importに`development_session` aggregateを任意で追加できるようにした。
- Python標準unittestで5ケースを追加し、CIで実行する構成にした。ローカル環境にはPython実行系が
  無いため、実行結果はCI確認待ち。
- Rust本体へ同じ正規化・分類・Recovery Engineを移植し、`cargo test`で4件すべてpass。
- Python版はPCS adapterの橋渡しとCI互換テストとして残し、最終的な実行主体をRustへ寄せた。

### 2026-08-21: OTel Collector境界

- `otel-collector/config.yaml`を追加し、OTLP gRPC／HTTPをloopback（127.0.0.1）のみに束縛。
- cloud exporterやprompt／tool detail収集を有効にせず、raw OTLPをディスクへ保存せずlocalhostの
  normalizer endpointへ転送する設定にした。
- Collectorはv1では任意前段とし、Rust normalizerが不在・停止してもcoding agent本体を妨げない方針をADR-002に反映。
