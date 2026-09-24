import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
    ssr: {
        external: [
            '@image-web-convert/node-shared',
            '@image-web-convert/observability',
            '@image-web-convert/schemas',
        ],
    },
    build: {
        ssr: path.resolve(__dirname, 'src/support/controlled-api.ts'),
        outDir: path.resolve(__dirname, 'test-output/server'),
        rollupOptions: { output: { entryFileNames: 'controlled-api.mjs' } },
    },
});
