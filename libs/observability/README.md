# Observability library

API logging, request IDs, Express error translation, and optional OpenTelemetry setup. Configuration and redaction are implemented here; the API owns startup and bounded shutdown.

Exports are in [`src/index.ts`](src/index.ts). From the repository root, run `node tools/nx.mjs test @image-web-convert/observability` or `node tools/nx.mjs build @image-web-convert/observability`.
