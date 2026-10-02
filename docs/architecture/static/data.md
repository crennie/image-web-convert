# Data and Persistence

**Scope:** the API's local filesystem model for active conversion operations. [`storage.paths.ts`](../../../apps/api/src/services/storage.paths.ts) and storage schemas define exact paths and fields.

```mermaid
flowchart TB
    root[("UPLOAD_DIR<br/>Default: data/uploads")]
    session["Session directory<br/>session.info.json: expiry, token hash"]
    operation["conversion.info.json<br/>Operation, file states, accepted-input fingerprints"]
    inputs["inputs/{fileId}<br/>Accepted source bytes"]
    output["{fileId}.{format} + {fileId}.json<br/>Committed image and metadata"]
    receipt[".conversion-commits/{fileId}.json<br/>Publication evidence"]
    staging[".conversion-staging/<id><br/>Incomplete publication"]
    temp[("UPLOAD_TMP_DIR<br/>Default: data/tmp; incomplete request bodies")]

    root -->|Contains one directory per session| session
    session -->|Owns one active operation record| operation
    operation -->|References accepted slots| inputs
    operation -->|Records completed outcomes| output
    receipt -->|Proves a completed output during recovery| output
    session -->|Contains| receipt
    session -->|Contains| staging
    temp -->|Accepted upload moves into| inputs
```

The token hash stays in the session record; public operation snapshots are an allowlisted projection. Operation state is written atomically and validated when read. Accepted inputs have byte count and SHA-256 fingerprints. Per-file output receipts allow restart recovery to recognize a completed publication even if the operation snapshot was interrupted. Temporary request bodies and incomplete output staging are removed after settlement or on startup. Expired active operation directories are removed only after active conversion and download leases finish; legacy-only session directories are outside that operation sweep.
