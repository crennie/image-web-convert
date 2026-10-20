# Schemas library

Shared Zod contracts for image formats, sessions, asynchronous conversion operations, downloads, and API errors. The API validates requests and stored metadata with these schemas; the web app validates responses and uses the same image limits.

Exports are in [`src/index.ts`](src/index.ts). From the repository root, run `node tools/nx.mjs test @image-web-convert/schemas` or `node tools/nx.mjs build @image-web-convert/schemas`.
