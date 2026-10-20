# UI library

Shared React components, session context, and file-selection hooks for the web app. The active conversion route uses `useFileItems`, `useDropzone`, and `FILE_UPLOAD_CONFIG`; it owns upload transport, progress, and downloads itself.

The public entry point is [`src/index.ts`](src/index.ts). Run unit tests with `node tools/nx.mjs test @image-web-convert/ui` from the repository root. Build with `node tools/nx.mjs build @image-web-convert/ui`.
