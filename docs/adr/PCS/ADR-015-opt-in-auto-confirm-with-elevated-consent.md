# ADR-015: Opt-in auto-confirmation for high-frequency fields, with elevated consent for physiological/personal categories

## Status

Implemented. See "Implementation" below for what shipped, what a follow-up
migration had to fix, and what still has no behavioral coverage.

## Context

ADR-002 requires a field-level human decision before any AI- or
integration-produced value is eligible for analysis or export. This remains
correct as the default: nothing should become analyzable without a human
having looked at it.

Real daily use surfaced a gap this default doesn't handle well
(`docs/usability-findings.md`, "Design tensions observed in real use"). A
high-frequency, low-stakes habit — a short daily check-in — was recorded by
writing Markdown directly into the watched folder (any editor, including an
AI assistant used as a plain text editor, can do this; PCS is
editor-agnostic by design). The field-level Review/confirm step ADR-002
requires never happened for these entries. The recording habit held up; the
data did not become confirmed, so MeTheory (which only ever receives
confirmed values, never Markdown bodies) never saw any of it. The
per-entry confirmation UI has a fixed cost that does not scale to daily
habitual recording.

A candidate fix is to let a Template mark specific fields as
`autoConfirmOnIngestion: true`, restricted to fields with declared
`sensitivity: normal`. This is not safe as a standalone gate, because
`sensitivity` itself is not always a value a human deliberately set for that
specific field:

- `apps/api/src/routes/templates.ts:136` silently defaults an omitted
  `sensitivity` to `"normal"` when an external integration submits a
  template field request.
- The AI-assisted template-draft generator
  (`packages/ai-core/src/index.ts`) infers `sensitivity` per field from the
  field's theme/label and returns it verbatim if it is one of the three
  valid values. The human review step for an AI draft is a raw JSON
  textarea with a warning ("the AI's draft is not final — review and edit
  before saving"), but nothing forces per-field review; a human can save
  without ever correcting a wrong AI guess.

Gating solely on `sensitivity: normal` therefore risks auto-confirming a
field whose "normal" label was never actually reviewed by a human.

Separately, the fields most central to this product's own domain model —
sleep duration/quality, fatigue, energy, mood, recovery (the same
categories `packages/self-understanding` already models in the sibling
MeTheory repository) — are exactly the fields most likely to fall under
physiological or personal-information categories, and are also exactly the
fields the low-friction goal exists to help with. A blanket permanent block
on auto-confirming these categories would defeat the purpose the daily-use
finding surfaced in the first place.

## Decision

Two independent, non-substitutable gates, modeled on the existing
`isSecretLike` pattern (`packages/domain/src/index.ts`), where a
rule-based, deliberately over-inclusive detector can block or add friction
to a value regardless of its declared sensitivity:

1. A Template field may be marked `autoConfirmOnIngestion: true` only if
   its declared `sensitivity` is `normal`.
2. Independently of the declared sensitivity, every field is checked
   against a rule-based physiological/personal-information detector.
   Physiological information, for this detector, means: sleep
   (duration/quality), fatigue/energy/general condition, heart rate, blood
   pressure, body temperature, weight and other biometric measurements,
   menstrual cycle and reproductive health, symptoms, medication and
   treatment records, and subjective reports of bodily symptoms (e.g.
   headache, palpitations). Mood/mental-state fields are included in this
   detector on the side of over-inclusion, since the boundary between a
   physiological symptom report and a general sentiment is not reliably
   separable by keyword matching. Personal information, for this detector,
   means direct identifiers: name, contact details, address, and similar.
   This detector's role is not to block the field outright — it decides
   whether enabling auto-confirm for that field requires elevated consent.
3. If a field matches the detector, enabling `autoConfirmOnIngestion`
   requires a separate, explicit confirmation step distinct from the
   normal template-save action: a dedicated dialog stating that the field
   is classified as physiological or personal information, and that
   enabling auto-confirm means future values will be confirmed without
   per-entry review. This consent is given once per field, not once per
   entry, and must be re-shown if the field's declared sensitivity or the
   detector's classification changes.
4. If a field does not match the detector, enabling
   `autoConfirmOnIngestion` follows the normal template-editing flow, with
   no extra step.
5. A value confirmed through this path carries a distinct provenance
   (`auto_confirmed_low_sensitivity`), kept separate from
   `user_confirmed`, following the same pattern ADR-013 uses to keep
   `machine_measured` distinct from `user_confirmed`. An auto-confirmed
   value must remain distinguishable from a per-entry-reviewed one in
   history at all times.
6. Sensitivity declaration, the physiological/personal detector, and the
   elevated-consent step are independent and all required where
   applicable; none of them alone is sufficient. This redundancy is
   deliberate, so that a wrong guess in one place (e.g. an unreviewed
   AI-drafted sensitivity value) does not by itself produce an unreviewed,
   uncontested confirmed value.

This ADR does not change ADR-002's default. Without explicitly enabling
`autoConfirmOnIngestion` for a field, every entry for that field still
requires per-entry Review exactly as before.

## Alternatives

- **Gate solely on declared `sensitivity: normal`:** rejected. Sensitivity
  can be an unreviewed AI guess or a silent default on omission, so this
  alone does not guarantee a human ever judged whether the specific field
  is safe to auto-confirm.
- **Permanently block auto-confirm for any field matching the
  physiological/personal detector:** rejected. This would permanently
  exclude exactly the fields (sleep, mood, fatigue, energy) the
  low-friction goal exists to help with, reproducing the friction problem
  `docs/usability-findings.md` documents instead of resolving it.
- **Treat the existing AI-draft review UI (raw JSON textarea plus warning)
  as sufficient human review:** rejected. Nothing in that flow forces
  per-field confirmation before save; an AI's sensitivity guess can pass
  through unexamined. This gap is the direct motivation for this ADR.

## Consequences

- Fields with clearly non-personal, non-physiological semantics (project
  or task metadata, for example) get low-friction auto-confirm without
  extra ceremony once a human opts in at the Template level.
- Fields the detector flags require one deliberate, elevated confirmation
  before `autoConfirmOnIngestion` can be turned on — but only once per
  field, not once per entry, so a daily recording habit involving these
  fields can still become low-friction after that single step.
- Auto-confirmed values remain distinguishable from per-entry-reviewed
  values in the audit/history trail at all times.
- The detector should be tuned to accept a higher false-positive rate
  (flagging a field that did not need elevated consent, costing one extra
  confirmation step) over false negatives (missing a genuinely
  physiological or personal field, which would let it slip into
  low-friction auto-confirm unexamined). This mirrors the asymmetric-risk
  principle already used in this project's other ADRs (see MeTheory
  ADR-014, "the failure mode would be asymmetric").
- Implementation work — the detector's exact pattern list, the consent
  dialog, the new provenance value, and its migration — is out of scope
  for this ADR and not authorized by it.

## Implementation

Landed in `2c09fce feat(pcs): implement opt-in auto-confirm consent`:
`apps/api/src/autoConfirm.ts` (`autoConfirmClassification`, the detector;
`autoConfirmAllowed`, the three-branch gate), migration
`023_opt_in_auto_confirm_elevated_consent` (adds
`auto_confirm_on_ingestion`, `auto_confirm_consent_granted_at`,
`auto_confirm_detector_version`, `auto_confirm_detector_flagged` to
`context_template_fields`), a new
`POST /v1/context-templates/:id/fields/:fieldKey/auto-confirm` endpoint
(`apps/api/src/routes/templates.ts`), and the ingestion-time check in
`apps/api/src/routes/entries.ts` (candidate creation) that only marks a
value `auto_confirmed_low_sensitivity` when the field is enabled,
`sensitivity === "normal"`, the stored detector snapshot is still fresh
(`detectorFresh`), and — if flagged — consent was already granted. Point 3's
"re-shown if sensitivity or the detector's classification changes" is
satisfied by two separate mechanisms rather than one: a sensitivity change
away from `normal` blocks auto-confirm outright at ingestion (gate 1, every
time), and a detector-classification change (e.g. a field's label/description
edited after consent) is caught by the `detectorFresh` staleness check, which
falls back to manual review rather than re-showing the dialog automatically.

That commit's own test addition (`test/migrations.test.ts`) only asserted the
migration applied and the new column exists — it did not exercise
`autoConfirmClassification` or `autoConfirmAllowed`, and no test called the
new endpoint or the ingestion path at all. Two things were found and fixed
while adding that coverage:

- **A real bug, not just a gap**: `apps/api/src/routes/templates.ts`'s
  success path calls `provenance({ subjectType: "template_field", ... })`,
  but `context_provenance.subject_type`'s CHECK constraint never allowed
  `"template_field"`. Every successful call to the new endpoint (enable or
  disable) threw a CHECK-constraint error and returned `500`— the feature
  could not be turned on for any field, flagged or not, until this was
  fixed. Fixed via migration `024_provenance_template_field_subject`
  (rename/recreate/copy/drop, the same pattern `022_remeasurement_revision_type`
  used for its own CHECK-constraint change) plus the matching `db/schema.sql`
  update.
- **Test coverage added**: `test/auto-confirm.test.ts` (unit-level,
  `autoConfirmClassification`'s regex detector across English/Japanese
  physiological and personal-info terms, and all three branches of
  `autoConfirmAllowed`) and `test/auto-confirm-flow.test.ts` (HTTP-level:
  sensitivity gate, no-consent-required path, elevated-consent-required
  path, ingestion auto-confirming both enabled fields with a provenance
  event and exclusion from the pending-review queue, and the
  `detectorFresh` staleness fallback to manual review).

**Dashboard UI added**: `apps/api/src/dashboard/client.ts`'s `viewTemplate`
dialog now has an "自動確定" column with a per-field toggle
(`autoConfirmCell`, `toggleAutoConfirm`). A non-flagged field toggles
directly; a `409 auto_confirm_elevated_consent_required` response opens a
dedicated consent dialog (`showAutoConfirmConsent`) carrying Decision point
3's wording before resubmitting with `elevatedConsent: true`; a
`409 auto_confirm_requires_normal_sensitivity` response reverts the toggle
and shows the reason via the existing `note()` mechanism. Verified against
the running API with `curl` (this environment has no browser to drive): the
non-flagged path returns `200` directly, the flagged path returns `409`
without consent and `200` with `elevatedConsent: true`, and
`GET /v1/context-templates/:id` reflects `auto_confirm_on_ingestion` in both
cases. No automated UI test exists for this (out of scope per the delegation
spec in `notes/study-log/2026-08-13-j2-delegation-cycle.md` — this
environment cannot drive a real browser either). "Re-shown if the field's
declared sensitivity or the detector's classification changes" is still
only enforced at the API layer (the `detectorFresh` check plus the
sensitivity gate) — the dialog is shown on every enable attempt that the API
flags, not proactively re-shown for an already-enabled field if its
classification silently drifts, since nothing currently polls for that.

## Reversal

Revisit if the detector's false-negative rate proves too high in practice
(a physiological or personal field is auto-confirmed without ever having
gone through the elevated-consent step), or if the elevated-consent dialog
itself becomes something users click through without reading, the same way
the current AI-draft warning is not enforced today. In either case, the
two-tier approach itself needs reconsideration, not just a tuning pass on
the detector's keyword list.
