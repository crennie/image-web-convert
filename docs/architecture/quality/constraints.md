# Architecture constraints

These are current solution-space constraints reflected in code and the [asynchronous conversion plan](../../plans/asynchronous-conversions.md). Configuration defaults and exact validation remain in [`env.ts`](../../../apps/api/src/env.ts).

| Constraint                                                                | Source and architectural effect                                                                                                 |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| One persistent Node.js API process owns each storage root.                | The process-local scheduler, upload claims, and mutation locks cannot coordinate multiple API instances sharing that root.      |
| Session lifetime is fixed at creation, including upload and queue time.   | Polling, cancellation, and downloads do not extend access; cleanup waits for active work and download leases.                   |
| At most one conversion operation belongs to each active-workflow session. | The first manifest fixes membership and output format; matching creation retries reuse it.                                      |
| The API is the authority for conversion state.                            | The browser can show transport bytes but must use snapshots for accepted, processing, completed, and failed outcomes.           |
| State and artifacts are filesystem-backed.                                | The API needs a persistent writable `UPLOAD_DIR`; `UPLOAD_TMP_DIR` holds disposable request staging.                            |
| Browser-facing API routing uses `/api` by default.                        | Local Vite proxying or equivalent deployment routing is needed; cross-origin hosting requires `VITE_API_URL` and `CORS_ORIGIN`. |
| Sessions use API-issued bearer tokens.                                    | Authenticated operation and download requests require the token; only its hash is stored in session records.                    |

The repository defines a local execution model rather than a provider-specific production deployment. Multi-instance operation would require a new coordination and persistence design, not only a higher replica count.
