# Personal Context Studio

The current product contract is [docs/current-product-spec.md](docs/current-product-spec.md). Architecture decisions are recorded in [docs/adr](docs/adr) and the main usability notes are in [docs/usability-findings.md](docs/usability-findings.md).


## Portfolio Summary

Personal Context Studio is the local-first governance layer for personal context. It keeps Markdown as the human-readable source of truth, turns notes into user-confirmed structured values, and controls revision history, applicability, purpose-limited sharing, privacy filtering, backups, and safe deletion before any external tool receives a snapshot. MeTheory and other clients receive only the scoped, validated Integration API contract; they do not access the PCS database directly.

The current implementation includes SQLite migrations, append-only revisions, value-level Review, provenance, staleness and reconfirmation checks, management and Integration API separation, read-only MCP, local API/CLI surfaces, and automated verification. Cloud sync, remote AI execution, and bidirectional editor synchronization are outside the current product boundary.
Personal Context Studio is a separate, local-first SQLite application for
user-confirmed context that may be shared with AI tools. Markdown files are the
canonical human record and can be edited with VS Code, Cursor, Obsidian, or any
other editor. PCS watches that folder, stores document metadata and a
regenerable search index, and owns local-AI extraction candidates, review,
templates, sharing preferences, profiles, and exports. Connected tools consume
only user-confirmed snapshots through PCS's generic local Integration API.

## Run

```powershell
$env:PCS_NOTES_DIR = "C:\Users\you\Documents\Personal Notes"
npm.cmd run dev
npm.cmd run dev:watcher
npm.cmd run cli -- template list --json
npm.cmd run verify
```

The API listens only on `127.0.0.1:8300` by default. Set `PCS_DB` for a
different local SQLite path. `PCS_NOTES_DIR` must identify the Markdown root.
The watcher requires the same value. No editor plugin, bidirectional sync,
cloud sync, remote AI integration, or secrets storage is required.

Open `http://127.0.0.1:8300/` for the local management screen. It shows
confirmed values, pending Review work, shareable values, revisions, safe
deletion plans, and the local audit log. Markdown remains edited in Obsidian,
VS Code, Cursor, or another editor; the PCS screen manages the structured
information derived from those notes.

PCS records applied SQLite schema versions in `schema_migrations`. Startup
applies each migration transactionally and safely skips versions already
recorded; Markdown files are never changed by a database migration.

The canonical cross-repository analysis contract is exported from
`packages/integration-contracts` as `@personal-context-studio/integration-contracts`.
Consumers should use its strict validator and `ContextAnalysisValueV2` type;
they must not copy or relax the snapshot contract in an integration client.

## Markdown source model

`context_documents` stores only the relative path, stable document ID, title,
recorded time, source update time, content hash, and size. The body remains in
the Markdown file. SQLite FTS contains a rebuildable local index used for
search. A file is indexed only after its size and update time remain stable
across watcher scans.

`recordedAt` is resolved from `recorded_at`, then `date`, then a
`YYYY-MM-DD.md` filename, and finally file creation time. Later edits only
change `sourceUpdatedAt`. Deleting a file removes it from search. Moving an
unchanged file preserves its document ID through its content hash.

Extraction candidates keep the source content hash. PCS rejects approval if
the note has changed since extraction, so stale values cannot silently enter
the reviewed dataset.

## Value governance

`context_values` holds the current confirmed value. `context_value_revisions`
is append-only history. Confirmation creates an `initial` revision; subsequent
changes must record one of `correction`, `state_change`, `exception`,
`reaffirmation`, or `retraction`, together with a reason. A retracted value is
retained in local history but excluded from exports and MeTheory snapshots.

Use the management screen, or these local API/CLI paths:

```powershell
npm.cmd run cli -- entry value-history <entry-id> <field-key> --json
npm.cmd run cli -- entry revise <entry-id> <field-key> revision.json --json
npm.cmd run cli -- privacy safe-delete-plan <entry-id> --json
```

`revision.json` contains `value`, `changeType`, and a non-empty `reason`; it
may also include `validFrom`, `validTo`, `sharing`, and `sensitivity`.
Safe deletion first creates a persistent plan and confirmation token. Execution
deletes the structured Entry, its value revisions, candidate metadata, and
affected stored exports; it never edits the Markdown source file. Audit logs
retain metadata and counts, not note bodies or secret values.

## Review, staleness, and reconfirmation

Extraction candidates are reviewed value by value. A user can accept the
candidate, accept an edited replacement, mark it unknown, or reject it. Every
decision is retained in `context_value_reviews`; rejected and unknown values
remain unconfirmed and are never converted into a false or empty value.

Review is blocked when the Markdown source hash changed. PCS also exposes due
reconfirmations for confirmed values with a `reconfirmAfter` timestamp and
records a `reaffirmation` revision when the user confirms that a value is still
applicable. When two active candidate values for the same field and source note
disagree, PCS records an unresolved conflict for an explicit user decision.

The dashboard Review tab exposes these flows. The CLI equivalents are:

```powershell
npm.cmd run cli -- entry review <entry-id> <field-key> accepted "Matches note"
npm.cmd run cli -- entry reconfirm <entry-id> <field-key> "Still applicable"
```

## Purpose-limited sharing and export history

`purpose_only` is not a broad sharing permission. Create a named local purpose,
assign it to individual confirmed values, and bind the same purpose to an
export profile. PCS excludes a `purpose_only` value when the profile has no
matching purpose. `always`, `private`, `never`, and `highly_sensitive` retain
their stricter behavior.

The Sharing tab lets the user create purposes, set allowed purposes per value,
preview a profile before it is recorded as an export, and inspect export
history. Stored history contains the destination label, format, time, and an
omission manifest, rather than duplicating omitted values.

```powershell
npm.cmd run cli -- sharing create-purpose work-planning "Planning assistance"
npm.cmd run cli -- sharing set-value-purposes <entry-id> <field-key> <purpose-id>
npm.cmd run cli -- export history --json
```

## Local backups and restore

Create backups through PCS while the API is running. They are SQLite-consistent
snapshots written under `data/backups` by default and recorded with file size
and SHA-256 hash. A restore always requires a separate restore plan and its
exact confirmation text. On execution PCS validates the backup, replaces the
database, and stops the local API; restart `npm.cmd run dev` afterwards.

```powershell
npm.cmd run cli -- backup create --json
npm.cmd run cli -- backup list --json
npm.cmd run cli -- backup restore-plan <backup-id> --json
npm.cmd run cli -- backup restore <backup-id> <plan-id> "RESTORE <backup-id>"
```

Backups contain the local PCS database. Keep the backup directory on storage
with the same privacy protections as the primary database.

For operations, `ops status` reports the latest migration, encryption
configuration, and watcher state without exposing note contents. `backup list`
also reports whether each backup file is present and its recorded hash still
matches. Backup deletion is intentionally not automatic.

```powershell
npm.cmd run cli -- ops status --json
npm.cmd run cli -- backup list --json
npm.cmd run ops:diagnostics
```

See [`docs/operations.md`](docs/operations.md) for logging, Supervisor state,
startup configuration, and recovery procedures.

## Read-only MCP

Start the MCP server over stdio with:

```powershell
$env:PCS_API_URL = "http://127.0.0.1:8300"
npm.cmd run mcp
```

It exposes only `search_documents`, `get_document_excerpt`,
`list_reviewed_context`, and `list_pending_reviews`. There are no create,
update, delete, or arbitrary SQL tools. Configure Codex or Claude Code to run
`node --experimental-strip-types <PCS path>\apps\mcp\src\main.ts`, with
`PCS_API_URL` in the MCP process environment.

## Local AI and external-AI consent

Local template generation and document extraction now belong to PCS. Configure
`PCS_AI_PROVIDER` as `disabled` (default), `mock`, `manual`, `ollama`, or
`openai-compatible-local`. The latter two reject non-loopback endpoints.

`context-studio ai status`, `ai start`, and `ai stop` manage the PCS-owned
local runtime. Use `context-studio template generate <theme>` and
`context-studio document extract <document-id> <template-id>` for the moved
recording workflow.

Before a manual external-AI extraction, PCS requires a stored consent for the
source document and for every selected template field, scoped to the provider
and destination host. `highly_sensitive` and `never` fields are blocked from
external extraction even with consent. Grant and revoke these records through
`privacy grant-external-ai` and `privacy revoke-external-ai`; consent records
remain local and are included in the local privacy audit.

## Integration boundary

Personal Context Studio never lets an external tool read its entire database by default.
Use `POST /v1/documents/search` to retrieve a bounded local result set, and use
`GET /v1/context/analysis-snapshot` to provide only confirmed, shareable,
non-highly-sensitive structured values to an explicitly connected local tool.
The snapshot and inbound integration routes require a local integration client:
create one through the management API, store its returned token in that
client's secret store, and send `X-PCS-Client-Id` plus `Authorization: Bearer`.
Clients receive only the explicit permissions `read_snapshot`,
`submit_template_request`, and `submit_import`. The token is returned once,
stored only as a SHA-256 hash, and can be revoked locally.

Any local tool can submit a `pcs-integration-template-request-v1` payload to
`POST /v1/integration-template-requests`. PCS keeps it pending, then creates a
draft template only after an explicit user decision. The requesting tool never
receives authority to activate templates or confirm values.

`POST /v1/context-entries/candidates` records a local-AI extraction candidate
against a local document. Its values begin unconfirmed and become eligible for
analysis only after a per-value `PATCH /v1/context-entries/:id` review, which
creates the first confirmed revision.

## Integration imports

External tools submit a generic envelope containing an integration ID,
`sourceSystem`, optional `sourceReferenceId`, and an opaque payload:

```powershell
context-studio integration import candidate.json --json
context-studio integration imports --json
context-studio integration decide-import <id> held --json
```

Imports remain `pending` until the user chooses an explicit decision. Payloads
are not interpreted by PCS Core and never silently become active AI context.

MeTheory is one possible adapter: it requests an analysis snapshot and may
submit a template request or a hypothesis payload using the same generic
contract. PCS Core has no MeTheory-specific routes, schema types, or write
authority.

## Provenance

PCS stores a local, append-only provenance event for indexed documents,
candidate extraction, user confirmation and review, integration imports,
exports, and backups. An event contains only IDs, source references, content
or payload hashes, provider/model identifiers, and small operational metadata.
It deliberately does not copy Markdown bodies or structured values into the
provenance table. Retrieve the history for an Entry with:

```text
GET /v1/context-entries/:entryId/provenance
```

```powershell
npm.cmd run cli -- entry provenance <entry-id> --json
```

## Management and Integration access

PCS has two separate local API surfaces. Management endpoints create or review
local records, configure sharing, and manage integration clients. Integration
endpoints are limited to analysis snapshots, template requests, and pending
imports; they cannot activate templates, confirm values, or delete data.

Set `PCS_ADMIN_TOKEN` to require the `X-PCS-Admin-Token` header on management
requests. The CLI forwards this environment variable automatically. When this
mode is enabled, the local dashboard asks for the token once per browser
session and keeps it only in browser session storage. Do not put this token in
notes, SQLite exports, source control, or external AI prompts.
Set `PCS_REQUIRE_AUTH=1` in unattended or shared local environments to refuse
startup unless a sufficiently long admin token is configured.

Integration clients use a separate client ID and Bearer token with only
`read_snapshot`, `submit_template_request`, or `submit_import`. Their tokens
are returned once, stored only as hashes by PCS, and are not accepted for the
management API.

## Integration SDK and contracts

`packages/integration-contracts` defines the versioned JSON envelopes and
validators. `packages/integration-sdk` provides `PcsIntegrationClient` for a
connected local tool. It accepts only loopback PCS URLs and always sends the
client ID plus Bearer token; it exposes no management operations.

```ts
import { PcsIntegrationClient } from "./packages/integration-sdk/src/index.ts";

const pcs = new PcsIntegrationClient({
  baseUrl: "http://127.0.0.1:8300",
  clientId: process.env.PCS_CLIENT_ID!,
  token: process.env.PCS_CLIENT_TOKEN!,
});
const snapshot = await pcs.getAnalysisSnapshot();
```

The test suite runs this SDK against a temporary PCS API with real credentials,
so contract drift between the client and integration routes is detected.

## Safety

`private`, `never`, and `highly_sensitive` values are excluded from exports.
The API rejects secret-like strings such as API keys and passwords. Safe delete
requires a generated confirmation token and writes a local audit record.

## Scoped integration and preview safety

Integration clients have explicit read_snapshot, submit_template_request, and
submit_import permissions. A `read_snapshot` client must have an explicit
Profile ID scope; an unscoped request receives
`integration_profile_scope_required`, while a different scoped profile receives
`integration_profile_forbidden`. Tokens are
returned only when a client is created and are stored by PCS only as hashes.
Management credentials do not authorize Integration API calls.

Profile export and Integration snapshots use the same disclosure decision.
Unconfirmed, retracted, private, never, highly sensitive, purpose-disallowed,
invalid, and secret-like values are omitted with a reason manifest. Export
previews include a fingerprint, renderer version, and detail level; an export
can supply that fingerprint to reject stale previews.

Each template field can also specify a reconfirmation policy. `default` with
an interval schedules the next review after an accepted value, while `none`
keeps the value available until the user changes or retracts it. Resolving a
conflict retains an append-only resolution record and retracts values that the
user did not keep, so they cannot silently flow into later exports.

The read-only MCP server uses the Integration SDK. PCS_CLIENT_ID and
PCS_CLIENT_TOKEN expose the profile-scoped snapshot tool. PCS_ADMIN_TOKEN
separately exposes document search and pending-review tools. With neither
credential, no MCP tools are exposed.

## Operational behavior

The watcher isolates failures per Markdown file, retries only the failed item
with bounded exponential backoff, and writes a body-free health state to
`data/watcher-state.json` (override with `PCS_WATCH_STATE`). A temporary API
outage therefore does not discard the next sync cycle or prevent other stable
notes from indexing. Its reusable retry and lease logic lives in
`packages/watcher-core`; a lock file prevents two watcher controllers from
using the same state file. Inspect the current watcher state through
`GET /v1/watcher/status`.

Exports return the `pcs-context-export-v1` envelope alongside the rendered
content. It reports included values and omitted counts by reason
(`unconfirmed`, `privateOrNever`, `highlySensitive`, `invalid`, and
`truncated`), so a receiving tool can distinguish an intentional omission from
an empty profile without being sent the omitted value.

Run the complete local verification suite with:

```powershell
npm.cmd run verify
```

CI performs a clean dependency install and then runs `npm run verify:ci` on
pull requests and updates to `main`.

Set `PCS_ENCRYPTION_KEY` to a 32-byte base64 value or 64-character hex value
to encrypt sensitive context values and backup files with AES-256-GCM. The key
is never stored in SQLite or returned by the API; losing it makes encrypted
values unrecoverable. Without the key, `highly_sensitive` values are rejected.
To migrate existing sensitive plaintext and rotate an encryption key, set
`PCS_OLD_ENCRYPTION_KEY` and the new `PCS_ENCRYPTION_KEY`, then run
`npm.cmd run crypto:rekey`. The command updates encrypted backups as well and
prints counts only.

For a resident local process, run `npm.cmd run dev:supervisor`. It supervises
the API and Markdown watcher independently and restarts either child after a
failure, including the API exit used by backup restoration. Editor adapters can
read a scoped snapshot with `npm.cmd run adapter -- context vscode <profileId>`
or the equivalent `cursor` and `obsidian` kind, using `PCS_CLIENT_ID` and
`PCS_CLIENT_TOKEN`.

Document search accepts `mode: "lexical"` or `mode: "hybrid"`; hybrid combines
SQLite FTS ranking with recorded-date filtering and returns both scores. A
management token can be exchanged through `POST /v1/auth/session` for an
8-hour local session header. Revoke it with `POST /v1/auth/session/revoke`.

On Windows, install the logon task with
`scripts/install-pcs-autostart.ps1` and remove it with
`scripts/uninstall-pcs-autostart.ps1`. The VS Code/Cursor package is under
`integrations/vscode`, the read-only Obsidian plugin under
`integrations/obsidian`, and the local Electron shell under `apps/desktop`.

## Analysis metadata and export detail

Choice fields may declare `positiveValueKeys`, `orderedValueKeys`, or
`numericMapping`. These semantics are stored with the template field and are
included in the V2.1 analysis snapshot; consumers must not infer success from
labels such as `started` or `completed`. Existing templates receive empty
semantics through migration `014_analysis_choice_semantics`.

Profile exports now make `short`, `standard`, and `detailed` materially
different. Detailed output includes purpose, recorded time, provenance,
confirmation and review state, reconfirmation deadline, lifecycle, and
limitations. Reconfirmation updates the current value's timestamps, while
conflict resolution must remain explicit and auditable.
