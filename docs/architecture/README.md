# Architecture

## System

Image Web Convert lets a person upload a batch of images, convert them to a web-friendly format, and download completed results. A browser application manages the interaction; a single Express API process owns sessions, conversion work, and local files.

## Architecture Views

- [Static structure](static/context.md): system boundaries, runtime elements, data, and deployment.
- [Runtime behavior](dynamic/process-conversion.md): conversion and recovery scenarios.
- [Decisions](decisions/ADR-001-use-process-owned-filesystem-runtime.md): rationale for important boundaries.
- [Constraints and quality](quality/constraints.md): operating limits and expected behavior.

## Key Artifacts

- [Container view](static/containers.md)
- [API component view](static/components/api.md)
- [Conversion lifecycle](dynamic/process-conversion.md)
- [Restart recovery](dynamic/recover-conversion.md)
- [Independent file commits](decisions/ADR-002-commit-files-independently.md)
- [Quality requirements](quality/requirements.md)

## Current Architecture Summary

The React Router frontend calls an Express API through `/api`. The API persists one immutable operation manifest per short-lived session, accepts each file into a separate slot, and processes ready operations in a process-local FIFO scheduler. Inputs, operation state, and independently committed outputs live on one filesystem root; startup recovery reconciles interrupted work before the API accepts requests.
