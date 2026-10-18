import express from 'express';
import { createServer, type Server } from 'node:http';
import { errorTranslator } from '@image-web-convert/observability';
import { createApp } from '../app';
import { loadEnv } from '../env';
import type { ConversionRuntime } from '../services/conversion-runtime.service';

const auth = vi.hoisted(() => vi.fn());
const readOperation = vi.hoisted(() => vi.fn());
const completedOutput = vi.hoisted(() => vi.fn());
const resolved = vi.hoisted(() => vi.fn());
const acquireArchiveSlot = vi.hoisted(() => vi.fn());
const leaseRelease = vi.hoisted(() => vi.fn());
const acquireLease = vi.hoisted(() => vi.fn(() => leaseRelease));
const onStorageFault = vi.hoisted(() => vi.fn());

vi.mock('../services/auth.service', () => ({
    validateRequestWithToken: auth,
}));
vi.mock('../services/files.service', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../services/files.service')>()),
    resolveFilesByIds: resolved,
    acquireArchiveSlot,
}));

let server: Server;
let base: string;

async function listen(app: express.Express) {
    server = createServer(app);
    await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('Missing port');
    base = `http://127.0.0.1:${address.port}`;
}

beforeEach(async () => {
    vi.stubEnv('ENABLE_OTEL', 'false');
    vi.stubEnv('BODY_LIMIT_JSON', '32b');
    vi.stubEnv('BODY_LIMIT_URLENCODED', '32b');
    vi.stubEnv('RATE_LIMIT_MAX', '1000');
    auth.mockResolvedValue({ valid: true, info: { sealedAt: '2025-01-01' } });
    readOperation.mockResolvedValue({ operation: { id: 'operation' } });
    completedOutput.mockResolvedValue({ meta: { id: 'file' } });
    resolved.mockResolvedValue({ found: [], missing: ['file'] });
    acquireArchiveSlot.mockImplementation(() => () => undefined);
    const runtime = {
        acquireSessionUse: acquireLease,
        read: readOperation,
        completedOutput,
    } as unknown as ConversionRuntime;
    await listen(await createApp({ conversions: runtime, onStorageFault }));
});

afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    vi.unstubAllEnvs();
    vi.clearAllMocks();
});

function post(contentType: string, body: string, path = '/api/sessions') {
    return fetch(base + path, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body,
    });
}

it('normalizes malformed and oversized JSON without reflecting input', async () => {
    const malformed = await post('application/json', '{"token":"secret"');
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({
        error: { code: 'INVALID_BODY', message: 'Invalid request body' },
    });
    const oversized = await post(
        'application/json',
        JSON.stringify({ key: 'secret-secret-secret-secret' }),
    );
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toMatchObject({
        error: { code: 'PAYLOAD_TOO_LARGE' },
    });
});

it('keeps private cache policy on errors and only permits the configured preflight origin', async () => {
    const malformed = await post('application/json', '{');
    expect(malformed.status).toBe(400);
    expect(malformed.headers.get('cache-control')).toBe('private, no-store');

    await new Promise<void>((resolve) => server.close(() => resolve()));
    vi.stubEnv('CORS_ORIGIN', 'https://convert.example');
    const runtime = {
        acquireSessionUse: acquireLease,
        read: readOperation,
        completedOutput,
    } as unknown as ConversionRuntime;
    await listen(await createApp({ conversions: runtime, onStorageFault }));
    for (const origin of ['https://convert.example', 'https://other.example']) {
        const response = await fetch(base + '/api/sessions', {
            method: 'OPTIONS',
            headers: {
                Origin: origin,
                'Access-Control-Request-Method': 'POST',
                'Access-Control-Request-Headers': 'authorization,content-type',
            },
        });
        expect(response.status).toBe(204);
        expect(response.headers.get('access-control-allow-origin')).toBe(
            'https://convert.example',
        );
        if (origin !== 'https://convert.example')
            expect(
                response.headers.get('access-control-allow-origin'),
            ).not.toBe(origin);
        expect(response.headers.get('cache-control')).toBeNull();
    }
});

it('applies the configured URL-encoded limit and rejects malformed forms', async () => {
    const oversized = await post(
        'application/x-www-form-urlencoded',
        'ids=123456789012345678901234567890',
    );
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toMatchObject({
        error: { code: 'PAYLOAD_TOO_LARGE' },
    });

    const path = '/api/sessions/sid/files/download';
    for (const body of ['ids[0]=file', 'ids=file&ids=other']) {
        const response = await post(
            'application/x-www-form-urlencoded',
            body,
            path,
        );
        expect(response.status).toBe(415);
        expect(response.headers.get('content-type')).toContain(
            'application/json',
        );
    }
    const absent = await fetch(base + path, { method: 'POST' });
    expect(absent.status).toBe(415);
    const wrongType = await post('text/plain', 'ids=file', path);
    expect(wrongType.status).toBe(415);
    const manifestType = await post(
        'text/plain',
        '{}',
        '/api/sessions/sid/conversions',
    );
    expect(manifestType.status).toBe(415);
});

it('does not expose rejected conversion metadata reads', async () => {
    const logged = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
    completedOutput.mockRejectedValueOnce(new Error('private storage path'));
    const response = await fetch(base + '/api/sessions/sid/files/file/meta');
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).toContain('Conversion storage is unavailable');
    expect(body).not.toContain('private storage path');
    expect(logged).toHaveBeenCalledWith('Conversion request failed', {
        kind: 'exception',
    });
    logged.mockRestore();
});

it('returns 503 and reports an unexpected filesystem read fault', async () => {
    const failure = Object.assign(new Error('private disk detail'), {
        code: 'ESTALE',
    });
    resolved.mockRejectedValueOnce(failure);
    const response = await fetch(base + '/api/sessions/sid/files/file');
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ type: 'storage_error' });
    expect(onStorageFault).toHaveBeenCalledExactlyOnceWith(failure);
});

it('reports a filesystem read fault after download headers have started', async () => {
    const failure = Object.assign(new Error('private disk detail'), {
        code: 'EBUSY',
    });
    resolved.mockResolvedValueOnce({
        found: [
            {
                absPath: '/test/output.webp',
                contentType: 'image/webp',
                contentDisposition: 'attachment; filename="file.webp"',
            },
        ],
        missing: [],
    });
    const sendFile = vi
        .spyOn(express.response, 'sendFile')
        .mockImplementation(function (this: express.Response, ...args) {
            this.write('partial');
            const callback = args.at(-1) as (error: Error) => void;
            callback(failure);
        });
    try {
        await expect(
            fetch(base + '/api/sessions/sid/files/file').then((response) =>
                response.text(),
            ),
        ).rejects.toThrow();
        expect(onStorageFault).toHaveBeenCalledExactlyOnceWith(failure);
    } finally {
        sendFile.mockRestore();
    }
});

it('does not treat a disconnected download client as a storage fault', async () => {
    const disconnect = Object.assign(new Error('client disconnected'), {
        code: 'EPIPE',
    });
    resolved.mockResolvedValueOnce({
        found: [
            {
                absPath: '/test/output.webp',
                contentType: 'image/webp',
                contentDisposition: 'attachment; filename="file.webp"',
            },
        ],
        missing: [],
    });
    const sendFile = vi
        .spyOn(express.response, 'sendFile')
        .mockImplementation(function (this: express.Response, ...args) {
            this.write('partial');
            const callback = args.at(-1) as (error: Error) => void;
            callback(disconnect);
        });
    try {
        await expect(
            fetch(base + '/api/sessions/sid/files/file').then((response) =>
                response.text(),
            ),
        ).rejects.toThrow();
        expect(onStorageFault).not.toHaveBeenCalled();
    } finally {
        sendFile.mockRestore();
    }
});

it('holds the request lease until a conversion metadata response settles', async () => {
    let finish!: (value: { meta: { id: string } }) => void;
    completedOutput.mockReturnValueOnce(
        new Promise((resolve) => (finish = resolve)),
    );
    const response = fetch(base + '/api/sessions/sid/files/file/meta');
    await vi.waitFor(() => expect(completedOutput).toHaveBeenCalled());
    expect(acquireLease).toHaveBeenCalledWith('sid');
    expect(leaseRelease).not.toHaveBeenCalled();
    finish({ meta: { id: 'file' } });
    expect((await response).status).toBe(200);
    await vi.waitFor(() => expect(leaseRelease).toHaveBeenCalled());
});

it('rejects archive saturation before resolving current operation files', async () => {
    acquireArchiveSlot.mockReturnValueOnce(null);
    const response = await post(
        'application/json',
        JSON.stringify({ ids: ['file'] }),
        '/api/sessions/sid/files/download',
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ type: 'archive_busy' });
    expect(resolved).not.toHaveBeenCalled();
});

it('handles sendFile failure before headers and terminates after headers', async () => {
    resolved.mockResolvedValueOnce({
        found: [
            {
                absPath: '/definitely/missing/file.webp',
                contentType: 'image/webp',
                contentDisposition: 'attachment; filename="file.webp"',
            },
        ],
        missing: [],
    });
    const missing = await fetch(base + '/api/sessions/sid/files/file');
    expect(missing.status).toBe(500);
    expect(await missing.json()).toMatchObject({ type: 'storage_error' });
    expect(onStorageFault).not.toHaveBeenCalled();

    const app = express();
    app.get('/stream', (_req, res, next) => {
        res.write('partial');
        next(new Error('private stream failure'));
    });
    app.use(errorTranslator());
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await listen(app);
    await expect(
        fetch(base + '/stream').then((res) => res.text()),
    ).rejects.toThrow();
});

it('rejects invalid parser limits at startup', () => {
    expect(() => loadEnv({ BODY_LIMIT_JSON: '0mb' })).toThrow(
        'BODY_LIMIT_JSON',
    );
    expect(() => loadEnv({ BODY_LIMIT_URLENCODED: 'nonsense' })).toThrow(
        'BODY_LIMIT_URLENCODED',
    );
});

it('keeps the JSON error boundary when HTTP logging is enabled', async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    vi.stubEnv('ENABLE_OTEL', 'true');
    await listen(await createApp());
    const response = await post('application/json', '{');
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
        error: { code: 'INVALID_BODY' },
    });
});
