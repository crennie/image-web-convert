import { test, expect } from '../support/application';
import { image } from '../support/conversion';

test('built SSR handles hostile URLs without script execution and keeps hydration usable', async ({
    page,
}) => {
    const attack = '</script><script>window.__ssrInjected = true</script>';
    await page.goto(`/conversion?key=${encodeURIComponent(attack)}`);
    await expect(
        page.getByRole('heading', { name: /convert/i }).first(),
    ).toBeVisible();
    expect(await page.evaluate(() => '__ssrInjected' in window)).toBe(false);
    // A hydrated control still works after SSR processes the hostile query.
    await page
        .locator('input[type="file"]')
        .setInputFiles(await image('security.png'));
    await expect(
        page.getByRole('button', { name: 'Start conversion', exact: true }),
    ).toBeEnabled();
    const missing = await page.request.get(
        `/missing-${encodeURIComponent(attack)}`,
    );
    expect(missing.status()).toBe(404);
    expect(await missing.text()).not.toContain('<script>window.__ssrInjected');

    // Bound the probe itself: many manifest paths, no recursive/unbounded bomb.
    const version = await page.evaluate(
        () =>
            (
                window as unknown as {
                    __reactRouterManifest: { version: string };
                }
            ).__reactRouterManifest.version,
    );
    const query = new URLSearchParams({
        version,
        paths: [
            '/conversion',
            ...Array.from({ length: 100 }, (_, i) => `/missing/${i}`),
        ].join(','),
    });
    const manifest = await page.request.get(`/__manifest?${query}`, {
        timeout: 5000,
    });
    expect(manifest.status()).toBe(200);
    expect(Object.keys(await manifest.json()).length).toBeGreaterThan(0);
    expect((await manifest.body()).length).toBeLessThan(128 * 1024);
    const healthy = await page.request.get('/conversion');
    expect(healthy.status()).toBe(200);
});
