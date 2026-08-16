# ADR-018: ChatGPTへのライブ参照アクセス(公開ではなくスコープ付きクライアント)

## 決定

対象はChatGPTのCustom GPT Actions(OpenAPIスキーマ+APIキー認証)。利用者1人・
外部消費者1個という規模にはOAuthは過剰と判断し、既存の`integration_clients`
(bearerトークン+スコープ付きpermission、`hashIntegrationToken`でハッシュ保存)を
再利用する。新しいpermission `"read_external_ai_reference"` を追加し、ChatGPT用
に1件だけクライアントを発行する。

新規エンドポイントは2つ、どちらも`integrationAuthorization(db, request,
"read_external_ai_reference")`必須。

- `GET /v1/integration/external-ai/search` — 検索結果は、そのクライアントの
  providerId+destinationHostに対して有効な`context_external_ai_consents`が
  ある文書だけに絞る。同意していない文書はタイトルすら出さない。
- `GET /v1/integration/external-ai/documents/:id/reference` — ADR-016の
  `export-for-external-ai`と同じ同意チェックを使う全文取得。

この2経路は`isIntegrationRequest`(`apps/api/src/integrationAccess.ts`)に
追加する必要がある。追加しないと、`/v1/*`の他の経路と同じく
`managementAuthorized`(adminトークン)のゲートで先に弾かれ、ChatGPT側の
integrationトークンではそもそも到達できない。

書き込み経路(`POST /v1/documents/raw`)はこのADRの対象外のまま。ChatGPTに
書き込み権限は渡さない。

## 根拠と影響

**Tailscaleは却下した。** Tailscaleは自分のデバイス間の専用網であって、
ChatGPTのActionsはOpenAI側のサーバーインフラとして動くため、そもそも
tailnetに参加できない。「自分の別デバイスから安全に届く」であって
「外部サービスのサーバーから自分のローカルに届く」ではない。

**Claude.aiのremote MCPコネクタも検討した。** 公開HTTPS+OAuthのStreamable
HTTP接続に対応しているが、PCSの既存MCPサーバー(`apps/mcp/src/main.ts`)は
stdio専用(Claude Desktopのローカル起動用)で、HTTP対応は新規実装になる。
対象をChatGPTに決めたため今回は見送り。Claude.aiを対象にする日が来ても、
既存のstdioサーバーを置き換える必要はなく、2つ目のトランスポートとして
足せる。

**生でAPIを公開する案は却下した。** `managementAuthorized`はトークン未設定
なら無条件で`true`(現状は認証なしがデフォルト)、TLSなし、レート制限なし、
ADR-016のraw import(承認ゲート無し)の信頼前提が「ローカルからしか届かない」
に依存している——これら全部を直す必要があり、「ChatGPTに同意済み文書だけ
読ませる」という目的に対して対象範囲が広すぎる。

トンネル(Cloudflare Tunnelを想定)は公開HTTPSのURLを得るためだけのもので、
認証の代わりにはならない。全リクエストは引き続き`integration_clients`の
bearerトークンが要る。実際のトンネル設定(Cloudflareアカウント・ドメイン・
実機での`cloudflared`起動)はこの開発環境では完結できず、手動フォローアップ
として残す。

## 検証

未実装。実装時は、同意していない文書が検索結果にもreferenceエンドポイントにも
一切現れないこと、`isIntegrationRequest`に追加した2経路がadminトークン無しでも
integrationトークンだけで到達できること、`POST /v1/documents/raw`がこの
permissionからは呼べないこと、をHTTPレベルでテストする。
