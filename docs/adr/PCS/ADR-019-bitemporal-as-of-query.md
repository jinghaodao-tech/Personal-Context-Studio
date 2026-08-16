# ADR-019: Bitemporal `as-of` query, no schema change

## Context

A recording foundation that has invested this heavily in append-only history
(`context_value_revisions`), machine-vs-human provenance (`confirmation_mode`,
`context_provenance`), and never-silently-losing-history design should be
able to answer two different questions cleanly: "what was actually true on
date X" and "what did I believe was true on date X, using only what I had
recorded by date Y" (before some later correction changed the record). That
second question -- the classic bitemporal distinction between valid time
(when something was true in reality) and transaction time (when the system
recorded it) -- was not previously answerable through any endpoint, even
though the data to answer it already existed.

Checking the schema before designing anything: transaction time is already
present on every revision as `created_at` (when PCS recorded it). Valid time
is already present as `valid_from`/`valid_to` on `context_value_revisions`,
populated today only for `state_change` corrections (the "since 2026-07-01
the address was actually B" case) -- `addRevision` in `apps/api/src/app.ts`
already closes out the previous revision's `valid_to` when a new
`state_change` revision supplies a `validFrom`. Nothing about answering an
as-of query required adding a column; it required adding a query.

A separate mechanism, `context_value_applicability` (used for `keep_both`
conflict resolution), also has `valid_from`/`valid_to`, but it answers a
different question -- "which of several simultaneously-valid values applies
under what condition" -- not "how did this one field's value change over
time." This ADR does not unify the two; folding conditional coexistence into
a single-value temporal-succession model would distort both.

## Decision

Add `GET /v1/context-entries/:entryId/values/:fieldKey/as-of?validAt=<iso>&knownAsOf=<iso, optional>`.
No migration. The resolution function (`resolveValueAsOf` in
`apps/api/src/app.ts`) works entirely over `context_value_revisions` already
on disk:

1. Take every revision for `(entryId, fieldKey)` with `created_at <=
   knownAsOf` (default: now) -- this is the transaction-time cut. Revisions
   recorded after `knownAsOf` are invisible to the query, by design: they
   represent things PCS did not yet know at that point.
2. For each surviving revision, compute an *effective* valid period:
   `effectiveFrom = valid_from ?? created_at`, `effectiveTo = ` the next
   *surviving* revision's `effectiveFrom`, or open-ended if it is the last
   one in the filtered set. Revisions that never had an explicit valid period
   (corrections, reaffirmations, anything not created through the
   `state_change` flow) fall back to treating "recorded" and "became true"
   as the same instant -- the standard bitemporal simplification when valid
   time was never tracked explicitly for that revision.

   The stored `valid_to` column is deliberately never read here, even though
   it exists and is populated for most `state_change` revisions.
   `addRevision`'s `state_change` handling closes the *previous* revision's
   `valid_to` with an in-place `UPDATE` when a new one arrives -- a mutation
   that has no transaction-time record of its own. If that closing revision
   falls outside the `knownAsOf` cutoff (and is therefore excluded from the
   filtered set), the earlier row's stored `valid_to` on disk would still
   reflect it regardless -- future knowledge leaking into a supposedly
   historical view through a column mutation the cutoff can't see. Deriving
   `effectiveTo` purely from "the next revision within the already-filtered
   set" avoids that leak by construction. The cost: an explicit `valid_to`
   set independently on what is, within the filtered set, a tail revision
   with no recorded successor is ignored -- not a pattern any current caller
   exercises, since every existing revision path either relies on the
   state_change auto-close or leaves `valid_to` unset.
3. Pick the surviving revision whose effective period contains `validAt`,
   preferring the most recently *recorded* one if effective periods overlap
   (defensive tie-break, not expected to matter for well-formed
   `state_change` chains).
4. If the matched revision's `change_type` is `retraction`, report
   `retracted: true` with no value, rather than surfacing whatever value the
   retraction revision happens to carry.

The two questions from the Context section become the same query with a
different `knownAsOf`: omit it (or pass "now") for "what was actually true
on X"; pass an earlier timestamp for "what did I believe was true on X, as
of what I knew by Y."

## Consequences

- No backfill, no migration, no change to how revisions get written. This is
  a pure read addition over data that was already being recorded, most of it
  since long before this ADR.
- Values written through `addRevision` calls that never pass `validFrom`
  (the majority today -- direct manual entries, AI-candidate confirmations,
  reconfirmations) get their effective valid period approximated from
  `created_at`. This is honest, not a workaround: PCS genuinely does not know
  when those became true in reality, only when it recorded them, so treating
  the two as equal for those rows is the correct default, not a placeholder
  for something more precise that got skipped.
- `context_value_applicability` is untouched and stays a separate mechanism
  for a separate question (conditional coexistence, not temporal succession).

## Verification

`test/as-of-query.test.ts` builds a `state_change` revision chain (an address
that changes over time, including a retraction), then checks: `validAt`
before the first revision's effective period returns `found: false`; `validAt`
inside each period returns the correct historical value; `knownAsOf` fixed
before a later correction was recorded returns the *previously* recorded
value even though a newer one now exists, proving the transaction-time cut
actually excludes future knowledge rather than just filtering by valid time;
`validAt` landing in a retracted period reports `retracted: true` with no
value.
