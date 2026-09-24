import fs from 'node:fs/promises';
import path from 'node:path';
import http, { type Server, type ClientRequest } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import {
    ApiConversionOperationSchema,
    type ApiConversionOperation,
} from '@image-web-convert/schemas';
import type { ProcessInput, ProcessOutput } from '../services/image.service';
import type { getConversionRuntimeConfig } from '../env';

// HTTP/filesystem integration runs alongside builds and browser tests in CI.
vi.setConfig({ testTimeout: 15_000, hookTimeout: 20_000 });

let directory: string;
let root: string;
let temp: string;
let url: string;
let server: Server;
let runtime: ReturnType<
    typeof import('../services/conversion-runtime.service').createConversionRuntime
>;
let runtimeConfig: ReturnType<typeof getConversionRuntimeConfig>;
let createRuntime: typeof import('../services/conversion-runtime.service').createConversionRuntime;
let createApp: typeof import('../app').createApp;
let createSession: typeof import('../services/sessions.service').create;
let realConvert: typeof import('../services/image.service').processImageToMimeType;
let convert: ReturnType<
    typeof vi.fn<(input: ProcessInput) => Promise<ProcessOutput>>
>;
let output: ProcessOutput;
let releases: (() => void)[];
let sockets: ClientRequest[];
const bytes = Buffer.from('data');

beforeAll(async () => {
    await fs.mkdir(path.resolve('tmp'), { recursive: true });
    directory = await fs.mkdtemp(path.resolve('tmp/conversion-http-'));
    root = path.join(directory, 'uploads');
    temp = path.join(directory, 'requests');
    process.env.UPLOAD_DIR = root;
    process.env.UPLOAD_TMP_DIR = temp;
    process.env.ENABLE_OTEL = 'false';
    process.env.RATE_LIMIT_MAX = '100';
    process.env.SESSION_PER_FILE_BYTES = '100000';
    ({ createApp } = await import('../app'));
    ({ createConversionRuntime: createRuntime } = await import(
        '../services/conversion-runtime.service'
    ));
    ({ create: createSession } = await import('../services/sessions.service'));
    ({ processImageToMimeType: realConvert } = await import(
        '../services/image.service'
    ));
    const buffer = await sharp({
        create: { width: 4, height: 3, channels: 3, background: 'red' },
    })
        .webp()
        .toBuffer();
    output = {
        buffer,
        outputMime: 'image/webp',
        info: {
            width: 4,
            height: 3,
            sizeBytes: buffer.length,
            colorSpace: 'srgb',
            animated: false,
            exifStripped: true,
        },
        inputMeta: { mime: 'image/png' },
    };
});
beforeEach(async () => {
    await fs.mkdir(temp, { recursive: true });
    releases = [];
    sockets = [];
    convert = vi.fn(async () => output);
    const { getConversionRuntimeConfig } = await import('../env');
    runtimeConfig = {
        ...getConversionRuntimeConfig({}),
        uploadIdleMs: 10_000,
        uploadTotalMs: 30_000,
        sweepIntervalMs: 100,
        shutdownGraceMs: 5_000,
    };
    runtime = createRuntime({ root, convert, config: runtimeConfig });
    await runtime.start();
    const app = await createApp({ conversions: runtime });
    app.locals.setReady(true);
    await new Promise<void>((resolve) => {
        server = app.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('Missing port');
    url = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
    sockets.forEach((socket) => socket.destroy());
    releases.forEach((release) => release());
    await runtime.whenIdle();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    // stop() can resolve without draining; never delete live storage silently.
    expect(await runtime.stop()).toEqual({ drained: true });
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(temp, { recursive: true, force: true });
    vi.restoreAllMocks();
});
afterAll(async () => {
    await fs.rm(directory, { recursive: true, force: true });
});

type Session = Awaited<ReturnType<typeof createSession>>;
function base(session: Session) {
    return `/api/sessions/${session.sid}/conversions`;
}
function headers(session: Session) {
    return { Authorization: `Bearer ${session.accessToken}` };
}
function intent(count = 2) {
    return {
        requestId: 'request-one',
        options: { outputMime: 'image/webp' },
        files: Array.from({ length: count }, (_, i) => ({
            clientId: `client-${i}`,
            name: `${i}.png`,
            sizeBytes: 4,
        })),
    };
}
async function create(session: Session, manifest = intent()) {
    return fetch(url + base(session), {
        method: 'POST',
        headers: { ...headers(session), 'Content-Type': 'application/json' },
        body: JSON.stringify(manifest),
    });
}
async function operation(session: Session, count = 2) {
    const response = await create(session, intent(count));
    expect(response.status).toBe(201);
    return ApiConversionOperationSchema.parse(await response.json());
}
function uploadPath(session: Session, op: ApiConversionOperation, index = 0) {
    return `${base(session)}/${op.id}/files/${op.files[index].id}`;
}
function upload(
    session: Session,
    op: ApiConversionOperation,
    index = 0,
    data = bytes,
) {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(data)]), 'transport-name.png');
    return fetch(url + uploadPath(session, op, index), {
        method: 'PUT',
        headers: headers(session),
        body: form,
    });
}
async function status(session: Session, op: ApiConversionOperation) {
    const response = await fetch(`${url}${base(session)}/${op.id}`, {
        headers: headers(session),
    });
    expect(response.status).toBe(200);
    return ApiConversionOperationSchema.parse(await response.json());
}
function cancel(session: Session, op: ApiConversionOperation) {
    return fetch(`${url}${base(session)}/${op.id}/cancel`, {
        method: 'POST',
        headers: headers(session),
    });
}
async function eventually(test: () => boolean | Promise<boolean>) {
    await vi.waitFor(async () => expect(await test()).toBe(true), {
        timeout: 10_000,
        interval: 20,
    });
}
function holdNext() {
    let release!: () => void;
    const held = new Promise<ProcessOutput>((resolve) => {
        release = () => resolve(output);
    });
    releases.push(release);
    convert.mockImplementationOnce(() => held);
    return release;
}
function partial(session: Session, op: ApiConversionOperation, index = 0) {
    const request = http.request(url + uploadPath(session, op, index), {
        method: 'PUT',
        headers: {
            ...headers(session),
            'Content-Type': 'multipart/form-data; boundary=test-boundary',
        },
    });
    request.on('error', () => undefined);
    request.on('response', (response) => response.resume());
    request.write(
        '--test-boundary\r\nContent-Disposition: form-data; name="file"; filename="x.png"\r\nContent-Type: image/png\r\n\r\nda',
    );
    sockets.push(request);
    return request;
}

it('creates idempotently at capacity, rejects changed intent and hides internal state', async () => {
    const session = await createSession();
    const op = await operation(session);
    for (let i = 0; i < 2; i++) await operation(await createSession());
    const retry = await create(session);
    expect(retry.status).toBe(201);
    expect(ApiConversionOperationSchema.parse(await retry.json()).id).toBe(
        op.id,
    );
    expect((await create(await createSession())).status).toBe(503);
    expect((await create(session, intent(1))).status).toBe(409);
    expect(
        (await create(session, { ...intent(), requestId: 'other' })).status,
    ).toBe(409);
    const snapshot = await status(session, op);
    expect(snapshot).not.toHaveProperty('processingOptions');
    expect(snapshot).not.toHaveProperty('requestId');
    expect(snapshot).not.toHaveProperty('inputs');
});

it('accepts uploads without waiting for conversion, starts only after the last slot and never needs GET to advance', async () => {
    const session = await createSession();
    const op = await operation(session);
    expect((await upload(session, op)).status).toBe(200);
    await delay(150);
    expect(convert).not.toHaveBeenCalled();
    const release = holdNext();
    const last = await upload(session, op, 1);
    expect(last.status).toBe(200);
    await eventually(() => convert.mock.calls.length === 1);
    expect((await status(session, op)).status).toBe('processing');
    release();
    await runtime.whenIdle();
    expect(convert).toHaveBeenCalledTimes(2);
    expect((await status(session, op)).status).toBe('completed');
    expect(
        (await upload(session, op, 0, Buffer.from('replacement'))).status,
    ).toBe(200);
    expect(convert).toHaveBeenCalledTimes(2);
    expect(await fs.readdir(temp)).toEqual([]);
});

it('serializes simultaneous final uploads and preserves one conversion per slot', async () => {
    const session = await createSession();
    const op = await operation(session);
    const replies = await Promise.all([
        upload(session, op),
        upload(session, op, 1),
    ]);
    expect(replies.map((response) => response.status)).toEqual([200, 200]);
    await runtime.whenIdle();
    expect(convert).toHaveBeenCalledTimes(2);
});

it('authenticates and validates operation/file association before receiving bytes', async () => {
    const session = await createSession();
    const op = await operation(session);
    const other = await createSession();
    expect(
        (await fetch(url + uploadPath(session, op), { method: 'PUT' })).status,
    ).toBe(401);
    expect(
        (
            await fetch(url + uploadPath(session, op), {
                method: 'PUT',
                headers: headers(other),
            })
        ).status,
    ).toBe(401);
    expect(
        (
            await fetch(`${url}${base(other)}/${op.id}`, {
                headers: headers(other),
            })
        ).status,
    ).toBe(404);
    expect(
        (
            await fetch(`${url}${base(session)}/${op.id}/files/foreign`, {
                method: 'PUT',
                headers: headers(session),
            })
        ).status,
    ).toBe(404);
    expect(await fs.readdir(temp).catch(() => [])).toEqual([]);
});

it('preserves completed downloads and ZIP members during processing and cancellation', async () => {
    const session = await createSession();
    const op = await operation(session, 3);
    convert.mockResolvedValueOnce(output);
    const release = holdNext();
    for (let i = 0; i < 3; i++)
        expect((await upload(session, op, i)).status).toBe(200);
    await eventually(() => convert.mock.calls.length === 2);
    const download = `${url}/api/sessions/${session.sid}/files/`;
    expect(
        (await fetch(download + op.files[0].id, { headers: headers(session) }))
            .status,
    ).toBe(200);
    expect(
        (await fetch(download + op.files[1].id, { headers: headers(session) }))
            .status,
    ).toBe(404);
    const metadata = await fetch(download + op.files[0].id + '/meta', {
        headers: headers(session),
    });
    expect(await metadata.json()).toMatchObject({
        original: { name: '0.png' },
    });
    const zip = await fetch(download + 'download', {
        method: 'POST',
        headers: { ...headers(session), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: op.files.map((file) => file.id) }),
    });
    expect(zip.status).toBe(200);
    expect(zip.headers.get('x-missing-ids')).toContain(op.files[1].id);
    const archive = Buffer.from(await zip.arrayBuffer());
    expect(archive.includes(Buffer.from('0.webp'))).toBe(true);
    expect(archive.includes(Buffer.from('1.webp'))).toBe(false);
    const stopping = ApiConversionOperationSchema.parse(
        await (await cancel(session, op)).json(),
    );
    expect(stopping.status).toBe('processing');
    expect(stopping.cancelRequestedAt).not.toBeNull();
    release();
    await runtime.whenIdle();
    const stopped = await status(session, op);
    expect(stopped.status).toBe('cancelled');
    expect(stopped.counts.completed).toBe(2);
    expect(stopped.files[2].status).toBe('cancelled');
    expect(
        (await fetch(download + op.files[0].id, { headers: headers(session) }))
            .status,
    ).toBe(200);
    expect((await cancel(session, op)).status).toBe(200);
});

it('cancels before upload and rejects stale slots', async () => {
    const session = await createSession();
    const op = await operation(session);
    expect((await cancel(session, op)).status).toBe(200);
    expect((await upload(session, op)).status).toBe(409);
    expect(convert).not.toHaveBeenCalled();
});

it('records permanent byte mismatch and continues successful siblings', async () => {
    const session = await createSession();
    const op = await operation(session);
    expect((await upload(session, op, 0, Buffer.from('bad'))).status).toBe(400);
    expect((await upload(session, op, 1)).status).toBe(200);
    await runtime.whenIdle();
    const snapshot = await status(session, op);
    expect(snapshot.status).toBe('partially_completed');
    expect(snapshot.files[0]).toMatchObject({
        status: 'failed',
        error: { type: 'upload_size_mismatch' },
    });
});

it('reports actual malformed/unsupported images as failed files in a successful status response', async () => {
    convert.mockImplementation(realConvert);
    const session = await createSession();
    const op = await operation(session, 1);
    expect((await upload(session, op)).status).toBe(200);
    await runtime.whenIdle();
    expect((await status(session, op)).files[0]).toMatchObject({
        status: 'failed',
    });
});

it('keeps malformed multipart retryable and removes request staging', async () => {
    const session = await createSession();
    const op = await operation(session, 1);
    const response = await fetch(url + uploadPath(session, op), {
        method: 'PUT',
        headers: {
            ...headers(session),
            'Content-Type': 'multipart/form-data; boundary=incomplete',
        },
        body: '--incomplete\r\n',
    });
    expect(response.status).toBe(400);
    expect((await status(session, op)).files[0].status).toBe('awaiting_upload');
    expect((await upload(session, op)).status).toBe(200);
    await eventually(async () => (await fs.readdir(temp)).length === 0);
});

it('rejects duplicate slot and excess transport admission before parsing, and cleans disconnected uploads', async () => {
    const session = await createSession();
    const op = await operation(session, 3);
    const first = partial(session, op);
    const second = partial(session, op, 1);
    await eventually(async () => (await fs.readdir(temp)).length === 2);
    expect((await upload(session, op)).status).toBe(409);
    expect((await upload(session, op, 2)).status).toBe(503);
    first.destroy();
    second.destroy();
    await eventually(async () => (await fs.readdir(temp)).length === 0);
    expect(
        (await status(session, op)).files.every(
            (file) => file.status === 'awaiting_upload',
        ),
    ).toBe(true);
    expect((await upload(session, op)).status).toBe(200);
});

it('aborts idle uploads and permits a clean retry', async () => {
    // Only this scenario needs a short idle deadline. The runtime retains the
    // config object, so set it before admitting the incomplete request.
    runtimeConfig.uploadIdleMs = 1_000;
    const session = await createSession();
    const op = await operation(session, 1);
    partial(session, op);
    await eventually(async () => (await fs.readdir(temp)).length === 1);
    await eventually(async () => (await fs.readdir(temp)).length === 0);
    runtimeConfig.uploadIdleMs = 10_000;
    expect((await upload(session, op)).status).toBe(200);
});

it('rejects acceptance when cancellation wins during byte transfer', async () => {
    const session = await createSession();
    const op = await operation(session, 1);
    const request = partial(session, op);
    await eventually(async () => (await fs.readdir(temp)).length === 1);
    expect((await cancel(session, op)).status).toBe(200);
    const code = new Promise<number | undefined>((resolve) =>
        request.once('response', (response) => resolve(response.statusCode)),
    );
    request.end('ta\r\n--test-boundary--\r\n');
    expect(await code).toBe(409);
    expect(convert).not.toHaveBeenCalled();
});

it('isolates the polling budget from commands and enforces its own ceiling', async () => {
    const session = await createSession();
    const op = await operation(session, 1);
    for (let i = 0; i < 125; i++)
        expect((await status(session, op)).status).toBe('awaiting_uploads');
    expect((await cancel(session, op)).status).toBe(200);
    let limited = false;
    for (let i = 0; i < 120; i++) {
        const response = await fetch(`${url}${base(session)}/${op.id}`, {
            headers: headers(session),
        });
        if (response.status === 429) {
            limited = true;
            break;
        }
    }
    expect(limited).toBe(true);
});

it('rejects extra multipart files and fields without resolving the slot', async () => {
    const session = await createSession();
    const op = await operation(session, 1);
    const form = new FormData();
    form.append('first', new Blob(['data']), 'one.png');
    form.append('second', new Blob(['data']), 'two.png');
    const response = await fetch(url + uploadPath(session, op), {
        method: 'PUT',
        headers: headers(session),
        body: form,
    });
    expect(response.status).toBe(400);
    expect((await status(session, op)).files[0].status).toBe('awaiting_upload');
    expect(convert).not.toHaveBeenCalled();
});

it('enforces manifest and actual per-file byte limits', async () => {
    const session = await createSession();
    const manifest = intent(1);
    manifest.files[0].sizeBytes = 100001;
    expect((await create(session, manifest)).status).toBe(413);
    manifest.files[0].sizeBytes = 100000;
    const op = ApiConversionOperationSchema.parse(
        await (await create(session, manifest)).json(),
    );
    const response = await upload(session, op, 0, Buffer.alloc(100001));
    expect(response.status).toBe(413);
    expect((await status(session, op)).files[0]).toMatchObject({
        status: 'failed',
        error: { type: 'upload_limit_exceeded' },
    });
});

it('keeps storage failures retryable and checks transport validity immediately before publication', async () => {
    const session = await createSession();
    const op = await operation(session, 1);
    const { ConversionStorageError } = await import(
        '../services/conversion-storage.service'
    );
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const accept = vi
        .spyOn(runtime, 'acceptUpload')
        .mockRejectedValueOnce(new ConversionStorageError('disk unavailable'));
    expect((await upload(session, op)).status).toBe(503);
    expect((await status(session, op)).files[0].status).toBe('awaiting_upload');
    accept.mockRestore();
    // Inject loss of transport validity at the storage commit boundary, after staging.
    const storage = await import('../services/conversion-storage.service');
    const source = path.join(directory, 'deadline-source');
    await fs.writeFile(source, bytes);
    const { ConversionTransitionError } = await import(
        '../services/conversions.service'
    );
    await expect(
        storage
            .createConversionStorage({ root })
            .acceptUpload(session.sid, op.id, op.files[0].id, source, () => {
                throw new ConversionTransitionError(
                    'upload_error',
                    'Deadline elapsed',
                );
            }),
    ).rejects.toThrow('Deadline elapsed');
    expect((await status(session, op)).files[0].status).toBe('awaiting_upload');
    expect((await upload(session, op)).status).toBe(200);
});

it('applies the total upload deadline even while bytes keep arriving', async () => {
    // Keep idle longer than total so an idle timeout cannot satisfy this test.
    runtimeConfig.uploadTotalMs = 1_500;
    const session = await createSession();
    const op = await operation(session, 1);
    const request = partial(session, op);
    const interval = setInterval(() => {
        if (!request.destroyed) request.write('a');
    }, 50);
    try {
        await eventually(async () => (await fs.readdir(temp)).length === 1);
        await eventually(async () => (await fs.readdir(temp)).length === 0);
        await eventually(
            () => request.socket?.destroyed === true || request.destroyed,
        );

        expect((await status(session, op)).files[0].status).toBe(
            'awaiting_upload',
        );
    } finally {
        clearInterval(interval);
    }
});

it('retires legacy uploads while preserving sealed-session and creation claim guards', async () => {
    const session = await createSession();
    await operation(session, 1);
    const form = new FormData();
    form.append('outputMime', 'image/webp');
    form.append('image', new Blob(['data']), 'x.png');
    const legacy = await fetch(`${url}/api/sessions/${session.sid}/uploads`, {
        method: 'POST',
        headers: headers(session),
        body: form,
    });
    expect(legacy.status).toBe(404);
    expect(convert).not.toHaveBeenCalled();
    const other = await createSession();
    const { readSessionInfo, writeSessionInfo } = await import(
        '../services/sessions.service'
    );
    const info = await readSessionInfo(other.sid);
    await writeSessionInfo(other.sid, {
        ...info,
        sealedAt: new Date().toISOString(),
    });
    expect((await create(other, intent(1))).status).toBe(409);
    const fresh = await createSession();
    const { claimSessionWork } = await import(
        '../services/session-work.service'
    );
    const release = claimSessionWork(fresh.sid);
    try {
        expect((await create(fresh, intent(1))).status).toBe(409);
    } finally {
        release();
    }
    expect((await create(fresh, intent(1))).status).toBe(201);
});

it('rejects expired-session requests without receiving bytes', async () => {
    const session = await createSession();
    const op = await operation(session, 1);
    const { readSessionInfo, writeSessionInfo } = await import(
        '../services/sessions.service'
    );
    const info = await readSessionInfo(session.sid);
    await writeSessionInfo(session.sid, {
        ...info,
        expiresAt: new Date(0).toISOString(),
    });
    expect((await upload(session, op)).status).toBe(403);
    expect(convert).not.toHaveBeenCalled();
});

it('bounds multipart framing before parsing and leaves oversized transport retryable', async () => {
    const session = await createSession();
    const op = await operation(session, 1);
    // More than declared bytes + framing allowance: reject before parsing a slot.
    const response = await upload(session, op, 0, Buffer.alloc(200000)).catch(
        () => null,
    );
    if (response) expect(response.status).toBe(413);
    expect((await status(session, op)).files[0].status).toBe('awaiting_upload');
    await eventually(async () => (await fs.readdir(temp)).length === 0);
    expect((await upload(session, op)).status).toBe(200);
});

it('removes only abandoned conversion request directories during startup cleanup', async () => {
    const { recoverConversionRequestStaging } = await import(
        '../services/conversion-upload.service'
    );
    const staging = await fs.mkdtemp(path.join(temp, 'conversion-'));
    await fs.writeFile(path.join(staging, 'request.multipart'), 'incomplete');
    await fs.writeFile(path.join(temp, 'legacy-upload'), 'keep');
    await recoverConversionRequestStaging(temp);
    expect(await fs.readdir(temp)).toEqual(['legacy-upload']);
});

it('closes a failed ZIP stream and releases its session lease', async () => {
    const session = await createSession();
    const op = await operation(session, 1);
    expect((await upload(session, op)).status).toBe(200);
    await runtime.whenIdle();
    const files = await import('../services/files.service');
    vi.spyOn(files, 'writeZip').mockImplementationOnce(async (response) => {
        response.write('PK');
        await delay(20);
        throw new Error('Archive source failed during streaming');
    });
    const response = await fetch(
        `${url}/api/sessions/${session.sid}/files/download`,
        {
            method: 'POST',
            headers: {
                ...headers(session),
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ ids: [op.files[0].id] }),
        },
    );
    await expect(response.arrayBuffer()).rejects.toThrow();
    expect(await runtime.stop()).toEqual({ drained: true });
});
