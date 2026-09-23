import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import type { Page, Locator, TestInfo } from '@playwright/test';
import { ApiConversionOperationSchema } from '@image-web-convert/schemas';
import { expect } from './application';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { zipEntries } from '../../../api-e2e/src/support/zip';

export async function image(name: string) {
    return {
        name,
        mimeType: 'image/png',
        buffer: await sharp({
            create: {
                width: 32,
                height: 24,
                channels: 3,
                background: '#1450a0',
            },
        })
            .png()
            .toBuffer(),
    };
}
export async function submit(
    page: Page,
    files: { name: string; mimeType: string; buffer: Buffer }[],
) {
    await page.goto('/conversion');
    const choose = page.getByRole('button', {
        name: 'Choose images',
        exact: true,
    });
    await expect(choose).toBeEnabled();
    const chooser = page.waitForEvent('filechooser');
    await choose.click();
    await (await chooser).setFiles(files);
    const created = page.waitForResponse(
        (response) =>
            response.request().method() === 'POST' &&
            /\/conversions$/.test(response.url()),
    );
    await page
        .getByRole('button', { name: 'Start conversion', exact: true })
        .click();
    const response = await created;
    expect(response.status()).toBe(201);
    return ApiConversionOperationSchema.parse(await response.json());
}
export async function download(
    page: Page,
    button: Locator,
    info: TestInfo,
    name: string,
) {
    const event = page.waitForEvent('download');
    await button.click();
    const result = await event;
    expect(await result.failure()).toBeNull();
    const file = info.outputPath(name);
    await result.saveAs(file);
    return readFile(file);
}
export async function verifyImage(bytes: Buffer) {
    expect(await sharp(bytes).metadata()).toMatchObject({
        format: 'webp',
        width: 32,
        height: 24,
    });
    const decoded = await sharp(bytes).removeAlpha().raw().toBuffer();
    expect(decoded.length).toBe(32 * 24 * 3);
    expect(Math.abs(decoded[0] - 20)).toBeLessThanOrEqual(5);
    expect(Math.abs(decoded[1] - 80)).toBeLessThanOrEqual(5);
    expect(Math.abs(decoded[2] - 160)).toBeLessThanOrEqual(5);
}
export async function verifyZip(bytes: Buffer, names: string[]) {
    const entries = zipEntries(bytes);
    expect([...entries.keys()]).toEqual(names);
    for (const entry of entries.values()) await verifyImage(entry);
}
export function imageButton(page: Page, name: string) {
    return page
        .getByRole('listitem', { name, exact: true })
        .getByRole('button', { name: /^Download / });
}
