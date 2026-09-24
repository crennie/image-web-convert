# Image Web Convert

Image Web Convert is a small Nx monorepo for converting uploaded images to
web-friendly formats. The Express API uses Sharp for conversion and the React
Router frontend provides the browser workflow.

## Setup and development

Use Node.js 22 with npm 10 (the validated local version). Install the locked
dependencies and start the frontend and API with:

```sh
npm ci --legacy-peer-deps
NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false npm run dev
```

The install flag matches CI's peer-dependency resolution. The frontend runs at
`http://localhost:4200`; the API defaults to port 4201. Run commands from the
repository root.

The usual validation commands are:

```sh
NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false npm run lint
NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false npm run typecheck
NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false npm test
NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false npm run build
NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false npx nx run @image-web-convert/api-e2e:e2e
```

Nx Cloud may warn that this local workspace is unconnected; that does not
prevent local commands from running.

### API URL configuration

The browser uses `/api` by default. During local development, Vite proxies that
same-origin path to the API process at `http://localhost:4201`. This keeps the
browser-facing URL consistent with a production deployment where a reverse
proxy or application platform routes `/api` to the Express service.

Set `API_PROXY_TARGET` when the local API process is available at a different
origin. Set `VITE_API_URL` at frontend build time only when a deployment exposes
the API at a different browser-facing base URL; cross-origin deployments must
also configure the API's `CORS_ORIGIN` appropriately.

## Repository layout

- `apps/web` contains the React Router frontend.
- `apps/api` contains Express routes/controllers, application services, image
  processing, and filesystem storage.
- `apps/api-e2e` starts isolated API processes and exercises real routing,
  conversion, storage, downloads, and recovery.
- `apps/web-e2e` contains real browser/API E2E tests and separate mocked browser
  integration tests.
- `libs/schemas` contains shared Zod request, response, error, and limit
  contracts used at application boundaries.
- `libs/ui`, `libs/node-shared`, and `libs/observability` contain reusable UI,
  Node, and telemetry code.

## Conversion lifecycle

The API owns each conversion operation and runs as one persistent Node process
for local, single-user use. It uses filesystem persistence and an in-process
scheduler; multiple API processes must not share the storage root. The completed
migration is recorded in [the implementation plan](docs/plans/asynchronous-conversions.md).

1. The browser creates a short-lived session and a fixed manifest: filenames,
   declared byte sizes, client IDs, and output MIME. Each session owns one operation;
   choosing a new batch creates a new session.
2. The API assigns file slots. The browser uploads at most two files concurrently,
   one multipart PUT per slot. Authentication and slot/admission checks happen
   before multipart parsing. An acknowledgement means bytes were durably accepted,
   not that conversion finished. Accepted slots cannot be overwritten.
3. Once all slots have uploads or permanent failures, processing starts automatically.
   Ready operations run FIFO, with one active conversion across the process and
   manifest order within each operation. No start command or status polling is
   needed to advance backend work.
4. The browser polls authoritative snapshots, normally once per second, with
   backoff on connection errors. Network byte progress is distinct from server
   acceptance and completed/failed/processing counts. A network error does not
   declare a conversion failed; retries reconcile with server state first.
5. Completed images and metadata are available immediately, including while
   siblings are processing or after cancellation. Individual downloads and ZIPs
   require the session bearer token. A file failure preserves successful siblings;
   snapshots report `partially_completed` or `failed` rather than returning a
   synchronous batch result. Successful status requests return HTTP 200.

Operation creation owns a process-local session claim, reads current persisted
session state, and serializes admission. Matching intent retries reuse the existing
operation; a different intent returns HTTP 409 `conversion_conflict`. Upload claims
are per file slot: a second active upload to that slot returns HTTP 409
`upload_in_progress` before multipart staging. Sibling slots and other sessions
remain independent within the configured capacity limits. Upload claims release after
transport settlement and temporary-file cleanup; a timeout alone does not free
capacity. These guarantees apply to one API process, not distributed workers.

ZIPs preserve requested file order and use unique entry names, including when
original names already contain suffixes such as `(2)`. If some requested IDs have
no completed output, the response lists them in `X-Missing-Ids` and includes the
available files; if none are available it returns 404. A source failing after
resolution fails the archive rather than silently dropping that entry. Archive
errors before streaming are returned as HTTP errors; after headers are sent the
response is closed. Client aborts stop pending archive work.

The conversion endpoints are:

| Method | Path                                                        | Purpose                                                                   |
| ------ | ----------------------------------------------------------- | ------------------------------------------------------------------------- |
| POST   | `/api/sessions`                                             | Create a session and receive its token and limits                         |
| POST   | `/api/sessions/:sid/conversions`                            | Create an immutable operation; matching request-ID retries are idempotent |
| PUT    | `/api/sessions/:sid/conversions/:operationId/files/:fileId` | Upload one slot; reconcile/retry an interrupted transfer                  |
| GET    | `/api/sessions/:sid/conversions/:operationId`               | Read the authoritative snapshot                                           |
| POST   | `/api/sessions/:sid/conversions/:operationId/cancel`        | Request cooperative cancellation                                          |
| GET    | `/api/sessions/:sid/files/:fileId`                          | Download a completed image                                                |
| GET    | `/api/sessions/:sid/files/:fileId/meta`                     | Read completed-image metadata                                             |
| POST   | `/api/sessions/:sid/files/download`                         | Download a ZIP with `{ ids, archiveName? }`                               |

Explicit cancellation stops queued local uploads and requests backend cancellation.
An active encoder may finish successfully; later files are skipped and existing
outputs remain downloadable. The UI waits for server confirmation and permits
retry if cancellation is uncertain. On `pagehide`, including navigation or reload,
the browser sends a best-effort authenticated keepalive cancellation request.
Delivery is not guaranteed: if it never arrives, the backend continues processing
or expires the operation independently. Credentials are not persisted for browser
recovery, and refreshing/reopening a tab is not a resume feature.

The synchronous `POST /api/sessions/:sid/uploads` endpoint is retired and returns
404 without loading its multipart middleware or starting conversion. Existing
sealed legacy sessions still support authenticated metadata, file, and ZIP reads
until their original expiry. The old shared UI components, cosmetic progress,
contracts, and backend upload modules remain for compatibility tests and separate
cleanup. The preserved `useFileUploads` hook calls the retired endpoint and is
not a supported end-to-end workflow; the mounted route uses the operation API.
The legacy waiting indicator is explicitly cosmetic and displays no measured
percentage or conversion stage. API completion/error controls that legacy page's
workflow. The active route reports actual network upload bytes and backend file
states; it does not report a measured encoding percentage.

## Limits, deadlines, and storage

Backend settings are authoritative. The session response exposes its effective
file/byte limits. The session lifetime is fixed from creation and includes upload
and queue time; polling, cancellation, and downloads do not extend it. Exceeding
file/count/aggregate-byte limits returns HTTP 413 `upload_limit_exceeded`.

| Environment variable                      | Default     | Meaning                                         |
| ----------------------------------------- | ----------- | ----------------------------------------------- |
| `SESSION_TTL_MINUTES`                     | 15          | Fixed session lifetime                          |
| `SESSION_MAX_FILES`                       | 20          | Files per manifest                              |
| `SESSION_PER_FILE_BYTES`                  | 20000000    | Bytes per file                                  |
| `SESSION_MAX_TOTAL_BYTES`                 | 500000000   | Total declared bytes per manifest               |
| `CONVERSION_MAX_OPERATIONS`               | 3           | Concurrent nonterminal operations admitted      |
| `CONVERSION_MAX_UPLOADS`                  | 2           | Concurrent upload transports across the process |
| `CONVERSION_UPLOAD_IDLE_MS`               | 60000       | Upload inactivity deadline                      |
| `CONVERSION_UPLOAD_TOTAL_MS`              | 300000      | Total upload deadline                           |
| `CONVERSION_FILE_TIMEOUT_MS`              | 120000      | Cooperative per-file conversion deadline        |
| `CONVERSION_SWEEP_INTERVAL_MS`            | 1000        | Background discovery/expiry sweep interval      |
| `CONVERSION_SHUTDOWN_GRACE_MS`            | 10000       | Process shutdown grace period                   |
| `CONVERSION_MAX_INPUT_PIXELS`             | 200000000   | Sharp input pixel ceiling                       |
| `CONVERSION_MAX_DIMENSION`                | 8192        | Maximum output dimension                        |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | 100 / 60000 | General request budget per IP                   |

Session creation has a separate three-per-minute/IP limit. Operation status
polling has a separate 240-per-minute/IP budget and does not consume the general
command budget. Multipart staging limits the body to declared file bytes plus
64 KiB of framing. The bounded multipart decoder buffers the body, so memory use
scales with file size and upload concurrency.

Deadlines do not guarantee interruption of native code. Sharp's timeout covers
libvips processing, excluding thread-pool waiting; the runtime also checks elapsed
time when work settles. Timed-out conversions retain the worker slot and input
until their invocation settles, and late results are discarded. HEIC preprocessing
can allocate decoded pixels and synchronously encode before Sharp sees the image;
Sharp's pixel ceiling and timeout do not bound that earlier memory/CPU use. Hard
wall-clock termination would require separate process isolation, which this app
does not implement.

Storage paths are centralized in `apps/api/src/services/storage.paths.ts`; session
persistence and conversion storage share those helpers. `UPLOAD_DIR` defaults to
`data/uploads` relative to the API process working directory. Each operation
session directory contains `session.info.json`, the durable `conversion.info.json` operation, accepted inputs
under `inputs/`, and committed images with `<file-id>.json` metadata sidecars.
Internal `.conversion-staging/` and `.conversion-commits/` directories support
per-file crash consistency. `UPLOAD_TMP_DIR` defaults to `data/tmp` relative to the
process working directory and holds incomplete request bodies.
Rejected/disconnected request staging is removed, leaving interrupted slots
retryable. Committed outputs from other files are never rolled back because a
sibling fails. Uncommitted output staging is removed after an attempt; interrupted
publication is reconciled from durable receipts on restart before serving results.

On startup, the API cleans abandoned conversion request staging and recovers
operations before listening and reporting ready. Valid committed output survives;
a file interrupted without a valid commit becomes `processing_interrupted`, and
valid remaining uploads can continue without browser polling. Invalid session
records are isolated/reported; storage mutation failures stop scheduling/readiness.
A background sweep expires operation sessions, but cleanup waits for active
conversions and download leases before removing their files. Legacy-only session
directories are not removed by the operation sweep; their access still expires.
Shutdown stops accepting work and starting new files, drains active work within
the grace period, and relies on restart recovery if the process must exit early.

## Browser testing

The standard browser `e2e` target runs against built frontend and API artifacts,
real image encoding, and isolated filesystem storage. It builds its prerequisites,
starts the normal API entrypoint and React Router production server, and supplies
a test-only same-origin reverse proxy for `/api`. It never reuses a running dev
server. Each test owns temporary storage under `tmp/browser-tests`, dynamically
allocated ports, readiness checks, and process/data cleanup.

Install the locked dependencies with `npm ci --legacy-peer-deps`, matching CI.
On a supported local machine or CI runner, install the matching browser binaries
and system prerequisites once:

```sh
npx playwright install --with-deps
```

In a workspace-restricted container, install browser binaries inside the repository
and use the same path when running tests. Native OS libraries must already be
available; missing libraries are an execution failure, not a skipped success.

```sh
export PLAYWRIGHT_BROWSERS_PATH="$PWD/node_modules/.cache/ms-playwright"
npx playwright install chromium firefox webkit
```

Run the same targets locally and in CI:

```sh
NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false npx nx run @image-web-convert/web-e2e:e2e
NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false npx nx run @image-web-convert/web-e2e:browser-integration
```

`e2e` covers complete and partial batches, decoded individual/ZIP contents,
cancellation preserving completed results, a stream interrupted after API staging,
retry of the same slot, and actual navigation with delivered or dropped page-exit
cancellation. `browser-integration` retains focused UI checks with mocked API
responses; it is not end-to-end coverage.

For deterministic cancellation/crash timing, a test-only API executable uses the
production app/runtime and real encoder with an IPC-controlled pause before an
encoder invocation. No control routes or fake encoder results are added to the
production API. Ordinary conversion/failure/retry browser scenarios use the normal
built API entrypoint. The API process suite (`nx run @image-web-convert/api-e2e:e2e`)
checks abrupt and graceful restarts, committed-output retention, interrupted-file
recovery, processing without status GETs or exit cancellation, upload disconnects,
concurrent operation creation, per-slot contention with independent-session progress,
ZIP name/order collisions, malformed requests, authorization/expiry, effective
limits, decode failures with partial downloads, endpoint retirement, and sealed
legacy downloads.
Restart recovery always uses the normal production entrypoint. Nx builds the test executable as a prerequisite.
The API `e2e` target delegates to its uncached `test` target, which also runs via
`npm test`; browser E2E must be invoked separately or through `npm run ci:hook`.
API tests use their own storage under `tmp/api-lifecycle`. Test APIs default to
normal resource limits, with a 100 ms sweep and a 1000/minute general request
budget. The aggregate-limit test lowers only its own byte budget via the existing
environment setting; production defaults above are unchanged.

Both browser targets run Chromium, Firefox, and WebKit with one worker and no
retries. To verify only Chromium in a constrained environment, append
`-- --project=chromium` (the separator passes the option to Playwright). This
does not verify the other browsers. Tests always execute
rather than using an Nx test-result cache. Use the default same-origin build
configuration (`VITE_API_URL` unset); do not build these tests against an external
API URL.

GitHub Actions and `npm run ci:hook` require real API E2E and both browser targets.
On CI failure, the `browser-test-diagnostics` artifact retains HTML reports, failure screenshots,
and server stdout/stderr logs for seven days. Local diagnostics are under
`apps/web-e2e/test-output/{e2e,integration}` and
`apps/api-e2e/test-output/lifecycle`. Network traces and videos are disabled
to keep session bearer tokens and response bodies out of retained artifacts.
The harness disables API request telemetry and deletes session storage after each
test. Browser launch or application readiness failures fail the command and
include diagnostics; there is no fallback to mocks or an existing server.

## License

Licensed under the MIT License. See [LICENSE](./LICENSE). Security reports are
covered by [SECURITY.md](./SECURITY.md).
