# Personal Context Studio

Personal Context Studio is a separate, local-first SQLite application for
user-confirmed context that may be shared with AI tools. Markdown files are the
canonical human record and can be edited with VS Code, Cursor, Obsidian, or any
other editor. PCS watches that folder, stores document metadata and a
regenerable search index, and owns local-AI extraction candidates, review,
templates, sharing preferences, profiles, and exports. MeTheory consumes only
the user-confirmed analysis snapshot and evaluates observations and hypotheses.

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

## MeTheory boundary

Personal Context Studio never lets an AI read its entire database by default.
Use `POST /v1/documents/search` to retrieve a bounded local result set, and use
`GET /v1/metheory/analysis-snapshot` to provide only confirmed, shareable,
non-highly-sensitive structured values to MeTheory.

MeTheory creates a complex experiment request with
`POST /v1/experiments/personal-context-template-requests`. Personal Context
Studio receives it at `POST /v1/experiment-template-requests`, then turns it
into a draft template only after an explicit user decision. Short experiment
check-ins remain a MeTheory responsibility.

`POST /v1/context-entries/candidates` records a local-AI extraction candidate
against a local document. Its values begin unconfirmed and become eligible for
analysis only after a per-value `PATCH /v1/context-entries/:id` review.

## MeTheory imports

MeTheory self-understanding candidates can still be imported with:

```powershell
metheory personal-context export-migration --json
```

Import individual `personal-context-candidate-v1` objects with:

```powershell
context-studio import metheory candidate.json --json
```

Imports remain `pending` until the user chooses an explicit decision. They do
not silently become active AI context.

## Safety

`private`, `never`, and `highly_sensitive` values are excluded from exports.
The API rejects secret-like strings such as API keys and passwords. Safe delete
requires a generated confirmation token and writes a local audit record.
