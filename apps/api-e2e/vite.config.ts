/// <reference types='vitest' />
import { defineConfig } from 'vite';

export default defineConfig(() => ({
    root: __dirname,
    cacheDir: '../../node_modules/.vite/apps/api-e2e',
    plugins: [],
    // Uncomment this if you are using workers.
    // worker: {
    //  plugins: [ nxViteTsPaths() ],
    // },
    test: {
        name: '@image-web-convert/api-e2e',
        watch: false,
        globals: true,
        environment: 'jsdom',
        include: [
            '{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
        ],
        reporters: ['default'],
        coverage: {
            reportsDirectory: './test-output/vitest/coverage',
            provider: 'v8' as const,
        },
    },
}));
