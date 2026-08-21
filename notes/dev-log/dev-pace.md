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

### 2026-08-21: Rust normalizer endpoint

- `dev-pace.exe agent-server`で`127.0.0.1:8765`をlistenするHTTP endpointを追加。
- OTLP/HTTP JSONのbodyをメモリ上で読み、JSON bodyからAgentEventを正規化して
  `outputs/agent_events.jsonl`へcontent-free形式だけを書き込む。
- Collector停止時もagent本体を止めない分離構成。Rust unit test 4件は再実行してpass。

### 2026-08-21: agent-server実機スモーク

- `otelcol-contrib`、Claude Code、Gemini CLIはこの環境に未導入。Codex実CLIは存在するが、
  実セッションのOTLP送信を強制せず、代表的なOTLP/HTTP JSONをlocalhostへ送るスモークを実施。
- `dev-pace.exe agent-server`が200応答し、`outputs/agent_events.jsonl`へ正規化イベントを保存。
- prompt／commandに入れたsentinel文字列が保存されず、raw-check PASS。
- HTTPのEOF待ちと固定Content-Lengthの実装バグを発見・修正し、再ビルド後に`{"accepted":true}`を確認。
- PCSのintegration-import validatorでdevelopment_session aggregateのdry-runを実施し、PASS。

### 2026-08-21: agent-server CI smoke

- 手動で確認したlocalhost OTLP受信・200応答・raw除去を`tools/test-agent-server.mjs`へ移植。
- Windows CIでrelease binaryを起動し、normalized event存在とsentinel raw文字列不在を自動検証するjobを追加。

### 2026-08-21: checker 3 実接続検証

- PCSをローカル起動し、既存の`profile_803e935193fd494199f894eb39f29129`を明示指定。
- `tools/run-pcs-doctor-live.mjs`でdev-pace Manifestのchecker 3を実行。
- transport到達性はPASS、認証情報も受理された。`submit_import`は書き込み権限でdry-run
  endpointがないため、Doctorの設計どおりINFO（未検証）として扱われた。
- 結果は10 passed、0 warning、0 error、0 fatal、Connector status PASS。
- 検証後、checker用PCSプロセスを停止。credential自体はログへ記録していない。

### 2026-08-22: Cowork側からの独立検証とtest_telemetry.py修正

- 目的: `C:/Users/jingh/TLA/dev-pace-pcs-adapter`に接続し、上記一連の記録(OTel境界、
  Rust normalizer、checker 3実接続)を主張どおり動くか独立に再確認する。
- 変更ファイル: `pcs_adapter/telemetry.py`(新規)、`pcs_adapter/__init__.py`。
- 実装/発見: `tests/test_telemetry.py`が`ModuleNotFoundError: No module named
  'pcs_adapter.telemetry'`で失敗することを発見。原因は`pcs_adapter/__init__.py`が
  兄弟ディレクトリ`pcs-adapter/telemetry.py`(ハイフンのため正式パッケージ名にできない)を
  execで自分の名前空間に読み込む形になっており、テストが期待する`pcs_adapter.telemetry`
  という実サブモジュールが存在していなかった。上記2026-08-21のログ自身が「ローカルに
  Python実行系が無いため実行結果はCI確認待ち」と明記していた箇所で、実際に壊れていた。
  `pcs_adapter/telemetry.py`を実ファイルとして追加し(`pcs-adapter/telemetry.py`を
  唯一の実装元としてexecする形は維持)、`__init__.py`は`from .telemetry import *`に
  簡略化。`pcs-adapter/adapter.py`側の`from telemetry import ...`(兄弟importで
  ディレクトリ内実行)は変更していない。
- 検証コマンドと結果: `python3 -m unittest discover -s tests -v` で5/5 pass
  (修正前は1件がImportErrorで失敗)。あわせてPCS側`npm run build:integration-doctor`と
  `npx tsc --noEmit`もクリーンなことを再確認。`tools/check-pcs-manifest.mjs`・
  `tools/run-pcs-doctor-live.mjs`のコードを読み、credentialをログに出していないこと、
  live版がPCS_ROOT・PCS_API_URL・PCS_CLIENT_ID・PCS_CLIENT_TOKEN・PCS_PROFILE_IDの
  いずれか欠落時に即throwすることを確認。`fb8ff77`のHTTPパース修正(read_to_endでの
  EOF待ち→Content-Length基準の読み取り)も差分どおりの正しい修正であることを確認。
- 未確認／残課題: `src/telemetry.rs`のbody読み取りループはcontent_length自体に
  上限が無い(header部分は1MB上限あり)。loopback限定のため優先度は低いが未対応。
  PCSリポジトリのルートに一時的に置かれていたスクラッチ`verify-dev-pace.mjs`は
  2026-08-22に削除し、`ed060cb`として記録した。
- commit／push: PCS側のスクラッチ削除はコミット済み。dev-pace側のPython修正は
  dev-paceリポジトリ側の履歴・push状態を別途確認する。
