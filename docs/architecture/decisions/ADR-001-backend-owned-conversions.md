# ADR-001: Backend-owned asynchronous conversions

Status: Accepted
Date: 2026-09-30

## Context

Image conversion can outlive an upload request, and one failed file should not remove successful siblings. The earlier synchronous batch endpoint coupled upload completion, conversion, and response delivery. The active browser needs a stable source of truth after interrupted requests and while other files continue processing.

## Decision

The API owns one immutable conversion operation per session: its manifest, options, per-file states, scheduling, cancellation, and aggregate outcome. The browser uploads individual server-assigned slots and reads versioned operation snapshots. The API starts work when all slots are accepted or permanently failed, runs one conversion at a time in FIFO operation order and manifest file order, and commits successful outputs independently. Browser polling only observes progress. The synchronous upload endpoint is retired.

## Consequences

- Upload acknowledgement means input acceptance, while conversion completion is reported later in a snapshot.
- A lost response can be reconciled through an idempotent creation intent or a status read before retrying a slot.
- The browser needs separate transport progress and server state, plus cancellation and polling behavior.
- Backend capacity and expiry must cover waiting, uploading, and processing operations.

## Alternatives

- Continue synchronous batch conversion: simpler request flow, but ties long-running work and partial outcomes to one response.
- Put scheduling in the browser: avoids a server worker, but cannot reliably advance or recover work after a tab or network interruption.

This ADR records the current implementation retrospectively. The original migration detail remains in [the asynchronous conversion plan](../../plans/asynchronous-conversions.md).
