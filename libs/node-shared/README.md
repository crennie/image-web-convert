# Node shared library

Small Node-only helpers for generating filesystem-safe IDs and resolving configured paths. This library is used by the API and observability workspaces; it is not browser code.

Exports are in [`src/index.ts`](src/index.ts). From the repository root, run `node tools/nx.mjs test @image-web-convert/node-shared` or `node tools/nx.mjs build @image-web-convert/node-shared`.
