# Process Conversion

**Initiator:** a person selects files and a target format in the browser. **Scope:** the active operation workflow across browser, API, scheduler, and filesystem.

```mermaid
sequenceDiagram
    actor Person
    participant Web as Browser application
    participant API as Express API
    participant Store as Local filesystem
    participant Worker as In-process scheduler / encoder

    Person->>Web: Choose files and output format
    Web->>API: POST /api/sessions
    API->>Store: Persist session and token hash
    API-->>Web: Session token, expiry, effective limits
    Web->>API: POST /conversions with fixed manifest
    API->>Store: Persist operation and file slots
    API-->>Web: IDs and authoritative snapshot
    loop Each slot; up to two concurrent browser uploads
        Web->>API: PUT /conversions/{id}/files/{fileId}
        API->>Store: Stage and durably accept input
        API-->>Web: Accepted snapshot
    end
    API->>Worker: Wake when all slots are accepted or permanently failed
    loop Ready operations FIFO; files in manifest order
        Worker->>Store: Persist processing state
        Worker->>Worker: Decode and convert image
        Worker->>Store: Commit file output or failure
    end
    loop While operation is active
        Web->>API: GET /conversions/{id}
        API-->>Web: Current snapshot
    end
    Person->>Web: Download completed files
    Web->>API: GET file or POST ZIP download
    API->>Store: Read committed output
    API-->>Web: Image or ZIP stream
```

The API checks authorization, manifest limits, and per-slot admission before reading multipart data. Acknowledgement means upload bytes were accepted, not converted. An interrupted transfer leaves an unaccepted slot retryable; a matching operation-creation retry returns the existing operation, while changed intent returns `conversion_conflict`. Processing continues without status requests. The browser polls snapshots for display and reconciles uncertain network failures against server state before retrying.

A failed file preserves successful siblings and yields `partially_completed` when at least one completes. Cancellation requests stop later work cooperatively; an active encoder may finish, and committed results remain downloadable. Session expiry is fixed at creation. See [restart recovery](recover-conversion.md) for crash behavior.
