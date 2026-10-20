# PF-22 hands-on release verification

Use this record before calling the private self-host candidate verified on its
intended host. The [candidate record](../release-candidate.md) contains the
automated evidence and rollback procedure; this page is for observations that
require a person, physical device, assistive technology, or target deployment.
Keep tokens, private images, host addresses, and request/response bodies out of
the recorded results. Use synthetic images and record only non-sensitive
configuration details.

## Test record

Copy this section into a dated, private test record for each candidate and host.
Do not fill a result from an automated test or an earlier candidate.

| Field                                               | Value         |
| --------------------------------------------------- | ------------- |
| Date and tester                                     | Pending       |
| Candidate commit and lockfile SHA-256               | Pending       |
| Host OS/CPU, Node/npm, API/SSR artifact versions    | Pending       |
| Proxy version and TLS mode                          | Pending       |
| Physical device, OS, browser versions               | Pending       |
| Desktop browser, screen reader and versions         | Pending       |
| Exceptions accepted by maintainer, with review date | None recorded |

For each check below, record **pass**, **fail**, or **not run**, the device or
host used, the observed behavior, and an issue link or explanation for any
failure. A check left **not run** does not count as a pass.

## Keyboard and screen reader

1. On `/conversion`, use only the keyboard and screen reader to choose two
   synthetic images, choose an output format, and start a batch. Confirm the
   file names, format control, and start action have understandable names and
   focus order.
2. Listen as upload, processing, and completion counts change. Confirm the
   operation status live region announces useful changes without repeating
   continuously. Open the status help with keyboard focus, hear its description,
   dismiss it with Escape, and confirm focus remains usable.
3. Start an individual image download and a ZIP download. Confirm the separate
   download feedback is announced, the busy control cannot trigger a duplicate
   download, and the completed file can be found and opened.
4. Expand the Files list, focus a file control, and allow an all-success batch
   to collapse automatically. Confirm focus moves to the Files toggle and
   collapsed controls are skipped by Tab and screen-reader navigation.
5. Trigger the leave warning from an active batch and from completed results.
   Confirm its title and actions are announced, focus stays in the dialog, Stay
   returns to the batch, and Leave follows the selected route.

## Physical touch and mobile layout

1. On a physical phone or tablet, tap the status help. Confirm the tooltip is
   visible, readable, within the viewport, and can be dismissed without
   activating an unrelated control.
2. Convert a 20-file synthetic batch. Check the selection and result lists in
   portrait and landscape: no horizontal page overflow, controls remain
   reachable, and the ZIP action remains reachable after the Files list
   collapses. Reopen and scroll the list.
3. Open the leave warning while the page is scrolled. Confirm its actions and
   backdrop work with touch and that closing it returns to the batch.

## Intended host and proxy

Follow the [self-host guide](../self-host.md) on the intended host using a
fresh checkout and the candidate lockfile. Record the actual commands, exit
codes, and non-sensitive configuration values.

1. Install, build, prune, and install both production dependency closures.
   Start exactly one API process and the matching SSR process. Check `/readyz`
   and `/conversion` through the intended TLS proxy.
2. Confirm the proxy sends `/api/*` to the API without stripping `/api`, serves
   the web route from SSR, and does not expose the API port directly. From a
   network peer outside the trusted boundary, direct API access must fail.
3. Confirm a trusted browser connection uses valid TLS, that API responses
   carrying session or file data have `Cache-Control: private, no-store`, and
   that no shared cache stores them. Check that proxy logs omit session tokens
   and private response bodies.
4. Convert and download a synthetic image through the proxy. Restart the sole
   API process and confirm the permitted result remains downloadable until
   expiry. After expiry and cleanup, confirm the old session is rejected and
   its storage is reclaimed. Keep the API storage roots private throughout.
5. Confirm host limits and monitoring fit the [documented resource
   budget](../self-host.md#convert-and-operate), then record the chosen RAM,
   disk, restart policy, and storage backup location without disclosing secrets.

## Maintainer settings

The maintainer reviews branch protection and the private security-reporting
route in the repository host UI. Record the observed settings and any issue to
resolve. This check is read-only; a settings change or public issue/report is
outside this verification record.

PF-22 closes only after every applicable check has an outcome and each failure
is fixed or explicitly accepted with an owner and review date. Until then,
describe the candidate as automation-verified for private self-hosting.
