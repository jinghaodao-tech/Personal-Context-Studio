# ADR-009 Scoped Integration Disclosure

PCS keeps management access separate from Integration API access. Integration
clients authenticate with a one-time token that is stored only as a SHA-256
hash and receive explicit permissions. Clients may be limited to specific
Context Profiles; a scope mismatch returns integration_profile_forbidden.

Both Profile export and Integration snapshots use the same disclosure decision.
Unconfirmed, retracted, private, never, highly sensitive, purpose-disallowed,
invalid, and secret-like values are excluded with an omission reason. MCP uses
the Integration SDK and is read-only: credentials determine which read tools
are exposed, never whether writes are exposed.
