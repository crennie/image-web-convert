import { firstImage } from '../fixtures/images';
import { test, expect } from '../support/application';

test('built SSR keeps missing-page details private and makes no font request', async ({
    page,
}) => {
    const fontRequests: string[] = [];
    page.on('request', (request) => {
        if (
            request.resourceType() === 'font' ||
            /fonts\.googleapis\.com|fonts\.gstatic\.com/.test(request.url())
        )
            fontRequests.push(request.url());
    });
    await page.goto('/');
    await expect(
        page.getByRole('heading', { name: 'Image Web Convert' }),
    ).toBeVisible();
    const response = await page.goto('/missing-private-page');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('alert')).toContainText('Page not found');
    await expect(page.getByRole('alert')).not.toContainText(
        '/missing-private-page',
    );
    expect(fontRequests).toEqual([]);
});

for (const colorScheme of ['light', 'dark'] as const) {
    for (const width of [375, 1280]) {
        test(`${colorScheme} theme has filled controls and readable surfaces at ${width}px`, async ({
            page,
        }) => {
            await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
            await page.setViewportSize({ width, height: 900 });
            await page.goto('/');
            const body = page.locator('body');
            await expect(body).toHaveCSS('color-scheme', colorScheme);
            await expect(body).toHaveCSS('font-family', /system-ui/);
            await expect(body).toHaveCSS('background-image', /radial-gradient/);
            const background = await body.evaluate(
                (element) => getComputedStyle(element).backgroundColor,
            );
            const convert = page.getByRole('link', { name: 'Convert Files' });
            await expect(convert).toHaveCSS(
                'background-color',
                colorScheme === 'light'
                    ? 'rgb(8, 107, 100)'
                    : 'rgb(128, 222, 208)',
            );
            await convert.focus();
            await expect(convert).toHaveCSS('outline-style', 'solid');
            await expect(convert).toHaveCSS('outline-width', '3px');
            await convert.click();
            await expect(
                page.getByRole('heading', { name: 'Convert images' }),
            ).toBeVisible();
            await expect(body).toHaveCSS('background-color', background);
            await expect(body).toHaveCSS('background-image', /radial-gradient/);
            await expect(
                page.getByRole('combobox', { name: 'Output format' }),
            ).toHaveCount(0);
            await page.locator('input[type=file]').setInputFiles(firstImage);
            const select = page.getByRole('combobox', {
                name: 'Output format',
            });
            await expect(select).toHaveCSS(
                'background-color',
                colorScheme === 'light'
                    ? 'rgb(255, 255, 255)'
                    : 'rgb(25, 43, 56)',
            );
            await select.selectOption('image/png');
            await expect(select).toHaveValue('image/png');
            await expect(
                page.getByRole('button', { name: 'Start conversion' }),
            ).toBeEnabled();
            await expect(
                page.getByRole('button', {
                    name: 'Choose images',
                    exact: true,
                }),
            ).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
            // Validate actual rendered text/surface contrast, including native controls.
            for (const locator of [
                body,
                select,
                page.getByRole('button', {
                    name: 'Choose images',
                    exact: true,
                }),
            ]) {
                const contrast = await locator.evaluate((element) => {
                    const style = getComputedStyle(element);
                    const luminance = (color: string) => {
                        const channels = (color.match(/[\d.]+/g) ?? [])
                            .slice(0, 3)
                            .map(Number)
                            .map((value) => {
                                const channel = value / 255;
                                return channel <= 0.04045
                                    ? channel / 12.92
                                    : ((channel + 0.055) / 1.055) ** 2.4;
                            });
                        return (
                            channels[0] * 0.2126 +
                            channels[1] * 0.7152 +
                            channels[2] * 0.0722
                        );
                    };
                    const text = luminance(style.color);
                    const surface = luminance(style.backgroundColor);
                    return (
                        (Math.max(text, surface) + 0.05) /
                        (Math.min(text, surface) + 0.05)
                    );
                });
                expect(contrast).toBeGreaterThanOrEqual(4.5);
            }
            expect(
                await page.evaluate(
                    () =>
                        document.documentElement.scrollWidth <=
                        window.innerWidth,
                ),
            ).toBe(true);
        });
    }
}
