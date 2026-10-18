# Recover Conversion After Restart

**Initiator:** API process startup after an interruption. **Scope:** recovery before the process listens for requests.

```mermaid
sequenceDiagram
    participant Main as API entrypoint
    participant Runtime as Conversion runtime
    participant Store as Conversion storage
    participant Disk as Local filesystem

    Main->>Disk: Remove abandoned request staging
    Main->>Runtime: Start
    Runtime->>Store: Discover operation directories
    loop Each operation session
        Store->>Disk: Restrict existing operation directories and regular files to owner-only modes
        Store->>Disk: Read operation, inputs, outputs, commit receipts
        Store->>Store: Validate completed outputs and reconcile valid receipts
        Store->>Store: Mark uncommitted processing file interrupted
        Store->>Store: Check remaining accepted inputs and expiry
        Store->>Disk: Persist reconciled snapshot; prune incomplete artifacts
    end
    Runtime->>Runtime: Sweep expired sessions and wake ready work
    Main->>Main: Listen; report ready
```

Session discovery treats filesystem inspection failures as storage I/O, including failures without an errno code. Malformed stored paths remain a separate validation failure.

Valid committed output survives restart. Existing regular files in each discovered operation's storage directories are restricted to mode `0600`, and those directories to `0700`, before requests resume. Symlinks are not chmod targets. A processing file without valid commit evidence becomes `processing_interrupted`; later accepted files can still run if the operation is eligible. Missing or malformed commit artifacts are isolated to the affected session, while a filesystem read failure during evidence verification is a fatal storage fault even when it has no errno code. Missing or corrupt accepted input becomes a file storage failure; a filesystem read fault while verifying it stops recovery without changing that file's state. Cleanup faults likewise stop recovery so orphan removal can be retried. Invalid session records are isolated and reported; a fatal storage or cleanup fault stops scheduling/readiness and makes the production API begin bounded graceful shutdown with a nonzero exit. Cleanup of expired operation, create-only, and legacy data waits for active leases. This recovery is owned by one API process and must finish before it serves conversion requests.
