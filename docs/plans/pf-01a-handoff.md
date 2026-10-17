# PF-01A handoff: mocked-browser timeout

Status: **done**. This handoff preserves the 2026-10-17 pre-fix diagnosis; implementation and validation results are in the [PF-01A closeout](project-finalization.md#pf-01a-closeout-2026-10-17). PF-02's implementation remains uncommitted in the working tree. PF-01A's acceptance criteria remain in [project-finalization.md](project-finalization.md).

## Exact failure and stage

Nx target `@image-web-convert/web-e2e:browser-integration` invokes `playwright test --config browser-integration.config.ts` from `apps/web-e2e`. `browser-integration.config.ts` uses `browser.config.ts`, which sets one worker, a 30-second per-test timeout, a 90-second application-fixture timeout, and a **300-second global suite timeout**.

The saved PF-02 run in `tmp/finalization-pf02/browser-integration.log` reached **44 passed, 22 did not run**, then printed both `Timed out waiting 300s for the test suite to run` and `Timed out waiting 300s for the teardown for test suite to run`. The HTML report at `apps/web-e2e/test-output/integration/report/index.html` records a 300,028 ms run starting at 2026-10-17 05:20:55.442 UTC. All 22 Chromium and all 22 Firefox cases passed. The first WebKit case, `counts remain accurate from uploads through all successful`, started at 05:25:51.462 UTC, about four seconds before the global deadline. Its assertion and after-hook were interrupted. Playwright reports this started-but-incomplete case as skipped; the other 21 WebKit cases never started. Thus the global execution deadline caused all 22 uncompleted cases.

The **primary timeout happened during test execution**. The later teardown-timeout message is emitted after the same global deadline; the report does not prove a separate worker-shutdown or process-teardown hang. The first WebKit case passed alone, so it is not established as a failing test. Do not describe the integration suite as green or the 22 cases as tested.

## Measured contributor

The saved report's 44 completed cases spent **184.881 seconds in After Hooks**: 94.318 seconds in Chromium and 90.563 seconds in Firefox. The application fixture accounts for roughly 5.3 seconds of cleanup per completed case (median After Hooks: 5.474 seconds Chromium, 5.409 seconds Firefox). Completed test bodies sum to about 97.245 seconds. This repeated fixture cleanup is the largest measured contributor to exhausting the 300-second budget; its underlying delay has not yet been isolated. The fixture in `apps/web-e2e/src/support/application.ts` starts and stops the SSR server and proxy for each test, using `startNodeServer` from `apps/api-e2e/src/support/api-process.ts`.

## Bounded reproduction, no implementation edits

Both actual attempts were run from `apps/web-e2e` with GNU `timeout` as an independent external cap and output directed under ignored `tmp/`:

1. `timeout -k 5s 85s env NX_NO_CLOUD=true NX_SKIP_NATIVE_FILE_CACHE=true ../../node_modules/.bin/playwright test --config browser-integration.config.ts --project=webkit --grep 'counts remain accurate from uploads through all successful' --workers=1 --reporter=list --global-timeout=65000 --output=../../tmp/pf01a-repro-webkit` — **1 passed in 17.1 seconds** (test body 13.0 seconds). The WebKit case is viable in isolation.
2. `timeout -k 5s 28s env NX_NO_CLOUD=true NX_SKIP_NATIVE_FILE_CACHE=true ../../node_modules/.bin/playwright test --config browser-integration.config.ts --project=chromium --grep 'light theme has filled controls and readable surfaces at (375px|1280px)' --workers=1 --reporter=list --global-timeout=8000 --output=../../tmp/pf01a-repro-budget` — **1 passed, 1 did not run**. Playwright printed the same pair of global execution and teardown timeout messages at 8 seconds. This deliberately reduced budget reproduces the mechanism, not the original 300-second aggregate workload.

An initial command used `./node_modules/.bin/playwright` from `apps/web-e2e` and exited 127 before starting Playwright; it is not a reproduction attempt. No further suites were run. `git diff --check` passed after the investigation.

## Original next steps for PF-01A (completed)

1. Isolate why the application fixture's `After Hooks` takes about 5.3 seconds per test. Inspect the proxy and `startNodeServer.stop()` shutdown timing with a small focused run; avoid repeating the 66-case suite merely to collect the same symptom. Fix a demonstrated teardown delay if it is within the test harness contract.
2. Measure the full 66-case suite and parallel-suite contention before changing the global timeout or worker policy. Choose a timeout from measured complete runtime, with bounded headroom. A larger limit alone would leave the repeated cleanup unexplained.
3. Investigate the baseline Chromium `upload.spec.ts:403` alignment result (3.140625 px against `<2`), which passed unchanged in the PF-02 integration run but remains intermittent. Determine whether it is a layout defect, font timing, or an overprecise assertion; retain meaningful coverage.
4. After a focused correction, complete all 66 mocked-browser cases across Chromium, Firefox, and WebKit, then run the CI-equivalent validation required by PF-01A. Record execution and teardown durations and any remaining failures. Do not change PF-02's completed status based on this separate task.

If fixture cleanup cannot be corrected within a bounded PF-01A change, document the measured runtime and defer the timeout-policy decision to the owner rather than claiming the suite passes.
