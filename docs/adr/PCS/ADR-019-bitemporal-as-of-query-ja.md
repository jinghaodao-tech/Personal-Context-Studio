# ADR-019: bitemporalなas-ofクエリ(スキーマ変更なし)

## 決定

`GET /v1/context-entries/:entryId/values/:fieldKey/as-of?validAt=<iso>&knownAsOf=<iso, 省略可>`
を追加する。マイグレーションは無い。

transaction time(いつ記録したか)は各revisionの`created_at`に既にある。
valid time(いつ真だったか)も`context_value_revisions.valid_from/valid_to`に
既にある(今は`state_change`の訂正でだけ埋まる)。足りなかったのはこのデータを
読むクエリだけだった。

解決ロジック(`resolveValueAsOf`、`apps/api/src/app.ts`):

1. `created_at<=knownAsOf`(省略時は現在時刻)のrevisionだけを対象にする。
   これがtransaction timeでの絞り込みで、`knownAsOf`より後に記録された
   revisionは「その時点でPCSはまだ知らなかった」として無視する。
2. 各revisionの実効有効期間を`valid_from ?? created_at`から
   「(絞り込み後の集合内での)次のrevisionの実効開始、無ければ無期限」として
   計算する。明示的なvalid期間が無いrevision(correction等、state_change
   以外)は「記録した時点=真になった時点」とみなす、素直なフォールバック。

   保存済みの`valid_to`列は意図的に読まない。`addRevision`のstate_change
   処理は、新しいrevisionが来たとき「前の」revisionの`valid_to`をUPDATEで
   直接書き換える(この書き換え自体にはtransaction timeの記録が無い)。この
   書き換えを行った側のrevisionが`knownAsOf`のカットオフより後で除外されて
   いても、書き換えられた古い行の`valid_to`はディスク上そのまま残る——
   つまりカットオフでは見えないはずの未来の知識が列の書き換えを通じて
   漏れてくる。`effectiveTo`を「絞り込み後の集合内での次のrevision」だけから
   導出することで、この漏れを構造的に防ぐ。代償として、後続が記録されて
   いない末尾のrevisionに独立して設定された明示的な`valid_to`は無視される
   ——ただし今のところどの呼び出し元もこのパターンは使っていない。
3. `validAt`を含む実効期間のrevisionを選ぶ(重複時は直近に記録された方を優先)。
4. 選ばれたrevisionの`change_type`が`retraction`なら、値ではなく
   `retracted: true`を返す。

「Xの時点で実際に真だったのは何か」と「Yの時点までに知っていた情報だけで、
Xの時点で真だと信じていたのは何か」は、`knownAsOf`を省略するか指定するかの
違いだけの同じクエリになる。

`context_value_applicability`(keep_both用)はそのまま別物として残す。あれは
「複数の値が条件次第で同時に有効」という別の軸で、無理に統合すると歪む。

## 根拠と影響

新規列も既存revision書き込みロジックの変更も無い、既にあるデータの上の
読み取り追加。`valid_from`が無いrevision(直接入力・AI候補確認・再確認の
大半)は`created_at`で近似するが、これは妥協ではなく誠実なデフォルト——
PCSは実際にいつ真になったかを本当に知らず、いつ記録したかしか知らないため。

## 検証

`test/as-of-query.test.ts`。住所が複数回変わる(訂正・撤回を含む)
state_changeの連鎖を作り、①最初のrevisionより前の`validAt`は
`found: false`、②各期間内の`validAt`は正しい過去の値を返す、③後の訂正が
記録される前の`knownAsOf`を指定すると訂正後の今ではなく当時記録されていた
値が返る(transaction timeの絞り込みが実際に未来の知識を除外できている
証拠)、④撤回期間内の`validAt`は`retracted: true`を返す、を確認する。
