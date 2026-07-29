# Personal Context Studio

Personal Context Studio is a separate, local-first SQLite application for
user-confirmed context that may be shared with AI tools. It is intentionally
separate from MeTheory: MeTheory evaluates observations and hypotheses, while
this project manages AI-facing templates, context values, sharing preferences,
profiles, and exports.

## Run

```powershell
npm.cmd run dev
npm.cmd run cli -- template list --json
npm.cmd run verify
```

The API listens only on `127.0.0.1:8300` by default. Set `PCS_DB` for a
different local SQLite path. No cloud sync, remote AI integration, or secrets
storage is included.

## MeTheory import

Export from MeTheory with:

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
