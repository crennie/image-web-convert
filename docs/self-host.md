# Private self-host setup

This recipe runs one persistent API process and one production React Router SSR
process behind a same-origin proxy. It targets a trusted operator on Linux ARM64
with Node.js **24.22.0** and npm **11.19.1**. Do not expose anonymous uploads to
untrusted internet clients; that deployment needs the separate [public-host
gate](plans/project-finalization.md#pf-20--public-host-readiness-decision-and-gate-public-deferred).

## Build from a clean checkout

Run these commands from the repository root. The lockfile pins the application
dependencies; no private agent container image is needed.

```sh
npm ci
NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false npm run build
NX_SKIP_NATIVE_FILE_CACHE=true NX_DAEMON=false node tools/nx.mjs run @image-web-convert/api:prune
```

The resulting API entry is `apps/api/dist/main.js`; the SSR entry is
`apps/web/build/server/index.js`, with browser assets in
`apps/web/build/client`. The `api:prune` target prepares the API's production
package and lockfile. After building, install the two production closures:

```sh
npm ci --omit=dev
npm ci --omit=dev --prefix apps/api/dist
```

The root installation serves SSR; the **separate API artifact installation**
supplies the API's bundled workspace libraries and native dependencies. A root
production install alone does not supply those API libraries. If copying to
another host, copy the root package/lockfile and workspace package manifests,
the complete web build, and the entire `apps/api/dist` directory including its
`workspace_modules` and lockfile; run the two production install commands on
that host. Use the same Node major version and platform for native codecs, or
build/install on the target host. Keep the processes under a service supervisor
that restarts on failure.

## Start the processes

Create private, persistent paths outside the checkout's build outputs. These
example paths are local to the host; choose a location with enough space for
accepted inputs, converted outputs, temporary bodies, and logs.

```sh
mkdir -p data/uploads data/tmp logs
chmod 700 data data/uploads data/tmp logs
umask 077
```

In separate supervised shells, from the repository root:

```sh
NODE_ENV=production PORT=4201 UPLOAD_DIR="$PWD/data/uploads" UPLOAD_TMP_DIR="$PWD/data/tmp" OTEL_LOG_FILE="$PWD/logs/api.log" node apps/api/dist/main.js
```

```sh
NODE_ENV=production HOST=127.0.0.1 PORT=4200 ./node_modules/.bin/react-router-serve apps/web/build/server/index.js
```

The API binds all interfaces; **block direct access to port 4201** with the
host firewall or an equivalent network boundary. The SSR process is bound to
loopback in this example. Keep one API process per storage root: admission,
conversion scheduling, and download leases are process-local. Do not run
multiple API replicas over a shared volume.

Check `curl --fail http://127.0.0.1:4201/readyz` for `{ "status": "ready" }`
after startup and `curl --fail http://127.0.0.1:4200/conversion` for the SSR
page. `/healthz` reports liveness; `/readyz` stays unavailable during startup
recovery or a fatal storage fault. Send `SIGTERM` to the API for shutdown; it
stops new work and drains within `CONVERSION_SHUTDOWN_GRACE_MS` (10 seconds by
default). Restarting the same single process reconciles interrupted work from
disk. Keep `data/uploads` across restarts; clearing `data/tmp` manually is not
needed because startup removes abandoned request staging.

## Route the browser through one origin

For a local private install, this Caddyfile sends `/api/*` to Express and all
other paths to the SSR server without removing the `/api` prefix:

```caddyfile
http://localhost:8080 {
    handle /api/* {
        reverse_proxy 127.0.0.1:4201
    }
    handle {
        reverse_proxy 127.0.0.1:4200
    }
}
```

With Caddy installed, save it as `Caddyfile` and run
`caddy run --config Caddyfile`. Open <http://localhost:8080/conversion>. Use TLS at the proxy for
any non-loopback browser connection and restrict access to trusted users; the
example deliberately listens only on localhost. Preserve the SSR security
headers and the API's `Cache-Control: private, no-store`. Do not put a shared
cache in front of authenticated `/api` responses. The API's `CORS_ORIGIN`
defaults to disabled because the browser uses the same origin.

Leave `TRUSTED_PROXY_IPS` empty for this trusted local setup unless accurate
client-IP rate limits through the proxy are needed. If enabled, list only the
exact API-facing proxy peer addresses and make that proxy replace or append the
real client address to `X-Forwarded-For`; keep direct API access blocked. A
cross-origin browser deployment instead requires `VITE_API_URL` **at build
time** and a matching `CORS_ORIGIN`, as described in the [README](../README.md#api-url-configuration).

## Convert and operate

Open `/conversion`, choose files and an output format, then start the batch.
The UI shows network upload progress and the API's file states. Download each
completed image or a ZIP before the session expires. Partial successes remain
downloadable. There is no browser-session recovery after a refresh or closed
tab; keep the page open until downloads finish. The default session lifetime is
15 minutes from creation, including upload and queue time. Expired operation,
empty, and legacy session directories are removed by the background sweep once
active work and downloads release their leases.

The API defaults to 20 files, 20 MB per file, 500 MB declared total, two
concurrent uploads and one active conversion. Its multipart decoder buffers
each bounded upload. Reserve **2 GiB RAM for the API** with the default 20 MP
input ceiling; this is an operating recommendation, not a hard native decoder
limit. HEIC preprocessing and Sharp work can still consume memory and CPU before
cooperative timeouts settle. See [limits, deadlines, and
storage](../README.md#limits-deadlines-and-storage) for every environment
setting and [resource measurements](../README.md#limits-deadlines-and-storage)
for the measured fixtures. The API also accepts `APP_VERSION` (health output),
`PORT`, `CORS_ORIGIN`, `ENABLE_OTEL` (off by default), and `OTEL_LOG_FILE`
(default `logs/app.log` relative to the API working directory). When telemetry
is enabled, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_TRACES_SAMPLER`,
`OTEL_TRACES_SAMPLER_ARG`, `OTEL_METRICS_EXPORTER`, `OTEL_LOGS_EXPORTER`,
`OTEL_ENVIRONMENT`, `OTEL_SERVICE_NAME`, `OTEL_ENABLE`, `LOG_LEVEL`, and
`LOG_PRETTY` control the optional OpenTelemetry SDK; leave it disabled unless a
collector is set up.

Keep the storage and log directories readable only by the service account.
Session bearer tokens are held in browser memory and sent with API calls;
do not capture their headers or response bodies in proxy logs or support
artifacts. Back up the persistent upload directory only under a private data
policy. Before upgrading, stop the API, preserve that directory, and deploy a
built revision plus its matching lockfile as one unit. [PF-21](plans/project-finalization.md#pf-21--final-release-candidate-verification-p1-pending)
records the final release rollback procedure and candidate versions.
