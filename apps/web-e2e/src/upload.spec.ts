import { expect, test, type Page } from '@playwright/test';
import { firstImage, secondImage, type ImageFixture } from './fixtures/images';
import type {
    ApiConversionOperation,
    ApiCreateConversionRequest,
    ConversionFile,
} from '@image-web-convert/schemas';

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
    await chooseFiles(page, firstImage);
    await expect(page.getByText('1 file ready to upload.')).toBeVisible();
    await expect(
        page.getByRole('button', { name: 'Start conversion' }),
    ).toBeEnabled();
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
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download converted.webp' }).click();
    expect((await download).suggestedFilename()).toBe('converted.webp');
    await expect(
        page.getByRole('button', { name: 'Cancel conversion' }),
    ).toBeEnabled();
});
