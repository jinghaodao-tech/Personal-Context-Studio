---
title: Personal Context Studio 開発ログ
template: dev-log-v1
updated_at: 2026-08-21
---

# Personal Context Studio 開発ログ

このファイルは、PCS本体と、PCSに接続するMeTheory・dev-paceの開発、検証、
運用上の発見を時系列で記録する。実装したこと、検証したこと、未確認のことを
分けて書き、数字は必ず評価セット・実行条件と一緒に残す。

## これまでの主要な記録

### 基盤と契約

- JSON Schema／OpenAPIを契約の基準として整理。
- DB schema、migration、rollbackを整備。
- API route／service／repositoryを分離し、責務境界を明確化。
- Snapshot／Candidate／Reviewのライフサイクルを実装。
- ExperimentのDraft／State／Observationを分離。
- 決定論的評価を追加し、同じ入力から同じ結果を得られることを検証。
- Self Modelのmapping、approval、historyを実装。
- Live PCS Stub、エラー契約、Demo Web UI、HTTP／Browser E2Eを追加。

### MeTheoryとの接続

- PCS分析Snapshot v2/v3の契約と、MeTheoryのConnector Manifestを整備。
- `read_snapshot`を基本権限とし、`submit_template_request`は明示的な要求と確認の
  経路として分離。PCS importをMeTheoryが直接送らないことを記録。
- Integration Doctor（Manifest、Transport、Authentication／Permission、Contract）を
  実装し、MeTheory起動時とCLI／CIから検査できるようにした。
- MeTheoryのPCS固定SHAをCIで検証する構成を追加。
- 複数クライアントを`docs/connectors.json`で登録する方式を追加。
- `npm run update:connectors`で最新SHAの確認・更新を行い、変更時は自動PRを作る
  GitHub Actions（定期実行／手動実行）を追加した。mainへの直接pushはしない。

### 検証とテストの穴埋め

- `accept-machine-measurement`の正常系、冪等性、日付・sourceTool・必須値の検証、
  import／template不在、壊れたpayload、source_system不一致をテスト。
- 仮説の`fits`／`does not fit`／`on hold`評価と、Self Model変更の承認をHTTPレベルで
  テスト。提案だけでは書き込まれず、明示的承認だけが反映されることを確認。
- `total_observed`の分母を5状態すべてに修正し、回帰テストを追加。
- 検索品質についてP@1／MRRの定義を標準定義に揃え、k件未満の結果を正しく減点する
  回帰テストを追加。
- ADR-021の自動確定検出を、keyword、structured PII、secret、embedding、GLiNER、
  任意のPresidioを組み合わせる多層構成へ拡張。
- 日本語ラベル付き評価セット、外部データセット、秘密情報評価セット、文脈span評価を
  追加。評価結果は、評価セットの由来・言語・件数・陽性数と一緒に記録する。
- GLiNERの評価では、再現できない古い精度コメントを訂正し、precision／recallを
  現行の評価セットで再測定する方針に変更。
- 日本語人名辞書を姓・男性名・女性名から生成し、地名・会社名・商品名などの負例も
  追加。辞書導入前後の比較を可能にした。

### 外部AI・プライバシー

- ADR-015の追加同意ダイアログをDashboardに実装。
- ADR-016の外部AI文書I/Oを実装。exportは同意と送信先ホストを検証し、raw importは
  サーバー生成ファイル名で保存する。
- ADR-021では、センシティブ判定を自動確定の根拠にせず、低確信・文脈不明・第三者の
  可能性をReviewへ送る方針を維持。
- APIキー、アクセストークン、秘密鍵、Cookie、メール、電話、住所などの定型secret／PII
  を独立した評価セットで確認。コード断片や環境変数名を含む負例も対象にする。

### CI・運用

- typecheck、通常テスト、migration、encoding、integration contractsを`verify`に統合。
- Browser E2Eは通常テストと分離したCIジョブとして実行。
- sensitivity quality gateを独立ジョブとして追加。ただし評価セットの性質上、
  本番精度の証明ではなく回帰検知用であることを明記。
- `@huggingface/transformers`をoptional dependency化し、モデルを使わない環境でも
  基本検証を実行可能にした。
- MeTheoryの`.git`に残った無効な古いDENY ACEを除去。Gitプロセスが無いのに
  `.git/index.lock`を作れなかった原因を解消し、commit作成を確認。

## 現時点の制約・未完了

### 2026-08-21: dev-pace_publicのDoctor検証

- dev-pace_publicの実体を`TLA/dev-pace-pcs-adapter`として確認し、Connector Manifestと
  静的Doctor CIを追加。
- 67件のimport fixtureはPCSの契約validatorを通過。
- checker 3は、実PCSの起動と明示的なprofile／credentialが必要なため未実行。CIから任意の
  PCS URLへ秘密情報を送らない方針を採用し、ローカル明示実行に限定した。

### 2026-08-21: Coding-Agent Telemetry v1

- 添付設計書をADR-002へ落とし込み、dev-pace側にoffline normalizer、verification／recovery、
  DevelopmentSession、privacy-reduced PCS exportを実装。
- 実agentのOTLP collector接続は次フェーズとし、raw prompt・command・source contentを保存しない
  境界を先にテスト可能にした。
- Python実行環境がこのローカル環境に無いため、Telemetry unit testはCIで実行する。

- GitHub APIへ接続できない環境では、`update:connectors`の最新SHA取得を実行できない。
  CIまたはネットワーク許可済みのWindows環境で実行する。
- 外部評価セットは本番の自然分布を完全には表さない。合成データ・翻訳データ・外部
  データは、ライセンスと分布差を記録した上で回帰評価に使う。
- GLiNER／embeddingの精度はモデル、閾値、文脈分布に依存する。精度の数字を本番保証と
  表現せず、独立holdoutとカテゴリ別結果を併記する。
- MeTheoryの既存作業ツリーには、このログとは無関係な未コミット変更が残る場合がある。
  commit時は対象ファイルを明示的にstageする。

## 今後の追記ルール

新しい作業ごとに次の形式で追記する。

```markdown
### YYYY-MM-DD: 作業名

- 目的:
- 変更ファイル:
- 実装:
- 検証コマンドと結果:
- 未確認／残課題:
- commit／push:
```

「実装済み」「検証済み」「CIで確認済み」「本番環境では未確認」を混同しない。

## 個別の作業記録

### 2026-08-21: ADR-022訂正とimport専用コネクタ対応

- 目的: ADR-022の「submit_importの実呼び出しが無い」という誤記述を訂正し、
  import専用コネクタ(dev-pace)をIntegration Doctorで検証可能にする。
- 変更ファイル: `docs/adr/PCS/ADR-022-integration-doctor.md`／`-ja.md`、
  `packages/integration-doctor/src/types.ts`、
  `packages/integration-doctor/src/checks/manifest.ts`、
  `packages/integration-doctor/src/checks/contract.ts`、
  `packages/integration-doctor/src/index.ts`、
  `test/integration-doctor.test.ts`、`test/integration-doctor-contract.test.ts`、
  `dev-pace_public/docs/dev-pace-pcs-connector.manifest.json`(新規)。
- 実装: ADR-022のContext／Sequencing節を、dev-paceの実パイプライン
  (Rust記録→`aggregate_activity.py`→`pcs-adapter/adapter.py`→
  `POST /v1/integration-imports`、Windowsスケジュールタスクで日次実行)を
  反映するよう訂正。`ConnectorManifest.pcsContract`をoptional化し、
  `capabilities.readSnapshot===true`のときのみ`checkManifest`が必須化する
  よう変更(`IntegrationImportV1`にはcontractRevision相当のフィールドが
  無いため)。`checkImportContract()`を新規実装し(`validateIntegrationImport`
  をラップ、レンジチェックなし)、`index.ts`からexport。dev-pace用の実
  Connector Manifest(`connectorId: "dev_pace"`、
  `permissions.required: ["submit_import"]`、pcsContractなし)を作成。
- 検証コマンドと結果: `npm run build:integration-doctor`成功、
  `npx tsc --noEmit`エラー0。`npm test`で統合doctor関連は既存29件＋新規6件が
  全PASS(無関係な11件のfetch失敗は既知のsandbox依存の事前障害で、今回の変更と
  無関係)。dev-paceの実Manifestに対して`checkManifest`／`checkTransport`
  (ネットワーク無し)を実行しPASS、`dev-pace/outputs/pcs_imports.jsonl`の
  実データ55件を`checkImportContract`に通し全件PASS、`buildReport`の総合
  statusもPASS。
- 未確認／残課題: checker 3(Authentication／Permission)はdev-paceに対して
  未実行(実PCSサーバーが必要、静的チェックのみ検証済み)。CIには未統合。
- commit／push: 未コミット(PCS側の型・checker変更、dev-pace_public側の
  manifestともに)。
