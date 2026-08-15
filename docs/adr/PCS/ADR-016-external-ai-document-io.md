# ADR-016: Document I/O for browser-based ("web") AI assistants

## Context

PCS's Markdown source is designed to be editor-agnostic: any tool that can write a
`.md` file into the watched `notesRoot` is an acceptable way to add a record
(`docs/usability-findings.md`: "any editor, including an AI assistant used as a
plain text editor, can do this"). This works for local tools, but not for a
browser-based ("web") AI assistant (a chat interface with no filesystem access) —
there is currently no way to (a) hand such an assistant the full content of an
existing document, or (b) take content composed with such an assistant and get it
into PCS, other than manually re-typing it into a locally-saved file.

Two independent gaps were confirmed by reading the code, not assumed:

- **Read**: `excerpt()` (`packages/documents/src/index.ts`) hard-caps output at
  `Math.min(8_000, maximumCharacters)` regardless of the caller's request. No
  endpoint returns a document's full, untruncated content. A document longer than
  8,000 characters can never be retrieved whole via the API.
- **Write**: every existing write path (`upsertDocument`, `POST /v1/documents`,
  the template-append routes) assumes the target `.md` file already exists on
  disk at `notesRoot`. There is no endpoint that accepts raw Markdown content and
  creates the file itself.

## Decision

### Export (PCS → web AI): reuse the existing external-AI consent primitive

`context_external_ai_consents` and `activeExternalAiConsent(scope, providerId,
host, documentId, templateId, fieldKey)` (`app.ts`) already implement exactly the
access-control shape this needs: consent scoped by provider × destination host ×
document (or field), revocable, audited. Today it only gates a pre-extraction
check (`POST /v1/privacy/external-ai/authorize-extraction` — "may this provider
read this document in order to propose field candidates"). This ADR extends its
use to a second, independent checkpoint: full-content export.

`GET /v1/documents/:id/export-for-external-ai?providerId=<id>&destinationHost=<host>`
returns the document's complete, untruncated content (bypassing the 8,000-character
`excerpt()` cap, since this is now an explicit, consented disclosure rather than a
passively-available excerpt) only if `activeExternalAiConsent("document",
providerId, host, documentId)` is true. Otherwise it returns `403` with
`{ error: "external_ai_consent_required", providerId, destinationHost }` so the
dashboard can prompt for one-time consent through the existing grant flow
(`POST /v1/privacy/external-ai-consents`).

A three-instance split (a separate "write-staging" PCS, a separate "certified for
output" PCS, and the core PCS) was considered and rejected: it would reproduce, at
much higher operational cost (duplicated data stores, sync logic between
instances), a form of access control PCS already has working, tested, and wired
into an audit trail. Adding one new checkpoint to the existing consent primitive
is cheaper and keeps a single source of truth.

### Import (web AI → PCS): no additional confirmation gate

A "content lands in a pending area, a human approves it" design was considered
and **rejected** — it conflates two different things. `ADR-002-human-confirmation.md`
constrains *unattended, automated* promotion of AI output to a trusted state
("AI and integrations create candidates only. A value is eligible for analysis or
export only after a field-level user decision."). Pasting a web AI's response into
PCS is not that: a human reads the assistant's output on screen and then
deliberately performs the save action. That save action *is* the human decision —
identical in kind to a human directly saving a locally-edited `.md` file into
`notesRoot`, which PCS already treats as immediately live with no extra
confirmation step. Adding a second, PCS-internal "click to approve" on top would
be a redundant check against a risk (unreviewed AI content becoming trusted
without any human involvement) that does not exist on this path, since a human is
always the one who initiates the write.

`POST /v1/documents/raw` accepts `{ content: string, title?: string, recordedAt?:
string }`, writes `content` to a new file under a dedicated `webai-import/`
subdirectory of `notesRoot` (named by a generated id, never by client-supplied
path segments, to foreclose path traversal), with `title`/`recordedAt` written as
frontmatter when supplied, then runs the same `upsertDocument` indexing path as
any other file. The resulting document is immediately `active` — no pending
state.

This does not touch ADR-002's actual subject (structured field candidates
produced by AI extraction, `context_entry_candidates`), which keeps its
confirmation requirement unchanged.

## Consequences

- The export endpoint means a document's full content only ever leaves PCS
  through a path that is (a) explicit (a specific provider + destination host),
  (b) revocable, and (c) audited — never a blanket "read everything" capability.
- The import endpoint means anyone who can reach the local API can create
  documents without human review at the point of creation *by PCS* — but this is
  no different from the pre-existing capability to write a file into `notesRoot`
  directly, which was already unguarded by design. No new capability is added
  from a threat-model perspective; an existing capability gets a second, HTTP-only
  entry point.
- `notesRoot/webai-import/` should be included in whatever backup/retention
  behavior already applies to the rest of `notesRoot` — it is not a separate
  storage location, just a naming convention within the same tree.

## Rejected alternatives

- **Three-instance split (staging PCS / certified-output PCS / core PCS)**:
  rejected, see above — duplicates existing consent machinery at much higher
  operational cost.
- **Pending-review gate on import**: rejected, see above — misapplies ADR-002 to
  a path that already has human mediation at the point of write.
