import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Keep plugin isolation (loading Vite plugins in-process can change NODE_ENV
// for builds) and place local sockets in a fresh owner-only directory.
const temporaryRoot = fileURLToPath(new URL('../tmp/', import.meta.url));
mkdirSync(temporaryRoot, { recursive: true });
const socketDirectory = mkdtempSync(`${temporaryRoot}nx-`); // mode 0700
process.env.NX_SOCKET_DIR = socketDirectory;
process.env.NX_DAEMON = 'false';
process.env.NX_ISOLATE_PLUGINS = 'true';
process.on('exit', () => {
    rmSync(socketDirectory, { recursive: true, force: true });
});
await import('../node_modules/nx/dist/bin/nx.js');
