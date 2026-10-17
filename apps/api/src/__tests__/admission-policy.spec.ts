import { createServer, request, type Server } from 'node:http';
import { createApp } from '../app';
import { loadEnv } from '../env';
import type { ConversionRuntime } from '../services/conversion-runtime.service';

vi.mock('../services/sessions.service', () => ({
    create: vi.fn(async () => ({
        sid: 'test-session',
        expiresAt: '2099-01-01T00:00:00.000Z',
        accessToken: 'test-token',
        imageConfig: {
            ttlMinutes: 15,
            maxFiles: 20,
            maxBytesPerFile: 20_000_000,
            maxTotalBytes: 500_000_000,
        },
    })),
}));

let server: Server;
let base: string;

async function start(config: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(config)) vi.stubEnv(key, value);
    vi.stubEnv('ENABLE_OTEL', 'false');
    const app = await createApp({
        conversions: {
            isReady: () => true,
            acquireSessionUse: () => () => undefined,
        } as unknown as ConversionRuntime,
    });
    app.locals.setReady(true);
    server = createServer(app);
    await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('Missing port');
    base = `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
    if (server)
        await new Promise<void>((resolve) => server.close(() => resolve()));
    vi.unstubAllEnvs();
});

function get(path: string, forwarded?: string) {
    return fetch(base + path, {
        headers: forwarded ? { 'X-Forwarded-For': forwarded } : {},
    });
}

function duplicateForwardedHeaders() {
    return new Promise<number>((resolve, reject) => {
        const req = request(
            base + '/absent',
            {
                headers: [
                    'X-Forwarded-For',
                    '192.0.2.4',
                    'X-Forwarded-For',
                    '203.0.113.9',
                ],
            },
            (res) => {
                res.resume();
                res.on('end', () => resolve(res.statusCode ?? 0));
            },
        );
        req.on('error', reject);
        req.end();
    });
}

it('ignores forwarded identities from direct clients and exempts health/readiness', async () => {
    await start({ RATE_LIMIT_MAX: '2' });
    const validation = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
    expect((await get('/absent', '192.0.2.1')).status).toBe(404);
    expect((await get('/absent', '2001:db8::1')).status).toBe(404);
    const denied = await get('/absent', '198.51.100.8');
    expect(denied.status).toBe(429);
    expect(Number(denied.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(validation).toHaveBeenCalled();
    validation.mockRestore();
    for (let i = 0; i < 3; i++) {
        expect((await get('/healthz')).status).toBe(200);
        expect((await get('/readyz')).status).toBe(200);
    }
});

it('trusts only the configured immediate proxy and its nearest untrusted address', async () => {
    await start({ TRUSTED_PROXY_IPS: '127.0.0.1', RATE_LIMIT_MAX: '2' });
    expect((await get('/absent', '192.0.2.1, 203.0.113.8')).status).toBe(404);
    expect((await get('/absent', '192.0.2.2, 203.0.113.8')).status).toBe(404);
    expect((await get('/absent', '192.0.2.3, 203.0.113.8')).status).toBe(429);
    expect((await get('/absent', '192.0.2.1, 203.0.113.9')).status).toBe(404);
    expect(await duplicateForwardedHeaders()).toBe(400);
    expect((await get('/absent', '203.0.113.9')).status).toBe(404);
    expect((await get('/absent', '203.0.113.9')).status).toBe(429);
});

it('shares IPv4 and mapped IPv6 budgets through a trusted proxy', async () => {
    await start({ TRUSTED_PROXY_IPS: '127.0.0.1', RATE_LIMIT_MAX: '2' });
    expect((await get('/absent', '192.0.2.1')).status).toBe(404);
    expect((await get('/absent', '::ffff:192.0.2.1')).status).toBe(404);
    expect((await get('/absent', '::ffff:c000:201')).status).toBe(429);
    expect((await get('/absent', '2001:db8::1')).status).toBe(404);
});

it('rejects before JSON parsing and retains CORS on general 429 responses', async () => {
    await start({
        RATE_LIMIT_MAX: '1',
        CORS_ORIGIN: 'https://convert.example',
    });
    const headers = { Origin: 'https://convert.example' };
    expect((await fetch(base + '/absent', { headers })).status).toBe(404);
    const denied = await fetch(base + '/api/sessions', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: '{',
    });
    expect(denied.status).toBe(429);
    expect(denied.headers.get('access-control-allow-origin')).toBe(
        headers.Origin,
    );
    expect(denied.headers.get('access-control-expose-headers')).toContain(
        'Retry-After',
    );
    expect(Number(denied.headers.get('retry-after'))).toBeGreaterThan(0);
});

it('keeps session and status budgets separate from general commands', async () => {
    await start({ RATE_LIMIT_MAX: '10' });
    for (let i = 0; i < 3; i++) {
        expect(
            (await fetch(base + '/api/sessions', { method: 'POST' })).status,
        ).toBe(201);
    }
    expect(
        (await fetch(base + '/api/sessions', { method: 'POST' })).status,
    ).toBe(429);
    const statusPath = '/api/sessions/session/conversions/operation';
    for (let i = 0; i < 240; i++) {
        // Authentication/identifier failures still consume the endpoint budget.
        expect((await get(statusPath)).status).not.toBe(429);
    }
    const denied = await get(statusPath);
    expect(denied.status).toBe(429);
    expect(Number(denied.headers.get('retry-after'))).toBeGreaterThan(0);
});

it.each([
    ['TRUSTED_PROXY_IPS', 'true'],
    ['TRUSTED_PROXY_IPS', '127.0.0.1,example.com'],
    ['TRUSTED_PROXY_IPS', '127.0.0.1,'],
    ['RATE_LIMIT_MAX', '0'],
    ['RATE_LIMIT_WINDOW_MS', '2147483648'],
])('rejects invalid admission setting %s=%s at startup', (key, value) => {
    expect(() => loadEnv({ [key]: value })).toThrow(key);
});
