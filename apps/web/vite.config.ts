/// <reference types='vitest' />
import { defineConfig } from 'vite';
import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(() => ({
    root: __dirname,
    cacheDir: '../../node_modules/.vite/apps/web',
    server: {
        port: 4200,
        host: 'localhost',
    },
    preview: {
        port: 4300,
        host: 'localhost',
    },
    plugins: [!process.env.VITEST && reactRouter(), tailwindcss()],
    // Uncomment this if you are using workers.
    // worker: {
    //  plugins: [ nxViteTsPaths() ],
    // },
    build: {
        outDir: './dist',
        emptyOutDir: true,
        reportCompressedSize: true,
        commonjsOptions: {
            transformMixedEsModules: true,
        },
    },
    test: {
        name: '@image-web-convert/web',
        watch: false,
        globals: true,
        environment: 'jsdom',
        setupFiles: ['./app/setupTests.tsx'],
        include: [
            'app/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
        ],
        exclude: [
            // Build files
            "build/**/",
            "dist/**/",

            // Type declarations & generated files
            'out-tsc/**',
            '**/*.d.ts',
        ],
        reporters: ['default'],
        coverage: {
            reportsDirectory: './test-output/vitest/coverage',
            provider: 'v8' as const,
            exclude: [
                // Config files
                "**/{vite,postcss,tailwind,eslint,jest,tsup,webpack,rollup}*.{js,ts,mjs,cjs}",
                "*.config.{js,ts,mjs,cjs}",
                "**/*.config.{js,ts,mjs,cjs}",

                // React router
                ".react-router/**",
                "app/entry.client.tsx",
                "app/entry.server.tsx",

                // Build files
                "build/**/",
                "dist/**/",

                // App files without unit tests
                "app/routes.tsx",
                "app/routes/**/index.{ts,tsx}",

                // Type declarations & generated files
                'out-tsc/**',
                '**/*.d.ts',
            ],
        },
    },
}));
