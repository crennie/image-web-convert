# Architecture cleanup: steps 7–12

Status: steps 7–10 complete; steps 11–12 remain pending.
Reviewed against the repository on 2026-09-24, after commit `4f01c51`.

This document preserves the intent of the supplied architecture-cleanup steps
7–12 while reconciling them with the completed
[asynchronous conversion plan](asynchronous-conversions.md). These are cleanup
step numbers, not additional phases of that six-phase migration. The initial request authorized saving this plan only. Steps 7–10 were subsequently
authorized and completed; implement later steps only when requested and record
their evidence here.

## Scope corrections from repository review

| Step | Current evidence | Remaining scope |
| --- | --- | --- |
| 7: upload ownership | `uploads.service.ts` already defines neutral `UploadInput`, owns counts/sealing, and rolls back outputs on session-write failure. The legacy controller maps multipart inputs. | Audit existing guarantees; apply ownership principles to the active operation boundary where needed. Do not rebuild the retired batch workflow. |
| 8: ZIP separation | `files.service.ts` uses Node `Writable`, not Express; controllers own responses. `writeZip` has error/close handling and tests. | Review and harden coordinated finalization/output settlement, teardown, and collision-safe archive names. |
| 9: upload claims | Legacy batch claims and shared session claims exist. Active runtime owns slot upload admission and operation creation coordination. | Verify concurrency and release behavior at the active application boundary, preserving parallel uploads to different slots. |
| 10: cosmetic progress | Legacy exports are already `useCosmeticProgress` and `CosmeticProgress`. The active route renders `ConversionOperationPanel`, with actual upload bytes and backend snapshots. | Audit retained cosmetic components only; preserve actual active progress and status. |
| 11: README | README already describes asynchronous operations, limits, storage, recovery, and real E2E testing. | Targeted corrections after the preceding audit/fixes; no synchronous lifecycle rewrite. |
| 12: API E2E | Eight real API process cases and six real browser cases already exist, plus five mocked browser integration cases. | Extend representative failure coverage using the existing harness; keep real E2E required in CI. |

The supplied 83-test count and historical coverage percentages are obsolete.
Re-measure during implementation rather than treating them as a baseline. The
previous completion log reports 360 tests overall, successful Chromium coverage,
and local Firefox/WebKit launch failures from missing native libraries. Those
results are historical evidence, not validation of future changes.

## Constraints and preserved behavior

- Use Node 22, npm, the existing lockfile, shared Zod contracts, and Nx targets.
  Do not add or upgrade production dependencies without explicit approval.
- Keep controllers/HTTP adapters responsible for transport and response mapping;
  application services own state transitions; storage/image code owns I/O.
  No DI framework, repository hierarchy, command bus, database, distributed lock,
  new queue, or event system. Preserve the existing process-owned scheduler.
- Keep filesystem primitives in `storage.paths.ts`; do not recreate the
  session/storage circular dependency.
- Preserve one operation per session, durable per-file acceptance and commits,
  partial success, completed downloads before aggregate completion, idempotent
  retries, cooperative cancellation, recovery, resource limits, and fixed expiry.
- Keep the retired synchronous upload endpoint returning 404. Preserve downloads
  for existing sealed legacy sessions. Broad legacy deletion/dependency cleanup
  remains outside this plan.
- Do not restore batch-wide sealing, output rollback, or a session-wide upload
  lock to the asynchronous workflow. Different file slots may upload concurrently
  within existing capacity limits.
- Do not implement a new step 13. The older prohibition on implementing real
  progress has been superseded by the completed asynchronous migration: preserve
  existing XHR progress, polling, and snapshots without designing new protocols,
  SSE/WebSockets, encoding percentages, or browser refresh recovery.
- Leave implementation changes uncommitted unless requested. No remote writes.

## Step 7 — Verify and finish application-state ownership

- [x] Audit and complete (2026-09-24)

Review `uploads.controller.ts`, `uploads.service.ts`, `storage.service.ts`, and
their existing tests. Confirm neutral filename/path/byte-count/client-ID inputs,
partial success, accepted-only counts, all-rejected batch sealing, and rollback
when legacy session persistence fails. Existing tests already cover these cases;
retain them without unnecessary rewrites or endpoint reactivation.

For the active path, inspect `conversions.controller.ts`, `conversions.http.ts`,
`conversion-runtime.service.ts`, `conversion-storage.service.ts`, and
`conversion-upload.service.ts`. The multipart receiver currently accepts Express
`Request`: treat it explicitly as a transport adapter, not application logic.
If relocation or a narrower input is warranted, make the smallest change and
retain socket-abort, deadline, staging, and cleanup behavior. Do not introduce a
generic transport abstraction just to rename a file.

Review the operation-create controller's session claim and legacy-used-session
checks alongside step 9. Move application invariants into the existing runtime
boundary if needed so non-HTTP callers receive the same protection. Keep auth,
boundary schema validation, HTTP statuses, and public response mapping at the
HTTP boundary. Preserve durable idempotency and existing error contracts.

Gate: affected tests and API coverage confirm ownership, partial/all-file failure,
persistence failure, and cleanup. Active committed results must not be rolled
back to reproduce legacy semantics.

## Step 8 — Harden transport-neutral ZIP completion

- [x] Audit and complete (2026-09-24)

Retain transport-neutral file resolution and the existing small `writeZip`
function. Keep headers, validation, missing-ID reporting, and HTTP error handling
in HTTP handlers, including `routes/conversion-files.routes.ts` and the
legacy `controllers/files.controller.ts`.

Review the current sequential `await archive.finalize(); await completed`:
an output error/abort can reject the completion promise while finalization is
still pending. This is a review finding to reproduce, not a confirmed test failure.
Ensure all promises have rejection handling immediately and every terminal path
settles promptly, tears down owned resources, and removes listeners as appropriate.
Cover finalize rejection, archive error, output error, premature close, and
successful output finish. Do not throw from event callbacks or leave finalization
waiting forever after an abort. Account for errors after response headers are sent
without attempting a second JSON response.

Preserve input order, Unicode/sanitized content disposition, partial missing-file
headers, and single downloads. Check name collisions involving both duplicate
basenames and existing suffixes, such as `a.webp`, `a.webp`, `a (2).webp`;
archive entry names must remain unique without reordering inputs.

Gate: service tests prove settlement/teardown; controller tests prove correct
forwarding and abort behavior. Existing real API/browser ZIP tests still decode
and compare archive contents. Add real HTTP streaming failure coverage where it
proves a boundary not established by deterministic stream tests.

## Step 9 — Verify active concurrency ownership

- [x] Audit and complete (2026-09-24)

Inspect `session-work.service.ts`, runtime `createOperation`/`beginUpload`, durable
storage mutation coordination, and the legacy batch tests. Reuse existing claims;
do not add another lock or widen a slot lock to the whole upload session.

Prove the current operation semantics:

- Concurrent creation respects one operation/session and idempotent retry rules.
- Concurrent writes to the same unaccepted slot reject predictably before a
  second conversion/acceptance; accepted-slot retries remain idempotent.
- Different slots and sessions can proceed within configured admission limits.
- Success, transport failure, storage failure, cancellation, and deadline expiry
  release ownership at the correct boundary. A timeout must not release capacity
  while its transport or native conversion still owns resources.
- Rejected requests cannot stage durable duplicate inputs or invoke conversion.

Keep the process-local scope documented at the owning boundary. Prefer existing
`upload_in_progress`/`conversion_conflict` contracts according to their semantics.
Do not add an error contract unless existing ones cannot represent the condition.
Retain legacy same-session conflict, independent-session, and finally-release
tests; do not expose legacy batch semantics as the current product behavior.

Gate: deterministic concurrency tests with explicit synchronization, no arbitrary
sleeps; representative real concurrent HTTP coverage under step 12. Coordinate
ownership edits with step 7 rather than refactoring the same boundary twice.

## Step 10 — Verify presentation-only legacy progress

- [x] Audit and complete (2026-09-24)

Review legacy `ConversionPage.tsx`, `useFileProgress.ts`, `FileProgress.tsx`, exports,
and tests. Public symbols already use cosmetic terminology even though filenames
retain old names. Rename files only if it improves clarity without needless churn.

Verify API completion/error controls workflow state, the timer cannot mark work
complete, failure/unmount cancels it, and visible/accessible text makes no claim
of measured backend stages or format-specific conversion work. Add focused tests
only for uncovered behavior. Preserve shared legacy components and contracts.

The active `ConversionOperationPanel` and its transport/polling hooks continue to
show real network progress and authoritative file outcomes. Neither replace them
with cosmetic progress nor alter their protocol. Clearly distinguish upload bytes
from backend states; there is still no measured encoding percentage.

Gate: affected frontend/UI tests; if active UI behavior changes, run real browser
E2E as well as relevant mocked browser integration tests.

## Step 11 — Update documentation proportionately

- [ ] Audit and complete

Update README only where the final code differs. Verify Node/npm setup,
installation, development/validation commands, monorepo layout, backend-authoritative
limits, storage ownership, temporary/partial-output cleanup, partial success,
single-process concurrency, and E2E instructions.

Document the current session → operation manifest → per-slot upload → backend
conversion → independent commit/download lifecycle. Explain one operation/session
and completed-file eligibility, not batch sealing as a download prerequisite.
Keep sealed-session behavior and cosmetic progress explicitly labeled legacy.
Preserve current recovery, timeout, HEIC, page-exit, and fixed-expiry limitations.
Check any `npm ci` versus CI's `--legacy-peer-deps` discrepancy before recommending
an installation change; do not regenerate the lockfile merely for documentation.

Gate: commands and claims agree with code/configuration. No unsupported claims
that all browser projects or hosted CI have been verified.

## Step 12 — Extend required real lifecycle coverage

- [ ] Audit and complete

Reuse `apps/api-e2e/src/support/api-process.ts`, the controlled API fixture, and
the existing browser harness. The API app is already testable; do not introduce
another app factory or server framework. `api-e2e:e2e` delegates to its actual
`test` target with fixture build prerequisites. It is not a dummy test.

Existing API scenarios cover conversion/auth/metadata/ZIPs, manifest size limits,
real multipart disconnect/retry, crash recovery with retained output, unfinished
manifest recovery, progress without polling or exit cancellation, retired uploads,
and legacy downloads. Real browser cases cover full and partial success, downloads,
upload retry, cancellation, and exit-cancellation delivery/non-delivery.

Map remaining requirements to existing tests before adding cases. Select high-value
gaps from malformed manifest/output MIME, missing or invalid multipart files,
invalid/expired authorization, file/count/aggregate-byte limits, conflicting
operation creation, same-slot contention, missing/not-ready downloads, and
observable staging cleanup. Use current operation routes and error semantics,
not reused/sealed-batch expectations. Keep timing deterministic; use existing
fixture controls only for synchronization, with real routing/storage/encoding.

Validate successful/error responses using shared schemas where applicable. Decode
download bytes, assert MIME and meaningful image metadata, verify ZIP contents,
and clean isolated storage on success and failure. Do not depend on a running
developer server or duplicate every unit test at process level.

Real E2E is required, not optional or deferred out of CI. Keep standard `e2e`
targets for actual API/browser behavior and `browser-integration` for mocked
browser tests; do not add `e2e-real`. Preserve CI's browser/system installation,
Chromium/Firefox/WebKit coverage, and failure diagnostics without credential-bearing
traces. Local missing browser libraries are a reported limitation, not a pass or
reason to disable CI projects. Hosted CI observation requires a separately
authorized remote action if it cannot be obtained within the permitted workspace.

## Validation and delivery

For each structural change, run affected tests and API coverage, inspect changed
module branches, and add meaningful ownership/concurrency/cleanup/error tests:

```sh
NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false npx nx test @image-web-convert/api --coverage
```

At completion run the existing full checks and both real E2E targets explicitly:

```sh
NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false npm run lint
NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false npm run typecheck
NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false npm test
NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false npm run build
NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false npx nx run @image-web-convert/api-e2e:e2e
NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false npx nx run @image-web-convert/web-e2e:e2e
NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false npx nx run @image-web-convert/web-e2e:browser-integration
git diff --check
git status --short
git diff --stat
```

Use existing repository-local `TMPDIR` and `PLAYWRIGHT_BROWSERS_PATH` settings when
required by the container; record them with results. `NX_NO_CLOUD=true` may be used
for local validation. Report existing Nx Cloud, color, source-map, lint, and UI
bundle warnings accurately without unrelated fixes. Do not rerun all checks for
this documentation-only planning change.

Review the final diff for unrelated edits. Report each step as already satisfied,
changed, or deferred with evidence; include ownership/error decisions, changed-module
coverage, real lifecycle/failure coverage, validation failures and environment
limits. Do not claim historical counts or unobserved CI runs as fresh results.

## Execution log

- 2026-09-24: Saved this revised plan after inspecting active/legacy upload paths,
  ZIP handling, claim ownership, progress components, E2E cases and targets, README,
  and CI. No application code changed; no implementation tests run.

### Step 7 completion — 2026-09-24

- Moved the operation-create session claim, fresh session read, and legacy-used
  checks from the Express controller into `conversion-runtime.service.ts`.
  `createOperation` now takes a session ID and reads persisted session state,
  including expiry, from the runtime's storage root. Direct application callers
  can no longer bypass these guards by supplying an incomplete session object.
- Claims are acquired inside existing serialized operation admission and released
  in `finally`, including read, validation, conflict, and persistence failures.
  An unsuccessful claim does not release another caller's ownership. Existing
  admission serialization handles repeated creation; identical intents remain
  idempotent. No new lock, scheduler, or session-wide file-upload restriction.
- Added an optional storage root to existing session read/path helpers, preserving
  default paths. No path construction moved into the runtime or storage service.
- Moved the unchanged multipart receiver/startup staging cleanup to
  `controllers/conversion-upload.http.ts`, explicitly identifying the Express
  transport adapter. Updated production startup, controller, fixture, and test
  imports. Verified the move changes only its import path and explanatory comment.
- Audited legacy neutral inputs, accepted counts, all-rejected sealing, and
  persistence rollback. Existing six upload-service tests retain these guarantees;
  no legacy endpoint was reactivated and no legacy semantics replaced independent
  operation output commits.
- Added five runtime test cases (including two parameterized legacy-use states):
  sealed/count-used session rejection with retry; preserving another caller's
  claim and releasing successful ownership; read/write failure recovery; and
  malformed/conflicting-intent rejection with unchanged idempotent results.
  Existing HTTP tests still prove status/error mapping and claim conflict handling.
- Validation: API suite and coverage pass, 218 tests in 17 files. Changed-module
  statement/branch coverage: runtime 95.41%/85.24%; conversion controller
  95.62%/84.38%; moved HTTP adapter 92.16%/80.00%; session service 100%/100%;
  storage paths 100%/92.31%. Inspected coverage for operation creation: no
  uncovered branches remain in that function. Broader runtime/adapter gaps are
  not newly changed behavior and are not mechanically filled for percentages.
- All eight real API process E2E cases pass, including actual conversion,
  disconnect cleanup/retry, crash/restart recovery, and legacy downloads. API and
  controlled-fixture builds pass through the E2E prerequisites. Production restart
  coverage exercises the moved startup import. No browser/UI behavior changed;
  browser suites and hosted CI were not run for this step.
- API/API-E2E lint and typechecks pass. Existing two `files.service.spec.ts` lint
  warnings and Node color-environment warnings remain. Dependencies were absent
  in this container: restored with CI's `npm ci --legacy-peer-deps`, Node 22.22.0 /
  npm 10.9.4; no manifest or lockfile changes. npm reported 134 audit findings
  (3 low, 56 moderate, 65 high, 10 critical); dependency remediation is out of scope.
- Commands used the listed Nx flags plus `NX_NO_CLOUD=true` and repository-local
  `TMPDIR=/workspaces/image-web-convert/tmp`. Reviewed final diff and whitespace.
  Changes remain uncommitted. Next requested step: 8, ZIP completion/error handling.

### Step 8 completion — 2026-09-24

- `writeZip` now observes finalization and output completion together. It succeeds
  only after both, rejects promptly on archive/output errors or early client close,
  handles late finalize rejection, and removes its event listeners on settlement.
  Failure unpipes, aborts queued archive tasks, and destroys the archive; the HTTP
  caller retains ownership of the response. No asynchronous event callback throws.
- Archiver warnings now reject instead of silently omitting an entry whose source
  disappeared after resolution. Pre-stream resolution still reports missing IDs
  separately and can return an archive containing the available requested files.
- Archive name generation reserves original names and avoids collisions with both
  existing and generated suffixes while preserving input order. The new real E2E
  case exposed a second ordering issue on rerun: archiver's default concurrent
  filesystem stat callbacks could reorder ZIP members. Setting its existing
  `statConcurrency` option to 1 fixes that; no dependency change.
- Legacy ZIP handling now forwards authorization/resolution/archive failures,
  ignores client aborts, and destroys partially sent responses instead of sending
  another body. Active and legacy handlers remove ZIP response headers before
  forwarding pre-stream errors. Single-file download behavior remains unchanged.
- Replaced archive callback stubs with EventEmitter/Writable-based tests covering
  both completion orders, pending-finalization error/abort, warnings, output errors,
  late rejection, synchronous entry failure, pre-destroyed output, cleanup, and
  Unicode headers. Added legacy controller error/abort tests and a real HTTP/archive
  missing-source test; only the source-path race is controlled in that test.
- Added a real API process ZIP case covering three colliding filenames, exact
  requested order, decoded archive contents matched to downloaded image bytes,
  Unicode content disposition, and missing-ID reporting. Existing real tests
  retain legacy ZIP and single-download coverage.
- Validation: 229 API tests pass with coverage; nine real API process E2E cases
  pass. After fixing the observed ordering failure, the new collision E2E case
  also passes three separate repeat runs. API/fixture and frontend builds pass;
  API/API-E2E lint and typechecks pass. The first typecheck caught a missing
  explicit return in the legacy controller; fixed and rerun successfully.
- Changed-module statement/branch/function coverage: `files.service.ts`
  100%/95.12%/100%; `files.controller.ts` 100%/97.06%/100%; active download routes
  87.31%/67.86%/100%. Remaining broad route coverage gaps were not filled solely
  to increase percentages. ZIP completion/error code has full statement coverage.
- All six Chromium E2E scenarios passed during this step; the two conversion/download
  cases were rerun after the final ordering change. Chromium was installed under
  repository-local `node_modules/.cache/ms-playwright`. Firefox/WebKit and hosted
  CI were not run; their existing CI coverage stays enabled.
- Commands used the existing Nx flags, `NX_NO_CLOUD=true`, repository-local TMPDIR,
  and the local Playwright browser path. Node color-environment and existing
  frontend build warnings remain. The old files-service test `any` warnings were
  eliminated by replacing the affected stubs with typed stream tests.
- Reviewed the diff and whitespace. No production dependency or lockfile changes,
  no remote writes, and no commit. Previous step 7 work remains intact.
  Next requested step: 9, active concurrency audit.

### Step 9 completion — 2026-09-24

- At the user's request, committed steps 7–8 as `53c629d` (`Centralize conversion
  ownership and harden ZIP downloads`) and confirmed a clean tree before step 9.
  No push. Step 9 changes remain uncommitted.
- Audited application creation admission, runtime per-slot transport claims,
  storage acceptance claims, and controller cleanup. The existing design already
  permits sibling slots and independent sessions within the upload capacity limit.
  Kept these mechanisms and existing shared errors; no additional lock or queue.
- Found and reproduced a stale-release bug in `claimSessionWork`: releasing an
  old owner twice could delete a replacement owner's claim. The new focused test
  failed against the original helper, then passed after making release idempotent.
  Documented the helper's process-local/application scope and runtime slot ownership.
- Added deterministic runtime coverage for concurrent identical/conflicting
  operation intents: persistence is held at an explicit barrier, only one operation
  is written, matching requests share the result, and changed intent conflicts.
  Added independent-session slot ownership and stale-release coverage. Existing
  runtime release is already idempotent and needed no behavioral change.
- Added a real API process concurrency case. Simultaneous identical creation
  returns the same operation; another intent returns schema-validated 409
  `conversion_conflict`. A genuinely open multipart request holds a slot while a
  duplicate receives schema-validated 409 `upload_in_progress` without another
  staging directory or accepted input. Sibling upload and conversion in another
  session proceed while that transport remains open. Disconnect clears staging;
  retry completes normally; accepted-slot replay preserves state and output bytes.
- Existing tests retain failure-boundary coverage: legacy partial/all-rejected
  batches and persistence rollback, operation creation read/write failure release,
  failed input copy and retry, cancellation during copy/transport, malformed upload
  and storage-error retry, idle/total/expiry deadlines, and timed-out transport
  retaining capacity until release. Native conversion still retains capacity until
  it settles; cancellation does not manufacture an early release.
- Validation: 232 API tests across 18 files pass with coverage; all ten real API
  process E2E cases pass. API/fixture builds and API/API-E2E lint/typechecks pass.
  `session-work.service.ts` has 100% statements, branches, and functions; runtime
  has 95.41% statements, 85.78% branches, and 97.14% functions. Inspected changed
  coverage; all newly changed claim behavior is covered.
- Used the same Nx flags, `NX_NO_CLOUD=true`, and repository-local TMPDIR as steps
  7–8. Only existing Node color-environment warnings appeared in relevant checks.
  No browser/UI change: browser suites and hosted CI were not rerun for step 9.
  No dependency or lockfile changes. Final diff and whitespace reviewed.
- Next requested step: 10, presentation-only legacy progress audit.

### Step 10 completion — 2026-09-24

- Audited the retained legacy conversion page, cosmetic component/hook, exports,
  instructions, and tests. Existing cosmetic naming and API-owned completion/error
  handling already satisfy the ownership requirements; no timer/workflow rewrite.
- Replaced the screen-reader percentage and preparation-stage heading with generic
  waiting language and a visible disclosure that the activity indicator does not
  measure upload or conversion progress. Updated the legacy DOM ID and request
  instructions to avoid implying a measured conversion stage. Kept public props,
  exports, and filenames compatible; the cosmetic percentage prop remains accepted.
- Added three hook tests with fake timers for the 90% cap, explicit completion,
  cancel/reset, restart without accumulating timers, and unmount cleanup. Strengthened
  the page test by setting cosmetic progress to 100% while its API promise remains
  pending; only resolving that promise transitions to downloads. Existing tests
  retain specific API error display, cancellation, and reset coverage.
- Validation: 52 UI tests and 55 web tests pass; UI/web lint, typechecks, and builds
  pass. UI coverage shows 100% statements/branches/functions for both the cosmetic
  component and hook. Relevant commands used the existing Nx flags, NX_NO_CLOUD,
  and repository-local TMPDIR. Existing lint, color, source-map, bundle-directive,
  and Nx process-listener warnings were reported without unrelated fixes.
- No active operation panel, upload transport, polling, shared contract, or API
  behavior changed. Browser/API E2E and API coverage were not rerun for this
  legacy-only presentation change. No new progress protocol or step 13 work.
- Reviewed final diff and whitespace. No dependency or lockfile change. User
  requested a local commit after implementation; no push is authorized.
- Next requested step: 11, targeted README review.
