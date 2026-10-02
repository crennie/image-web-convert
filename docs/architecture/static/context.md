# System Context

**Scope:** Image Web Convert as one system. The browser and API shown in lower-level views are inside this boundary.

```mermaid
flowchart LR
    person["Person converting images"]
    system["Image Web Convert<br/>Uploads, converts, and serves images"]
    person -->|Selects images and format; downloads results| system
    system -->|Shows upload, processing, and file outcomes| person
```

The person uses the browser workflow. Conversion, session authorization, storage, and downloads are provided by this system. The current application has no required external service or external datastore. See the [container view](containers.md) for its runtime elements.
