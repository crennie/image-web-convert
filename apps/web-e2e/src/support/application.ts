import { test as base, expect } from '@playwright/test';
import { createServer, request, type Server } from 'node:http';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
// Shared test-process lifecycle; never imported by production applications.
// eslint-disable-next-line @nx/enforce-module-boundaries
import {
    startApi,
    startNodeServer,
    type TestApi,
} from '../../../api-e2e/src/support/api-process';

const root = path.resolve(__dirname, '../../../..');
export type HarnessOptions = { realApi: boolean; controlledApi: boolean };
type Application = {
    url: string;
    api: TestApi;
    stop(): Promise<void>;
    interruptUploads(): void;
    resumeUploads(): void;
    readonly uploadInterrupted: boolean;
};

async function close(server: Server) {
    const closed = new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
    });
    server.closeAllConnections();
    await closed;
}
async function startApplication(
    realApi: boolean,
    controlledApi: boolean,
    outputDir: string,
): Promise<Application> {
    const temporaryRoot = path.join(root, 'tmp/browser-tests');
    await mkdir(temporaryRoot, { recursive: true });
    const storage = await mkdtemp(path.join(temporaryRoot, 'run-'));
    let api: TestApi | undefined;
    let web: Awaited<ReturnType<typeof startNodeServer>> | undefined;
    let gateway: Server | undefined;
    let interruptUpload = false;
    let interruptedOnServer = false;
    async function stop() {
        const results = await Promise.allSettled([
            ...(gateway?.listening ? [close(gateway)] : []),
            ...(web ? [web.stop()] : []),
            ...(api ? [api.stop()] : []),
        ]);
        await rm(storage, { recursive: true, force: true });
        const failed = results.find((result) => result.status === 'rejected');
        if (failed?.status === 'rejected') throw failed.reason;
    }
    try {
        if (realApi) api = await startApi(storage, outputDir, controlledApi);
        web = await startNodeServer({
            entry: path.join(root, 'node_modules/@react-router/serve/bin.js'),
            args: [path.join(root, 'apps/web/build/server/index.js')],
            cwd: path.join(root, 'apps/web'),
            log: path.join(outputDir, 'web.log'),
            readyPath: '/conversion',
        });
        // Test-only streaming reverse proxy; no API responses are synthesized.
        gateway = createServer((incoming, outgoing) => {
            const isApi =
                incoming.url === '/api' || incoming.url?.startsWith('/api/');
            const port = isApi ? api?.port : web?.port;
            if (!port) {
                outgoing
                    .writeHead(502)
                    .end('No API in mocked browser integration suite');
                return;
            }
            const upstream = request(
                {
                    host: '127.0.0.1',
                    port,
                    method: incoming.method,
                    path: incoming.url,
                    headers: incoming.headers,
                },
                (response) => {
                    outgoing.writeHead(
                        response.statusCode ?? 502,
                        response.headers,
                    );
                    response.pipe(outgoing);
                    response.on('error', () => outgoing.destroy());
                },
            );
            upstream.on('error', () => {
                if (!outgoing.headersSent) outgoing.writeHead(502);
                outgoing.end('Test upstream unavailable');
            });
            incoming.on('aborted', () => upstream.destroy());
            outgoing.on('close', () => upstream.destroy());
            if (interruptUpload && incoming.method === 'PUT' && api) {
                const uploadsDirectory = api.incoming;
                incoming.once('data', (chunk: Buffer) => {
                    incoming.pause();
                    upstream.write(chunk.subarray(0, 32));
                    // Wait until the actual API owns an incomplete staged request,
                    // then sever the stream. No fabricated response or slot state.
                    void (async () => {
                        const deadline = Date.now() + 5000;
                        while (
                            Date.now() < deadline &&
                            (await readdir(uploadsDirectory)).length === 0
                        ) {
                            await delay(10);
                        }
                        interruptedOnServer ||=
                            (await readdir(uploadsDirectory)).length > 0;
                    })()
                        .finally(() => {
                            upstream.destroy();
                            outgoing.destroy();
                            incoming.destroy();
                        })
                        .catch(() => undefined);
                });
            } else incoming.pipe(upstream);
        });
        const proxy = gateway;
        await new Promise<void>((resolve, reject) => {
            proxy.once('error', reject);
            proxy.listen(0, '127.0.0.1', resolve);
        });
        const address = gateway.address();
        if (!address || typeof address === 'string')
            throw new Error('No proxy port');
        return {
            url: `http://127.0.0.1:${address.port}`,
            get api() {
                if (!api)
                    throw new Error('This browser suite does not start an API');
                return api;
            },
            stop,
            interruptUploads: () => {
                interruptUpload = true;
                interruptedOnServer = false;
            },
            resumeUploads: () => {
                interruptUpload = false;
            },
            get uploadInterrupted() {
                return interruptedOnServer;
            },
        };
    } catch (error) {
        await stop().catch(() => undefined);
        throw error;
    }
}
export const test = base.extend<{ application: Application }, HarnessOptions>({
    realApi: [true, { option: true, scope: 'worker' }],
    controlledApi: [false, { option: true, scope: 'worker' }],
    application: [
        async ({ realApi, controlledApi }, use, testInfo) => {
            const app = await startApplication(
                realApi,
                controlledApi,
                testInfo.outputPath('servers'),
            );
            try {
                await use(app);
            } finally {
                await app.stop();
            }
        },
        { timeout: 90_000 },
    ],
    baseURL: async ({ application }, use) => {
        await use(application.url);
    },
});
export { expect };
