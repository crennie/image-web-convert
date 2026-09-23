import { test, expect } from '../support/application';
import {
    image,
    submit,
    download,
    verifyImage,
    verifyZip,
    imageButton,
} from '../support/conversion';

test.use({ controlledApi: true });

test('cancels queued siblings while preserving completed and active-file results', async ({
    page,
    application,
}, info) => {
    const api = application.api;
    await api.hold(2);
    await submit(page, [
        await image('first.png'),
        await image('active.png'),
        await image('skipped.png'),
    ]);
    await expect.poll(() => api.held).toBe(true);
    await expect(page.getByRole('status')).toContainText('1 completed');
    await verifyImage(
        await download(
            page,
            imageButton(page, 'first.png'),
            info,
            'progressive.webp',
        ),
    );
    await page
        .getByRole('button', { name: 'Cancel conversion', exact: true })
        .click();
    await expect(page.getByRole('status')).toContainText(
        'Cancellation pending',
    );
    await api.release();
    await expect(page.getByRole('status')).toContainText(
        'Operation: cancelled',
    );
    await expect(page.getByRole('status')).toContainText(
        '2 completed, 0 failed, 1 cancelled',
    );
    await verifyZip(
        await download(
            page,
            page.getByRole('button', {
                name: 'Download completed images as ZIP',
            }),
            info,
            'cancelled.zip',
        ),
        ['first.webp', 'active.webp'],
    );
});

test('a real page exit delivers best-effort cancellation without waiting for conversion', async ({
    page,
    application,
}) => {
    const api = application.api;
    await api.hold();
    const operation = await submit(page, [
        await image('active.png'),
        await image('skipped.png'),
    ]);
    await expect.poll(() => api.held).toBe(true);
    await page.goto('/');
    // Disk observation cannot drive the scheduler and uses no browser credentials.
    await expect
        .poll(
            async () =>
                (await api.readOperation(operation.sessionId)).files[1].status,
        )
        .toBe('cancelled');
    await api.release();
    await expect
        .poll(async () => (await api.readOperation(operation.sessionId)).status)
        .toBe('cancelled');
    expect((await api.readOperation(operation.sessionId)).files[0].status).toBe(
        'completed',
    );
});

test('continues processing if page-exit cancellation never reaches the server', async ({
    page,
    application,
}) => {
    const api = application.api;
    await api.hold();
    const operation = await submit(page, [
        await image('active.png'),
        await image('next.png'),
    ]);
    await expect.poll(() => api.held).toBe(true);
    const attempted = page.waitForRequest('**/conversions/*/cancel');
    await page.route('**/conversions/*/cancel', (route) => route.abort());
    await page.goto('/');
    await attempted;
    await api.release();
    await expect
        .poll(async () => (await api.readOperation(operation.sessionId)).status)
        .toBe('completed');
    expect(
        (await api.readOperation(operation.sessionId)).files.map(
            (file) => file.status,
        ),
    ).toEqual(['completed', 'completed']);
});
