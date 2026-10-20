import {
    ApiConversionOperationSchema,
    type ApiConversionOperation,
    type ApiCreateConversionRequest,
    type ConversionFileStatus,
    type ConversionOperationStatus,
} from '@image-web-convert/schemas';
import { expect, test } from '../support/application';
import { firstImage } from '../fixtures/images';

const session = {
    sid: 'counts-session',
    token: 'counts-test-token',
    expiresAt: new Date(Date.now() + 900_000).toISOString(),
    imageConfig: {
        ttlMinutes: 15,
        maxFiles: 20,
        maxBytesPerFile: 20_000_000,
        maxTotalBytes: 500_000_000,
    },
};
// Validate every mocked response against the API contract. In particular,
// uploaded is cumulative; queued must only count files still awaiting processing.
function operationSnapshot(
    intent: ApiCreateConversionRequest,
    states: ConversionFileStatus[],
    status: ConversionOperationStatus,
    revision: number,
    stop?: 'user_cancelled' | 'conversion_timeout',
): ApiConversionOperation {
    const now = new Date().toISOString();
    const files = intent.files.map((input, index) => {
        const state = states[index];
        const base = {
            id: `file-${index}`,
            clientId: input.clientId,
            name: input.name,
            declaredBytes: input.sizeBytes,
            status: state,
        };
        if (state === 'awaiting_upload') return base;
        const uploaded = {
            ...base,
            actualBytes: input.sizeBytes,
            uploadedAt: now,
        };
        if (state === 'uploaded') return uploaded;
        if (state === 'cancelled')
            return {
                ...uploaded,
                finishedAt: now,
                reason: stop ?? 'user_cancelled',
            };
        if (state === 'failed')
            return {
                ...uploaded,
                finishedAt: now,
                error: {
                    type:
                        stop === 'conversion_timeout'
                            ? 'conversion_timeout'
                            : 'malformed_image',
                    message: 'Unable to convert image',
                },
            };
        const processing = { ...uploaded, startedAt: now };
        if (state === 'processing') return processing;
        return {
            ...processing,
            finishedAt: now,
            output: {
                url: `/sessions/${session.sid}/files/file-${index}`,
                metaUrl: `/sessions/${session.sid}/files/file-${index}/meta`,
                meta: {
                    id: `file-${index}`,
                    original: { name: input.name, sizeBytes: input.sizeBytes },
                    output: {
                        storedName: `result-${index}.webp`,
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
    });
    const count = (value: ConversionFileStatus) =>
        states.filter((state) => state === value).length;
    const settled = count('completed') + count('failed') + count('cancelled');
    return ApiConversionOperationSchema.parse({
        id: 'counts-operation',
        sessionId: session.sid,
        revision,
        status,
        options: intent.options,
        files,
        counts: {
            expected: states.length,
            awaitingUpload: count('awaiting_upload'),
            uploaded: states.length - count('awaiting_upload'),
            processing: count('processing'),
            completed: count('completed'),
            failed: count('failed'),
            cancelled: count('cancelled'),
            settled,
        },
        createdAt: now,
        updatedAt: now,
        expiresAt: session.expiresAt,
        queuedAt: status === 'awaiting_uploads' ? null : now,
        startedAt: ['awaiting_uploads', 'queued'].includes(status) ? null : now,
        finishedAt: settled === states.length ? now : null,
        cancelRequestedAt: stop === 'user_cancelled' ? now : null,
        stopRequestedAt: stop ? now : null,
        stopReason: stop ?? null,
    });
}

const outcomes: {
    name: string;
    states: ConversionFileStatus[];
    status: ConversionOperationStatus;
    counts: string;
    ready: number;
    stop?: 'user_cancelled' | 'conversion_timeout';
}[] = [
    {
        name: 'all successful',
        states: ['completed', 'completed', 'completed', 'completed'],
        status: 'completed',
        counts: '4 completed.',
        ready: 4,
    },
    {
        name: 'partial failure',
        states: ['completed', 'failed', 'completed', 'failed'],
        status: 'partially_completed',
        counts: '2 completed, 2 failed.',
        ready: 2,
    },
    {
        name: 'all failed',
        states: ['failed', 'failed', 'failed', 'failed'],
        status: 'failed',
        counts: '0 completed, 4 failed.',
        ready: 0,
    },
    {
        name: 'cancelled with results',
        states: ['completed', 'completed', 'cancelled', 'cancelled'],
        status: 'cancelled',
        counts: '2 completed, 2 cancelled.',
        ready: 2,
        stop: 'user_cancelled',
    },
    {
        name: 'cancelled without results',
        states: ['cancelled', 'cancelled', 'cancelled', 'cancelled'],
        status: 'cancelled',
        counts: '0 completed, 4 cancelled.',
        ready: 0,
        stop: 'user_cancelled',
    },
    {
        name: 'processing timeout',
        states: ['completed', 'failed', 'cancelled', 'cancelled'],
        status: 'partially_completed',
        counts: '1 completed, 1 failed, 2 cancelled.',
        ready: 1,
        stop: 'conversion_timeout',
    },
];

// Branches below depend only on this fixed scenario matrix, never observed UI.
/* eslint-disable playwright/no-conditional-in-test, playwright/no-conditional-expect */
for (const outcome of outcomes) {
    test(`counts remain accurate from uploads through ${outcome.name}`, async ({
        page,
    }) => {
        let intent!: ApiCreateConversionRequest;
        let operation: ApiConversionOperation;
        let revision = 0;
        let uploadRequests = 0;
        await page.route('**/api/sessions', (route) =>
            route.fulfill({ json: session }),
        );
        await page.route('**/conversions', async (route) => {
            intent = route.request().postDataJSON();
            operation = operationSnapshot(
                intent,
                Array(4).fill('awaiting_upload'),
                'awaiting_uploads',
                ++revision,
            );
            await route.fulfill({ status: 201, json: operation });
        });
        await page.route(
            '**/conversions/counts-operation/files/*',
            async (route) => {
                uploadRequests++;
                await route.fulfill({ json: operation });
            },
        );
        await page.route('**/conversions/counts-operation', (route) =>
            route.fulfill({ json: operation }),
        );
        await page.route(
            '**/conversions/counts-operation/cancel',
            async (route) => {
                const states: ConversionFileStatus[] = outcome.ready
                    ? ['completed', 'processing', 'cancelled', 'cancelled']
                    : ['processing', 'cancelled', 'cancelled', 'cancelled'];
                operation = operationSnapshot(
                    intent,
                    states,
                    'processing',
                    ++revision,
                    'user_cancelled',
                );
                await route.fulfill({ json: operation });
            },
        );
        await page.goto('/conversion');
        const chooser = page.waitForEvent('filechooser');
        await page.getByRole('button', { name: 'Choose images' }).click();
        await (
            await chooser
        ).setFiles(
            Array.from({ length: 4 }, (_, i) => ({
                ...firstImage,
                name: `image-${i}.png`,
            })),
        );
        await expect(
            page.getByText(/4 images · .* total · Convert to WEBP/),
        ).toBeVisible();
        await page.getByRole('button', { name: 'Start conversion' }).click();
        const summary = page.getByRole('status');
        const files = page.getByRole('button', { name: 'Files (4)' });
        await expect(summary).toContainText('0 of 4 files finished');
        await expect(summary).toContainText('4 upload pending');
        await expect(summary).toContainText('0 completed.');
        await expect(summary).not.toContainText(
            /0 (failed|cancelled|processing|queued)/,
        );
        await expect.poll(() => uploadRequests).toBe(4);
        operation = operationSnapshot(
            intent,
            ['uploaded', 'uploaded', 'uploaded', 'uploaded'],
            'queued',
            ++revision,
        );
        await expect(summary).toContainText('4 queued');
        await expect(summary).not.toContainText('upload pending');
        operation = operationSnapshot(
            intent,
            ['processing', 'uploaded', 'uploaded', 'uploaded'],
            'processing',
            ++revision,
        );
        await expect(summary).toContainText('1 processing.');
        await expect(summary).toContainText('3 queued');
        await expect(summary).not.toContainText('4 queued');
        // A completed file is not part of the queue, despite remaining in the
        // cumulative uploaded API count. Complete failure cases settle later.
        const progresses =
            outcome.name !== 'all failed' &&
            outcome.name !== 'cancelled without results';
        if (progresses) {
            operation = operationSnapshot(
                intent,
                ['completed', 'processing', 'uploaded', 'uploaded'],
                'processing',
                ++revision,
            );
            await expect(summary).toContainText('1 of 4 files finished');
            await expect(summary).toContainText('1 completed, 1 processing.');
            await expect(summary).toContainText('2 queued');
            await expect(files).toHaveAttribute('aria-expanded', 'true');
            await expect(
                page.getByRole('button', { name: /as ZIP/ }),
            ).toHaveCount(0);
        }
        if (outcome.stop === 'user_cancelled') {
            await page
                .getByRole('button', { name: 'Cancel conversion', exact: true })
                .click();
            await expect(summary).toContainText('Cancellation pending');
            await expect(summary).toContainText('3 of 4 files finished');
            await expect(summary).toContainText(
                outcome.ready
                    ? '1 completed, 2 cancelled, 1 processing.'
                    : '0 completed, 3 cancelled, 1 processing.',
            );
            await expect(summary).not.toContainText(/queued|upload pending/);
        }
        operation = operationSnapshot(
            intent,
            outcome.states,
            outcome.status,
            ++revision,
            outcome.stop,
        );
        await expect(summary).toContainText(
            `Operation: ${outcome.status.replaceAll('_', ' ')}`,
        );
        await expect(summary).toContainText(outcome.counts);
        await expect(summary).not.toContainText(
            /files finished|upload pending|\d queued|\d processing|Cancellation pending/,
        );
        await expect(
            page.getByText(`${outcome.ready} of 4 images ready to download.`, {
                exact: false,
            }),
        ).toBeVisible();
        await expect(files).toHaveAttribute(
            'aria-expanded',
            String(outcome.ready !== 4),
        );
        if (outcome.ready)
            await expect(
                page.getByRole('button', { name: /as ZIP/ }),
            ).toBeEnabled();
        else {
            await expect(
                page.getByRole('button', { name: /as ZIP/ }),
            ).toHaveCount(0);
            await expect(
                page.getByText(/No images are available to download/),
            ).toBeVisible();
        }
        if (outcome.ready === 4) await files.click();
        for (let index = 0; index < outcome.states.length; index++) {
            const row = page.getByRole('listitem', {
                name: `image-${index}.png`,
                exact: true,
            });
            await expect(
                row.getByRole('button', {
                    name: outcome.states[index],
                    exact: true,
                }),
            ).toBeVisible();
        }
        if (outcome.stop === 'conversion_timeout')
            await expect(page.getByRole('alert')).toContainText(
                'Processing time limit reached',
            );
    });
}

test('successful long list keeps ZIP reachable on a narrow viewport', async ({
    page,
}) => {
    await page.setViewportSize({ width: 375, height: 667 });
    const total = 20;
    let intent!: ApiCreateConversionRequest;
    let revision = 0;
    let uploads = 0;
    let finish = false;
    await page.route('**/api/sessions', (route) =>
        route.fulfill({ json: session }),
    );
    await page.route('**/conversions', async (route) => {
        intent = route.request().postDataJSON();
        await route.fulfill({
            status: 201,
            json: operationSnapshot(
                intent,
                Array(total).fill('awaiting_upload'),
                'awaiting_uploads',
                ++revision,
            ),
        });
    });
    await page.route('**/conversions/counts-operation/files/*', (route) => {
        uploads++;
        return route.fulfill({
            json: operationSnapshot(
                intent,
                Array(total).fill('awaiting_upload'),
                'awaiting_uploads',
                ++revision,
            ),
        });
    });
    await page.route('**/conversions/counts-operation', (route) =>
        route.fulfill({
            json: operationSnapshot(
                intent,
                finish
                    ? Array(total).fill('completed')
                    : uploads === total
                      ? [...Array(total - 1).fill('uploaded'), 'completed']
                      : Array(total).fill('awaiting_upload'),
                finish
                    ? 'completed'
                    : uploads === total
                      ? 'processing'
                      : 'awaiting_uploads',
                ++revision,
            ),
        }),
    );
    await page.goto('/conversion');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Choose images' }).click();
    await (
        await chooser
    ).setFiles(
        Array.from({ length: total }, (_, index) => ({
            ...firstImage,
            name: `long-list-${index}.png`,
        })),
    );
    await page.getByRole('button', { name: 'Start conversion' }).click();
    await expect.poll(() => uploads).toBe(total);
    const last = page.getByRole('listitem', {
        name: `long-list-${total - 1}.png`,
        exact: true,
    });
    const download = last.getByRole('button', {
        name: 'Download result-19.webp',
    });
    await expect(download).toBeVisible();
    await download.focus();
    await expect(download).toBeFocused();
    finish = true;
    const files = page.getByRole('button', { name: `Files (${total})` });
    await expect(files).toHaveAttribute('aria-expanded', 'false');
    await expect(files).toBeFocused();
    const zip = page.getByRole('button', {
        name: 'Download completed images as ZIP',
    });
    await expect(zip).toBeEnabled();
    await expect
        .poll(async () => {
            const box = await zip.boundingBox();
            return !!box && box.y >= 0 && box.y + box.height <= 667;
        })
        .toBe(true);
    expect(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
    ).toBe(true);
});
