import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import sharp from 'sharp';
import {
    ApiCreateSessionResponseSchema,
    ApiErrorSchema,
    ApiUploadsResponseSchema,
    UploadMetaSchema,
} from '@image-web-convert/schemas';

let server: Server;
let baseUrl: string;
let storageRoot: string;
let tempRoot: string;
let png: Buffer;
let conversions: { start(): Promise<void>; stop(): Promise<{ drained: boolean }> };

async function createSession() {
    const response = await fetch(`${baseUrl}/api/sessions`, { method: 'POST' });
    expect(response.status).toBe(201);
    return ApiCreateSessionResponseSchema.parse(await response.json());
}

function uploadRequest(
    session: { sid: string; token: string },
    file: Buffer,
    options: { outputMime?: string; name?: string; token?: string } = {},
) {
    const form = new FormData();
    form.append('outputMime', options.outputMime ?? 'image/webp');
    form.append('manifest', JSON.stringify(['client-1']));
    form.append(
        'image',
        new Blob([new Uint8Array(file)], { type: 'image/png' }),
        options.name ?? 'fixture.png',
    );
    return fetch(`${baseUrl}/api/sessions/${session.sid}/uploads`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${options.token ?? session.token}` },
        body: form,
    });
}

beforeAll(async () => {
    storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'iwc-e2e-storage-'));
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'iwc-e2e-upload-'));
    process.env.UPLOAD_DIR = storageRoot;
    process.env.UPLOAD_TMP_DIR = tempRoot;
    process.env.SESSION_PER_FILE_BYTES = '20000000';
    process.env.SESSION_MAX_TOTAL_BYTES = '50000000';
    process.env.SESSION_MAX_FILES = '3';
    process.env.RATE_LIMIT_MAX = '100';
    process.env.ENABLE_OTEL = 'false';
    png = await sharp({
        create: {
            width: 32,
            height: 24,
            channels: 4,
            background: { r: 20, g: 80, b: 160, alpha: 1 },
        },
    })
        .png()
        .toBuffer();

    // The E2E harness intentionally starts the application it exercises.
    // eslint-disable-next-line @nx/enforce-module-boundaries
    const { createApp } = await import('@image-web-convert/api-app');
    const app = await createApp();
    conversions = app.locals.conversions;
    app.locals.setReady(true);
    await new Promise<void>((resolve) => {
        server = app.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No test port');
    baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    await Promise.all([
        fs.rm(storageRoot, { recursive: true, force: true }),
        fs.rm(tempRoot, { recursive: true, force: true }),
    ]);
});

describe('API lifecycle', () => {
    it('gates readiness on runtime recovery and shutdown', async () => {
        expect((await fetch(`${baseUrl}/readyz`)).status).toBe(503);
        await conversions.start();
        expect((await fetch(`${baseUrl}/readyz`)).status).toBe(200);
        expect(await conversions.stop()).toEqual({ drained: true });
        expect((await fetch(`${baseUrl}/readyz`)).status).toBe(503);
    });

    it('creates, validates, converts, seals, reads metadata, and downloads', async () => {
        const session = await createSession();
        expect(session.imageConfig).toMatchObject({
            maxFiles: 3,
            maxBytesPerFile: 20000000,
            maxTotalBytes: 50000000,
        });

        const notReady = await fetch(
            `${baseUrl}/api/sessions/${session.sid}/files/missing`,
            { headers: { Authorization: `Bearer ${session.token}` } },
        );
        expect(notReady.status).toBe(409);
        expect(ApiErrorSchema.parse(await notReady.json()).type).toBe(
            'session_not_ready',
        );

        const invalidToken = await uploadRequest(session, png, { token: 'wrong' });
        expect(invalidToken.status).toBe(401);
        expect(ApiErrorSchema.parse(await invalidToken.json()).type).toBe(
            'invalid_token',
        );

        const invalidMime = await uploadRequest(session, png, {
            outputMime: 'image/gif',
        });
        expect(invalidMime.status).toBe(400);
        expect(ApiErrorSchema.parse(await invalidMime.json()).type).toBe(
            'invalid_output_mime',
        );
        expect(await fs.readdir(tempRoot)).toEqual([]);

        const upload = await uploadRequest(session, png);
        expect(upload.status).toBe(200);
        const uploaded = ApiUploadsResponseSchema.parse(await upload.json());
        expect(uploaded.status).toBe('ok');
        expect(uploaded.accepted).toHaveLength(1);
        const converted = uploaded.accepted[0];

        const metadataResponse = await fetch(`${baseUrl}/api${converted.metaUrl}`, {
            headers: { Authorization: `Bearer ${session.token}` },
        });
        expect(metadataResponse.status).toBe(200);
        const metadata = UploadMetaSchema.parse(await metadataResponse.json());
        expect(metadata).toMatchObject({
            id: converted.id,
            original: { name: 'fixture.png', mime: 'image/png' },
            output: { mime: 'image/webp', width: 32, height: 24 },
        });

        const download = await fetch(`${baseUrl}/api${converted.url}`, {
            headers: { Authorization: `Bearer ${session.token}` },
        });
        expect(download.status).toBe(200);
        expect(download.headers.get('content-type')).toMatch(/^image\/webp/);
        expect(download.headers.get('content-disposition')).toContain(
            'fixture.webp',
        );
        const downloaded = Buffer.from(await download.arrayBuffer());
        expect(downloaded.length).toBeGreaterThan(10);
        expect((await sharp(downloaded).metadata()).format).toBe('webp');

        const reused = await uploadRequest(session, png);
        expect(reused.status).toBe(409);
        expect(ApiErrorSchema.parse(await reused.json()).type).toBe('session_used');
        expect(await fs.readdir(tempRoot)).toEqual([]);
    });

    it('enforces multipart per-file limits and cleans temporary data', async () => {
        const session = await createSession();
        const response = await uploadRequest(
            session,
            Buffer.alloc(20000001, 1),
            { name: 'oversized.png' },
        );
        expect(response.status).toBe(413);
        expect(ApiErrorSchema.parse(await response.json()).type).toBe(
            'upload_limit_exceeded',
        );
        expect(await fs.readdir(tempRoot)).toEqual([]);
    });

    it('rejects a concurrent upload for the same session before a second conversion', async () => {
        const session = await createSession();
        const largePng = await sharp({
            create: {
                width: 1800,
                height: 1800,
                channels: 3,
                background: { r: 90, g: 40, b: 10 },
            },
        })
            .png({ compressionLevel: 0 })
            .toBuffer();
        const [first, second] = await Promise.all([
            uploadRequest(session, largePng, { name: 'one.png' }),
            uploadRequest(session, largePng, { name: 'two.png' }),
        ]);
        expect([first.status, second.status].sort()).toEqual([200, 409]);
        const conflict = first.status === 409 ? first : second;
        expect(ApiErrorSchema.parse(await conflict.json()).type).toBe(
            'upload_in_progress',
        );
    });
});
