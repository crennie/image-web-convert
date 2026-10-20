import type { Page, Locator } from '@playwright/test';
import { expect, test } from '../support/application';
import { firstImage, secondImage, type ImageFixture } from '../fixtures/images';
import type {
    ApiConversionOperation,
    ApiCreateConversionRequest,
    ConversionFile,
} from '@image-web-convert/schemas';

function requiredBounds(box: Awaited<ReturnType<Locator['boundingBox']>>) {
    if (!box) throw new Error('Expected a visible element with layout bounds');
    return box;
}

const sessionResponse = {
    sid: 'e2e-session',
    token: 'e2e-token',
    expiresAt: new Date(Date.now() + 900_000).toISOString(),
    imageConfig: {
        ttlMinutes: 15,
        maxFiles: 20,
        maxBytesPerFile: 20_000_000,
        maxTotalBytes: 500_000_000,
    },
};

async function chooseFiles(page: Page, files: ImageFixture | ImageFixture[]) {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Choose images' }).click();
    await (await chooser).setFiles(files);
}

test.beforeEach(async ({ page }) => {
    await page.route('**/api/sessions', (route) =>
        route.fulfill({ status: 200, json: sessionResponse }),
    );
    await page.goto('/conversion');
});

test('visible keyboard accessible upload control invokes the file chooser', async ({
    page,
}) => {
    const button = page.getByRole('button', { name: 'Choose images' });
    await expect(button).toBeEnabled();
    await button.focus();
    const chooser = page.waitForEvent('filechooser');
    await button.press('Enter');
    await (await chooser).setFiles(firstImage);
    await expect(
        page.getByText(firstImage.name, { exact: true }),
    ).toBeVisible();
});

test('selected file becomes pending and visible', async ({ page }) => {
    await expect(page.getByText(/files? ready to upload/i)).toHaveCount(0);
    await expect(
        page.getByRole('button', { name: 'Start conversion' }),
    ).toHaveCount(0);
    await chooseFiles(page, firstImage);
    await expect(page.getByText('1 file ready to upload.')).toBeVisible();
    await expect(
        page.getByRole('button', { name: 'Start conversion' }),
    ).toBeEnabled();
});

test('session failure keeps the batch available for retry', async ({
    page,
}) => {
    await page.route('**/api/sessions', (route) =>
        route.fulfill({ status: 503, json: { message: 'Unavailable' } }),
    );
    await chooseFiles(page, firstImage);
    await page.getByRole('button', { name: 'Start conversion' }).click();
    await expect(page.getByRole('alert')).toContainText(
        'Could not open a session. Please retry.',
    );
    await expect(
        page.getByRole('button', { name: 'Retry batch creation' }),
    ).toBeEnabled();
});

test('manifest rejection offers a new batch instead of retrying the rejected intent', async ({
    page,
}) => {
    await page.route('**/api/sessions/e2e-session/conversions', (route) =>
        route.fulfill({ status: 413, json: { type: 'upload_limit_exceeded' } }),
    );
    await chooseFiles(page, firstImage);
    await page.getByRole('button', { name: 'Start conversion' }).click();
    await expect(page.getByRole('alert')).toContainText('Batch rejected.');
    await expect(
        page.getByRole('button', { name: 'Start new batch' }),
    ).toBeEnabled();
    await expect(
        page.getByRole('button', { name: 'Retry batch creation' }),
    ).toHaveCount(0);
});

test('Back and Forward protect an unresolved batch creation', async ({
    page,
}) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Convert Files' }).click();
    let releaseCreation!: () => void;
    const creationHeld = new Promise<void>(
        (resolve) => (releaseCreation = resolve),
    );
    await page.route(
        '**/api/sessions/e2e-session/conversions',
        async (route) => {
            await creationHeld;
            await route
                .fulfill({ status: 503, json: { type: 'unavailable' } })
                .catch(() => undefined);
        },
    );
    await chooseFiles(page, firstImage);
    await page.getByRole('button', { name: 'Start conversion' }).click();
    await expect(page.getByRole('status')).toContainText(
        'Creating conversion batch',
    );
    await page.evaluate(() => history.back());
    const warning = page.getByRole('dialog', {
        name: 'Leave this conversion?',
    });
    await expect(warning).toBeVisible();
    const stay = warning.getByRole('button', { name: 'Stay on this batch' });
    await expect(stay).toBeFocused();
    await stay.click();
    await expect(warning).toBeHidden();
    await expect(page).toHaveURL(/\/conversion$/);
    await expect(page.getByRole('status')).toContainText(
        'Creating conversion batch',
    );
    await page.evaluate(() => history.back());
    await expect(warning).toBeVisible();
    await warning.getByRole('button', { name: 'Leave conversion' }).click();
    await expect(page).toHaveURL('/');
    releaseCreation();
    await page.evaluate(() => history.forward());
    await expect(page).toHaveURL(/\/conversion$/);
    await expect(
        page.getByRole('button', { name: 'Choose images' }),
    ).toBeVisible();
    await expect(page.getByRole('status')).not.toContainText(
        'Creating conversion batch',
    );
});

test('multiple selected files remain pending', async ({ page }) => {
    await chooseFiles(page, [firstImage, secondImage]);
    await expect(
        page.getByText(firstImage.name, { exact: true }),
    ).toBeVisible();
    await expect(
        page.getByText(secondImage.name, { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('2 files ready to upload.')).toBeVisible();
});

test('a pending file can be removed without removing the others', async ({
    page,
}) => {
    await chooseFiles(page, [firstImage, secondImage]);
    await page
        .getByRole('button', { name: `Remove ${firstImage.name}` })
        .click();
    await expect(page.getByText(firstImage.name, { exact: true })).toHaveCount(
        0,
    );
    await expect(
        page.getByText(secondImage.name, { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('1 file ready to upload.')).toBeVisible();
});

test('route creates a manifest, uploads slots, polls and downloads progressive results', async ({
    page,
}) => {
    let operation: ApiConversionOperation;
    let uploads = 0;
    let finishBatch = false;
    const now = new Date().toISOString();
    await page.route(
        '**/api/sessions/e2e-session/conversions',
        async (route) => {
            const intent = route
                .request()
                .postDataJSON() as ApiCreateConversionRequest;
            expect(route.request().headers()['authorization']).toBe(
                'Bearer e2e-token',
            );
            expect(intent.requestId).toBeTruthy();
            operation = {
                id: 'operation',
                sessionId: 'e2e-session',
                revision: 1,
                status: 'awaiting_uploads',
                options: intent.options,
                files: intent.files.map((file, index) => ({
                    id: `slot-${index}`,
                    clientId: file.clientId,
                    name: file.name,
                    declaredBytes: file.sizeBytes,
                    status: 'awaiting_upload',
                })),
                counts: {
                    expected: 2,
                    awaitingUpload: 2,
                    uploaded: 0,
                    processing: 0,
                    completed: 0,
                    failed: 0,
                    cancelled: 0,
                    settled: 0,
                },
                createdAt: now,
                updatedAt: now,
                expiresAt: sessionResponse.expiresAt,
                queuedAt: null,
                startedAt: null,
                finishedAt: null,
                cancelRequestedAt: null,
                stopRequestedAt: null,
                stopReason: null,
            };
            await route.fulfill({ status: 201, json: operation });
        },
    );
    await page.route('**/conversions/operation/files/*', async (route) => {
        expect(route.request().method()).toBe('PUT');
        expect(route.request().headers()['authorization']).toBe(
            'Bearer e2e-token',
        );
        expect(route.request().headers()['content-type']).toContain(
            'multipart/form-data',
        );
        const id = new URL(route.request().url()).pathname.split('/').pop();
        operation = {
            ...operation,
            revision: operation.revision + 1,
            files: operation.files.map((file) =>
                file.id === id
                    ? {
                          ...file,
                          status: 'uploaded' as const,
                          actualBytes: file.declaredBytes,
                          uploadedAt: now,
                      }
                    : file,
            ),
            counts: {
                ...operation.counts,
                uploaded: ++uploads,
                awaitingUpload: 2 - uploads,
            },
        };
        await route.fulfill({ status: 200, json: operation });
    });
    await page.route('**/conversions/operation', async (route) => {
        expect(route.request().headers()['authorization']).toBe(
            'Bearer e2e-token',
        );
        if (uploads === 2) {
            const file = operation.files[0];
            const done: ConversionFile = {
                ...file,
                status: 'completed',
                actualBytes: file.declaredBytes,
                uploadedAt: now,
                startedAt: now,
                finishedAt: now,
                output: {
                    url: '/sessions/e2e-session/files/slot-0',
                    metaUrl: '/sessions/e2e-session/files/slot-0/meta',
                    meta: {
                        id: file.id,
                        original: {
                            name: file.name,
                            sizeBytes: file.declaredBytes,
                        },
                        output: {
                            storedName: 'converted.webp',
                            mime: 'image/webp',
                            sizeBytes: 3,
                            width: 1,
                            height: 1,
                            hasAlpha: false,
                            colorSpace: 'srgb',
                        },
                        animated: false,
                        exifStripped: true,
                        uploadedAt: now,
                    },
                },
            };
            operation = {
                ...operation,
                revision: operation.revision + 1,
                status: 'processing',
                files: [
                    done,
                    {
                        ...operation.files[1],
                        status: 'processing',
                        actualBytes: operation.files[1].declaredBytes,
                        uploadedAt: now,
                        startedAt: now,
                    },
                ],
                counts: {
                    ...operation.counts,
                    processing: 1,
                    completed: 1,
                    settled: 1,
                },
            };
        }
        if (finishBatch) {
            const first = operation.files[0];
            if (first.status !== 'completed')
                throw new Error('Expected completed first file');
            operation = {
                ...operation,
                revision: operation.revision + 1,
                status: 'completed',
                finishedAt: now,
                files: [
                    first,
                    {
                        ...first,
                        id: operation.files[1].id,
                        clientId: operation.files[1].clientId,
                        name: operation.files[1].name,
                        output: {
                            ...first.output,
                            meta: {
                                ...first.output.meta,
                                id: operation.files[1].id,
                            },
                        },
                    },
                ],
                counts: {
                    ...operation.counts,
                    processing: 0,
                    completed: 2,
                    settled: 2,
                },
            };
        }
        await route.fulfill({ status: 200, json: operation });
    });
    await page.route(
        '**/api/sessions/e2e-session/files/slot-0',
        async (route) => {
            expect(route.request().headers()['authorization']).toBe(
                'Bearer e2e-token',
            );
            await route.fulfill({
                status: 200,
                contentType: 'image/webp',
                body: 'img',
            });
        },
    );
    await page.route('**/conversions/operation/cancel', (route) =>
        route.fulfill({ status: 200, json: operation }),
    );
    await chooseFiles(page, [firstImage, secondImage]);
    await page.getByRole('button', { name: 'Start conversion' }).click();
    await expect(page.getByRole('status')).toContainText('1 completed');
    await expect(page.getByRole('status')).toContainText('1 processing');
    await expect(page.getByRole('status')).not.toContainText(
        /0 (failed|cancelled)/,
    );
    await expect(
        page.getByRole('button', { name: 'Download completed images as ZIP' }),
    ).toHaveCount(0);
    await expect(
        page.getByRole('button', { name: 'Start new batch' }),
    ).toHaveCount(0);
    const row = page.getByRole('listitem', {
        name: firstImage.name,
        exact: true,
    });
    const thumbnail = row.getByRole('button', {
        name: `Download ${firstImage.name} from thumbnail`,
    });
    const icon = row.getByRole('button', {
        name: 'Download converted.webp',
        exact: true,
    });
    await expect(row.getByText('1 × 1 · 3 B')).toBeVisible();
    await expect(row.getByText('converted.webp', { exact: true })).toHaveCount(
        0,
    );
    await expect(row.getByRole('img')).toHaveAttribute('src', /^blob:/);
    for (const width of [375, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        const boxes = await Promise.all([
            row.boundingBox().then(requiredBounds),
            thumbnail.boundingBox().then(requiredBounds),
            icon.boundingBox().then(requiredBounds),
        ]);
        const [rowBox, thumbBox, iconBox] = boxes;
        expect(thumbBox.x).toBeLessThan(iconBox.x);
        expect(iconBox.width).toBeGreaterThanOrEqual(44);
        expect(iconBox.height).toBeGreaterThanOrEqual(44);
        expect(iconBox.x + iconBox.width).toBeLessThanOrEqual(
            rowBox.x + rowBox.width,
        );
        expect(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= window.innerWidth,
            ),
        ).toBe(true);
    }
    await page.getByRole('link', { name: 'Home' }).click();
    const leaveActive = page.getByRole('dialog', {
        name: 'Leave this conversion?',
    });
    await expect(leaveActive).toBeVisible();
    await leaveActive
        .getByRole('button', { name: 'Stay on this batch' })
        .click();
    await expect(leaveActive).toBeHidden();
    await expect(page).toHaveURL(/\/conversion$/);
    const thumbnailDownload = page.waitForEvent('download');
    await thumbnail.focus();
    await thumbnail.press('Enter');
    expect((await thumbnailDownload).suggestedFilename()).toBe(
        'converted.webp',
    );
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download converted.webp' }).click();
    expect((await download).suggestedFilename()).toBe('converted.webp');
    await expect(
        page.getByRole('button', { name: 'Cancel conversion' }),
    ).toBeEnabled();
    await icon.focus();
    await expect(icon).toBeFocused();
    finishBatch = true;
    await expect(page.getByRole('status')).toContainText(
        'Operation: completed',
    );
    await expect(page.getByRole('status')).toContainText('2 completed.');
    await expect(
        page.getByRole('button', { name: 'Cancel conversion' }),
    ).toHaveCount(0);
    const zip = page.getByRole('button', {
        name: 'Download completed images as ZIP',
    });
    const restart = page.getByRole('button', { name: 'Start new batch' });
    await expect(zip).toBeEnabled();
    await expect(restart).toBeEnabled();
    const files = page.getByRole('button', { name: /Files \(/ });
    await expect(files).toHaveAttribute('aria-expanded', 'false');
    await expect(files).toBeFocused();
    await expect(icon).toBeHidden();
    await files.press('Tab');
    await expect(zip).toBeFocused();
    // Font loading and the final operation render can move both buttons.
    // Compare their settled positions while retaining the strict alignment limit.
    await expect
        .poll(async () => {
            const [zipBounds, restartBounds] = await Promise.all([
                zip.boundingBox(),
                restart.boundingBox(),
            ]);
            if (!zipBounds || !restartBounds) return Number.POSITIVE_INFINITY;
            return Math.abs(zipBounds.y - restartBounds.y);
        })
        .toBeLessThan(2);
    const zipBox = await zip.boundingBox().then(requiredBounds);
    const restartBox = await restart.boundingBox().then(requiredBounds);
    const panelBox = await page
        .getByRole('region', { name: 'Conversion operation' })
        .boundingBox()
        .then(requiredBounds);
    expect(zipBox.width).toBeLessThan(panelBox.width / 2);
    expect(restartBox.x + restartBox.width).toBeGreaterThan(
        panelBox.x + panelBox.width * 0.9,
    );
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await restart.focus();
    await files.click();
    await expect(row).toBeVisible();
    expect(
        await files.evaluate((button) => {
            const list = document.getElementById(
                button.getAttribute('aria-controls') ?? '',
            );
            return list && getComputedStyle(list).transitionDuration;
        }),
    ).toBe('0s');
    const help = row.getByRole('button', { name: 'completed', exact: true });
    await help.scrollIntoViewIfNeeded();
    await help.focus();
    await expect(page.getByRole('tooltip')).toBeVisible();
    await help.press('Escape');
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await files.focus();
    await help.hover();
    await expect(help).toHaveAttribute('aria-describedby', /.+/);
    await expect(page.getByRole('tooltip')).toBeVisible();
    await files.hover();
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await expect(help).not.toHaveAttribute('aria-describedby', /.+/);
    await page.setViewportSize({ width: 375, height: 667 });
    await help.hover();
    const tooltipBox = await page
        .getByRole('tooltip')
        .boundingBox()
        .then(requiredBounds);
    expect(tooltipBox.x).toBeGreaterThanOrEqual(0);
    expect(tooltipBox.x + tooltipBox.width).toBeLessThanOrEqual(375);
    expect(tooltipBox.y).toBeGreaterThanOrEqual(0);
    expect(tooltipBox.y + tooltipBox.height).toBeLessThanOrEqual(667);
    await page.evaluate(() => window.dispatchEvent(new Event('scroll')));
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await files.click();
    await restart.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Leave these results?' });
    await expect(dialog).toBeVisible();
    const stay = dialog.getByRole('button', { name: 'Stay on this batch' });
    await expect(stay).toBeFocused();
    await stay.press('Shift+Tab');
    await expect(
        dialog.getByRole('button', { name: 'Leave results' }),
    ).toBeFocused();
    await dialog.getByRole('button', { name: 'Leave results' }).press('Tab');
    await expect(stay).toBeFocused();
    await dialog.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(restart).toBeFocused();
    await restart.click();
    await dialog.getByRole('button', { name: 'Leave results' }).click();
    await expect(
        page.getByRole('button', { name: 'Choose images' }),
    ).toBeVisible();
    await expect(
        page.getByRole('list', { name: 'Pending images' }),
    ).toHaveCount(0);
});

test('dropzone accepts files and errors clear on selection changes or dismissal', async ({
    page,
}) => {
    const zone = page.getByTestId('selection-dropzone');
    await zone.evaluate((element) => {
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(
            new File(['bad'], 'bad.txt', { type: 'text/plain' }),
        );
        element.dispatchEvent(
            new DragEvent('dragenter', { bubbles: true, dataTransfer }),
        );
        element.dispatchEvent(
            new DragEvent('drop', { bubbles: true, dataTransfer }),
        );
    });
    await expect(
        page.getByRole('list', { name: 'Selection errors' }),
    ).toContainText('Unsupported file type');
    await page.getByRole('button', { name: /Dismiss error/ }).click();
    await expect(
        page.getByRole('list', { name: 'Selection errors' }),
    ).toHaveCount(0);
    await expect(
        page.getByRole('button', { name: 'Choose images' }),
    ).toBeFocused();
    const rejected = {
        name: 'bad.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('bad'),
    };
    await chooseFiles(page, firstImage);
    await chooseFiles(page, rejected);
    await expect(
        page.getByRole('list', { name: 'Selection errors' }),
    ).toContainText('Unsupported file type');
    await chooseFiles(page, secondImage);
    await expect(
        page.getByRole('list', { name: 'Selection errors' }),
    ).toHaveCount(0);
    await chooseFiles(page, rejected);
    await page
        .getByRole('button', { name: `Remove ${firstImage.name}` })
        .click();
    await expect(
        page.getByRole('list', { name: 'Selection errors' }),
    ).toHaveCount(0);
});

test('pending cards stay uniform with scrollable names and a working local fallback', async ({
    page,
}) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const longName = 'very-long-image-name-'.repeat(12) + '.png';
    await chooseFiles(page, [firstImage, { ...secondImage, name: longName }]);
    const cards = page
        .getByRole('list', { name: 'Pending images' })
        .getByRole('listitem');
    const widths = await cards.evaluateAll((elements) =>
        elements.map((element) => element.getBoundingClientRect().width),
    );
    expect(widths[0]).toBe(widths[1]);
    const filename = page.getByRole('region', {
        name: `Filename: ${longName}`,
        exact: true,
    });
    expect(
        await filename.evaluate(
            (element) => element.scrollWidth > element.clientWidth,
        ),
    ).toBe(true);
    await filename.focus();
    await filename.press('End');
    expect(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
    ).toBe(true);
    await page
        .getByRole('img', {
            name: `Preview of ${firstImage.name}`,
            exact: true,
        })
        .evaluate((element) => element.dispatchEvent(new Event('error')));
    await expect(page.getByText('Preview unavailable')).toBeVisible();
    const fallback = page.locator('img[src="/image-preview-unavailable.svg"]');
    await expect
        .poll(() =>
            fallback.evaluate(
                (element) => (element as HTMLImageElement).naturalWidth,
            ),
        )
        .toBeGreaterThan(0);
    await expect(
        page.getByRole('button', { name: 'Start conversion' }),
    ).toBeEnabled();
    await page.getByLabel('Output format').selectOption('image/png');
    await expect(page.getByLabel('Output format')).toHaveValue('image/png');
});

test('error block supports keyboard dismissal and clear-all without changing pending files', async ({
    page,
}) => {
    await page.setViewportSize({ width: 375, height: 900 });
    const bad = {
        name: 'invalid.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('bad'),
    };
    await chooseFiles(page, [firstImage, bad, { ...bad, name: 'another.txt' }]);
    const errors = page.getByRole('list', { name: 'Selection errors' });
    const block = errors.locator('..');
    await expect(errors.getByRole('listitem')).toHaveCount(2);
    await expect(block).toHaveCSS('border-left-width', '4px');
    await expect(block).toHaveCSS('border-right-width', '0px');
    for (const error of await errors.getByRole('listitem').all()) {
        await expect(error).toHaveCSS('border-width', '0px');
        const dismissBox = await error
            .getByRole('button')
            .boundingBox()
            .then(requiredBounds);
        const messageBox = await error
            .locator('span')
            .last()
            .boundingBox()
            .then(requiredBounds);
        expect(dismissBox.x).toBeLessThan(messageBox.x);
    }
    const clear = page.getByRole('button', { name: 'Clear all errors' });
    const clearBox = await clear.boundingBox().then(requiredBounds);
    const blockBox = await block.boundingBox().then(requiredBounds);
    expect(clearBox.x - blockBox.x).toBeLessThan(24);
    const zoneBox = await page
        .getByTestId('selection-dropzone')
        .boundingBox()
        .then(requiredBounds);
    const countBox = await page
        .getByText('1 file ready to upload.')
        .boundingBox()
        .then(requiredBounds);
    expect(countBox.y).toBeGreaterThanOrEqual(zoneBox.y + zoneBox.height);
    await errors.getByRole('button').first().focus();
    await page.keyboard.press('Enter');
    await expect(errors.getByRole('listitem')).toHaveCount(1);
    await expect(errors.getByRole('button')).toBeFocused();
    await clear.focus();
    await page.keyboard.press('Enter');
    await expect(errors).toHaveCount(0);
    await expect(clear).toHaveCount(0);
    await expect(
        page.getByRole('button', { name: 'Choose images' }),
    ).toBeFocused();
    await expect(
        page
            .getByRole('list', { name: 'Pending images' })
            .getByRole('listitem'),
    ).toHaveCount(1);
    await expect(
        page.getByRole('button', { name: 'Start conversion' }),
    ).toBeEnabled();
    await chooseFiles(page, bad);
    await expect(errors).toHaveCount(1);
    await page
        .getByRole('button', { name: `Remove ${firstImage.name}` })
        .click();
    await expect(errors).toHaveCount(0);
    await expect(page.getByText('1 file ready to upload.')).toHaveCount(0);
});
