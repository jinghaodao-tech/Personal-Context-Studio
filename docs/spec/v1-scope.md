# PCS v1 Scope

Status: v1 declared. This file is the canonical scope; `docs/current-product-spec.md`
links here instead of duplicating the completion conditions.

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

## Verification

What actually confirms each v1 item is done, not just declared. Automated
coverage was checked against the current test suite on 2026-08-13; gaps are
listed explicitly rather than assumed closed.

1. **Template creation/validation/activation** — covered.
   `test/portfolio-flow.test.ts` ("browser portfolio APIs keep template
   versions immutable...") and `test/experience.test.ts` confirm an activated
   template is `immutable`, and that editing requires `new-version` rather
   than an in-place edit route (none exists in
   `apps/api/src/routes/templates.ts`).
2. **Entry recording, field-level review, approval, correction, withdrawal**
   — mostly covered. `test/governance-flow.test.ts` exercises the pending
   review queue and confirms a rejected value never becomes usable.
   **Gap:** no test asserts an *unconfirmed* value is excluded from an
   analysis/export snapshot by count, even though the exclusion logic exists
   (`apps/api/src/app.ts:198,241-246`). Verify manually until a test is
   added: create an entry, leave one field unconfirmed, request a snapshot,
   and confirm that field is absent with an omission reason.
3. **`source`, `provenance`, `revision`, `sensitivity`, valid-period
   metadata** — **gap.** Coverage is scattered across separate tests
   (revisions, sensitivity, provenance, valid-period each individually), but
   no single test asserts all five are present together on one confirmed
   value. Verify manually: confirm one field end-to-end and inspect the
   stored value for all five attributes at once, not just the ones a given
   test happens to check.
4. **Management API / Integration API separation** — partially covered.
   `test/integration-access.test.ts` confirms an integration-scoped token
   gets 401 on a management-only GET. **Gap:** no test attempts a write or
   delete action (e.g. template deletion) with an integration-scoped
   credential. Verify manually until a test is added: attempt a
   destructive management action using only integration credentials and
   confirm it is rejected, not just reads.
5. **Markdown recording continues when local AI is stopped/unavailable** —
   **gap, no automated coverage.** `packages/ai-core/src/index.ts` defines a
   `disabled` provider but no test exercises it by name, and no test stops
   `/v1/local-ai` and checks the watcher still indexes new saves. Verify
   manually: stop or leave local AI disabled, save a new Markdown file, and
   confirm it is indexed and available for Review as usual.

Items 2 (partially), 3, 4 (partially), and 5 rely on manual verification
today. This is a real gap between "documented as v1" and "proven as v1,"
not just a formality — closing it means either running the manual checks
above and recording the result, or adding the missing automated tests.
