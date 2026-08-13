# Usability Findings

## Implemented

- Browser dashboard is Japanese and supports the main flow without a CLI.
- Template Draft is reviewed before save, and activation is explicit.
- Entry input is JSON-per-field so false, empty string, unknown, and omitted remain distinct.
- Review decisions are per field and show source excerpt/staleness.
- Sharing Preview shows target, included count, omission reasons, estimated tokens, and fingerprint.
- Privacy and Backup are visible tabs rather than hidden maintenance commands.
- Dashboard is served as a readable Japanese UTF-8 page with semantic navigation and accessible dialogs.
- Entry fields use type-specific controls for boolean, numeric, choice, text, and JSON values.
- Revision history shows before/after values as a visual diff.

## Future polish

- Split the dashboard into a separately bundled frontend when a dedicated frontend build is justified.
- Add richer visual diffs for complete Template Version objects.

## Design tensions observed in real use

Findings from actually running a daily recording habit against PCS, not from
design review. These are observations, not decisions — none of them modify
`docs/adr/PCS/ADR-002-human-confirmation.md`.

- **Per-field Review confirmation does not survive high-frequency, low-stakes
  entries.** A daily check-in (e.g. answering a short prompt every day) was,
  in practice, recorded by writing Markdown directly into the watched folder
  (any editor, including an AI assistant used as a plain text editor, can do
  this — consistent with PCS's editor-agnostic design). What did not happen
  is the field-level Review/confirm step ADR-002 requires before a value is
  eligible for analysis or export. The result: the recording habit itself
  held up, but the data was never confirmed, so it was structurally
  invisible to MeTheory (which only ever receives confirmed values, never
  Markdown bodies) for as long as the habit ran without a Review pass.
- **This is not evidence that ADR-002 is wrong.** The confirmation
  requirement exists precisely because AI- and integration-produced content
  must not become analyzable or exportable without a human decision, and
  that boundary should not be weakened for convenience. The friction is real,
  but it is proportional to *what kind* of data is being confirmed — a daily
  mood rating is not the same risk as a `highly_sensitive` field, and today
  both go through the identical UI-driven confirmation flow.
- **Follow-up:** `docs/adr/PCS/ADR-015-opt-in-auto-confirm-with-elevated-consent.md`
  (implemented in `2c09fce`, see the ADR's "Implementation" section for what
  shipped and what a follow-up migration had to fix) works through this — an
  opt-in
  `autoConfirmOnIngestion` Template setting gated on declared
  `sensitivity: normal` alone turned out to be unsafe, because sensitivity
  itself can be an unreviewed AI guess or a silent default. ADR-015 adds a
  second, independent physiological/personal-information detector that
  requires one-time elevated consent before auto-confirm can be enabled for
  a matching field, rather than either a permanent block (which would
  defeat the point, since sleep/mood/fatigue/energy are exactly the
  high-frequency fields this finding is about) or no additional check at
  all. ADR-002's manual-confirmation default is unchanged for every field
  that does not explicitly opt in.
