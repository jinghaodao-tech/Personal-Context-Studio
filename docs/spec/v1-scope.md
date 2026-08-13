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
   — covered. `test/governance-flow.test.ts` exercises the pending review
   queue and confirms a rejected value never becomes usable.
   `test/v1-scope-verification.test.ts` ("v1-scope item 2...") closes the
   remaining gap: it leaves one candidate confirmed and one unconfirmed for
   the same profile, requests a snapshot through an integration credential,
   and asserts `excluded.unconfirmed === 1` while the confirmed value is
   still present and the unconfirmed one is absent from `records` —
   confirming the exclusion is visible as a count, not just a silent
   omission.
3. **`source`, `provenance`, `revision`, `sensitivity`, valid-period
   metadata** — covered. `test/v1-scope-verification.test.ts` ("v1-scope
   item 3...") creates two conflicting confirmed values for one field,
   resolves the conflict manually with an explicit `validFrom`/`validTo`
   window and sensitivity override, and asserts all five attributes
   together on that one value in a single test: `source`/`source_id` from
   the entry detail, `sensitivity` from the same response, a `correction`
   revision (distinct from the `initial` one) carrying the `valid_from`/
   `valid_to` window, and a `candidate_extracted` event on the separate
   provenance audit trail. Previously this coverage existed but was
   scattered across separate tests that never checked all five together.
4. **Management API / Integration API separation** — covered.
   `test/integration-access.test.ts` confirms an integration-scoped token
   gets 401 on a management-only GET. `test/v1-scope-verification.test.ts`
   ("v1-scope item 4...") closes the write/delete gap: it attempts a
   template archive and an integration-client revoke using only
   integration-scoped credentials, confirms both are rejected with 401
   `management_authorization_required`, and confirms neither action
   actually happened (the template is still active, the client is still
   listed as active) — not just that the response looked like a rejection.
5. **Markdown recording continues when local AI is stopped/unavailable** —
   covered, with a real bug found and fixed along the way.
   `packages/ai-core/src/index.ts` defined a `disabled` provider class, but
   `createLocalAiProvider()` had no branch that ever returned it — it was
   unreachable through any `PCS_AI_PROVIDER` value, not just untested. Fixed
   by adding the missing `if (config.provider === "disabled")` branch.
   `test/local-ai-disabled.test.ts` now covers both the unit level (the
   provider is selectable, reports `available:false`/`errorCode:"disabled"`,
   and rejects extraction) and the full behavioral guarantee: with AI
   disabled and `/v1/local-ai/stop` called, a Markdown file is still saved,
   indexed, findable via full-text search, and usable end-to-end through the
   normal Review flow (manual candidate → pending queue → accepted).

Items 2, 3, 4, and 5 are now covered by `test/v1-scope-verification.test.ts`
and `test/local-ai-disabled.test.ts` (2026-08-13), closing every gap this
Verification section previously listed.
