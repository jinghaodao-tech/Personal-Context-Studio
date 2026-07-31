# ADR-011: Operational boundaries

## Decision

PCS exposes health and operational status separately from user context data.
Operational status includes migration and process state, but never note text,
tokens, or raw structured values. Logs are JSON Lines with redaction and size
rotation. Backup deletion remains an explicit human action.

## Rationale

Automatic cleanup is convenient but can destroy the last recovery point. A
diagnostic endpoint and explicit backup integrity status provide the useful
parts of lifecycle automation without silently deleting user data.
