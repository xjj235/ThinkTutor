# Local Real-Model Activation

Date: 2026-09-07. This verification follows the separate coaching-depth task.
Results below were obtained during this activation task, not copied from the
earlier Mock verification report.

## Active Local Preview

- URL: http://127.0.0.1:3102/
- Actual provider/model: `deepseek` / `deepseek-v4-flash`.
- Readiness endpoint returned `ready`, database `ok`, provider `deepseek`.
- Existing persistent database: `.local-preview/v121/postgres`, port `55437`.
- Existing user answers, sessions and reports were not rewritten.
- API requests consume the configured account's quota. Credentials remain
  server-only and are not included in this report or tracked files.

The preview launcher previously forced Mock even though the existing `.env`
configured DeepSeek. It now loads local configuration and supports explicit
`PREVIEW_AI_PROVIDER=deepseek`. This machine's ignored `.env.local` persists
that setting together with its existing preview directory and ports.
Restart with `pnpm preview`; no manual environment overrides are required.

Other workspaces still default to Mock unless they explicitly opt in. Real mode
requires a DeepSeek API key and a dedicated pseudonym secret of at least 32
characters. Invalid configuration fails without silently falling back to Mock.
The homepage accurately labels the active provider, including on mobile.

## Real Output Validation

One repeated live check returned an evidence-validation error. The provider
previously retried generic JSON failures, but contextual evidence validation
occurred later, outside that retry boundary. The exact invalid field was not
captured; raw model output and credentials were not added to logs.

Assessment validation now constrains evidence and candidate IDs to the current
knowledge context, message references to the current answer, quotations to exact
substrings, and contradictions to extracted evidence. Existing bounded retries
apply before recording provider success. Invalid evidence is neither repaired
nor fabricated. Server-side state and scoring rules remain authoritative.
Learning sessions, calibration inputs, and direct test inputs supply the same
candidate-ID contract.

## Current-Run Checks

| Check | Final result |
| --- | --- |
| `pnpm lint` | Passed, zero lint warnings |
| `pnpm test` | 277 passed, 3 opt-in live smoke tests skipped |
| `pnpm build` | Passed, isolated `.next/real-model-check-build` output |
| `pnpm typecheck --incremental false` | Passed |
| `pnpm e2e e2e/knowledge-runtime.spec.ts` | 4 passed, desktop and mobile, isolated Mock database |
| `pnpm preview:check preview-e2e/real-model.spec.ts` | 2 passed, desktop and mobile, actual DeepSeek calls |

The opt-in real browser test uses HTML registration, task creation, goal
confirmation and first-answer submission. It checks the provider banner,
successful HTTP response, saved `KR_SR_1_2` assessment, visible quoted feedback,
and successful AI usage for that exact session. It deletes only its own
randomly named synthetic student account. Original student records are not used
as test inputs. Desktop/mobile screenshots were inspected and horizontal
overflow assertions passed for the checked pages.

| Final real call | Provider / model | Input tokens | Output tokens | Latency | Retries |
| --- | --- | ---: | ---: | ---: | ---: |
| Desktop | deepseek / deepseek-v4-flash | 2613 | 433 | 3268 ms | 0 |
| Mobile | deepseek / deepseek-v4-flash | 2615 | 726 | 4878 ms | 0 |

Real-call screenshots are retained locally under
`.local-preview/real-model-verification-2026-09-07/`. This directory is ignored
by Git. The test requires `RUN_PREVIEW_LIVE_TEST=true`, `PREVIEW_BASE_URL`, and
an explicit loopback `PREVIEW_DATABASE_URL` naming `thinktutor_preview`.
It uses installed Chrome through `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.

Earlier attempts exposed an HTML label mismatch, a hidden mobile banner, and
the contextual output-validation gap. Build/type checks also caught missing
candidate-ID inputs and an overly broad environment type; those were corrected
before the final passing runs. The first attempt was not entirely green.

The local pnpm installation reports a pre-existing `allowBuilds` configuration
discrepancy. Commands used process-level
`pnpm_config_verify_deps_before_run=warn`; no dependency reinstall or lockfile
change was made. PostgreSQL emitted its existing concurrent-query deprecation
warning. Temporary test databases and build output were separate from the
running real preview. Only this task's generated TypeScript paths were removed;
the pre-existing preview paths remain.

## Acceptance Boundary

The live checks establish actual model connectivity and first-turn evidence
persistence, not full multi-turn pedagogical quality or calibration. Automated
full-loop regression still uses Mock for reproducibility; the user-facing local
preview uses DeepSeek. Teacher review, Golden Set sign-off, knowledge release
publication and production-cloud acceptance are not claimed. This task did not
commit or push the dirty workspace.
