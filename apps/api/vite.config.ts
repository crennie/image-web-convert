/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
    root: import.meta.dirname,
    cacheDir: '../../node_modules/.vite/apps/api',

    // No Vite plugins needed for a Node/Express test target.

    test: {
        name: '@image-web-convert/api',
        environment: 'node',
        globals: true,
        watch: false,
        include: [
            'src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}',
            '**/__tests__/**/*.{js,ts}',
        ],
        exclude: [
            'dist/**',
            'build/**',
            'node_modules/**',
            '.next/**',

            // Type declarations & generated files
            'out-tsc/**',
            '**/*.d.ts',
        ],
        setupFiles: ['./src/setupTests.ts'],
        reporters: ['default'],
        coverage: {
            provider: 'v8',
            reportsDirectory: './test-output/vitest/coverage',
            include: ['src/**/*.ts'],
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

                // Test support is not application coverage.
                'src/**/__tests__/**',
                'src/**/*.{test,spec}.ts',
                'src/setupTests.ts',
            ],
            // Measured on the PF-21 candidate with V8. Leave headroom for
            // instrumentation differences while guarding core boundaries.
            thresholds: {
                'src/controllers/conversion-upload.http.ts': {
                    lines: 90,
                    branches: 70,
                },
                'src/services/auth.service.ts': { lines: 95, branches: 90 },
                'src/services/conversion-runtime.service.ts': {
                    lines: 95,
                    branches: 85,
                },
                'src/services/conversion-storage.service.ts': {
                    lines: 90,
                    branches: 80,
                },
                'src/services/image.service.ts': { lines: 95, branches: 90 },
            },
        },
        // If your repo uses path aliases in tsconfig, uncomment this and install vite-tsconfig-paths
        // alias: {},
    },
});
