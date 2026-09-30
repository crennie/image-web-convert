# ADR-002: Single-process filesystem conversion state

Status: Accepted
Date: 2026-09-30

## Context

The intended local workflow uses one persistent API process. Conversion state and image files need to survive that process restarting, but the project does not require distributed scheduling or a production database. Publishing an image, metadata, and operation state spans several filesystem writes, so interrupted publication needs explicit reconciliation.

## Decision

One API process owns a storage root and an in-process scheduler. The API persists sessions, operation snapshots, accepted inputs, converted outputs, metadata, and per-file commit receipts on that filesystem. It serializes local mutations and verifies receipt, metadata, and output fingerprint before serving a completed file. On startup it reconciles valid commits, marks interrupted processing slots with no receipt failed, isolates corrupt records, and resumes eligible queued work before reporting ready.

## Consequences

- Deployment must preserve the storage root across API restarts and must not run multiple API processes against the same root.
- Filesystem storage avoids operating a database or queue for this scope, but does not provide one atomic transaction across all artifacts.
- Recovery and readiness are part of API startup. Commit receipts and fingerprints add I/O and storage work in exchange for independently recoverable files.
- In-process claims and scheduling do not provide cross-process coordination or hard termination of native encoding work.

## Alternatives

- Database plus durable queue and workers: supports distributed ownership, but adds operational components outside the current local, single-user scope.
- Keep only temporary files and process memory: simpler persistence, but loses authoritative state and committed output recovery after restart.

This ADR records the current implementation retrospectively. See [the data view](../static/data.md) for the persisted boundaries.
