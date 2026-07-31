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
