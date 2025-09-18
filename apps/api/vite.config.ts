/// <reference types="vitest" />
import { defineConfig } from 'vite';

export default defineConfig({
    root: __dirname,
    cacheDir: '../../node_modules/.vite/apps/api',

    // No Vite plugins needed for a Node/Express test target.

    test: {
        name: '@image-web-convert/api',
        environment: 'node',
        globals: true,
        watch: false,
        include: [
            'src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}',
            '**/__tests__/**/*.{js,ts}'
        ],
        setupFiles: ['./src/setupTests.ts'],
        reporters: ['default'],
        coverage: {
            provider: 'v8',
            reportsDirectory: './test-output/vitest/coverage',
            exclude: [
                // Config & build artifacts
                '**/*.{config,conf}.{js,ts,mjs,cjs}',
                '**/{vite,postcss,tailwind,eslint,jest,tsup,webpack,rollup}*.{js,ts,mjs,cjs}',
                'dist/**',
                'build/**',
                'node_modules/**',
                '.next/**',

                // Type declarations & generated files
                'out-tsc/**',
                '**/*.d.ts',
            ]
        },
        // If your repo uses path aliases in tsconfig, uncomment this and install vite-tsconfig-paths
        // alias: {},
    },
});
