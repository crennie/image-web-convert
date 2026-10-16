import { test, expect } from '../support/application';

test('background moves, pauses, and respects a live reduced-motion preference', async ({
    page,
}) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    const canvas = page.locator('canvas.particle-background');
    await expect(canvas).toBeVisible();
    const snapshot = () =>
        canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
    const initial = await snapshot();
    await expect.poll(snapshot).not.toBe(initial);
    await page.getByRole('button', { name: 'Pause background' }).click();
    const resume = page.getByRole('button', { name: 'Resume background' });
    await expect(resume).toHaveAttribute('aria-pressed', 'true');
    // Compare across multiple browser paint cycles, without a fixed timeout.
    const isStill = () =>
        canvas.evaluate(async (element: HTMLCanvasElement) => {
            const before = element.toDataURL();
            for (let index = 0; index < 5; index++) {
                await new Promise(requestAnimationFrame);
            }
            return before === element.toDataURL();
        });
    expect(await isStill()).toBe(true);
    await resume.click();
    const resumed = await snapshot();
    await expect.poll(snapshot).not.toBe(resumed);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(
        page.getByRole('button', { name: 'Pause background' }),
    ).toBeHidden();
    expect(await isStill()).toBe(true);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect(
        page.getByRole('button', { name: 'Pause background' }),
    ).toBeVisible();
    const restarted = await snapshot();
    await expect.poll(snapshot).not.toBe(restarted);
});

test('brand assets load at header and favicon sizes', async ({ page }) => {
    await page.goto('/');
    const logo = page.getByAltText('Site logo');
    await expect(logo).toHaveAttribute('src', '/logo.svg');
    await expect(logo).toHaveCSS('width', '40px');
    await expect(logo).toHaveCSS('height', '40px');
    expect(
        await logo.evaluate(
            (element: HTMLImageElement) =>
                element.complete && element.naturalWidth > 0,
        ),
    ).toBe(true);
    for (const href of ['/favicon.svg', '/favicon.ico']) {
        await expect(
            page.locator(`link[rel="icon"][href="${href}"]`),
        ).toHaveCount(1);
        expect((await page.request.get(href)).ok()).toBe(true);
    }
});
