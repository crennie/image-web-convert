# Recover conversion state after restart

**Scenario:** the API process restarts after an interrupted upload or conversion. The sequence describes startup before the service accepts requests.

```mermaid
sequenceDiagram
    participant Entry as API entrypoint
    participant Runtime as Conversion runtime
    participant Store as Conversion storage
    participant Disk as Filesystem
    participant Worker as Scheduler

    Entry->>Disk: Remove abandoned multipart request staging
    Entry->>Runtime: Start runtime
    Runtime->>Store: Enumerate persisted operation sessions
    loop Each operation session
        Store->>Disk: Read operation, output, metadata, and receipts
        alt Valid receipt for processing slot
            Store->>Disk: Verify output fingerprint and metadata
            Store->>Disk: Persist completed slot from receipt
        else Processing slot with no commit receipt
            Store->>Disk: Persist processing_interrupted failure
        else Invalid session record or commit evidence
            Store-->>Runtime: Report storage error for this session
            Runtime->>Runtime: Isolate affected session
        end
    end
    Runtime->>Runtime: Apply expiry and discover queued work
    Runtime->>Worker: Wake scheduler for eligible uploaded slots
    Runtime-->>Entry: Ready after recovery and initial sweep
    Entry->>Entry: Begin listening and report readiness
```

An interrupted request body is not an accepted input. Recovery preserves valid committed outputs and can finish a snapshot update when the image, metadata, and receipt were already published. A processing slot with no receipt fails rather than being silently retried; remaining uploaded slots can continue. A corrupt receipt or completed output is reported and isolates that session. Expired operations stop and are cleaned only when no conversion or download lease uses their files. Storage mutation failures stop scheduling and readiness. The periodic sweep rediscovers ready work without relying on browser polling.
