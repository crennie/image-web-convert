# Container view

**Scope:** Image Web Convert. These are runtime and deployment boundaries, rather than Nx packages or Docker containers. The [context view](context.md) shows the surrounding user.

```mermaid
flowchart LR
    user["User<br/>Chooses and downloads images"]
    browser["Browser client<br/>React UI; selects files, uploads slots, polls snapshots"]
    web["Web server<br/>React Router on Node.js; serves the frontend"]
    api["Conversion API<br/>Express on Node.js; authenticates, schedules, converts, serves results"]
    disk[("Filesystem storage<br/>Session records, inputs, output files, commit receipts")]

    user -->|"Uses UI"| browser
    browser -->|"Loads pages and assets over HTTP"| web
    browser -->|"Calls /api over HTTP with session bearer token"| api
    api -->|"Reads and writes session data and artifacts"| disk
    api -->|"Returns snapshots and file or ZIP streams"| browser
```

The browser-facing `/api` path is proxied to the API by Vite during development. A deployment needs equivalent routing, or a configured `VITE_API_URL` and matching API CORS origin. React Router server rendering is enabled. The browser retains session credentials only in the active page session; the API stores their hashes in session records.

`libs/schemas` supplies Zod HTTP contracts to both applications. `libs/ui` supplies reusable React UI, while `libs/node-shared` and `libs/observability` support Node code. They are source libraries inside the above containers, not separate runtime services. See [API components](components/api.md) and [deployment](deployment.md).
