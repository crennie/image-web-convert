# ADR-002: Commit converted files independently

Status: Accepted
Date: 2026-10-02

## Context

A batch can contain both convertible and failing images. Cancellation or process interruption may also occur after some outputs finish. This ADR records the existing per-file publication design.

## Decision

Accept uploads per manifest slot and commit each converted output separately, with metadata and durable commit evidence. Keep completed files available while siblings are processing, failed, or cancelled. Reconcile receipts and operation state during startup recovery.

## Consequences

Users can download successful files without waiting for an all-or-nothing batch result. Operation snapshots can report partial completion. Storage and recovery must verify each file's evidence and preserve successful siblings through failures and cancellation. ZIP downloads include available requested outputs and report missing IDs.

## Alternatives

- An atomic batch commit would simplify a single final outcome but discard useful completed results when one file fails or a batch is cancelled.
- Publishing output without commit evidence would make a crash between file publication and snapshot update ambiguous.
