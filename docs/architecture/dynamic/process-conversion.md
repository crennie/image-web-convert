# Process a conversion batch

**Scenario:** a user submits one batch through the active browser route. Participants correspond to the [container view](../static/containers.md); the API internals are expanded in [API components](../static/components/api.md).

```mermaid
sequenceDiagram
    actor User
    participant Browser as Browser client
    participant API as Express API
    participant Store as Filesystem storage
    participant Worker as API scheduler and encoder

    User->>Browser: Select files and output format
    Browser->>API: POST /api/sessions
    API->>Store: Persist session and token hash
    API-->>Browser: Session ID, bearer token, expiry, limits
    Browser->>API: POST /api/sessions/:sid/conversions with fixed manifest
    API->>Store: Persist operation and server-assigned slots
    API-->>Browser: Operation snapshot
    loop Slot uploads (up to two concurrent transports)
        Browser->>API: PUT one multipart file per slot
        API->>Store: Stage, validate, promote input, persist acceptance
        API-->>Browser: Snapshot acknowledging accepted bytes
    end
    API->>Store: Persist queued state when all slots settle upload admission
    API->>Worker: Wake process-local FIFO scheduler
    loop Each uploaded slot in manifest order
        Worker->>Store: Persist processing claim
        Worker->>Worker: Decode and encode image
        Worker->>Store: Publish output, metadata, receipt, then completed snapshot
    end
    loop Until operation is terminal
        Browser->>API: GET authoritative snapshot
        API->>Store: Read operation
        API-->>Browser: File states, counts, available outputs
    end
    User->>Browser: Download file or ZIP
    Browser->>API: Authenticated download request
    API->>Store: Verify completed output and commit evidence
    API-->>Browser: File or ZIP stream
```

The operation manifest and output format cannot change after creation. A matching request ID and intent reuses the operation; a different intent for the session returns a conflict. Upload admission checks authorization, slot identity, and process capacity before multipart parsing. A disconnected or incomplete transfer leaves its slot retryable; an accepted slot cannot be overwritten. The browser reconciles an uncertain upload with a status read before retrying. Polling is observational: the API scheduler advances queued work without a browser status request.

Permanent slot failures allow the batch to progress once no slot awaits upload. Individual conversion failures preserve successful siblings; aggregate status becomes `completed`, `partially_completed`, or `failed` from the file outcomes. A user cancellation stops future uploads and requests a cooperative backend stop. The active encoder may settle successfully, while later files are skipped; already committed downloads remain available until expiry. A conversion deadline likewise waits for the invocation to settle before releasing its worker slot. See [quality requirements](../quality/requirements.md) for the resource and recovery limits.
