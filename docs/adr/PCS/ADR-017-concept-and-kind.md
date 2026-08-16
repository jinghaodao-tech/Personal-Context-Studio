# ADR-017: Semantic Concept Registry and Assertion `kind`

## Context

PCS's recording model today is `template + field_key = value`. Two real limits
follow from that shape:

1. **Meaning is tied to the field, not preserved across redesigns.** If a
   template's field_key or question wording changes (`sleep_hours` today,
   `bedtime`/`wake_time` next year), there is nothing that says both were ever
   recording the same underlying thing. `analysis_role` on
   `context_template_fields` is the closest existing mechanism, and it already
   does real work (MeTheory's `sourceByRole` reads it), but it is a bare,
   unvalidated string annotation on one field of one template, not an
   independent entity with its own identity or metadata.
2. **All confirmed values look the same kind of thing.** `confirmation_mode`
   records *how* a value was confirmed (`user_confirmed` / `machine_measured`)
   but nothing records *what kind of claim* it is — an observation, a
   measurement, a stated preference, a decision, a plan, a claim read from an
   external source, or an inference. These are genuinely different: an
   `external_claim` should never be treated with the same default trust as a
   `measurement`, and MeTheory's own inferences must never be silently written
   back into PCS as if they were the user's observations.

A first draft of this ADR proposed storing `kind` directly on every
`context_values` row, classified per-assertion. That draft was rejected before
implementation. Per-value classification turned out to be unreliable in
practice for three concrete reasons: the observation/measurement boundary is
genuinely ambiguous for most self-reported data (a typed `sleep_hours: 6.5` is
not measured by an instrument); existing rows cannot be retroactively
classified from the stored value alone (`confirmation_mode='user_confirmed'`
does not disambiguate observation from preference from decision); and letting
AI infer `kind` on ingestion reopens exactly the problem ADR-002 exists to
prevent, just on a new axis.

PCS already has a working precedent for "this classification is not certain
enough to store as fact": `pcs_review_classifications` stores AI-derived
classification as a scored, non-authoritative estimate (`classification` +
`confidence`), never as a column asserted directly on the record it describes.
`kind` needed the same discipline.

## Decision

### Semantic Concept Registry

Add `context_concepts` (`id`, `concept_key` UNIQUE, `label`, `description`,
`unit`, timestamps) as an independent entity, and `context_template_fields
.concept_key` (plain TEXT, no enforced foreign key — matching the existing
`analysis_role` convention and avoiding `ALTER TABLE ADD COLUMN REFERENCES`,
which the rest of this codebase's migrations already avoid). A field that
declares a `conceptKey` causes PCS to upsert a `context_concepts` row for that
key. This is deliberately minimal for v1: no separate CRUD API, no required
pre-registration — concepts come into existence the same way `analysis_role`
values already do today, just backed now by a real entity that can carry a
description and unit rather than a bare string. `analysis_role` is left
untouched; the two can coexist, and `analysis_role` can migrate onto
`concept_key` gradually, field by field, with no forced cutover.

### Assertion `kind`: declared, not inferred

`kind` is one of `observation | measurement | preference | decision | plan |
external_claim | inference`, or absent (`unstructured`). It is never derived
by classifying an existing value. It can only enter the system through one of
two trusted paths:

- **Declared at write time, by something already trusted.** A template field
  can declare `default_kind` once, at design time, by the person building the
  template — the same trust level and mechanism as `sharing_default` and
  `sensitivity` already have. A specific write can also declare `kind`
  explicitly and override the field default: this covers both "an external
  tool's ingestion contract states the kind" (e.g. `accept-machine-measurement`
  accepting `measurement.kind` for a dev-pace import — dev-pace's contract
  already states `sourceTool`/`measuredAt`; `kind` is one more contract field
  the sender is trusted to state) and "a dedicated input UI lets a human pick
  the kind at the moment of capture," which are the same mechanism (an
  explicit value on the write request) with different trusted callers, not two
  separate code paths. Resolution order for any write: explicit `kind` on the
  request (validated against the enum) → the field's `default_kind` → `null`.
  `context_values.kind` is nullable specifically so this fallback needs no
  backfill migration: `GET /v1/context-entries/:id` computes each value's
  effective kind as `COALESCE(value.kind, field.default_kind)` at read time (a
  join against `context_template_fields`, not a stored value), so setting a
  field's `default_kind` after the fact retroactively covers every value
  already recorded under that field, including ones written before this ADR
  existed, without touching a single existing row. `addRevision` applies the
  same fallback when a value is next revised (correction, reconfirmation,
  review), so the resolved kind gets persisted onto the row itself the next
  time it changes for any other reason -- but a value's `kind` column can
  legitimately stay `NULL` indefinitely if it is never revised again; readers
  should use the COALESCE fallback, not assume the stored column is populated.
- **Proposed by AI, confirmed like everything else AI proposes.** When a
  candidate value comes from local AI extraction
  (`POST /v1/context-entries/candidates`), an AI-proposed `kind` is written to
  the same `context_values.kind` column as any other candidate, gated by the
  exact same `user_confirmed` flag the value itself is already gated by. This
  needed no new mechanism: `kind` rides along in the row that ADR-002 already
  treats as an unconfirmed candidate until reviewed. Confirming the value (via
  `POST .../review` or a manual correction) confirms its `kind` in the same
  action; there is no separate "confirm the kind" step, and no way for
  AI-derived `kind` to become authoritative without a human decision.

`kind` is orthogonal to `confirmation_mode`/`sharing`/`sensitivity`. An
`inference` can be `user_confirmed` (the user reviewed MeTheory's inference and
accepted it as accurate); a `measurement` can still be `sensitive`. Nothing
about `kind` should be read as a trust or visibility level — those remain the
job of the existing three axes.

Free-text Markdown documents (including the raw `webai-import/` documents from
ADR-016) do not carry `kind` at all; only values recorded through a
template field can. This is an accepted, permanent limitation, not a gap to
close later — forcing a kind onto unstructured prose would just recreate the
per-value classification problem this ADR already rejected once.

`kind` has an explicit `CHECK` constraint, unlike `confirmation_mode` (which
has none today, apparently by oversight rather than intent). `kind`'s entire
value is being a controlled vocabulary; leaving it freeform would defeat that.

## Consequences

- No backfill migration for existing `context_values`/`context_value_revisions`
  rows: `kind` is nullable everywhere, and effective kind is always resolved
  as `value.kind ?? field.default_kind` rather than stored per row at
  migration time.
- Template authors get one more optional field-level declaration
  (`default_kind`) alongside `sharingDefault`/`sensitivity`; nothing existing
  breaks if it is left unset.
- `POST /v1/context-entries/candidates` and `POST /v1/context-entries` both
  gain an optional per-field `kind` in their request bodies, validated the
  same way `sharing`/`sensitivity` per-field overrides already are.
- `accept-machine-measurement`'s `measurement` object gains an optional `kind`
  field, applied uniformly to every field in that machine-measurement import
  (v1 scope: one declared kind per import event, not per field within it).
- This ADR intentionally leaves the integration-template-request
  auto-provisioning paths (external systems requesting whole new templates)
  without `concept_key`/`default_kind` wiring. Those fields stay `null` for
  templates created that way; nothing breaks, and the wiring can be added
  later without a migration.

## Rejected alternative

Per-value `kind` classification (letting the system, a human, or AI assign
`kind` to each individual assertion after the fact) was the original design
and was rejected: it cannot be done reliably for historical data, the
observation/measurement/inference boundaries are too ambiguous to classify
consistently even for new data, and it would have reintroduced an
AI-confidence problem ADR-002 already solved for values, on a new column.
