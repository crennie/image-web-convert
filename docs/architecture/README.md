# Architecture

## System

Image Web Convert lets a user submit a batch of images in a browser and download web-friendly conversions. A React Router frontend handles selection, upload transport, and display; an Express API owns short-lived sessions, conversion state, image processing, and filesystem-backed results.

## Architecture Views

- [Static structure](static/context.md): system context, runtime elements, API components, concepts, storage, and deployment boundaries.
- [Runtime behavior](dynamic/process-conversion.md): upload, scheduling, processing, and recovery scenarios.
- Decisions: [backend-owned lifecycle](decisions/ADR-001-backend-owned-conversions.md) and [single-process filesystem state](decisions/ADR-002-single-process-filesystem-state.md).
- [Constraints and quality](quality/constraints.md): operating boundaries and observable expectations.

## Key Artifacts

- [Container view](static/containers.md)
- [Conversion lifecycle](dynamic/process-conversion.md)
- [Restart recovery](dynamic/recover-conversions.md)
- [Quality requirements](quality/requirements.md)

## Current Architecture Summary

The browser submits an immutable manifest and uploads individual slots; the API publishes authoritative operation snapshots and runs a process-local, sequential conversion scheduler. Session and operation records, accepted inputs, and committed outputs live under one filesystem storage root. The web and API runtimes communicate over HTTP; the API storage root has one process owner.
