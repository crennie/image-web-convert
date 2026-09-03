# Image Web Convert

Image Web Convert is a small Nx monorepo for converting uploaded images to
web-friendly formats. The Express API uses Sharp for conversion and the React
Router frontend provides the browser workflow.

## Setup and development

Use Node.js 22 and npm 10 or newer. Install the locked dependencies and start
the frontend and API with:

```sh
npm ci
NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false npm run dev
```

The usual validation commands are:

```sh
NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false npm run lint
NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false npm run typecheck
NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false npm test
NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false npm run build
NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false npx nx e2e @image-web-convert/api-e2e
```

Nx Cloud may warn that this local workspace is unconnected; that does not
prevent local commands from running.

### API URL configuration

The browser uses `/api` by default. During local development, Vite proxies that
same-origin path to the API process at `http://localhost:4201`. This keeps the
browser-facing URL consistent with a production deployment where a reverse
proxy or application platform routes `/api` to the Express service.

Set `API_PROXY_TARGET` when the local API process is available at a different
origin. Set `VITE_API_URL` at frontend build time only when a deployment exposes
the API at a different browser-facing base URL; cross-origin deployments must
also configure the API's `CORS_ORIGIN` appropriately.

## Repository layout

- `apps/web` contains the React Router frontend.
- `apps/api` contains Express routes/controllers, application services, image
  processing, and filesystem storage.
- `apps/api-e2e` exercises the running Express middleware and routing stack.
- `libs/schemas` contains shared Zod request, response, error, and limit
  contracts used at application boundaries.
- `libs/ui`, `libs/node-shared`, and `libs/observability` contain reusable UI,
  Node, and telemetry code.

## Request lifecycle and storage

The browser creates a short-lived session, uploads one multipart batch, and
validates responses with the shared schemas. The API validates the token,
manifest, output MIME, and effective limits; converts each image; stores the
successful output and metadata sidecar; updates counts; and seals the session.
Once sealed, metadata and converted files can be downloaded individually or as
an ordered ZIP.

Backend environment settings are authoritative. Defaults are 20 files,
20,000,000 bytes per file, 500,000,000 bytes for the session, and a 15-minute
session lifetime (`SESSION_MAX_FILES`, `SESSION_PER_FILE_BYTES`,
`SESSION_MAX_TOTAL_BYTES`, and `SESSION_TTL_MINUTES`). The create-session
response exposes these effective limits so the frontend can apply the same
boundary rules.

`apps/api/src/services/storage.paths.ts` owns path construction. By default,
session data is under `data/uploads/<session-id>/`: `session.info.json` stores
session state, each accepted image has a `<file-id>.json` metadata sidecar, and
the converted asset uses its generated stored name. `UPLOAD_DIR` can isolate or
relocate this root. Multipart temporary files use `UPLOAD_TMP_DIR` (default
`data/tmp`).

Temporary files are removed after conversion and on request rejection. Failed
conversions remove partial output and metadata; if session-state persistence
fails after conversions, accepted artifacts from that batch are rolled back.
One file may fail without discarding successful files: the API returns HTTP 207
with accepted and rejected entries, then seals the session. An all-rejected
batch also seals the session with unchanged counts. Each session therefore
accepts exactly one completed upload batch.

The upload application service holds a minimal per-session in-memory claim so
two concurrent requests cannot both convert against the same unsealed session.
Claims for different sessions are independent and claims are released on both
success and failure. This guarantee is intentionally single-process; running
multiple API processes would require coordination outside this application.

The progress shown while a request is active is cosmetic and simulated. It does
not report uploaded bytes or backend conversion stages, and it cannot complete
the workflow independently of the API response. Real transport and conversion
progress is a future capability.

## License

Licensed under the MIT License. See [LICENSE](./LICENSE). Security reports are
covered by [SECURITY.md](./SECURITY.md).
