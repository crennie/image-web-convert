import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import sharp from 'sharp';
import {
    ApiCreateSessionResponseSchema,
    ApiErrorSchema,
    ApiConversionOperationSchema,
    type ApiConversionOperation,
    UploadMetaSchema,
} from '@image-web-convert/schemas';
import { startApi, type TestApi } from '../support/api-process';
import { zipEntries } from '../support/zip';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
let api: TestApi;
let directory: string;
let png: Buffer;
type Session = { sid: string; token: string };
const headers = (session: Session) => ({
    Authorization: `Bearer ${session.token}`,
});
const base = (session: Session) => `${api.url}/api/sessions/${session.sid}`;
async function session() {
    const response = await fetch(`${api.url}/api/sessions`, { method: 'POST' });
    expect(response.status).toBe(201);
    return ApiCreateSessionResponseSchema.parse(await response.json());
}
async function create(s: Session, count = 2, names?: string[]) {
    const response = await fetch(`${base(s)}/conversions`, {
        method: 'POST',
        headers: { ...headers(s), 'Content-Type': 'application/json' },
        body: JSON.stringify({
            requestId: 'intent-1',
            options: { outputMime: 'image/webp' },
            files: Array.from({ length: count }, (_, i) => ({
                clientId: `client-${i}`,
                name: names?.[i] ?? `${i}.png`,
                sizeBytes: png.length,
            })),
        }),
    });
    expect(response.status).toBe(201);
    return ApiConversionOperationSchema.parse(await response.json());
}
function upload(
    s: Session,
    op: ApiConversionOperation,
    index = 0,
    token = s.token,
    content = png,
) {
    const form = new FormData();
    form.append(
        'file',
        new Blob([new Uint8Array(content)], { type: 'image/png' }),
        `${index}.png`,
    );
    return fetch(
        `${base(s)}/conversions/${op.id}/files/${op.files[index].id}`,
        {
            method: 'PUT',
            headers: { Authorization: `Bearer ${token}` },
            body: form,
        },
    );
}
async function status(s: Session, op: ApiConversionOperation) {
    const response = await fetch(`${base(s)}/conversions/${op.id}`, {
        headers: headers(s),
    });
    expect(response.status).toBe(200);
    return ApiConversionOperationSchema.parse(await response.json());
}
async function diskStatus(s: Session, expected: string) {
    await vi.waitFor(
        async () =>
            expect((await api.readOperation(s.sid)).status).toBe(expected),
        { timeout: 10_000, interval: 25 },
    );
}
async function output(s: Session, op: ApiConversionOperation, index = 0) {
    const response = await fetch(`${base(s)}/files/${op.files[index].id}`, {
        headers: headers(s),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('image/webp');
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(await sharp(bytes).metadata()).toMatchObject({
        format: 'webp',
        width: 32,
        height: 24,
    });
    return bytes;
}
async function expectApiError(response: Response, code: number, type: string) {
    expect(response.status).toBe(code);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(ApiErrorSchema.parse(await response.json()).type).toBe(type);
}

async function productionApi(maxTotalBytes?: number) {
    await api.stop();
    api = await startApi(
        directory,
        path.resolve(
            __dirname,
            '../../test-output/lifecycle',
            path.basename(directory),
        ),
        false,
        { maxTotalBytes },
    );
}

beforeAll(async () => {
    png = await sharp({
        create: { width: 32, height: 24, channels: 3, background: '#1450a0' },
    })
        .png()
        .toBuffer();
});
beforeEach(async () => {
    const root = path.resolve(__dirname, '../../../../tmp/api-lifecycle');
    await fs.mkdir(root, { recursive: true });
    directory = await fs.mkdtemp(path.join(root, 'run-'));
    api = await startApi(
        directory,
        path.resolve(
            __dirname,
            '../../test-output/lifecycle',
            path.basename(directory),
        ),
        true,
    );
});
afterEach(async () => {
    try {
        await api?.stop();
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});

it('creates, validates authorization, converts without polling, reads metadata and ZIP contents', async () => {
    expect((await fetch(`${api.url}/readyz`)).status).toBe(200);
    const s = await session();
    const op = await create(s);
    await expectApiError(await upload(s, op, 0, 'wrong'), 401, 'invalid_token');
    const other = await session();
    await expectApiError(
        await upload(s, op, 0, other.token),
        401,
        'invalid_token',
    );
    expect((await upload(s, op)).status).toBe(200);
    expect((await api.readOperation(s.sid)).status).toBe('awaiting_uploads');
    expect((await upload(s, op, 1)).status).toBe(200);
    // Observe disk only: no GET can be responsible for scheduling work.
    await diskStatus(s, 'completed');
    const done = await status(s, op);
    expect(done.counts.completed).toBe(2);
    const first = await output(s, op);
    const metaResponse = await fetch(
        `${base(s)}/files/${op.files[0].id}/meta`,
        { headers: headers(s) },
    );
    expect(metaResponse.status).toBe(200);
    expect(
        UploadMetaSchema.parse(await metaResponse.json()).original.name,
    ).toBe('0.png');
    const zip = await fetch(`${base(s)}/files/download`, {
        method: 'POST',
        headers: { ...headers(s), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: op.files.map((file) => file.id) }),
    });
    expect(zip.status).toBe(200);
    const entries = zipEntries(Buffer.from(await zip.arrayBuffer()));
    expect([...entries.keys()]).toEqual(['0.webp', '1.webp']);
    expect(entries.get('0.webp')).toEqual(first);
    expect(entries.get('1.webp')).toEqual(await output(s, op, 1));
    // The same slot acknowledgement is idempotent and cannot overwrite output.
    expect((await upload(s, op)).status).toBe(200);
    expect(await output(s, op)).toEqual(first);
});

it('downloads all colliding filenames once, in requested order, with missing IDs reported', async () => {
    const s = await session();
    const op = await create(s, 3, ['a.png', 'a.png', 'a (2).png']);
    for (let i = 0; i < 3; i++)
        expect((await upload(s, op, i)).status).toBe(200);
    await diskStatus(s, 'completed');
    const zip = await fetch(`${base(s)}/files/download`, {
        method: 'POST',
        headers: { ...headers(s), 'Content-Type': 'application/json' },
        body: JSON.stringify({
            ids: [...op.files.map((file) => file.id), 'missing-file'],
            archiveName: 'photos é',
        }),
    });
    expect(zip.status).toBe(200);
    expect(zip.headers.get('content-type')).toContain('application/zip');
    expect(zip.headers.get('content-disposition')).toContain(
        "filename*=UTF-8''photos%20%C3%A9.zip",
    );
    expect(zip.headers.get('x-missing-ids')).toBe('missing-file');
    const entries = zipEntries(Buffer.from(await zip.arrayBuffer()));
    const names = ['a.webp', 'a (3).webp', 'a (2).webp'];
    expect([...entries.keys()]).toEqual(names);
    for (let i = 0; i < names.length; i++)
        expect(entries.get(names[i])).toEqual(await output(s, op, i));
});

it('rejects manifests above the effective size limit before staging bytes', async () => {
    const s = await session();
    const response = await fetch(`${base(s)}/conversions`, {
        method: 'POST',
        headers: { ...headers(s), 'Content-Type': 'application/json' },
        body: JSON.stringify({
            requestId: 'large',
            options: { outputMime: 'image/webp' },
            files: [
                {
                    clientId: 'large',
                    name: 'large.png',
                    sizeBytes: s.imageConfig.maxBytesPerFile + 1,
                },
            ],
        }),
    });
    await expectApiError(response, 413, 'upload_limit_exceeded');
    expect(await fs.readdir(api.incoming)).toEqual([]);
});

it('rejects malformed manifests, unsupported MIME and excess counts without consuming the session', async () => {
    await productionApi();
    const s = await session();
    const valid = {
        requestId: 'validation',
        options: { outputMime: 'image/webp' },
        files: [{ clientId: 'one', name: 'one.png', sizeBytes: png.length }],
    };
    for (const [body, code, type] of [
        [{ ...valid, files: [] }, 400, 'invalid_request'],
        [
            { ...valid, options: { outputMime: 'text/plain' } },
            400,
            'invalid_request',
        ],
        [
            {
                ...valid,
                files: Array.from(
                    { length: s.imageConfig.maxFiles + 1 },
                    (_, i) => ({
                        clientId: `file-${i}`,
                        name: 'one.png',
                        sizeBytes: png.length,
                    }),
                ),
            },
            413,
            'upload_limit_exceeded',
        ],
    ] as const) {
        await expectApiError(
            await fetch(`${base(s)}/conversions`, {
                method: 'POST',
                headers: { ...headers(s), 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            }),
            code,
            type,
        );
        expect(await fs.readdir(path.join(api.storage, s.sid))).toEqual([
            'session.info.json',
        ]);
        expect(await fs.readdir(api.incoming)).toEqual([]);
    }
    const op = await create(s, 1);
    expect((await upload(s, op)).status).toBe(200);
    await diskStatus(s, 'completed');
    await output(s, op);
});

it('enforces the backend aggregate-byte limit independently of the per-file ceiling', async () => {
    await productionApi(png.length);
    const s = await session();
    expect(s.imageConfig.maxTotalBytes).toBe(png.length);
    expect(s.imageConfig.maxBytesPerFile).toBeGreaterThan(png.length);
    const response = await fetch(`${base(s)}/conversions`, {
        method: 'POST',
        headers: { ...headers(s), 'Content-Type': 'application/json' },
        body: JSON.stringify({
            requestId: 'aggregate',
            options: { outputMime: 'image/webp' },
            files: [
                { clientId: 'a', name: 'a.png', sizeBytes: png.length },
                { clientId: 'b', name: 'b.png', sizeBytes: png.length },
            ],
        }),
    });
    await expectApiError(response, 413, 'upload_limit_exceeded');
    expect(await fs.readdir(api.incoming)).toEqual([]);
    const op = await create(s, 1);
    expect((await upload(s, op)).status).toBe(200);
    await diskStatus(s, 'completed');
    await output(s, op);
});

it('cleans missing and malformed multipart uploads and permits the same slot to retry', async () => {
    await productionApi();
    const s = await session();
    const op = await create(s, 1);
    const missingFile = new FormData();
    missingFile.append('name', 'no file attached');
    const endpoint = `${base(s)}/conversions/${op.id}/files/${op.files[0].id}`;
    for (const options of [
        { headers: headers(s), body: missingFile },
        {
            headers: {
                ...headers(s),
                'Content-Type': 'multipart/form-data; boundary=broken',
            },
            body: '--broken\r\n',
        },
    ]) {
        await expectApiError(
            await fetch(endpoint, { method: 'PUT', ...options }),
            400,
            'invalid_request',
        );
        await vi.waitFor(async () =>
            expect(await fs.readdir(api.incoming)).toEqual([]),
        );
        expect((await status(s, op)).files[0].status).toBe('awaiting_upload');
        expect(
            await fs.readdir(path.join(api.storage, s.sid, 'inputs')),
        ).toEqual([]);
    }
    expect((await upload(s, op)).status).toBe(200);
    await diskStatus(s, 'completed');
    await output(s, op);
});

it('rejects an expired test session through real authentication without creating operation data', async () => {
    await productionApi();
    const s = await session();
    // Only this test's disposable session is aged; no sleeping or fake server clock.
    const infoPath = path.join(api.storage, s.sid, 'session.info.json');
    const info = JSON.parse(await fs.readFile(infoPath, 'utf8'));
    await fs.writeFile(
        infoPath,
        JSON.stringify({
            ...info,
            expiresAt: new Date(Date.now() - 1000).toISOString(),
        }),
    );
    await expectApiError(
        await fetch(`${base(s)}/conversions`, {
            method: 'POST',
            headers: { ...headers(s), 'Content-Type': 'application/json' },
            body: '{}',
        }),
        403,
        'session_expired',
    );
    expect(await fs.readdir(path.join(api.storage, s.sid))).toEqual([
        'session.info.json',
    ]);
    expect(await fs.readdir(api.incoming)).toEqual([]);
});

it('preserves real successful conversions beside decode failures and gates downloads by committed file', async () => {
    await productionApi();
    const s = await session();
    const op = await create(s);
    await expectApiError(
        await fetch(`${base(s)}/files/${op.files[0].id}`, {
            headers: headers(s),
        }),
        404,
        'file_not_found',
    );
    await expectApiError(
        await fetch(`${base(s)}/files/missing-file/meta`, {
            headers: headers(s),
        }),
        404,
        'file_not_found',
    );
    expect((await upload(s, op)).status).toBe(200);
    // Accepted bytes are deliberately invalid image data with the declared size.
    expect(
        (await upload(s, op, 1, s.token, Buffer.alloc(png.length))).status,
    ).toBe(200);
    await diskStatus(s, 'partially_completed');
    const result = await status(s, op);
    expect(result.files.map((file) => file.status)).toEqual([
        'completed',
        'failed',
    ]);
    const bytes = await output(s, op);
    await expectApiError(
        await fetch(`${base(s)}/files/${op.files[1].id}`, {
            headers: headers(s),
        }),
        404,
        'file_not_found',
    );
    const zip = await fetch(`${base(s)}/files/download`, {
        method: 'POST',
        headers: { ...headers(s), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: op.files.map((file) => file.id) }),
    });
    expect(zip.status).toBe(200);
    expect(zip.headers.get('x-missing-ids')).toBe(op.files[1].id);
    const entries = zipEntries(Buffer.from(await zip.arrayBuffer()));
    expect([...entries.keys()]).toEqual(['0.webp']);
    expect(entries.get('0.webp')).toEqual(bytes);
    await vi.waitFor(async () => {
        expect(await fs.readdir(api.incoming)).toEqual([]);
        expect(
            await fs.readdir(path.join(api.storage, s.sid, 'inputs')),
        ).toEqual([]);
        expect(
            await fs.readdir(
                path.join(api.storage, s.sid, '.conversion-staging'),
            ),
        ).toEqual([]);
    });
    const files = await fs.readdir(path.join(api.storage, s.sid));
    expect(files).not.toContain(`${op.files[1].id}.webp`);
    expect(files).not.toContain(`${op.files[1].id}.json`);
});

it('cleans a genuinely disconnected multipart stream and accepts a retry on the same slot', async () => {
    const s = await session();
    const op = await create(s, 1);
    const request = http.request(
        `${base(s)}/conversions/${op.id}/files/${op.files[0].id}`,
        {
            method: 'PUT',
            headers: {
                ...headers(s),
                'Content-Type': 'multipart/form-data; boundary=boundary',
            },
        },
    );
    request.on('error', () => undefined);
    request.write(
        '--boundary\r\nContent-Disposition: form-data; name="file"; filename="0.png"\r\n\r\npartial',
    );
    try {
        await vi.waitFor(async () =>
            expect((await fs.readdir(api.incoming)).length).toBe(1),
        );
    } finally {
        request.destroy();
    }
    await vi.waitFor(async () =>
        expect(await fs.readdir(api.incoming)).toEqual([]),
    );
    expect((await status(s, op)).files[0].status).toBe('awaiting_upload');
    expect((await upload(s, op)).status).toBe(200);
    await diskStatus(s, 'completed');
    await output(s, op);
});

it('serializes concurrent operation intents and isolates active slot claims across sessions', async () => {
    const s = await session();
    const [op, same] = await Promise.all([create(s), create(s)]);
    expect(same.id).toBe(op.id);
    expect(same.files).toEqual(op.files);
    const conflict = await fetch(`${base(s)}/conversions`, {
        method: 'POST',
        headers: { ...headers(s), 'Content-Type': 'application/json' },
        body: JSON.stringify({
            requestId: 'different-intent',
            options: { outputMime: 'image/webp' },
            files: [
                {
                    clientId: 'different',
                    name: 'different.png',
                    sizeBytes: png.length,
                },
            ],
        }),
    });
    expect(conflict.status).toBe(409);
    expect(ApiErrorSchema.parse(await conflict.json()).type).toBe(
        'conversion_conflict',
    );
    const other = await session();
    const independent = await create(other, 1);
    const request = http.request(
        `${base(s)}/conversions/${op.id}/files/${op.files[0].id}`,
        {
            method: 'PUT',
            headers: {
                ...headers(s),
                'Content-Type': 'multipart/form-data; boundary=held',
            },
        },
    );
    request.on('error', () => undefined);
    request.write(
        '--held\r\nContent-Disposition: form-data; name="file"; filename="0.png"\r\n\r\n',
    );
    try {
        // Actual staging is the synchronization barrier: the first transport
        // owns the slot before its duplicate or independent uploads arrive.
        await vi.waitFor(async () =>
            expect(await fs.readdir(api.incoming)).toHaveLength(1),
        );
        const staging = await fs.readdir(api.incoming);
        const duplicate = await upload(s, op);
        expect(duplicate.status).toBe(409);
        expect(ApiErrorSchema.parse(await duplicate.json()).type).toBe(
            'upload_in_progress',
        );
        expect(await fs.readdir(api.incoming)).toEqual(staging);
        expect(
            (await api.readOperation(s.sid)).files.map((file) => file.status),
        ).toEqual(['awaiting_upload', 'awaiting_upload']);

        // A sibling and then another session make real progress while slot 0
        // still holds its admission. No global/session-wide lock is permitted.
        expect((await upload(s, op, 1)).status).toBe(200);
        await vi.waitFor(async () =>
            expect(await fs.readdir(api.incoming)).toEqual(staging),
        );
        expect((await upload(other, independent)).status).toBe(200);
        await diskStatus(other, 'completed');
        await output(other, independent);
        const waiting = await api.readOperation(s.sid);
        expect(waiting.status).toBe('awaiting_uploads');
        expect(waiting.files.map((file) => file.status)).toEqual([
            'awaiting_upload',
            'uploaded',
        ]);
    } finally {
        request.destroy();
    }
    await vi.waitFor(async () =>
        expect(await fs.readdir(api.incoming)).toEqual([]),
    );
    expect((await upload(s, op)).status).toBe(200);
    await diskStatus(s, 'completed');
    const before = await status(s, op);
    const first = await output(s, op);
    expect((await upload(s, op)).status).toBe(200);
    expect(await status(s, op)).toEqual(before);
    expect(await output(s, op)).toEqual(first);
    expect(await fs.readdir(api.incoming)).toEqual([]);
});

it('recovers across a process crash, retains committed output and does not replay the interrupted file', async () => {
    const s = await session();
    const op = await create(s, 3);
    await api.hold(2);
    for (let index = 0; index < 3; index++)
        expect((await upload(s, op, index)).status).toBe(200);
    await vi.waitFor(() => expect(api.held).toBe(true), { timeout: 10_000 });
    const first = await output(s, op);
    expect((await status(s, op)).files.map((file) => file.status)).toEqual([
        'completed',
        'processing',
        'uploaded',
    ]);
    await api.restart(true);
    expect((await fetch(`${api.url}/readyz`)).status).toBe(200);
    await diskStatus(s, 'partially_completed');
    const recovered = await status(s, op);
    expect(recovered.files.map((file) => file.status)).toEqual([
        'completed',
        'failed',
        'completed',
    ]);
    expect(recovered.files[1]).toMatchObject({
        error: { type: 'processing_interrupted' },
    });
    expect(await output(s, op)).toEqual(first);
    await output(s, op, 2);
    // Completed data survives a subsequent graceful production restart, too.
    await api.restart();
    expect(await output(s, op)).toEqual(first);
    expect((await status(s, op)).revision).toBe(recovered.revision);
});

it('resumes an unfinished upload manifest after restart without replacing accepted slots', async () => {
    const s = await session();
    const op = await create(s);
    expect((await upload(s, op)).status).toBe(200);
    await api.restart(true);
    expect((await status(s, op)).files.map((file) => file.status)).toEqual([
        'uploaded',
        'awaiting_upload',
    ]);
    expect((await upload(s, op, 1)).status).toBe(200);
    await diskStatus(s, 'completed');
    await output(s, op);
});

it('finishes without polling when the client disappears without delivering exit cancellation', async () => {
    const s = await session();
    const op = await create(s);
    await api.hold();
    expect((await upload(s, op)).status).toBe(200);
    expect((await upload(s, op, 1)).status).toBe(200);
    await vi.waitFor(() => expect(api.held).toBe(true));
    // No further client commands/status requests; only the test encoder gate releases.
    await api.release();
    await diskStatus(s, 'completed');
    expect((await status(s, op)).counts.completed).toBe(2);
    await output(s, op);
});

it('returns 404 for retired uploads without consuming the session or staging a conversion', async () => {
    const s = await session();
    const form = new FormData();
    form.append('outputMime', 'image/webp');
    form.append('image', new Blob([new Uint8Array(png)]), 'legacy.png');
    const response = await fetch(`${base(s)}/uploads`, {
        method: 'POST',
        headers: headers(s),
        body: form,
    });
    expect(response.status).toBe(404);
    expect(await fs.readdir(api.incoming)).toEqual([]);
    expect(await fs.readdir(path.join(api.storage, s.sid))).toEqual([
        'session.info.json',
    ]);
    const operation = await create(s, 1);
    expect((await upload(s, operation)).status).toBe(200);
    await diskStatus(s, 'completed');
});

it('still downloads existing sealed legacy sessions individually and as ZIPs', async () => {
    const source = await session();
    const operation = await create(source, 1);
    expect((await upload(source, operation)).status).toBe(200);
    await diskStatus(source, 'completed');
    const bytes = await output(source, operation);
    const metadataResponse = await fetch(
        `${base(source)}/files/${operation.files[0].id}/meta`,
        { headers: headers(source) },
    );
    const meta = UploadMetaSchema.parse(await metadataResponse.json());
    const legacy = await session();
    const directory = path.join(api.storage, legacy.sid);
    // Seed only this test's legacy-format data; no operation record is created.
    const infoPath = path.join(directory, 'session.info.json');
    const info = JSON.parse(await fs.readFile(infoPath, 'utf8'));
    await fs.writeFile(path.join(directory, meta.output.storedName), bytes);
    await fs.writeFile(
        path.join(directory, `${meta.id}.json`),
        JSON.stringify(meta),
    );
    await fs.writeFile(
        infoPath,
        JSON.stringify({
            ...info,
            sealedAt: new Date().toISOString(),
            counts: { files: 1, totalBytes: png.length },
        }),
    );
    expect(await output(legacy, operation)).toEqual(bytes);
    const zip = await fetch(`${base(legacy)}/files/download`, {
        method: 'POST',
        headers: { ...headers(legacy), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [meta.id] }),
    });
    expect(zip.status).toBe(200);
    const entries = zipEntries(Buffer.from(await zip.arrayBuffer()));
    expect([...entries.keys()]).toEqual(['0.webp']);
    expect(entries.get('0.webp')).toEqual(bytes);
});
