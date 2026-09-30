# Data and persistence

**Scope:** authoritative data for the active conversion workflow under the API filesystem root. This is a logical ownership view; [`storage.paths.ts`](../../../apps/api/src/services/storage.paths.ts) and the storage schemas define exact paths and fields.

```mermaid
flowchart TB
    root["UPLOAD_DIR / session-id"]
    session["session.info.json<br/>Session identity, expiry, token hash"]
    operation["conversion.info.json<br/>Operation, ordered slots, input fingerprints"]
    inputs["inputs/file-id<br/>Accepted source bytes"]
    output["file-id.ext + file-id.json<br/>Converted bytes and metadata"]
    receipt[".conversion-commits/file-id.json<br/>Output fingerprint and commit evidence"]
    staging[".conversion-staging/temporary-id<br/>Uncommitted output"]
    request["UPLOAD_TMP_DIR/conversion-*<br/>Incomplete multipart request"]

    root -->|"Contains"| session
    root -->|"Contains at most one"| operation
    root -->|"Contains"| inputs
    root -->|"Contains"| output
    root -->|"Contains"| receipt
    root -->|"Contains transient files"| staging
    request -->|"Promoted only after validation"| inputs
    operation -->|"References accepted input and completed output by file ID"| inputs
    receipt -->|"Proves publication of"| output
```

The session record owns authentication and expiry. The operation record owns manifest membership, state revisions, per-file outcomes, and accepted input fingerprints; response counts are derived rather than separately stored. Completed output publication writes the image and metadata, then a receipt, then the updated operation snapshot. A download requires a completed slot and matching receipt, metadata, and output fingerprint. Recovery reconciles a valid receipt after a crash between publication and snapshot persistence. A processing slot with no receipt becomes `processing_interrupted`; corrupt commit evidence isolates the session for investigation.

Temporary request bodies are outside authoritative session storage. Input bytes and operation records share the storage root so the API can reconcile promotion and commit steps. The storage layer uses serialized local mutations and filesystem atomic writes, but the files do not form a single database transaction. Legacy sealed sessions use the older file layout and remain readable until their original expiry.
