# Containers

**Scope:** Image Web Convert. The filesystem is shown as a data store because its ownership and durability affect runtime behavior.

```mermaid
flowchart LR
    person["Person converting images"]
    web["Web application<br/>React Router / browser workflow"]
    api["API process<br/>Express / conversion scheduler / Sharp"]
    disk[("Local filesystem<br/>Sessions, inputs, outputs, commit evidence")]

    person -->|Selects files, starts work, downloads| web
    web -->|HTTP(S) /api: sessions, manifests, uploads, status, cancellation, downloads| api
    api -->|Reads and writes session and conversion records, image files| disk
    api -->|Returns authoritative snapshots and completed files| web
```

The web application owns selected browser files, upload byte progress, polling, and presentation. The API owns admission, session bearer-token checks, state transitions, conversion scheduling, and downloads. Shared Zod schemas define the boundary contracts; `libs/ui`, `libs/node-shared`, and `libs/observability` are libraries, not separate runtime containers.

The API's scheduler and storage claims are process-local. A deployment must give one persistent API process exclusive ownership of its storage root. See [deployment](deployment.md) and the [API component view](components/api.md).
