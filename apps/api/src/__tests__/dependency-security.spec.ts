import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import express from 'express';
import { rateLimit } from 'express-rate-limit';

const root = path.resolve(__dirname, '../../../..');
const execute = promisify(execFile);

// Hostile parsers must never run unbounded in the Vitest worker. The fixtures
// are small; a regression kills only the child, with bounded heap and output.
async function isolated(script: string) {
    return execute(
        process.execPath,
        ['--max-old-space-size=128', '--input-type=module', '-e', script],
        {
            cwd: root,
            timeout: 5000,
            killSignal: 'SIGKILL',
            maxBuffer: 64 * 1024,
        },
    );
}

it('terminates sniffing malformed ASF headers and bounds ZIP content-type inflation', async () => {
    await isolated(`
        import assert from 'node:assert/strict';
        import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
        import { fileTypeFromFile } from 'file-type';
        import { deflateRawSync } from 'node:zlib';
        await mkdir('tmp', { recursive: true });
        const dir = await mkdtemp('tmp/sniffer-security-');
        try {
            const asf = Buffer.alloc(96);
            Buffer.from('3026b2758e66cf11a6d900aa0062ce6c', 'hex').copy(asf);
            // The sub-object at offset 30 has size zero: old parsers rewind.
            await writeFile(dir + '/malformed.asf', asf);
            const detected = await fileTypeFromFile(dir + '/malformed.asf');
            assert.ok(!detected || !detected.mime.startsWith('image/'));

            // Only 2 MiB expanded, above the detector's 1 MiB budget. Lie about
            // expanded length to exercise the actual inflater's output limit.
            const xml = Buffer.from('<Types>' + ' '.repeat(2 * 1024 * 1024) + '<Override ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
            const compressed = deflateRawSync(xml);
            const name = Buffer.from('[Content_Types].xml');
            const header = Buffer.alloc(30);
            header.writeUInt32LE(0x04034b50, 0);
            header.writeUInt16LE(20, 4);
            header.writeUInt16LE(8, 8);
            header.writeUInt32LE(compressed.length, 18);
            header.writeUInt32LE(1, 22);
            header.writeUInt16LE(name.length, 26);
            await writeFile(dir + '/oversized.zip', Buffer.concat([header, name, compressed]));
            assert.deepEqual(await fileTypeFromFile(dir + '/oversized.zip'), { ext: 'zip', mime: 'application/zip' });
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    `);
}, 10_000);

it('destroys the compression stream when a client closes an unfinished response', async () => {
    await isolated(`
        import assert from 'node:assert/strict';
        import zlib from 'node:zlib';
        import http from 'node:http';
        import { setTimeout as delay } from 'node:timers/promises';
        import express from 'express';
        import compression from 'compression';
        const original = zlib.createGzip;
        let gzip;
        Object.defineProperty(zlib, 'createGzip', { value: (...args) => {
            gzip = original(...args);
            return gzip;
        }});
        const app = express();
        app.use(compression({ threshold: 0 }));
        app.get('/', (_req, res) => {
            res.type('text/plain');
            res.write('unfinished response');
            res.flush();
        });
        const server = app.listen(0, '127.0.0.1');
        await new Promise(resolve => server.once('listening', resolve));
        try {
            await new Promise((resolve, reject) => {
                const req = http.get({ host: '127.0.0.1', port: server.address().port,
                    headers: { 'Accept-Encoding': 'gzip' } }, res => {
                    assert.equal(res.headers['content-encoding'], 'gzip');
                    res.once('data', () => { res.destroy(); resolve(); });
                });
                req.on('error', reject);
            });
            for (let i = 0; i < 100 && !gzip?.destroyed; i++) await delay(10);
            assert.ok(gzip?.destroyed, 'aborted response must release its zlib stream');
        } finally {
            server.closeAllConnections();
            await new Promise(resolve => server.close(resolve));
        }
    `);
}, 10_000);

it('shares one limiter budget across IPv4 and equivalent mapped IPv6 spellings', async () => {
    const app = express();
    // Test-only trusted proxy, not a recommendation for production topology.
    app.set('trust proxy', 1);
    app.use(
        rateLimit({
            windowMs: 60_000,
            limit: 2,
            standardHeaders: true,
            legacyHeaders: false,
        }),
    );
    app.get('/', (_req, res) => res.send('ok'));
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('Missing port');
    const url = `http://127.0.0.1:${address.port}`;
    try {
        for (const [ip, status] of [
            ['192.0.2.1', 200],
            ['::ffff:192.0.2.1', 200],
            ['::ffff:c000:201', 429],
            ['192.0.2.2', 200],
        ] as const) {
            const response = await fetch(url, {
                headers: { 'X-Forwarded-For': ip },
            });
            expect(response.status).toBe(status);
            if (status === 429)
                expect(
                    Number(response.headers.get('retry-after')),
                ).toBeGreaterThan(0);
            await response.body?.cancel();
        }
    } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
});

it('contains Nx sockets in an owner-only directory and disables the daemon', async () => {
    const guard = `import assert from 'node:assert/strict';
        import { statSync } from 'node:fs';
        process.on('exit', () => {
            assert.equal(process.env.NX_DAEMON, 'false');
            assert.equal(process.env.NX_ISOLATE_PLUGINS, 'true');
            const directory = process.env.NX_SOCKET_DIR;
            assert.ok(directory.startsWith(process.cwd() + '/tmp/nx-'));
            assert.equal(statSync(directory).mode & 0o777, 0o700);
        });`;
    await execute(
        process.execPath,
        [
            '--import',
            'data:text/javascript,' + encodeURIComponent(guard),
            'tools/nx.mjs',
            '--version',
        ],
        {
            cwd: root,
            env: {
                ...process.env,
                NX_DAEMON: 'true',
                NX_ISOLATE_PLUGINS: 'true',
            },
            timeout: 10_000,
        },
    );
}, 15_000);
