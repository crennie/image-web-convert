# Image Web Convert

Image Web Convert is a small Nx monorepo for converting uploaded images to
web-friendly formats. The Express API uses Sharp for conversion and the React
Router frontend provides the browser workflow.

See the [architecture documentation](docs/architecture/README.md) for system boundaries, runtime behavior, design decisions, and quality requirements.

## Setup and development

Use Node.js 24.22.0 with its bundled npm 11.19.1 (the validated versions).
Linux ARM64 is the validated host platform; other platforms still need a clean
native-codec and filesystem check. Install the locked
dependencies and start the frontend and API with:

```sh
npm ci
NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false npm run dev
```

The frontend runs at
`http://localhost:4200`; the API defaults to port 4201. Run commands from the
repository root.

The usual validation commands are:

```sh
NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false npm run lint
NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false npm run typecheck
NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false npm test
NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false npm run build
NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false node tools/nx.mjs run @image-web-convert/api-e2e:e2e
```

Nx Cloud may warn that this local workspace is unconnected; that does not
prevent local commands from running.

The npm scripts and `node tools/nx.mjs` launcher disable the Nx daemon and place plugin-worker sockets in a fresh owner-only directory under `tmp/`. Use this launcher for direct Nx commands while Nx 21 is retained; raw `npx nx` bypasses that local-user security mitigation. Plugin isolation remains enabled to keep build environments independent.

### API URL configuration

The browser uses `/api` by default. During local development, Vite proxies that
same-origin path to the API process at `http://localhost:4201`. This keeps the
browser-facing URL consistent with a production deployment where a reverse
proxy or application platform routes `/api` to the Express service.

Production SSR documents set a per-response script nonce, restrict scripts and
connections to this origin, permit local images and browser blob previews, and
deny framing. The SSR response also sets `Referrer-Policy: no-referrer` and
`X-Content-Type-Options: nosniff`. Serve the built React Router app without
stripping these headers; apply equivalent framing and referrer policy at any
outer proxy that generates its own HTML errors. The API sets
`Cache-Control: private, no-store` on `/api` responses before request parsing,
so authenticated JSON, images, archives, and errors share the same cache policy.

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

ZIP requests accept 1–32 distinct IDs (each 1–128 ASCII letters, digits, `_`, or
`-`) and an optional archive name of at most 128 characters. Invalid requests
return HTTP 400. At most two archives run per API process; excess requests get
HTTP 503 `archive_busy` before file lookup. Each stream has a 30-second deadline.
Names in ZIP entries and download headers are bounded and sanitized; the HTTP
header provides an ASCII fallback and a UTF-8 filename.

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
404 without staging or converting files. Its backend upload modules have been
removed. The old sealed-session metadata, file, and ZIP read fallback is also
retired; file URLs serve only outputs committed by a current conversion operation.
Existing legacy files remain on disk until session expiry cleanup; code retirement
does not delete them immediately. The unmounted legacy conversion page and its
upload hook have been removed; shared legacy UI components, cosmetic progress,
and contracts remain. The active route reports actual network upload
bytes and backend file states; it does not report a measured encoding percentage.

Conversion uses the first frame of animated inputs, applies EXIF orientation,
normalizes to sRGB, and omits source metadata from outputs. Transparent pixels
become white when converting to JPEG. HEIC decoding errors fail the file rather
than retrying through another decoder. The configured input pixel ceiling is
checked before HEIC raster decode and during Sharp processing. HEIC native
header inspection and raster decode are not hard isolated from the API process.
HEIC inputs with alpha use a PNG intermediate so alpha survives non-JPEG output.

## Limits, deadlines, and storage

Backend settings are authoritative. The session response exposes its effective
file/byte limits. The session lifetime is fixed from creation and includes upload
and queue time; polling, cancellation, and downloads do not extend it. Exceeding
file/count/aggregate-byte limits returns HTTP 413 `upload_limit_exceeded`.
The active conversion screen displays the server-provided expiry deadline in
the browser's local time.

| Environment variable                        | Default     | Meaning                                                                                                        |
| ------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------- |
| `SESSION_TTL_MINUTES`                       | 15          | Fixed session lifetime                                                                                         |
| `SESSION_MAX_FILES`                         | 20          | Files per manifest                                                                                             |
| `SESSION_PER_FILE_BYTES`                    | 20000000    | Bytes per file                                                                                                 |
| `SESSION_MAX_TOTAL_BYTES`                   | 500000000   | Total declared bytes per manifest                                                                              |
| `CONVERSION_MAX_OPERATIONS`                 | 3           | Concurrent nonterminal operations admitted                                                                     |
| `CONVERSION_MAX_UPLOADS`                    | 2           | Concurrent upload transports across the process                                                                |
| `CONVERSION_UPLOAD_IDLE_MS`                 | 60000       | Upload inactivity deadline                                                                                     |
| `CONVERSION_UPLOAD_TOTAL_MS`                | 300000      | Total upload deadline                                                                                          |
| `CONVERSION_FILE_TIMEOUT_MS`                | 120000      | Cooperative per-file conversion deadline                                                                       |
| `CONVERSION_SWEEP_INTERVAL_MS`              | 1000        | Background discovery/expiry sweep interval                                                                     |
| `CONVERSION_SHUTDOWN_GRACE_MS`              | 10000       | Process shutdown grace period                                                                                  |
| `CONVERSION_MAX_INPUT_PIXELS`               | 20000000    | Input pixel ceiling, including HEIC header preflight                                                           |
| `CONVERSION_MAX_DIMENSION`                  | 8192        | Maximum output dimension                                                                                       |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS`   | 100 / 60000 | General request budget per IP                                                                                  |
| `TRUSTED_PROXY_IPS`                         | empty       | Comma-separated IP addresses of immediate trusted reverse proxies; forwarded IP headers are ignored by default |
| `BODY_LIMIT_JSON` / `BODY_LIMIT_URLENCODED` | 2mb / 2mb   | Maximum parsed request body size; positive byte counts with optional `b`, `kb`, `mb`, or `gb` suffixes         |

Session creation has a separate three-per-minute/IP limit. Operation status
polling has a separate 240-per-minute/IP budget and does not consume the general
command budget. Session creation does consume the general budget. Health and
readiness requests are exempt. All other requests use the general limiter before
body parsing; a rejected request returns HTTP 429 with `Retry-After`. Configured
cross-origin responses expose that header to browser code. CORS does not grant
access or protect the API from nonbrowser clients. The limiters are process-local.

Leave `TRUSTED_PROXY_IPS` empty when clients connect directly. Behind a reverse
proxy, set it to the exact IP address of each proxy peer that can connect to the
API, for example `TRUSTED_PROXY_IPS=127.0.0.1`. Do not use a hop count: requests
that bypass the proxy must not be able to choose their own rate-limit identity.
The trusted proxy must replace or append the real client address to
`X-Forwarded-For`; the API uses the nearest untrusted address in that chain.
Restrict direct access to the API from untrusted networks, and avoid listing an
address shared with untrusted clients. Invalid proxy IPs and rate-limit values
fail startup.

Multipart staging limits the body to declared file bytes plus
64 KiB of framing. The bounded multipart decoder buffers the body, so memory use
scales with file size and upload concurrency.

Operation creation and ZIP download requests require `Content-Type: application/json`;
unsupported media types return HTTP 415. Malformed parsed bodies return HTTP 400
`INVALID_BODY`, oversized bodies return HTTP 413 `PAYLOAD_TOO_LARGE`, and
unsupported body encodings return HTTP 415 `UNSUPPORTED_BODY`. These parser
errors use `{ "error": { "code", "message" } }`; operation validation retains
its existing `{ "type", "message" }` response. URL-encoded input is size-limited
but is not accepted for operation creation or ZIP downloads.

Deadlines do not guarantee interruption of native code. Sharp's timeout covers
libvips processing, excluding thread-pool waiting; the runtime also checks elapsed
time when work settles. Timed-out conversions retain the worker slot and input
until their invocation settles, and late results are discarded. HEIC preprocessing
can allocate decoded pixels and synchronously encode after its dimension preflight;
the pixel ceiling and Sharp timeout do not hard bound native memory/CPU use. Hard
wall-clock termination would require separate process isolation, which this app
does not implement.

For the supported single-process self-host profile, reserve **2 GiB of RAM for
the API process** and retain the 20 MP input default unless the host is measured
again. `node tools/measure-image-budget.mjs` runs two fixed fixtures in separate
child processes, each with a 30-second deadline; the parent kills only that
child if it stalls. In two runs on Linux aarch64, Node 22.22.0 and Sharp
0.35.5, the 12 MP HEIC fixture took 1.86–2.66 seconds and reached 377–381 MiB
peak RSS; a generated 20 MP PNG took 0.26–0.32 seconds and reached 179–185 MiB.
These are cold-process observations, not worst-case memory or latency
guarantees. Other codecs, profiles, frame counts, and inputs can use more.
Monitor RSS and keep uploads
private to trusted users. **Untrusted public image uploads are unsupported**
until PF-20 decides on process isolation or a narrower enforced input policy.

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
records are isolated/reported; fatal storage faults stop scheduling/readiness and
make the production API begin shutdown immediately. In-flight transfers get up
to the configured shutdown grace period; the process exits with an error. A
supervisor can restart it, but a persistent storage fault prevents readiness.
A background sweep reclaims expired operation, create-only, and sealed legacy
sessions. Cleanup waits for active request, conversion, upload, and download
leases before removing files. It ignores unrelated directories and symlinks.
Malformed records and directories still missing a session record after five
minutes are retained and reported once per process with their session ID in
runtime diagnostics; an operator must repair or remove them.
Filesystem scan, deletion, or download read failures also trigger this shutdown.
If a download has already sent headers when storage fails, its partial response
is closed. A client disconnect is a transport error and does not trigger a
storage-fault shutdown.
Shutdown stops accepting work and starting new files, drains active work within
the grace period, and relies on restart recovery if the process must exit early.

## Browser testing

The [use-case inventory](docs/testing/use-case-inventory.md) maps current conversion behaviors to test evidence and coverage levels.

The standard browser `e2e` target runs against built frontend and API artifacts,
real image encoding, and isolated filesystem storage. It builds its prerequisites,
starts the normal API entrypoint and React Router production server, and supplies
a test-only same-origin reverse proxy for `/api`. It never reuses a running dev
server. Each test owns temporary storage under `tmp/browser-tests`, dynamically
allocated ports, readiness checks, and process/data cleanup.

Install the locked dependencies with `npm ci`, matching CI.
The devcontainer image installs Chromium, Firefox, and WebKit plus their system
libraries using the Playwright version in the root `package-lock.json`. Browsers
are available to the `vscode` user through
`PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers`; keep that image-provided path
when running tests. Rebuild the devcontainer after changing the Dockerfile or
upgrading Playwright in the lockfile. Editing the Dockerfile does not install
libraries into an already-running container.

On a supported local machine or CI runner, install the matching browser binaries
and system prerequisites once:

```sh
npx playwright install --with-deps
```

In a workspace-restricted container without the preinstalled browsers, install browser binaries inside the repository
and use the same path when running tests. Native OS libraries must already be
available; missing libraries are an execution failure, not a skipped success.

```sh
export PLAYWRIGHT_BROWSERS_PATH="$PWD/node_modules/.cache/ms-playwright"
npx playwright install chromium firefox webkit
```

Run the same targets locally and in CI:

```sh
NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false node tools/nx.mjs run @image-web-convert/web-e2e:e2e
NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false node tools/nx.mjs run @image-web-convert/web-e2e:browser-integration
```

`e2e` covers complete and partial batches, decoded individual downloads in
default WebP and selected JPEG, PNG, and AVIF formats, decoded ZIP contents,
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
ZIP name/order collisions, malformed requests, authorization, expiry cleanup, effective
limits, byte mismatches, idle and total upload deadlines, decode failures with
partial downloads and endpoint retirement, including rejected legacy reads.
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
