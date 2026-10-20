# Private self-host release candidate

## Candidate and audience

Candidate label: **private-self-host-rc1**. Runtime source commit:
`f491a3cf036af1ff702acf0172768e6a75309550` (PF-19). The root manifest
still has its development version `0.0.0` and the API workspace manifest
`0.0.1`; no package or remote release tag has been published.
This is an automation-verified candidate for a trusted operator running one
persistent API process. It is not a published release or a public-upload service.
[PF-20](plans/project-finalization.md) remains the public-host gate;
[PF-22](plans/project-finalization.md) tracks target-host, physical-device,
screen-reader, and maintainer-settings checks that were explicitly deferred.

## Release notes

- Conversion operations keep fixed manifests, independent file commits, FIFO
  scheduling, restart recovery, authenticated image/ZIP downloads, and expiry
  cleanup. A failed image does not discard successful siblings.
- Request parsing, proxy trust, rate limits, archive budgets, storage faults,
  metadata handling, SSR response headers, and private API cache rules received
  boundary regressions during finalization.
- Runtime and toolchain moved to Node 24, React Router 8, Express 5 in the API,
  Sharp 0.35, Nx 23, Vite 8, Vitest 5, and Playwright 1.64. The pruned API
  artifact has its own production dependency installation.
- The [self-host guide](self-host.md) and [screenshot gallery](screenshots/README.md)
  describe a native two-process setup and show real built-app states.

Known limits: browser reload does not resume a batch; session access expires
after the fixed TTL. HEIC/native decode has a pixel preflight and cooperative
timeout but no hard process isolation. The API binds all interfaces, so the host
must block direct access when a proxy is used. Multiple API processes must not
share one storage root. The measured 2 GiB API RAM recommendation is not an
absolute memory ceiling.

## Validated support matrix

| Component           | Candidate value                       | Scope                                                                                             |
| ------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Host                | Linux aarch64                         | Locally tested; other OS/CPU pairs require codec and filesystem validation                        |
| Candidate label     | private-self-host-rc1                 | Commit-addressed private candidate; no package publication                                        |
| Node / npm          | 24.22.0 / 11.19.1                     | Clean lockfile install and process runtime                                                        |
| Web / API           | React Router 8.4.0 / Express 5.3.0    | Same-origin SSR plus one API process                                                              |
| Image codec         | Sharp 0.35.5                          | Native conversion on the validated host                                                           |
| Browser test engine | Playwright 1.64.1                     | Chromium 156.0.8078.4 (revision 1248), Firefox 157.0 (revision 1555), WebKit 27.2 (revision 2370) |
| Build tools         | Nx 23.3.0 / Vite 8.3.4 / Vitest 5.0.5 | Build and validation only                                                                         |

Build with `VITE_API_URL` unset for same-origin `/api`; run the API and SSR with
`NODE_ENV=production` and `ENABLE_OTEL=false` unless telemetry is configured.
The [guide](self-host.md) lists exact build, production installs, process
commands, storage paths, readiness, and proxy rules. Record the intended host's
firewall, TLS, filesystem, and resource settings in PF-22 before claiming it
has been verified there.

## Recorded automated evidence (2026-10-20)

The candidate was rebuilt on Linux aarch64 from a clean `npm ci` install. With
the Nx cache disabled, the CI-equivalent target set passed across eight projects:
**505 unit/component tests**, **40 real API-process tests**, **81 mocked-browser
integration tests**, and **42 real-browser tests**. Both browser suites ran in
Chromium, Firefox, and WebKit with no unexpected failures or skips. This includes
decoded WebP, JPEG, PNG, and AVIF downloads, recovery, expiry, and partial
results. The first aggregate run also passed, but had 13 cached targets; the
uncached run is the candidate verdict. Browser lint emitted two existing test
warnings and API lint emitted two existing test warnings, with zero lint errors.

`api:prune` completed uncached and its production package audit found zero
vulnerabilities. A copied production-only root installation plus the separate
pruned API installation started successfully. The API returned `/readyz`, SSR
served `/conversion`, and a real production-only WebP conversion/download
remained available after API restart. The same source and pruned artifact were
used for that smoke check.

The API V8 coverage gate passed **309/309** tests and measured **92.17% lines,
85.86% branches** across 24 source files. Coverage includes source files that
unit tests do not import, including the process entry; it excludes test files,
generated output, declarations, and test setup. The measured critical-module
line/branch percentages and enforced minimums are:

| Module               | Measured lines / branches | Minimum lines / branches |
| -------------------- | ------------------------- | ------------------------ |
| Upload HTTP boundary | 94.44% / 73.91%           | 90% / 70%                |
| Authentication       | 96.15% / 95.45%           | 95% / 90%                |
| Conversion runtime   | 97.20% / 88.11%           | 95% / 85%                |
| Conversion storage   | 91.92% / 82.83%           | 90% / 80%                |
| Image processing     | 97.43% / 95.00%           | 95% / 90%                |

The dated registry audit reported **zero production findings**. The full
development graph had 18 moderate and 36 high affected entries, with zero
critical; all severe advisory IDs matched the 22 reviewed exceptions expiring
2026-11-17. These are developer-tool findings, not a clean full audit. The
clean install also reported deprecated `inflight`, `glob` 7/10,
`whatwg-encoding`, `node-domexception`, `uuid` 8, and ESLint 9 packages;
dependency update monitoring remains active. The use-case inventory remained
**97/97 covered**, and the audit-policy tests passed **2/2**.

The bounded production-API soak used an 8 × 8 PNG twice and a synthetic
4000 × 3000 PNG every third cycle, real uploads/conversions/image and ZIP
downloads, and forced expiry cleanup between cycles. On this Linux aarch64
host, a six-cycle run passed. A nine-cycle run tripped the existing 50 MiB
like-sized RSS growth guard: its large-image post-cleanup samples were
169884, 210292, and 229588 KiB. The twelve-cycle run reached **227372 KiB**
at its third large-image sample, then fell to **190500 KiB** on the next
cycle and ended at **192320 KiB** after a fourth large image; it passed the
guard. Every twelve-cycle sample had **21 file descriptors and zero retained
upload bytes** after expiry. Its slowest readiness probes were 6 ms during
conversion and 4 ms after expiry. The transient nine-cycle failure is retained
as evidence of allocator/native-cache variability; the later drop rejects a
simple monotonic-growth interpretation in this finite workload. These solid
synthetic images and the 2 GiB operator recommendation do not bound worst-case
codec memory use.

Artifact hashes from the candidate build:

| Artifact                       | SHA-256                                                            |
| ------------------------------ | ------------------------------------------------------------------ |
| Root `package-lock.json`       | `a0af215743e2e055873c01bc5500f2f868ea090af5213f643f4a91a8d49661ad` |
| Pruned API `package-lock.json` | `bf2fbff408f4b5e515831437348a10cf4d8d4cdefef66d68ad0a1e928372b15d` |
| API `main.js`                  | `d68870ea6bd6a687e37cab95ac416997c5d7b0e21285991524dd44ccae77120f` |
| SSR `server/index.js`          | `c3dd4acf58a525a8baafdc92e09f3bd4b9348f022aebaa47c58d9a3bd01e26d2` |

## Upgrade and rollback

1. Stop the sole API process with `SIGTERM` and wait for exit. Keep the proxy
   from sending new conversion requests while the process is stopped.
2. Make a private, consistent backup of both `UPLOAD_DIR` and `UPLOAD_TMP_DIR`
   and record the current source commit and lockfile. Preserve owner-only
   directory permissions. Do not expose session records or tokens in logs or
   support bundles.
3. Build the new commit, run the root and pruned-API production installs, then
   start exactly one API process against the persistent roots. Wait for
   `/readyz`, start SSR from the matching web build, and verify a conversion.
4. If rollback is needed, stop the new API before starting the old one.
   Restore the paired pre-upgrade storage snapshot and matching previous
   code/artifacts and lockfile, then check `/readyz` and a private conversion.
   Restoring a snapshot discards operations accepted after that snapshot;
   preserve the current roots separately for investigation before replacing
   them. Never run old and new API processes against the same root together.

Automatic startup recovery reconciles interrupted files, but it does not
replace a backup. Expired sessions are intentionally reclaimed, so the storage
root is not a long-term image archive.
