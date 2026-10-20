import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './src/screenshots',
    outputDir: './test-output/screenshots',
    reporter: [['list']],
    workers: 1,
    retries: 0,
    timeout: 60_000,
    use: {
        ...devices['Desktop Chrome'],
        screenshot: 'off',
        trace: 'off',
        video: 'off',
    },
});
