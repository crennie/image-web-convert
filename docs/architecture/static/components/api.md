# API Components

**Scope:** the Express API process in the [container view](../containers.md). Arrows show the main call or data direction.

```mermaid
flowchart LR
    web["Web application"]
    http["HTTP adapters<br/>Routes, controllers, auth, upload receiver"]
    runtime["Conversion runtime<br/>Admission, leases, FIFO scheduling, expiry"]
    state["Conversion transitions<br/>Manifest and file state rules"]
    store["Conversion storage<br/>Durable acceptance, commits, recovery"]
    encoder["Image service<br/>Sharp / HEIC handling"]
    files["File download service<br/>Individual files and ZIP"]
    disk[("Local filesystem")]

    web -->|/api requests with session token| http
    http -->|Create, upload, read, cancel| runtime
    http -->|Resolve downloads| files
    runtime -->|Apply lifecycle rules| state
    runtime -->|Persist/read operation and file results| store
    runtime -->|Convert accepted inputs| encoder
    store -->|Read/write records, inputs, receipts, outputs| disk
    encoder -->|Read accepted input| disk
    files -->|Read completed output| disk
```

The HTTP adapters authenticate and validate requests before staging upload bodies. The runtime admits operations and per-slot uploads, owns the one-file-at-a-time worker, and holds leases so expiry cleanup waits for active use. Pure transition functions define valid operation and file states. Storage serializes mutations and publishes each output with commit evidence. The file service streams completed images and ZIP archives independently of sibling file outcomes. `libs/schemas` defines public request and snapshot contracts used by both browser and API.
