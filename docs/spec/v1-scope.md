# PCS v1 Scope

This document is the scope decision for v1. Moving an item to v1.1 or v1.2 does
not remove an existing implementation; it changes the release commitment.

## v1

1. Template creation, validation, and activation after explicit approval.
2. Entry recording, field-level review, approval, correction, and withdrawal.
3. `source`, `provenance`, `revision`, `sensitivity`, and valid-period metadata.
4. Separate Management API and Integration API boundaries.
5. Continued Markdown recording when local AI is stopped or unavailable.

## v1.1

- Display and reconfirmation for conflicting, stale, and unconfirmed values.
- Purpose-limited sharing restrictions, preview, and history.

## v1.2

- Backup, restore, secure deletion, encryption, and key rotation.
- Read-only MCP.

## Release rule

The v1 gate covers the five items above. v1.1 and v1.2 items remain tracked and
testable, but do not block the v1 scope decision unless a dependency makes a
v1 item unsafe or unverifiable.
