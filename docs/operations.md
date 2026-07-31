# Operations

## Diagnostics

Start the local API and run:

```powershell
npm.cmd run ops:diagnostics
npm.cmd run cli -- ops status --json
```

Diagnostics checks the health endpoint and reports the latest migration,
encryption configuration, and Markdown watcher state. It never prints tokens,
note bodies, or database values.

## Logs

Set `PCS_LOG_FILE` to write JSON Lines logs and `PCS_LOG_MAX_BYTES` to rotate
the active log once it reaches the configured size. The API and Supervisor
share the same redacting logger. Secrets are replaced before output.

## Supervisor

`npm.cmd run dev:supervisor` writes `data/supervisor-state.json` (or the path
in `PCS_SUPERVISOR_STATE`). The state records child PIDs, restart counts, last
exit reasons, and the last update time. Restarts use exponential backoff and
stop cleanly on SIGINT/SIGTERM.

## Backups

`backup list` verifies that each registered file exists and that its SHA-256
hash matches the database record. Backup deletion is deliberately manual;
there is no automatic retention job that could remove the only usable restore
point.

## Configuration

The API validates `PCS_PORT` at startup. Common operational settings are:

```text
PCS_PORT
PCS_DB
PCS_NOTES_DIR
PCS_LOG_FILE
PCS_LOG_MAX_BYTES
PCS_SUPERVISOR_STATE
PCS_REQUIRE_AUTH
```
