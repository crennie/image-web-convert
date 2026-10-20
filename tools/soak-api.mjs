// Run against the built API: npm run build && npm run soak:api.
// This is deliberately separate from the fast CI suite; it observes one
// production process over repeated real conversion and expiry cycles.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = path.resolve(import.meta.dirname, '..');
const entry = path.join(root, 'apps/api/dist/main.js');
const rounds = Number(process.env.SOAK_ROUNDS ?? 6);
if (!Number.isInteger(rounds) || rounds < 3 || rounds > 30)
    throw new Error('SOAK_ROUNDS must be an integer from 3 to 30');
if (process.platform !== 'linux')
    throw new Error('The soak resource sampler requires Linux /proc');
await fs.access(entry);

const fixture = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWMQCViAFTEMLQkAQz9BARED1cAAAAAASUVORK5CYII=',
    'base64',
);
const soakRoot = path.join(root, 'tmp/finalization-pf15');
await fs.mkdir(soakRoot, { recursive: true });
const directory = await fs.mkdtemp(path.join(soakRoot, 'run-'));
const uploads = path.join(directory, 'uploads');
const incoming = path.join(directory, 'incoming');
const log = createWriteStream(path.join(directory, 'api.log'));
const server = http.createServer();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const port = address.port;
await new Promise((resolve) => server.close(resolve));
const url = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, [entry], {
    cwd: root,
    env: {
        ...process.env,
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: String(port),
        UPLOAD_DIR: uploads,
        UPLOAD_TMP_DIR: incoming,
        OTEL_LOG_FILE: path.join(directory, 'api.log'),
        ENABLE_OTEL: 'false',
        SESSION_TTL_MINUTES: '15',
        RATE_LIMIT_MAX: '1000',
        CONVERSION_SWEEP_INTERVAL_MS: '100',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.pipe(log, { end: false });
child.stderr.pipe(log, { end: false });
const exited = new Promise((resolve) => child.once('exit', resolve));
const samples = [];
let passed = false;
const request = async (route, init, expected) => {
    const response = await fetch(url + route, {
        ...init,
        signal: AbortSignal.timeout(10_000),
    });
    if (response.status !== expected)
        throw new Error(
            `${route}: HTTP ${response.status}, expected ${expected}`,
        );
    return response;
};
const waitFor = async (check, timeout = 15_000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
        if (await check()) return;
        await delay(100);
    }
    throw new Error('Timed out waiting for conversion or expiry');
};
const sample = async (round) => {
    const status = await fs.readFile(`/proc/${child.pid}/status`, 'utf8');
    const kb = (key) =>
        Number(new RegExp(`^${key}:\\s+(\\d+)`, 'm').exec(status)?.[1]);
    const fds = (await fs.readdir(`/proc/${child.pid}/fd`)).length;
    const stat = (await fs.readFile(`/proc/${child.pid}/stat`, 'utf8'))
        .replace(/^.*\) /, '')
        .split(' ');
    const cpuTicks = Number(stat[11]) + Number(stat[12]);
    const latencies = [];
    for (let i = 0; i < 5; i++) {
        const start = performance.now();
        const response = await request('/readyz', undefined, 200);
        await response.body?.cancel();
        latencies.push(Math.round(performance.now() - start));
    }
    const diskBytes = async (folder) => {
        let total = 0;
        for (const item of await fs.readdir(folder, { withFileTypes: true })) {
            const name = path.join(folder, item.name);
            if (item.isDirectory()) total += await diskBytes(name);
            else total += (await fs.stat(name)).size;
        }
        return total;
    };
    return {
        round,
        rssKb: kb('VmRSS'),
        fds,
        cpuTicks,
        diskBytes: await diskBytes(uploads),
        probeMaxMs: Math.max(...latencies),
    };
};

try {
    await waitFor(async () => {
        try {
            const response = await fetch(url + '/readyz');
            await response.body?.cancel();
            return response.status === 200;
        } catch {
            return false;
        }
    }, 30_000);
    for (let round = 1; round <= rounds; round++) {
        // Session issuance is intentionally limited to three per minute.
        let created;
        await waitFor(async () => {
            const response = await fetch(url + '/api/sessions', {
                method: 'POST',
            });
            if (response.status === 429) {
                await response.body?.cancel();
                await delay(1_000);
                return false;
            }
            if (response.status !== 201)
                throw new Error(`Session creation: HTTP ${response.status}`);
            created = await response.json();
            return true;
        }, 90_000);
        const sid = created.sid;
        const auth = { Authorization: `Bearer ${created.token}` };
        const base = `/api/sessions/${sid}`;
        const operation = await request(
            `${base}/conversions`,
            {
                method: 'POST',
                headers: { ...auth, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    requestId: randomUUID(),
                    options: { outputMime: 'image/webp' },
                    files: [
                        {
                            clientId: 'image',
                            name: 'image.png',
                            sizeBytes: fixture.length,
                        },
                    ],
                }),
            },
            201,
        ).then((response) => response.json());
        const fileId = operation.files[0].id;
        const form = new FormData();
        form.append(
            'file',
            new Blob([fixture], { type: 'image/png' }),
            'image.png',
        );
        await request(
            `${base}/conversions/${operation.id}/files/${fileId}`,
            {
                method: 'PUT',
                headers: auth,
                body: form,
            },
            200,
        );
        await waitFor(async () => {
            const response = await request(
                `${base}/conversions/${operation.id}`,
                { headers: auth },
                200,
            );
            const status = (await response.json()).status;
            if (['failed', 'cancelled'].includes(status))
                throw new Error(`Conversion ended as ${status}`);
            return status === 'completed';
        });
        const image = await request(
            `${base}/files/${fileId}`,
            { headers: auth },
            200,
        );
        if (!(await image.arrayBuffer()).byteLength)
            throw new Error('Empty converted image');
        const zip = await request(
            `${base}/files/download`,
            {
                method: 'POST',
                headers: { ...auth, 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: [fileId] }),
            },
            200,
        );
        if (!(await zip.arrayBuffer()).byteLength) throw new Error('Empty ZIP');

        const sessionDir = path.join(uploads, sid);
        const expiry = new Date(Date.now() - 1000).toISOString();
        for (const file of ['conversion.info.json', 'session.info.json']) {
            const target = path.join(sessionDir, file);
            const record = JSON.parse(await fs.readFile(target, 'utf8'));
            if (record.operation) record.operation.expiresAt = expiry;
            else record.expiresAt = expiry;
            const staged = `${target}.soak`;
            await fs.writeFile(staged, JSON.stringify(record));
            await fs.rename(staged, target);
        }
        await waitFor(
            async () =>
                !(await fs.stat(sessionDir).catch((error) => {
                    if (error.code === 'ENOENT') return undefined;
                    throw error;
                })),
        );
        await delay(200);
        samples.push(await sample(round));
        process.stdout.write(`${JSON.stringify(samples.at(-1))}\n`);
    }
    const first = samples[0];
    const last = samples.at(-1);
    if (samples.some((point) => point.diskBytes !== 0))
        throw new Error('Expired session data remained on disk');
    if (last.fds - first.fds > 12)
        throw new Error('File descriptors grew across expiry cycles');
    if (last.rssKb - first.rssKb > 50 * 1024)
        throw new Error('RSS grew by more than 50 MiB across expiry cycles');
    passed = true;
    process.stdout.write(
        `Soak passed: ${rounds} expiry cycles; log: ${path.join(directory, 'api.log')}\n`,
    );
} finally {
    child.kill('SIGTERM');
    const forced = setTimeout(() => child.kill('SIGKILL'), 12_000);
    await exited;
    clearTimeout(forced);
    await new Promise((resolve) => log.end(resolve));
    if (passed) await fs.rm(directory, { recursive: true });
}
