import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Nx 21 creates unauthenticated local sockets. Keep plugin isolation (loading
// Vite plugins in-process can change NODE_ENV for builds), but contain sockets
// in a fresh owner-only directory until PF-12 upgrades to a patched major.
const temporaryRoot = fileURLToPath(new URL('../tmp/', import.meta.url));
mkdirSync(temporaryRoot, { recursive: true });
const socketDirectory = mkdtempSync(`${temporaryRoot}nx-`); // mode 0700
process.env.NX_SOCKET_DIR = socketDirectory;
process.env.NX_DAEMON = 'false';
process.env.NX_ISOLATE_PLUGINS = 'true';
process.on('exit', () => {
    rmSync(socketDirectory, { recursive: true, force: true });
});
await import('../node_modules/nx/bin/nx.js');
