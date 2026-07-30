# Usability Findings

## Implemented

- Browser dashboard is Japanese and supports the main flow without a CLI.
- Template Draft is reviewed before save, and activation is explicit.
- Entry input is JSON-per-field so false, empty string, unknown, and omitted remain distinct.
- Review decisions are per field and show source excerpt/staleness.
- Sharing Preview shows target, included count, omission reasons, estimated tokens, and fingerprint.
- Privacy and Backup are visible tabs rather than hidden maintenance commands.

## Follow-up

- Split the large dashboard HTML into a browser bundle when a frontend build is introduced.
- Add keyboard navigation and screen-reader labels to all dynamic dialogs.
- Add a field editor with type-specific controls instead of JSON text input.
- Add a visual diff for Template Version and Revision changes.