import { readdir } from 'node:fs/promises';
import sharp from 'sharp';
import { test, expect } from '../support/application';
import {
    image,
    submit,
    download,
    verifyImage,
    verifyZip,
    imageButton,
} from '../support/conversion';

test('converts the complete batch and downloads decoded images and ZIP contents', async ({
    page,
}, info) => {
    await submit(page, [await image('first.png'), await image('second.png')]);
    await expect(page.getByRole('status')).toContainText(
        'Operation: completed',
    );
    await expect(page.getByRole('status')).toContainText(
        '2 completed, 0 failed, 0 cancelled',
    );
    await expect(page.getByRole('alert')).toHaveCount(0);
    await verifyImage(
        await download(
            page,
            imageButton(page, 'first.png'),
            info,
            'first.webp',
        ),
    );
    await verifyImage(
        await download(
            page,
            imageButton(page, 'second.png'),
            info,
            'second.webp',
        ),
    );
    await verifyZip(
        await download(
            page,
            page.getByRole('button', {
                name: 'Download completed images as ZIP',
            }),
            info,
            'images.zip',
        ),
        ['first.webp', 'second.webp'],
    );
});

test('uses the selected JPEG format for the manifest and downloaded image', async ({
    page,
}, info) => {
    const operation = await submit(
        page,
        [await image('selected-format.png')],
        'image/jpeg',
    );
    expect(operation.options.outputMime).toBe('image/jpeg');
    await expect(page.getByRole('status')).toContainText(
        'Operation: completed',
    );
    const bytes = await download(
        page,
        imageButton(page, 'selected-format.png'),
        info,
        'selected-format.jpg',
    );
    expect(await sharp(bytes).metadata()).toMatchObject({
        format: 'jpeg',
        width: 32,
        height: 24,
    });
    expect(await sharp(bytes).removeAlpha().raw().toBuffer()).toHaveLength(
        32 * 24 * 3,
    );
});

test('uses the selected PNG format for the manifest and downloaded image', async ({
    page,
}, info) => {
    const source = await image('selected-png.jpg');
    const operation = await submit(
        page,
        [
            {
                ...source,
                mimeType: 'image/jpeg',
                buffer: await sharp(source.buffer).jpeg().toBuffer(),
            },
        ],
        'image/png',
    );
    expect(operation.options.outputMime).toBe('image/png');
    await expect(page.getByRole('status')).toContainText(
        'Operation: completed',
    );
    const bytes = await download(
        page,
        imageButton(page, 'selected-png.jpg'),
        info,
        'selected-png.png',
    );
    expect(await sharp(bytes).metadata()).toMatchObject({
        format: 'png',
        width: 32,
        height: 24,
    });
    expect(await sharp(bytes).removeAlpha().raw().toBuffer()).toHaveLength(
        32 * 24 * 3,
    );
});

test('uses the selected AVIF format for the manifest and downloaded image', async ({
    page,
}, info) => {
    const operation = await submit(
        page,
        [await image('selected-avif.png')],
        'image/avif',
    );
    expect(operation.options.outputMime).toBe('image/avif');
    await expect(page.getByRole('status')).toContainText(
        'Operation: completed',
    );
    const bytes = await download(
        page,
        imageButton(page, 'selected-avif.png'),
        info,
        'selected-avif.avif',
    );
    expect(await sharp(bytes).metadata()).toMatchObject({
        format: 'heif',
        compression: 'av1',
        width: 32,
        height: 24,
    });
    expect(await sharp(bytes).removeAlpha().raw().toBuffer()).toHaveLength(
        32 * 24 * 3,
    );
});

test('keeps successful downloads when an actual image fails to decode', async ({
    page,
}, info) => {
    await submit(page, [
        await image('good.png'),
        {
            name: 'broken.png',
            mimeType: 'image/png',
            buffer: Buffer.from('not an image'),
        },
    ]);
    await expect(page.getByRole('status')).toContainText(
        'Operation: partially completed',
    );
    await expect(page.getByRole('status')).toContainText(
        '1 completed, 1 failed',
    );
    await expect(
        page.getByRole('listitem', { name: 'broken.png', exact: true }),
    ).toContainText('File conversion failed');
    await verifyImage(
        await download(page, imageButton(page, 'good.png'), info, 'good.webp'),
    );
    await verifyZip(
        await download(
            page,
            page.getByRole('button', {
                name: 'Download completed images as ZIP',
            }),
            info,
            'partial.zip',
        ),
        ['good.webp'],
    );
});

test('reconciles and retries an interrupted upload against the real API', async ({
    page,
    application,
}, info) => {
    // The test proxy forwards partial bytes, waits for API staging, then
    // disconnects. The retry uses the same real API and encoder.
    application.interruptUploads();
    const operation = await submit(page, [await image('retry.png')]);
    const retry = page.getByRole('button', { name: 'Retry upload retry.png' });
    await expect(retry).toBeEnabled();
    expect(application.uploadInterrupted).toBe(true);
    expect(
        (await application.api.readOperation(operation.sessionId)).files[0]
            .status,
    ).toBe('awaiting_upload');
    // Browsers may automatically resend idempotent PUTs after a reset. Keep
    // fault injection armed until the transport has reported failure.
    application.resumeUploads();
    await expect
        .poll(async () => (await readdir(application.api.incoming)).length)
        .toBe(0);
    await retry.click();
    await expect(page.getByRole('status')).toContainText(
        'Operation: completed',
    );
    expect(
        (await application.api.readOperation(operation.sessionId)).files[0].id,
    ).toBe(operation.files[0].id);
    await verifyImage(
        await download(
            page,
            imageButton(page, 'retry.png'),
            info,
            'retry.webp',
        ),
    );
});
