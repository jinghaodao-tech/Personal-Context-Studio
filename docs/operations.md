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

For a read-only SQLite and backup integrity check, run:

```powershell
npm.cmd run db:diagnostics
```

This command does not repair or delete data. A non-zero exit means that an
operator should preserve the database and investigate the reported integrity
or backup issue before attempting recovery.

Backup retention is explicit and dry-run by default:

```powershell
npm.cmd run db:backup-retention
npm.cmd run db:backup-retention -- --apply
```

Set `PCS_BACKUP_KEEP` to change the number of newest backups retained. Review
the dry-run output before using `--apply`.

Verify one backup without replacing the live database:

```powershell
npm.cmd run db:verify-backup -- <backup-id>
```

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

For a one-shot health check use `npm.cmd run ops:watch -- --once`. Without
`--once`, it polls the API and watcher state until stopped with Ctrl+C, making
it suitable for Task Scheduler or another process supervisor. It does not
restart services or print note contents.
