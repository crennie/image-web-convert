import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { Page } from '@playwright/test';
import { test, expect } from '../support/application';

const destination = path.resolve(__dirname, '../../../../docs/screenshots');

async function syntheticImage(
    name: string,
    background: string,
    accent: string,
) {
    const svg = `<svg width="800" height="600" xmlns="http://www.w3.org/2000/svg">
        <rect width="800" height="600" fill="${background}"/>
        <circle cx="240" cy="270" r="150" fill="${accent}"/>
        <path d="M0 520 L330 230 L540 450 L680 300 L800 460 L800 600 L0 600 Z" fill="#ffffff" opacity=".55"/>
    </svg>`;
    return {
        name,
        mimeType: 'image/png',
        buffer: await sharp(Buffer.from(svg)).png().toBuffer(),
    };
}

async function select(
    page: Page,
    files: { name: string; mimeType: string; buffer: Buffer }[],
) {
    await page.goto('/conversion');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Choose images' }).click();
    await (await chooser).setFiles(files);
    await expect(
        page.getByRole('button', { name: 'Start conversion' }),
    ).toBeEnabled();
}

async function capture(page: Page, name: string) {
    await mkdir(destination, { recursive: true });
    await page.screenshot({
        path: path.join(destination, name),
        fullPage: true,
        animations: 'disabled',
    });
}

test('captures selection, real upload, and partial results', async ({
    page,
}) => {
    const files = [
        await syntheticImage('amber-circles.png', '#e8ba65', '#a04431'),
        await syntheticImage('blue-landscape.png', '#93c9dd', '#285886'),
        {
            name: 'broken-sample.png',
            mimeType: 'image/png',
            buffer: Buffer.from('invalid synthetic image'),
        },
    ];
    await select(page, files);
    await capture(page, 'selection-desktop.png');

    let releaseUploads: () => void = () => undefined;
    const uploadGate = new Promise<void>((resolve) => {
        releaseUploads = resolve;
    });
    await page.route(
        '**/api/sessions/*/conversions/*/files/*',
        async (route) => {
            await uploadGate;
            await route.continue();
        },
    );
    await page.getByRole('button', { name: 'Start conversion' }).click();
    await expect(
        page.getByRole('region', { name: 'Conversion operation' }),
    ).toBeVisible();
    await capture(page, 'upload-desktop.png');
    releaseUploads();
    await expect(page.getByRole('status')).toContainText(
        'Operation: partially completed',
    );
    await capture(page, 'partial-desktop.png');
    await page.setViewportSize({ width: 375, height: 812 });
    await capture(page, 'partial-mobile.png');
});

test('captures completed results on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await select(page, [
        await syntheticImage('amber-circles.png', '#e8ba65', '#a04431'),
        await syntheticImage('blue-landscape.png', '#93c9dd', '#285886'),
    ]);
    await capture(page, 'selection-mobile.png');
    await page.getByRole('button', { name: 'Start conversion' }).click();
    await expect(page.getByRole('status')).toContainText(
        'Operation: completed',
    );
    await page.getByRole('button', { name: 'Files (2)' }).click();
    await capture(page, 'completed-mobile.png');
});
