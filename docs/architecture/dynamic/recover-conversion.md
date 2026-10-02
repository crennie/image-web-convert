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
        Store->>Disk: Read operation, inputs, outputs, commit receipts
        Store->>Store: Validate completed outputs and reconcile valid receipts
        Store->>Store: Mark uncommitted processing file interrupted
        Store->>Store: Check remaining accepted inputs and expiry
        Store->>Disk: Persist reconciled snapshot; prune incomplete artifacts
    end
    Runtime->>Runtime: Sweep expired sessions and wake ready work
    Main->>Main: Listen; report ready
```

Valid committed output survives restart. A processing file without valid commit evidence becomes `processing_interrupted`; later accepted files can still run if the operation is eligible. Missing or corrupt accepted input becomes a file storage failure. Invalid session records are isolated and reported; a storage mutation fault stops scheduling/readiness. Cleanup of expired operation data waits for active leases. This recovery is owned by one API process and must finish before it serves conversion requests.
