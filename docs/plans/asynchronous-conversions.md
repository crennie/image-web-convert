# Backend-owned asynchronous conversions: implementation plan

Status: phases 1–5 complete; phase 6 pending.

This is the durable implementation plan for the six phases in section 11 of
the design review. It is intended to be read and updated by Codex across runs.
It does not authorize implementing every phase in one run: implement the phase
requested by the user, or the next incomplete phase when asked to continue this
plan. Follow repository instructions and inspect current code before editing.

## Decisions and scope

- The application runs locally as one persistent Node/Express API process for
  one user. Production hosting, distributed coordination, and deployment
  infrastructure are outside scope.
- The backend owns manifest membership, options, readiness, scheduling, file
  outcomes, cancellation, and aggregate status. React consumes snapshots.
- Build the asynchronous UI as a new component with dedicated workflow hooks.
  Preserve existing upload components and hooks unless an edit is small, clearly
  necessary, and behavior-preserving. This constraint applies to every phase,
  including any UI built alongside backend work; see Frontend behavior below.
- Keep one conversion operation per existing session. Preserve bearer-token
  authorization, filesystem storage, Express routes/services, shared Zod
  contracts, and existing error-envelope conventions.
- Keep the existing fixed session lifetime, including upload and queue time.
  Do not add separate upload and download retention periods.
- Use a process-owned scheduler and durable filesystem records. No database,
  queue framework, SSE, WebSockets, or new frontend query dependency.
- Start with one active conversion across the process, FIFO ready operations,
  and manifest order within each operation. Public contracts must support
  multiple processing files later without changing frontend orchestration.
- Keep completed outputs after cancellation or another file's failure, until
  session expiry. Stop future work at safe boundaries.
- Closed-tab recovery is not a product requirement. Page exit may send a
  best-effort cancellation request solely to save backend work. Delivery is not
  guaranteed and the browser must not wait for or render its response.
- Refresh is not a resume guarantee: page exit cancellation can include reload.
  Do not add persistent browser credentials or a recovery UI for this version.
  Backend restart recovery still protects state consistency and committed files.
- Add explicit resource/admission limits and deadline behavior. Do not describe
  promise timeouts as a way to interrupt native conversion or free its resources.

## Current implementation anchors

Recheck these files before implementing their corresponding phase:

| Concern | Files |
| --- | --- |
| Workflow UI | `apps/web/app/routes/conversion/components/ConversionPage.tsx` |
| Upload form and transport | `libs/ui/src/lib/file-upload/FileUpload.tsx`, `libs/ui/src/lib/file-upload/hooks/useFileUploads.ts` |
| Cosmetic progress | `libs/ui/src/lib/file-progress/hooks/useFileProgress.ts` |
| Session and downloads | `libs/ui/src/lib/session/SessionContext.tsx`, `libs/ui/src/lib/file-download/` |
| API routing | `apps/api/src/api/index.ts`, `apps/api/src/routes/`, `apps/api/src/controllers/` |
| Current orchestration | `apps/api/src/services/uploads.service.ts` |
| Conversion | `apps/api/src/services/image.service.ts`, `apps/api/src/services/image.config.ts` |
| Persistence | `apps/api/src/services/storage.service.ts`, `storage.paths.ts`, `sessions.service.ts` |
| Lifecycle and limits | `apps/api/src/main.ts`, `app.ts`, `env.ts` |
| Contracts | `libs/schemas/src/lib/api/api.ts`, `apiError.ts` |
| Server integration | `apps/api-e2e/src/api/api.spec.ts` |
| Browser tests | `apps/web-e2e/src/upload.spec.ts`, `apps/web-e2e/playwright.config.ts` |

The old upload service starts all files with `Promise.allSettled`, waits for all
results, writes session counts/sealing, and rolls back accepted outputs if that
final write fails. Downloads require a sealed session. Input cleanup currently
occurs inside `saveUploadFile` regardless of success. All three behaviors need
deliberate replacement for operation-owned incremental commits.

## Target contracts and invariants

### State

Operation states:

`awaiting_uploads | queued | processing | completed | partially_completed | failed | cancelled`

File states:

`awaiting_upload | uploaded | processing | completed | failed | cancelled`

Do not add file `uploading` or numeric encoding progress: network bytes belong
to browser transport state. `uploaded` means durable backend acceptance, and
also represents waiting for siblings or worker capacity.

Persist an operation schema version, revision, session/operation IDs, creation
request ID, ordered immutable file manifest, output MIME, effective processing
settings, cancellation timestamp/reason, lifecycle timestamps, and expiry.
Each file has a server-assigned ID, client correlation ID, sanitized name,
declared/actual byte sizes, state, error, internal input reference, and committed
output metadata when successful. Keep internal paths and token hashes out of
public snapshots. Expose derived counts, including completed, failed, cancelled,
and settled; do not maintain conflicting independent aggregate counters.

Rules:

1. Validate a nonempty manifest, unique client IDs, supported output MIME, and
   effective count/size limits before creating slots. Backend limits prevail.
2. File IDs and order are assigned at creation; uploads cannot add or replace
   membership or options. Validate actual bytes against the declared slot size
   and effective limits. Reserve limits for the whole manifest, not just outputs.
3. A slot is accepted only after complete bytes are durably staged. An aborted
   request leaves it awaiting upload. Retryable storage/network failures do not
   resolve the readiness barrier.
4. A permanent rejection attributable to a valid slot can mark it failed. Start
   automatically when every slot is uploaded or permanently failed; if none can
   be processed, settle failed. No start-processing endpoint or poll-driven work.
5. Missing uploads wait for retry, cancellation, or session expiry. A failed
   browser request alone must not permanently fail a slot.
6. Persist queued readiness before waking the scheduler. Duplicate wakeups and
   simultaneous final uploads must not duplicate conversion.
7. Derive terminal outcome after all work settles: accepted user cancellation
   wins as `cancelled`; otherwise all successes are `completed`, some successes
   are `partially_completed`, and zero successes are `failed`.
8. `cancelRequestedAt` is separate from terminal status. While active conversion
   settles, snapshots remain active and report cancellation pending. Repeated
   cancel is idempotent; cancellation after terminal completion is a no-op.
9. Completed artifacts are immutable. A failed later write must never remove
   earlier committed successes. Downloads authorize individual completed files.
10. Short per-operation mutation locks serialize read/modify/write transitions.
    Never hold such a lock while receiving bytes or running conversion.

### HTTP interfaces

Keep `POST /api/sessions` and existing authenticated file/meta/ZIP endpoints.

| Method and path | Contract |
| --- | --- |
| `POST /api/sessions/:sid/conversions` | Manifest, options, client creation request ID; 201 plus operation snapshot and slots. Same request ID and intent returns existing operation; conflicting intent is 409. |
| `GET /api/sessions/:sid/conversions/:operationId` | 200 authoritative snapshot, including per-file outcomes and output references; no mutation required to advance work. |
| `PUT /api/sessions/:sid/conversions/:operationId/files/:fileId` | Exactly one multipart file; acknowledge after durable acceptance, without awaiting conversion. |
| `POST /api/sessions/:sid/conversions/:operationId/cancel` | Idempotent cancellation command; return current snapshot, including pending cancellation when relevant. |

Authenticate and validate slot identity before multipart parsing where possible;
recheck state before committing staged bytes. Reject simultaneous uploads to the
same slot. Accepted slots are immutable: after a lost response, GET reveals
acceptance and a repeated PUT returns existing acceptance without replacing bytes
or scheduling twice. Clean duplicate request staging. Never accept an operation ID
or file ID merely because a matching path exists; check session association.

Use shared `{ type, message }` errors: 400 invalid request/options, 401 invalid
token, 403 expired session, 404 missing operation/file, 409 stale/conflicting
upload, 413 limits, and 500/503 storage/service failure as appropriate. File
errors need a stable type plus message for unsupported/malformed image,
conversion failure, storage failure, timeout, and interrupted execution. Preserve
exceptions at existing converter/storage boundaries and translate in application
services; do not introduce a project-wide Result framework. Partial operation
outcomes are data in a successful status GET, not HTTP 207.

### Resource limits, deadlines, and shutdown

Initial defaults below are implementation targets, configurable and validated
in `env.ts`. Verify converter-specific options against the installed version.

| Setting | Initial policy |
| --- | --- |
| Existing session file/byte/TTL limits | Keep current defaults: 20 files, 20,000,000 bytes/file, 500,000,000 bytes/session, 15 minutes. |
| Active conversion files | One globally. Raising concurrency is a later measured change. |
| Active nonterminal operations | Default 3 globally; reject excess creation with a typed capacity error. Count persisted operations during startup. |
| Simultaneous upload requests | Default 2 globally, with one per slot; browser also sends at most 2. Reject excess admission before parsing bytes. |
| Upload idle timeout | Default 60 seconds without incoming bytes; abort/clean request staging, leave slot retryable. |
| Upload total deadline | Default 5 minutes, additionally bounded by session expiry; handle independently of idle timeout. |
| Per-file conversion deadline | Default 120 seconds from converter invocation; cooperative deadline semantics below. |
| Pixel and dimension limits | Preserve existing 200,000,000-pixel input limit and 8192 output dimension; centralize configurable limits and test enforcement. |
| Shutdown grace | Keep an explicit bounded grace period (initially 10 seconds); stop admissions/claims and wait for active work before exit when possible. |

These limits bound admitted work, not exact RAM consumption, CPU percentage, or
network bytes per second. Do not add traffic shaping or infer unlimited
concurrency from workstation CPU count. Audit HEIC preprocessing separately:
Sharp's input-pixel limit does not prove the preceding HEIC decoder is bounded.
Record any decoder limitation and measure representative HEIC responsiveness.

Use converter-supported timeouts only where actually available. A cooperative
deadline requests stopping further work and invalidates the active file's
uncommitted result. When the invocation settles, discard its late output, record
`conversion_timeout`, cancel remaining files with a timeout reason, and settle
the operation failed or partially completed according to prior successes.
Do not release the global slot or delete an input still in use simply because a
timer fired. Keep the operation active with a stop reason until the invocation
has settled. Never rely on `Promise.race` as hard cancellation.

This first version does not guarantee a hard wall-clock CPU cutoff; a blocked
event loop may also delay timers and cancel requests. If a strict cutoff becomes
required, document and separately scope execution in a terminable Node child
process before claiming that guarantee. Do not silently introduce that
architecture or a dependency during these phases.

Expiry uses the same stop mechanism: reject new uploads and work, preserve
already committed results until the existing expiry boundary, and clean data
once no active conversion/download is using it. Expiry does not extend access.
User cancellation differs from timeout: let the active file finish and retain
its success, then finalize cancelled. Check stop conditions before every claim
and again before output publication.

### Persistence and recovery

Extend the existing session directory using `storage.paths.ts`:

```text
session.info.json
conversion.info.json
inputs/<file-id>
.conversion-staging/<temporary-id>
.conversion-commits/<file-id>.json
<file-id>.<output-extension>
<file-id>.json
```

Request staging is not accepted input. Promote complete uploads into the session
filesystem before committing `uploaded`; account for source/destination paths on
different filesystems by copying into destination staging before rename when
needed. Write snapshots/output/metadata via temporary files and rename. Define
write ordering and reconciliation explicitly; several JSON/filesystem writes
are not one transaction.

The phase 2 implementation stores `{ operation, inputs }` in
`conversion.info.json`. Input references contain a stable stored name, byte
count, and SHA-256 digest. Per-file commit receipts contain operation/file
association, final metadata, output fingerprint, and original completion time.
Output and metadata are published before the receipt, and the receipt before
the completed operation snapshot. Recovery requires both matching artifacts and
the receipt; a metadata sidecar alone does not establish completion.

Publish a complete output and metadata before recording file completion. Delete
input after its outcome is persisted. Retain enough commit evidence to reconcile
a crash between artifact publication and snapshot update. Orphaned/partial
artifacts must not become downloadable just because a sidecar exists.

Startup recovery before readiness:

- Preserve valid completed files.
- Reconcile demonstrably complete commits left between persistence steps.
- Mark other interrupted processing files `failed` / `processing_interrupted`;
  do not blindly retry conversion. Continue remaining uploaded files.
- Rediscover queued work, including readiness persisted before a lost wakeup.
- Respect cancellation/timeout/expiry before scheduling anything.
- Keep awaiting-upload slots waiting while unexpired; remove incomplete staging.
- Quarantine/report invalid records without crashing recovery for unrelated
  sessions or pretending storage corruption is an ordinary not-found response.

Add coordinated startup/periodic expiry and orphan cleanup. Do not delete files
used by active conversion/download. Track scheduler ownership and timers through
application lifecycle wiring so server tests can start and stop cleanly.

### Frontend behavior

Create a new app-owned `ConversionOperationPanel` (name may follow local naming
conventions) under `apps/web/app/routes/conversion/components/`, with dedicated
operation polling and slot-upload hooks. It owns presentation and transport for
the new workflow, not backend lifecycle decisions. Keep workflow-specific code
in the app initially; do not generalize it into the shared UI library prematurely.

Do not retrofit `FileUpload`, `useFileUploads`, cosmetic progress components, or
the existing `FileDownload` to implement this workflow. Reuse existing presentational
primitives, selection helpers, and previews through their existing interfaces
where they fit. Build new composition or result rows when old interfaces require
batch FormData, local File objects, or synchronous response state. Avoid copying
the old workflow wholesale into the new component.

Small edits to existing components are permitted only when obvious and
uncontroversial: for example an optional presentation prop with unchanged defaults
or a necessary import/export. Changing submission contracts, state ownership,
side effects, or existing behavior is not such an edit. If that becomes necessary,
explain the concrete need and obtain user direction before expanding the change.
The intentional route/page wiring change to mount the new component at cutover
is in scope; keep it narrow and preserve the old workflow until cutover validation.

The user-visible changes are:

- File selection, previews, output-format choice, and one submit action remain.
- Each file shows local upload progress, then backend states such as waiting,
  processing, completed, failed, or cancelled.
- Batch upload progress and processing counts are displayed separately.
- Cancel shows a pending state while active backend work settles.
- Successful files become downloadable while siblings are still processing;
  partial failures and cancellation retain those results and show file errors.
- Retryable upload and polling problems have distinct presentation from backend
  conversion failures. No separate start-processing button is added.

The default sequence remains backend/contracts first and UI integration in phase
5. If a requested phase includes an early UI slice, build it in this new component
against shared snapshot fixtures or available endpoints, with component tests.
Do not turn a fixture/demo into a second frontend workflow state machine, wire
incomplete behavior into the active route, or expand a backend-only phase into UI
work without a request.

Use existing React/fetch patterns plus one small polling hook; use an upload
transport exposing actual progress events, such as XMLHttpRequest. Store local
File objects, previews, slot correlations, transport progress, request handles,
and dialog/request state in React. Do not store an independent domain state
machine or infer readiness/completion from upload promises.

Poll active operations approximately every second with one request in flight,
backoff, Retry-After support, and stale-revision protection. Stop on terminal
state/access expiry. A polling failure is a connection problem, not an operation
failure. Status reads need a dedicated rate budget (implemented as 240/minute/IP for the
local application), excluded from the current global 100/minute budget while retaining
authorization and appropriate abuse limits. Keep command limits separately.

Render successful outputs from backend metadata, without requiring local files
or reconstructing names/extensions. Show completed/failed/cancelled counts and
current file states; never invent encoding percentages. Label multipart upload
progress as transport progress and backend acceptance separately.

Explicit Cancel aborts local upload requests, sends the backend command, and
continues reading authoritative status until settled. For page exit, use a
small best-effort authenticated `fetch` with `keepalive: true` from an appropriate
page lifecycle event, discard the response, and catch errors without UI or retry
loops. Do not use sendBeacon if it loses the required Authorization header. Do
not cancel merely on visibility changes or React effect cleanup/Strict Mode
remounts. Guard terminal operations. Do not add unload confirmation dialogs or
guarantee delivery. Test that lost exit cancellation still leaves a bounded,
backend-owned operation that settles or expires.

## Implementation phases and completion gates

Update each phase's checkbox and the execution log only
after the completion gate passes. Record blockers and failing checks honestly.

### Phase 1 — Contracts and transitions

- [x] Complete

Add shared request/snapshot/error schemas and application-owned transition
functions. Keep existing routes/UI working. Encode immutable membership,
readiness, cancellation precedence, timeout/expiry reasons, and derived counts.
Choose concrete module names following existing services; avoid a DDD framework.

Gate: schema and transition unit tests cover creation/limits, duplicate IDs,
file association, no premature processing, last-upload readiness, permanent
upload rejection, all-success/partial/all-failed outcomes, cancellation before
work, terminal idempotency, and preservation of successes. Relevant schema/API
unit tests and typechecking pass.

### Phase 2 — Durable storage and per-file commits

- [x] Complete

Implement operation persistence, stable file IDs, staging promotion, serialized
updates, individual artifact publication, and reconciliation functions. Separate
conversion from input lifetime ownership; keep old synchronous behavior usable
until cutover. Do not retrofit all unrelated storage helpers.

Gate: filesystem integration tests cover successful commits, upload interruption,
duplicate writes, lost updates, output/metadata/snapshot write failures, every
important crash boundary, committed-success preservation, and restart
reconciliation. No whole-operation rollback of committed successes.

### Phase 3 — Scheduler, limits, cancellation, and lifecycle

- [x] Complete

Add process-owned scheduling with injected converter/storage/clock boundaries,
validated resource settings, startup recovery, shutdown, deadlines, and cleanup.
Persist each transition; the queue in memory is only an optimization. Readiness
and periodic recovery must not depend on browser polling. Keep the global claim
until active conversion has actually settled, including timeout/cancel paths.

Gate: deterministic deferred-converter tests prove concurrency one, FIFO and
manifest order, duplicate wakeup safety, cancellation before/between/during files,
late success behavior, timeout behavior, admission limits, expiry, shutdown, and
recovery without a browser. Run real PNG and representative HEIC/AVIF smoke
checks and record elapsed time/responsiveness; no absolute performance target is
assumed. Document any unsupported hard-timeout or decoder-limit behavior.

### Phase 4 — HTTP endpoints and completed-file downloads

- [x] Complete

Wire creation/upload/status/cancel routes and services, authentication before
multipart work, slot admission/limits/timeouts, typed errors, idempotency, and
polling rate limits. Make downloads consult committed per-file status for new
operations while preserving legacy sealed-session behavior during migration.

Gate: real Express integration tests prove automatic processing after the final
upload response, progress without GET calls, status/cancel races, cross-session
rejection, truncated/disconnected upload cleanup, retry after lost acknowledgement,
simultaneous final uploads, capacity rejection, and downloads/ZIPs containing
successful files while siblings are active or cancelled. Polling at the planned
cadence does not exhaust the command budget. Existing legacy tests still pass.

### Phase 5 — Frontend cutover

- [x] Complete

Build the new `ConversionOperationPanel` and dedicated hooks described above,
using manifest creation, bounded slot upload transport, polling, and real progress.
Render backend snapshots/results, add explicit cancellation, and implement the
best-effort page-exit behavior. Reuse selection/previews/advisory validation where
existing interfaces fit. Mount the new component through a narrow route/page
wiring change once integration is verified; do not rewrite existing upload
components or use cosmetic progress in the new flow. Do not build refresh/closed-tab
recovery features.

Gate: component/hook tests cover snapshots, unknown connection state, stale
responses, polling cleanup/backoff, upload progress/abort/retry, explicit pending
cancellation, terminal results without local files, and page-exit request errors
being ignored. Verify ordinary rerenders/Strict Mode do not trigger cancellation.
Verify existing upload component contracts/tests remain intact, except for any
documented small behavior-preserving edits. Review the diff against the new
component boundary before marking this phase complete.

#### Phase 5 fresh-session implementation handoff

Phases 1–4 are complete. Implement phase 5 only when asked to continue; do not
retire legacy APIs or start phase 6 automatically. The phase 4 execution log below
is the authoritative description of the implemented HTTP behavior.

Read these anchors before editing:

- `apps/web/app/routes/conversion/index.tsx`: currently mounts `ConversionPage`.
  Prefer changing this mount to the new panel/composition, preserving the old
  `ConversionPage` and its tests. Retain the page layout/error boundary through
  composition as appropriate. This narrow route cutover is explicitly authorized.
- `apps/web/app/routes/conversion/components/ConversionPage.tsx` and its existing
  tests: reference for current capabilities, not the place to build the new flow.
- `libs/ui/src/lib/session/SessionContext.tsx`,
  `libs/ui/src/lib/file-upload/hooks/useFileItems.ts`, shared UI public exports,
  and presentational file primitives: inspect which interfaces can be reused.
- `libs/ui/src/lib/api-url.ts` and
  `libs/ui/src/lib/file-download/hooks/useFileDownloads.ts`: existing API base,
  authorization, filename, blob download, and object-URL cleanup conventions.
  `API_URL` already includes the `/api` base by default. Follow package export
  boundaries; a small public export is permissible if needed.
- `libs/schemas/src/lib/api/conversions.ts`,
  `apps/api/src/controllers/conversions.controller.ts`, and
  `apps/api/src/__tests__/conversions-api.spec.ts`: exact request/response contracts
  and examples of races, retries, partial results, and cancellation.
- `apps/web/vite.config.ts`, `apps/web/app/setupTests.tsx`, existing web/UI Vitest
  tests, and `apps/web-e2e/src/upload.spec.ts`: validation conventions. The existing
  Playwright upload scenario mocks the legacy API and will need a focused fixture
  update if run against the cutover route; real API/browser lifecycle work belongs
  to phase 6. Keep shared legacy component tests intact.

Suggested new app-owned files are `components/ConversionOperationPanel.tsx`,
`hooks/useConversionOperation.ts`, `hooks/useConversionUploads.ts`, and a small
transport/API helper under the conversion route. Names may follow local patterns.
Keep snapshot consumption, network transport, and presentation separable enough
to test. Do not introduce a frontend domain state machine or new dependency.

Transport contract and implementation details:

1. Obtain a session with the existing session API/context. Freeze the selected
   batch intent on submit, generate one creation `requestId`, and retain it for
   retries. POST `{ requestId, options: { outputMime }, files: [{ clientId, name,
   sizeBytes }] }`. Output MIME is the only public conversion option currently.
   Parse the direct response with `ApiConversionOperationSchema`; there is no
   outer `operation` property. Map local files to server slots by `clientId`, not
   display name or request completion order.
2. Upload at most two slots concurrently with XMLHttpRequest (or an already
   available transport exposing actual byte events). PUT one multipart file per
   slot, with no additional form fields; let the browser set its boundary. Every
   conversion/status/cancel/download request needs the session bearer token.
   Scheduling byte transfer is frontend transport work; readiness, conversion
   order, completion, and aggregate outcomes remain backend-owned.
3. Multipart progress includes framing bytes. Label it as transport progress,
   handle unknown totals honestly, and keep it separate from backend acceptance
   and processing counts. Reset per-attempt counters on retry so bytes are not
   counted twice. A locally aborted request is not proof of backend cancellation.
4. Start status polling after creation, including while uploads are in flight.
   Use approximately 1000 ms, one outstanding request, capped retry backoff and
   `Retry-After`. Merge snapshots from all request sources by operation ID and
   revision; a late PUT/GET/cancel response must not overwrite a newer snapshot
   or a new batch. Abort/ignore stale requests when identity changes.
5. After a lost upload response, read authoritative state before retrying. An
   accepted/processing/completed slot needs no replacement upload; an awaiting
   slot may be retried using the same local file. Treat 409 in-progress/conflict
   as a reason to reconcile state, not an automatic permanent file failure.
   Server file errors are authoritative; network errors do not settle a batch.
6. Explicit Cancel stops queued local transfers, aborts active transfers, sends
   the cancel command, and keeps polling until terminal. If that command fails,
   show an unknown/pending connection state and allow retry; never synthesize a
   cancelled operation. Page-exit cancellation instead uses `pagehide` with
   authenticated `fetch(..., { keepalive: true })`, ignores its response/errors,
   and does not run on ordinary effect cleanup, rerender, or visibility changes.
7. Render completed result rows from `file.output.meta` and server URLs, even
   without local File objects. Downloads require authenticated fetch/blob
   handling rather than unauthenticated links. ZIP requests use `{ ids,
   archiveName? }` with completed IDs only. Respect session expiry and revoke
   preview/download object URLs. Do not expose credentials in URLs or persist
   them for reload recovery.
8. A session can own only one operation. A deliberate new batch must use a fresh
   session; `startSession()` currently reuses an unexpired cached session. Do not
   clear it on retryable failures, and do not assume `clearSession()` followed by
   `startSession()` in the same render closure returns a new session. Test the
   new-batch transition explicitly and retain the prior session while its results
   are still displayed.

Build and test the new panel against controlled snapshots/transports first, then
switch the route mount. Add accessible status/error text, labelled cancel/retry
controls, separate upload and processing summaries, and successful result actions.
Use the phase 5 gate above plus tests for duplicate creation retry, repeated local
filenames, lost upload acknowledgement, new-batch session isolation, and stale
responses across operation changes.

Validation should include existing Nx `test`, `typecheck`, and `lint` targets for
`@image-web-convert/web` and `@image-web-convert/ui`, plus the web build and the
relevant mocked Playwright flow after cutover. Confirm available targets/config
first; run lint separately from tests to avoid temporary-directory scan races.
Use existing dependencies. Record exact commands, outcomes, any baseline failures,
and the remaining phase 6 work in this plan. Mark phase 5 complete only after its
component boundary, tests, and narrow route cutover have been reviewed.

### Phase 6 — End-to-end verification and retirement

- [ ] Complete

Add real-browser/API scenarios; the current Playwright suite starts only the web
app and mocks API requests, so give real conversion tests a controlled API
lifecycle and isolated storage. Retire the superseded backend synchronous upload
path after checking remaining consumers. Leave existing shared upload/download
components and cosmetic progress implementations intact in this migration;
their deletion or broad cleanup is a separately scoped task. Update
README with the actual lifecycle, settings, timeout limitations, local single
process assumption, storage recovery, and page-exit semantics.

Gate: real E2E tests cover full batch/download, partial conversion failure,
cancellation preserving results, abort/retry of an upload, and best-effort exit
cancellation. Server integration covers restart and non-delivery of exit cancel.
Run full relevant validation below; review final diff for unrelated changes.

## Validation and handoff protocol

Use the existing npm lockfile and Nx targets. Inspect target names/configuration
before running commands; do not install dependencies solely for this plan.
For phases 1–5, select relevant projects/tests. For final integration use:

```sh
NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false npm run lint
NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false npm run typecheck
NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false npm test
NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false npm run build
NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false npx nx e2e @image-web-convert/api-e2e
NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false npx nx e2e @image-web-convert/web-e2e
```

Do not change unrelated code to fix baseline failures. Use existing deterministic
test patterns and isolated storage; no real user session data in tests. Review
`git diff` and report changed behavior, tests, limitations, and next phase.
Do not push or create remote resources. Commit locally only if requested by the
user, including a request to prepare work for export.

At the end of an implementation run, append an execution-log entry with:

- Date and phase attempted/completed.
- Files/modules changed and invariants established.
- Exact validation commands and outcomes, including existing failures.
- Any evidence-based deviation from this plan and why.
- Remaining work and the next independently verifiable action.

Suggested continuation prompt:

> Read `docs/plans/asynchronous-conversions.md` and repository instructions.
> Implement the next incomplete phase only, run its validation, inspect the
> diff, and update the plan's checkbox and execution log. Preserve unrelated
> changes. Do not add dependencies or expand scope without authorization.

## Execution log

- 2026-09-08: Created this plan from the source-based design review and user
  clarifications. All implementation phases remain pending. Documentation only;
  no runtime changes or implementation tests performed.
- 2026-09-08: Added the user's new-component requirement for asynchronous UI,
  including early UI slices, narrow cutover wiring, and preservation of existing
  upload components. Updated phases 5 and 6 to respect that boundary. All phases
  remain pending; documentation only.
- 2026-09-08: Completed phase 1 (contracts and transitions).
  - Added `libs/schemas/src/lib/api/conversions.ts` and its public exports:
    strict creation intent, server slot IDs, discriminated file states, operation
    snapshots, per-file errors, stop reasons, and counts. Extended the existing
    API error union without changing legacy contracts.
  - Added `apps/api/src/services/conversions.service.ts`: pure creation,
    upload acceptance/permanent rejection, file start/finish, stop requests,
    derived counts, and explicit public snapshot projection. Inputs are not
    mutated. Backend processing defaults and effective session limits are
    copied into application state; snapshots omit these internal fields.
  - Readiness resolves automatically in upload transitions. Cancellation keeps
    active work nonterminal and preserves its eventual success. Timeout/expiry
    rejects late uncommitted success only after invocation settlement. Accepted
    upload acknowledgement is replayable even after ordinary batch completion;
    stopped/expired operations still reject uploads. Processing status remains
    stable between files once an operation has started.
  - Added 47 tests (15 schema, 32 service) covering manifest limits/IDs, byte
    validation, association, readiness, outcomes, immutable transitions,
    cancellation, timeout/expiry, snapshots, and future multi-file processing
    representation. Existing schema/API tests remain passing.
  - Restored existing locked dependencies with
    `npm ci --cache /workspaces/image-web-convert/.npm-cache --no-audit --no-fund`;
    moved the temporary npm cache into ignored `node_modules/.npm-cache` after
    installation. No dependency manifests or lockfiles changed.
  - Initial validation:
    `NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false ./node_modules/.bin/nx run-many -t test typecheck -p @image-web-convert/schemas @image-web-convert/api`.
    Tests passed; API typechecking exposed narrowing errors in the new throwing
    helper. Fixed the helper declaration. Nx also emitted an unconnected-cloud
    warning, so subsequent checks explicitly disabled cloud usage.
  - Intermediate validation:
    `NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false NX_NO_CLOUD=true ./node_modules/.bin/nx run-many -t typecheck lint -p @image-web-convert/schemas @image-web-convert/api`
    passed after that fix.
  - Final validation:
    `NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false NX_NO_CLOUD=true ./node_modules/.bin/nx run-many -t test typecheck lint -p @image-web-convert/schemas @image-web-convert/api`.
    Passed: 25 schema tests, 120 API tests, both project typechecks/lints, and
    dependent schema/library builds. Lint retained two existing
    `no-explicit-any` warnings in `files.service.spec.ts` (lines 235 and 272).
    Changed TypeScript files were formatted with the installed Prettier.
    `git diff --check` passed; final review found no route, UI, dependency, or
    unrelated runtime edits.
  - No scope deviation: persistence, locking, ID generation, request idempotency
    coordination, worker scheduling, timers, and routes remain future phases.
    The transition functions accept caller-supplied IDs/time and do no I/O.
  - Next action: phase 2, durable operation/input storage and per-file commit
    reconciliation. Persist transition results before scheduling work or
    acknowledging uploads; add internal input references in that phase.
- 2026-09-09: Completed phase 2 (durable storage and per-file commits), after
  committing phase 1 locally as `3a4e2d5` at the user's request.
  - Added `conversion-storage.schema.ts` and `conversion-storage.service.ts`
    under `apps/api/src/services/`, and operation-owned paths in
    `storage.paths.ts`. The store exposes create/read/update, upload acceptance,
    output/failure commits, verified completed-output lookup, and explicit
    startup recovery. Records are validated on read/write; malformed records and
    storage I/O failures are distinct from operation-not-found errors.
  - Input staging copies into the destination filesystem, validates actual
    bytes, records a fingerprint, and atomically publishes acceptance. Request
    cleanup cannot delete accepted input. Per-session mutation locks are shared
    across store instances in one process; per-file claims reject simultaneous
    duplicate upload/output writes. Large input copies and output staging run
    outside the mutation lock, with lifecycle rechecks before publication.
  - Snapshots and JSON artifacts use temporary-write, file sync, rename, and
    directory sync. Per-file commit receipts resolve the crash boundary between
    output/metadata publication and operation-state persistence. A failed later
    commit never rolls back earlier successes. Snapshot failures after receipt
    publication block further mutations until recovery, avoiding accidental
    rollback or contradictory cancellation of an already published result.
  - Recovery verifies committed artifacts, restores complete pending commits at
    their original completion time, marks interrupted conversions failed, keeps
    valid uploaded siblings, handles missing/corrupt input, honors stop/expiry,
    and removes abandoned staging/partial artifacts after durable settlement.
    Added the application transition `failUploadedConversionFile` so missing
    input can fail before conversion without inventing a processing timestamp.
  - During resumed review, fixed a receipt/snapshot publication race: initial
    reads used for mutations now share the publication lock before checking for
    interrupted commits. An ordinary in-flight publication is not a crash.
  - Added 36 real-filesystem integration tests, including a real Sharp
    conversion, write failures at output/metadata/receipt/snapshot boundaries,
    input cleanup failure, cross-filesystem staging strategy, concurrent final
    uploads, upload replay during publication, cancellation/timeout races,
    restart reconciliation, corrupted artifacts, and preservation of successes.
    Tests use isolated temporary directories inside the repository.
  - Validation passed:
    `NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false NX_NO_CLOUD=true ./node_modules/.bin/nx run-many -t test typecheck lint -p @image-web-convert/api @image-web-convert/schemas`.
    156 API tests and 25 schema tests passed; typechecking/lint passed with only
    the same two pre-existing `no-explicit-any` warnings in
    `files.service.spec.ts`. The 35-test initial storage suite also passed before
    the final race regression was added.
  - A focused rerun initially used unsupported Vitest option `--testFile`
    through Nx and failed at CLI parsing (no tests ran). Corrected command:
    `./node_modules/.bin/vitest run --config apps/api/vite.config.ts conversion-storage.service.spec.ts`.
    All 36 storage tests passed after the final test synchronization adjustment.
  - Existing HTTP flow validation passed:
    `TMPDIR=/workspaces/image-web-convert/apps/api/tmp NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false NX_NO_CLOUD=true ./node_modules/.bin/nx e2e @image-web-convert/api-e2e`.
    API production build and all 3 existing server E2E tests passed. TMPDIR kept
    integration-test files within the workspace. Changed TypeScript files were
    formatted; final diff/whitespace review passed.
  - Scope/implementation detail: a small per-file receipt was added to make
    multi-file publication recoverable without a database. Directory fsync is
    exercised on the current Linux filesystem; this is not a guarantee for
    every OS/filesystem. The original synchronous services/routes/UI and
    dependency manifests remain unchanged.
  - Next action: phase 3, scheduler/resource limits/lifecycle wiring. Call
    `recoverAfterRestart` only before accepting requests or running converters;
    recovery is not safe against live conversion work. The startup coordinator
    must catch/report or quarantine invalid sessions independently, discover
    pending operations, and schedule remaining uploaded files (including a
    recovered `processing` operation with no active invocation). No scheduler,
    automatic startup scan, periodic expiry sweeper, or new endpoints are wired
    yet. Phase 4 must use the completed-output gate for new-operation downloads;
    preserve legacy sealed-session download behavior until that cutover.


### Phase 3 completion — 2026-09-09

- Phase 2 was committed as `f51dd32` before this work.
- Added `conversion-runtime.service.ts`: one process-owned sequential worker per
  storage root, FIFO ready operations and manifest order, durable claims and
  outcomes, periodic rediscovery (default 1 second), startup recovery before
  readiness, and bounded shutdown. Repeated wakeups cannot duplicate work.
  Invalid session records are reported and isolated; runtime mutation failures
  stop scheduling and readiness rather than guessing durable state.
- Added global operation/upload admission, independent idle/total upload timers,
  session-use leases, cooperative conversion deadlines, and terminal expired
  session cleanup. Timed-out uploads retain capacity until transport settlement;
  timed-out conversions retain their slot/input until invocation settlement.
  Cancellation preserves active-file success; timeout/expiry reject late results.
- `main.ts` starts recovery before listening and drains HTTP plus runtime work on
  shutdown. `createApp` constructs/injects the runtime without starting timers;
  readiness requires the runtime to be ready. Tests that need scheduling must
  explicitly start and stop their injected runtime.
- Validated environment settings: `CONVERSION_MAX_OPERATIONS` (3),
  `CONVERSION_MAX_UPLOADS` (2), `CONVERSION_UPLOAD_IDLE_MS` (60000),
  `CONVERSION_UPLOAD_TOTAL_MS` (300000), `CONVERSION_FILE_TIMEOUT_MS` (120000),
  `CONVERSION_SWEEP_INTERVAL_MS` (1000), `CONVERSION_SHUTDOWN_GRACE_MS` (10000),
  `CONVERSION_MAX_INPUT_PIXELS` (200000000), `CONVERSION_MAX_DIMENSION` (8192).
  Current worker ceilings also constrain recovered operations' stored options.
- The installed Sharp supports `.timeout({ seconds })` (integer, at most 3600).
  It measures libvips processing, excluding thread-pool waiting; the application
  deadline additionally checks elapsed time after conversion settles. Neither
  mechanism guarantees a hard wall-clock cutoff.
- HEIC limitation confirmed in installed `heic-decode`/`heic-convert`: decoding
  allocates width × height × 4 bytes before Sharp sees the image, and JPEG
  preprocessing uses synchronous `jpeg-js.encode`. No caller-provided pixel
  ceiling or abort signal protects that preceding decode. The configured Sharp
  pixel limit therefore does not bound HEIC preprocessing memory or CPU. A hard
  cutoff would require separately scoped process isolation.
- Real scheduler smoke test uses a generated 1024×768 PNG, repository
  `apps/api/test_data/photo.heic`, and a 256-pixel output ceiling. One container
  run measured PNG→WebP 29 ms, HEIC→WebP 1311 ms, PNG→AVIF 59 ms. Maximum gaps
  between nominal 10 ms timer samples were 10/1238/14 ms respectively. These are
  observations, not performance guarantees; HEIC noticeably delays HTTP/timers.
- Validation passed:
  - `NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false NX_NO_CLOUD=true ./node_modules/.bin/nx run-many -t test lint -p @image-web-convert/api`
    — 191 tests, including 24 runtime tests and a real-encoder smoke test;
    lint has only the two existing `files.service.spec.ts` warnings.
  - `./node_modules/.bin/tsc --build apps/api/tsconfig.json --emitDeclarationOnly --force`
    — production and test TypeScript checked without relying on Nx cache.
  - `NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false NX_NO_CLOUD=true TMPDIR=/workspaces/image-web-convert/tmp ./node_modules/.bin/nx e2e @image-web-convert/api-e2e`
    — production API build and four HTTP tests, including readiness gating.
- Next action: phase 4. Wire authenticated commands to runtime methods and shared
  snapshots. `createOperation` currently returns a stored record; implement
  HTTP creation idempotency before admission for retries. Acquire `beginUpload`
  before multipart parsing; call `touch` on incoming bytes, abort transport in its
  timeout callback, call `assertActive` before acceptance, and `release` only on
  actual request settlement. Validate session/operation/slot association before
  admission. Hold `acquireSessionUse` throughout each output/ZIP stream and
  release on close/error. These interfaces do not replace authorization.
  Existing legacy upload/download routes and UI remain unchanged: their old
  concurrency is not governed by this scheduler during migration. No new HTTP
  endpoints or frontend workflow were added in phase 3.


### Phase 4 completion — 2026-09-09

- Added authenticated Express conversion routes/controllers:
  `POST /api/sessions/:sid/conversions`,
  `GET /api/sessions/:sid/conversions/:operationId`,
  `PUT /api/sessions/:sid/conversions/:operationId/files/:fileId`, and
  `POST /api/sessions/:sid/conversions/:operationId/cancel`.
  All successful responses contain the shared `ApiConversionOperation` snapshot
  directly; creation (including an idempotent retry) returns 201, other commands
  and status return 200. No separate start command exists.
- Creation uses the shared manifest contract (`requestId`, `options.outputMime`,
  ordered `files` with `clientId`, `name`, `sizeBytes`). Server-generated slot IDs
  appear in the snapshot. A matching request ID plus normalized manifest/options
  returns the existing operation before capacity checks; conflicting intent is
  409. A simultaneous creation/legacy claim can return retryable 409
  `upload_in_progress`. The common local session claim plus durable operation
  detection prevents legacy processing from sharing an operation's session.
- Upload accepts exactly one multipart file (any field name), with no additional
  fields/files. Authenticate and check operation/slot association before parsing.
  Already accepted slots return their existing snapshot without replacing bytes.
  The server spools the raw request into an isolated temporary directory, with a
  cap of declared file bytes plus 64 KiB of multipart framing, then uses Node 22's
  multipart parser. This decoder buffers the bounded body; memory consumption is
  proportional to the configured file size and upload concurrency, not constant.
  No parser dependency was added and the legacy upload middleware stays in use
  for legacy requests.
- Incomplete/disconnected/timed-out or malformed multipart requests leave the
  slot retryable. Transport that exceeds the framing cap may have its connection
  closed before an error response can be delivered; it also stays retryable.
  An otherwise complete single-file upload with a byte mismatch/oversized file
  receives 400/413 and permanently fails its slot, allowing uploaded siblings to
  proceed. Unsupported/malformed image decoding is represented as a per-file
  `conversion_failed` outcome from the existing converter exception boundary;
  status GET remains 200 with authoritative partial/failure results.
- Upload admission lasts through pipeline settlement and temporary cleanup.
  Idle and total deadlines explicitly close the captured request socket (stream
  teardown may detach it from `IncomingMessage`). Storage rechecks request
  validity inside the publication lock after copying staged bytes. Startup
  removes abandoned `conversion-XXXXXX` request directories before listening;
  legacy temporary files and authoritative operation records are untouched.
- Status polling has a separate 240 requests/minute/IP budget and `no-store`
  responses. Matching GETs do not consume the existing command rate limit, so
  500–1000 ms polling leaves capacity for uploads and cancellation. Commands
  retain the existing application limiter.
- Added an operation-aware download router before the legacy file router.
  Existing individual file, metadata, and ZIP URLs now verify committed per-file
  results for operation sessions, regardless of operation sealing/completion.
  ZIPs include requested completed outputs and report missing/pending IDs through
  the existing `X-Missing-Ids` header. Session-use leases cover response finish or
  close so expiry cleanup cannot remove files during downloads. Sessions without
  an operation continue through the legacy sealed-session controllers.
- Validation passed:
  - `NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false NX_NO_CLOUD=true ./node_modules/.bin/nx test @image-web-convert/api`
    — 213 tests, including 22 new real-HTTP tests with injected converters for
    deterministic races, retries, limits, cancellation, partial downloads/ZIPs,
    polling budget, failed storage, abort cleanup, failed ZIP stream closure, and
    startup request cleanup.
  - `./node_modules/.bin/tsc --build apps/api/tsconfig.json --emitDeclarationOnly --force`
    — production and test TypeScript, without relying on Nx cache.
  - `NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false NX_NO_CLOUD=true ./node_modules/.bin/nx lint @image-web-convert/api`
    — no errors; two existing warnings in `files.service.spec.ts`. Run lint after
    tests: running both simultaneously can race ESLint's scan of temporary test
    directories (observed ENOENT; sequential validation passes).
  - `NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false NX_NO_CLOUD=true TMPDIR=/workspaces/image-web-convert/tmp ./node_modules/.bin/nx e2e @image-web-convert/api-e2e`
    — production API build and all four existing HTTP lifecycle tests pass.
- Next action: phase 5, the new operation UI and dedicated transport/polling hooks.
  Reuse the contracts/URLs above, send at most two uploads, render backend
  snapshots and real network byte progress, and preserve the existing UI
  components as stipulated. No frontend files or dependencies changed in phase 4.


- 2026-09-09 handoff review: Expanded phase 5 with exact API/transport contracts,
  source anchors, session/retry/revision rules, cutover boundaries, and validation
  expectations for a fresh session. Corrected the earlier polling-budget example
  to the implemented 240 requests/minute/IP. Documentation only in this handoff;
  no UI implementation or additional test execution.


### Phase 5 completion — 2026-09-16

- Built the app-owned asynchronous feature under
  `apps/web/app/routes/conversion/`: `ConversionOperationPanel` composes local
  selection and authoritative status/results presentation; `useConversionOperation`
  integrates React and the existing session abstraction; `conversionController.ts`
  owns local commands and batch identity; feature API, XHR queue, polling, and
  pure view-model modules have independent test boundaries. The route now mounts
  the new panel. The old `ConversionPage`, upload/download/progress components,
  hooks, and their tests remain unchanged.
- A keyed feature-local instance of the existing `SessionProvider` supplies one
  session per deliberate batch. Creation retries retain the frozen manifest,
  request ID, session, client IDs, and server slots. A new batch remounts the
  boundary; prior results retain their session until the user chooses that action.
  No shared session semantics changed. The only shared UI edit exports the
  existing `API_URL`; session credentials do not reach presentation children.
- One controller epoch rejects callbacks after batch cleanup; one pure merge
  function enforces session/operation association and increasing revisions across
  creation, upload, status, reconciliation, and cancellation. Backend lifecycle,
  outcomes, outputs, and aggregate counts exist only in the authoritative snapshot.
  Local state covers commands, connection readiness, selection, and transport.
- One queue admits at most two uploads, resets byte counters per attempt, tracks
  client/server identities, and aborts/cleans requests on stop. Explicit retries
  first GET authoritative state; accepted slots are never replaced. Network,
  reconciliation/conflict, session, creation, polling, cancellation, download,
  and backend outcome errors remain distinct. Rejected manifests offer a new
  batch; ambiguous creation failures retain their identities for retry.
- Polling uses recursive timeouts, one in-flight poll, a one-second healthy
  cadence, exponential backoff capped at 15 seconds, and Retry-After (which may
  require a longer delay). Terminal snapshots and access expiry stop polling.
  Session expiry also stops pending creation/uploads/downloads. Temporary
  connectivity failures never synthesize backend failure or cancellation.
- Explicit cancellation stops local transfers and sends a command while polling
  continues. A late command failure cannot overwrite cancellation confirmed by
  polling. `pagehide` alone sends authenticated best-effort keepalive cancellation;
  Strict Mode, visibility changes, rerenders, and ordinary cleanup do not send it.
- Results use backend output metadata and authenticated file/ZIP downloads without
  local File objects. Selection and download object URLs are cleaned up. Native
  controls have accessible names and disabled semantics; per-file text is associated
  with its row, and a restrained live region announces backend counts/status.
  No focus moves on polling. Selection is disabled until hydration attaches its
  command handlers, preventing clicks on inert server-rendered controls.
- Pre-cutover review explicitly checked the ten supplemental architecture points:
  no mirrored backend state, raw networking in presentation, child session/token
  knowledge, unguarded old-operation responses, orphaned timers/request handles,
  cleanup-triggered cancellation, network-as-domain errors, duplicate upload
  schedulers, synchronous batch-completion assumptions, or new generic/shared
  workflow frameworks. Uploads and polling are plain independently testable
  transports rather than additional thin hooks. No dependencies were added.
- Added 32 focused tests (13 transport/view-model, 15 controller, 4 component).
  Coverage includes concurrency, XHR progress/abort/handler cleanup, identity and
  revision races, lost acknowledgement/reconciliation, duplicate filenames,
  creation idempotency, session replacement, backoff/Retry-After/expiry, progressive
  results without local files, cancellation uncertainty, and Strict Mode/page exit.
- Updated the existing mocked Playwright scenario for manifest creation, PUT
  slots, GET polling, and authenticated progressive download. Keyboard selection,
  pending selection, and removal remain covered. The fixture imports shared
  contract types; `nx sync` added the required schema project reference to
  `apps/web-e2e/tsconfig.json`. Its unrelated base-path ordering change was reverted.
- Prerequisites: restored locked dependencies with
  `npm ci --cache /workspaces/image-web-convert/.npm-cache --no-audit --no-fund`
  and moved that cache to ignored `node_modules/.npm-cache`. Installed browser
  binaries within the repository using
  `PLAYWRIGHT_BROWSERS_PATH=/workspaces/image-web-convert/node_modules/.cache/ms-playwright ./node_modules/.bin/playwright install chromium firefox webkit`.
  The installer warned about missing native libraries; verification used Chromium.
  No OS packages, production dependencies, manifests, or lockfiles were changed.
- Initial validation exposed unsupported `replaceAll` in the frontend TS library
  target and unrealistic 2099 fixture expiries overflowing timers. Both were fixed;
  new lint warnings were removed. An intermediate Nx run required
  `NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false NX_NO_CLOUD=true ./node_modules/.bin/nx sync`
  for the E2E schema reference. The first Chromium run timed out on file selection
  before hydration; the production readiness guard fixed it, and subsequent runs
  passed. No failed checks were hidden or unrelated code changed to satisfy them.
- Final validation passed:
  - `NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false NX_NO_CLOUD=true ./node_modules/.bin/nx run-many -t test typecheck -p @image-web-convert/web @image-web-convert/ui`
    — 55 web and 49 UI tests; both project typechecks and dependencies passed.
  - `NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false NX_NO_CLOUD=true ./node_modules/.bin/nx run-many -t lint -p @image-web-convert/web @image-web-convert/ui @image-web-convert/web-e2e`
    — no errors or new warnings. Existing warnings: `root.tsx` explicit any,
    and two unnecessary escapes in legacy `FileDownload.tsx`.
  - `NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false NX_NO_CLOUD=true ./node_modules/.bin/nx build @image-web-convert/web`
    — client/server builds passed. Existing landing-page sourcemap/directive
    diagnostics and tool environment warnings remain.
  - `PLAYWRIGHT_HTML_OPEN=never PLAYWRIGHT_BROWSERS_PATH=/workspaces/image-web-convert/node_modules/.cache/ms-playwright NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false NX_NO_CLOUD=true ./node_modules/.bin/playwright test --config apps/web-e2e/playwright.config.ts --project chromium --reporter line`
    — all five mocked browser tests passed.
  - `./node_modules/.bin/tsc --build apps/web-e2e/tsconfig.json --emitDeclarationOnly`
    — E2E fixture/config typechecking passed.
  - Changed code was formatted with installed Prettier; final diff and
    `git diff --check` passed, with no backend or legacy workflow edits.
- Remaining work: phase 6 real-browser/API lifecycle verification and deliberate
  legacy retirement. No real-backend browser tests or legacy endpoint removal were
  undertaken in phase 5. Firefox/WebKit browser execution remains unverified in
  this container. Next action: implement phase 6 only when requested, beginning
  with real API/browser lifecycle fixtures and preservation of progressive results.
