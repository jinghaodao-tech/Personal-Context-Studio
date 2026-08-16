# ADR-020: provenanceイベントに派生元を記録する(記録のみ、グラフクエリはまだ作らない)

## 決定

`context_provenance`に`derived_from_ids_json`(`TEXT NOT NULL DEFAULT '[]'`、
`context_provenance.id`のJSON配列)を追加する。`provenance()`
(`apps/api/src/app.ts`)は`derivedFromIds?: string[]`を任意で受け取れるように
なり、挿入した行の`id`を返すようになった(今までは返り値なしだった)。

クエリ用のエンドポイントは作らない。全ての呼び出し元に必須にもしない。
親イベントがその時点で既に明確かつ安く分かる、次の4箇所だけに限定して
埋める。

- `POST /v1/context-entries/candidates`(`entries.ts`)の`candidate_extracted`
  は、元文書の直近の`document`イベント(同じ`source_content_hash`)から派生。
- 同ルートの`auto_confirmed_on_ingestion`は、同じリクエストで作った
  `candidate_extracted`から派生。
- `addRevision`(`app.ts`)の`confirmed`/`revised`は、同じ値自身の直近の
  provenanceイベントから派生(値の履歴を自己連鎖させる)。
- `accept-machine-measurement`(`content.ts`)の
  `accepted_as_machine_measurement`は、そのインポートが最初に届いた時の
  `received`イベントから派生。

それ以外の既存の`provenance()`呼び出しは変更しない。文書のインデックス化・
エクスポート・webAI raw importはローカルに前段が無い正当なルートで、
テンプレートのガバナンス系イベントもこのADRが対象とする
文書→candidate→値の派生連鎖の範囲外。

## 根拠と影響

過去の行は列のデフォルト値どおり`derived_from_ids_json='[]'`になる——
「親が記録されていない」という正確な表現であって、履歴の欠落ではない。
バックフィルは不要。挙動も一切変わらない、純粋なデータ追加。

配列にしたのは1個の外部キーに決め打ちしないため——1つの推論が複数の
過去スナップショットから派生することもありうるので、単一親を今から
決め打ちするのは、クエリ層をまだ作らないのと同じ理由で避けたい早すぎる
コミットになる。

## 検証

`test/provenance-derivation.test.ts`。AI候補抽出→確認のフローと
機械測定受理のフローを実行し、`context_provenance`を直接読んで、
上記4箇所の`derived_from_ids_json`が期待する親のidを実際に含んでいること、
無関係な既存呼び出し(文書インデックス化)は引き続き`'[]'`のままであることを
確認する。
