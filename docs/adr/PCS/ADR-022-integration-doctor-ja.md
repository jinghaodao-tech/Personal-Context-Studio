# ADR-022: Integration Doctor -- 外部コネクタ向けの適合性診断レイヤー

## Status

Proposed、v0.1はほぼ実装済み。`packages/integration-doctor`にManifest/DiagnosticResult型とchecker 1〜3(Static Manifest、Transport、Authentication/Permission)を実装済み。`test/integration-doctor.test.ts`と`test/integration-doctor-auth-permission.test.ts`(計22ケース、全PASS、`npx tsc --noEmit`もクリーン)。checker 1のテストはMeTheoryの実際のmanifestファイル(`MeTheory/docs/metheory-pcs-connector.manifest.json`)をディスクから直接読んで実行し、9チェック全PASS。

checker 3は書き込み系の3権限(`submit_template_request`、`submit_import`、`append_markdown_template`)を意図的に実際には検証しない -- 実行すると本物のデータが作られてしまい、v0.1にはdry-runの仕組みがまだない(Sequencing参照)ため。黙ってスキップするのではなく、明示的に`INFO`「未検証」として報告する。また「tokenが宣言以上の過剰な権限を持っていないか」も検出できない -- clientの実際の権限一覧を取得できる唯一のendpoint(`GET /v1/integration-clients`)はPCS管理者権限を要求するが、コネクタ自身の自己診断がPCS管理者権限を必要とすべきではない(当初はchecker 3の責務として提案していたが、実装した結果、この設計自体の権限境界の中では実現不可能と判明した -- 単に先送りではない)。

checker 4(Contract)も実装済み: `validateContextAnalysisSnapshot`を再実装せずラップし、加えてレスポンスの`contractRevision`をmanifestが宣言する`[minimumRevision, maximumRevision]`範囲と照合する。テストしていて分かった実際の限界: `validateContextAnalysisSnapshot`はスキーマバージョンごとに単一の固定リビジョン定数への**完全一致**を要求しており、レンジという概念自体を持っていない。そのためPCS自身のバリデータが受け付けないリビジョンがこのcheckerのレンジ比較まで届くことは原理的にない。実際にはこのレンジチェックが意味を持つのは一方向だけ: PCSが本当にサポートしているリビジョンを返しているのに、**manifest側**がそれを含むよう更新されていない(manifestが古い)ケース。PCSが複数のcontractRevisionを同時に受け付けるようになる(移行期間中など)まで、逆方向の検出は起こり得ない。4つのchecker合計29テスト、全PASS、`tsc --noEmit`もクリーン。

Authentication/Permission startup checkはMeTheory自身のAPIサーバーに組み込み済み(`apps/api/src/pcsDoctor.ts`、`server.ts`の`server.listen`後に一度呼ばれ、以前グレースフルデグレードのパスが無かった唯一のPCS依存endpointをガードする)。これは「起動時に一度だけ」の段階で、常駐・定期ポーリングではない -- 理由と、必要になったら新しいインフラ無しでどう定期再チェックに拡張できるかはそのファイル自身のヘッダーコメントに書いた。

MeTheoryが実際に`personal-context-studio/integration-doctor`を解決しようとして、本物のパッケージング上の穴が見つかり、直した: このリポジトリのroot `package.json`には`prepare`スクリプトが無く、MeTheoryのようなgit依存の消費者が`packages/*/dist`を得る唯一の方法は、誰かが手元でビルドして`.gitignore`されてる`dist/`をpush前に手動で強制コミットすることだけだった -- `packages/integration-contracts/dist`がまさにそれを黙ってやっていた。`"prepare": "npm run build:contracts && npm run build:integration-doctor"`を追加。npmはgit依存のdevDependenciesをインストールした後、自動で`prepare`スクリプトを実行するので、これで`dist/`はインストール時に毎回生成されるようになり、手動コミットは不要になった。`npm run prepare`を直接実行し、両方の`dist/index.js`が新しく書き換わったこと、再生成後の出力に対して29テスト全部通ることを確認済み。

v0.1で残っているのは、手動/CI用に4つのcheckerを単体で繋ぐCLIコマンドのみ(上のstartup経路は既にプログラム的に4つを繋いでいるが、単独コマンドとしては未提供)。checker 5(Semantic Invariant)とdry-run系probeは下のSequencing通り先送り。

**訂正、および訂正後の前提:** このADRの前の版では「実コネクタは1つも存在しない」と書いたが、これは確認したところ誤りだった。`MeTheory`(`apps/api/src/personalContextClient.ts`)はすでにPCSの実在するライブのintegration endpoint -- `GET /v1/context/analysis-snapshot`、`GET /v1/context/analysis-snapshot-v3`、`POST /v1/integration-template-requests` -- を、3箇所の実際のroute handler(`server.ts:573`、`607`、`902`)から呼んでいる。`PCS_API_URL`/`PCS_CLIENT_ID`/`PCS_CLIENT_TOKEN`/`PCS_PROFILE_ID`で設定される。本当に成り立っているギャップは別のところにある: MeTheoryはPCS自身の`packages/integration-sdk`には**依存していない**。`integration-contracts`の*型*だけは再利用しつつ、loopbackチェック・リクエスト/エラーマッピング・独自の(人間可読な対処法付きの)エラーコード語彙(`pcs_permission_forbidden`、`pcs_profile_scope_required`など)を、SDKパッケージとは無関係に自前で実装した、同名だが別物の`PcsIntegrationClient`クラスを持っている。

これはこのADRにとっての「検証対象となる実コネクタがない」の意味を変える。checker 1〜4(Manifest、Transport、Authentication/Permission、Contract)はmanifestとPCSへの実際のHTTP呼び出しに対して検証するのであって、コネクタが内部でどのクライアントライブラリを使っているかは関係ない。本当に足りないのは、MeTheoryの実際にデプロイ済みの利用状況を記述するConnector Manifestだけ。`StudyGraph`はあくまで説明用のmanifest例を読みやすくするための架空の名前のままで、実在しない。下の「Sequencing」節は訂正後の内容に更新した。

## Context

PCSにはすでに以下の統合基盤が実在する:

- `packages/integration-contracts`: バージョン管理されたリクエスト/レスポンスバリデータ(`validateContextAnalysisSnapshot`、`validateIntegrationImport`、`validateIntegrationTemplateRequest`)、loopback限定の`localPcsUrl`制約(`pcs_localhost_required`)、`GET /v1/context/analysis-snapshot`に載る`PCS_ANALYSIS_CONTRACT_REVISION`文字列。
- `packages/integration-sdk`: `PcsIntegrationClient`(`getAnalysisSnapshot`、`submitTemplateRequest`、`submitImport`)と`PcsManagementClient`。どちらも同じバリデータの上に構築されている。
- `apps/api/src/integrationAccess.ts`: 固定の権限セット(`read_snapshot`、`submit_template_request`、`submit_import`、`append_markdown_template`)。許可Context Profile IDでスコープされ(ADR-009)、エラーコードは`integration_authorization_required`、`integration_profile_scope_required`、`integration_profile_forbidden`。

足りないのは、外部ツール(あるいはそれを開発している本人)が「PCSとの接続は本当に正しいか、正しくないならどの層が壊れているか」を一回の決定的な処理で答える手段。現状この診断は暗黙的で、`submit_import`権限が足りないことは実際にインポートを試して401が返って初めて分かり、manifest的な前提の誤りはリクエスト途中でバリデータが例外を投げて初めて分かる。

このギャップは、実コネクタがまだ存在しない今だからこそ重要になる。最初のコネクタ(おそらくMeTheory)はPCSを作った本人が、実際の統合を通して修正される前の「記憶頼りの契約理解」で書くことになるから。決定的な適合性レポートがあれば、そのズレがデバッグセッションになる前に検出できる。

## Decision

3つの要素からなるシステムを作る: **Connector Manifest**(外部ツールがPCSに何を必要としているかを静的に宣言するもの)、**Integration Doctor**(manifestと実際の接続をPCSの実際の契約・権限・挙動に対して検査する診断エンジン)、**Diagnostic Result**型(Doctorが出力する構造化されたバージョン付きレポート)。

### 設計原則: 診断はするが修復はしない

Doctorの責務は`detect` / `diagnose` / `explain`に限定する。高い確信度で原因を推測できる場合でも、以下は一切行わない:

- LLMで原因を推測する
- コネクタの権限やスコープを書き換える
- tokenを再発行・ローテーションする
- PCSの設定を変更する
- コネクタ側のコードを書き換える

これはADR-016がローカルAI利用に引く境界、ADR-006が管理アクセスと統合アクセスの間に引く分離と同じ考え方。PCSの外部に対する姿勢は「制約して報告する」であって「代わりに行動する」ではない。権限ドリフトを黙って修復できるツールは、アクセスを黙って広げられるツールでもある。Doctorを読み取り専用・診断専用に保つことで、そのリスクをそもそもスコープ外にする。

### Connector Manifest

外部ツールは要件を一度、バージョン付きで宣言する。例:

```json
{
  "manifestVersion": "pcs-connector-manifest-v1",
  "connectorId": "studygraph",
  "displayName": "StudyGraph",
  "sourceSystem": "studygraph",
  "pcsContract": { "minimumRevision": "pcs-analysis-snapshot-v3.0", "maximumRevision": "pcs-analysis-snapshot-v3.x" },
  "permissions": { "required": ["read_snapshot", "submit_import"], "optional": ["submit_template_request"] },
  "capabilities": { "readSnapshot": true, "submitImport": true, "submitTemplateRequest": false }
}
```

`connectorId`と`sourceSystem`は`integration-contracts`にある既存の`validSourceSystem`パターン(`/^[a-z][a-z0-9_-]{0,63}$/`)をそのまま再利用する。これにより、PCS自身のバリデータが拒否するようなmanifestはネットワーク呼び出し前にDoctorの静的チェックで弾かれる。`permissions.required`は`integrationAccess.ts`の既存`integrationPermissions`リスト(`read_snapshot`、`submit_template_request`、`submit_import`、`append_markdown_template`)からのみ選べる -- Doctor独自の権限語彙は作らない。

Doctorはコネクタの名前や種類から必要なものを推測しない。あくまでコネクタ自身が書いたmanifestを現実と照合するだけ。これによりDoctorの検査は完全に決定的であり続け、意図を宣言する負担はPCS側の推測ではなくコネクタ側に置かれる。

### Checker群

5つのcheckerがあり、それぞれ前段より狭い問いに答える:

1. **Static Manifest Checker。** ネットワーク呼び出しなし。manifestの形式検証と自己矛盾の検出(例: `capabilities.submitImport: true`なのに`submit_import`が`permissions.required`に無い)。
2. **Transport Checker。** `localPcsUrl`を再利用して対象がloopback限定であることを確認し、その上でPCSに実際に到達可能か、単に「そのポートで何かがlistenしている」だけでなく本当にPCSが応答しているかを確認する。
3. **Authentication / Permission Checker。** 新しい強い権限を持つ診断用endpointを作る代わりに、各権限が実際にマップされる本物のintegration endpoint(例: `read_snapshot` → 呼び出し側が渡したprofileId付きで`GET /v1/context/analysis-snapshot-v3`)を呼び、`integrationAccess.ts`が実際に使うエラー語彙で結果を分類する: `integration_authorization_required`/401なら資格情報が無効、`integration_permission_forbidden`/403なら認証済みだがその権限自体が無い、`integration_profile_forbidden`/`integration_profile_scope_required`なら権限はあるが要求したContext Profileにスコープされていない、200ならその権限は実際に使える。安全に(書き込みなしで)probeできるのは`read_snapshot`だけで、書き込み系の3権限(`submit_template_request`、`submit_import`、`append_markdown_template`)は実際に実行すると本物のデータが作られてしまうため、明示的な`INFO`「未検証」として報告する(dry-run probeはv0.2以降、Sequencing参照)。

   **実装後の訂正:** このcheckerは当初、manifestで宣言された権限リストとtokenが実際に持つ権限を差分し、**過剰権限**(宣言していないのに`submit_import`を持っているclient)を`WARNING`として報告する設計だった。実装してみると、これはこのcheckerの権限境界内では実現不可能と判明した -- clientが実際に持つ権限一覧を返す唯一のendpoint(`GET /v1/integration-clients`)はPCS管理者権限を要求するが、コネクタ自身の自己診断ツールがPCSの管理者権限を必要とすべきではない(「新しい強い権限を持つendpointを作らない」という同じ理由が、既存の強い権限を持つendpointを流用することにも同様に当てはまる)。過剰権限の監査は今もPCS内に前例のない、埋まっていない穴のままだが、それはこのcheckerがコネクタ自身のtokenでできることではなく、管理者tokenを持つ人間が動かす管理側のツールが必要な話。このADRのスコープ外とする。
4. **Contract Checker。** 既存の`integration-contracts`バリデータをラップする。現在の形(`throw new Error("context_analysis_value_invalid")`)はリクエスト処理の境界としては十分だが、診断レポートとしては不十分なので、バリデータ自体は変えずに、投げられたエラーを構造化された`{ checkId, status, code, message, location }`結果に変換する薄いadapterをこのcheckerに追加する。
5. **Capability Probe / Semantic Invariant Checkers。** 先送り -- 「Sequencing」参照。

### Diagnostic Result

全checkerが結果を積み上げる単一のバージョン付き型で、固定のseverityスケール(`PASS` / `INFO` / `WARNING` / `ERROR` / `FATAL`)と固定のエラーコード採番規則を持つ。外部コードがメッセージ文字列ではなく安定した識別子で分岐できるようにする:

```text
1xxx Manifest        4xxx Permission
2xxx Transport/Auth   5xxx Semantic
3xxx Contract         6xxx PCS Runtime
                       7xxx Connector Runtime
```

人間可読なCLIレポートと、その裏にあるJSONは同じ結果から生成する。CIはJSONを消費し、ローカルで`doctor`を実行する開発者はテキストを読む。

### このADRでは導入しないもの

- 新たな高権限の「diagnostics」endpointは作らない。全checkerは静的にmanifestに対して検査するか、コネクタ自身のtokenが持つ権限レベルですでに存在するintegration endpointを呼ぶだけ。
- PCS本体への自動起動時ゲーティングロジックは入れない。`DEGRADED`結果を「その機能だけ無効化する」とするか「起動自体を拒否する」とするかは外部ツール側の判断であり、PCSが強制するものではない。
- v1では`context_integration_diagnostics`履歴テーブルは作らない(「Sequencing」参照)。

## Sequencing

dry-run書き込みprobeとcompatibility matrixまで含む5-checker全体を今作っても、checker 5(Semantic Invariant)は依然として想像上の失敗モードに対して設計することになる。MeTheoryの実際の利用は`read_snapshot`と`submit_template_request`しか使っておらず、`submit_import`は一度も呼んでいないため、Capability Probeの書き込み側の挙動を設計できる実際の失敗も存在しない。このADRでは以下の順序を固定する:

- **v0.1(このADRの実装対象):** Connector Manifest型、Diagnostic Result型、エラーコード表、上記checker 1〜4(Manifest、Transport、Authentication/Permission、Contract)。人間可読レポート+JSON。加えて、MeTheoryの既存の実デプロイ済み統合に対する実際のConnector Manifestを書く(`connectorId: "metheory"`、`permissions.required: ["read_snapshot", "submit_template_request"]`。これは`personalContextClient.ts`が実際に今日呼んでいるものをそのまま反映する)。これによりchecker 1〜4は最初から仮想ではなく実デプロイに対して検証される。dry-run書き込みパスなし、checker 3が`read_snapshot`経由ですでに検証する以上のcapability probeなし、semantic invariant checkerなし、診断履歴テーブルなし。
- **v0.2の前に:** 実際に`submit_import`を呼ぶコネクタを用意する -- MeTheoryは現状PCSへの書き込みを必要としていないため、これには2つ目のコネクタか、意図的にスコープされたMeTheory側の新機能(PCSへの書き戻し)のどちらかが要る。それが無い限り、Capability Probeのimport側dry-runと書き込みに紐づくSemantic Invariantチェックは想像上のままになる。これはこのADRの実装対象ではなく、別の作業として管理する。
- **v0.2以降:** capability probe(`/v1/integration-imports`と`/v1/integration-template-requests`への`dryRun`追加を含み、永続化せずに検証する)、semantic invariant、そして2つ目のコネクタが実在してcompatibility matrixに意味が生まれてから初めてそれを作る。

**このADRのスコープ外として別途:** MeTheoryの自前実装`personalContextClient.ts`をPCS共有の`packages/integration-sdk`に移行するかどうかは、それ自体独立した判断であり実質的なトレードオフを伴う(SDKは現状`getAnalysisSnapshotV3`と`getTemplateRequest`を持たず、MeTheory固有のユーザー向け対処法エラー文字列も持たない)。Doctorの動作にはこの移行は不要 -- Doctorはライブなhttp挙動とmanifestに対して検証するのであって、どのクライアントクラスがリクエストを発行したかは関係ない。この移行をやるなら、それ自体を別のADRにすべき。

## Alternatives Considered

**コネクタごとのその場しのぎのhealth check。** 各外部ツールが自前で「PCSに到達できるか」ロジックを書く。却下: 同じtransport/authロジックがコネクタごとに重複し、CIやメンテナが複数コネクタの適合性を一貫して比較する手段が生まれない。

**Doctor層を作らず既存バリデータをそのまま公開するだけ。** 統合者は`validateContextAnalysisSnapshot`等を自分で呼べばよい。それ単体では不十分として却下: 単一文字列の`Error`は「何かが間違っている」ことは伝えるが、5層のスタック(manifest/transport/auth/contract/semantics)のどこに問題があるかは伝えない。これは接続が壊れたとき統合者が実際に知りたい問いそのもの。

**LLMによる失敗診断。** 失敗内容とコネクタのコードをモデルに渡して原因を説明させる。これは優先度を下げるのではなく明確に却下する: PCS自身の前例(ADR-016、そしてこのセッション自体でADR-021において未検証の精度主張がコードコメントに紛れ込んだ経験)から、非決定的なコンポーネントは信頼される前に独立した検証が必要であることが分かっている。診断ツールの仕事は「何かがすでに壊れているときに信頼されること」であり、そこにその種のリスクを持ち込むのは筋が悪い。この設計の全checkerは、静的なassertionか、HTTPレスポンスの決定的な分類のどちらかでしかない。

## Consequences

新パッケージ`packages/integration-doctor`(manifest型、checker群、レポート整形、エラー/severity型)と、そこを呼ぶ新規CLIコマンド(`apps/cli/src/commands/integration-doctor.ts`)。v0.1では新規DBテーブルなし、新規PCS APIエンドポイントなし(checker 3は既存のintegrationルートを再利用)。外部コネクタはmanifestを書くことでDoctorを採用でき、自身の起動時やCIに組み込みたければ、すでに`PcsIntegrationClient`をimportしているのと同じ要領でSDKから`PcsIntegrationDoctor`をimportすればよい。

このADRが受け入れる主なリスクは、checker 1〜4を実コネクタで即座に検証できないまま作ること。このリスクは、v0.1が実コネクタなしでは最も設計を誤りやすい2つのchecker(Capability ProbeとSemantic Invariant)を意図的に除外しているスコープの狭さと、「Sequencing」で明記した「拡張前に実コネクタ呼び出しを1本作る」という明示的なコミットメントによって抑えている。

## Reversal

2つ目のコネクタが現れず、Doctorが手動CLI実行以外で採用されなかった場合、`integration-contracts`・`integration-sdk`・APIルートのどれにも触れずに削除できる -- Doctorはそれらを読み取り・呼び出しするだけで、契約や挙動を変更しない。削除はパッケージ1つとCLIコマンド1つを消すだけで済む。
