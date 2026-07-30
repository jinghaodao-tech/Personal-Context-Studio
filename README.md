# Personal Context Studio

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

This pre-release schema intentionally replaces the old document-body table. If
an older development database exists, remove that local database and let PCS
recreate it. Markdown files are not affected.

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

## Safety

`private`, `never`, and `highly_sensitive` values are excluded from exports.
The API rejects secret-like strings such as API keys and passwords. Safe delete
requires a generated confirmation token and writes a local audit record.
