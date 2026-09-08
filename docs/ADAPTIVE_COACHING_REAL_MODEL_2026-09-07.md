# Knowledge-Bounded Adaptive Coaching

Dates: 2026-09-07 to 2026-09-08. This implementation follows the meeting's request to refine
systemic-risk questioning before expanding the chapter. Results here belong to
this task, not the earlier audit or first-turn activation report.

## Implemented Boundary

The knowledge package now includes `coaching-policy.json`: five diagnostic
dimensions, L1-L4 criteria, five routing rules, 15 question forms, ten stage
presentation contracts, and the existing five-dimension score criteria.
The policy is explicitly `project_custom` and `draft`, not teacher-approved.

| Diagnostic dimension | Three approved forms |
| --- | --- |
| Concept boundary | Independent definition, boundary discrimination, contrast |
| Assumptions and conditions | Prerequisite, changed condition, failure boundary |
| Causal mechanism | One causal step, missing link, feedback test |
| Supporting evidence | Exact support, fact versus inference, consistency check |
| Transfer | New example, structural transfer, counterexample |

The real model first extracts candidate evidence from the student's actual
answer. The server checks IDs, quotations, confidence, contradictions, question
requirements, and independent verification. It derives the current gap and
eligible forms from the versioned knowledge rules. The model then selects an
allowed question form and opening. It cannot return new facts, scores, stages,
or arbitrary question text. Case facts and fixed stage instructions are
inserted verbatim by the server after selection.

This is bounded adaptive selection, not unrestricted conversational generation.
The two calls have distinct jobs: candidate evidence extraction and teaching
strategy selection. Goal presentation, diagnosis, follow-up, hints, cases,
Feynman explanation, reflection, report presentation, resume verification and
targeted retry all use the configured real provider in the local preview.
Report numbers and final judgments remain server-derived.

Question choice excludes previously used forms where an eligible unused form
exists, then avoids immediate repetition where possible. Diagnostic breadth,
independent mastery checks, case verification and round limits remain in force;
uncertainty is not converted into mastery just to advance a session.

## Evidence And Stability

- A focused follow-up evaluates the facet actually asked. Omitting an unasked
  whole definition does not erase previously established knowledge; passing a
  narrow follow-up alone does not award whole-target mastery.
- Feedback distinguishes quoted support, missing criteria, contradictions and
  evidence needing verification. Reports identify the next unmet rubric tier.
- Canonical questions are stored separately from feedback containing untrusted
  student quotations. A quoted answer cannot become a trusted system prompt.
- The latest assessment is identified explicitly, not by JSON object order.
- Exact normalized whole-answer duplicates are not independent evidence.
  Reusing legitimate terminology in a different explanation is not by itself
  classified as copying.
- Current question, target, prerequisite and case-critical-step evidence rules
  are supplied to assessment. One genuine quotation may support more than one
  semantically applicable evidence ID. The server does not invent missing IDs.
- Calibration inputs use the same explicit rule contract as learning inputs.
- Assessment also receives the twenty rubric-tier evidence rules, separately
  from the current question's requirements. It retains demonstrated abilities
  without treating unasked rubric content as a current-question gap. The live
  regression requires a positive concept score for explicitly demonstrated
  conceptual scope; workflow completion alone is insufficient.
- Invalid model selections, authentication failures and exhausted retries do
  not save a new answer, consume a hint, advance a phase or increment a round.
  No silent Mock fallback is used.
- Model calls occur outside database transactions. Existing optimistic locking,
  idempotency checks and per-student case-reservation locks are retained.

Scores are deterministic for the same validated evidence and version, and a
saved report is stable on reload. This does not assert that fresh stochastic
model assessments of equivalent wording are perfectly identical. Teacher-led
calibration is still required to quantify that variation. Bounded assessment
and selection calls use temperature zero in non-thinking mode; thinking mode
omits unsupported sampling parameters, following the official
[DeepSeek thinking-mode contract](https://api-docs.deepseek.com/guides/thinking_mode/).

## Local Preview

- URL: http://127.0.0.1:3102/
- Provider/model used in live checks: `deepseek` / `deepseek-v4-flash`.
- Persistent database: `.local-preview/v121/postgres`, port `55437`.
- Restart command: `pnpm preview`. This machine's ignored `.env.local` already
  opts into the real provider. Keys and pseudonym secrets remain server-only.
- Other development/test environments retain the explicit Mock default.
- Start a new learning session to use the updated content and prompt snapshot.
  Existing sessions and reports were not rewritten or silently migrated.
- The workflow fingerprint is `evidence-workflow-1.2.2-coaching`; knowledge,
  prompt and policy changes are included in version checks.

## Current-Run Verification

| Check | Result |
| --- | --- |
| `pnpm knowledge:validate` | Passed; both manifests validated |
| `pnpm lint` | Passed, zero warnings |
| `pnpm test` | 302 passed; 3 opt-in live smoke tests skipped |
| `pnpm build` | Passed; isolated `.next/adaptive-coaching-build` |
| `pnpm typecheck --incremental false` | Passed after generated-path cleanup |
| Core knowledge Playwright, desktop and mobile | 4 passed, isolated Mock database |
| Real full-loop browser scenarios | 2 passed: mastery and gap/retry, including the concept-evidence regression |
| Real first-turn desktop/mobile | 2 passed with actual DeepSeek calls |

Final first-turn assessment metrics (not strategy-call totals): desktop used
3,634 input / 766 output tokens in 3,948 ms; mobile used 3,634 input / 779 output
tokens in 3,628 ms. Both recorded `SUCCESS` and zero retries. The final mastery
loop recorded 17 successful real strategy calls and a stable saved report.
The gap/retry loop recorded 22, for 39 real strategy calls across both loops;
evidence-assessment calls are additional. Together these traces cover all ten
stage kinds. The round-limit branch correctly proceeds to reflection directly;
the mastery branch separately covers independent Feynman explanation.

The final synthetic mastery report scored 100 with no remaining gaps. The
incomplete-reasoning report scored 20 overall, including 75/100 (15/20 in the UI)
for concept completeness, retained one transfer gap and created a retry session.
These values describe the two synthetic runs, not validated pedagogical anchors.
Artifacts are under `.local-preview/adaptive-coaching-verification-2026-09-07/`
(`real-rubric-final`, `real-first-turn`, and `mock-core`); earlier runs remain
separate. Screenshots of the final desktop report and mobile feedback were
inspected, with no horizontal overflow in the checked browser assertions.

The live full-loop test uses synthetic students and actual HTML interactions,
including hints and resume verification, and matches saved strategy traces to
successful DeepSeek usage records with nonzero tokens. It does not alter the
database to force learning progress. Its `mastery` scenario checks the report
and disabled retry when no gap remains; `gap-retry` exercises incomplete
reasoning and the resulting targeted retry. The synthetic accounts are removed
by exact random email and student role. No original student is a test subject.

Reproduce with installed Chrome, `PREVIEW_BASE_URL`, loopback
`PREVIEW_DATABASE_URL` naming `thinktutor_preview`, and explicit live opt-in:

```powershell
$env:pnpm_config_verify_deps_before_run='warn'
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH='C:\Program Files\Google\Chrome\Application\chrome.exe'
$env:PREVIEW_BASE_URL='http://127.0.0.1:3102'
# Set PREVIEW_DATABASE_URL to the configured local preview database.
$env:RUN_PREVIEW_LIVE_FULL_TEST='true'
pnpm preview:check preview-e2e/real-model-loop.spec.ts --project=preview-desktop
$env:RUN_PREVIEW_LIVE_TEST='true'
pnpm preview:check preview-e2e/real-model.spec.ts
```

An early real run stalled when the model omitted overlapping evidence IDs.
The executable-rule context and extraction instructions were corrected before
rerunning. A later run reached a complete report but the test incorrectly
expected a retry for a no-gap answer; separate mastery and gap scenarios now
verify both legitimate outcomes. A gap-scenario fixture also recycled earlier
answers and was blocked by independent-evidence checks; reflection now uses
separate texts and fixture exhaustion fails explicitly instead of cycling.
Subsequent live calls exposed repeated non-verbatim model quotations. Strict
validation rejected them, and bounded retries now add an explicit instruction
to copy contiguous original text without paraphrasing, combining fragments or
echoing invalid model output. No failed attempt is counted as a pass.

A subsequent run passed the workflow but undercounted a weak answer's concept
evidence: `systemic_scope` was present while `financial_system_scope`, required
by the concept rubric, was absent. Its zero score was not accepted as proof of
semantic correctness. Assessment now receives the rubric rules as well as the
active question rules; numeric thresholds are unchanged and no evidence is
automatically filled in. The final live checks include the nonzero-concept
assertion above. This remains an engineering regression, not teacher calibration.

The pre-existing pnpm `allowBuilds` discrepancy and PostgreSQL concurrent-query
deprecation warning remain. Dependencies and lockfiles were not replaced.

## Not Claimed

Other chapter topics have not been populated without their teaching materials.
The 15 forms are question strategies, not 15 teacher-calibrated model-answer
sets. This task does not establish student learning gains, Golden Set approval,
teacher acceptance, formal knowledge publication or Alibaba Cloud production
acceptance. The existing dirty worktree was preserved; no commit or push was
performed for this task.
