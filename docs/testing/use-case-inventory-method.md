# Build a use-case and test-coverage inventory

This procedure turns a project's architecture documents and implementation into a traceable list of behaviors and their test evidence. Use it in passes: document the intended behavior, reconcile it with code, then map and improve tests. A use case describes an observable outcome across the system; it is not a function, endpoint, or line of code.

"Exhaustive" means exhaustive within a stated scope. Record excluded features and known limitations so readers do not mistake an omitted workflow for a verified one.

## 1. Define the boundary

Identify the product surface, actors, and environments to include. Separate production behavior from prototypes, future work, and infrastructure that does not produce a user or operator outcome. Locate the project's sources of truth:

- Static architecture: systems, ownership, data, and trust boundaries.
- Dynamic architecture: sequences, state transitions, and alternate paths.
- Decisions, requirements, error contracts, release checklists, and product rules.
- Routes or UI entry points, application workflows, domain services, persistence and provider adapters, and test directories.

Write the scope, exclusions, and documented limitations at the top of the inventory. Keep source paths relative to the repository root. For this project, the [architecture index](../architecture/README.md) and [coverage summary](use-case-inventory.md) are starting points.

## 2. Extract cases from documents

Read every in-scope runtime flow and turn each distinct result into a case. Use one stable ID and one testable outcome per case:

| Field     | Question                                                 |
| --------- | -------------------------------------------------------- |
| `actor`   | Who starts or observes this behavior?                    |
| `given`   | What state or precondition matters?                      |
| `when`    | What event or action occurs?                             |
| `then`    | What must be visible, persisted, rejected, or protected? |
| `sources` | Which documents establish the contract?                  |

Split a happy path when its branches have different outcomes or recovery actions. Examine each sequence diagram's alternatives and each error table's rows. Check at least these classes where applicable: normal use; empty or missing state; invalid input; stale or expired state; external data changes; provider or storage failure; retry and duplicate submission; authorization or guest isolation; and UI recovery. Include important browser behavior such as navigation, reload, focus, and cookie lifecycle when it affects the workflow.

Keep a case at the behavior boundary. A purchase may need separate cases for card rejection, uncertain payment, and successful payment, but it does not need a case for every internal helper called along the way. Put cross-cutting security or accessibility rules in the inventory when they have an observable contract; keep broad performance targets in the project's quality requirements.

At the end of this pass, every documented in-scope path should have a case or an explicit exclusion or limitation. Do not fill test links yet. An empty `tests` array means **unmapped**, not **untested**, while `testMappingStatus` is `pending`.

## 3. Reconcile the inventory with code

Trace each public entry point through UI, action or controller, domain logic, and external boundaries. Search both directions: follow documented cases into code, then inspect code paths that may represent undocumented outcomes. Give special attention to state changes, error mappings, cookie or session handling, payment or other irreversible calls, and UI branches that display different guidance.

For each mismatch, decide whether the documentation is stale, code implements an undocumented case, or the intended behavior is not implemented. Update the case or its source document accordingly. Mark uncertainty as a gap; do not silently describe intended behavior as proven implementation. This is a behavior review, not a requirement to catalog every code branch or raise line coverage.

## 4. Map tests to the outcomes they actually assert

Search unit, component, adapter, integration, and browser suites. Read each candidate test's assertions and setup before linking it. A test that calls the relevant function, opens a route, or shares a filename is not necessarily evidence for the stated outcome.

Each test reference should identify:

- A repository-relative test file and exact test title or stable test ID.
- Its layer, such as domain, application, adapter, component, or browser.
- Its environment, such as deterministic local fixtures, mocked browser services, or a live test environment.
- The part of the expected outcome it directly asserts.

A case can have several tests across layers. State gaps plainly when only part of the result is checked: a service test may prove a retry key while leaving the browser message unverified; a mocked browser test may prove navigation while leaving live database policy unverified. Do not use a successful test run as evidence for behavior that the test never asserted. Keep execution results in normal test reports rather than turning the inventory into a stale run log.

Give every case a coverage verdict after reading its assertions: `covered` when an appropriate stable test directly establishes the stated outcome, `partial` when a material part or boundary remains unverified, and `missing` when no test directly asserts the outcome. Add a specific `gaps` entry to every partial or missing case. A source test title containing a parameter placeholder such as `%s` is the title template used by the test runner; the linked assertion must still apply to the relevant parameter row.

## 5. Add missing tests by risk

Prioritize cases with high consequence and weak evidence: money or stock changes, durable state transitions, access isolation, cookies and session expiry, idempotent retries, and user recovery from partial success. Choose the lowest stable test layer that can prove each rule, then add browser coverage for important visitor journeys and UI outcomes. Use live environments only for boundaries that mocks cannot establish, with project-specific test data and authorization.

Avoid duplicating the same assertion at every layer. A useful target is complementary evidence: domain tests for decision rules, adapter tests for external contracts, and browser tests for representative end-to-end behavior.

## 6. Validate and maintain the inventory

Before treating the map as reviewed, check that JSON parses, IDs are unique, required fields exist, source and test paths resolve, and referenced test names or templates still exist. Review the test assertions behind any claim of coverage. A nonempty `tests` array alone is not a coverage verdict. Keep a human-readable summary, if one exists, consistent with the detailed inventory.

Run `npm run check:use-cases` for the mechanical checks above. The command also compares case verdicts and evidence references with the Markdown summary; reading the linked assertions remains a review task.

Repeat the relevant passes when a runtime diagram, error contract, route, workflow, or test changes. Preserve stable case IDs unless the behavior itself is removed or split. Review the final diff for unrelated changes.

## Portable JSON shape

Adapt the groups and field names to the repository, but retain explicit scope, sources, cases, and evidence. This example shows the first pass before test mapping; this project's [use-case inventory](use-case-inventory.json) includes coverage verdicts, test references, and gaps:

```json
{
    "schemaVersion": 1,
    "scope": "Current customer purchase flow",
    "testMappingStatus": "pending",
    "excluded": [],
    "documentedLimitations": [],
    "areas": [
        {
            "id": "payment",
            "sources": ["docs/architecture/dynamic/purchase.md"],
            "cases": [
                {
                    "id": "payment.definitive-rejection",
                    "actor": "customer",
                    "given": "The provider definitively rejects the payment",
                    "when": "The customer submits payment",
                    "then": "The customer can correct the details and retry without a duplicate charge",
                    "tests": []
                }
            ]
        }
    ]
}
```

During mapping, populate `tests` with objects such as `{"file":"tests/payment.spec.ts","name":"declined payment allows corrected retry","layer":"domain","environment":"local","asserts":"the retry uses a new payment attempt"}`. Set `coverage` to `covered`, `partial`, or `missing` and add `gaps` as an array of specific unverified outcomes. Only change the inventory's mapping status to reviewed after every in-scope case has been assessed.
