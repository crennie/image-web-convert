# Conversion API components

**Scope:** the Express API container in the [container view](../containers.md). This C4 component view follows the active conversion operation workflow; legacy sealed-session download handlers remain mounted for existing records.

```mermaid
flowchart LR
    browser["Browser client"]
    http["HTTP routes and controllers<br/>Authorization, limits, multipart admission, responses"]
    runtime["Conversion runtime<br/>Operation admission, upload claims, FIFO scheduling, expiry"]
    model["Conversion transitions<br/>Validated operation and file state changes"]
    image["Image processor<br/>Sharp conversion; HEIC preprocessing"]
    storage["Conversion storage<br/>Serialized mutations, artifacts, receipts, recovery"]
    files["Download routes and service<br/>Commit checks, file and ZIP streaming"]
    disk[("Session filesystem")]

    browser -->|"HTTP commands and status requests"| http
    http -->|"Create, read, upload, cancel"| runtime
    http -->|"Resolve completed outputs"| files
    runtime -->|"Applies transitions"| model
    runtime -->|"Converts one file at a time"| image
    runtime -->|"Persists state and outputs"| storage
    storage -->|"Reads and writes records and artifacts"| disk
    files -->|"Streams verified outputs"| disk
    files -->|"Checks committed output via runtime"| runtime
```

The HTTP boundary validates the session bearer token before reading an upload body. `conversion-runtime.service.ts` owns process-local admission, scheduling, expiry, and shutdown. `conversions.service.ts` defines state transitions; `conversion-storage.service.ts` serializes mutations and verifies committed output before download. `image.service.ts` wraps encoding. Status GETs read snapshots and do not drive scheduling.

The process entrypoint removes abandoned request staging and starts recovery before listening. Storage failures that make scheduling unsafe affect readiness; invalid records are isolated by session. See [conversion processing](../../dynamic/process-conversion.md) and [restart recovery](../../dynamic/recover-conversions.md).
