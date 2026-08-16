# ADR-018: Live reference access for ChatGPT (scoped integration client, not public exposure)

## Context

ADR-016 solved human-mediated document exchange with browser-based AI
assistants (export a document's full content, paste it into the chat; paste
the assistant's output back in as a raw import). The next ask was for a
*live* path: ChatGPT should be able to read PCS content on its own, without a
human copying anything each time.

The naive way to get there is to bind PCS's API beyond `127.0.0.1` and put it
on the open internet so ChatGPT's server-side Actions infrastructure can reach
it. That path was evaluated and rejected. Reading the actual code surfaced
four concrete, unaddressed gaps, not a vague "it doesn't feel safe":

- `managementAuthorized` (`apps/api/src/integrationAccess.ts`) returns `true`
  unconditionally when `PCS_ADMIN_TOKEN` is unset -- the entire management API
  is authorization-free by default today, because that default was correct
  for a loopback-only local tool and was never revisited for internet
  exposure.
- The server binds via `server.listen(config.port, "127.0.0.1", ...)`
  (`apps/api/src/server.ts`) over plain `node:http` -- no TLS anywhere in the
  stack.
- No rate limiting exists on any route.
- `POST /v1/documents/raw` (ADR-016) was deliberately given no approval gate,
  on the reasoning that "reachable only by the person at the keyboard" and
  "same trust level as a local file save" are the same thing. Expose the API
  and that reasoning stops holding: the endpoint becomes writable by anyone
  who can reach it.

**Tailscale was considered and rejected** as a way to avoid rebuilding all of
the above: Tailscale creates a private mesh network between devices *the user
enrolls*. ChatGPT's Actions run as OpenAI-operated server infrastructure --
it is not a device on the user's tailnet and cannot become one. Tailscale
solves "let my other devices reach my local server privately"; it does not
solve "let a third-party API provider's servers reach my local server," which
is the actual requirement here. This was worth writing down because it looks
like a solution until you ask which side of the connection actually needs to
initiate it.

**Claude.ai's remote MCP connectors were investigated as an alternative** to
building a ChatGPT-specific integration. As of this ADR, Claude.ai supports
adding a custom connector backed by a remote MCP server over Streamable HTTP,
with OAuth as the expected auth mechanism, reachable over a public HTTPS URL
(a tunnel such as Cloudflare Tunnel is the documented way to get one during
development). PCS already has an MCP server (`apps/mcp/src/main.ts`), which
made this attractive -- but that server speaks stdio JSON-RPC only, built for
Claude Desktop's local process-per-launch model, not Streamable HTTP. Standing
up a second, OAuth-authenticated HTTP transport for it is real, new work. The
target service for this ADR is ChatGPT, chosen directly, so that rework is out
of scope here -- but it is the natural next step if the target ever becomes
Claude.ai instead of or in addition to ChatGPT, and the existing stdio MCP
server would not need to be thrown away to add it (a second transport, not a
replacement).

## Decision

Target ChatGPT via **Custom GPT Actions**: an OpenAPI schema plus header-based
API key authentication, which OpenAI's Actions platform supports directly. No
OAuth authorization server was built -- one external consumer, one user,
static long-lived credential with revocation already available, is a
proportionate answer; OAuth's added complexity (authorization codes, refresh
tokens, token endpoints) buys nothing here that a revocable bearer token does
not already provide.

**Reuse `integration_clients`, don't build a parallel auth mechanism.**
PCS already has scoped bearer-token clients (`apps/api/src/integrationAccess.ts`,
`integration_clients` table, hashed token storage, `timingSafeEqual`-free
lookup by hash, JSON permission list) built for dev-pace-style integrations.
Add a new permission to `integrationPermissions`:
`"read_external_ai_reference"`. Issue ChatGPT one `integration_clients` row
with only that permission -- it gets nothing else the token format already
grants to other integrations.

**New routes, deliberately narrow, reusing ADR-016's consent gate.** Two new
endpoints, both requiring `integrationAuthorization(db, request,
"read_external_ai_reference")`:

- `GET /v1/integration/external-ai/search?query=...` -- lexical search over
  `context_documents`, but the result set is pre-filtered to documents that
  already have an *active* `context_external_ai_consents` grant for this
  client's `providerId` + `destinationHost`. A document with no consent does
  not appear at all -- not even its title. Nothing is discoverable through
  search that was not already explicitly consented to.
- `GET /v1/integration/external-ai/documents/:id/reference` -- thin wrapper
  around the same logic as ADR-016's `export-for-external-ai`: full,
  uncapped content, gated by the same per-document consent check
  (`activeExternalAiConsent("document", providerId, host, documentId)`).

These paths must be added to `isIntegrationRequest`
(`apps/api/src/integrationAccess.ts`) alongside the existing integration
routes. This matters mechanically, not just conceptually: today, every
`/v1/*` path *not* listed in `isIntegrationRequest` is gated by
`managementAuthorized` before the route handler ever runs (see the dispatch
check in `apps/api/src/app.ts`) -- which means, unmodified, ChatGPT's
integration-client bearer token would never even reach these handlers; the
admin-token gate would already have rejected the request. The existing
`export-for-external-ai` endpoint under `/v1/documents/:id/...` is *not* in
that whitelist today and stays that way -- it is reached by a human operator
who holds the admin/session token, which is the correct caller for it.
ChatGPT gets its own endpoints under `/v1/integration/external-ai/...`
instead of being handed the admin token.

**No write path.** ADR-016's `POST /v1/documents/raw` is not exposed to this
integration client and gains no new permission gate here. The "webAI writes
into PCS" direction stays exactly as ADR-016 left it: human-mediated,
unauthenticated-by-design because it is local-only. This ADR only concerns
live *reference* (read), which was the stated goal -- it does not silently
expand into live write access.

**Transport: Cloudflare Tunnel, not a raw open port.** ChatGPT's Actions
infrastructure needs a public HTTPS URL to call, so *some* exposure beyond
`127.0.0.1` is unavoidable for this specific goal -- but "publicly routable"
and "unauthenticated" are independent properties, and only the first is being
accepted here. `cloudflared` gives the tunnel a stable HTTPS hostname without
opening an inbound firewall port on the host machine; every request still
has to carry the `integration_clients` bearer token to get past
`integrationAuthorization`, and non-consented documents stay invisible
regardless of who is asking. A disposable Quick Tunnel (no domain required,
hostname changes on restart) is adequate for initial wiring and testing; a
Named Tunnel against a domain in the user's own Cloudflare account is what a
long-lived ChatGPT Action configuration should point at, since the Action's
URL needs to stay stable.

The tunnel setup itself (Cloudflare account, domain, `cloudflared` running on
the user's actual machine) is outside what this development environment can
execute -- it requires the user's own credentials and their own machine, and
is tracked as a manual follow-up, not something this ADR's implementation
covers.

## Consequences

- A bearer token that used to only matter on a loopback-only machine now
  becomes a real internet-facing credential once the tunnel is live. It needs
  to be treated accordingly (not logged, not committed) even though the
  underlying mechanism (`hashIntegrationToken`, `integration_clients`) was
  already built for this and requires no changes.
- Revocation is already available and requires no new code:
  `POST /v1/integration-clients/:id/revoke`.
- Every other route stays exactly as gated as it is today.
  `managementAuthorized`'s "unset token means open" default is unchanged by
  this ADR -- it remains a gap for the *management* API specifically, tracked
  separately, not something this integration-client-scoped design needed to
  fix in order to be safe on its own.
- If Claude.ai (or another remote-MCP-capable client) becomes a target later,
  the `apps/mcp` stdio server does not need to be replaced -- a second,
  HTTP+OAuth transport can be added alongside it, following the same
  narrow-scope-over-full-exposure pattern established here.

## Rejected alternatives

- **Raw public exposure of the existing management API**: rejected --
  `managementAuthorized`'s open-by-default behavior, no TLS, no rate
  limiting, and ADR-016's local-trust assumption for raw import would all
  need independent fixes, for a surface far broader than "let ChatGPT read
  consented documents."
- **Tailscale**: rejected -- solves device-to-device privacy, not
  third-party-server-to-local-server reachability, which is the actual
  requirement.
- **OAuth 2.0 authorization server**: rejected as disproportionate for one
  external consumer and one user; revisit if a second, distinct external
  consumer needs its own credential lifecycle.
- **Remote MCP over Streamable HTTP (Claude.ai target)**: technically viable
  and partially scaffolded by the existing `apps/mcp` server's tool
  definitions, but not pursued now because the chosen target is ChatGPT,
  which does not speak MCP.
