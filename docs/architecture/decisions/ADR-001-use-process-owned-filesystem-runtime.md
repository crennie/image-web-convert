# ADR-001: Use a process-owned filesystem runtime

Status: Accepted
Date: 2026-10-02

## Context

The current application needs asynchronous conversion, bounded concurrent uploads, durable results, and restart recovery for local single-user use. Admission claims, the scheduler, and download leases share process memory, while operation state and files persist on disk. This ADR records the existing design.

## Decision

Run conversion scheduling inside one persistent API process with exclusive ownership of its filesystem storage root. Persist sessions, operation snapshots, accepted inputs, outputs, and commit evidence there. Recover the root before the API listens.

## Consequences

The design has no separate queue, worker service, or database to operate. FIFO scheduling, claims, and cleanup can coordinate inside one process. A shared storage root cannot safely be served by multiple API processes; horizontal scaling would require a new ownership and coordination design. Native image work has cooperative deadlines rather than hard process isolation.

## Alternatives

- A shared queue and separate workers would support distributed processing but require durable cross-process coordination and new infrastructure.
- A database or object store could provide different durability and scaling properties, with more deployment and migration work.
