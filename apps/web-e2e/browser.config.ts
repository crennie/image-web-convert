import { defineConfig, devices } from '@playwright/test';
import type { HarnessOptions } from './src/support/application';

export function browserConfig(suite: 'e2e' | 'integration', realApi: boolean) {
    return defineConfig<object, HarnessOptions>({
        testDir: `./src/${suite}`,
        outputDir: `./test-output/${suite}/results`,
        reporter: [
            ['list'],
            [
                'html',
                {
                    outputFolder: `./test-output/${suite}/report`,
                    open: 'never',
                },
            ],
        ],
        fullyParallel: false,
        workers: 1,
        forbidOnly: !!process.env.CI,
        // A flaky first attempt must fail CI, not become green after a retry.
        retries: 0,
        timeout: 30_000,
        expect: { timeout: 10_000 },
        globalTimeout: 300_000,
        use: {
            realApi,
            actionTimeout: 10_000,
            navigationTimeout: 15_000,
            screenshot: 'only-on-failure',
            // Network traces contain session tokens and response bodies. Retain
            // screenshots, reports, and process logs instead of credential traces.
            trace: 'off',
            video: 'off',
        },
        projects: [
            { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
            { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
            { name: 'webkit', use: { ...devices['Desktop Safari'] } },
        ],
    });
}
