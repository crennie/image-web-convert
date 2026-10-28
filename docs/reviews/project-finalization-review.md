# Project finalization: independent technical review

Review date: **2026-10-28**. Reviewed checkout: **`1240eee`**. This is a
documentation-only, bounded first review; application code, dependencies, and
behavior were not modified. No earlier review file existed at this path.

## 1. Executive overview and release-readiness assessment

The repository records an **automation-verified private self-host release
candidate**, not a fully verified target-host installation or an anonymous
public upload service. That distinction is justified by the documented scope:
one persistent API process owns its storage, native image decoding remains
inside that process, and actual proxy/TLS, physical-device, and screen-reader
checks are deferred. This review corroborates substantial implementation work
but does **not independently reproduce the candidate's application test pass**.

The [finalization plan](../plans/project-finalization.md#status-and-continuation-contract)
marks 21 tasks done, counting PF-01A, and two deferred: PF-20 and PF-22.
“Done” has different meanings: PF-01 completed an assessment despite failing
checks; PF-02 completed a scoped remediation despite residual advisories;
PF-16 and PF-21 completed automated acceptance with manual checks deferred.
Those are documented qualifications, not interchangeable green release gates.

### Coverage and evidence rules

The plan uses ordered task IDs rather than named phases. This report groups
those IDs into explanatory workstreams without introducing new tracking phases.
The detailed first pass covers **PF-01, PF-01A, PF-02, PF-03, PF-04, and PF-05**.
All remaining tasks appear in the coverage table below; their records inform
release context, but they have not received an independent implementation review.
In particular, PF-08's extensive persistence changes need their own bounded pass.

Evidence is separated throughout:

- **Observed:** source, assertions, Git objects, configuration, hashes, and commands
  inspected or executed in this review.
- **Recorded:** dated outcomes in committed plans and release records. Their raw
  logs are unavailable here; these outcomes are not fresh test passes.
- **Inference:** an engineering consequence supported by inspected code, with its
  prerequisites and limits stated.

There are **13 explained register items**. Nine implemented change groups
(R02–R10) were checked against source and history; **zero application change
groups were freshly execution-verified**. Two independent validation commands
passed: the use-case inventory checker and the audit-policy unit tests (2/2).
The targeted application-test command could not start because `node_modules`
is absent. This is an environment limitation, not a test failure in application
behavior. No dependencies were installed and no registry/security refresh was
performed. External advisory contents and current affected-version ranges were
not independently revalidated; security-version claims below retain their
repository-recorded date and provenance.

### What materially changed

The baseline is unambiguous: `ec20ff482267d8fa2569fa85a7d1955a337ff806`
exists and is an ancestor of HEAD. Its lockfile hash matches the PF-01 record.
The comparison `ec20ff4..HEAD` spans 187 files, including a large lockfile and
formatting changes. The early implementation is grouped in `fdaccf4`, which
contains PF-01A through PF-06; there is no separate implementation commit for
each early task. Attribution uses that diff plus the task checkpoints, rather
than claiming finer commit granularity.

The reviewed changes make malformed requests terminate through a safe error
boundary, ensure configured parser limits actually apply, remove default trust
in forwarded client addresses, place general admission ahead of parsing, bound
ZIP work, and make download names safe for HTTP headers. Dependency updates and
bounded regression fixtures address exposed parser, codec, compression, SSR,
and limiter paths. Browser work fixes a real action-row alignment issue and
improves tooltip behavior while removing repeated disposable-server teardown
delays from the test harness.

Later records and manifest inspection show Node 24, Nx 23, Router 8, API
Express 5, Vite 8, Vitest 5, and updated production packaging. The plan also
records session reclamation, storage-fault handling, image/privacy checks,
observability, UI regression coverage, CI monitoring, and deployment guidance.
Those later implementations require the remaining review passes. Immutable
manifests, independent per-file commits, FIFO scheduling, bearer authorization,
and restart recovery **predate finalization**; the baseline and existing
[ADRs](../architecture/README.md) establish that they were preserved rather than
newly invented by this initiative.

### Release assessment

- **Private self-host candidate:** supported by the committed 2026-10-20
  [candidate record](../release-candidate.md), subject to its support matrix and
  deferrals. Independently verified application readiness remains incomplete.
- **Target host:** unverified. The actual Caddy recipe, TLS/firewall/cache policy,
  filesystem behavior, and operator workflow still need PF-22 execution.
- **Public anonymous hosting:** deferred and unsupported under the present release
  decision. PF-20 must be reopened before exposing untrusted uploads.
- **Security clearance:** no fresh audit verdict. PF-21 records zero production
  findings but 36 high and 18 moderate full-graph entries, with 22 dated severe
  advisory exceptions. Passing an exception policy is not a clean full audit.

The candidate's runtime source is `f491a3c`; current source directories and
lockfile have no changes relative to that commit. Later commits changed CI,
coverage configuration, scripts, and documentation. Thus the runtime attribution
is consistent, but the entire candidate validation configuration is not exactly
the tree of `f491a3c`. The current root lockfile SHA-256 matches the candidate
record. Compiled artifact hashes and the pruned lockfile were not independently
checked because those outputs are absent.

## 2. Findings and changes register

Priority describes the issue or decision's engineering importance, including
historical defects, rather than implying an unresolved exploit at HEAD.
**Implemented** means the change is confirmed in code; it does not imply a fresh
test pass. **Verified** is used for R01's repository provenance checks only.
Confidence applies to the described finding: confirmed source can coexist with
unverified execution or a probable advisory assessment. Impact describes the
implemented change, or the proposed follow-up for an open finding.

| ID / task                  | Finding or change                                                 | Category      | Nature                 | Status      | Priority | Evidence confidence | Change impact      | Explanation depth |
| -------------------------- | ----------------------------------------------------------------- | ------------- | ---------------------- | ----------- | -------- | ------------------- | ------------------ | ----------------- |
| R01 / PF-01                | Reproducible baseline and qualified security ledger               | Documentation | Preventive improvement | Verified    | Medium   | Confirmed           | Documentation-only | Standard          |
| R02 / PF-01A               | Disposable SSR teardown and measured suite budget                 | Testing       | Bug                    | Implemented | Medium   | Confirmed           | Internal-only      | Standard          |
| R03 / PF-01A               | Action alignment and focused tooltip behavior                     | Reliability   | Bug                    | Implemented | Medium   | Confirmed           | Behavior-changing  | Standard          |
| R04 / PF-02                | Patch exposed dependency families; retain explicit residuals      | Dependencies  | Vulnerability          | Implemented | High     | Probable            | Behavior-changing  | Deep              |
| R05 / PF-02, PF-12 handoff | Nx socket containment without disabling plugin isolation          | Tooling-CI    | Preventive improvement | Implemented | Medium   | Confirmed           | Internal-only      | Deep              |
| R06 / PF-03                | Correct Express error-handler registration and async failure flow | Reliability   | Bug                    | Implemented | High     | Confirmed           | Behavior-changing  | Deep              |
| R07 / PF-03                | One effective body-parsing policy and JSON-only commands          | Security      | Bug                    | Implemented | Medium   | Confirmed           | Breaking           | Standard          |
| R08 / PF-04                | Explicit proxy trust and admission before parsing                 | Security      | Vulnerability          | Implemented | High     | Confirmed           | Behavior-changing  | Deep              |
| R09 / PF-05                | ZIP request, concurrency, and streaming deadline budgets          | Reliability   | Preventive improvement | Implemented | Medium   | Confirmed           | Breaking           | Deep              |
| R10 / PF-05                | Safe Unicode download headers and bounded archive names           | Compatibility | Bug                    | Implemented | Medium   | Confirmed           | Behavior-changing  | Standard          |
| R11 / PF-05                | `archive_busy` is absent from the shared error schema             | Architecture  | Technical debt         | Discovered  | Low      | Confirmed           | Internal-only      | Standard          |
| R12 / cross-task           | Historical handoffs and evidence terminology need care            | Documentation | Documentation gap      | Discovered  | Low      | Confirmed           | Documentation-only | Standard          |
| R13 / PF-20, PF-22         | Public containment and hands-on verification remain gates         | Architecture  | Preventive improvement | Deferred    | High     | Confirmed           | Documentation-only | Deep              |

R04's version changes are confirmed; its vulnerability disposition is **Probable**
because the original audit inputs and upstream advisories were not rechecked.
R13's impact class describes the recorded scope/deferral decision; no public
containment implementation has been selected or verified. Proposed follow-ups
for R11/R12 below have not been approved or implemented by this review.

## 3. Detailed technical explanations by workstream and task

### Baseline and browser reliability — PF-01 and PF-01A

#### R01 — PF-01: a baseline is evidence, not a passing release

**What and background.** A baseline fixes the source and environment against
which later changes are compared. A security ledger adds a second distinction:
an advisory can match a package version without the application exposing the
vulnerable function or input. Conversely, a dependency labeled development-only
can still be imported by production code. Counting packages is insufficient
to decide either runtime safety or deployment completeness.

**Why here and discovery.** The [PF-01 checkpoint](../plans/project-finalization.md#pf-01-completion-checkpoint-2026-10-16)
records a documentation-only assessment. Git confirms that the initial plan
commits `a7dc90d` and `9ac5bc0` preceded the grouped implementation. Reading the
baseline lockfile directly from Git produces SHA-256
`2227a685a0ac1df237fb3d856584dc0bfdfa765cba5ae3bf6b2dddf3d2f978ca`, exactly the
recorded value. The historical suite had 427 unit/process tests and 27 real
browser tests reported passing, but mocked-browser integration had 43 passes,
one failure, and 22 unrun cases. Full and production-filtered audits failed.

**Impact and approach.** Without this separation, later dependency work could be
blamed for a pre-existing browser failure, or a completed assessment could be
mistaken for a clean security gate. Preserving failures with named owners was
appropriate. Rerunning every unchanged baseline target during a documentation
task would not necessarily add useful evidence; preserving machine-readable
summaries with the source revision would make that choice easier to audit later.

**Verification and limits.** This review verifies Git provenance, the baseline
hash, and the current inventory check: 97 mapped cases, all marked covered.
That checker validates references and consistency, not execution of 97 behaviors
or 100% code coverage. The historical raw discovery/PF-01 logs do not exist in
this checkout. Original execution results remain recorded evidence rather than
independently verified passes. No application implementation was part of PF-01.

#### R02 — PF-01A: remove measured fixture cost before adjusting deadlines

**What and background.** An end-to-end test's duration includes setup, browser
actions, and teardown. A global suite deadline can interrupt correct tests if
each fixture repeatedly waits for a server to stop. A later teardown-timeout
message does not, by itself, prove a second independent shutdown deadlock.

**Why here and discovery.** The [PF-01A handoff](../plans/pf-01a-handoff.md)
records 184.881 seconds spent in after-hooks for 44 completed tests. Focused
timing in the [closeout](../plans/project-finalization.md#pf-01a-closeout-2026-10-17)
attributed about 5.3 seconds per case to graceful SSR shutdown. The underlying
open handle was **not isolated**. The first WebKit case passed alone; the
aggregate timeout was not proof that WebKit functionality was broken.

**How and why this approach.** In `fdaccf4`, the application fixture changes
`web.stop()` to `web.stop(true)` for the disposable SSR process
([S06](#source-and-test-index)). Its test API process retains graceful shutdown,
which matters because API persistence and recovery are part of the product
contract. Immediate termination is appropriate for disposable test SSR state;
it would not establish production SSR shutdown correctness. Reusing one server
across tests could also reduce overhead, but changes test isolation. Investigating
the exact open handle remained a possible alternative, not a completed diagnosis.

The recorded contended runtime was 262.119 seconds for 66 cases. PF-01A then
raised only the integration suite deadline from 300 to 360 seconds, retaining
strict individual assertions and zero retries. This paired a measured cost
reduction with bounded headroom rather than disguising a known assertion failure.

**Verification and remaining considerations.** The closeout records 66/66
integration cases, 30/30 real browser cases, and a later standalone 66/66 run
in 215.039 seconds. It preserves preceding failed attempts and cache usage.
Source and diff confirm the harness change; none of those browser outcomes was
rerun here. Current configuration is **480 seconds**, changed by PF-13 commit
`88b369d` after a Playwright upgrade left seven cases unrun at 360 seconds.
The current CI script also serializes Nx targets. These are later changes with
their own recorded rationale, not evidence that PF-01A originally used 480 seconds.

#### R03 — PF-01A: distinguish a real layout defect from transient layout

**What and background.** Vertically centering controls of different heights
does not align their top edges. Browser layout can also change while fonts,
hydration, or dynamic content settle. A useful visual regression should assert
the intended relationship after it stabilizes, without widening its tolerance
until the symptom disappears.

**Why here and implementation.** The original ZIP/restart top-edge difference
was recorded as 3.140625 pixels against a less-than-two-pixel contract. The
diff changes the action row from `items-center` to `items-start` in
`ConversionOperationStatus`. The assertion now polls for settled bounding boxes
while keeping `<2`; the WebKit test selects through the visible chooser after
hydration. Separately, `StatusHelp` retains help while its trigger has keyboard
focus and repositions on scroll/resize rather than dismissing focused help
([S06](#source-and-test-index)). These include actual product changes, not only
test repairs.

**Impact and tradeoffs.** Misaligned controls are a usability defect rather than
a security problem. Dismissing a focused tooltip can remove information while
a keyboard user is interacting with it. Top alignment directly implements the
tested layout contract; using a larger pixel tolerance would not. Polling is
appropriate for an eventual layout condition, but could miss a short-lived
visual jump, so it is not a substitute for visual inspection. Accessible
behavior also cannot be established solely by a DOM shim.

**Verification and remaining considerations.** The record includes a screenshot
inspection, focused cross-browser checks, five repeated Chromium cases, and
the eventual full PF-01A pass. The screenshot/raw reports are not present here.
The current test still has the strict assertion and current source retains the
layout fix. Later PF-16 tooltip and accessibility work is only context in this
pass; actual assistive-technology acceptance remains PF-22.

### Exposed dependencies and tooling — PF-02

#### R04 — PF-02: security upgrades require call-path and compatibility evidence

**What and background.** A dependency advisory describes an affected version
and an exploit prerequisite. An application is exposed only if its execution
and input paths satisfy those prerequisites. Server-side rendering (SSR)
means the Router server processes HTTP requests and emits HTML; absence of
application loaders does not remove the framework's request handling. Cross-site
scripting (XSS) would require attacker-controlled content to become executable
browser content. Cross-site request forgery (CSRF) relies on requests acquiring
authority the victim's browser sends automatically. Here, explicit bearer headers
are a different boundary from cookie-authenticated Router actions. No working
XSS or CSRF exploit is established by this review.

Resource attacks need similar care. A decompression bomb is small compressed
input that expands into excessive work or memory. Even a format sniffer can
parse compressed structures before rejecting a non-image. A JavaScript heap cap
does not bound native allocations or total process resident memory. Updating a
codec can remove known vulnerable code without imposing a hard resource ceiling.

**Why here and discovery.** The plan's [reachability ledger](../plans/project-finalization.md#runtime-advisory-reachability-ledger)
identifies mounted compression middleware, default limiter identity handling,
`fileTypeFromFile` before MIME rejection, native Sharp processing, SSR request
paths, and optional telemetry imports. These are more meaningful evidence than
the package counts alone. Archive downloads use explicit file entries rather
than attacker-controlled glob patterns; the ledger therefore distinguishes
pattern/CLI advisories from actual archive usage. These are recorded source
assessments, not reproduced exploits or permanent exemptions.

**Observed version changes.** These values were independently read from Git
lockfiles; `fdaccf4` represents the early grouped checkpoint, not an isolated
PF-02 commit.

| Family                | Baseline `ec20ff4` | Early checkpoint `fdaccf4` | Reviewed HEAD                                           |
| --------------------- | ------------------ | -------------------------- | ------------------------------------------------------- |
| React Router          | 7.9.1              | 7.18.4                     | 8.4.0                                                   |
| Express               | 4.21.2             | 4.22.3                     | API/observability/SSR nested 5.3.0; root tooling 4.22.3 |
| compression           | 1.8.1              | 1.8.2                      | 1.8.2                                                   |
| express-rate-limit    | 8.1.0              | 8.7.1                      | 8.7.1                                                   |
| Application file-type | 21.0.0             | 21.3.4                     | 21.3.4                                                  |
| Sharp                 | 0.34.4             | 0.35.5                     | 0.35.5                                                  |
| OTel Node SDK         | 0.203.0            | 0.223.0                    | 0.223.0                                                 |
| Nx                    | 21.6.2             | 21.6.2, contained          | 23.3.0                                                  |
| Archiver              | 7.0.1              | 7.0.1                      | 8.0.0                                                   |

**How and why this approach.** PF-02 updated compatible exposed families first,
leaving Router 8, Express 5, and Nx migration to later tasks. Semantic versioning
uses a major version to signal ordinary incompatible changes, but a `0.x`
package is not a stable-major compatibility promise. Sharp's 0.34-to-0.35
transition therefore warranted real codec checks, not just accepting a version
number as a harmless patch. The plan reports no blanket forced overrides.

The OTel migration illustrates a less obvious behavior change: the record says
the newer SDK enables metrics export by default. The actual PF-02 diff supplies
`metricReaders: []` when no metrics exporter is selected, preserving the previous
opt-in behavior. Leaving SDK defaults unchecked could introduce collector
connections even if trace behavior still worked. Current instrumentation retains
that choice. Telemetry ownership/redaction and complete lifecycle review belong
to PF-10/PF-14, not this patch group's acceptance.

**Verification.** Inspected `dependency-security.spec.ts` contains small malformed
ASF and ZIP fixtures in a child process with a five-second kill deadline,
128 MiB JS heap setting, and 64 KiB output cap. The misleading ZIP fixture
expands to a bounded 2 MiB. It also inspects real gzip destruction after client
disconnect and verifies a shared limiter budget for equivalent IPv4/mapped-IPv6
spellings. These test designs address relevant mechanisms; this review could
not execute them. Production SSR regressions and real codec/process tests are
present and historical results are recorded, but test existence is not a pass.

**Outcomes and remaining risk.** PF-02 reports 432 unit/process tests, 30 real
browser tests, four dependency regressions, and a local-collector telemetry test
passing. Mocked integration still timed out; PF-01A later owned that result.
The production audit still failed with one high Lodash entry, and the full audit
with 131 entries. The recorded acceptance was absence of an identified reachable
high/critical runtime path, including specific unused Lodash methods, not zero
advisories. Later PF-14/PF-21 records say production findings reached zero;
the current dependency declarations support the ownership changes, but there
is no fresh audit or production-only install proof in this review.

A root `--omit=dev` audit alone cannot prove the separately packaged API's
closure. Review both artifacts after installation, keep a dated owner for
exceptions, and re-evaluate reachability if call sites or deployment change.
No claim is made that a patched native library is safe for arbitrary public
inputs. PF-07/PF-20 cover the separate resource/isolation decision.

#### R05 — PF-02: preserve isolation when containing Nx sockets

**What and background.** Local worker sockets are inter-process communication
endpoints. Other accounts on a shared host may be relevant attackers even when
no internet service is listening. Filesystem ownership can constrain access to
such endpoints. Separately, plugin process isolation prevents one plugin's
process-global changes from affecting another build task.

**Why here and discovery.** The plan records no fixed Nx 21 release for the
local socket advisory. Disabling the daemon alone did not cover isolated plugin
workers. An initial workaround also disabled plugin isolation; the record says
that polluted the build environment and emitted development JSX in a production
UI artifact. That failed approach is historical evidence, not current behavior.

**Implementation and tradeoffs.** `tools/nx.mjs` creates a fresh repository-local
temporary socket directory, sets `NX_SOCKET_DIR`, forces the daemon off and
plugin isolation on, and removes its directory on normal exit. The launcher is
used by npm scripts and included in Nx shared cache inputs
([S07](#source-and-test-index)). Including it in cache inputs matters because a
build-policy change must invalidate artifacts built under the previous policy.
Owner-only sockets narrow the local-account boundary without sharing plugin
environment state. They do not protect against a compromised same-user process.

**Verification and remaining considerations.** The dependency test deliberately
inherits `NX_DAEMON=true`, invokes the launcher, and asserts effective settings
and directory mode `0700`. It is inspected but not rerun. The wrapper is still
present after the Nx 23 migration. This does not establish an unfixed Nx 23
vulnerability; it is retained local containment and build policy. Raw Nx commands
bypass it, and normal-exit cleanup does not guarantee removal after a hard kill.
PF-12 owns whether retaining the wrapper is still useful. The cost of retaining
it should be weighed against the original request to revisit the workaround,
not automatically treated as a release blocker.

### Request boundary and deployment identity — PF-03 and PF-04

#### R06 — PF-03: Express's error boundary is an executable protocol

**What and background.** Middleware registration and function arity determine
how Express dispatches errors. An error middleware needs four parameters:
`(err, req, res, next)`. A function that *returns* that middleware must be
called when registered. Async rejection forwarding is another boundary: under
Express 4, an async handler cannot assume rejected promises enter the error
chain automatically. Once response headers or body bytes have been sent, a
server cannot replace the response with a new JSON status and body.

**Why here and root cause.** The baseline registered
`app.use(errorTranslator)` although `errorTranslator` was a factory; its returned
function also omitted the fourth parameter. Both defects are visible in
`git diff ec20ff4 fdaccf4`. Legacy file handlers had async failure paths without
explicit rejection forwarding. This is a confirmed source defect in error
routing, not proof that every malformed request hung or leaked data.

**Implementation.** The application now mounts `errorTranslator()` and the
returned handler has four arguments. It ignores destroyed responses, delegates
already-started responses to the downstream error path, and maps parser errors
to safe 400/413/415 JSON or a generic 500. Error bodies use fixed messages rather
than copying arbitrary exception text. PF-03 also added legacy async forwarding
and `sendFile` callbacks; PF-08 later removed those legacy controllers. Current
operation downloads await `sendFile` completion and use their conversion error
wrapper. Do not cite deleted legacy files as current implementation.

**Impact and approach.** The immediate benefit is reliable failure completion
and safe error content. Merely upgrading Express would not fix registering a
factory incorrectly or writing JSON after headers. Keeping the established
conversion error shape avoided an unnecessary API-wide error-envelope migration.
That leaves intentional multiple shapes: parser errors use `{error:{code,
message}}`, while conversion/domain errors use `{type,message}`. A single shared
envelope could simplify clients later but is a separate compatibility decision.

**Verification and limits.** [S01](#source-and-test-index) tests actual local HTTP
parsing, safe rejection bodies, pre/post-header failures, and logging enabled
and disabled. Some storage and stream failures are injected, so this is not
equivalent to a real filesystem failing in each tested way. The closeout reports
6/6 focused tests, 213/213 API tests, and 25/25 API-process tests; the final status
mapping had a focused rerun after the full suite. Current tests have since grown
and changed. None were run successfully here. Express 5 now forwards unhandled
async rejections, but correct registration and stream ownership remain necessary.

#### R07 — PF-03: enforce the parser policy that configuration promises

**What and background.** Body parsers consume the request stream. Registering a
second parser with stricter settings generally cannot undo the first parser's
interpretation. URL-encoded `extended` parsing supports nested structures;
simple parsing avoids that complexity. Media-type validation answers whether
a command accepts the representation at all, while byte limits bound parser
work. These are separate controls.

**Why here and root cause.** The baseline had an early
`express.urlencoded({ extended: true })` before the later configured simple
parser. Thus the early parser could determine behavior before the intended
`BODY_LIMIT_URLENCODED` policy applied. The plan's closeout calls that parser
“unlimited”; the source only establishes that it lacked an explicit application
limit and used framework defaults. **No unlimited parser is demonstrated.**

**Implementation and tradeoffs.** PF-03 removes the earlier parser, uses one
configured JSON parser and one `extended:false` form parser, and validates limit
strings as positive safely representable byte counts. `requireJson` protects
operation creation and ZIP commands. Nested/duplicate forms are rejected by
media type, rather than trying to repair them into a JSON command. Removing the
form parser entirely was an alternative mentioned in discovery; it was not the
implemented choice. HPP removal belongs to PF-14 and should not be attributed
to PF-03.

**Impact.** Incorrect settings now fail startup rather than silently undermining
the intended policy. Non-JSON clients to the protected commands receive 415;
this is a contract tightening and is classified Breaking for such clients,
although the existing browser sends JSON. Defaults remain 2 MiB for both body
parsers. These limits do not replace multipart upload and decoded-image limits.

**Verification and remaining considerations.** Current boundary assertions cover
malformed JSON, tiny configured limits, absent/wrong command media types,
nested/duplicate form requests, and invalid configuration. Historical results
are recorded under PF-03, not independently reproduced. The tests show the
command rejection, not a broad security guarantee about every form parser
feature. Keeping parser errors distinguishable from domain errors remains an
intentional compatibility detail for API consumers.

#### R08 — PF-04: proxy trust decides who controls the rate-limit key

**What and background.** A reverse proxy can forward the real client's address
in `X-Forwarded-For`. That header is ordinary client-controlled input unless the
application knows which network peers may supply it. Rate limiting by a forged
address lets a caller evade per-client budgets. IPv4-mapped IPv6 spellings must
also identify the same address rather than create fresh budgets. CORS only
controls browser cross-origin access; it is not authentication or a restriction
on arbitrary HTTP clients.

**Why here and root cause.** The baseline unconditionally trusted one proxy hop
while the API could be reached directly. With that topology, a direct caller
could influence the identity used by limiters. The source/configuration defect
is confirmed; whether it was exploitable on an actual private installation
depends on its network reachability. Public/LAN exposure raises its importance.

**Implementation.** Trust is now off by default. `TRUSTED_PROXY_IPS` accepts
explicit comma-separated IP literals and rejects malformed values at startup.
Express walks the forwarded chain to the nearest untrusted address under that
policy. General limiting runs after CORS but before body parsing/compression.
Defaults remain 100 general requests/minute/IP and three session creations per
minute/IP; session creation also consumes general capacity. Status polling has
its separate 240/minute/IP budget and is excluded from the general limiter.
Health/readiness bypass that general budget. See [S02](#source-and-test-index).

**Why this approach and impact.** Default-off trust makes direct deployment
safe from this particular forwarded-identity bypass. An explicit peer list is
easier to reason about than an assumed hop count when direct and proxied paths
coexist. The tradeoff is operational: without opt-in, clients behind a proxy
share its apparent IP budget. The proxy must append/replace the actual client
address, and untrusted clients must not be able to originate from a trusted peer
address. Multiple processes would have independent budgets, consistent with
the current single-owner architecture but unsuitable as a distributed quota.

**Verification and residuals.** Ten inspected admission cases cover default
trust, forwarded chains, equivalent IP forms, limiter exhaustion, CORS retry
headers, and invalid settings. The before-parsing test sends malformed JSON
after exhaustion and expects 429, establishing ordering instead of just reading
middleware positions. The configured-proxy test uses a loopback client to
simulate the trusted peer; it is not an actual deployed proxy test. Duplicate
forwarded header lines returning 400 is a recorded runtime-specific observation.
PF-04 reports 223/223 API and 25/25 process tests. Real ingress/TLS/firewall
proof remains PF-22, and these application budgets do not make public hosting
approved.

### Download resource and compatibility boundaries — PF-05

#### R09 — PF-05: bound archive amplification and make stream ownership explicit

**What and background.** A bounded JSON body can still request disproportionately
large work: repeatedly naming one file causes repeated reads and archive entries.
Concurrent compression and slow receivers add CPU, memory, and retention cost.
A lease prevents expiry cleanup from deleting files while a response uses them;
without transfer limits, the same protection can extend retention for too long.
A stream has two different success boundaries: archive generation completes and
the writable response finishes. Completing one does not prove the other.

**Why here and discovery.** The baseline ZIP schema only required nonempty IDs
and a nonempty list. The resolver iterates supplied IDs in order. The historical
finding therefore has a concrete amplification mechanism without requiring a
demonstrated production denial of service. Basic stream cleanup, independent
commits, leases, collision handling, and level-9 compression already existed.
They must not all be attributed to PF-05.

**Implementation.** The shared schema now accepts 1–32 distinct safe IDs of at
most 128 characters and an optional archive name of at most 128 characters.
The route validates this before resolving member metadata, then acquires one of
two process-local archive slots. Saturation returns 503 `archive_busy`.
`writeZip` starts a 30-second timer; failure unpipes, aborts, and destroys the
archive, clears listeners/timer, and rejects to the HTTP owner. The route releases
its slot in `finally`; request leases release on response finish/close. Success
waits for both finalization and output finish. The timeout is new; much of that
stream state machine predates finalization ([S03](#source-and-test-index)).

**Why this approach and tradeoffs.** Early rejection prevents repeated disk
work, and immediate admission failure avoids an unbounded archive queue. Duplicate
IDs are rejected rather than silently deduplicated, making the request contract
explicit at the cost of compatibility for clients relying on duplicates. A fixed
transfer deadline limits long-running archives but can interrupt legitimate slow
downloads. Compression remains level 9 because the checkpoint had no measurement
justifying a change; this review does not invent a performance decision to use
store-only ZIPs or add a dependency. Archiver 8 is a later PF-14 migration.

**Verification and gaps.** Unit assertions cover slot idempotence, a fake-timer
deadline, abort/finalization races, cleanup, and names; the archive constructor
is mocked in that unit file. Real HTTP/process assertions cover malformed ZIP
requests, decoded archive order/content, missing members, and actual archiver
missing-source warnings. PF-05 records 227/227 API, 26/26 process, and 10/10
schema tests. The saturation HTTP test mocks slot exhaustion; it is not a
measured production test with three simultaneous slow receivers. This review
found no equivalent real-network saturation/deadline result in the inspected
evidence. A test existing for one layer does not establish every integrated
acceptance scenario.

**Remaining limits.** The 30-second clock starts inside `writeZip`, **after**
member resolution; it is not a complete request deadline. Single-image
`sendFile` responses do not use the archive slots or archive timer. No separate
aggregate ZIP output-byte ceiling is implemented in this slice. Member count,
conversion limits, concurrency, and transfer time provide narrower bounds.
These are source-observed limitations, not demonstrated exhaustion exploits.
Explicitly include individual slow downloads, pre-stream delays, and real
concurrent streams in the next resource/public-host review before claiming all
download work has a hard bound.

#### R10 — PF-05: a display filename is not automatically a valid HTTP header

**What and background.** `Content-Disposition` offers a download filename.
Its quoted fallback must be safe for the HTTP header representation, while
`filename*` carries an encoded UTF-8 name for clients supporting that form.
Control characters, path separators, or an unpaired Unicode surrogate can break
header construction or encoding. A name inside a ZIP must also be a portable
entry name rather than a path supplied by the user.

**Why here and implementation.** The baseline already emitted **both** `filename`
and `filename*`; PF-05 did not introduce the extended parameter. It supplied
arbitrary Unicode in the fallback and did not consistently remove control
characters. The new sanitizer replaces controls, format characters, lone
surrogates, and path/unsafe punctuation; removes leading dots and trailing
dots/spaces; bounds by Unicode code points; and supplies a fallback for an empty
name. The header uses printable ASCII with replacements for the fallback and
percent-encoded UTF-8 for the extended name. For example, the test expects
`My_Bundle _.zip` alongside `My_Bundle%20%C3%A9.zip` for `My*Bundle é`.

**Impact and tradeoffs.** The confirmed concern is robust naming and failed
downloads, not established HTTP response splitting: runtime header validation
may reject illegal characters instead of transmitting them. Replacing every
Unicode character would be simpler but lose useful names; separate fallback
and encoded forms preserve both compatibility and legibility. Existing
collision handling reserves original names before creating suffixes so a
generated `a (2)` cannot steal another file's original name.

**Verification and remaining considerations.** Inspected tests include CR/LF,
NUL, backslash/traversal-style text, emoji, accented text, and collisions. Many
assertions exercise generated strings with mocked metadata, while process ZIP
tests inspect actual archive members. That mix is useful but does not prove
every extraction client or filesystem's naming semantics. No Windows/macOS
portability claim is added. Existing collision logic is preserved, and no
filename library was added by PF-05. Execution results remain historical here.

#### R11 — PF-05 follow-up discovered in this review: error contract drift

**What and background.** A shared discriminated union defines the allowed `type`
values of an API error. If an endpoint emits an omitted value, consumers using
that schema reject a legitimate server response. Tests that iterate a hand-written
subset of error names can pass without proving endpoint/schema agreement.

**Why here and impact.** The archive route returns
`{type:'archive_busy', message:'Too many active archive downloads'}` at
`conversion-files.routes.ts:134`, and the boundary test explicitly expects it.
`ApiErrorSchema` at `apiError.ts:64` has no `archive_busy` member. The schema test
named “parses every currently shared API error” only enumerates a subset of
variants. This is confirmed contract drift introduced with the saturation
response, not a confirmed browser failure. The current frontend's `request`
uses HTTP status and `Retry-After`, not `ApiErrorSchema`; its controller displays
a generic retry message for failed downloads. That limits immediate impact.

**Proposed approach, not implementation.** Add an explicitly typed archive-busy
variant if the shared schema is intended to cover current domain errors, and
add a response/schema agreement assertion for the route. Alternatively, clearly
scope the shared union and document this response separately. Reusing a generic
capacity error would avoid a new variant but remove archive-specific meaning.
No fix was made, no approval is inferred, and no runtime schema rejection was
executed because dependencies are absent. This is a low-priority contract
maintenance follow-up rather than a security blocker.

### Evidence continuity and release gates — cross-task context

#### R12 — reconcile historical checkpoints without erasing their failures

**What and why it matters.** Handoffs record a point in time; treating them as
current instructions can undo completed work or duplicate investigation.
The PF-02 handoff still says implementation is uncommitted and PF-03 is next.
Git shows it subsequently landed in `fdaccf4`. The PF-01A handoff explicitly
preserves a pre-fix diagnosis, while its opening also retains a now-historical
uncommitted-work statement. These are provenance issues, not missing fixes.

**Observed discrepancies and interpretation.** The plan's “Current-state
inventory” is the discovery snapshot, including Node 22/Router 7/Express 4.
Current manifests are different. PF-03's “unlimited” parser wording overstates
the source evidence. PF-01A's 360-second deadline is correctly historical; the
current 480-second deadline has a later PF-13 checkpoint. PF-02's failed audit
must remain a failed audit despite later production cleanup. `archive_busy`
contract drift and the PF-05 integrated slow-stream evidence gap are substantive
remaining items, rather than merely stale narrative.

**Proposed documentation treatment and verification.** Add a short dated
historical/superseded banner to handoffs and relabel the discovery inventory;
preserve original failures, timings, and reasoning. This report provides those
corrections without modifying the original plan or handoffs. Future candidate
records would benefit from small durable machine-readable result summaries
keyed to source/configuration hashes; these should exclude tokens and private
request bodies. Missing raw logs do not invalidate committed summaries, but
they prevent independently checking details such as skips, retries, and timing.

#### R13 — PF-20/PF-22: deferral is a deployment boundary, not hidden completion

**Background and consequence.** A compressed image can expand to a very large
pixel buffer and multiple codec intermediates. Memory exhaustion and event-loop
blocking can occur even when the upload's compressed byte count is small. A
cooperative timeout checks or requests cancellation when execution can respond;
it is not a hard mechanism for killing a stuck native decoder. A worker process
could provide a stronger termination boundary at the cost of supervision,
communication, and recovery complexity. Restricting accepted formats is another
possible approach only if the actual allowed path is measured and enforced.

**Why here and recorded decision.** The plan records a reduction from 200 MP to
20 MP, HEIC preflight, and measured fixture memory under PF-07, but retains
in-process native decoding. Those mitigations are not independently reviewed
in this pass. The candidate recommends reserving 2 GiB for the API; neither that
recommendation nor a finite soak is a hard memory limit. The PF-21 record retains
a nine-cycle RSS-guard failure and a later twelve-cycle pass with declining RSS.
That does not prove a leak, nor does it prove all workloads are bounded.

**Why defer and what remains proposed.** Trusted private self-hosting is an
explicitly accepted scope with lower exposure than arbitrary anonymous input.
Adding accounts, a distributed queue, or a database is not automatically required.
PF-20 leaves public containment and abuse policy to a separate decision before
exposure. No public-worker architecture is approved or implemented here. PF-22
defers actual host/proxy and physical-device/screen-reader verification at the
maintainer's request, with a 2026-11-17 review date or earlier target deployment.
The checklist is preparation, not an executed test record.

**Verification limits.** This review confirms the documented gates and the
pending checklist, not their technical acceptance. Same-origin proxy fixtures
and emulated touch are narrower than real ingress and physical accessibility
checks. `SECURITY.md` accurately states that no private reporting channel is
configured; it does not prove any remote repository setting. Reopen PF-20 before
public uploads, execute PF-22 before claiming the actual host verified, and keep
the candidate label qualified until then.

### Remaining coverage by existing task ID

“Recorded done” in this table is the plan's status, not an independent acceptance
verdict. Links lead to the original task and acceptance criteria.

| Task                                                                                                                                 | Objective and recorded outcome                                                                        | This review's coverage / next required review                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [PF-01](../plans/project-finalization.md#pf-01--reproducible-baseline-and-security-ledger-p0-done)                                   | Baseline and advisory reachability; done with failures preserved                                      | Detailed R01; provenance verified, historical execution not reproduced                        |
| [PF-01A](../plans/project-finalization.md#pf-01a--resolve-the-existing-browser-validation-failure-p1-done)                           | Restore complete browser validation; recorded done                                                    | Detailed R02/R03; implementation inspected, browser rerun outstanding                         |
| [PF-02](../plans/project-finalization.md#pf-02--patch-exposed-dependency-vulnerabilities-p0-done)                                    | Patch exposed families; recorded done with audit residuals                                            | Detailed R04/R05; lockfile changes checked, fresh audit/runtime checks outstanding            |
| [PF-03](../plans/project-finalization.md#pf-03--repair-error-boundary-and-request-parsing-p0-done)                                   | Repair error/parser contracts; recorded done                                                          | Detailed R06/R07; source/assertions checked, execution blocked                                |
| [PF-04](../plans/project-finalization.md#pf-04--explicit-proxy-and-admission-policy-p0-for-publiclan-exposure-p1-local-done)         | Explicit identity trust and admission; recorded done                                                  | Detailed R08; source/assertions checked, actual proxy not verified                            |
| [PF-05](../plans/project-finalization.md#pf-05--bound-and-sanitize-downloads-p1-done)                                                | Bound ZIP work and sanitize names; recorded done                                                      | Detailed R09–R11; contract drift and integrated slow-stream gap retained                      |
| [PF-06](../plans/project-finalization.md#pf-06--reclaim-all-expired-sessions-safely-p1-done)                                         | Reclaim create-only/legacy expiry, retain invalid records for operator action; recorded done          | Not independently reviewed; check races, leases, and retained-corruption policy               |
| [PF-07](../plans/project-finalization.md#pf-07--image-resource-and-privacy-regression-matrix-p1-hard-isolation-public-decision-done) | HEIC preflight, 20 MP default, real image/privacy matrix; recorded done for self-host                 | Not independently reviewed; inspect fixtures, metadata/color semantics, and memory method     |
| [PF-08](../plans/project-finalization.md#pf-08--validate-persistence-and-contain-filesystem-access-p1-done)                          | Record validation, private modes, storage fault classification, legacy read retirement; recorded done | Not independently reviewed; prioritize full persistence/recovery and compatibility review     |
| [PF-09](../plans/project-finalization.md#pf-09--protect-ssr-and-private-responses-p1-done)                                           | SSR headers, safe error UI, private cache policy, local fonts; recorded done                          | Incidental API middleware observation only; review CSP, range/conditional auth, and built SSR |
| [PF-10](../plans/project-finalization.md#pf-10--make-optional-observability-correct-and-testable-p1-done)                            | Configuration, request IDs, privacy, SDK/shutdown behavior; recorded done                             | Only PF-02 metrics compatibility inspected; review config/redaction/lifecycle separately      |
| [PF-11](../plans/project-finalization.md#pf-11--align-supported-nodenpm-runtime-p1-done)                                             | Node 24 and environment alignment; recorded done                                                      | Current Node/npm and manifests observed; platform/native validation not reproduced            |
| [PF-12](../plans/project-finalization.md#pf-12--migrate-nx-in-supported-steps-p1-done)                                               | Nx 21→22→23 migration; recorded done                                                                  | Nx version/wrapper observed; inspect migration graph, cache and generated artifacts           |
| [PF-13](../plans/project-finalization.md#pf-13--modernize-compatible-frontendtestlint-tools-p1-done)                                 | Coordinated frontend/test/lint migrations and ceilings; recorded done                                 | Version and browser-timeout context only; migration correctness not reviewed                  |
| [PF-14](../plans/project-finalization.md#pf-14--express-5-and-deployable-dependency-closure-p1-done)                                 | Express 5, Archiver 8, runtime ownership, isolated production installs; recorded done                 | Current API declarations and prior-path replacement observed; closure proof not reproduced    |
| [PF-15](../plans/project-finalization.md#pf-15--reliability-and-resource-soak-p1-done)                                               | Bounded resource cycles and client cleanup; recorded done                                             | Candidate outcome read; review guard changes, sample methodology, and faults separately       |
| [PF-16](../plans/project-finalization.md#pf-16--close-automated-browseraccessibility-regression-gaps-p1-done)                        | Automated navigation/focus/motion/download regressions; recorded done                                 | Later tooltip context only; full assertions/browser runs not independently reviewed           |
| [PF-17](../plans/project-finalization.md#pf-17--cisecurity-monitoring-and-hygiene-p1-done)                                           | Scheduled audits, exceptions, updates, CI/format hygiene; recorded done                               | Audit-policy tests 2/2 observed; no fresh audit, hosted CI, or full workflow review           |
| [PF-18](../plans/project-finalization.md#pf-18--remove-proven-obsolete-code-and-documentation-overlap-p2-done)                       | Remove unused UI/dependencies, canonicalize architecture docs; recorded done                          | History/doc context only; consumer/deletion safety not independently reviewed                 |
| [PF-19](../plans/project-finalization.md#pf-19--reproducible-self-host-guide-and-genuine-screenshots-p1-done)                        | Native deployment guide and real screenshot capture; recorded done                                    | Guide and screenshot provenance record read; operator recipe/capture not rerun                |
| [PF-20](../plans/project-finalization.md#pf-20--public-host-readiness-decision-and-gate-public-deferred)                             | Decide/enforce public-host model                                                                      | Deferred; R13 explains decision, no public implementation or acceptance claimed               |
| [PF-21](../plans/project-finalization.md#pf-21--final-release-candidate-verification-p1-done)                                        | Validate one candidate with production smoke, audits, soak, coverage                                  | Recorded automation-only done; hash/source relation checked, acceptance not reproduced        |
| [PF-22](../plans/project-finalization.md#pf-22--return-to-hands-on-release-verification-p1-deferred)                                 | Actual device/AT/host/settings verification                                                           | Deferred; R13 and pending checklist confirmed, no checks completed by this review             |

## 4. Validation summary — observed results, recorded claims, and gaps

### Commands actually executed in this review

Environment: repository-provided **Node v24.22.0 / npm 11.19.1**. No application
server, hosted workflow, production install, or remote audit was executed.

| Check                                                                        | Observed result                                                 | What it establishes                                                |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------ |
| `git status --short` at start                                                | Clean                                                           | No pre-existing tracked edits to incorporate                       |
| `git cat-file -t ec20ff482267d8fa2569fa85a7d1955a337ff806`                   | `commit`                                                        | Baseline object available                                          |
| `git merge-base --is-ancestor ec20ff482267d8fa2569fa85a7d1955a337ff806 HEAD` | Exit 0                                                          | Baseline precedes reviewed HEAD                                    |
| `git diff --stat ec20ff4 HEAD` and targeted `ec20ff4..fdaccf4` diffs         | Inspected                                                       | Initiative breadth and attribution for the detailed slice          |
| Git lockfile parsing and SHA-256 comparison                                  | Baseline and candidate hashes match records                     | Package/version provenance, not installation or advisory clearance |
| `npm run check:use-cases`                                                    | Exit 0; 97 covered, 0 partial, 0 missing                        | Inventory consistency only                                         |
| `node --test tools/check-audit-policy.test.mjs`                              | Exit 0; 2 passed, 0 failed/skipped                              | Policy behavior against synthetic audit fixtures, not a live audit |
| Targeted Vitest invocation below                                             | Exit 1; `MODULE_NOT_FOUND` for `node_modules/vitest/vitest.mjs` | Runner never started; zero application tests executed              |

Attempted from repository root:

```sh
node node_modules/vitest/vitest.mjs run --config apps/api/vite.config.ts apps/api/src/__tests__/request-boundary.spec.ts apps/api/src/__tests__/admission-policy.spec.ts apps/api/src/__tests__/dependency-security.spec.ts
```

The absent runner is the observed blocker; filter/config discovery was not
reached. After an existing-lockfile install, use project-relative filters from
`apps/api` with built workspace dependencies. Do not count this command as an
application test failure or as evidence that the tests passed.

The first ad hoc Node lockfile-reading command hit its default child-process
output-buffer limit (`ENOBUFS`); rerunning that read with an 8 MiB buffer
succeeded. This was a review-tool limit, not a package or application defect.
Repository lookups for absent ignored logs and a few guessed paths were corrected;
their failures supplied no test verdict. Final document/diff checks are recorded
in the completion note below.

### Historical results that remain recorded, not independently reproduced

| Record                | Recorded outcome                                                                           | Qualification                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Discovery / PF-01     | 427 unit/process, 27 real-browser passes; mocked browser 43 passed / 1 failed / 22 unrun   | Aggregate failed; baseline formatting and both audits failed                        |
| PF-02                 | 432 unit/process, 30 real-browser, four dependency-boundary checks; static targets passed  | Integration 44 passed / 22 unrun; production and full audits still failed           |
| PF-01A closeout       | 66 integration / 30 real-browser passes; later standalone integration 66/66                | Preceding failures and cache use retained; exact SSR open handle unresolved         |
| PF-03                 | 6 focused / 213 API / 25 process passes                                                    | Later focused status-mapping check; tests have since changed                        |
| PF-04                 | 10 focused / 223 API / 25 process passes                                                   | Local HTTP proxy simulation is not intended-host proof                              |
| PF-05                 | 227 API / 26 process / 10 schema passes                                                    | Mocked deadline and slot tests are narrower than concurrent slow-network validation |
| PF-21                 | 505 unit/component / 40 process / 81 mocked-browser / 42 real-browser; uncached target run | Committed candidate record only; raw logs and built artifacts absent here           |
| PF-21 coverage/audits | API 92.17% lines / 85.86% branches; zero production findings                               | No fresh coverage/audit; full graph still had 54 findings and dated exceptions      |
| PF-21 soak            | Six-cycle pass; nine-cycle growth-guard failure; twelve-cycle pass                         | Finite synthetic workload, not an upper memory bound or a public-host clearance     |

Test totals overlap across successive checkpoints; **do not sum them** into a
total of distinct verified behaviors. Code coverage records executed lines and
branches, not whether assertions prove the right contract. Likewise, a valid
use-case map does not execute its linked tests.

## 5. Open questions, unresolved risks, and recommendations

1. **Finish the independent review in bounded slices.** Next review PF-06–08:
   expiry/leases, native input/resource behavior, and persistence faults. Then
   PF-09–14 for privacy/telemetry/migrations/packaging; finally PF-15–19 and PF-21
   for resource evidence, browser contracts, CI, cleanup, and deployment. Preserve
   this coverage table and append corrections rather than replacing earlier
   evidence silently.
2. **Reproduce the relevant current checks from the existing lockfile.** Prepare
   the documented Node/npm environment, build workspace prerequisites, run the
   targeted API/schema tests, and then the relevant process/browser targets.
   Keep revision, command, exit status, skips, cache state, and bounded sanitized
   outputs. The current absence of dependencies is unresolved execution evidence,
   not a reason to alter application code.
3. **Resolve R11 as a small contract change if desired.** Decide whether
   `ApiErrorSchema` promises all current domain errors; align `archive_busy` and
   its test accordingly. Keep this separate from the read-only review.
4. **Close the PF-05 integration evidence gap.** A bounded real-socket test of
   simultaneous slow archives, deadline/abort, slot reuse, and lease release
   would substantiate the combined contract. Review single-image transfer
   retention and the pre-stream interval separately. No exploitation or private
   release blocker is asserted from those missing tests alone.
5. **Refresh security evidence before a new release decision.** Audit both root
   and pruned API production closures plus the full toolchain; verify registry
   success before interpreting counts. Review the 22 current exceptions by
   **2026-11-17** and whenever inputs/call paths change. Do not replace historical
   PF-02 failures with PF-21's later result or treat today's policy-test pass as
   a live audit pass.
6. **Execute PF-22 on the actual intended host.** Record proxy/TLS/direct-access
   controls, filesystem/codec behavior, screen reader and physical mobile
   results. The example proxy was not run during PF-19; real screenshot capture
   is not proof of the deployment recipe. Maintainer-only settings remain a
   manual review and no remote change is implied.
7. **Keep PF-20 closed to public exposure until its decision is implemented.**
   Select and validate decoder/abuse limits for the permitted public audience.
   A public deployment is a changed threat model, not merely the same private
   candidate on a reachable port.
8. **Improve evidence navigation without rewriting history.** Label discovery
   inventories and handoffs as historical, retain failed runs, and keep the
   runtime source revision distinct from subsequent validation-configuration
   commits. Small durable sanitized result summaries would reduce reliance on
   ignored artifacts in future reviews.

## 6. Reference index

### Commits and comparison boundaries

| Commit / comparison                                                         | Relevance                                                             |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `ec20ff482267d8fa2569fa85a7d1955a337ff806`                                  | Confirmed pre-finalization source/lockfile baseline                   |
| `a7dc90d`, `9ac5bc0`                                                        | Initial finalization-plan commits                                     |
| `fdaccf4`                                                                   | Grouped PF-01A–PF-06 implementation; principal early comparison point |
| `e7f137f`                                                                   | PF-07 image hardening; not independently reviewed here                |
| `51b6f4c` through `eda6e2c`                                                 | PF-08 persistence work; next detailed review slice                    |
| `d0816f6`                                                                   | PF-12 Nx migration; current wrapper/version context                   |
| `88b369d`                                                                   | PF-13 Playwright migration and 480-second integration deadline        |
| `5bc64e7`                                                                   | PF-14 Express/Archiver/runtime packaging changes                      |
| `f491a3cf036af1ff702acf0172768e6a75309550`                                  | Candidate runtime source, PF-19                                       |
| `2ed1ffa`                                                                   | PF-21 candidate evidence and coverage/CI configuration                |
| `6dda4d3`                                                                   | PF-22 checklist preparation, not hands-on execution                   |
| `1240eee`                                                                   | Reviewed HEAD, before this documentation addition                     |
| `git diff ec20ff4 fdaccf4 -- <file>`                                        | Attribute early implementation rather than later migrations           |
| `git diff f491a3c HEAD -- apps/api/src apps/web/app libs package-lock.json` | No runtime-source/lockfile drift after candidate runtime commit       |

### Source and test index

Line references refer to reviewed HEAD and may move after future edits. Tests
listed below were **inspected**, except the explicitly executed policy test.

| Ref | Source locations and symbols                                                                                                                                                                                                                                                                                               | Test evidence                                                                                                                                                                                                                                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S01 | [app.ts](../../apps/api/src/app.ts#L157) `errorTranslator()`; [express.ts](../../libs/observability/src/lib/express.ts#L90) `errorTranslator`; [request.http.ts](../../apps/api/src/controllers/request.http.ts) `requireJson`; [env.ts](../../apps/api/src/env.ts#L5) `bodyLimit`                                         | [request-boundary.spec.ts](../../apps/api/src/__tests__/request-boundary.spec.ts): malformed/oversized bodies, metadata failures, sendFile pre/post-header failures, logging                                                                                                                                                                |
| S02 | [app.ts](../../apps/api/src/app.ts#L40) trust/limiter/parser ordering; [env.ts](../../apps/api/src/env.ts#L14) `trustedProxyIps`; [sessions.routes.ts](../../apps/api/src/routes/sessions.routes.ts), [conversions.routes.ts](../../apps/api/src/routes/conversions.routes.ts) endpoint budgets                            | [admission-policy.spec.ts](../../apps/api/src/__tests__/admission-policy.spec.ts), [conversions-api.spec.ts](../../apps/api/src/__tests__/conversions-api.spec.ts#L506), [API process tests](../../apps/api-e2e/src/api/api.spec.ts#L354)                                                                                                   |
| S03 | [api.ts](../../libs/schemas/src/lib/api/api.ts#L43) `ApiDownloadFilesRequestSchema`; [conversion-files.routes.ts](../../apps/api/src/routes/conversion-files.routes.ts#L117); [files.service.ts](../../apps/api/src/services/files.service.ts#L113) slot/deadline/`writeZip`                                               | [files.service.spec.ts](../../apps/api/src/services/__tests__/files.service.spec.ts); [boundary saturation assertion](../../apps/api/src/__tests__/request-boundary.spec.ts#L280); [real archive warning](../../apps/api/src/__tests__/conversions-api.spec.ts#L714); [process ZIP validation](../../apps/api-e2e/src/api/api.spec.ts#L440) |
| S04 | [files.service.ts](../../apps/api/src/services/files.service.ts#L219) `buildContentDisposition`, `sanitizeFilename`, `uniquifyArchiveNames`                                                                                                                                                                                | Same service tests; [process collision/order/Unicode ZIP](../../apps/api-e2e/src/api/api.spec.ts#L458)                                                                                                                                                                                                                                      |
| S05 | [archive response](../../apps/api/src/routes/conversion-files.routes.ts#L134); [ApiErrorSchema](../../libs/schemas/src/lib/api/apiError.ts#L64); [frontend request](../../apps/web/app/routes/conversion/api/conversionApi.ts#L34); [download feedback](../../apps/web/app/routes/conversion/conversionController.ts#L417) | [schema error subset](../../libs/schemas/src/__tests__/api.spec.ts#L87), boundary saturation assertion; source establishes R11                                                                                                                                                                                                              |
| S06 | [application fixture](../../apps/web-e2e/src/support/application.ts#L49); [browser configuration](../../apps/web-e2e/browser.config.ts#L22); [action layout](../../apps/web/app/routes/conversion/components/ConversionOperationStatus.tsx#L366); [StatusHelp](../../apps/web/app/components/StatusHelp.tsx)               | [strict alignment polling](../../apps/web-e2e/src/integration/upload.spec.ts#L565); [status component tests](../../apps/web/app/routes/conversion/__tests__/ConversionOperationStatus.spec.tsx); historical PF-01A report                                                                                                                   |
| S07 | [Nx launcher](../../tools/nx.mjs); [nx.json](../../nx.json) `sharedGlobals`; [instrumentation](../../libs/observability/src/lib/instrumentation.ts#L138) `metricReaders`; [image sniffing](../../apps/api/src/services/image.service.ts#L57)                                                                               | [dependency-security.spec.ts](../../apps/api/src/__tests__/dependency-security.spec.ts); [SDK compatibility](../../libs/observability/src/__tests__/sdk-compatibility.spec.ts); [SSR security](../../apps/web-e2e/src/e2e/ssr-security.spec.ts)                                                                                             |
| S08 | [root manifest](../../package.json), [API manifest](../../apps/api/package.json), [observability manifest](../../libs/observability/package.json), [lockfile](../../package-lock.json)                                                                                                                                     | Three Git lockfiles parsed; baseline/current SHA-256 matched records; installed closure not checked                                                                                                                                                                                                                                         |
| S09 | [inventory checker](../../tools/check-use-case-inventory.mjs), [audit policy](../../tools/check-audit-policy.mjs), [exceptions](../../tools/audit-exceptions.json), [CI](../../.github/workflows/ci.yml)                                                                                                                   | Inventory command passed; [audit-policy tests](../../tools/check-audit-policy.test.mjs) 2/2 passed; hosted workflow/live audit not run                                                                                                                                                                                                      |

### Documentation and advisory provenance

- [Original task plan and dated checkpoints](../plans/project-finalization.md):
  source for tracking, acceptance criteria, historical commands, advisory IDs,
  and migration references. In particular, the
  [runtime reachability ledger](../plans/project-finalization.md#runtime-advisory-reachability-ledger)
  and [PF-02 changes](../plans/project-finalization.md#changes-and-advisory-disposition)
  contain the original upstream advisory links. This review relies on their
  recorded assessment rather than presenting a fresh upstream-advisory audit.
- [PF-01A handoff](../plans/pf-01a-handoff.md) and
  [PF-02 handoff](../plans/pf-02-handoff.md): historical investigation and
  intermediate results; superseded as current task instructions by later commits.
- [Architecture overview](../architecture/README.md),
  [single-owner ADR](../architecture/decisions/ADR-001-use-process-owned-filesystem-runtime.md),
  [independent commits ADR](../architecture/decisions/ADR-002-commit-files-independently.md),
  [constraints](../architecture/quality/constraints.md), and
  [quality requirements](../architecture/quality/requirements.md): operating model
  and pre-existing architectural rationale.
- [Development and behavior README](../../README.md),
  [inventory method](../testing/use-case-inventory-method.md), and
  [use-case inventory](../testing/use-case-inventory.md): validation conventions
  and the distinction between mapping and execution.
- [Release candidate](../release-candidate.md), [self-host guide](../self-host.md),
  [PF-22 checklist](../testing/hands-on-release-verification.md), and
  [security policy](../../SECURITY.md): support matrix, packaging, manual gaps,
  and reporting constraints.

### Review completion note

This first pass explains six tasks in detail and retains explicit coverage for
the other 17. Nine implementation groups are corroborated by source/history;
fresh application execution verification is zero. The meaningful new open
finding is the shared `archive_busy` schema mismatch; the important evidence
gap is integrated slow-transfer validation. All **101 local document/source
links and heading anchors** resolved. The new-file diff had no whitespace
diagnostics, and final scope inspection showed only this review document added.
The locked Prettier check could not run without installed dependencies; Markdown
structure and references were checked directly. No fixes, dependency changes,
remote writes, or release decisions are implied by this report.
