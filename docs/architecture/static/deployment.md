# Deployment

**Scope:** supported runtime topology and the same-origin routing boundary. This does not prescribe a hosting vendor.

```mermaid
flowchart LR
    browser["User browser<br/>React Router frontend"]
    frontend["Web server or platform<br/>Serves frontend and routes /api"]
    api["One persistent Node.js process<br/>Express API and scheduler"]
    volume[("Exclusive persistent storage<br/>UPLOAD_DIR and UPLOAD_TMP_DIR")]

    browser -->|HTTP(S): pages and /api| frontend
    frontend -->|HTTP /api| api
    api -->|Read/write session and image files| volume
```

In development, Vite serves the frontend on port 4200 and proxies `/api` to the API on port 4201. Production needs equivalent routing, or a browser-facing `VITE_API_URL` with matching API `CORS_ORIGIN`. Startup cleans request staging and recovers operations before listening; `/readyz` becomes ready after startup. The API process owns its storage root exclusively. Multiple API processes must not share it because admission, scheduling, claims, and leases are process-local. Graceful shutdown stops new work and drains active work for the configured grace period; a subsequent start reconciles interrupted work.
