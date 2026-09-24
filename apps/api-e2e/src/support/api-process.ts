import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type {
    ApiConversionOperation,
    SessionImageConfig,
} from '@image-web-convert/schemas';

const root = path.resolve(__dirname, '../../../..');
export async function startNodeServer(options: {
    entry: string;
    args?: string[];
    cwd?: string;
    log: string;
    readyPath: string;
    env?: NodeJS.ProcessEnv;
}) {
    await mkdir(path.dirname(options.log), { recursive: true });
    const reservation = createServer();
    await new Promise<void>((resolve, reject) => {
        reservation.once('error', reject);
        reservation.listen(0, '127.0.0.1', resolve);
    });
    const address = reservation.address();
    if (!address || typeof address === 'string')
        throw new Error('No test port');
    const port = address.port;
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    const url = `http://127.0.0.1:${port}`;
    const log = createWriteStream(options.log, { flags: 'a' });
    let expectedSignal: NodeJS.Signals | undefined;
    let exited = false;
    let failure: Error | undefined;
    const child = spawn(
        process.execPath,
        [options.entry, ...(options.args ?? [])],
        {
            cwd: options.cwd ?? root,
            env: {
                ...process.env,
                ...options.env,
                NODE_ENV: 'production',
                HOST: '127.0.0.1',
                PORT: String(port),
            },
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        },
    );
    const closed = new Promise<void>((resolve) => {
        child.once('error', (error) => {
            failure = error;
        });
        child.once('exit', (code, signal) => {
            exited = true;
            if (!expectedSignal || (code !== 0 && signal !== expectedSignal)) {
                failure ??= new Error(
                    `Test server exited (${code}, ${signal}); see ${options.log}`,
                );
            }
        });
        child.once('close', resolve);
    });
    child.stdout?.pipe(log, { end: false });
    child.stderr?.pipe(log, { end: false });
    let stopping: Promise<void> | undefined;
    function stop(crash = false): Promise<void> {
        stopping ??= stopOnce(crash);
        return stopping;
    }
    async function stopOnce(crash: boolean) {
        expectedSignal = crash ? 'SIGKILL' : 'SIGTERM';
        if (!exited) child.kill(expectedSignal);
        const forced = setTimeout(() => {
            failure ??= new Error(
                `Test server exceeded shutdown deadline; see ${options.log}`,
            );
            child.kill('SIGKILL');
        }, 12_000);
        try {
            await closed;
        } finally {
            clearTimeout(forced);
            await new Promise<void>((resolve) => log.end(resolve));
        }
        if (failure) throw failure;
    }
    try {
        const deadline = Date.now() + 30_000;
        while (Date.now() < deadline) {
            if (failure) throw failure;
            if (exited)
                throw new Error(
                    `Server exited before readiness: ${options.log}`,
                );
            const response = await fetch(url + options.readyPath, {
                signal: AbortSignal.timeout(1000),
            }).catch(() => undefined);
            await response?.body?.cancel();
            if (response?.ok && !exited) return { url, port, child, stop };
            if (response && response.status !== 503)
                throw new Error(
                    `Readiness returned HTTP ${response.status}; see ${options.log}`,
                );
            await delay(100);
        }
        throw new Error(`Readiness timed out; see ${options.log}`);
    } catch (error) {
        await stop().catch(() => undefined);
        throw error;
    }
}

function ipc(child: ChildProcess, command: string, after?: number) {
    const id = ++nextId;
    return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
            () => finish(new Error(`Test IPC ${command} timed out`)),
            5000,
        );
        function finish(error?: Error) {
            clearTimeout(timeout);
            child.off('message', receive);
            child.off('exit', exit);
            if (error) reject(error);
            else resolve();
        }
        function receive(message: { id?: number }) {
            if (message.id === id) finish();
        }
        function exit() {
            finish(new Error('Test server exited during IPC'));
        }
        child.on('message', receive);
        child.once('exit', exit);
        child.send({ command, after, id }, (error) => {
            if (error) finish(error);
        });
    });
}
let nextId = 0;

export async function startApi(
    directory: string,
    logs: string,
    controlled = false,
    limits: Partial<Pick<SessionImageConfig, 'maxTotalBytes'>> = {},
) {
    const storage = path.join(directory, 'uploads');
    const incoming = path.join(directory, 'incoming');
    const env = {
        UPLOAD_DIR: storage,
        UPLOAD_TMP_DIR: incoming,
        OTEL_LOG_FILE: path.join(directory, 'app.log'),
        ENABLE_OTEL: 'false',
        SESSION_TTL_MINUTES: '15',
        SESSION_MAX_FILES: '20',
        SESSION_PER_FILE_BYTES: '20000000',
        SESSION_MAX_TOTAL_BYTES: String(limits.maxTotalBytes ?? 500_000_000),
        RATE_LIMIT_MAX: '1000',
        RATE_LIMIT_WINDOW_MS: '60000',
        CONVERSION_MAX_OPERATIONS: '3',
        CONVERSION_MAX_UPLOADS: '2',
        CONVERSION_UPLOAD_IDLE_MS: '60000',
        CONVERSION_UPLOAD_TOTAL_MS: '300000',
        CONVERSION_FILE_TIMEOUT_MS: '120000',
        CONVERSION_SWEEP_INTERVAL_MS: '100',
        CONVERSION_SHUTDOWN_GRACE_MS: '10000',
        CONVERSION_MAX_INPUT_PIXELS: '200000000',
        CONVERSION_MAX_DIMENSION: '8192',
    };
    const launch = (useGate: boolean) =>
        startNodeServer({
            entry: path.join(
                root,
                useGate
                    ? 'apps/api-e2e/test-output/server/controlled-api.mjs'
                    : 'apps/api/dist/main.js',
            ),
            readyPath: '/readyz',
            log: path.join(logs, 'api.log'),
            env,
        });
    let server = await launch(controlled);
    let gateAvailable = controlled;
    let held = false;
    const observe = () =>
        server.child.on('message', (message: { event?: string }) => {
            if (message.event === 'held') held = true;
        });
    observe();
    return {
        get url() {
            return server.url;
        },
        get port() {
            return server.port;
        },
        get held() {
            return held;
        },
        storage,
        incoming,
        async hold(after = 1) {
            if (!gateAvailable)
                throw new Error(
                    'Converter gates require the test-only executable',
                );
            held = false;
            await ipc(server.child, 'hold', after);
        },
        async release() {
            await ipc(server.child, 'release');
        },
        async restart(crash = false) {
            await server.stop(crash);
            // Recovery is always exercised through the normal built production entrypoint.
            server = await launch(false);
            gateAvailable = false;
            held = false;
        },
        async readOperation(
            sid: string,
        ): Promise<
            Pick<ApiConversionOperation, 'status' | 'files' | 'revision'>
        > {
            return JSON.parse(
                await readFile(
                    path.join(storage, sid, 'conversion.info.json'),
                    'utf8',
                ),
            ).operation;
        },
        async stop() {
            await server.stop();
        },
    };
}
export type TestApi = Awaited<ReturnType<typeof startApi>>;
