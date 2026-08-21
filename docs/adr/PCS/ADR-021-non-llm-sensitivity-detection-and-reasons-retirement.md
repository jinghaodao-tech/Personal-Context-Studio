# ADR-021: Retire the unused review-classification `reasons` gate; replace the planned LLM-based sensitivity detector with a non-LLM layered design

## Status

Implemented (deterministic layered detector and reasons retirement). The
semantic layer was upgraded from a trigram heuristic to a real embedding
model (2026-08-19) after an independent held-out validation set
(`test/auto-confirm-holdout-validation.test.ts`) showed the trigram approach
had combined recall 0.176 on paraphrases it was not tuned around, versus 1.00
on the tunable regression-floor set (`test/auto-confirm-evaluation.test.ts`)
-- confirming the original ADR text's prediction that a trigram heuristic
would not generalize. See "Semantic layer: trigram heuristic replaced with
embeddings" below.

**Verification update (2026-08-20):** the model now runs inside the sandbox
(the earlier `onnxruntime-node`/NuGet and `npm install` blockers were worked
around by installing the `@img/sharp-linux-x64`/`sharp-libvips-linux-x64`
optional binaries explicitly, since the mounted repo's `node_modules` had
only ever had its Windows binaries installed). All three auto-confirm test
files pass with the real Ruri-v3-30m model loaded, not a mock.

On the tunable regression floor (`test/auto-confirm-evaluation.test.ts`, 15
cases), the detector meets its gate (precision >= 0.75, recall >= 0.80) at
`SEMANTIC_SIMILARITY_THRESHOLD = 0.85`.

On the independent 22-case holdout (`test/auto-confirm-holdout-validation.test.ts`,
never edited to chase failures), measured combined precision is 0.923 and
**recall is 0.706** (semantic layer alone: precision 1.0, recall 0.706; the
keyword and value-PII layers contributed 0 true positives on this set by
construction, since its cases are paraphrases chosen to avoid literal keyword
tokens). The previously recorded `0.984 held-out recall` figure in
`semanticEmbedding.ts` came from a different, larger evaluation set built by
`tools/build-external-auto-confirm-eval.ts` / `tools/calibrate-auto-confirm.ts`
/ `tools/calibrate-external-semantic-grouped.ts` and `tools/external-eval-sources.json`,
not from this repo's own hand-built holdout set. Whether that external set is
a more representative sample of production text, or whether it happens to be
easier than this holdout set's deliberately adversarial paraphrases, has not
been checked. Therefore `0.984` is not this detector's repository validation
result; `0.706` on an untouched independent set is the more
trustworthy number available right now.

The holdout run also reproduces the known false positive on
`medication_reminder_app_name` ("薬" appears inside "服薬リマインダー" as a
substring): the word-boundary fix applied to the keyword regex's English
alternation does not extend to its Japanese tokens, since CJK text has no
word-boundary convention for `\b` to anchor on.

## Context

A review of the review/confidence pipeline surfaced two independent gaps.

**1. `POST /v1/experience/review-classifications`'s `reasons` requirement has
no real caller.** The endpoint (`apps/api/src/routes/experience.ts`) requires
a non-empty `reasons` array (free-form, format-validated only via
`/^[a-z0-9_:-]{1,80}$/i`, content never validated) before a value can be
classified `high_confidence`, alongside `confidence >= 0.9`, `sensitivity ===
"normal"`, and no unresolved conflict. Grepping the full app (`apps/`) for
every call site of this endpoint finds exactly one: `test/experience.test.ts`.
No MCP tool, dashboard UI, or CLI command calls it. The `reasons` field was
intended to force explicit justification alongside a bare confidence number,
but forcing a human to write that justification defeats the point of
automating classification in the first place, and nothing checks whether an
AI-supplied reason is actually true — so as designed, the field can only ever
be filled by a caller that does not yet exist, checked by validation that
would not catch a fabricated reason if it did.

**2. The auto-confirm detector (ADR-015, `apps/api/src/autoConfirm.ts`) is a
single hand-written regex, version `physiological-personal-v1`, matched only
against a field's `fieldKey`/`label`/`description` text, never against actual
value content.** Its own test suite (`test/auto-confirm.test.ts`) only
confirms the regex matches words already in its own keyword list — no
adversarial or held-out cases (e.g. "怒り", "収入", "性的指向", none of which
appear in the pattern) are tested, so no real precision/recall figure exists
for it. Extending this detector by routing it through `packages/ai-core`'s
already-integrated local LLM provider (default `llama3.2` via Ollama, per
`createLocalAiProvider`) was considered and rejected: a 3B-class general chat
model is not fit for a security-relevant classification task, its Japanese
performance is secondary to English, and the "elevated-consent" gate this
detector feeds is exactly the kind of AI self-report ADR-015 and ADR-020's
provenance work already treat with suspicion elsewhere in this project — using
an LLM's own uncertain judgment to decide whether a value skips human review
would reproduce the same anti-pattern this project has been actively removing.
A stronger local model (e.g. a 70B-class Japanese-tuned model such as Swallow)
would likely score better, but cannot run continuously on the individual's own
machine this product targets without GPU hardware most users of a local-first,
free tool do not have — trading detector accuracy for a hosting requirement
that breaks the product's own local-first premise.

## Decision

**1. Remove the `reasons` requirement and column from
`POST /v1/experience/review-classifications`.** `classification ===
"high_confidence"` continues to require `confidence >= 0.9`, `sensitivity ===
"normal"`, and no unresolved conflict; `reasons`/`reason_json` add no real
verification today and are dropped rather than kept as an unenforced, unused
field. If a future caller needs an audit trail for *why* something was
classified, it should be a structured, closed vocabulary checked against real
rules, not a free-form string nothing reads.

**2. Do not add an LLM to the sensitivity/auto-confirm detection path.**
Instead, evolve `autoConfirm.ts`'s single regex into three deterministic,
non-generative layers, each targeting a different gap the current detector
has:

- **Keyword layer (replaces the current regex):** rebuilt from Japan's
  Act on the Protection of Personal Information (個人情報保護法) Article 2(3)
  "要配慮個人情報" (special-care-required personal information) — the eleven
  cabinet-order categories: race, creed, social status, medical history,
  criminal record, crime victimization, physical/intellectual/mental
  disability, health-checkup results, guidance given based on those results,
  criminal proceedings as suspect/defendant, and juvenile protective
  proceedings — plus this project's own necessary extensions, since that
  legal list does not cover categories this product already treats as
  sensitive by design (mood, financial situation, sexual orientation are not
  legally "要配慮個人情報" in Japan but remain in scope here). This gives the
  keyword base a citable source instead of an ad hoc list, while acknowledging
  in the list itself that the legal category is a floor, not a ceiling.
- **Semantic-similarity layer (new):** a Japanese sentence-embedding model
  (e.g. a Sentence-BERT variant) embeds the field's key/label/description and
  compares it by cosine similarity against a curated set of exemplar phrases
  built from the keyword layer's categories, catching paraphrases the keyword
  list misses (e.g. "怒りの強さ" without the literal word the exemplar set was
  built around) without generating text.
- **Value-content PII layer (new, different scope than the other two):**
  `pii-ja-ner-onnx` (Apache-2.0, Japanese-BERT NER, ONNX/INT8, ~105MB,
  Hugging Face `ssl-jp/pii-ja-ner-onnx`) scans actual recorded *values* (not
  just field metadata) for explicit identifiers — name, address, phone,
  email, national ID, and similar — that the field-level detector cannot see
  by construction, since it only ever looks at how a field is labeled, not
  what gets typed into it.

All three layers are combined by OR, matching the asymmetric-risk principle
ADR-015 already established: any layer flagging a field requires elevated
consent, regardless of what the other layers conclude. No layer's "not
flagged" result may override another layer's "flagged" result. This is a
direct extension of ADR-015's existing three-independent-gate structure
(declared sensitivity, detector, elevated consent), not a replacement of it —
this ADR only proposes rebuilding the detector's internals, decision point 2
of ADR-015.

## Implementation

- `apps/api/src/autoConfirm.ts` now uses the versioned `non-llm-layered-v3-embeddings`
  detector: a cited-category keyword layer (with `\b` word boundaries on
  English tokens -- see below), an embedding-based semantic-similarity layer,
  and value-content PII patterns combined with OR semantics. Ingestion passes
  the actual value to the detector, so metadata and value risks are both gated.
  `autoConfirmClassification` is now `async`; its two production call sites
  (`apps/api/src/routes/entries.ts`, `apps/api/src/routes/templates.ts`) were
  updated accordingly. The candidates route precomputes all field
  classifications before opening its `BEGIN IMMEDIATE` transaction, rather than
  awaiting inside the write transaction.
- Migration `027_retire_review_classification_reasons` removes the unused
  `reason_json` column. The review-classification endpoint no longer requires,
  stores, or displays free-form reasons; high-confidence classification still
  requires confidence, normal sensitivity, and no unresolved conflict.
- Tests cover adversarial metadata, value PII, false-positive energy wording,
  migration idempotence, and the existing review flow. No LLM or external
  service is used.
- `test/auto-confirm-evaluation.test.ts` and `tools/evaluate-auto-confirm.ts`
  provide a versioned labeled hold-out set and report per-layer plus combined
  OR-gate precision/recall. The current 15-case set reports combined precision
  1.00 and recall 1.00 across 15 labeled cases. This is a regression floor,
  not a population accuracy claim, and must grow with reviewed production
  examples -- it is not evidence of generalization, since its cases were
  written after seeing what the detector failed on (see next point).

### Independent held-out validation found the regression floor was not enough

`test/auto-confirm-holdout-validation.test.ts` is a separate, independently
constructed set (22 cases, drawn from the eleven 要配慮個人情報 legal
categories and this product's stated extensions, phrased without looking at
what the detector currently gets wrong -- see that file's header comment for
the full method and its stated limits). Run against the trigram-based
semantic layer, combined recall collapsed to **0.176** (3/17 true positives),
versus 1.00 on the tunable regression-floor set. This confirmed the original
semantic-layer design intent in this ADR (embeddings, not trigram overlap)
was correct, and that the regression-floor set alone cannot be trusted as a
generalization claim.

The same holdout run also found a real precision bug: the keyword regex had
no word-boundary anchoring, so the literal token `name` matched inside
compound field keys like `diet_app_name` (a common naming convention:
`app_name`, `user_name`, `file_name`). Fixed by wrapping English tokens in
`\b...\b`; Japanese tokens are left as substring matches since CJK text has
no analogous word-boundary convention in JavaScript's regex engine.

### Semantic layer: trigram heuristic replaced with embeddings

The trigram `semanticSimilarity` function and its exemplar list are retired.
`apps/api/src/semanticEmbedding.ts` replaces it with `cl-nagoya/ruri-v3-30m`
(Apache-2.0, Japanese-specific sentence embeddings, JMTEB avg 74.51 at 37M
parameters -- notably higher than `intfloat/multilingual-e5-small`'s 69.52 at
3x the parameter count), loaded via the official ONNX conversion
(`onnx-community/ruri-v3-30m-ONNX`) through `@huggingface/transformers`, so no
Python runtime or manual ONNX conversion is required. The exemplar list was
expanded to one representative phrase per legal category (previously several
categories -- race, creed, social status, criminal record, victimization,
disability, juvenile proceedings -- had no exemplar at all), since embeddings
compare meaning rather than character overlap and should not need multiple
phrasings per category the way the trigram approach did.

`@huggingface/transformers` pulls in `onnxruntime-node` (depends on a
vulnerable `adm-zip` under 0.6.0) and `sharp` (vulnerable libvips CVEs under
0.35.0), both flagged high-severity by `npm audit` with no available fix at
the versions `@huggingface/transformers` itself pins. Both have fixed
versions upstream; `package.json` pins them via `overrides` (`sharp:
^0.35.2`, `adm-zip: ^0.6.0`), verified to bring `npm audit` to zero
vulnerabilities. `sharp` is pulled in for `@huggingface/transformers`'s image
pipelines, which this text-only use case never invokes.

**This part is unverified end-to-end**, see Status.

## Alternatives Considered

- **Route sensitivity detection through the existing local LLM
  (`packages/ai-core`), current default model:** rejected — see Context; a
  3B-class model's judgment on a task this consequential is not
  meaningfully better than the current keyword-only regex, while adding
  latency (hundreds of ms to seconds per check versus micro/milliseconds for
  the layers proposed here) and making test coverage non-deterministic.
- **Route sensitivity detection through a stronger local LLM (e.g. a
  70B-class Japanese-tuned model):** rejected for this product's constraints
  — plausibly higher accuracy, but requires GPU hosting most users of a free,
  local-first personal tool will not have, and inference latency (seconds to
  tens of seconds) does not fit a check meant to run synchronously at
  ingestion/auto-confirm time.
- **Microsoft Presidio as the PII layer instead of `pii-ja-ner-onnx`:**
  rejected — Presidio is Python; PCS is Node/TypeScript end to end
  (`--experimental-strip-types`, `node:sqlite`, no existing Python runtime).
  Adopting it would mean supervising a second language runtime as a separate
  process/service (a new `apps/supervisor` child, a new HTTP boundary) purely
  to detect PII, where `pii-ja-ner-onnx`'s ONNX distribution can be loaded
  in-process via `onnxruntime-node` with no new runtime dependency.
- **Cloud DLP (Google Cloud DLP / AWS Macie) as the PII layer:** rejected —
  requires sending field/value content to an external API, which is exactly
  the kind of disclosure ADR-016's external-AI consent flow exists to gate
  explicitly. Using it silently inside the sensitivity detector itself (the
  mechanism that is supposed to decide whether something is safe to expose
  further) would be a contradiction, not just an inconsistency.
- **Keep the `reasons` field for future use:** rejected — an unenforced,
  unread field that exists only to be filled in by test code is not "future
  scaffolding," it is a gap that looks like a control until someone checks.
  Re-add a reasons/justification mechanism only when there is a real caller
  and a real check on its content.

## Consequences

- The no-LLM direction, three deterministic layers, and `reasons` retirement
  are implemented. The value PII layer is intentionally a bounded local
  pattern detector rather than a bundled ONNX model, keeping the core install
  dependency-free; a future ONNX model can replace that layer behind the same
  interface after a measured evaluation.
- The labeled evaluation set is now present and runs in CI. It is intentionally
  small and must be expanded with reviewed examples before treating the metrics
  as representative of production traffic.
- The value-content PII layer (`pii-ja-ner-onnx`) has a different scope than
  the other two (it reads values, not field metadata) and can be adopted
  independently of the keyword/embedding rework — it does not require this
  ADR's other decisions to ship first.
- Removing `reasons` is a small, low-risk change (no production caller
  depends on it today, per the Context grep) and does not depend on the
  detector rework landing first.

## Reversal

Revisit the "no LLM" decision if a local model becomes practical to run
continuously on typical individual hardware at accuracy meaningfully better
than the layered non-LLM design, measured against the same labeled
evaluation set this ADR requires before shipping the non-LLM layers in the
first place — the decision is about today's cost/accuracy/latency trade-off,
not a permanent position against AI-assisted detection.
