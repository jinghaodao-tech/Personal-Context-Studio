# ADR-020: Record derivation links on provenance events (capture only, no graph query yet)

## Context

`context_provenance` is an event log: `subject_type`, `subject_id`,
`event_type`, `actor_type`, `source_ref`, `source_content_hash`, plus
metadata. It answers "what happened to X" (via `subject_id`) reasonably well
already. It does not answer "what did this event follow from" as a real,
queryable edge -- today that can only be reconstructed, if at all, by
matching `source_ref`/`source_content_hash`/`subject_id` across rows by hand,
which is exactly the kind of implicit, fragile inference this project has
flagged as a problem before (it is the same failure shape as the
`total_observed` bug from earlier this session: the connection exists in the
data, but nothing guarantees it, and it can silently stop holding).

A full provenance DAG with guaranteed traversal was evaluated (see
`notes/ideas-backlog.md`'s original entry) and deliberately not built: the
one thing that would most benefit from a *guaranteed* traversal --
safe-delete impact analysis (`privacy_safe_delete_plans`) -- already works
today without one, so there is no concrete failure this is fixing yet. What
*is* worth doing now, cheaply and reversibly, is recording the derivation
link at the moment an event is created, whenever the parent event is already
known at that point in the code. This costs almost nothing (the calling code
already has the parent's id in scope in most cases) and loses nothing later:
if a real traversal/query need shows up, the edges will already be there to
query instead of needing a backfill or, worse, a heuristic reconstruction
from `source_ref` matching.

## Decision

Add `context_provenance.derived_from_ids_json` (`TEXT NOT NULL DEFAULT '[]'`,
a JSON array of `context_provenance.id` values). `provenance()`
(`apps/api/src/app.ts`) gains an optional `derivedFromIds?: string[]` input
and now returns the inserted row's `id` (previously fire-and-forget), so a
caller that just created a parent event can pass its id to the next one.

No query endpoint is added. No caller is required to populate this. It is
populated at exactly four call sites, chosen because the parent event is
already unambiguous and cheaply known at that point:

- `POST /v1/context-entries/candidates` (`apps/api/src/routes/entries.ts`):
  the `candidate_extracted` entry-level event derives from the source
  document's most recent `document` provenance event matching the same
  `source_content_hash`.
- The same route's `auto_confirmed_on_ingestion` value event derives from
  the `candidate_extracted` event just created in the same request.
- `addRevision` (`apps/api/src/app.ts`): a value's `confirmed`/`revised`
  event derives from that same value's own most recent prior provenance
  event, if one exists (chaining a value's history to itself across
  revisions).
- `accept-machine-measurement`
  (`apps/api/src/routes/content.ts`): the `accepted_as_machine_measurement`
  event derives from the `received` event logged when that
  `integration_import_records` row first came in.

Every other existing `provenance()` call site is left exactly as it is.
Documents indexed from disk, exports, and raw webAI imports have no local
PCS predecessor to point at (they are legitimate roots), and template
governance events (review/activate/auto-confirm toggles) are not part of the
document -> candidate -> value derivation chain this ADR is scoped to.

## Consequences

- `context_provenance` rows written before this ADR have
  `derived_from_ids_json = '[]'` (the column default) -- they are correctly
  represented as having no recorded parent, not incorrectly implying a break
  in history. Nothing needs backfilling; nothing was lost.
- No behavior changes anywhere. This is pure data capture -- every existing
  code path that doesn't pass `derivedFromIds` continues to insert an empty
  array, identical to today's rows.
- `derived_from_ids_json` is a JSON array, not a single foreign key, because
  a real derivation can have more than one parent (an inference that used
  several prior snapshots, for instance) -- picking a single-parent shape now
  would have been the same kind of premature, hard-to-fix commitment this
  ADR is trying to avoid by not building the query layer yet either.
- When a real need for traversal shows up (the thing that was missing before
  building ④'s full version), the edges already exist to query against
  rather than needing reconstruction.

## Verification

`test/provenance-derivation.test.ts` runs the AI-candidate-extraction-then-
confirmation flow and the machine-measurement-acceptance flow end to end,
then reads `context_provenance` directly and asserts each of the four wired
events' `derived_from_ids_json` actually contains its expected parent's id,
and that an existing, unrelated call site (document indexing) still writes
`'[]'` unchanged.
