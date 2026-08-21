# ADR-022: Integration Doctor -- a conformance diagnostic layer for external connectors

## Status

Proposed; v0.1 mostly implemented. `packages/integration-doctor` now has the
Manifest/DiagnosticResult types and checkers 1-3 of 5 (Static Manifest,
Transport, Authentication/Permission), plus `test/integration-doctor.test.ts`
and `test/integration-doctor-auth-permission.test.ts` (22 cases total, all
passing, `npx tsc --noEmit` clean). checker 1's suite runs against MeTheory's
actual manifest file read straight off disk
(`MeTheory/docs/metheory-pcs-connector.manifest.json`), not a synthetic
example -- it reports `PASS` with 9 checks and 0 errors.

checker 3 deliberately does not probe the three write permissions
(`submit_template_request`, `submit_import`, `append_markdown_template`):
doing so for real would create real data, and v0.1 has no dry-run path (see
Sequencing). It reports those as explicit `INFO` "not probed" results
instead of skipping them silently or claiming a verification it didn't do.
It also cannot detect *excess* permissions a token holds beyond what the
manifest declares -- the only endpoint that lists a client's actual granted
permissions (`GET /v1/integration-clients`) requires PCS admin
credentials, which a connector's own self-diagnostic run should not need
(this was originally proposed as a checker 3 responsibility; it is now
recorded as unimplementable within this design's own privilege boundary,
not merely deferred).

checker 4 (Contract) is also implemented: it wraps `validateContextAnalysisSnapshot`
rather than reimplementing it, and additionally checks the response's
`contractRevision` against the manifest's declared `[minimumRevision,
maximumRevision]` range. A real limitation surfaced while testing it:
`validateContextAnalysisSnapshot` requires an *exact* match against a single
hardcoded revision constant per schema version -- it has no concept of an
acceptable range itself. So a payload can never reach this checker's range
comparison carrying a revision PCS's own validator wouldn't already accept.
In practice this means the range check only ever fires usefully in one
direction: PCS emits a revision it genuinely supports, but the *manifest*
wasn't updated to include it (a stale manifest), not PCS drifting to
something the manifest failed to anticipate. That second direction only
becomes possible if PCS ever accepts more than one contractRevision at once
(e.g. during a migration window) -- not true today. 29 tests total across
all four checkers, all passing, `tsc --noEmit` clean.

The Authentication/Permission startup check is wired into MeTheory's own API
server (`apps/api/src/pcsDoctor.ts`, called once from `server.ts` after
`server.listen`, gating the one PCS-touching endpoint that previously had no
graceful-degradation path). This is the "check once at boot" tier, not a
resident/polling tier -- see that file's own header comment for the
reasoning and for how a periodic re-check could be added later without new
infrastructure, if ever needed.

Getting MeTheory to actually resolve `personal-context-studio/integration-doctor`
surfaced a real packaging gap, now fixed: this repo's root `package.json`
had no `prepare` script, so the only way a git-dependency consumer like
MeTheory could get `packages/*/dist` was for someone to build it locally and
force-commit the `.gitignore`d `dist/` folder by hand before every push --
which is what `packages/integration-contracts/dist` had been doing
silently. Added `"prepare": "npm run build:contracts && npm run
build:integration-doctor"`; npm runs a git dependency's `prepare` script
automatically after installing its devDependencies, so `dist/` is now
generated at install time for every consumer, not committed by hand.
Verified by running `npm run prepare` directly and confirming both
`dist/index.js` files were freshly rewritten and all 29 tests still pass
against the regenerated output.

**End-to-end verification, on real hardware (not this sandbox):** after
pushing (commit `b3195f0`), bumping MeTheory's pinned commit, and running a
real `npm install` on the user's own machine, `personal-context-studio/integration-doctor`
resolved successfully and `npx tsc --project tsconfig.json --noEmit` in
MeTheory passed with zero errors -- the only error blocking this in-sandbox
throughout (`Cannot find module 'personal-context-studio/integration-doctor'`)
is gone on a real network. `npm audit` on MeTheory initially still showed
the same 2 high-severity vulnerabilities (`sharp`, `adm-zip`) already fixed
in this repo via `overrides` -- because npm `overrides` only apply to the
package at the root of a given `npm install`, not to a package installed
*as* a dependency. PCS's own `overrides` fixed PCS's own install; it did
nothing for MeTheory's install of PCS. Fixed by adding the identical
`overrides` block to MeTheory's own `package.json`; re-running `npm
install` there brought MeTheory's audit to 0 vulnerabilities too. Any
future git-dependency consumer of this repo will need to copy the same
`overrides` block for the same reason -- worth a line in this repo's own
README or a follow-up ADR if a third connector is ever added.

Remaining for v0.1: a CLI command wiring all four checkers together end to
end for manual/CI use (the startup path above already wires them together
programmatically, just not as a standalone command). Checker 5 (Semantic
Invariant) and capability dry-run probes stay deferred per Sequencing below.

**Correction, and the scoping note that replaces an earlier wrong one:** an
earlier draft of this ADR claimed no real connector exists. That claim was
checked and was wrong. `MeTheory` (`apps/api/src/personalContextClient.ts`)
already calls PCS's real, live integration endpoints --
`GET /v1/context/analysis-snapshot`, `GET /v1/context/analysis-snapshot-v3`,
and `POST /v1/integration-template-requests` -- from three real route
handlers (`server.ts:573`, `607`, `902`), configured via
`PCS_API_URL`/`PCS_CLIENT_ID`/`PCS_CLIENT_TOKEN`/`PCS_PROFILE_ID`. What is
true, and is the actually relevant gap: MeTheory does **not** depend on
PCS's own `packages/integration-sdk`. It hand-rolled its own client class
(also, confusingly, named `PcsIntegrationClient`) that reuses
`integration-contracts`'s *types* but reimplements the loopback check, the
request/error-mapping logic, and its own richer error-code vocabulary
(`pcs_permission_forbidden`, `pcs_profile_scope_required`, etc., each with a
human-readable remediation string) independently of the SDK package.

This changes what "no real connector to validate against" actually means
for this ADR: the Doctor does not need a *new* connector wired up to have
something real to check, because checkers 1-4 (Manifest, Transport,
Authentication/Permission, Contract) validate against a manifest plus live
HTTP calls to PCS -- they do not care which client library the connector
uses internally. What's genuinely missing is a Connector Manifest describing
MeTheory's real, already-deployed usage. `StudyGraph` remains illustrative
only, used above purely to keep the manifest example readable; it does not
exist. The "Sequencing" section below reflects the corrected picture.

## Context

PCS already has three pieces of real integration infrastructure:

- `packages/integration-contracts`: versioned request/response validators
  (`validateContextAnalysisSnapshot`, `validateIntegrationImport`,
  `validateIntegrationTemplateRequest`), a `localPcsUrl` loopback-only
  constraint (`pcs_localhost_required`), and a `PCS_ANALYSIS_CONTRACT_REVISION`
  string surfaced on `GET /v1/context/analysis-snapshot`.
- `packages/integration-sdk`: `PcsIntegrationClient` (`getAnalysisSnapshot`,
  `submitTemplateRequest`, `submitImport`) and `PcsManagementClient`, both
  built on the same validators.
- `apps/api/src/integrationAccess.ts`: a fixed permission set
  (`read_snapshot`, `submit_template_request`, `submit_import`,
  `append_markdown_template`), token-scoped by allowed Context Profile IDs
  (ADR-009), with error codes `integration_authorization_required`,
  `integration_profile_scope_required`, `integration_profile_forbidden`.

What's missing is a way for an external tool -- or a developer working on
one -- to answer "is my connection to PCS actually correct, and if not,
which layer is broken?" in one deterministic pass, instead of by reading
HTTP status codes and validator error strings one at a time. Today that
diagnosis is implicit: an integrator finds out their client is missing
`submit_import` only when a real import attempt returns 401, and finds out
their manifest of assumptions is wrong only when a schema validator throws
mid-request.

This gap matters more, not less, because both connectors that already exist
-- MeTheory (`read_snapshot`, `submit_template_request`) and dev-pace
(`submit_import`, via a scheduled daily pipeline; see Sequencing) -- were
built by the same person who built PCS, working from memory of its contract
rather than from a corrected-by-experience integration. A deterministic
conformance report catches drift between what a connector's code assumes and
what PCS actually requires before that drift becomes a debugging session.

## Decision

Build a three-part system: **Connector Manifest** (a static declaration an
external tool makes about what it needs from PCS), **Integration Doctor**
(a diagnostic engine that checks a manifest and a live connection against
PCS's actual contract, permissions, and behavior), and a **Diagnostic
Result** type (a structured, versioned report the Doctor produces).

### Design principle: diagnose, don't repair

The Doctor's job is limited to `detect` / `diagnose` / `explain`. It never
does any of the following, even when it could infer the fix with high
confidence:

- Guess at a likely cause using an LLM
- Rewrite a connector's permissions or grant scope
- Reissue or rotate a token
- Change PCS configuration
- Modify the connector's code

This mirrors the boundary ADR-016 draws for local AI use and the separation
ADR-006 draws between management and integration access: PCS's posture
toward anything external is to constrain and report, not to act on its
behalf. A tool that could silently repair permission drift is a tool that
could silently widen access; keeping Doctor read-only-and-diagnostic keeps
that risk out of scope entirely.

### Connector Manifest

An external tool declares its requirements once, versioned, e.g.:

```json
{
  "manifestVersion": "pcs-connector-manifest-v1",
  "connectorId": "studygraph",
  "displayName": "StudyGraph",
  "sourceSystem": "studygraph",
  "pcsContract": { "minimumRevision": "pcs-analysis-snapshot-v3.0", "maximumRevision": "pcs-analysis-snapshot-v3.x" },
  "permissions": { "required": ["read_snapshot", "submit_import"], "optional": ["submit_template_request"] },
  "capabilities": { "readSnapshot": true, "submitImport": true, "submitTemplateRequest": false }
}
```

`connectorId` and `sourceSystem` reuse the existing `validSourceSystem`
pattern (`/^[a-z][a-z0-9_-]{0,63}$/`) from `integration-contracts`, so a
manifest that would be rejected by PCS's own validators is rejected by the
Doctor's static check before any network call. `permissions.required` must
be drawn from `integrationAccess.ts`'s existing `integrationPermissions`
list (`read_snapshot`, `submit_template_request`, `submit_import`,
`append_markdown_template`) -- the Doctor does not invent its own permission
vocabulary.

The Doctor never infers what a connector needs from its name or type; it
only checks the manifest the connector authored against reality. This keeps
the Doctor's checks fully deterministic and keeps the burden of declaring
intent on the connector, not on PCS guessing that intent.

### Checkers

Five checkers, each answering a narrower question than the last:

1. **Static Manifest Checker.** No network call. Validates manifest shape,
   catches self-contradiction (e.g. `capabilities.submitImport: true` with
   `submit_import` absent from `permissions.required`).
2. **Transport Checker.** Reuses `localPcsUrl` to confirm the target is
   loopback-only, then confirms PCS is actually reachable and answering as
   PCS (not just "something is listening on that port").
3. **Authentication / Permission Checker.** Rather than adding a new
   privileged diagnostics endpoint, this checker calls the *actual*
   integration endpoint each required permission maps to (e.g.
   `read_snapshot` -> `GET /v1/context/analysis-snapshot-v3` with the
   caller-supplied profileId) and classifies the result using PCS's own
   error vocabulary from `integrationAccess.ts`:
   `integration_authorization_required` / 401 means invalid credentials;
   `integration_permission_forbidden` / 403 means authenticated but the
   permission itself is missing; `integration_profile_forbidden` /
   `integration_profile_scope_required` mean the permission is granted but
   the client isn't scoped to the requested Context Profile; 200 means the
   permission is genuinely usable. Only `read_snapshot` has a safe,
   non-mutating endpoint to probe this way; the three write permissions
   (`submit_template_request`, `submit_import`, `append_markdown_template`)
   are reported as an explicit `INFO` "not probed" result rather than
   exercised for real, since doing so would create real data with no
   dry-run path to undo it (dry-run probing is v0.2+, see Sequencing).

   **Correction after implementation:** this checker was originally
   designed to also diff the manifest's declared permissions against what
   the client's token actually has, flagging *excess* permissions (a
   client holding `submit_import` it never declared needing) as a
   `WARNING`. That turned out not to be implementable within this
   checker's own privilege boundary: the only endpoint that lists a
   client's actual granted permissions is `GET /v1/integration-clients`,
   which requires PCS admin credentials -- and a connector's own
   self-diagnostic run should not need admin access to PCS just to check
   itself (the same reasoning Section "Design principle" gives for not
   adding a privileged diagnostics endpoint applies equally to reusing an
   existing privileged one). Excess-permission auditing remains a real gap
   nothing in PCS covers today, but it needs a management-side tool run by
   whoever holds the admin token, not something this checker can do with a
   connector's own credentials. This is out of scope for this ADR.
4. **Contract Checker.** Wraps the existing `integration-contracts`
   validators. Their current form (`throw new Error("context_analysis_value_invalid")`)
   is a fine boundary for request handling but a poor one for a diagnostic
   report, so this checker adds a thin adapter that turns a thrown
   validator error into a structured `{ checkId, status, code, message,
   location }` result rather than changing the validators themselves.
5. **Capability Probe / Semantic Invariant Checkers.** Deferred -- see
   Sequencing.

### Diagnostic Result

A single versioned shape every checker contributes to, with a fixed
severity scale (`PASS` / `INFO` / `WARNING` / `ERROR` / `FATAL`) and a fixed
error-code numbering convention so external code can branch on a stable
identifier instead of a message string:

```text
1xxx Manifest        4xxx Permission
2xxx Transport/Auth   5xxx Semantic
3xxx Contract         6xxx PCS Runtime
                       7xxx Connector Runtime
```

Both a human-readable CLI report and the underlying JSON are produced from
the same result; CI consumes the JSON, a developer running `doctor` locally
reads the text.

### What the Doctor does NOT introduce in this ADR

- No new "diagnostics" endpoint with elevated privilege. Every check either
  runs statically against the manifest or calls an integration endpoint
  that already exists at the permission level the connector's own token
  has.
- No automatic startup gating logic inside PCS itself. Whether an external
  tool treats a `DEGRADED` result as "disable this one feature" versus
  "refuse to start" is that tool's decision, not something PCS enforces.
- No `context_integration_diagnostics` history table in v1 (see Sequencing).

## Sequencing

Building the full five-checker system with dry-run write probes and a
compatibility matrix now would still mean designing checker 5 (Semantic
Invariant) against a write-path failure mode the Doctor has never actually
diagnosed, rather than a verified one: dev-pace is a real, working
`submit_import` connector (see below), but it has no Connector Manifest yet
and its contract shape (`IntegrationImportV1`) has no `contractRevision`
field for checker 4's range logic to key off, unlike the analysis-snapshot
flow checkers 1-4 were built and verified against. This ADR fixes the
following order:

- **v0.1 (this ADR's implementation target):** Connector Manifest type,
  Diagnostic Result type, error-code table, and checkers 1-4 above
  (Manifest, Transport, Authentication/Permission, Contract). Human-readable
  + JSON report. Also: write a real Connector Manifest for MeTheory's
  existing, already-deployed integration (`connectorId: "metheory"`,
  `permissions.required: ["read_snapshot", "submit_template_request"]`,
  reflecting what `personalContextClient.ts` actually calls today), so
  checkers 1-4 are validated against a real deployment from the start
  instead of a hypothetical one. No dry-run write paths, no capability
  probes beyond what checker 3 already exercises via `read_snapshot`, no
  semantic invariant checker, no diagnostic history table.
- **Before v0.2:** a real `submit_import` caller already exists --
  dev-pace (`dev-pace_public/pcs-adapter/adapter.py`). A local Rust CLI
  (`dev-pace`, private repo) records raw window-activity to local JSONL;
  `tools/aggregate_activity.py` reduces it to app-name-level daily
  aggregates only, per that repo's own ADR-001 privacy boundary (no window
  titles, file names, or URLs leave the machine); `pcs-adapter/adapter.py`
  converts each daily aggregate into an `IntegrationImportV1`-shaped
  payload (`active_minutes`, `ai_conversation_minutes`,
  `deep_thinking_minutes`, `window_switch_count`, `idle_minutes`,
  `away_minutes`, `hourly_active_minutes`) and `POST`s it to
  `/v1/integration-imports`; `run_daily_pipeline.ps1` chains aggregation
  and submission together and `register-daily-task.ps1` runs it as a
  scheduled Windows task. This corrects the claim this section previously
  made -- there is no need to invent a hypothetical second connector.
  What's still missing, and is genuinely tracked as separate work outside
  this ADR's v0.1 scope, is (1) a Connector Manifest for dev-pace
  (`connectorId: "dev_pace"`, `permissions.required: ["submit_import"]`,
  `capabilities: { submitImport: true, ... }`) and (2) a Doctor-side change
  to support import-only connectors: `IntegrationImportV1` has no
  `contractRevision`/`schemaVersion` field, so `ConnectorManifest.pcsContract`
  and checker 4's revision-range check -- both built around the
  analysis-snapshot flow -- need to become optional (or conditioned on
  `capabilities.readSnapshot`) rather than universally required, plus a
  `checkImportContract` sibling to the existing snapshot contract check
  that wraps `validateIntegrationImport` with no revision-range comparison.
  Only after both land does Capability Probe's import-side dry-run and any
  Semantic Invariant checks tied to writes stop being speculative.
- **v0.2+:** capability probes (including `dryRun` additions to
  `/v1/integration-imports` and `/v1/integration-template-requests`,
  explicitly validating without persisting), semantic invariants, and only
  then a compatibility matrix once a second connector exists to make one
  meaningful.

**Separately, not part of this ADR's scope:** whether to migrate MeTheory's
hand-rolled `personalContextClient.ts` onto PCS's shared
`packages/integration-sdk` is an independent decision with its own real
trade-offs (SDK currently lacks `getAnalysisSnapshotV3` and
`getTemplateRequest`, and lacks MeTheory's specific, user-facing
remediation error strings), and is not required for the Doctor to work --
Doctor validates against live HTTP behavior and a manifest, not against
which client class made the request. That migration, if done, should be its
own ADR.

## Alternatives Considered

**Per-connector ad hoc health checks.** Each external tool writes its own
"can I reach PCS" logic. Rejected: duplicates the same transport/auth logic
per connector, and produces no consistent way for CI or a maintainer to
compare conformance across connectors.

**Just expose the existing validators directly, no Doctor layer.** An
integrator could already call `validateContextAnalysisSnapshot` etc.
themselves. Rejected as insufficient on its own: a thrown `Error` with a
single string tells you *that* something is wrong, not *where* in a
five-layer stack (manifest / transport / auth / contract / semantics) the
problem originates, which is the actual question an integrator has when a
connection is broken.

**LLM-based diagnosis of failures.** Feed the failure and connector code to
a model and ask it to explain what's wrong. Rejected outright, not just
deprioritized: PCS's own precedent (ADR-016, and this session's own
ADR-021 experience of an unverified accuracy claim making it into a code
comment) is that non-deterministic components need independent verification
before their output is trusted, and a diagnostic tool whose job is to be
trusted when something is already broken is the wrong place to introduce
that risk. Every check in this design is either a static assertion or a
deterministic classification of an HTTP response.

## Consequences

New package `packages/integration-doctor` (manifest type, checkers, report
formatting, error/severity types) and a new CLI command
(`apps/cli/src/commands/integration-doctor.ts`) calling into it. No new
database tables in v0.1; no new PCS API endpoints in v0.1 (checker 3 reuses
existing integration routes). External connectors adopt the Doctor by
authoring a manifest and, if they want it wired into their own startup or
CI, importing `PcsIntegrationDoctor` from the SDK the same way they already
import `PcsIntegrationClient`.

The main risk this ADR accepts is building checkers 1-4 without a real
connector to validate them against immediately. That risk is bounded by
scope (v0.1 deliberately excludes the two checkers -- Capability Probe and
Semantic Invariant -- that would be hardest to get right without one) and
by the explicit Sequencing commitment to build a real connector call before
extending further.

## Reversal

If no second connector materializes and the Doctor never gets adopted
outside manual CLI runs, it can be deleted without touching
`integration-contracts`, `integration-sdk`, or any API route -- the Doctor
only ever reads from and calls into those, it does not change their
contract or behavior. Removing it is deleting one package and one CLI
command.
