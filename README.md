# Personal Context Studio

Personal Context Studio is a separate, local-first SQLite application for
user-confirmed context that may be shared with AI tools. It is intentionally
separate from MeTheory: this project owns Markdown-facing records, local search,
local-AI extraction candidates and their review, templates, sharing preferences,
profiles, and exports. MeTheory consumes only the user-confirmed analysis
snapshot and evaluates observations and hypotheses.

## Run

```powershell
npm.cmd run dev
npm.cmd run cli -- template list --json
npm.cmd run verify
```

The API listens only on `127.0.0.1:8300` by default. Set `PCS_DB` for a
different local SQLite path. No cloud sync, remote AI integration, or secrets
storage is included.

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
