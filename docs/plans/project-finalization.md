# Project finalization and hardening

## Status and continuation contract

- Discovery completed: 2026-10-16; baseline commit `ec20ff482267d8fa2569fa85a7d1955a337ff806`.
- Scope: personal, self-hosted, single persistent API process with exclusive local storage. Public anonymous hosting is a separate release gate, not an implicit requirement to add accounts, a database, a queue, SaaS monitoring, or distributed workers.
- Discovery and PF-01 changed only documentation. PF-02 updates exposed dependency families, adds boundary regressions, and preserves telemetry/build behavior; see its checkpoint for current evidence.
- Task states: `pending`, `in_progress`, `blocked`, `done`, `deferred`. PF-01, PF-01A, PF-02, PF-03, PF-04, PF-05, PF-06, and PF-07 are **done**; PF-08 is **in_progress**; PF-20 is **deferred** for this private self-host release; all other tasks are **pending**. Discovery is **done**, with explicitly recorded verification gaps. Priorities: **P0** release blocker/security exposure; **P1** required finalization; **P2** bounded cleanup/documentation; **PUBLIC** required before untrusted public exposure.
- In subsequent sessions, select the highest-priority ready task (listed order breaks priority ties), mark it in progress here, inspect only changed evidence, implement one reviewable slice, run its tests, and record commit, commands, outcomes, residual risks, and status. Do not mark a task done merely because a test file exists. Refresh registry/security results at implementation time; do not repeat the entire assessment.
- Preserve the architecture's HTTP adapter → runtime → transitions/storage/encoder boundaries, immutable manifests, independent commits, process-local claims/leases, and controlled-process test seams. The maintainer decided to retire sealed legacy-session reads; preserve current operation downloads at the shared file URLs.

## Current-state inventory

| Area                | Observed implementation and gaps                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace           | npm workspaces, lockfile v3 (2,251 package entries including root/workspaces), eight Nx projects: web, API, two E2E projects, schemas, UI, node-shared, observability. Node engine `>=22 <23`; inspected environment Node 22.22.0/npm 10.9.4. No alternative package manager needed.                                                                                                                                                                                |
| Build orchestration | Nx 21.6.2 inferred TypeScript, React Router, ESLint, Vite, Playwright and Webpack targets. API Webpack generates a package manifest; explicit prune/copy-workspace targets exist. Test targets depend on upstream builds. API E2E's `e2e` delegates to uncached `test`; browser suites are separate uncached targets.                                                                                                                                               |
| API                 | Express 4.21.2, Helmet/CORS/HPP/compression/rate limits, shared Zod contracts. Anonymous session creation grants a scoped bearer capability; SHA-256 token hashes on disk, constant-time comparison. New operation routes validate identifiers before authorization/staging. No user account or perimeter access control.                                                                                                                                           |
| Conversion/storage  | Sharp 0.34.4 plus heic-convert 2.1.0; one active conversion, two uploads, three admitted nonterminal operations by default. Bounded multipart spooling then buffered `Response.formData()`. Durable atomic JSON, fsync, fingerprints and per-file receipts; FIFO scheduling, restart recovery, lease-aware cleanup. These are strengths to preserve.                                                                                                                |
| Web                 | React 19.1.1, React Router 7.9.1 **SSR enabled**, Vite 7.1.7, Tailwind 4. Active `/conversion` uses a controller, fetch/XHR transport, reconciliation, real byte progress, polling/backoff, page-exit cancellation, in-memory session tokens and blob previews/downloads. Reload does not resume. Google Fonts is an external browser request.                                                                                                                      |
| Tests               | Vitest 3.2.4, Testing Library, Playwright 1.55.1; real API subprocess/encoder tests and real browser E2E separated from mocked browser integration. Existing coverage configuration has no enforced thresholds and excludes some web entry/routes. Observability's only test is `expect(1).toBe(1)`.                                                                                                                                                                |
| CI                  | GitHub Actions runs install with `--legacy-peer-deps`, browser installation, inventory checker and all validation targets. Read-only permissions, cancellation and seven-day failure artifacts already exist. No dependency-update configuration or audit job. Stale Nx Cloud comments, cloud ID and `nx fix-ci` remain despite `neverConnectToCloud`. Formatting is not gated.                                                                                     |
| Docker/deployment   | Only `.devcontainer/Dockerfile`, no production Dockerfile/Compose. Devcontainer derives from nonportable `local-agentic-dev/codex-agent:dev`, copies Node 22.22.0 and locked Playwright browsers. Deployment documentation describes `/api` proxying but supplies no complete production startup/proxy recipe. Do not call the agent image a production image.                                                                                                      |
| Documentation       | README thoroughly documents lifecycle, limits and tests but lacks real screenshots and a concise first-run/production guide. Architecture views are useful. Two ADR-001s and two ADR-002s, overlapping recovery documents and historical plans need canonical links. Library READMEs remain Nx templates. At discovery, SECURITY.md offered a “private issue” without a concrete supported reporting channel; the 2026-10-17 decision below corrected that wording. |

Reviewed evidence includes root scripts/configuration, all project manifests, CI/devcontainer, architecture quality/static/dynamic/decision documents, historical plans, testing inventory/method and UI testing notes; API entrypoint/middleware/routes/controllers, authentication, session/path/image/archive/storage/runtime services; active frontend transport/controller/UI/session workflows and representative assertions. This is a source/configuration assessment, not proof of every exploit or a penetration-test certificate.

## Application-specific findings and threat model

Assets: private original/converted images, names/metadata, session bearer tokens/hashes, host filesystem, CPU/RAM/disk/file descriptors, output integrity and availability. Actors: trusted operator, normal browser, another session holder, unauthenticated HTTP client, malicious image supplier, compromised dependency/build input. Trust boundaries: browser → SSR server/proxy → API; anonymous session issuance → authenticated operations; HTTP/body/magic-byte decoder → native/JS encoders; persisted JSON/paths → downloads/recovery; logs/artifacts → operator. Local filesystem modification is not assumed remotely available; metadata/symlink threats must distinguish malicious disk access from remotely reachable input.

| Finding                                   | Evidence, impact and confidence                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Task            |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| F01 Error middleware is incorrectly wired | `apps/api/src/app.ts` mounts `errorTranslator` rather than its result; `libs/observability/src/lib/express.ts` returns a three-argument function. Express requires a four-argument error handler. Confirmed source defect: parser/global errors miss intended JSON handling. Legacy `show`/`meta` async handlers also lack rejected-promise forwarding under Express 4. Conversion wrappers already catch their own failures.                                                            | PF-03           |
| F02 Parser ordering/limits                | An early `express.urlencoded({extended:true})` precedes HPP and the configured limited `extended:false` parser; the first parser consumes matching bodies, so the configured later policy is ineffective. Parser work precedes rate limiting. Body-limit strings are not semantically validated by EnvSchema. Determine whether URL-encoded input is needed at all.                                                                                                                      | PF-03, PF-04    |
| F03 Proxy/rate-limit trust                | `app.set('trust proxy',1)` applies even when `main.ts` listens on all interfaces. A directly reachable API can accept a client-chosen forwarded IP, undermining per-IP controls. Rate limits are process-local; session issuance is three/minute/IP, status 240/minute/IP, general 100/minute/IP. CORS is not authentication and does not prevent nonbrowser abuse.                                                                                                                      | PF-04           |
| F04 Unbounded ZIP amplification           | `ApiDownloadFilesRequestSchema.ids` has only a minimum length; repeated IDs are resolved and archived repeatedly. JSON byte limit is finite but permits many IDs; no archive concurrency/output/member budget. `writeZip` uses zlib level 9 on already compressed images. Downloads hold leases until finish/close. Slow/repeated downloads can retain expired data and consume CPU/disk reads.                                                                                          | PF-05           |
| F05 Download-name robustness              | `files.service.ts` interpolates sanitized names into the quoted filename header, but does not remove control characters or provide an ASCII fallback for arbitrary Unicode. Node may reject CR/LF/non-Latin-1 headers; do not misreport this as confirmed response splitting. Archive entry portability, trailing dots and encoded names need tests.                                                                                                                                     | PF-05           |
| F06 Session retention gap                 | `conversion-storage.service.ts:listSessions` discovers only directories with conversion records. Empty sessions and sealed legacy sessions are never swept. Anonymous session creation can accumulate directories indefinitely, independent of the three-operation admission cap. Invalid records are isolated but need a bounded/operator-visible retention policy.                                                                                                                     | PF-06           |
| F07 Decode/resource boundary              | HEIC preprocessing reads the entire file and decodes/encodes before Sharp's pixel/timeout limits. Default 200M pixels is potentially hundreds of MB before intermediates. Exceptions from HEIC conversion are swallowed and fall back to the original input; a unit test currently codifies that behavior. Sharp's timeout is cooperative, not hard interruption. Output is also buffered. The untrusted input sniffer itself precedes the MIME allowlist.                               | PF-02, PF-07    |
| F08 Disk/auth/error robustness            | Legacy session and metadata JSON are unchecked casts; invalid expiry dates can make `isSessionExpired` return false. Auth collapses all read errors into 404. New conversion storage is substantially stronger. Plain `path.join` helpers are not standalone containment checks; new route guard runs before legacy file fallthrough, so no unauthenticated traversal is asserted. Validate metadata stored names and symlink containment, private modes/umask and fault classification. | PF-08           |
| F09 Privacy/response surface              | API Helmet headers do not protect SSR HTML. `root.tsx` renders `error.stack`; verify production Router sanitization and suppress application details explicitly. Authenticated JSON/images have no explicit common private/no-store policy. `sendFile` caching/conditional/range behavior must preserve authorization/expiry. External fonts and CSP for Router scripts need an intentional privacy/security policy.                                                                     | PF-09           |
| F10 Telemetry correctness                 | Only trivial smoke coverage. `OTEL_TRACES_SAMPLER ?? isProd ? ...` and `LOG_LEVEL ?? isProd ? ...` have conditional-precedence defects, ignoring intended environment values. ENABLE_OTEL treats any string except “false” as truthy. `main.ts` discards telemetry shutdown controller. Incoming request IDs are accepted without app-level length/format validation. Verify redaction including exceptions and instrumentation, not just configured paths.                              | PF-10           |
| F11 Packaging/runtime uncertainty         | Root test/type-only packages are production deps; runtime imports pino/OTel and UI helpers are declared in devDependencies. Observability puts most runtime imports in devDependencies. Generated/pruned deployment package may compensate: test its actual closure rather than asserting every root misclassification breaks production.                                                                                                                                                | PF-14           |
| F12 Dependency vulnerabilities            | Registry audit identifies direct and transitive affected packages, including Router SSR, compression, rate limiting, file sniffing, Express and native image dependencies. Severity counts are package advisories/propagation, not independently proven reachable exploits. See inventory below.                                                                                                                                                                                         | PF-02, PF-11–14 |

Attack scenarios to verify: cross-session operation/slot/file access; encoded/malformed identifiers; malicious declared MIME/magic mismatch; malformed multipart including compressed/request framing boundaries; parser bombs; decode bombs; session/ZIP floods; slow uploads/downloads; proxy header spoofing and IPv4-mapped IPv6; cache reuse after expiry; hostile filenames; corrupt/partial records; ENOSPC/EACCES during acceptance/publication; interrupted process; log/token disclosure; SSR route/manifest/error paths. Remote image URL fetching is not a feature, so generic SSRF work should focus on actual proxy/telemetry configuration rather than inventing a URL-import feature. Bearer headers are not ambient cookies; focus CSRF review on actual SSR/action/session-creation behavior, without adding cookie-CSRF machinery blindly.

## Tests and evidence gaps

`npm run check:use-cases` validates **73 cases, all mapped covered** through PF-07. This is a behavior/evidence-map result, not 100% code coverage or a fresh execution verdict. Reuse `docs/testing/use-case-inventory-method.md`; extend JSON and readable inventory together for new contracts.

Existing protection includes creation idempotency/conflicts, auth/expiry, byte budgets, malformed uploads, contention and disconnects, deadlines, FIFO, independent commits, cancellation, abrupt/graceful recovery, partial ZIP/name ordering, real decoded WebP/JPEG/PNG/AVIF downloads and browser navigation. Avoid duplicating these happy paths merely to inflate test counts.

Missing or insufficiently evidenced protection:

- Global middleware/parse errors, async rejection, proxy topology, nonspoofable limiter identity, authenticated cache headers, log redaction and real telemetry configuration.
- Empty/legacy session expiry, bounded archive requests/concurrency, control/Unicode filenames, slow download lease release, all read/write error classifications.
- Real HEIC decoder/resource behavior, EXIF orientation and GPS stripping, ICC/sRGB/alpha, animated first-frame policy and pixel/dimension boundaries. Current image service unit tests mock Sharp/HEIC; output decoding E2E alone does not prove metadata removal.
- Clean production-only deployment closure and restart on supported filesystems/architectures. No measured memory/disk/latency baseline; no new arbitrary performance SLO should be claimed.
- UI notes explicitly retain tooltip lifecycle, generic modal variations, collapse focus transfer, reduced-motion spinner/accordion, narrow long-list layout, Back/Forward/reload variants, held/error downloads and real screen-reader checks. Preserve real-browser evidence for focus/inert behavior; jsdom dialog shims are insufficient.
- Cross-browser execution must be checked afresh; prior documentation only established Chromium for some historical revisions. No measured coverage percentage is available from discovery.

## Dependency and runtime modernization strategy

Use npm and the existing lockfile. Do not run `npm audit fix --force` or mass-update every latest version. First patch reachable security issues with minimal compatible updates; then coordinate runtime/toolchain migrations; finally prune proven-unused dependency families. An out-of-range pre-1.0 minor (Sharp, OTel, SWC) can be a breaking upgrade.

Registry results are a dated snapshot, not a promise that all latest versions are mutually compatible. Full direct-package version inventory and advisory tables follow the task list. `npm outdated` was run after installing the baseline; locked versions are read from the lockfile, independent of npm's transient install observations.

| Upgrade group     | Current → discovered candidate                                                                        | Constraint / required migration check                                                                                                                                                                                                                                                                                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime           | Node 22.22.0 → patched supported LTS; evaluate Node 24                                                | Coordinate engines, CI, devcontainer, documentation and `@types/node` (currently 24.6.0 despite runtime 22). Keep supported LTS rather than defaulting to Current. Confirm Sharp/HEIC/native artifacts, npm and platform compatibility. [Node release policy](https://nodejs.org/en/about/previous-releases).                                                                             |
| Nx                | All core plugins 21.6.2 → 23.3.0 candidate                                                            | Run reviewed migration batches 21→22→23, keep plugins aligned, assess inferred targets, workspace TS references and prune outputs. Existing `@nx/vite` peers permit Vite 5/6/7 and Vitest 1/2/3, explicitly excluding latest majors. Consult [Nx TypeScript guidance](https://nx.dev/docs/technologies/typescript/introduction); current target peers are authoritative.                  |
| Express           | 4.21.2 → patched 4.22.3 interim / 5.3.0 target                                                        | Upgrade `@types/express` 4→5 and observability's duplicate Express declaration. Express 5 changes query getters/parser defaults, body semantics, route syntax, rejected promises, listen errors and MIME handling. Check HPP's mutation assumptions; current simple named routes reduce wildcard migration work. [Official migration guide](https://expressjs.com/en/guide/migrating-5/). |
| Router/React      | Router family 7.9.1 → patched 7.18.4; 8.4.0 separately evaluated; React/DOM 19.1.1 → 19.3.1 candidate | Patch matching Router dev/node/serve/core together first. SSR, typegen, build outputs, error handling and Nx router-plugin integration must survive. No React Server Components adoption required.                                                                                                                                                                                        |
| Build/test        | Vite 7.1.7→8.3.4; Vitest/coverage/UI 3.2.4→5.0.5; plugin-react 5→6; jsdom 27→29                       | Incompatible with current Nx peers; migrate only after PF-12. Review intermediate migration guides, workspace/project configuration, mocks, coverage semantics, DOM/focus and bundler behavior.                                                                                                                                                                                           |
| Language/lint     | TypeScript 5.9.2→7.0.2 candidate; ESLint 9→10; Babel 7→8; webpack-cli 6→7                             | Do not assume “latest” supported by Nx, typescript-eslint, React/Playwright lint plugins or TS declaration tooling. Patch supported versions first; retain a documented compatibility ceiling where necessary.                                                                                                                                                                            |
| Native/archives   | Sharp 0.34.4→0.35.5; archiver 7→8; file-type 21→22 candidate                                          | Sharp security fixes require leaving the declared minor range. Verify codec binaries/metadata/HEIC, archive import/API/types and file-type module/Node requirements. A patched file-type 21.3.4 exists; major is not prerequisite for that security fix.                                                                                                                                  |
| Observability     | pino/HTTP + OTel stable 2.x and experimental 0.203/0.62 lines                                         | Upgrade coherent SDK/exporter/instrumentation families; inspect peer ranges and Express 5 instrumentation. Remove unused instrumentation only with import/runtime evidence. Keep telemetry optional and local; no collector service required.                                                                                                                                             |
| CSS/browser tools | Tailwind plugins 4.1.13→4.3.3; Playwright 1.55.1→1.64.1; Testing Library and Prettier patches/majors  | Regenerate matching browser installation through devcontainer/CI; run all engines. Review visual/focus changes; keep screenshot fixtures genuine.                                                                                                                                                                                                                                         |

Security urgency also applies to developer tooling: the full audit matches Nx graph CORS, migration extraction, git-revision command injection and local daemon socket advisories, and Vitest UI/mocker advisories. Cloud-disabled configuration narrows remote-cache exposure but does not address all Nx findings. PF-01 must assess the actual CI/dev attack paths and promote reachable toolchain fixes into PF-02 instead of waiting for ordinary modernization. Do not expose graph/Vitest development servers during triage.

Known deprecated transitive packages: glob 7.2.3 under babel-plugin-istanbul/rollup-plugin-copy, glob 8.1.0 under @rollup/plugin-commonjs, inflight 1.0.6 (upstream warns of memory leakage), stable 0.1.8 (obsolete stable-sort shim). Modernize their owning tools; do not blindly override incompatible glob majors. Other important locked runtime chains include Express → body-parser 1.20.3/qs 6.13.0/path-to-regexp 0.1.12; heic-convert → heic-decode 2.1.0/libheif-js 1.19.8/jpeg-js 0.4.4/pngjs 6.0.0; Sharp → platform libvips package 1.2.3; archiver → glob/minimatch/lodash. Audit runtime reachability separately from CLI-only paths.

## Ordered implementation tasks

Every task is independently reviewable. Dependencies refer to completed tasks; security patch work can proceed before broad modernization. “Required tests” includes existing suites to preserve, not a requirement to create tests that merely mirror implementation. Current statuses are recorded in each task heading.

### PF-01 — Reproducible baseline and security ledger (P0, done)

- **Scope/why:** establish repeatable checks and advisory reachability before changing versions; use discovery results below, resolving only remaining failures rather than repeating inspection.
- **Depends:** none.
- **Completion:** 2026-10-16; see the PF-01 checkpoint and reachability ledger below. Baseline failures remain assigned to their owners; completion does not mean CI or security gates pass.
- **Acceptance:** commands, environment, test totals, failures/warnings and audit paths recorded; each high/critical runtime advisory triaged by deployed API/SSR use; each blocker linked to a task. Preserve current lockfile as comparison evidence.
- **Required tests:** inventory check, lint/typecheck/unit/process tests/build, both browser suites; audit full and production graphs; `npm ls --all`; tracked-file formatting. Distinguish environment failures from code failures.

### PF-01A — Resolve the existing browser validation failure (P1, done)

- **Scope/why:** discovery's CI-equivalent run fails the Chromium progressive-results layout assertion and the integration suite's 300-second execution/teardown deadline. Restore useful regression protection before unrelated UI/tooling changes.
- **Depends:** PF-01 baseline evidence; independent of security patching.
- **Acceptance:** explain whether the 3.140625px versus <2px alignment failure is a product defect, font/layout timing issue or overprecise assertion; fix the actual contract or test determinism without blindly loosening thresholds. Measure parallel-suite contention before changing timeout/worker policy; full integration suite completes in all browsers with no omitted tests.
- **Required tests:** reproduce the exact `upload.spec.ts:403` assertion in isolation and in the aggregate run; verify screenshot/layout after any fix; run all 66 integration cases and CI-equivalent workflow. Record runtime and teardown behavior, not just a focused green rerun.

### PF-02 — Patch exposed dependency vulnerabilities (P0, done)

- **Scope/why:** update matching Router 7 family, Express 4 patches if Express 5 is not ready, compression, limiter, file-type and affected transitives; migrate Sharp to a fixed compatible release with codec checks. Do not postpone fixes behind cosmetic/toolchain work.
- **Depends:** PF-01 advisory triage (done). Can run alongside application fixes.
- **Triage additions:** include Express → proxy-addr, optional telemetry runtime paths hidden by devDependency classification, and reachable Nx local-worker exposure in security patch scope. Do not defer these solely because `--omit=dev` excludes them; see PF-01 ledger. Resolve conditional/unverified paths before claiming the runtime security gate passes.
- **Acceptance:** no unmitigated reachable high/critical runtime finding; advisory ledger includes fixed versions, paths, residual severity and dated rationale. Incompatible Sharp change isolated from unrelated majors; no blind forced overrides.
- **Required tests:** real encoding/download/partial-result/restart E2E; malformed sniffer fixtures in bounded subprocesses; compression disconnects; IPv4-mapped IPv6 limiting; actual SSR route/manifest/ScrollRestoration security checks as applicable. Full build/typecheck and fresh production/full audits.

### PF-03 — Repair error boundary and request parsing (P0, done)

- **Scope/why:** F01/F02; correct global error middleware registration/arity, single parsing policy and legacy async forwarding; normalize safe errors without breaking conversion schema.
- **Depends:** PF-01; does not require Express 5.
- **Acceptance:** malformed/oversized JSON and URL-encoded requests terminate with documented JSON status; unsupported bodies fail safely; storage/async errors never hang or leak stacks; headers-sent failures close safely. Configured limits actually govern the parser.
- **Required tests:** real HTTP malformed JSON, body too large, absent/wrong content type, nested/duplicate form parameters, rejected async handler, pre/post-header stream failure; telemetry enabled/disabled. Preserve all conversion/legacy controller tests.

### PF-04 — Explicit proxy and admission policy (P0 for public/LAN exposure, P1 local; done)

- **Scope/why:** F02/F03; safe default proxy trust, validated opt-in deployment configuration, rate limiting before costly parsing where compatible.
- **Depends:** PF-03.
- **Acceptance:** direct clients cannot change identity through X-Forwarded-For; supported trusted proxy topology preserves real IP; status budget remains separate; 429/Retry-After/CORS semantics documented; invalid config fails startup.
- **Required tests:** direct and one trusted proxy, forged/multiple headers, IPv4/IPv6/mapped forms, session/general/status exhaustion, health/readiness exemption, valid polling under normal two-upload workflow.

### PF-05 — Bound and sanitize downloads (P1, done)

- **Scope/why:** F04/F05; cap ZIP members/duplicates/name length, bound active archive work and slow stream retention, safe ASCII/UTF-8 Content-Disposition. Reuse archive helpers and lease model.
- **Depends:** PF-03.
- **Acceptance:** finite documented member/concurrency/timeout budgets; excess requests rejected before repeated disk reads/compression; valid order/collision/missing-ID behavior remains; Unicode/control characters cannot break response headers; abort releases resources. Select store/low compression only after measurement.
- **Required tests:** repeated IDs, too many/oversized IDs, CR/LF/NUL/emoji/non-Latin names, ZIP traversal-style names, concurrent slow streams, client abort/timeout/expiry, missing source before/after headers, decoded archive order/content.

### PF-06 — Reclaim all expired sessions safely (P1, done)

- **Scope/why:** F06; cleanup empty sessions and expired legacy data, with explicit invalid-record handling. Keep storage ownership local.
- **Depends:** PF-03; coordinate leases with PF-05/PF-08.
- **Acceptance:** abandoned session creation does not cause indefinite growth; active uploads/conversions/downloads retain lease safety; cleanup validates root/IDs and never deletes live/unrelated directories. Corrupt retention policy is bounded or operator-actionable.
- **Required tests:** create-only expiry, legacy expiry, cleanup/create race, active download/conversion deferral, corrupt record, symlink/non-session directory, cleanup failure/readiness, restart and repeated sweep idempotence.

### PF-07 — Image resource and privacy regression matrix (P1; hard isolation PUBLIC decision, done)

- **Scope/why:** F07; measure HEIC/Sharp peak memory and latency, fail HEIC decode explicitly, validate effective limits, add small real fixtures for image contracts. Do not attempt dangerous unbounded bombs in the main test runner.
- **Depends:** PF-02, PF-03.
- **Acceptance:** output format/dimensions/metadata/first-frame/color/alpha behavior documented and verified; supported self-host memory budget measured; conservative defaults justified. A public-host policy either contains hard decode failures or explicitly disallows unsafe input paths; process isolation requires scope decision PF-20.
- **Required tests:** real HEIC and corrupt HEIC, wrong magic/MIME, EXIF orientation/GPS stripping, ICC, transparent JPEG policy, animation, near-limit pixels/dimensions, cancellation/timeouts retaining worker ownership. Bounded subprocess stress records peak RSS and kills only its own fixture process.

### PF-08 — Validate persistence and contain filesystem access (P1, in_progress)

- **Scope/why:** F08; schema-validate active session and conversion records, safe expiry semantics, distinguish ENOENT from corruption/permission/storage failures, verify path containment and filesystem permissions. Retire old sealed-session reads and the now unused legacy sidecar reader under the maintainer decision below.
- **Depends:** PF-03.
- **Acceptance:** malformed records fail closed; file metadata cannot resolve outside its session; consistent private directory/file policy; storage errors are observable and use appropriate status/readiness; preserve receipt/fingerprint durability and current operation downloads. Remove old sealed-session reads without deleting stored files.
- **Required tests:** invalid dates/token hashes/IDs/stored names, traversal and symlinks at current operation download entrypoints, EACCES/ENOSPC/short-write/rename failure, startup corruption isolation, partial-commit recovery, separate sessions cannot read each other's outputs, and old sealed-session requests no longer resolving. Do not claim OS privilege escalation defense against a fully compromised operator.

### PF-09 — Protect SSR and private responses (P1, pending)

- **Scope/why:** F09; production-safe root error UI, document/implement frontend security headers at serving boundary, private authenticated response caching, and remove browser requests to Google Fonts.
- **Depends:** PF-02, PF-03.
- **Acceptance:** no private stacks/paths/tokens in browser-visible errors; HTML has tested compatible CSP/frame/referrer policy; private responses cannot be reused by shared caches after expiry; auth precedes conditional/range requests. Preserve Router hydration and blob previews.
- **Required tests:** built production SSR errors/404, CSP browser console/hydration, image blobs/downloads, conditional GET/HEAD/range/expired bearer, cross-origin allowed/disallowed preflight. Verify the built page makes no external font request and retains readable fallback typography; manual privacy wording review.

### PF-10 — Make optional observability correct and testable (P1, pending)

- **Scope/why:** F10; fix environment precedence/boolean parsing, bounded request IDs, token-safe logs, await telemetry shutdown within grace period. Replace trivial smoke with behavioral tests.
- **Depends:** PF-03; coordinate SDK versions with PF-14.
- **Acceptance:** config values are honored; disabling telemetry creates no exporter/network requirement; errors are useful but redact bearer/session sensitive material; shutdown flush is bounded and does not delay process recovery guarantees.
- **Required tests:** config matrix, fake logger/exporter capture for authorization/cookies/errors, request ID limits, repeated initialization/shutdown, exporter unavailable, SIGTERM with telemetry on/off. No live SaaS endpoint needed.

### PF-11 — Align supported Node/npm runtime (P1, pending)

- **Scope/why:** upgrade patched LTS, evaluate Node 24, match types/engines/CI/devcontainer; capture npm version policy and native-platform support.
- **Depends:** PF-02, PF-07.
- **Acceptance:** selected runtime works across development and deployment; engine/types do not advertise unsupported APIs; reproducible npm install and native codec support; release documents supported platform(s).
- **Required tests:** clean locked install, all build/typecheck/unit/process/browser targets, HEIC/Sharp native smoke, startup/shutdown on selected LTS; compare Node 22/24 during transition if retaining both.

### PF-12 — Migrate Nx in supported steps (P1, pending)

- **Scope/why:** review 21→22→23 migration output with all @nx packages aligned; remove cloud-only leftovers while preserving local caching and inferred graph.
- **Depends:** PF-01, PF-11.
- **Acceptance:** documented chosen supported Nx line; reviewed migrations committed/removed according to existing workflow; target names/dependencies/output paths preserved; no Nx Cloud connection or repair step; API/browser tests remain uncached.
- **Required tests:** graph/target inspection, clean and warm-cache CI-equivalent run, typegen/prune/copy-workspace tests, no-network/cloud mode; compare generated deploy manifests.

### PF-13 — Modernize compatible frontend/test/lint tools (P1, pending)

- **Scope/why:** staged Router 8 evaluation, Vite/Vitest/jsdom/plugin, React/types, TypeScript/ESLint/Babel/Webpack and CSS/browser upgrades within verified peer support. Split by coherent family; no simultaneous unsupported major jump.
- **Depends:** PF-12, PF-09.
- **Acceptance:** every direct package is updated, retained with justified compatibility ceiling, or removed with evidence; plain `npm ci` works if peer issues are resolved, otherwise exact blockers and expiry of exception documented. Matching Playwright binaries installed. No suppressed type/lint/test errors to force migration through.
- **Required tests:** each family's focused tests plus final full suites, SSR/typegen, coverage config, UI focus/reduced motion, all three browsers, npm peer-tree inspection; no dependency changes solely to silence unrelated warnings.

### PF-14 — Express 5 and deployable dependency closure (P1, pending)

- **Scope/why:** migrate API and observability Express/types to 5; inspect HPP/parser need rather than patching incompatible middleware blindly. Correct runtime/dev ownership and upgrade coherent OTel/pino families. Verify archiver/file-type majors separately where required.
- **Depends:** PF-03–05, PF-10–12.
- **Acceptance:** Express 5 rejection/body/query/route semantics documented; no duplicate error sends; generated API and SSR artifacts start from production-only deps without source workspace/dev hoisting; patched closure retains no unexplained peer errors.
- **Required tests:** routing/mergeParams/encoded identifiers, absent bodies/repeated queries, errors/listen failures, telemetry, uploads/downloads/expiry, clean `prune` artifact install/start, readiness and real conversion/restart, production SSR render. Run full API suites.

### PF-15 — Reliability and resource soak (P1, pending)

- **Scope/why:** existing runtime has strong crash tests but no measured steady-state bounds; assess retained sessions, fingerprints/directory scans, buffers, listeners, blobs and timers without rewriting storage.
- **Depends:** PF-05–08, PF-14.
- **Acceptance:** repeatable bounded soak records RSS/CPU/disk/FD/event-loop behavior over session expiry cycles; no monotonic retained-resource growth; readiness drops on storage faults; shutdown and recovery remain within documented cooperative model. Optimize only measured hotspots.
- **Required tests:** cycles of upload/download/abort/cancel/expiry, queued FIFO under contention, disk-full/read-only fixtures, SIGTERM/SIGKILL and restart; client unmount/reselection revokes URLs and aborts timers/requests. Keep hard native-timeout limitation explicit.

### PF-16 — Close browser/accessibility regression gaps (P1, pending)

- **Scope/why:** implement missing evidence listed in `docs/testing/conversion-workflow-ui.md`, emphasizing native modal focus and real download feedback over visual cosmetics.
- **Depends:** PF-01A, PF-13.
- **Acceptance:** keyboard-only complete workflow, narrow viewport/long-list results, reduced motion and focus restoration work across all supported engines; known AT limitations recorded; inventory maps new assertions accurately.
- **Required tests:** automatic-collapse focus, Tab/Shift-Tab, hidden/inert/disabled controls, tooltip lifecycle, Back/Forward and unresolved creation departure, held/failed image and ZIP download, motion preferences; manual screen-reader and touch/mobile viewport pass.

### PF-17 — CI/security monitoring and hygiene (P1, pending)

- **Scope/why:** add repository-native scheduled dependency/security checks and grouped dependency updates; remove inactive cloud integration; stabilize formatting gate and evidence retention.
- **PF-02 finding:** parallel API lint/test can race when ESLint traverses temporary fixture directories removed by tests (ENOENT during directory enumeration). Ignore generated test directories in a bounded hygiene fix; a separate lint rerun passed. Do not suppress real source failures.
- **Depends:** PF-02, PF-12–14; formatting baseline tracked separately.
- **Acceptance:** existing tests remain mandatory with no skipped browser substitution; automated update configuration covers npm/actions/container base; security job has explicit failure/exception policy; CI uses least privilege and reviewed immutable action pins where maintainable; no third-party SaaS required. Remove agent-generated files from tracked changes. Set CI time budget from observed duration.
- **Required tests:** workflow/config validation, clean CI-equivalent run, intentional audit failure-policy test, expiry of exceptions, artifact privacy review, inventory checker; preserve token-free diagnostics. Document maintainer-only branch-protection/private-reporting settings as manual actions, do not alter remote settings without approval.

### PF-18 — Remove proven obsolete code and documentation overlap (P2, pending)

- **Scope/why:** assess legacy FileUpload/FileDownload/useFileDownloads/cosmetic progress/contracts, unused @nx/jest/@nx/plugin, duplicate Tailwind integrations and build scaffolding. Some shared file-selection hooks are active; do not delete whole directories by name. Canonicalize duplicate ADR IDs/recovery pages and replace template library READMEs.
- **Depends:** PF-14, PF-16.
- **Acceptance:** import/export/target evidence accompanies removals; retired upload endpoint remains 404; old sealed-session download contracts are retired by the 2026-10-17 maintainer decision, while current conversion downloads remain intact; one canonical ADR per ID with preserved history/links. Formatting-only remediation is a separate bounded change from behavior fixes.
- **Required tests:** references/export/build graph, full typecheck/build, impacted component/API tests, documentation link/inventory checker; review final diff. The maintainer's explicit retirement decision covers removal of the old read compatibility; any broader deletion still needs separate scope review.

### PF-19 — Reproducible self-host guide and genuine screenshots (P1, pending)

- **Scope/why:** restructure README around install/use/limitations with deeper links; document production API+SSR startup and same-origin proxy, all env settings/storage/permissions/health/shutdown; provide real screenshots from the running app.
- **Depends:** PF-14–16, PF-18.
- **Acceptance:** fresh user can install/start/convert/download/restart from instructions without the private agent base image; explain TLS/proxy assumptions, no multi-replica shared volume, no browser resume, session retention and memory limits. Screenshots show real selection, progress and partial/completed results at desktop/mobile sizes with synthetic nonprivate images, alt text, capture command/version and no tokens. SECURITY.md accurately states that public GitHub issues are for non-sensitive reports only and that no private reporting channel is configured.
- **Required tests:** follow the native process and reverse-proxy instructions from clean checkout/production artifacts; check links/env defaults/commands; execute screenshot capture against actual built app/API (no mocks presented as real app, no generated illustrations). Production Docker/Compose is outside this release scope.

### PF-20 — Public-host readiness decision and gate (PUBLIC, deferred)

- **Scope/why:** public uploaders change the threat model; choose permitted audience, TLS/ingress topology, abuse/resource budget, decode isolation or format restriction, and retention policy before exposure.
- **Depends:** PF-02–10, PF-15, PF-19; maintainer decision required.
- **Acceptance:** documented chosen public model and tested mitigations for anonymous session floods, proxy bypass, ZIP/download concurrency and native/HEIC exhaustion. API is not accidentally directly reachable behind a trusted proxy. Deployment enforces resource/storage bounds and restart policy. No default requirement for user accounts/distributed services.
- **Required tests:** staging over real HTTPS/proxy, forbidden direct API access, client-IP spoofing and limits, low-cost bounded abuse tests, hostile images in constrained process/container, data expiry and log/privacy review. If not deploying publicly, mark **deferred**, retaining this gate explicitly.
- **Deferral decision (2026-10-17):** this release is for private self-host use only. Anonymous public uploads are outside its supported audience. Reopen this gate before any public deployment; hard decoder isolation or input restriction belongs to that review.

### PF-21 — Final release candidate verification (P1, pending)

- **Scope/why:** verify the final state rather than accumulating historical green fragments.
- **Depends:** all self-host tasks above completed or narrowly justified deferrals; PF-20 if public.
- **Acceptance:** exit criteria below met at one recorded candidate commit; release notes/version/support matrix and rollback/storage procedure documented. Record exact artifact/config/runtime versions. Remote release/tag publishing remains a separate authorized action.
- **Required tests:** clean lockfile install, inventory, lint/typecheck/unit/process/build/all-browser suites, production-only startup and conversion, restart/recovery/expiry, audits and bounded soak; manual screenshot/setup/accessibility checks. Review full diff for accidental data/secrets/dependency drift.

## Exit criteria

1. All P0 and self-host P1 tasks done; any narrower deferral names its risk, owner, reason and review date. Public-only work may remain deferred, with no claim of public readiness.
2. One clean candidate passes inventory, lint, typecheck, unit/component/API-process suites, production build and both browser targets in Chromium/Firefox/WebKit with zero unexpected failures/skips; record totals/exit codes and browser revisions. Environmental failures are unresolved, not passes.
3. No unmitigated reachable high/critical runtime vulnerability; remaining advisory findings have concrete nonreachability/mitigation evidence and expiry. Full toolchain audit and deprecated-package inventory reviewed, not hidden by production-only filtering.
4. Error, proxy, ZIP, retention, metadata/privacy and decoder regressions above have assertions at the boundary where failure occurs; inventory updated. Coverage report measured and exclusions reviewed; establish justified critical-module no-regression thresholds after measuring, not a fabricated global percentage.
5. Clean production-only artifacts run without development dependency hoisting. A fresh operator follows documented setup, converts every supported output format, downloads, restarts and observes expiry. Single-owner filesystem constraint and native-code limitations remain explicit.
6. Soak has a recorded machine/budget/input set and no unexplained monotonic RAM/FD/disk growth after expiry. Resource budgets fit the documented deployment. Faults fail safely without losing sibling commits or exposing private data.
7. README/screenshots/architecture/security/reporting/setup documents match the candidate; all planned manual checks have outcomes or explicit limits. Only intended files appear in final diff; no remote writes or new infrastructure implied by completion.

## Decisions and manual verification

### Decision register (2026-10-17)

| Decision                              | Current direction                                                                                                                   | Status and consequence                                                                                                                                                                         |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Release audience and public-host gate | Private self-host only for this release.                                                                                            | Decided by maintainer on 2026-10-17. PF-20 is deferred and must be reopened before anonymous public uploads.                                                                                   |
| Sealed-session compatibility          | Reads for sessions created by the old synchronous upload flow are retired.                                                          | Decided by maintainer on 2026-10-17 and implemented in the PF-08 checkpoint below. Current operation downloads remain at the shared URLs. Stored old files are left for normal expiry cleanup. |
| Production packaging                  | Document native API and SSR processes behind a reverse proxy.                                                                       | Decided by maintainer on 2026-10-17. Production Docker/Compose is outside this release scope; the devcontainer is not a deployment artifact.                                                   |
| Browser font privacy                  | Remove the browser's Google Fonts requests and use a local/system font stack.                                                       | Decided by maintainer on 2026-10-17. PF-09 verifies production SSR makes no external font request and the UI remains readable.                                                                 |
| Security reporting                    | Public GitHub issues may be used only for non-sensitive reports; no private channel is configured.                                  | Decided by maintainer on 2026-10-17. SECURITY.md must not suggest that a private issue or contact route exists. Revisit before inviting outside vulnerability research or public hosting.      |
| Runtime and native-platform matrix    | Keep the current tested Node 22/Linux aarch64 baseline as evidence, not a final support claim.                                      | PF-11 selects patched LTS and supported OS/CPU pairs after clean install, codec, fsync, build, and browser checks. Versions and platforms are implementation evidence decisions.               |
| Hard decoder containment              | The 20 MP and measured RAM limits support the private self-host profile; native decode is not process-isolated.                     | No implementation decision is needed for this private release. PF-20 must select and test process isolation or a narrower enforced input policy before anonymous public exposure.              |
| Target-host verification              | Proxy/TLS/cache rules, RAM/disk, filesystem durability, metadata/HEIC behavior, and assistive technology depend on the actual host. | PF-19/PF-21 record operator measurements and manual results. Missing target-host evidence remains an explicit release limit, not an assumed pass.                                              |

The maintainer choices above set the target behavior; they do not mark PF-08, PF-09, PF-18, or PF-19 complete. Legacy-read retirement is implemented below. Native deployment and font changes still require their implementation and verification tasks.

- Confirm a supported Node LTS/platform matrix after compatibility tests; evaluate Node 24 and do not promise untested OS/CPU variants, native codecs, or directory fsync behavior.
- Measure actual proxy/TLS/cache rules, available RAM/disk, filesystem durability, native metadata/HEIC behavior, and assistive technology behavior on the target host.
- Audit advisory matches require reachability review: Router SSR is present, but filesystem session storage, RSC and server actions are not assumed used; glob CLI shell execution and lodash template APIs are not automatically exposed by archive creation. Local tampering of persisted paths is a different prerequisite from unauthenticated HTTP access.

## Discovery validation and pre-existing failures

Commands ran against the unchanged application baseline on Node **22.22.0**, npm **10.9.4**, with the image-provided Playwright browsers. No browser/system dependency installation was needed. Root and lockfile remained unchanged. Local raw discovery logs are under ignored `tmp/finalization-discovery/`; browser artifacts are under `apps/web-e2e/test-output/`. The durable results below must not depend on those ignored artifacts surviving another session.

| Check                                                                             | Result and interpretation                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial lint/typecheck/test/build attempts                                        | `nx: not found` (127), because `node_modules` was absent. Environment preparation issue, resolved by baseline install; not an application regression.                                                                                                                                                                                                                                        |
| `npm ci --legacy-peer-deps --cache ./.npm-discovery-cache --no-audit --no-fund`   | Passed, 2,060 packages installed. Temporary cache/log moved under ignored discovery directory afterward. No upgrade; lockfile unchanged. Deprecated glob/inflight/stable warnings retained.                                                                                                                                                                                                  |
| `npm run check:use-cases`                                                         | Passed: 67 mapped cases, 67 covered, zero partial/missing.                                                                                                                                                                                                                                                                                                                                   |
| `NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false NX_NO_CLOUD=true npm run ci:hook` | **Exit 1**. Nx reports only `@image-web-convert/web-e2e:browser-integration` failed; lint/typecheck/build and other test targets completed. Do not describe the aggregate run as green.                                                                                                                                                                                                      |
| Vitest suites in aggregate run                                                    | **427 tests passed / 42 files**: schemas 25, node-shared 9, observability 1, UI 55, API 203, web 109, API-process E2E 25. Observability's one trivial assertion is not meaningful coverage.                                                                                                                                                                                                  |
| Real browser/API E2E                                                              | **27 passed**, all Chromium/Firefox/WebKit scenarios, 3.9 minutes.                                                                                                                                                                                                                                                                                                                           |
| Mocked browser integration                                                        | **43 passed, 1 failed, 22 did not run** (66 planned); two suite-level errors: 300-second execution and teardown timeouts. Chromium `src/integration/upload.spec.ts:119` fails line 403: absolute ZIP/restart button y-offset **3.140625**, expected **<2**. WebKit integration remains unverified in this run; do not infer success from real E2E WebKit. Owned by PF-01A; no fix attempted. |
| Tracked-file formatting                                                           | `git ls-files -z` piped to locked Prettier `--check --ignore-unknown`: **49 existing files need formatting**. A preliminary broad `npm run format:check` also traversed the discovery cache and hit errors when that cache moved; disregard that contaminated result, use the tracked-file rerun. Plan itself passes locked Prettier.                                                        |
| `npm ls --all --json`                                                             | Reports extraneous `@napi-rs/wasm-runtime@1.0.4` and `@tybys/wasm-util@0.10.1`; no invalid peer problem reported in this installed tree. Do not claim `--legacy-peer-deps` proves a currently unresolved peer incompatibility; PF-13 should test plain clean installation before removing the flag.                                                                                          |
| Full / production lockfile audits                                                 | Both exit 1: **187 full** affected entries (15 critical, 104 high, 66 moderate, 2 low); **20 production-filtered** (4 critical, 11 high, 5 moderate). All report a fix available; some require breaking/range changes. Full ledger below.                                                                                                                                                    |
| Final scope/whitespace review                                                     | Only this plan is a new tracked candidate; application/manifests/lockfile unchanged. `git diff --check` passes; plan separately checked by Prettier.                                                                                                                                                                                                                                         |

Pre-existing warnings, separate from failures: web `root.tsx` explicit-any lint warning; Vite sourcemap/use-client diagnostics, stale baseline-browser-mapping notice, Nx process MaxListenersExceededWarning for signal listeners, and NO_COLOR/FORCE_COLOR notices. Capture provenance and determine whether lifecycle/listener warnings recur outside the aggregate runner before changing production code. Intentional fault-injection test logs are not extra failures. Historical docs' earlier results are not substituted for this run.

Historical continuation checkpoint after PF-01: PF-02 was in progress. Its completed status and remaining risks are recorded in the PF-02 closeout below. PF-01A remains ready at P1 and must pass before UI/toolchain finalization. No need to reinstall/retest the unchanged baseline unless environment or application commit differs.

## PF-01 completion checkpoint (2026-10-16)

Selected PF-01 because it has no dependencies and gates both P0 implementation tasks. Reviewed the supplied repository instructions; no additional tracked or unignored `AGENTS.md` was found. Starting commit: `a7dc90d`; `git diff ec20ff4 HEAD --stat` contains only the original plan, so discovery's application, lockfile and validation evidence remain applicable. No new commit was requested or created. Lockfile SHA-256: `2227a685a0ac1df237fb3d856584dc0bfdfa765cba5ae3bf6b2dddf3d2f978ca`.

The baseline commands/results in “Discovery validation and pre-existing failures” are retained as prior execution evidence, not represented as new passing runs. In particular, inspected `validation.log` confirms 427 Vitest tests and 27 real browser tests passed, while integration had 43 passed, 1 failed and 22 not run. PF-01A owns the alignment assertion and execution/teardown deadline; no threshold or timeout was changed here. PF-17/PF-18 own the 49-file formatting baseline; PF-10 owns trivial observability coverage; PF-13 owns peer/install verification and the two extraneous packages. No behavioral tests were added for this documentation-only task; the existing inventory checker and documentation/ledger consistency checks are the applicable validation.

Fresh verification on Node 22.22.0 / npm 10.9.4:

| Command/check                                                                    | Result                                                                                                                                                                                     |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run check:use-cases`                                                        | Exit 0; 67 covered, zero partial/missing. No behavior/inventory mapping changed.                                                                                                           |
| `npm audit --package-lock-only --ignore-scripts --omit=dev --json`               | Findings remain: 20 entries (4 critical, 11 high, 5 moderate), identical to discovery.                                                                                                     |
| `npm audit --package-lock-only --ignore-scripts --json`                          | Findings remain: 187 entries (15 critical, 104 high, 66 moderate, 2 low), identical to discovery.                                                                                          |
| `npm ls --all --json`                                                            | Exit 0; still reports the same two extraneous packages, no invalid peer entries.                                                                                                           |
| `git ls-files -z` piped to `node_modules/.bin/prettier --check --ignore-unknown` | Fails with the same 49 pre-existing formatting files; no remediation in this task.                                                                                                         |
| Locked Prettier check of this plan; `git diff --check`                           | Pass.                                                                                                                                                                                      |
| Ledger consistency check against refreshed production JSON                       | All 40 distinct direct advisory IDs on the 15 high/critical package entries appear in the reachability table; propagation-only entries also covered.                                       |
| Final diff review                                                                | Only this plan changed; application files, manifests and lockfile unchanged. No new runtime regression possible from this documentation change; existing CI/security failures remain open. |

Raw refreshed audit/tree/format results are in ignored `tmp/finalization-pf01/`; durable conclusions are recorded here. Audit findings are expected failing security results, not successful security clearance. Full application suites were not repeated because no application/config/dependency changed since the recorded baseline. No newly discovered issue is left unassigned: optional telemetry closure and Nx worker security were added to PF-02, with later architectural work retained in PF-10/PF-12/PF-14.

### Runtime advisory reachability ledger

This is source-based triage, not exploit reproduction or a release waiver. The dated audit table below retains versions, severity, affected paths and advisory IDs; the following table covers every high/critical production-filtered package and its direct advisory IDs. Propagated findings are explicitly linked to their child packages. “No identified path” means the necessary feature/input is absent in the inspected source, not that the dependency is patched. All assessments must be reviewed during PF-02 and expire at PF-21 or whenever relevant routes/configuration change, whichever comes first. Owner: the implementer of the named task.

Evidence: `apps/api/src/app.ts`, `apps/api/src/routes/`, `apps/api/src/services/{image,files}.service.ts`, `apps/web/{react-router.config.ts,app/routes.tsx,app/root.tsx,app/entry.server.tsx}`, installed limiter/archiver call sites, and the unchanged lockfile. API request bodies and uploads are untrusted; session capability issuance is anonymous. SSR is enabled with two static routes and no application loaders/actions, RSC, file-session storage or prerender configuration.

| Package / dependency path | Advisory IDs                                                                                                                                      | Assessment and task                                                                                                                                                                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@react-router/express`   | Propagation only; via @react-router/node, react-router                                                                                            | SSR serve adapter; propagated node/Router findings below. PF-02.                                                                                                                                                                                                                                          |
| `@react-router/node`      | GHSA-9583-h5hc-x8cw; via react-router                                                                                                             | File-session storage is not used: no identified application traversal path. Router propagation remains applicable to SSR. PF-02.                                                                                                                                                                          |
| `@react-router/serve`     | Propagation only; via @react-router/express, @react-router/node, react-router                                                                     | Production SSR launcher; propagated express/node/Router findings below. PF-02.                                                                                                                                                                                                                            |
| `brace-expansion`         | GHSA-f886-m6hf-6m8v, GHSA-3jxr-9vmj-r5cp, GHSA-mh99-v99m-4gvg, GHSA-rgw5-rvv9-x895, GHSA-q2hr-2g5m-vwhr, GHSA-qhr7-859c-m2p7, GHSA-6j4f-fj2g-mc7p | archiver → readdir-glob/minimatch and glob paths. All listed expansion attacks need attacker-controlled patterns; downloads use explicit archive.file paths, not archive.glob/directory. No identified request-to-pattern path. PF-02 transitive refresh; PF-14 closure verification.                     |
| `compression`             | GHSA-vc2v-76pw-4v95                                                                                                                               | Mounted globally in app.ts; response compression and premature disconnects are exposed. Treat as reachable; PF-02 patch and disconnect regression.                                                                                                                                                        |
| `express`                 | Propagation only; via body-parser, path-to-regexp, qs                                                                                             | HTTP listener; propagated body-parser/qs parse untrusted bodies, while path-to-regexp is assessed below. PF-02 patches; PF-03 parsing/error contract.                                                                                                                                                     |
| `express-rate-limit`      | GHSA-46wh-pxpv-q5gq; via ip-address                                                                                                               | Default key generator used on general/session/status routes; dual-stack mapped-address bypass is relevant. ip-address findings separately below. PF-02 patch, PF-04 topology tests.                                                                                                                       |
| `glob`                    | GHSA-5j98-mcp5-4vw2                                                                                                                               | archiver-utils dependency; CLI --cmd is not invoked by application downloads. No identified CLI injection path; preserve this distinction from pattern denial of service. PF-02/PF-14.                                                                                                                    |
| `ip-address`              | GHSA-v2v4-37r5-5v8g, GHSA-mwp4-54f8-5fhr, GHSA-rpw4-54j3-4h4q, GHSA-j6r3-76f7-8jcv, GHSA-h3mg-xc3c-68pw                                           | Limiter invokes Address6 for request identity. HTML-emitting methods, URL resolution, link-local policy and cross-family allowlists are not used here. Oversized diagnostic input remains conditional on Express address validation/forwarded identity; do not waive it before PF-02/PF-04 bounded tests. |
| `lodash`                  | GHSA-r5fr-rjxr-66jc, GHSA-f23m-r3pf-42rh, GHSA-xxjr-mmjv-4gpg                                                                                     | archiver/archiver-utils use defaults, flatten, difference, union and isPlainObject; no request-controlled template, unset or omit call identified. All listed advisories require other methods/inputs; no demonstrated application path. PF-02 transitive refresh/PF-14 closure.                          |
| `minimatch`               | GHSA-3ppc-4f35-3m26, GHSA-7r86-cg39-jmmj, GHSA-23c5-xmqv-rm74                                                                                     | archiver → readdir-glob and archiver-utils → glob. All listed attacks need malicious patterns; explicit archive.file calls do not interpret supplied filenames as globs. No identified request-to-pattern path. PF-02/PF-14.                                                                              |
| `path-to-regexp`          | GHSA-37ch-88jc-xwx2                                                                                                                               | Express compiles static application routes; named parameters are slash-separated, not multiple parameters within an ambiguous segment. No identified vulnerable route shape. PF-02 patch; preserve route tests.                                                                                           |
| `proxy-addr`              | GHSA-jqcg-44mw-7w3h                                                                                                                               | Express request IP path is active, but trust proxy is numeric 1, not an IPv4-mapped subnet. Advisory-specific bad subnet prerequisite absent; independent direct-client spoofing remains F03. PF-02 patch before PF-04 introduces configurable trust.                                                     |
| `sharp`                   | GHSA-f88m-g3jw-g9cj, GHSA-rgj7-g3m4-5g8c, GHSA-wq5f-xc86-pv6w                                                                                     | Untrusted uploaded bytes reach native decoding; libvips findings treated as reachable. libheif/librsvg reachability depends on packaged codec support and MIME/sniffer behavior; not waived based on output formats or HEIC preprocessing. PF-02 fixed native release; PF-07 codec/resource matrix.       |

Router findings are split by prerequisite rather than treating SSR presence as proof of every exploit:

| Advisory IDs                                                                       | Application assessment / PF-02 disposition                                                                                                                                                           |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GHSA-49rj-9fvp-4h2h                                                                | Framework SSR is present. Upstream requires an existing prototype-pollution primitive; none demonstrated here. Conditional risk, still patch; absence of actions alone is not an exemption.          |
| GHSA-337j-9hxr-rhxg                                                                | SSR hydration/error deserialization present; attacker control of the necessary payload not proven. Treat as potentially exposed until patched and production SSR tested.                             |
| GHSA-8x6r-g9mw-2r78, GHSA-rxv8-25v2-qmq8, GHSA-chx6-hx7r-mcp5                      | Framework manifest/single-fetch/route matching handles network requests even without application loaders. Treat as potentially exposed; test built SSR with bounded hostile paths.                   |
| GHSA-8v8x-cx79-35w7                                                                | Root renders ScrollRestoration with no getKey/storageKey props; untrusted custom keys required by advisory are absent. Patch family and retain hydration tests.                                      |
| GHSA-8646-j5j9-6r62, GHSA-h5cw-625j-3rxh                                           | No RSC or application action/server action. No identified vulnerable RSC redirect or state-changing Router action path. API bearer requests are a separate boundary.                                 |
| GHSA-2w69-qvjg-hvjx, GHSA-9jcx-v3wj-wh4m, GHSA-wrjc-x8rr-h8h6, GHSA-2j2x-hqr9-3h42 | Application navigation targets are internal constants; no user-provided redirect target found. Framework request normalization still needs PF-02 built-server checks; no blanket redirect exemption. |
| GHSA-f22v-gfqf-p8f3                                                                | No prerender configuration or prerendered redirect pages. No identified stored redirect-HTML path.                                                                                                   |

Prerequisite references checked directly: [Router deserialization](https://github.com/advisories/GHSA-49rj-9fvp-4h2h), [ScrollRestoration custom keys](https://github.com/advisories/GHSA-8v8x-cx79-35w7), [proxy-addr subnet matching](https://github.com/advisories/GHSA-jqcg-44mw-7w3h). Other classifications use audit descriptions and inspected call sites; unverified conditions remain patch/test obligations rather than security exceptions. Moderate file-type malformed-input findings remain urgent in PF-02 because sniffing precedes MIME rejection.

### Runtime classification and developer-tool blockers

- **New finding, PF-02/PF-10/PF-14:** production-filtered audit is not the deployed runtime inventory. `libs/observability/src/lib/instrumentation.ts` imports SDK, auto-instrumentations and OTLP HTTP exporter from packages classified as dev dependencies. HTTP propagation with telemetry enabled makes the OTel baggage memory finding relevant; SDK/Jaeger/protobuf findings require exporter/propagator and generated artifact checks. No user-controlled protobuf schema or explicit Prometheus listener is configured, but default auto-instrumentations are broader than just Express. Treat optional telemetry closure as unresolved runtime exposure and patch applicable paths in PF-02, not only the later Express 5 migration. PF-14 must audit the actual pruned artifact. Disabling telemetry is not assumed to remove bundled dependencies.
- **Nx, PF-02/PF-12:** CI executes run-many, not affected/revision commands or migrate, and no self-hosted remote cache is configured; no current CI input path identified for revision injection, migration extraction or remote-cache Zip-Slip. Graph CORS needs a listening graph server, absent from CI. Local worker/socket exposure remains relevant to routine Nx execution on a shared host; `NX_DAEMON=false` alone does not prove plugin workers safe. Promote a compatible security fix or tested isolation into PF-02 before broad modernization; do not infer safety from cloud-disabled settings. Keep graph/UI servers private while vulnerable.
- **Vitest, PF-02/PF-13:** recorded CI runs use Vitest run mode, no UI/browser-mocker server configured. UI file access and redirect-mock paths have no identified CI listener, but interactive development can expose them. Patch compatible versions in PF-02 where possible; reassess before enabling UI/browser mode. Full toolchain findings are not dismissed by production filtering.
- **Other build/install dependencies, PF-02/PF-12–14:** archive extraction, dev-server, template/code-generation and Git-input findings need their respective feature/input. CI builds checked-out code, so an untrusted checkout is already a code-execution boundary; this is not a waiver for vulnerable installer/native/tooling chains. Preserve the full advisory inventory and use trusted package inputs; require dated residual decisions during each upgrade family.

## PF-02 implementation checkpoint (2026-10-17)

One logical task: exposed dependency remediation. The prior PF-01 plan edit was already present and is preserved. No commit or remote write was requested or performed. npm and lockfile v3 remain in use; Node 22.22.0/npm 10.9.4 remain unchanged. No Express 5, Router 8, Nx major, React, Vite, or Vitest migration was included. Do not treat the historical discovery inventory below as the current lockfile.

### Changes and advisory disposition

| Family/path                                              | Locked result                                                                                          | Disposition                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Router node/serve/express/dev + react-router             | 7.18.4 throughout                                                                                      | Fixes the listed Router advisory ranges without disabling SSR; built route, hydration, manifest and URL checks added.                                                                                                                                                                                                                                                                                                    |
| Express → body-parser / qs / path-to-regexp / proxy-addr | 4.22.3 → 1.20.8 / 6.16.1 / 0.1.13 / 2.0.8                                                              | No remaining audit entry for these packages. Preserves Express 4 middleware semantics; F01/F02/F03 application defects still belong to PF-03/PF-04.                                                                                                                                                                                                                                                                      |
| compression / express-rate-limit → ip-address            | 1.8.2 / 8.7.1 → 10.7.4                                                                                 | Disconnect regression asserts the real gzip stream is destroyed; real HTTP requests share a default-key budget across IPv4 and dotted/hex mapped IPv6.                                                                                                                                                                                                                                                                   |
| file-type                                                | 21.3.4                                                                                                 | Application sniffer patched within major 21. Zero-size ASF sub-object and misleading ZIP expanded length exercised in a child with 128 MiB JS heap, 5-second kill deadline, 64 KiB output cap and a 2 MiB expanded fixture. These are bounded regressions, not a general process RSS limit.                                                                                                                              |
| Sharp and platform codecs                                | 0.35.5, libvips 8.18.7, libheif 1.23.5, librsvg 2.63.2                                                 | Required minor-range change isolated from unrelated majors; real HEIC/PNG input smoke and decoded JPEG/PNG/WebP/AVIF output/lifecycle tests retained. Verified Linux arm64 only; no claim about other platforms or hard native interruption.                                                                                                                                                                             |
| Optional OTel SDK/exporter/instrumentations              | SDK/exporter 0.223.0; core/resources/trace-base 2.12.0; auto-instrumentations 0.81.2; protobufjs 7.6.6 | No OTel/protobuf audit entries remain in the refreshed full graph. Real local collector receives a span and shutdown completes; disabled initialization remains optional. SDK 0.223 defaults to metrics export whereas 0.203 did not: explicitly retain opt-in metrics when OTEL_METRICS_EXPORTER is absent/empty. Runtime/dev ownership and full config/redaction coverage remain PF-10/PF-14.                          |
| Archive/pattern transitives and SSR access logging       | Compatible lockfile updates; Morgan 1.12.1                                                             | Refresh affected existing dependency paths without force, blanket overrides or new direct production dependencies. No archive API change.                                                                                                                                                                                                                                                                                |
| Nx 21.6.2 local socket exposure                          | Temporary containment, not a version fix                                                               | npm/CI use tools/nx.mjs: daemon disabled, isolated workers retained, sockets confined to a fresh mode-0700 repository temporary directory, removed on normal exit. Test verifies inherited settings cannot bypass containment. Launcher included in Nx shared inputs so changes invalidate cached artifacts. README direct commands use it; raw npx nx bypasses it. PF-12 still owns upgrading/removing this workaround. |

The Nx containment follows the [upstream advisory workaround](https://github.com/advisories/GHSA-w3vv-58gj-gw77); there is no fixed Nx 21 version. An initial in-process-plugin workaround polluted build environment state and produced development JSX in a production UI artifact. It was replaced with private socket storage and the launcher was added to cache inputs; rebuilt artifacts restored SSR. Failed and interrupted browser runs from that intermediate state are not counted as passes.

### Fresh audits and residual risk

Both `npm audit --package-lock-only --ignore-scripts --json` and its `--omit=dev` counterpart were refreshed against the changed lockfile; both exit 1 for remaining findings. Production: **1 high, 0 critical, 0 moderate** (down from 20 total). Full: **131 entries: 9 critical, 89 high, 31 moderate, 2 low** (down from 187). Counts are affected package entries, not unique vulnerabilities or proven exploits.

- **Lodash 4.17.23, production high:** GHSA-r5fr-rjxr-66jc and GHSA-f23m-r3pf-42rh remain. Runtime paths are hpp → lodash/defaults,isString,isArray and archiver-utils → defaults,flatten,difference,union,isPlainObject. No request-driven template/unset/omit use was found; these advisory-specific methods are not used by those paths. This is a source-based nonreachability decision, not a claim that Lodash is fixed. npm retains a shared 4.17 line alongside api-extractor's ~4.17.15 constraint; 4.18.1 exists, but no incompatible global override was forced. Owner PF-13/PF-14: resolve separate tool/runtime closure or remove HPP when reviewing parser need. Reassess by 2026-11-17, at PF-21, or on any new Lodash call site, whichever comes first.
- **Nx high:** private sockets mitigate the demonstrated local-account path only for the documented launcher. Graph, migrate, revision-input and remote-cache prerequisites remain as assessed by PF-01; do not expose graph services or consume untrusted migration inputs before PF-12. Owner PF-12, review by 2026-11-17 or any tooling/workflow change.
- **Other full-graph findings:** Vite/Vitest UI/mocker and build/install chains remain upgrade work in PF-12/PF-13/PF-14. No UI/mocker/graph listener was started for validation. Full audit is deliberately still failing; this task does not establish toolchain-wide security or public-host readiness. The production-only dependency closure still requires PF-14's artifact install proof.
- HEIC/native hard resource isolation, metadata policy and memory measurements remain PF-07/PF-20. Proxy spoofing, error wiring, ZIP budgets and retention remain their existing tasks; patching libraries does not fix application policy.

### Verification and continuation

Validation uses `NX_SKIP_NATIVE_FILE_CACHE=true NX_NO_CLOUD=true` plus the repository launcher. Raw logs/audits are ignored under `tmp/finalization-pf02/`; the following results are durable. No skipped tests or loosened existing assertions were introduced. Root and observability dependency declarations were checked against the lockfile. Lockfile changes were reviewed by dependency path, including expected OTel/Router/native-codec transitives and npm dev/peer-flag normalization.

| Check                                                                                        | Result                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node tools/nx.mjs run-many -t build typecheck lint`                                         | Passed for all 8 projects (22 tasks, 4 cached). Existing root.tsx explicit-any and build/listener notices remain.                                                                                                                                                          |
| `node tools/nx.mjs run-many -t test -p api schemas node-shared observability ui web api-e2e` | Passed: 432 tests / 44 files (including 25 real API lifecycle tests); 5/13 tasks cached. Real HEIC/PNG/AVIF smoke, decoded outputs, partial success, abort, expiry, legacy downloads and abrupt/graceful restart remain green.                                             |
| `node tools/nx.mjs run web-e2e:e2e`                                                          | Passed: 30 tests across Chromium/Firefox/WebKit, 4.8 minutes, zero failed/skipped. The final valid-version manifest assertion is additionally rerun in isolation below.                                                                                                    |
| Final SSR manifest regression                                                                | 3 passed, Chromium/Firefox/WebKit (29 seconds), using the built manifest version and actual paths parameter; bounded 100-path response and subsequent healthy SSR verified.                                                                                                |
| `node tools/nx.mjs run web-e2e:browser-integration`                                          | Failed after 300-second execution and teardown timeouts: 44 passed, 22 did not run. The historical Chromium alignment assertion passed unchanged. PF-01A owns the timeout and intermittent alignment investigation; this is not a PF-02 dependency regression verdict.     |
| Focused dependency security tests                                                            | 4 passed: bounded sniffer fixtures, compression abort cleanup, mapped-address limiting, private Nx socket directory.                                                                                                                                                       |
| OTel compatibility test                                                                      | Passes against a local HTTP collector; verifies span export, no implicit metrics export, shutdown, disabled initialization. Existing repeated-init diagnostic logger warning is retained for PF-10.                                                                        |
| `npm run check:use-cases`                                                                    | 67 cases covered; UC-011 gains supplemental E86 in both JSON and Markdown, explicitly distinguishing dependency HTTP fixture from production proxy-policy proof.                                                                                                           |
| `npm ls --all --json`                                                                        | Exit 0; no invalid peers. Reports baseline extraneous wasm helper packages plus optional @img/sharp-wasm32@0.35.5; clean-install/platform ownership remains PF-11/PF-13.                                                                                                   |
| Formatting and diff review                                                                   | New tests/launcher, README, plan and inventory pass locked Prettier; git diff --check passes. Reviewed manifest/lockfile changes and call-site diffs; no unrelated application refactor. Existing formatting in untouched portions of nx.json/instrumentation.ts retained. |

Discovered follow-ups are assigned, not started: generated-directory lint enumeration race → PF-17; removal of temporary Nx socket wrapper after the major upgrade → PF-12; implicit metrics compatibility and repeated-init diagnostics → PF-10. Recommended next task after PF-02: **PF-03 (P0)**. PF-01A remains independently ready at P1; do not automatically continue to it.

### PF-02 closeout (2026-10-17)

**Status: done.** The required dependency families were patched or, for Nx 21's local socket exposure, contained by the documented launcher. Required boundary checks, build/typecheck, real conversion and SSR browser E2E, and fresh audits have recorded results above. The remaining production high is Lodash 4.17.23: its two recorded advisories concern `template`, `unset`, and `omit`, while the identified runtime callers use other methods. This dated source-based nonreachability assessment satisfies PF-02's “no unmitigated reachable high/critical runtime finding” criterion; it is not an audit pass or proof for future call sites. PF-13/PF-14 own its resolution and the 2026-11-17 reassessment deadline.

The full audit still fails with 131 affected entries, and the production audit still fails with one high entry. Runtime dependency ownership and deployable artifact closure remain PF-14; broader tooling upgrades remain PF-12/PF-13. The mocked-browser suite did not finish, so CI-equivalent validation is not green; PF-01A owns its 300-second timeout and all 66 integration cases. No further suite rerun or dependency change was needed for this documentation closeout. No commit or remote write was made.

### PF-01A closeout (2026-10-17)

**Status: done.** This section supersedes the historical PF-01A failure evidence and next steps in the handoff; PF-02's separate closeout above remains unchanged. Focused timing of two Chromium cases measured 5.322 and 5.358 seconds for graceful SSR shutdown, while proxy shutdown took 0 ms. Immediate termination of that disposable test-only process removed the repeated wait; the precise open handle behind the graceful delay was not isolated. Aggregate After Hooks fell from 184.881 seconds for the baseline's 44 completed cases to **18.771 seconds for all 66 cases** in the final CI-equivalent run (Chromium 3.589, Firefox 4.258, WebKit 10.924 seconds). The real API fixture retains graceful shutdown.

The 3.140625 px baseline alignment failure came from vertically centering a tall ZIP button beside a shorter ghost button. The action row now aligns their top edges. The strict `<2px` check remains, but polls for settled layout: earlier aggregate runs measured 13–50 px transient differences while failure screenshots showed aligned buttons. A screenshot of the rebuilt Chromium route was inspected under `tmp/pf01a-alignment.png`. WebKit's file selection now uses the visible chooser after hydration; the focused status tooltip stays open on pointer exit and repositions on scroll. The focus behavior has a unit regression. The original assertion passed in isolation after the CSS change, all six focused cross-browser cases passed after test stabilization, and five repeated Chromium progressive-results cases passed after the tooltip correction.

The first complete mocked-browser run finished **62 passed, 4 failed in 3.6 minutes**; the second finished **65 passed, 1 failed in 3.6 minutes**. Two CI-equivalent attempts also exposed the aggregate tooltip race (and one isolated real WebKit PNG download timeout); the latter passed three focused repeats without a code change. The final `NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false NX_NO_CLOUD=true npm run ci:hook` **passed**, including **66/66 mocked-browser cases in 262.119 seconds**, **30/30 real browser cases in 3.0 minutes**, and all remaining lint/test/build/typecheck targets (25 of 33 Nx tasks served from local cache). The real-browser suite and integration suite overlap in the CI run, giving the required contention measurement. Based on the 262-second contended runtime, the integration-only global deadline is 360 seconds; real browser E2E retains 300 seconds. A subsequent standalone run with that final config passed all 66 cases in **215.039 seconds**; its HTML report records zero failed, flaky, skipped, or omitted tests, 16.355 seconds of After Hooks across all browsers, and 0.618 seconds between the last case ending and the report's suite end. No execution or teardown deadline fired. Final evidence is in ignored `tmp/pf01a-ci-verified.log`, `tmp/pf01a-full-report.log`, and `apps/web-e2e/test-output/integration/report/index.html`. No commit or remote write was made.

### PF-03 closeout (2026-10-17)

**Status: done.** Express now mounts the four-argument JSON error translator, forwards rejected legacy file handlers, and passes `sendFile` callback failures to that boundary. Once headers are sent, the error is handed to Express to close the response. The duplicate unlimited URL-encoded parser was removed; the remaining JSON and simple URL-encoded parsers use validated positive byte limits. Operation creation and ZIP download require JSON media type. Parser errors return safe JSON with 400/413/415 status, while existing conversion validation responses retain their schema. README documents the accepted media type, limits, and error shapes. The in-process real HTTP checks cover malformed/oversized JSON, oversized/nested/duplicate URL-encoded bodies, absent/wrong media type, rejected legacy metadata read, missing file before headers, failure after headers, and enabled/disabled HTTP logging. E87 adds the new parser evidence to the use-case inventory.

Validation: focused request-boundary suite **6/6 passed**; full API suite **213/213 passed**; separately started API process suite **25/25 passed**; API/observability lint and typecheck passed; API build passed as a process-suite prerequisite; inventory checker reports **67/67 covered**; changed-file Prettier and `git diff --check` passed. An initial full API run had one stale mock assertion expecting `sendFile(path)`; it was updated to expect the required callback, then the full suite passed. The process suite passed on its first run. The final error-status mapping was checked by the focused suite after the full run. No browser rerun was needed for the API-only contract change. No commit or remote write was made; the pre-existing PF-01A/PF-02 working-tree changes remain in place.

Residual boundaries: parsing still precedes general rate limiting and proxy trust remains unchanged, both assigned to PF-04. Legacy metadata and filesystem validation remain PF-08; telemetry redaction/configuration remain PF-10. PF-03 does not claim public-host readiness.

### PF-04 closeout (2026-10-17)

**Status: done.** Proxy trust now defaults to off. `TRUSTED_PROXY_IPS` accepts only explicit comma-separated IP addresses of immediate proxy peers; invalid entries fail startup. Express uses the nearest untrusted address in a forwarded chain, so a direct client cannot select its limiter identity with `X-Forwarded-For`. The general limiter now runs after CORS but before JSON/form parsing and compression. Health/readiness remain exempt; status polling retains its separate 240/minute/IP budget, and session creation retains its stricter three/minute/IP budget while also consuming the general budget. README and deployment documentation specify proxy behavior, 429/`Retry-After`, CORS, and process-local limits. UC-068 and E88–E91 record the new in-process HTTP evidence; the existing two-upload and polling tests remain active.

Validation: focused admission suite **10/10 passed**; full API suite **223/223 passed**; separately started API suite **25/25 passed**, including two-upload workflows, session exhaustion, cross-origin retry headers, and recovery; API lint, typecheck, and production build passed; inventory checker reports **68/68 covered**. Changed-file Prettier and `git diff --check` passed. The first focused test run exposed an incorrect assumption that session requests were outside the general budget; the test was corrected without changing the policy. Typecheck initially exposed a Zod default placed after a transform; the default was moved before the transform. A later focused run established that duplicate `X-Forwarded-For` header lines get HTTP 400 in this Node setup, without consuming the valid client's budget. No commit or remote write was made; earlier PF-01A/PF-02/PF-03 working-tree changes remain.

Residual boundary: a configured proxy must replace or append the actual client address and prevent untrusted clients from connecting from a listed proxy IP. These topology controls belong to deployment; a local in-process test cannot prove a particular production network. Limits remain process-local, and this closeout does not grant public-host readiness.

### PF-05 closeout (2026-10-17)

**Status: done.** ZIP requests now accept at most 32 distinct safe IDs of at most 128 characters and an optional archive name of at most 128 characters. Validation precedes file metadata reads. Both conversion and sealed-legacy ZIP routes share a process-local two-archive admission limit and return `503 archive_busy` when full. Archive work has a 30-second deadline; completion, failure, timeout, and client abort release the slot, while the existing response lease protects conversion outputs until transfer settlement. Filename sanitization bounds ZIP entries, removes path/control/format characters and trailing dots, and emits an ASCII `filename` fallback plus encoded UTF-8 `filename*`. Order, name-collision handling, missing-ID reporting, and existing archive error behavior remain covered. Compression remains at level 9; no measurement justified changing it in this slice.

Validation: full API suite **227/227 passed**, separately started API suite **26/26 passed**, schema contract suite **10/10 passed**, API lint/typecheck and production build passed. The inventory checker reports **69/69 covered** with UC-069/E92–E94 added for bounds, saturation, and timeout. Existing tests cover abort, disappearing sources, order, decoded archive content, and lease deferral; the new focused tests cover headers and capacity. The first focused command used repository-relative Vitest paths and found no files; it was rerun with the correct project-relative paths and passed. An initial lint run caught a control-character regex in the new sanitizer; character-code checks resolved it. No commit or remote write was made. Pre-existing PF-01A–PF-04 working-tree changes remain.

Residual boundary: the two-archive budget is per API process, matching the single-process deployment contract. The 30-second deadline is a transfer cap, so very slow clients must retry; HTTP errors after headers close the stream. Legacy storage metadata/path hardening remains PF-08, and session cleanup/expiry remains PF-06.

### PF-06 closeout (2026-10-17)

**Status: done.** The runtime now scans session directories in its owned upload root as well as operation records. Valid expired create-only and sealed legacy sessions are removed on startup and periodic sweeps. Conversion sessions keep their existing serialized deletion and upload/output claim checks. A shared request lease now starts before conversion or legacy file routes and lasts until response settlement; the runtime also defers cleanup for active uploads and conversions. Cleanup marks a session as deleting before its final expiry recheck, preventing new leases during removal. It checks the root, IDs, directory type, matching session record, and expiry; unrelated directories and symlinks remain untouched. Invalid records stay on disk and are reported once per process in runtime diagnostics. A recordless directory gets five minutes to finish creation, then is reported for operator repair. Scan or removal failures fault readiness.

Validation: full API suite **234/234 passed**; separately started API suite **26/26 passed**, with production build as a prerequisite; API lint and typecheck passed. The inventory checker reports **71/71 covered** with UC-070–071/E95–E100 for expiry, leases, isolation, and storage faults. Focused tests cover restart and repeated-sweep idempotence, create/cleanup overlap, corrupt and stale recordless directories, symlinks, and failed deletion. The first full API run found test fixtures missing the newly required lease method; those fixtures were updated. The first process run exposed a generic 500 for a blocked conversion session at the new lease guard; it now preserves the existing `503 storage_error` contract, and the final process run passed. Changed-file Prettier and `git diff --check` passed. No commit or remote write was made; pre-existing PF-01A–PF-05 working-tree changes remain.

Residual boundary: malformed or recordless directories require operator repair or removal and are deliberately not deleted automatically. Session authentication and legacy metadata validation, path containment, and private filesystem modes remain PF-08. This single-process lease model is not a distributed storage protocol and does not establish public-host readiness.

### PF-07 closeout (2026-10-17)

**Status: done for self-host; hard isolation remains a PF-20 public gate.** HEIC header dimensions are checked against the effective pixel ceiling before file buffering and `heic-convert` raster decode; a rejected decoder no longer falls back to Sharp. The default ceiling is 20 MP instead of 200 MP. Sharp encoding now fails on decoder errors, and both metadata and encoding stages enforce the pixel ceiling. HEIC with alpha uses a PNG intermediate. JPEG output explicitly flattens transparency to white. Real fixtures cover valid/truncated HEIC, invalid magic, a 20 MP at-limit PNG, EXIF orientation and removal, ICC removal/sRGB output, transparent JPEG, and first-frame/reject animation policy. Existing runtime tests assert timeout, cancellation, late-result discard, and retained worker ownership; the real HEIC smoke test records event-loop delay. UC-072–073/E101–E108 map the new contracts.

The bounded `node tools/measure-image-budget.mjs` runner uses two fixed fixtures in separate subprocesses with a 30-second kill deadline per child. Two Linux aarch64/Node 22.22.0/Sharp 0.35.5 runs observed peak RSS of **377–381 MiB** for a 12 MP HEIC and **179–185 MiB** for a 20 MP PNG; corresponding conversion times were **1.86–2.66 s** and **0.26–0.32 s**. README recommends reserving 2 GiB for the single API process, retaining the 20 MP default, and monitoring RSS. These measurements are not worst-case guarantees. Untrusted public uploads remain unsupported until PF-20 resolves hard decoder isolation or an enforced narrower policy; native code still runs in the API process.

Validation: full API suite **243/243 passed**; separately started API suite **26/26 passed**, including its production build; API lint and typecheck passed; and the inventory checker reports **73/73 covered**. Typecheck initially failed when run concurrently with an upstream schema build that replaced generated declarations; it passed when rerun after the build. Changed-file Prettier passed except the previously unformatted `image.service.spec.ts` (its formatting failure predates this task); `git diff --check` passed. Committed locally for export; no remote write was made.

### PF-08 session-record checkpoint (2026-10-17)

**Status: in progress.** Session reads and retention now share strict persisted-record validation: matching safe ID, canonical valid timestamps in chronological order, nonnegative integer counts, and a 64-character SHA-256 token hash. Invalid expiry fails closed. Authentication maps only ENOENT to 404; corrupt or unreadable records return a generic 503 storage error and emit an operator diagnostic without exposing record contents. New session directories and files are created with owner-only modes. Existing expired-session fixtures were updated to keep valid chronology. UC-074/E109–E110 maps the new behavior.

Validation: API suite **249/249 passed** after the implementation; focused incremental session/auth tests **8/8 passed** after the final assertions; separately started API suite **26/26 passed**, including production build and legacy downloads. API typecheck and lint, use-case inventory **74/74 covered**, and `git diff --check` passed. An initial API run failed because an expiry fixture placed expiry before creation; the first process run found two more such fixtures. All were corrected and the subsequent runs passed. An attempted Vitest `--runInBand` flag was unsupported; the normal project test command was used. Local commit: `PF-08: validate persisted session records`. No remote write was made.

At this checkpoint, legacy metadata, download path containment, storage modes and faults, and process-level failure recovery remained for later PF-08 slices.

### PF-08 legacy metadata checkpoint (2026-10-17)

**Status: in progress.** Legacy sidecars are now parsed with the shared upload metadata schema and checked against the requested file ID and canonical output name for the recorded MIME. Download resolution applies the same association check to operation-supplied metadata. Session/file path helpers reject traversal-shaped IDs and stored names. A missing sidecar remains a missing file; unreadable or corrupt sidecars now fail instead of silently appearing missing. UC-075/E111–E112 records the new boundary.

Validation: API suite **258/258 passed**; focused storage/file suite **27/27 passed**; separately started API suite **26/26 passed**, including sealed legacy downloads and production build; API typecheck and lint, use-case inventory **75/75 covered**, changed-file Prettier, and `git diff --check` passed. The focused suite initially failed because its filesystem mock omitted the default export; the corrected mock passed. `npm ci --legacy-peer-deps` installed the existing lockfile without changing dependencies. The installed dependency audit still reported 129 affected packages; dependency work remains in its assigned tasks.

Remaining PF-08 work: reject symlinked session, sidecar, and output paths at actual download entrypoints; audit private modes on conversion artifacts and existing directories; classify storage faults with appropriate response/readiness behavior; prove failure and recovery behavior at the process boundary. Lexical path checks and metadata parsing do not prevent file replacement races by a local actor with write access to storage.

The later maintainer retirement decision in the decision register superseded the legacy-read part of this checkpoint. Historical validation results above describe the code as tested at that time; the following PF-08 slice removed those handlers and the metadata reader.

### PF-08 sealed-session read retirement checkpoint (2026-10-17)

**Status: in progress.** The API no longer mounts the sealed-session file router. Current file URLs authorize a conversion operation and require committed output; a sealed session with only old sidecars now gets `404 operation_not_found` for metadata, image, and ZIP reads. The old sidecar reader, legacy controller/router, and their exclusive tests were removed. The shared filename/ZIP helpers remain for current operations, and ZIP media-type checks run before operation lookup. Session retention still reclaims old directories after expiry; code retirement does not delete user files immediately. README, architecture constraints, and the use-case inventory now describe the retired behavior. UC-048/E47 checks the production-process boundary; UC-075/E111–E112 were removed because they described a reader that no longer exists. E93 and E99 now cover the current route.

Validation: full API suite **233/233 passed**; separately started API suite **26/26 passed**, including current conversion downloads and rejected old sealed-session reads; API typecheck and lint passed; use-case inventory **74/74 covered**. The first focused request-boundary run found a missing `next` parameter after route simplification and assertions still expecting the retired controller's error shape; the corrected focused suite passed **28/28**. Production API and controlled fixture builds passed as API process test prerequisites.

Remaining PF-08 work: verify symlink containment at actual current download entrypoints; audit private modes on conversion artifacts and existing directories; classify storage read/write/rename/short-write faults with response and readiness behavior; prove isolation and partial-commit recovery at the process boundary. The historical metadata checkpoint no longer establishes protection for a live legacy endpoint.

### PF-08 current download path checkpoint (2026-10-17)

**Status: in progress.** Session authentication now checks that the session directory and record are regular expected filesystem types before reading. Conversion storage checks the operation directory/record, commit directory/receipt, and output sidecar before reading them. The output resolver uses `lstat` on the image it will send or archive, treating a missing image as missing and a symlink or other non-file as a storage error. A symlinked path returns generic `503 storage_error` at the current metadata, image, and ZIP entrypoints. UC-075/E111 maps the production-process regression. These checks cover paths present when inspected; file replacement races by a local actor with storage write access remain outside this single-process self-host guarantee.

Validation: full API suite **233/233 passed**, separately started API suite **27/27 passed**, API typecheck and lint passed. The process test replaces session/operation records, the commit directory/receipt, sidecar, and output with symlinks, checks 503 responses, restores regular files, then confirms a successful download. An initial focused unit run found one stale `existsSync` mock; the corrected full suite passed.

Remaining PF-08 work: audit private modes on conversion artifacts and existing directories; classify storage read/write/rename/short-write faults with response and readiness behavior; prove isolation and partial-commit recovery at the process boundary. No claim of atomic no-follow access under concurrent local disk tampering is made.

### PF-08 private storage modes checkpoint (2026-10-17)

**Status: in progress.** Session creation and conversion storage now create the upload root and operation directories with owner-only access (`0700`) and normalize existing directories they reuse. Startup normalizes the root and each discovered conversion operation's directories before recovery. Session records and new conversion snapshots, accepted inputs, output images, metadata, and commit receipts use owner-only file access (`0600`); copied upload staging is explicitly restricted before publication. Request multipart staging already used `0600` files in private temporary directories. The upload root's `0700` mode contains older files that may retain broad file modes until a later migration.

Validation: API unit suite **234/234 passed**, including a lifecycle assertion covering reused directories and all conversion artifacts; separately started API suite **27/27 passed**; API typecheck and lint passed; use-case inventory **75/75 covered**. A first focused test invocation used an unsupported Vitest `--testFile` option; the full suite passed after using the project's test target.

Local commit: `PF-08: retire legacy reads and harden storage`. No remote write was made.

Remaining PF-08 work: classify storage read/write/rename/short-write faults with response and readiness behavior; prove isolation and partial-commit recovery at the process boundary. Consider whether startup should normalize individual older file modes in addition to the owner-only root. Path-type checks and mode normalization are not atomic against a local actor with write access to storage.

### PF-08 staged-write fault checkpoint (2026-10-17)

**Status: in progress.** Conversion JSON snapshots and output buffers are now checked against their expected byte count and SHA-256 digest after staging and sync, before rename/publication. An incomplete successful write cannot become a committed snapshot or output. Upload and output staging I/O faults, including cleanup faults, now surface as `ConversionStorageError` so the existing HTTP boundary returns a generic 503 while retaining the filesystem cause for operator diagnostics. Transition errors retain their existing status. Injected short writes, EACCES/ENOSPC staging failures, and preexisting rename/partial-commit recovery tests cover this slice.

Validation: focused conversion-storage suite **42/42 passed**; full API suite **239/239 passed**; separately started API suite **27/27 passed**, including crash recovery and corrupt-session isolation. API production build, typecheck, lint, changed-file Prettier, and `git diff --check` passed. The first focused run found two older assertions expecting raw filesystem messages, which were updated to check classified errors and retained causes. A fresh checkout needed `npm ci --legacy-peer-deps` and an API build before declaration-based typecheck. The install left the lockfile unchanged and reported 129 vulnerable packages, tracked in the dependency tasks. The final diff was reviewed. No local commit or remote write was made.

Remaining PF-08 work: classify other create/read/rename/cleanup fault paths and verify their HTTP/readiness behavior with fault injection at the process boundary; verify startup handling of older broadly readable files. The existing process recovery suite does not inject a disk fault into a running production process, so it does not close that required evidence gap.

### PF-08 existing-file mode checkpoint (2026-10-18)

**Status: in progress.** Before reading each discovered conversion operation at startup, recovery now restricts its directories to `0700` and existing regular files in the operation, input, staging, and receipt directories to `0600`. Files already stored by older versions are included. Symlinks present at inspection are skipped; a unit regression verifies that an external symlink target retains its original mode. The separately started API regression broadens an operation record and accepted input before a crash restart, then checks both are private and the accepted slot remains usable. The recovery architecture and UC-076/E112–E113 record this contract.

Validation: focused conversion-storage suite **42/42 passed**; full API suite **239/239 passed**; separately started API suite **27/27 passed**; API build, typecheck, lint, and use-case inventory **76/76 covered** passed. No dependency or lockfile changes. This slice remains uncommitted with the preceding staged-write slice; no remote write was made.

Remaining PF-08 work: classify other create/read/rename/cleanup fault paths and verify HTTP/readiness behavior with fault injection in a running API process. The mode pass inspects then changes files and does not provide atomic protection against a local actor with storage write access.

### PF-08 request-mutation readiness checkpoint (2026-10-18)

**Status: in progress.** Request-time durable conversion mutations now fault the runtime when storage fails during operation creation, upload acceptance, rejection recording, or cancellation. The failure is classified as a storage error for the HTTP adapter, and `/readyz` returns 503 until process restart and recovery. Ordinary transition conflicts retain their request status and do not fault readiness. A separately started API test makes the accepted-input directory unwritable, verifies the upload returns `503 storage_error` and readiness drops, restores the directory, then restarts and completes the same slot. UC-045 now has direct process evidence E114. The existing unit expectation of immediate retry after a failed operation write was updated to require recovery while confirming its session claim is released.

Validation: full API suite **239/239 passed** and separately started API suite **28/28 passed** after that assertion update. API production build, typecheck, lint, changed-file Prettier, `git diff --check`, and use-case inventory **76/76 covered** passed. An initial full API run failed on the old retry expectation; the corrected run passed. No dependency or lockfile changes. This slice remains uncommitted with the preceding PF-08 slices; no remote write was made.

Remaining PF-08 work: verify create, read, write, rename, short-write, and cleanup fault classification across the remaining storage entrypoints, including response and readiness behavior where a mutation's outcome is uncertain. Preserve per-session isolation for corrupt persisted records. The process test covers a real EACCES rename failure; it does not establish behavior for every filesystem fault or a multi-process deployment.

### PF-08 session-issuance durability checkpoint (2026-10-18)

**Status: in progress.** Session records are now written to an owner-only temporary file, synced, read back and checked for exact bytes, then atomically renamed and the containing directory synced before a token is returned. A successful but incomplete write cannot publish a record or issue an unusable token. Rename failure preserves the prior record when `writeSessionInfo` replaces one. Session creation classifies filesystem failures as `SessionStorageError`; its controller returns a generic `503 storage_error` without sending a token. UC-077/E115–E116 maps the new boundary. Existing recordless directories after failed creation remain subject to the documented retention policy.

Validation: focused session service/controller suite **13/13 passed**, full API suite **242/242 passed**, and separately started API suite **28/28 passed**. API production build, typecheck, lint, and use-case inventory **77/77 covered** passed. No dependency or lockfile changes. This slice remains uncommitted with preceding PF-08 slices; no remote write was made.

Remaining PF-08 work: classify remaining conversion storage read, write, rename, and cleanup faults with appropriate response/readiness behavior; test those paths at the process boundary where practical. Session issuance's short-write and rename tests inject faults in-process; they do not prove all filesystem failure modes in a deployed environment.

### PF-08 persisted-read fault checkpoint (2026-10-18)

**Status: in progress.** Conversion runtime distinguishes operating-system I/O failures from corrupt or missing per-session artifacts during startup recovery, operation scans, status reads, and commit-evidence reads. An I/O fault stops admission and readiness; malformed persisted records still isolate only their session. Session discovery failures now become a `503 storage_error` on operation creation and also stop readiness. A separately started API test makes an operation record unreadable, verifies status and readiness return 503, then restores access and recovers on restart. UC-078/E117–E120 records the startup, scan, live-read, and process evidence.

Validation: full API suite **245/245 passed**, separately started API suite **29/29 passed**, API build/typecheck/lint and API E2E lint passed; use-case inventory **78/78 covered**. The first focused command used a workspace-relative filter and found no tests; the corrected filter passed. One new startup assertion initially expected the raw EACCES error rather than the storage wrapper; the corrected focused and full runs passed. No dependency or lockfile changes. This slice is uncommitted; no remote write was made.

Remaining PF-08 work: classify remaining conversion storage write, rename, and cleanup fault paths and their HTTP/readiness behavior, including uncertainty after a rename or directory sync. The process test exercises EACCES on a live read; it does not establish every filesystem fault mode or multi-process behavior.

### PF-08 output-write and root-loss checkpoint (2026-10-18)

**Status: in progress.** A separately started API process now proves that an EACCES failure writing converter output staging drops readiness, leaves the file uncommitted, and recovers it as `processing_interrupted` after restart; the failed output cannot be downloaded. Session discovery now distinguishes an existing empty storage root from a root that disappeared: it raises `ConversionStorageError` for the latter, so operation scans cannot silently treat lost storage as zero operations. UC-045/E121 and UC-078/E122 map these boundaries.

Validation: full API suite **246/246 passed**, separately started API suite **30/30 passed**, API production build/typecheck/lint, API E2E lint, and use-case inventory **78/78 covered** passed. No dependency or lockfile changes. This slice and the preceding PF-08 read-fault slice remain uncommitted; no remote write was made.

Remaining PF-08 work: exercise ambiguous rename/directory-sync outcomes and cleanup failures through the runtime and HTTP boundary, and review whether any remaining storage exceptions can return a misleading status or leave readiness green. The EACCES process test proves the failed output staging write path, not all output publication failures.

### PF-08 receipt-publication and cleanup checkpoint (2026-10-18)

**Status: in progress.** A separately started API test now interrupts receipt persistence after the output and metadata have been written. Readiness drops; restart marks the file interrupted and removes both receiptless artifacts before they can be downloaded. A focused storage test simulates a receipt rename that reaches disk but reports EIO; recovery verifies the receipt and completes the output rather than discarding it. Another process test makes accepted-input cleanup fail after a completed snapshot; readiness drops, and restart removes the stale input while preserving the committed download. UC-079/E123–E124 and UC-045/E125 record these boundaries. The existing expired-session process test now accepts either a record-only directory or an already removed directory, as retention may run between the 403 response and filesystem inspection.

Validation: full API suite **247/247 passed**, separately started API suite **32/32 passed** on the final run, API build/typecheck/lint, API E2E lint, and use-case inventory **79/79 covered** passed. The first full API process run and a focused rerun failed on the expired-session test's stale directory-presence assumption; the corrected focused and full runs passed. No dependency or lockfile changes. This slice and preceding PF-08 slices remain uncommitted; no remote write was made.

Remaining PF-08 work: verify directory-sync ambiguity and audit remaining storage exception paths for misleading HTTP status or green readiness. Receipt rename ambiguity is covered with an injected post-rename fault; the process tests cover EACCES receipt creation and cleanup rather than an actual filesystem sync failure.

### PF-08 directory-sync and session-reread checkpoint (2026-10-18)

**Status: in progress.** A focused fault test now fails receipt-directory sync after the receipt rename, then verifies recovery accepts the on-disk receipt and completes the output. The exception audit found that operation creation rereads the session record after authentication; previously, a disk failure in that second read could return a generic 500 without faulting readiness. It now becomes `503 storage_error` and faults readiness. A missing session produces `404 session_not_found`, while a corrupt record blocks only that session and permits healthy admission. UC-079/E126 and UC-080/E127–E129 record these results.

Validation: full API suite **251/251 passed**, separately started API suite **32/32 passed**, API production build/typecheck/lint, and use-case inventory **80/80 covered** passed. The first typecheck exposed a duplicate import in this slice; it passed after removal. No dependency or lockfile changes. This slice and preceding PF-08 slices remain uncommitted; no remote write was made.

Remaining PF-08 work: check whether authentication-time session read faults should immediately drop runtime readiness or remain isolated until the periodic retention scan, and broaden filesystem fault classification beyond the current explicit code list where justified. The directory-sync test injects an EIO after rename and assumes the receipt remains visible; actual crash durability remains filesystem-dependent.

### PF-08 fatal storage shutdown checkpoint (2026-10-18)

**Status: in progress.** The maintainer chose immediate production shutdown for fatal storage faults. The production entrypoint now wires conversion-runtime faults and session authentication/issuance storage faults to the existing bounded graceful shutdown path. It drops readiness and closes the listener as soon as a fault is reported, waits up to `CONVERSION_SHUTDOWN_GRACE_MS` for active requests and conversions, and exits with code 1 even when draining succeeds. A live download can finish within that grace period; a stalled transfer may be interrupted. Corrupt session records remain isolated. Separately started production API tests prove that an upload mutation fault and an authentication-time session-record read fault each return 503, cause exit code 1, and recover after storage repair and restart. UC-045/E130–E131 records the process evidence.

Validation: full API suite **251/251 passed**, separately started API suite **34/34 passed**, API production build, API and API E2E typecheck/lint, changed-file Prettier, use-case inventory **80/80 covered**, and `git diff --check` passed. No dependency or lockfile changes. This slice and preceding PF-08 slices remain uncommitted; no remote write was made.

Remaining PF-08 work: review filesystem error classification beyond the current explicit code list and check for storage exception paths that could bypass fatal shutdown. The process tests inject EACCES faults; they do not prove every filesystem failure mode or the precise transfer behavior at the grace deadline.

### PF-08 fatal shutdown seam checkpoint (2026-10-18)

**Status: in progress.** UC-081/E132 now exercises a real production output download held open while an unrelated session authentication read raises EACCES. The process remains alive for that active response, refuses a fresh connection after shutdown begins, delivers the complete image within grace, then exits with code 1. UC-082/E133 holds a multipart upload open when the same fault occurs with an 800 ms grace period; the process remains alive while the upload is active, then exits with code 1 and closes it at the deadline. These cases directly cover the boundary between immediate admission shutdown and bounded draining. The test launcher now accepts a per-test shutdown grace period.

Validation: focused new API process tests **2/2 passed**, full API process suite **36/36 passed**, API E2E typecheck/lint, use-case inventory **82/82 covered**, changed-file Prettier, and `git diff --check` passed. No production dependency or lockfile changes. This test slice remains uncommitted with the preceding PF-08 work; no remote write was made.

Remaining PF-08 work: audit additional filesystem error codes and storage exception paths. The download test covers a connection that finishes before grace; the stalled-upload test covers the forced deadline. They do not model every client, proxy, or filesystem failure timing.

### PF-08 download-read fault checkpoint (2026-10-18)

**Status: in progress.** The conversion HTTP error boundary now recognizes filesystem and resource failures that occur during download resolution or after response headers have been sent. Before headers it returns a generic `503 storage_error`; after headers it closes the partial response. Both paths notify the production storage-fault shutdown hook. The shared classifier now includes `EBUSY`, `ESTALE`, and other filesystem/resource codes beyond the original list, while excluding transport errors such as `EPIPE` so a disconnected client does not stop the API. Existing missing-file and malformed-path cases remain isolated. UC-083/E134–E135 and UC-084/E136 record these boundaries; authentication tests also check the added codes and isolated `ENOTDIR` behavior.

Validation: focused API HTTP/auth tests **22/22 passed**, full API suite **257/257 passed**, separately started API suite **36/36 passed**, API production build/typecheck/lint, changed-file Prettier, use-case inventory **84/84 covered**, and `git diff --check` passed. The first typecheck found an implicit `this` type in the new test mock; it passed after annotation. No dependency or lockfile changes. This slice remains uncommitted with the preceding PF-08 work; no remote write was made.

Remaining PF-08 work: inspect remaining storage entrypoints and path-specific error handling, especially failures whose errors have no errno code. The new late-download tests inject faults at the HTTP boundary; they do not reproduce a filesystem failure at exactly that point in a separate production process.

### PF-08 unlabelled read-fault checkpoint (2026-10-18)

**Status: in progress.** Session-record and conversion-operation reads now tag failures from their filesystem calls even when the underlying error has no errno code. An unlabelled session read becomes `SessionStorageError`, which authentication returns as a generic 503 and reports to the fatal shutdown hook. An unlabelled operation read becomes `ConversionStorageIoError`; startup and live runtime classification stop readiness instead of quarantining the session as corrupt. Missing records and malformed paths retain their isolated behavior. UC-078/E137 and E140, plus UC-085/E138–E139, record the new boundary tests.

Validation: focused storage/runtime/session/auth suites **113/113 passed**, full API suite **261/261 passed**, separately started API suite **36/36 passed** on a sequential rerun, API production build/typecheck/lint, changed-file Prettier, use-case inventory **85/85 covered**, and `git diff --check` passed. The initial focused run failed because the new session wrapper added a level to an error cause assertion; the corrected run passed. The first API process run failed because a concurrent build temporarily removed the generated observability entrypoint; its isolated rerun passed. No dependency or lockfile changes. This slice remains uncommitted with preceding PF-08 work; no remote write was made.

Remaining PF-08 work: inspect other read and commit-evidence paths for unlabelled filesystem failures, while keeping malformed persisted data isolated. The new tests inject unlabelled errors in-process; they do not reproduce such an error from a real filesystem in a separate production process.

### PF-08 commit-evidence read checkpoint (2026-10-18)

**Status: in progress.** Commit-evidence verification now tags unlabelled filesystem failures while reading receipt, metadata, and output fingerprints as storage I/O. Missing and malformed artifacts, including malformed receipt JSON and invalid paths, remain isolated to the affected session. The startup recovery permission scan also tags unlabelled filesystem failures before it verifies receipts. UC-086/E141–E146 covers receipt, metadata, and output stat/read failures, startup recovery and live download readiness, and malformed-evidence isolation. The recovery design document records this distinction.

Validation: full API suite **270/270 passed**, separately started API suite **36/36 passed**, API production build/typecheck/lint, changed-file Prettier, use-case inventory **86/86 covered**, and `git diff --check` passed. The first startup test exposed the earlier permission-scan path and failed; after classifying that path and testing it separately, the full suite passed. No dependency or lockfile changes. This slice remains uncommitted with preceding PF-08 work; no remote write was made.

Remaining PF-08 work: inspect other conversion-storage filesystem paths for unlabelled errors that may still be mistaken for per-session corruption, especially accepted-input verification and cleanup during recovery. These tests inject errors in-process; the separate process suite covers ordinary EACCES faults, not a real filesystem error without an errno code.

### PF-08 accepted-input and recovery-cleanup checkpoint (2026-10-18)

**Status: in progress.** Restart recovery now tags unlabelled filesystem failures while fingerprinting accepted inputs or pruning incomplete artifacts as storage I/O. A missing accepted input still becomes a file-level storage failure, while a read fault leaves its accepted state intact. Cleanup faults stop recovery so a later startup can retry orphan removal. UC-087/E147–E148 records these boundaries; the recovery design document now describes them.

Validation: focused conversion-storage suite **54/54 passed**; full API suite **272/272 passed** when run from `apps/api`; API production build, typecheck, lint, use-case inventory **87/87 covered**, and changed-file formatting passed. An initial full run from the repository root passed 271 tests and failed one smoke test because that test resolves its HEIC fixture relative to the current directory; the project-directory rerun passed. No dependency or lockfile changes. No local commit or remote write was made for this slice.

Remaining PF-08 work: review unlabelled filesystem faults at other conversion-storage entrypoints, including pending-commit checks, operation creation/discovery, upload acceptance, and output publication. Verify that each path yields the intended readiness or isolated-session behavior; do not broaden shutdown for malformed records or ordinary client transport failures. The new tests inject faults in-process and do not reproduce an unlabelled error from a real filesystem in a separate production process.

### PF-08 discovery and pending-commit checkpoint (2026-10-18)

**Status: in progress.** Session discovery now tags unlabelled root reads and operation-record stat failures as storage I/O; malformed stored paths remain distinct. Pending-commit receipt inspection likewise tags unlabelled stat failures without changing the operation record. Startup still fails readiness for discovery faults rather than quarantining a single session. UC-088/E149–E152 records these boundaries, and the recovery design document describes discovery classification.

Validation: focused conversion-storage/runtime suites **105/105 passed**; full API suite **276/276 passed** from `apps/api`; API production build, typecheck, lint, use-case inventory **88/88 covered**, changed-file formatting, and `git diff --check` passed. No dependency or lockfile changes. This slice remains uncommitted with the preceding PF-08 slice; no remote write was made.

Remaining PF-08 work: inspect unlabelled filesystem faults during operation creation, upload acceptance, output publication, and settled-input pruning. Runtime mutation wrappers already halt on thrown non-transition errors, but direct storage classification and cleanup behavior still need review. Preserve missing-record and malformed-path isolation and receipt/fingerprint durability.

### PF-08 creation and settled-input cleanup checkpoint (2026-10-18)

**Status: in progress.** Operation creation now tags unlabelled record-existence and directory-sync failures as storage I/O before publishing a record. It still returns a conflict when an operation exists and treats a missing record as an available session. Settled-input pruning tags unlabelled removal failures as storage I/O; the committed output remains intact so pruning can retry. UC-089/E153–E155 covers these boundaries.

Validation: focused conversion-storage suite **60/60 passed** after correcting a test mock that remained active during its absence assertion; full API suite **279/279 passed** from `apps/api`; API production build, typecheck, lint, use-case inventory **89/89 covered**, changed-file formatting, and `git diff --check` passed. No dependency or lockfile changes. This slice remains uncommitted with earlier PF-08 work; no remote write was made.

Remaining PF-08 work: review unlabelled filesystem failures during upload acceptance and output publication, including staging cleanup after an ambiguous commit. Check that failures retain the correct acceptance or receipt evidence for restart recovery and do not turn request cancellation into a global storage fault.

### PF-08 output-publication fault checkpoint (2026-10-18)

**Status: in progress.** Filesystem calls in output staging, rename, directory sync, metadata and receipt publication, and post-commit input/staging cleanup now tag unlabelled failures as storage I/O. Invalid artifact paths and application transition errors retain their separate classification. A rename failure before receipt publication leaves the file interrupted; a receipt rename that succeeds before reporting failure remains recoverable. Post-commit cleanup faults leave the committed output intact. UC-090/E156–E159 records these boundaries.

Validation: focused conversion-storage suite **64/64 passed**, full API suite **283/283 passed** from `apps/api`, API production build/typecheck/lint, use-case inventory **90/90 covered**, changed-file formatting, and `git diff --check` passed. No dependency or lockfile changes. This slice remains uncommitted with earlier PF-08 work; no remote write was made.

Remaining PF-08 work: inspect unlabelled filesystem failures in upload acceptance and its two-path staging cleanup, preserving request cancellation as a transition rather than a global storage fault. Review snapshot write classification after ambiguous acknowledgement; a simultaneous receipt and staging-cleanup failure is not simulated by this slice.

### PF-08 upload-acceptance fault checkpoint (2026-10-18)

**Status: in progress.** Filesystem calls during upload source inspection, staging, fingerprinting, promotion, and directory sync now tag unlabelled failures as storage I/O. The request-active callback remains outside those wrappers, so cancellation stays an upload transition. Staging and request-source cleanup both settle before the upload claim is released, including when one unlink fails; accepted bytes and manifest state remain available for restart recovery. A promotion rename that succeeds before reporting failure leaves an unacknowledged input orphan for recovery to remove. UC-091/E160–E164 covers these boundaries.

Validation: focused conversion-storage suite **70/70 passed**, full API suite **289/289 passed** from `apps/api`, API production build/typecheck/lint, use-case inventory **91/91 covered**, changed-file formatting, and `git diff --check` passed. The first lint run overlapped temporary-directory removal by the full test suite and failed with `ENOENT`; after those tests completed, lint exposed `no-unsafe-finally` in the first cleanup version. Cleanup was refactored to settle both results and report errors after releasing the claim; focused/full tests and lint then passed. No dependency or lockfile changes. Local commit: `PF-08: classify storage faults across conversion lifecycle`. No remote write was made.

Remaining PF-08 work: classify unlabelled filesystem errors in atomic snapshot writes without confusing malformed data with storage I/O, and test a simultaneous receipt-publication and staging-cleanup fault if useful. A missing request source during staging still enters the storage-fault path; decide whether a proven client disconnect should be handled as an upload transition before altering that behavior.

## Dated dependency inventory (2026-10-16)

Registry metadata was queried with `npm outdated --package-lock-only --json`; full and `--omit=dev` audits used `npm audit --package-lock-only --ignore-scripts --json`. Audit exits were 1 because findings exist. Counts refer to affected package entries, including parent propagation, not unique CVEs or demonstrated exploits.

Full: {"info":0,"low":2,"moderate":66,"high":104,"critical":15,"total":187}.

Production-filtered: {"info":0,"low":0,"moderate":5,"high":11,"critical":4,"total":20}.

### Direct declarations across root and workspace manifests

Versions are locked → registry wanted/latest at discovery. A dash means the outdated query did not report an update, not a guarantee of perpetual support. Duplicate workspace declarations are combined. All packages receive a disposition in PF-02/PF-11–14/PF-18.

<!-- prettier-ignore -->
| Package | Locked | Wanted | Latest | Declared in |
| ----------------------------------------- | ------- | ------- | ------- | -------------------------------------------------------------- |
| @babel/core | 7.28.4 | 7.29.7 | 8.0.7 | root:dev |
| @babel/preset-react | 7.27.1 | 7.29.7 | 8.0.1 | root:dev |
| @eslint/js | 9.36.0 | 9.39.5 | 10.0.1 | root:dev |
| @nx/devkit | 21.6.2 | 21.6.2 | 23.3.0 | root:dev |
| @nx/eslint | 21.6.2 | 21.6.2 | 23.3.0 | root:dev |
| @nx/eslint-plugin | 21.6.2 | 21.6.2 | 23.3.0 | root:dev |
| @nx/jest | 21.6.2 | 21.6.2 | 23.3.0 | root:dev |
| @nx/js | 21.6.2 | 21.6.2 | 23.3.0 | root:dev |
| @nx/node | 21.6.2 | 21.6.2 | 23.3.0 | root:dev |
| @nx/playwright | 21.6.2 | 21.6.2 | 23.3.0 | root:dev |
| @nx/plugin | 21.6.2 | 21.6.11 | 23.3.0 | root:dev |
| @nx/react | 21.6.2 | 21.6.2 | 23.3.0 | root:dev |
| @nx/vite | 21.6.2 | 21.6.2 | 23.3.0 | root:dev |
| @nx/web | 21.6.2 | 21.6.2 | 23.3.0 | root:dev |
| @nx/webpack | 21.6.2 | 21.6.2 | 23.3.0 | root:dev |
| @nx/workspace | 21.6.2 | 21.6.2 | 23.3.0 | root:dev |
| @opentelemetry/api | 1.9.0 | 1.9.1 | 1.9.1 | libs/observability:dev |
| @opentelemetry/auto-instrumentations-node | 0.62.2 | 0.62.2 | 0.81.2 | libs/observability:dev |
| @opentelemetry/exporter-trace-otlp-http | 0.203.0 | 0.203.0 | 0.223.0 | libs/observability:dev |
| @opentelemetry/resources | 2.1.0 | 2.12.0 | 2.12.0 | libs/observability:dev |
| @opentelemetry/sdk-node | 0.203.0 | 0.203.0 | 0.223.0 | libs/observability:dev |
| @opentelemetry/sdk-trace-base | 2.1.0 | 2.12.0 | 2.12.0 | libs/observability:dev |
| @playwright/test | 1.55.1 | 1.64.1 | 1.64.1 | root:dev |
| @pmmmwh/react-refresh-webpack-plugin | 0.6.1 | 0.6.3 | 0.6.3 | root:dev |
| @react-router/dev | 7.9.1 | 7.18.4 | 8.4.0 | root:dev |
| @react-router/node | 7.9.1 | 7.18.4 | 8.4.0 | root:runtime |
| @react-router/serve | 7.9.1 | 7.18.4 | 8.4.0 | root:runtime |
| @svgr/webpack | 8.1.0 | — | — | root:dev |
| @swc-node/register | 1.11.1 | 1.11.1 | 1.12.1 | root:dev |
| @swc/cli | 0.7.8 | 0.7.10 | 0.8.1 | root:dev |
| @swc/core | 1.13.5 | 1.13.21 | 1.16.18 | root:dev |
| @swc/helpers | 0.5.17 | 0.5.23 | 0.5.23 | root:dev |
| @tailwindcss/postcss | 4.1.13 | 4.3.3 | 4.3.3 | root:dev |
| @tailwindcss/vite | 4.1.13 | 4.3.3 | 4.3.3 | root:dev |
| @testing-library/dom | 10.4.1 | 10.4.1 | 10.4.2 | root:dev |
| @testing-library/jest-dom | 6.8.0 | 6.9.1 | 7.0.1 | root:runtime |
| @testing-library/react | 16.3.0 | 16.3.0 | 16.3.3 | root:dev |
| @testing-library/user-event | 14.6.1 | 14.6.8 | 14.6.8 | root:runtime |
| @types/archiver | 6.0.3 | 6.0.4 | 8.0.0 | root:runtime |
| @types/compression | 1.8.1 | — | — | root:dev |
| @types/cors | 2.8.19 | — | — | root:dev |
| @types/express | 4.17.23 | 4.17.25 | 5.0.6 | root:dev |
| @types/heic-convert | 2.1.0 | 2.1.1 | 2.1.1 | root:runtime |
| @types/hpp | 0.2.6 | 0.2.7 | 0.2.7 | root:dev |
| @types/node | 24.6.0 | 24.19.2 | 26.6.5 | root:dev |
| @types/react | 19.1.15 | 19.1.15 | 19.3.0 | root:dev |
| @types/react-dom | 19.1.9 | 19.1.9 | 19.3.0 | root:dev |
| @vitejs/plugin-react | 5.0.4 | 5.2.0 | 6.1.2 | root:dev |
| @vitest/coverage-v8 | 3.2.4 | 3.2.7 | 5.0.5 | root:dev |
| @vitest/ui | 3.2.4 | 3.2.7 | 5.0.5 | root:dev |
| ajv | 8.17.1 | 8.20.0 | 8.20.0 | root:dev |
| archiver | 7.0.1 | 7.0.1 | 8.0.0 | root:runtime |
| clsx | 2.1.1 | — | — | root:dev |
| compression | 1.8.1 | 1.8.2 | 1.8.2 | root:runtime |
| cors | 2.8.5 | 2.8.6 | 2.8.6 | root:runtime |
| eslint | 9.36.0 | 9.39.5 | 10.13.0 | root:dev |
| eslint-config-prettier | 10.1.8 | — | — | root:dev |
| eslint-plugin-import | 2.32.0 | — | — | root:dev |
| eslint-plugin-jsx-a11y | 6.10.2 | — | — | root:dev |
| eslint-plugin-playwright | 2.2.2 | 2.12.1 | 2.12.1 | root:dev |
| eslint-plugin-react | 7.37.5 | — | — | root:dev |
| eslint-plugin-react-hooks | 5.2.0 | 5.2.0 | 7.1.1 | root:dev |
| express | 4.21.2 | 4.22.3 | 5.3.0 | root:runtime, libs/observability:dev |
| express-rate-limit | 8.1.0 | 8.7.1 | 8.7.1 | root:runtime |
| file-type | 21.0.0 | 21.3.4 | 22.2.0 | root:runtime |
| heic-convert | 2.1.0 | — | — | root:runtime |
| helmet | 8.1.0 | 8.3.0 | 8.3.0 | root:runtime |
| hpp | 0.2.3 | — | — | root:runtime |
| isbot | 5.1.31 | 5.2.2 | 5.2.2 | root:runtime |
| jiti | 2.6.0 | 2.6.0 | 2.7.0 | root:dev |
| jsdom | 27.0.0 | 27.0.1 | 29.1.1 | root:dev |
| nx | 21.6.2 | 21.6.2 | 23.3.0 | root:dev |
| pino | 9.12.0 | 9.14.0 | 10.4.0 | root:dev, libs/observability:dev |
| pino-http | 10.5.0 | 10.5.0 | 11.0.0 | root:dev, libs/observability:dev |
| pino-pretty | 13.1.1 | 13.2.0 | 13.2.0 | root:dev, libs/observability:dev |
| postcss | 8.5.6 | 8.5.30 | 8.5.30 | root:dev |
| prettier | 3.6.2 | 3.9.10 | 3.9.10 | root:dev |
| react | 19.1.1 | 19.1.1 | 19.3.1 | root:runtime |
| react-dom | 19.1.1 | 19.1.1 | 19.3.1 | root:runtime |
| react-error-boundary | 6.0.0 | 6.1.6 | 6.1.6 | root:runtime |
| react-icons | 5.5.0 | 5.7.0 | 5.7.0 | root:runtime |
| react-refresh | 0.17.0 | 0.17.0 | 0.19.0 | root:dev |
| react-router | 7.9.1 | 7.18.4 | 8.4.0 | root:runtime |
| sharp | 0.34.4 | 0.34.5 | 0.35.5 | root:runtime |
| tailwind-merge | 3.3.1 | 3.7.0 | 3.7.0 | root:dev |
| tailwindcss | 4.1.13 | 4.3.3 | 4.3.3 | root:dev |
| tslib | 2.8.1 | — | — | root:dev, libs/node-shared:runtime, libs/observability:runtime |
| typescript | 5.9.2 | 5.9.3 | 7.0.2 | root:dev |
| typescript-eslint | 8.45.0 | 8.71.2 | 8.71.2 | root:dev |
| vite | 7.1.7 | 7.3.7 | 8.3.4 | root:dev |
| vite-plugin-dts | 4.5.4 | 4.5.4 | 5.1.2 | root:dev |
| vitest | 3.2.4 | 3.2.7 | 5.0.5 | root:dev |
| webpack-cli | 6.0.1 | 6.0.1 | 7.2.3 | root:dev |
| zod | 4.1.11 | 4.6.7 | 4.6.7 | root:runtime, libs/observability:dev, libs/schemas:runtime |

### Full affected-package ledger

`Prod` means present in the production-filtered audit; runtime declarations are imperfect (F11), so a tool-only label must be confirmed against generated artifacts. Direct means the audit reports a direct dependency anywhere in the workspace. `via` identifies immediate advisory-bearing dependency relationships; IDs identify original advisories. Fix availability is the registry result, not a tested resolution. Resolve owning dependency chains with `npm explain <package>` when implementing. All entries are **untriaged**, owned by PF-01/PF-02 (runtime) or PF-12–14 (tooling).

<!-- prettier-ignore -->
| Package / locked affected copies | Severity | Direct / prod | via / advisories | Suggested fix |
| ------------------------------------------------------ | -------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| @babel/core 7.28.4 | low | direct / full only | GHSA-4x5r-pxfx-6jf8 | available within resolution |
| @babel/plugin-transform-modules-systemjs 7.27.1 | high | transitive / full only | GHSA-fv7c-fp4j-7gwp | available within resolution |
| @grpc/grpc-js 1.13.4 | high | transitive / full only | GHSA-5375-pq7m-f5r2, GHSA-99f4-grh7-6pcq, GHSA-m9gg-hp2v-232j, GHSA-f596-whhp-79r4 | available within resolution |
| @humanfs/node 0.16.7 | moderate | transitive / full only | GHSA-p498-v437-472g | available within resolution |
| @isaacs/brace-expansion 5.0.0 | high | transitive / full only | GHSA-7h2j-956f-4vf2 | available within resolution |
| @jest/console 30.1.2 | high | transitive / full only | jest-message-util | available within resolution |
| @jest/environment 30.1.2 | high | transitive / full only | @jest/fake-timers | available within resolution |
| @jest/expect 30.1.2 | high | transitive / full only | expect, jest-snapshot | available within resolution |
| @jest/fake-timers 30.1.2 | high | transitive / full only | jest-message-util | available within resolution |
| @jest/globals 30.1.2 | high | transitive / full only | @jest/environment, @jest/expect | available within resolution |
| @jest/reporters 30.1.3 | high | transitive / full only | @jest/console, @jest/test-result, @jest/transform, jest-message-util | available within resolution |
| @jest/test-result 30.1.3 | high | transitive / full only | @jest/console | available within resolution |
| @jest/test-sequencer 30.1.3 | high | transitive / full only | @jest/test-result, jest-haste-map | available within resolution |
| @jest/transform 30.1.2 | high | transitive / full only | jest-haste-map, micromatch | available within resolution |
| @microsoft/api-extractor 7.52.13 | high | transitive / full only | @microsoft/api-extractor-model, @microsoft/tsdoc-config, @rushstack/node-core-library, @rushstack/terminal, @rushstack/ts-command-line, minimatch | available within resolution |
| @microsoft/api-extractor-model 7.30.7 | moderate | transitive / full only | @microsoft/tsdoc-config, @rushstack/node-core-library | available within resolution |
| @microsoft/tsdoc-config 0.17.1 | moderate | transitive / full only | ajv | available within resolution |
| @module-federation/cli 0.18.4, 0.19.1 | high | transitive / full only | @module-federation/dts-plugin | @nx/react@23.3.0 (breaking/range change) |
| @module-federation/dts-plugin 0.18.4, 0.19.1 | high | transitive / full only | adm-zip, koa, ws | @nx/react@23.3.0 (breaking/range change) |
| @module-federation/enhanced 0.18.4, 0.19.1 | high | transitive / full only | @module-federation/cli, @module-federation/dts-plugin, @module-federation/manifest, @module-federation/rspack | @nx/react@23.3.0 (breaking/range change) |
| @module-federation/manifest 0.18.4, 0.19.1 | high | transitive / full only | @module-federation/dts-plugin | available within resolution |
| @module-federation/node 2.7.17 | high | transitive / full only | @module-federation/enhanced | available within resolution |
| @module-federation/rspack 0.19.1, 0.18.4 | high | transitive / full only | @module-federation/dts-plugin, @module-federation/manifest | available within resolution |
| @nx/devkit 21.6.2 | high | direct / full only | minimatch | @nx/devkit@23.3.0 (breaking/range change) |
| @nx/docker 21.6.2 | high | transitive / full only | @nx/devkit, GHSA-6vc5-vf29-ffr2 | @nx/node@23.3.0 (breaking/range change) |
| @nx/eslint 21.6.2 | high | direct / full only | @nx/devkit, @nx/js | @nx/eslint@23.3.0 (breaking/range change) |
| @nx/eslint-plugin 21.6.2 | high | direct / full only | @nx/devkit, @nx/js | @nx/eslint-plugin@23.3.0 (breaking/range change) |
| @nx/jest 21.6.2 | high | direct / full only | @nx/devkit, @nx/js, minimatch | @nx/jest@23.3.0 (breaking/range change) |
| @nx/js 21.6.2 | high | direct / full only | @nx/devkit, @nx/workspace, picomatch | @nx/js@23.3.0 (breaking/range change) |
| @nx/module-federation 21.6.2 | high | transitive / full only | @module-federation/enhanced, @nx/devkit, @nx/js, @nx/web | @nx/react@23.3.0 (breaking/range change) |
| @nx/node 21.6.2 | high | direct / full only | @nx/devkit, @nx/docker, @nx/eslint, @nx/jest, @nx/js | @nx/node@23.3.0 (breaking/range change) |
| @nx/playwright 21.6.2 | high | direct / full only | @nx/devkit, @nx/eslint, @nx/js, minimatch | @nx/playwright@23.3.0 (breaking/range change) |
| @nx/plugin 21.6.2 | high | direct / full only | @nx/devkit, @nx/eslint, @nx/jest, @nx/js | @nx/plugin@23.3.0 (breaking/range change) |
| @nx/react 21.6.2 | high | direct / full only | @nx/devkit, @nx/eslint, @nx/js, @nx/module-federation, @nx/rollup, @nx/vite, @nx/web, minimatch | @nx/react@23.3.0 (breaking/range change) |
| @nx/rollup 21.6.2 | high | transitive / full only | @nx/devkit, @nx/js, picomatch, rollup-plugin-copy | available within resolution |
| @nx/vite 21.6.2 | high | direct / full only | @nx/devkit, @nx/js, picomatch | @nx/vite@23.3.0 (breaking/range change) |
| @nx/web 21.6.2 | high | direct / full only | @nx/devkit, @nx/js | @nx/web@23.3.0 (breaking/range change) |
| @nx/webpack 21.6.2 | high | direct / full only | @nx/devkit, @nx/js, copy-webpack-plugin, css-minimizer-webpack-plugin, fork-ts-checker-webpack-plugin | @nx/webpack@23.3.0 (breaking/range change) |
| @nx/workspace 21.6.2 | high | direct / full only | @nx/devkit, nx, picomatch | @nx/workspace@23.3.0 (breaking/range change) |
| @opentelemetry/auto-instrumentations-node 0.62.2 | high | direct / full only | @opentelemetry/instrumentation-cassandra-driver, @opentelemetry/instrumentation-http, @opentelemetry/instrumentation-knex, @opentelemetry/instrumentation-mongoose, @opentelemetry/instrumentation-mysql, @opentelemetry/instrumentation-mysql2, @opentelemetry/instrumentation-oracledb, @opentelemetry/instrumentation-pg, @opentelemetry/instrumentation-tedious, @opentelemetry/sdk-node, GHSA-q7rr-3cgh-j5r3 | @opentelemetry/auto-instrumentations-node@0.81.2 (breaking/range change) |
| @opentelemetry/core 2.1.0, 2.0.1 | moderate | transitive / full only | GHSA-8988-4f7v-96qf | @opentelemetry/sdk-node@0.223.0 (breaking/range change) |
| @opentelemetry/exporter-logs-otlp-grpc 0.203.0 | moderate | transitive / full only | @opentelemetry/core, @opentelemetry/otlp-exporter-base, @opentelemetry/otlp-grpc-exporter-base, @opentelemetry/otlp-transformer, @opentelemetry/sdk-logs | @opentelemetry/sdk-node@0.223.0 (breaking/range change) |
| @opentelemetry/exporter-logs-otlp-http 0.203.0 | moderate | transitive / full only | @opentelemetry/core, @opentelemetry/otlp-exporter-base, @opentelemetry/otlp-transformer, @opentelemetry/sdk-logs | available within resolution |
| @opentelemetry/exporter-logs-otlp-proto 0.203.0 | moderate | transitive / full only | @opentelemetry/core, @opentelemetry/otlp-exporter-base, @opentelemetry/otlp-transformer, @opentelemetry/resources, @opentelemetry/sdk-logs, @opentelemetry/sdk-trace-base | available within resolution |
| @opentelemetry/exporter-metrics-otlp-grpc 0.203.0 | moderate | transitive / full only | @opentelemetry/core, @opentelemetry/exporter-metrics-otlp-http, @opentelemetry/otlp-exporter-base, @opentelemetry/otlp-grpc-exporter-base, @opentelemetry/otlp-transformer, @opentelemetry/resources, @opentelemetry/sdk-metrics | @opentelemetry/sdk-node@0.223.0 (breaking/range change) |
| @opentelemetry/exporter-metrics-otlp-http 0.203.0 | moderate | transitive / full only | @opentelemetry/core, @opentelemetry/otlp-exporter-base, @opentelemetry/otlp-transformer, @opentelemetry/resources, @opentelemetry/sdk-metrics | available within resolution |
| @opentelemetry/exporter-metrics-otlp-proto 0.203.0 | moderate | transitive / full only | @opentelemetry/core, @opentelemetry/exporter-metrics-otlp-http, @opentelemetry/otlp-exporter-base, @opentelemetry/otlp-transformer, @opentelemetry/resources, @opentelemetry/sdk-metrics | available within resolution |
| @opentelemetry/exporter-prometheus 0.203.0 | high | transitive / full only | @opentelemetry/core, @opentelemetry/resources, @opentelemetry/sdk-metrics, GHSA-q7rr-3cgh-j5r3 | @opentelemetry/sdk-node@0.223.0 (breaking/range change) |
| @opentelemetry/exporter-trace-otlp-grpc 0.203.0 | moderate | transitive / full only | @opentelemetry/core, @opentelemetry/otlp-exporter-base, @opentelemetry/otlp-grpc-exporter-base, @opentelemetry/otlp-transformer, @opentelemetry/resources, @opentelemetry/sdk-trace-base | @opentelemetry/sdk-node@0.223.0 (breaking/range change) |
| @opentelemetry/exporter-trace-otlp-http 0.203.0 | moderate | direct / full only | @opentelemetry/core, @opentelemetry/otlp-exporter-base, @opentelemetry/otlp-transformer, @opentelemetry/resources, @opentelemetry/sdk-trace-base | @opentelemetry/exporter-trace-otlp-http@0.223.0 (breaking/range change) |
| @opentelemetry/exporter-trace-otlp-proto 0.203.0 | moderate | transitive / full only | @opentelemetry/core, @opentelemetry/otlp-exporter-base, @opentelemetry/otlp-transformer, @opentelemetry/resources, @opentelemetry/sdk-trace-base | available within resolution |
| @opentelemetry/exporter-zipkin 2.0.1 | moderate | transitive / full only | @opentelemetry/core, @opentelemetry/resources, @opentelemetry/sdk-trace-base | available within resolution |
| @opentelemetry/instrumentation-cassandra-driver 0.49.0 | moderate | transitive / full only | GHSA-qqmp-wf37-98f9 | @opentelemetry/auto-instrumentations-node@0.81.2 (breaking/range change) |
| @opentelemetry/instrumentation-http 0.203.0 | moderate | transitive / full only | @opentelemetry/core | @opentelemetry/auto-instrumentations-node@0.81.2 (breaking/range change) |
| @opentelemetry/instrumentation-knex 0.48.0 | moderate | transitive / full only | GHSA-qqmp-wf37-98f9 | available within resolution |
| @opentelemetry/instrumentation-mongoose 0.50.0 | moderate | transitive / full only | GHSA-qqmp-wf37-98f9 | @opentelemetry/auto-instrumentations-node@0.81.2 (breaking/range change) |
| @opentelemetry/instrumentation-mysql 0.49.0 | moderate | transitive / full only | GHSA-qqmp-wf37-98f9 | @opentelemetry/auto-instrumentations-node@0.81.2 (breaking/range change) |
| @opentelemetry/instrumentation-mysql2 0.50.0 | moderate | transitive / full only | GHSA-qqmp-wf37-98f9 | available within resolution |
| @opentelemetry/instrumentation-oracledb 0.29.0 | moderate | transitive / full only | GHSA-qqmp-wf37-98f9 | @opentelemetry/auto-instrumentations-node@0.81.2 (breaking/range change) |
| @opentelemetry/instrumentation-pg 0.56.1 | moderate | transitive / full only | GHSA-qqmp-wf37-98f9 | available within resolution |
| @opentelemetry/instrumentation-tedious 0.22.0 | moderate | transitive / full only | GHSA-qqmp-wf37-98f9 | @opentelemetry/auto-instrumentations-node@0.81.2 (breaking/range change) |
| @opentelemetry/otlp-exporter-base 0.203.0 | moderate | transitive / full only | @opentelemetry/core, @opentelemetry/otlp-transformer | @opentelemetry/sdk-node@0.223.0 (breaking/range change) |
| @opentelemetry/otlp-grpc-exporter-base 0.203.0 | moderate | transitive / full only | @opentelemetry/core, @opentelemetry/otlp-exporter-base, @opentelemetry/otlp-transformer | @opentelemetry/sdk-node@0.223.0 (breaking/range change) |
| @opentelemetry/otlp-transformer 0.203.0 | moderate | transitive / full only | @opentelemetry/core, @opentelemetry/resources, @opentelemetry/sdk-logs, @opentelemetry/sdk-metrics, @opentelemetry/sdk-trace-base | @opentelemetry/sdk-node@0.223.0 (breaking/range change) |
| @opentelemetry/propagator-b3 2.0.1 | moderate | transitive / full only | @opentelemetry/core | @opentelemetry/sdk-node@0.223.0 (breaking/range change) |
| @opentelemetry/propagator-jaeger 2.0.1 | high | transitive / full only | @opentelemetry/core, GHSA-45rx-2jwx-cxfr | @opentelemetry/sdk-node@0.223.0 (breaking/range change) |
| @opentelemetry/resources 2.0.1, 2.1.0 | moderate | direct / full only | @opentelemetry/core | @opentelemetry/sdk-node@0.223.0 (breaking/range change) |
| @opentelemetry/sdk-logs 0.203.0 | moderate | transitive / full only | @opentelemetry/core, @opentelemetry/resources | @opentelemetry/sdk-node@0.223.0 (breaking/range change) |
| @opentelemetry/sdk-metrics 2.0.1 | moderate | transitive / full only | @opentelemetry/core, @opentelemetry/resources | @opentelemetry/sdk-node@0.223.0 (breaking/range change) |
| @opentelemetry/sdk-node 0.203.0 | high | direct / full only | @opentelemetry/core, @opentelemetry/exporter-logs-otlp-grpc, @opentelemetry/exporter-logs-otlp-http, @opentelemetry/exporter-logs-otlp-proto, @opentelemetry/exporter-metrics-otlp-grpc, @opentelemetry/exporter-metrics-otlp-http, @opentelemetry/exporter-metrics-otlp-proto, @opentelemetry/exporter-prometheus, @opentelemetry/exporter-trace-otlp-grpc, @opentelemetry/exporter-trace-otlp-http, @opentelemetry/exporter-trace-otlp-proto, @opentelemetry/exporter-zipkin, @opentelemetry/propagator-b3, @opentelemetry/propagator-jaeger, @opentelemetry/resources, @opentelemetry/sdk-logs, @opentelemetry/sdk-metrics, @opentelemetry/sdk-trace-base, @opentelemetry/sdk-trace-node, GHSA-q7rr-3cgh-j5r3 | @opentelemetry/sdk-node@0.223.0 (breaking/range change) |
| @opentelemetry/sdk-trace-base 2.0.1, 2.1.0 | moderate | direct / full only | @opentelemetry/core, @opentelemetry/resources | @opentelemetry/sdk-node@0.223.0 (breaking/range change) |
| @opentelemetry/sdk-trace-node 2.0.1 | moderate | transitive / full only | @opentelemetry/core, @opentelemetry/sdk-trace-base | available within resolution |
| @parcel/watcher 2.5.1 | high | transitive / full only | micromatch | available within resolution |
| @protobufjs/utf8 1.1.0 | moderate | transitive / full only | GHSA-q6x5-8v7m-xcrf | available within resolution |
| @react-router/dev 7.9.1 | critical | direct / full only | @react-router/node, valibot | available within resolution |
| @react-router/express 7.9.1 | critical | transitive / prod | @react-router/node, react-router | available within resolution |
| @react-router/node 7.9.1 | critical | direct / prod | GHSA-9583-h5hc-x8cw, react-router | available within resolution |
| @react-router/serve 7.9.1 | critical | direct / prod | @react-router/express, @react-router/node, react-router | available within resolution |
| @rushstack/node-core-library 5.14.0 | moderate | transitive / full only | ajv | available within resolution |
| @rushstack/terminal 0.16.0 | moderate | transitive / full only | @rushstack/node-core-library | available within resolution |
| @rushstack/ts-command-line 5.0.3 | moderate | transitive / full only | @rushstack/terminal, argparse | available within resolution |
| @swc/cli 0.7.8 | moderate | direct / full only | @xhmikosr/bin-wrapper | @swc/cli@0.8.1 (breaking/range change) |
| @typescript-eslint/eslint-plugin 8.45.0 | high | transitive / full only | @typescript-eslint/type-utils, @typescript-eslint/utils | available within resolution |
| @typescript-eslint/parser 8.45.0 | high | transitive / full only | @typescript-eslint/typescript-estree | available within resolution |
| @typescript-eslint/type-utils 8.45.0 | high | transitive / full only | @typescript-eslint/typescript-estree, @typescript-eslint/utils | available within resolution |
| @typescript-eslint/typescript-estree 8.45.0 | high | transitive / full only | fast-glob | available within resolution |
| @typescript-eslint/utils 8.45.0 | high | transitive / full only | @typescript-eslint/typescript-estree | available within resolution |
| @vitest/coverage-v8 3.2.4 | critical | direct / full only | vitest | available within resolution |
| @vitest/mocker 3.2.4 | moderate | transitive / full only | GHSA-82fw-gwwq-j7x9 | available within resolution |
| @vitest/ui 3.2.4 | critical | direct / full only | vitest | available within resolution |
| @xhmikosr/archive-type 7.1.0 | moderate | transitive / full only | file-type | @swc/cli@0.8.1 (breaking/range change) |
| @xhmikosr/bin-wrapper 13.2.0 | moderate | transitive / full only | @xhmikosr/downloader | @swc/cli@0.8.1 (breaking/range change) |
| @xhmikosr/decompress 10.2.0 | critical | transitive / full only | @xhmikosr/decompress-tar, @xhmikosr/decompress-tarbz2, @xhmikosr/decompress-targz, @xhmikosr/decompress-unzip, GHSA-mp2f-45pm-3cg9, GHSA-hrh2-vp3x-79xf | available within resolution |
| @xhmikosr/decompress-tar 8.1.0 | moderate | transitive / full only | file-type | available within resolution |
| @xhmikosr/decompress-tarbz2 8.1.0 | moderate | transitive / full only | @xhmikosr/decompress-tar, file-type | available within resolution |
| @xhmikosr/decompress-targz 8.1.0 | moderate | transitive / full only | @xhmikosr/decompress-tar, file-type | available within resolution |
| @xhmikosr/decompress-unzip 7.1.0 | moderate | transitive / full only | file-type | available within resolution |
| @xhmikosr/downloader 15.2.0 | moderate | transitive / full only | @xhmikosr/archive-type, file-type | @swc/cli@0.8.1 (breaking/range change) |
| adm-zip 0.5.16 | high | transitive / full only | GHSA-xcpc-8h2w-3j85, GHSA-vwc7-r8mq-g2x9, GHSA-7q85-xj36-vmfc, GHSA-rcw4-f5rp-g42v, GHSA-j5f4-cc29-5x44, GHSA-p634-w6r4-rjp2, GHSA-c6fg-446q-cg94, GHSA-8238-w5pm-2374 | @nx/react@23.3.0 (breaking/range change) |
| ajv 6.12.6, 8.12.0, 8.13.0, 8.17.1 | moderate | direct / full only | GHSA-2g4f-4pwh-qvx6 | available within resolution |
| argparse 1.0.10 | moderate | transitive / full only | sprintf-js | available within resolution |
| axios 1.12.1 | high | transitive / full only | GHSA-3p68-rc4w-qgx5, GHSA-w9j2-pvgh-6h63, GHSA-pmwg-cvhr-8vh7, GHSA-3w6x-2g7m-8v23, GHSA-xhjh-pmcv-23jw, GHSA-445q-vr5w-6q77, GHSA-m7pr-hjqh-92cm, GHSA-5c9x-8gcm-mpgx, GHSA-vf2m-468p-8v99, GHSA-pf86-5x62-jrwf, GHSA-6chq-wfr3-2hj9, GHSA-xx6v-rp6x-q39c, GHSA-43fc-jf86-j433, GHSA-q8qp-cvcw-x6jj, GHSA-fvcv-3m26-pcqx, GHSA-62hf-57xw-28j9, GHSA-hfxv-24rg-xrqf, GHSA-777c-7fjr-54vf, GHSA-p92q-9vqr-4j8v, GHSA-j5f8-grm9-p9fc, GHSA-3g43-6gmg-66jw, GHSA-35jp-ww65-95wh, GHSA-898c-q2cr-xwhg, GHSA-mmx7-hfxf-jppx, GHSA-pmv8-rq9r-6j72, GHSA-7q8q-rj6j-mhjq, GHSA-jqh4-m9w3-8hp9, GHSA-42h9-826w-cgv3, GHSA-vh66-26gq-q6x8, GHSA-9fr6-4gfg-395g, GHSA-j8rh-479h-cp32, GHSA-4hqw-qxg8-jxx2 | available within resolution |
| babel-jest 30.1.2 | high | transitive / full only | @jest/transform | available within resolution |
| baseline-browser-mapping 2.8.2 | moderate | transitive / full only | GHSA-w5vr-8v7q-w6rv | available within resolution |
| body-parser 1.20.3 | moderate | transitive / prod | GHSA-v422-hmwv-36x6, qs | available within resolution |
| brace-expansion 1.1.12, 2.0.2 | high | transitive / prod | GHSA-f886-m6hf-6m8v, GHSA-3jxr-9vmj-r5cp, GHSA-mh99-v99m-4gvg, GHSA-rgw5-rvv9-x895, GHSA-q2hr-2g5m-vwhr, GHSA-qhr7-859c-m2p7, GHSA-6j4f-fj2g-mc7p | available within resolution |
| braces 3.0.3 | high | transitive / full only | GHSA-vfj7-8cjw-p6xm | available within resolution |
| browserslist 4.26.0 | high | transitive / full only | GHSA-c83g-rgw3-j3cx, GHSA-73wf-gq98-2v4g | available within resolution |
| chokidar 3.6.0 | high | transitive / full only | braces | available within resolution |
| colord 2.9.3 | moderate | transitive / full only | GHSA-2wm5-q62r-hmrv | available within resolution |
| compression 1.8.1 | high | direct / prod | GHSA-vc2v-76pw-4v95 | available within resolution |
| copy-webpack-plugin 10.2.4 | high | transitive / full only | fast-glob, globby, serialize-javascript | available within resolution |
| css-minimizer-webpack-plugin 5.0.1 | moderate | transitive / full only | serialize-javascript | @nx/webpack@23.3.0 (breaking/range change) |
| expect 30.1.2 | high | transitive / full only | jest-message-util | available within resolution |
| express 4.21.2 | high | direct / prod | body-parser, path-to-regexp, qs | available within resolution |
| express-rate-limit 8.1.0 | high | direct / prod | GHSA-46wh-pxpv-q5gq, ip-address | available within resolution |
| fast-copy 3.0.2 | moderate | transitive / full only | GHSA-jggr-w7fw-pc2j | available within resolution |
| fast-glob 3.3.3 | high | transitive / full only | micromatch | available within resolution |
| fast-uri 3.1.0 | high | transitive / full only | GHSA-v2hh-gcrm-f6hx, GHSA-7p8r-x3mc-p8w7, GHSA-q3j6-qgpj-74h6, GHSA-v39h-62p7-jpjc, GHSA-f65p-4m7j-42xc, GHSA-jqff-g426-hqxp, GHSA-4c8g-83qw-93j6, GHSA-qw65-cvwx-89v3, GHSA-hrr3-gc8f-f4qj | available within resolution |
| fflate 0.8.2 | moderate | transitive / prod | GHSA-px8p-9vwx-vf98 | available within resolution |
| file-type 20.5.0, 21.0.0 | moderate | direct / prod | GHSA-5v7r-6r5c-r473, GHSA-j47w-4g3g-c36v | @swc/cli@0.8.1 (breaking/range change) |
| flatted 3.3.3 | high | transitive / full only | GHSA-25h7-pfq9-p65f, GHSA-rf6f-7fwh-wjgh | available within resolution |
| follow-redirects 1.15.11 | moderate | transitive / full only | GHSA-r4q5-vmmm-2653 | available within resolution |
| fork-ts-checker-webpack-plugin 7.2.13 | high | transitive / full only | chokidar | available within resolution |
| form-data 4.0.4 | high | transitive / full only | GHSA-hmw2-7cc7-3qxx | available within resolution |
| gaxios 6.7.1 | moderate | transitive / full only | uuid | available within resolution |
| glob 10.4.5 | high | transitive / prod | GHSA-5j98-mcp5-4vw2 | available within resolution |
| globby 12.2.0, 10.0.1 | high | transitive / full only | fast-glob | available within resolution |
| http-cache-semantics 4.2.0 | high | transitive / full only | GHSA-ch52-4w7c-c8xp | available within resolution |
| http-proxy-middleware 3.0.5, 2.0.9 | high | transitive / full only | GHSA-gcq2-9pq2-cxqm, GHSA-64mm-vxmg-q3vj, micromatch | available within resolution |
| immutable 5.1.3 | high | transitive / full only | GHSA-wf6x-7x77-mvgw, GHSA-xvcm-6775-5m9r, GHSA-v56q-mh7h-f735 | available within resolution |
| ip-address 10.0.1 | high | transitive / prod | GHSA-v2v4-37r5-5v8g, GHSA-mwp4-54f8-5fhr, GHSA-rpw4-54j3-4h4q, GHSA-j6r3-76f7-8jcv, GHSA-h3mg-xc3c-68pw | available within resolution |
| jest-circus 30.1.3 | high | transitive / full only | @jest/environment, @jest/expect, @jest/test-result, jest-message-util, jest-runtime, jest-snapshot | available within resolution |
| jest-config 30.1.3 | high | transitive / full only | @jest/test-sequencer, babel-jest, jest-circus, jest-environment-node, jest-resolve, jest-runner, micromatch | available within resolution |
| jest-environment-node 30.1.2 | high | transitive / full only | @jest/environment, @jest/fake-timers | available within resolution |
| jest-haste-map 30.1.0 | high | transitive / full only | micromatch | available within resolution |
| jest-message-util 30.1.0 | high | transitive / full only | micromatch | available within resolution |
| jest-resolve 30.1.3 | high | transitive / full only | jest-haste-map | available within resolution |
| jest-runner 30.1.3 | high | transitive / full only | @jest/console, @jest/environment, @jest/test-result, @jest/transform, jest-environment-node, jest-haste-map, jest-message-util, jest-resolve, jest-runtime, jest-watcher | available within resolution |
| jest-runtime 30.1.3 | high | transitive / full only | @jest/environment, @jest/fake-timers, @jest/globals, @jest/test-result, @jest/transform, jest-haste-map, jest-message-util, jest-resolve, jest-snapshot | available within resolution |
| jest-snapshot 30.1.2 | high | transitive / full only | @jest/transform, expect, jest-message-util | available within resolution |
| jest-watcher 30.1.3 | high | transitive / full only | @jest/test-result | available within resolution |
| js-yaml 4.1.0, 3.14.1 | high | transitive / full only | GHSA-mh29-5h37-fv8m, GHSA-h67p-54hq-rp68, GHSA-52cp-r559-cp3m, GHSA-5p4m-2wfm-xmqj, GHSA-2883-xcg3-v3hh, argparse | available within resolution |
| koa 3.0.1 | high | transitive / full only | GHSA-g8mr-fgfg-5qpc, GHSA-7gcc-r8m5-44qm | @nx/react@23.3.0 (breaking/range change) |
| launch-editor 2.11.1 | moderate | transitive / full only | GHSA-v6wh-96g9-6wx3 | available within resolution |
| lodash 4.17.21 | high | transitive / prod | GHSA-r5fr-rjxr-66jc, GHSA-f23m-r3pf-42rh, GHSA-xxjr-mmjv-4gpg | available within resolution |
| micromatch 4.0.8 | high | transitive / full only | braces | available within resolution |
| minimatch 3.1.2, 10.0.3, 5.1.6, 9.0.5, 9.0.3 | high | transitive / prod | GHSA-3ppc-4f35-3m26, GHSA-7r86-cg39-jmmj, GHSA-23c5-xmqv-rm74 | nx@23.3.0 (breaking/range change) |
| morgan 1.10.1 | moderate | transitive / prod | GHSA-4vj7-5mj6-jm8m, GHSA-jxfw-x594-9x9m, GHSA-9f6g-j8ch-79g4 | available within resolution |
| nanoid 3.3.11 | high | transitive / full only | GHSA-28wg-ghj8-5hjv, GHSA-2v37-7h3g-55p8, GHSA-xwg4-73v4-xw9w | available within resolution |
| node-forge 1.3.1 | high | transitive / full only | GHSA-554w-wpv2-vw27, GHSA-5gfm-wpxj-wjgq, GHSA-65ch-62r8-g69g, GHSA-2328-f5f3-gj25, GHSA-q67f-28xg-22rw, GHSA-5m6q-g25r-mvwx, GHSA-ppp5-5v6c-4jwp, GHSA-86w9-cpqp-85rv | available within resolution |
| nx 21.6.2 | high | direct / full only | GHSA-g2r8-wvmj-jf5w, GHSA-vp3h-ghgh-jr7g, GHSA-w2vw-w76x-qr89, GHSA-w3vv-58gj-gw77, GHSA-hrvq-x7jp-36xv, minimatch | nx@23.3.0 (breaking/range change) |
| path-to-regexp 0.1.12 | high | transitive / prod | GHSA-37ch-88jc-xwx2 | available within resolution |
| picomatch 2.3.1, 4.0.2, 4.0.3 | high | transitive / full only | GHSA-3v7f-55p6-f55p, GHSA-c2c7-rcm5-vvqj | @nx/js@23.3.0 (breaking/range change) |
| piscina 4.9.2 | critical | transitive / full only | GHSA-x9g3-xrwr-cwfg, GHSA-67c8-pqhq-4rmx | available within resolution |
| postcss 8.5.6 | high | direct / full only | GHSA-qx2v-qp2m-jg93, GHSA-6g55-p6wh-862q, GHSA-fxqj-rqcc-2cmp, GHSA-r28c-9q8g-f849 | available within resolution |
| postcss-selector-parser 7.1.0, 6.1.2 | moderate | transitive / full only | GHSA-w9m9-85wc-3x92, GHSA-rj75-hqrm-r3gf | available within resolution |
| protobufjs 7.5.4 | critical | transitive / full only | GHSA-xq3m-2v4x-88gg, GHSA-66ff-xgx4-vchm, GHSA-2pr8-phx7-x9h3, GHSA-fx83-v9x8-x52w, GHSA-75px-5xx7-5xc7, GHSA-jvwf-75h9-cwgg, GHSA-685m-2w69-288q, GHSA-q6x5-8v7m-xcrf, GHSA-jggg-4jg4-v7c6, GHSA-wcpc-wj8m-hjx6, GHSA-f38q-mgvj-vph7, GHSA-j3f2-48v5-ccww | available within resolution |
| proxy-addr 2.0.7 | critical | transitive / prod | GHSA-jqcg-44mw-7w3h | available within resolution |
| qs 6.13.0 | moderate | transitive / prod | GHSA-w7fw-mjwx-w883, GHSA-6rw7-vpxm-498p, GHSA-q8mj-m7cp-5q26, GHSA-4mjr-xmp4-gh2g | available within resolution |
| react-router 7.9.1 | high | direct / prod | GHSA-2w69-qvjg-hvjx, GHSA-9jcx-v3wj-wh4m, GHSA-49rj-9fvp-4h2h, GHSA-8646-j5j9-6r62, GHSA-8x6r-g9mw-2r78, GHSA-rxv8-25v2-qmq8, GHSA-h5cw-625j-3rxh, GHSA-wrjc-x8rr-h8h6, GHSA-337j-9hxr-rhxg, GHSA-chx6-hx7r-mcp5, GHSA-2j2x-hqr9-3h42, GHSA-f22v-gfqf-p8f3, GHSA-8v8x-cx79-35w7 | available within resolution |
| rollup 4.50.1 | high | transitive / full only | GHSA-mw96-cpmx-2vgc | available within resolution |
| rollup-plugin-copy 3.5.0 | high | transitive / full only | globby | available within resolution |
| serialize-javascript 6.0.2 | high | transitive / full only | GHSA-5c6j-r48x-rmvq, GHSA-qj8w-gfj5-8c6v | @nx/webpack@23.3.0 (breaking/range change) |
| sharp 0.34.4 | high | direct / prod | GHSA-f88m-g3jw-g9cj, GHSA-rgj7-g3m4-5g8c, GHSA-wq5f-xc86-pv6w | sharp@0.35.5 (breaking/range change) |
| shell-quote 1.8.3 | critical | transitive / full only | GHSA-w7jw-789q-3m8p, GHSA-395f-4hp3-45gv | available within resolution |
| sockjs 0.3.24 | moderate | transitive / full only | uuid | available within resolution |
| source-map-js 1.2.1 | high | transitive / full only | GHSA-68fv-2mgg-jv7q | available within resolution |
| sprintf-js 1.0.3 | moderate | transitive / full only | GHSA-hp3w-g68c-fv3c | available within resolution |
| svgo 2.8.0, 3.3.2 | high | transitive / full only | GHSA-xpqw-6gx7-v673, GHSA-2p49-hgcm-8545, GHSA-w27v-7q3p-w38r, GHSA-4vpr-x523-8j87 | available within resolution |
| tar 7.4.3 | critical | transitive / full only | GHSA-34x7-hfp2-rc4v, GHSA-8qq5-rm4j-mr97, GHSA-83g3-92jg-28cx, GHSA-qffp-2rhf-9h96, GHSA-9ppj-qmqm-q256, GHSA-r6q2-hw4h-h46w, GHSA-vmf3-w455-68vh, GHSA-w8wr-v893-vjvp, GHSA-23hp-3jrh-7fpw, GHSA-8x88-c5mf-7j5w, GHSA-gvwx-54wh-qm9j, GHSA-r292-9mhp-454m | available within resolution |
| terser-webpack-plugin 5.3.14 | moderate | transitive / full only | serialize-javascript | available within resolution |
| tinypool 1.1.1 | critical | transitive / full only | GHSA-5gmw-xhrv-c9v3, GHSA-85c8-ppgw-ccpr | available within resolution |
| tmp 0.2.5 | high | transitive / full only | GHSA-ph9p-34f9-6g65 | available within resolution |
| ts-loader 9.5.4 | high | transitive / full only | micromatch | available within resolution |
| typescript-eslint 8.45.0 | high | direct / full only | @typescript-eslint/eslint-plugin, @typescript-eslint/parser, @typescript-eslint/typescript-estree, @typescript-eslint/utils | available within resolution |
| uuid 9.0.1, 8.3.2 | moderate | transitive / full only | GHSA-w5hq-g745-h8pq | available within resolution |
| valibot 0.41.0 | high | transitive / full only | GHSA-vqpr-j7v3-hqw9, GHSA-5qjj-4xww-7phc | available within resolution |
| vite 7.1.7 | high | direct / full only | GHSA-93m4-6634-74q7, GHSA-4w7w-66w2-5vf9, GHSA-v2wj-q39q-566r, GHSA-p9ff-h696-f583, GHSA-v6wh-96g9-6wx3, GHSA-fx2h-pf6j-xcff | available within resolution |
| vitest 3.2.4 | critical | direct / full only | @vitest/mocker, @vitest/ui, GHSA-5xrq-8626-4rwp, GHSA-82fw-gwwq-j7x9, tinypool | available within resolution |
| webpack 5.101.3 | low | transitive / full only | GHSA-8fgc-7cc6-rx7x, GHSA-38r7-794h-5758 | available within resolution |
| webpack-dev-middleware 7.4.3 | high | transitive / full only | GHSA-g84c-rxfj-3j2c | available within resolution |
| webpack-dev-server 5.2.2 | high | transitive / full only | GHSA-79cf-xcqc-c78w, GHSA-mx8g-39q3-5c79, GHSA-f5vj-f2hx-8m93, GHSA-m28w-2pqf-7qgj, chokidar, sockjs | available within resolution |
| websocket-driver 0.7.4 | critical | transitive / full only | GHSA-mp7j-qc5w-4988, GHSA-xv26-6w52-cph6 | available within resolution |
| ws 8.18.3, 8.18.0 | high | transitive / full only | GHSA-58qx-3vcg-4xpx, GHSA-96hv-2xvq-fx4p | @nx/react@23.3.0 (breaking/range change) |
| yaml 1.10.2, 2.8.1 | moderate | transitive / full only | GHSA-48c2-rrv3-qjmp | available within resolution |
| yauzl 3.2.0 | moderate | transitive / full only | GHSA-gmq8-994r-jv83 | available within resolution |

Advisory IDs resolve at `https://github.com/advisories/<ID>`. Priority runtime references: [Router file sessions](https://github.com/advisories/GHSA-9583-h5hc-x8cw), [Router deserialization](https://github.com/advisories/GHSA-49rj-9fvp-4h2h), [file-type malformed input](https://github.com/advisories/GHSA-5v7r-6r5c-r473), [compression disconnect leak](https://github.com/advisories/GHSA-vc2v-76pw-4v95), [limiter mapped addresses](https://github.com/advisories/GHSA-46wh-pxpv-q5gq), [Sharp native codecs](https://github.com/advisories/GHSA-f88m-g3jw-g9cj). Review actual vulnerable API/options before assigning application exploitability.
