import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as realDelay } from 'node:timers/promises';
import { DEFAULT_SESSION_IMAGE_CONFIG } from '@image-web-convert/schemas';
import { getConversionRuntimeConfig } from '../../env';
import { createConversionStorage } from '../conversion-storage.service';
import {
    createConversionRuntime,
    type ConversionRuntime,
} from '../conversion-runtime.service';
import {
    createConversionOperation,
    requestConversionStop,
    startConversionFile,
} from '../conversions.service';
import { claimSessionWork } from '../session-work.service';
import { conversionStoragePaths, sessionInfoPath } from '../storage.paths';
import type { ProcessInput, ProcessOutput } from '../image.service';

let directory: string;
let root: string;
let store: ReturnType<typeof createConversionStorage>;
let runtimes: ConversionRuntime[];
let pending: ReturnType<typeof deferred>[];
let requestNumber: number;
const initial = new Date('2026-09-09T12:00:00.000Z');
const expiresAt = '2026-09-09T12:15:00.000Z';
const config = {
    ...getConversionRuntimeConfig({}),
    sweepIntervalMs: 1000,
    shutdownGraceMs: 100,
};
const result = (): ProcessOutput => ({
    buffer: Buffer.from('converted'),
    outputMime: 'image/webp',
    info: {
        width: 1,
        height: 1,
        sizeBytes: 9,
        colorSpace: 'srgb',
        animated: false,
        exifStripped: true,
    },
    inputMeta: { mime: 'image/png' },
});

function deferred() {
    let resolve!: (value: ProcessOutput) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<ProcessOutput>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}
function hold() {
    const value = deferred();
    pending.push(value);
    return value;
}

async function eventually(condition: () => boolean | Promise<boolean>) {
    for (let i = 0; i < 200; i++) {
        if (await condition()) return;
        await realDelay(5);
    }
    expect(await condition()).toBe(true);
}

beforeEach(async () => {
    await fs.mkdir(path.resolve('tmp'), { recursive: true });
    directory = await fs.mkdtemp(path.resolve('tmp/conversion-runtime-'));
    root = path.join(directory, 'uploads');
    store = createConversionStorage({ root });
    runtimes = [];
    pending = [];
    requestNumber = 0;
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(initial);
});

afterEach(async () => {
    for (const item of pending) item.resolve(result());
    const stops = runtimes.map((runtime) => runtime.stop());
    await vi.advanceTimersByTimeAsync(101);
    await Promise.all(stops);
    await Promise.all(runtimes.map((runtime) => runtime.whenIdle()));
    vi.restoreAllMocks();
    vi.useRealTimers();
    await fs.rm(directory, { recursive: true, force: true });
});

function runtime(
    overrides: Parameters<typeof createConversionRuntime>[0] = {},
) {
    const instance = createConversionRuntime({
        root,
        store,
        config,
        convert: async () => result(),
        onError: vi.fn(),
        ...overrides,
    });
    runtimes.push(instance);
    return instance;
}

async function seedSession(sid: string, overrides: object = {}) {
    await fs.mkdir(path.join(root, sid), { recursive: true });
    await fs.writeFile(
        sessionInfoPath(sid, root),
        JSON.stringify({
            id: sid,
            expiresAt,
            createdAt: initial.toISOString(),
            tokenHash: 'test',
            sealedAt: null,
            counts: { files: 0, totalBytes: 0 },
            ...overrides,
        }),
    );
}

async function seed(sid = 'session-a', count = 2, uploaded = count) {
    const operation = createConversionOperation(
        {
            requestId: `request-${sid}`,
            options: { outputMime: 'image/webp' },
            files: Array.from({ length: count }, (_, i) => ({
                clientId: `client-${i}`,
                name: `${i}.png`,
                sizeBytes: 4,
            })),
        },
        {
            id: `operation-${sid}`,
            sessionId: sid,
            fileIds: Array.from({ length: count }, (_, i) => `file-${i}`),
            expiresAt,
            limits: DEFAULT_SESSION_IMAGE_CONFIG,
            now: new Date(),
        },
    );
    await store.create(operation);
    for (let i = 0; i < uploaded; i++)
        await store.acceptUpload(
            sid,
            operation.id,
            `file-${i}`,
            await source(),
        );
    return operation;
}
async function source() {
    const name = path.join(directory, `request-${++requestNumber}`);
    await fs.writeFile(name, 'data');
    return name;
}

describe('backend conversion scheduling', () => {
    it('automatically runs FIFO batches and manifest order with global concurrency one', async () => {
        await seed('session-b');
        vi.setSystemTime(new Date(initial.getTime() + 1));
        await seed('session-a');
        const first = hold();
        const calls: string[] = [];
        let concurrent = 0;
        let maximum = 0;
        const rt = runtime({
            convert: async (input) => {
                calls.push(
                    `${path.basename(path.dirname(path.dirname(input.inputPath)))}/${path.basename(input.inputPath)}`,
                );
                maximum = Math.max(maximum, ++concurrent);
                try {
                    return calls.length === 1 ? await first.promise : result();
                } finally {
                    concurrent--;
                }
            },
        });
        await rt.start();
        await eventually(() => calls.length === 1);
        for (let i = 0; i < 10; i++) rt.wake();
        await rt.sweep();
        expect(calls).toEqual(['session-b/file-0']);
        first.resolve(result());
        await rt.whenIdle();
        expect(calls).toEqual([
            'session-b/file-0',
            'session-b/file-1',
            'session-a/file-0',
            'session-a/file-1',
        ]);
        expect(maximum).toBe(1);
        expect((await store.read('session-a')).operation.status).toBe(
            'completed',
        );
    });

    it('does not start early and wakes automatically after the final accepted upload', async () => {
        const operation = await seed('session-a', 2, 1);
        const convert = vi.fn<(input: ProcessInput) => Promise<ProcessOutput>>(
            async () => result(),
        );
        const rt = runtime({ convert });
        await rt.start();
        await rt.whenIdle();
        expect(convert).not.toHaveBeenCalled();
        await rt.acceptUpload(
            operation.sessionId,
            operation.id,
            'file-1',
            await source(),
        );
        await rt.whenIdle();
        expect(convert).toHaveBeenCalledTimes(2);
        expect((await store.read('session-a')).operation.status).toBe(
            'completed',
        );
    });

    it('discovers a persisted ready operation without a wakeup or browser polling', async () => {
        const convert = vi.fn<(input: ProcessInput) => Promise<ProcessOutput>>(
            async () => result(),
        );
        const rt = runtime({ convert });
        await rt.start();
        await rt.whenIdle();
        await seed('session-a', 1);
        await vi.advanceTimersByTimeAsync(config.sweepIntervalMs);
        await eventually(
            async () =>
                (await store.read('session-a')).operation.status ===
                'completed',
        );
        expect(convert).toHaveBeenCalledTimes(1);
    });

    it('preserves partial success and continues after a conversion error', async () => {
        await seed('session-a', 3);
        const convert = vi
            .fn()
            .mockResolvedValueOnce(result())
            .mockRejectedValueOnce(new Error('Malformed image'))
            .mockResolvedValueOnce(result());
        const rt = runtime({ convert });
        await rt.start();
        await rt.whenIdle();
        const { operation } = await store.read('session-a');
        expect(operation.status).toBe('partially_completed');
        expect(operation.files.map((file) => file.status)).toEqual([
            'completed',
            'failed',
            'completed',
        ]);
    });

    it('does not replay interrupted files on startup and processes valid remaining files', async () => {
        const operation = await seed();
        await store.update(operation.sessionId, operation.id, (state) =>
            startConversionFile(state, 'file-0', new Date()),
        );
        const convert = vi.fn<(input: ProcessInput) => Promise<ProcessOutput>>(
            async () => result(),
        );
        const rt = runtime({ convert });
        await rt.start();
        await rt.whenIdle();
        expect(convert).toHaveBeenCalledTimes(1);
        expect(path.basename(convert.mock.calls[0][0].inputPath)).toBe(
            'file-1',
        );
        expect(
            (await store.read('session-a')).operation.files[0],
        ).toMatchObject({
            status: 'failed',
            error: { type: 'processing_interrupted' },
        });
    });

    it('reports corrupt sessions without preventing healthy batches from completing', async () => {
        await seed('session-bad', 1);
        await fs.writeFile(
            conversionStoragePaths('session-bad', root).info,
            '{broken',
        );
        await seed('session-good', 1);
        const onError = vi.fn();
        const rt = runtime({ onError });
        await rt.start();
        await rt.whenIdle();
        expect(onError).toHaveBeenCalledWith(expect.any(Error), 'session-bad');
        expect(rt.diagnostics().blockedSessions).toEqual(['session-bad']);
        expect((await store.read('session-good')).operation.status).toBe(
            'completed',
        );
        expect(rt.isReady()).toBe(true);
    });

    it('halts further processing after a storage commit failure', async () => {
        await seed('session-a', 2);
        const convert = vi.fn<(input: ProcessInput) => Promise<ProcessOutput>>(
            async () => result(),
        );
        const onError = vi.fn();
        vi.spyOn(store, 'commitOutput').mockRejectedValueOnce(
            new Error('Disk unavailable'),
        );
        const rt = runtime({ convert, onError });
        await rt.start();
        await rt.whenIdle();
        expect(convert).toHaveBeenCalledTimes(1);
        expect(rt.isReady()).toBe(false);
        expect(
            (await store.read('session-a')).operation.files.map(
                (file) => file.status,
            ),
        ).toEqual(['processing', 'uploaded']);
        await expect(
            fs.stat(conversionStoragePaths('session-a', root).input('file-0')),
        ).resolves.toBeDefined();
        await expect(rt.createOperation('new-session', {})).rejects.toThrow(
            'requires recovery',
        );
    });

    it('enforces current pixel/dimension ceilings for recovered operations', async () => {
        await seed('session-a', 1);
        const convert = vi.fn<(input: ProcessInput) => Promise<ProcessOutput>>(
            async () => result(),
        );
        const rt = runtime({
            convert,
            config: { ...config, maxInputPixels: 100, maxDimension: 5 },
        });
        await rt.start();
        await rt.whenIdle();
        expect(convert).toHaveBeenCalledWith(
            expect.objectContaining({
                options: expect.objectContaining({
                    limitInputPixels: 100,
                    maxDimension: 5,
                }),
                timeoutSeconds: 120,
            }),
        );
    });
});

describe('cancellation, deadlines, and cleanup ownership', () => {
    it('cancels before readiness without calling the converter', async () => {
        const operation = await seed('session-a', 2, 0);
        const convert = vi.fn<(input: ProcessInput) => Promise<ProcessOutput>>(
            async () => result(),
        );
        const rt = runtime({ convert });
        await rt.start();
        await rt.cancel(operation.sessionId, operation.id);
        await rt.whenIdle();
        expect(convert).not.toHaveBeenCalled();
        expect((await store.read('session-a')).operation.status).toBe(
            'cancelled',
        );
    });

    it('lets the active file finish on cancellation, retains prior results, and skips the rest', async () => {
        const operation = await seed('session-a', 3);
        const current = hold();
        const convert = vi
            .fn()
            .mockResolvedValueOnce(result())
            .mockImplementationOnce(() => current.promise);
        const rt = runtime({ convert });
        await rt.start();
        await eventually(() => convert.mock.calls.length === 2);
        const stopped = await rt.cancel(operation.sessionId, operation.id);
        expect(stopped.operation.status).toBe('processing');
        await rt.sweep();
        await expect(
            fs.stat(conversionStoragePaths('session-a', root).input('file-1')),
        ).resolves.toBeDefined();
        current.resolve(result());
        await rt.whenIdle();
        const final = (await store.read('session-a')).operation;
        expect(final.status).toBe('cancelled');
        expect(final.files.map((file) => file.status)).toEqual([
            'completed',
            'completed',
            'cancelled',
        ]);
        expect(convert).toHaveBeenCalledTimes(2);
    });

    it('cancellation between files prevents the next claim', async () => {
        const operation = await seed();
        const commit = store.commitOutput.bind(store);
        vi.spyOn(store, 'commitOutput').mockImplementationOnce(
            async (...args) => {
                const result = await commit(...args);
                await store.update(operation.sessionId, operation.id, (state) =>
                    requestConversionStop(state, 'user_cancelled', new Date()),
                );
                return result;
            },
        );
        const convert = vi.fn<(input: ProcessInput) => Promise<ProcessOutput>>(
            async () => result(),
        );
        const rt = runtime({ convert });
        await rt.start();
        await rt.whenIdle();
        expect(convert).toHaveBeenCalledTimes(1);
        expect((await store.read('session-a')).operation.status).toBe(
            'cancelled',
        );
    });

    it('retains the global slot after timeout until the invocation settles', async () => {
        await seed('session-a', 2);
        await seed('session-b', 1);
        const current = hold();
        const convert = vi
            .fn()
            .mockImplementationOnce(() => current.promise)
            .mockResolvedValue(result());
        const rt = runtime({
            convert,
            config: { ...config, fileTimeoutMs: 50 },
        });
        await rt.start();
        await eventually(() => convert.mock.calls.length === 1);
        await vi.advanceTimersByTimeAsync(50);
        await eventually(
            async () =>
                (await store.read('session-a')).operation.stopReason ===
                'conversion_timeout',
        );
        expect(rt.diagnostics().active?.sessionId).toBe('session-a');
        expect(convert).toHaveBeenCalledTimes(1);
        current.resolve(result());
        await rt.whenIdle();
        const operation = (await store.read('session-a')).operation;
        expect(operation.files[0]).toMatchObject({
            status: 'failed',
            error: { type: 'conversion_timeout' },
        });
        expect(operation.files[1].status).toBe('cancelled');
        expect((await store.read('session-b')).operation.status).toBe(
            'completed',
        );
    });

    it('detects elapsed deadlines even when event-loop blocking delays the timer', async () => {
        await seed('session-a', 1);
        const rt = runtime({
            config: { ...config, fileTimeoutMs: 50 },
            convert: async () => {
                vi.setSystemTime(new Date(initial.getTime() + 100)); // Do not dispatch timers.
                return result();
            },
        });
        await rt.start();
        await rt.whenIdle();
        expect(
            (await store.read('session-a')).operation.files[0],
        ).toMatchObject({
            status: 'failed',
            error: { type: 'conversion_timeout' },
        });
    });

    it('stops on deadline persistence failure without releasing the active invocation early', async () => {
        await seed('session-a', 1);
        const update = store.update.bind(store);
        vi.spyOn(store, 'update').mockImplementation((sid, oid, transition) =>
            update(sid, oid, (operation) => {
                const next = transition(operation);
                if (next.stopReason === 'conversion_timeout')
                    throw new Error('Disk failed');
                return next;
            }),
        );
        const current = hold();
        const rt = runtime({
            config: { ...config, fileTimeoutMs: 50 },
            convert: () => current.promise,
        });
        await rt.start();
        await eventually(() => rt.diagnostics().active !== null);
        await vi.advanceTimersByTimeAsync(50);
        await eventually(() => rt.diagnostics().failed);
        expect(rt.diagnostics().active).not.toBeNull();
        current.resolve(result());
        await rt.whenIdle();
        expect((await store.read('session-a')).operation.files[0].status).toBe(
            'processing',
        );
    });

    it('does not remove expired session files while a conversion or download owns them', async () => {
        await seed('session-a', 1);
        const current = hold();
        const rt = runtime({ convert: () => current.promise });
        await rt.start();
        await eventually(() => rt.diagnostics().active !== null);
        const releaseDownload = rt.acquireSessionUse('session-a');
        vi.setSystemTime(new Date(expiresAt));
        await rt.sweep();
        await expect(
            fs.stat(conversionStoragePaths('session-a', root).input('file-0')),
        ).resolves.toBeDefined();
        current.resolve(result());
        await rt.whenIdle();
        await rt.sweep();
        await expect(
            fs.stat(conversionStoragePaths('session-a', root).info),
        ).resolves.toBeDefined();
        releaseDownload();
        await rt.sweep();
        await expect(
            fs.stat(conversionStoragePaths('session-a', root).directory),
        ).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('expires abandoned uploads and leaves legacy-only session directories alone', async () => {
        await seed('session-a', 1, 0);
        const legacy = path.join(root, 'legacy-session');
        await fs.mkdir(legacy);
        await fs.writeFile(path.join(legacy, 'session.info.json'), '{}');
        vi.setSystemTime(new Date(expiresAt));
        const rt = runtime();
        await rt.start();
        await rt.whenIdle();
        await expect(
            fs.stat(conversionStoragePaths('session-a', root).directory),
        ).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(fs.stat(legacy)).resolves.toBeDefined();
    });
});

describe('admission and runtime lifecycle', () => {
    const manifest = {
        requestId: 'ownership-request',
        options: { outputMime: 'image/webp' },
        files: [{ clientId: 'client', name: 'a.png', sizeBytes: 4 }],
    };

    it.each([
        { sealedAt: initial.toISOString() },
        { counts: { files: 1, totalBytes: 4 } },
    ])('rejects persisted legacy use for direct callers: %j', async (state) => {
        await seedSession('used-session', state);
        const create = vi.spyOn(store, 'create');
        const rt = runtime();
        await rt.start();
        await expect(
            rt.createOperation('used-session', manifest),
        ).rejects.toMatchObject({
            type: 'conversion_conflict',
        });
        expect(create).not.toHaveBeenCalled();
        // Failure releases the claim; corrected durable state can be retried.
        await seedSession('used-session');
        await expect(
            rt.createOperation('used-session', manifest),
        ).resolves.toBeDefined();
    });

    it('honors existing session ownership without releasing another caller claim', async () => {
        await seedSession('claimed-session');
        const rt = runtime();
        await rt.start();
        const release = claimSessionWork('claimed-session');
        try {
            await expect(
                rt.createOperation('claimed-session', manifest),
            ).rejects.toMatchObject({
                type: 'upload_in_progress',
            });
            expect(() => claimSessionWork('claimed-session')).toThrow();
        } finally {
            release();
        }
        const first = await rt.createOperation('claimed-session', manifest);
        const retried = await rt.createOperation('claimed-session', manifest);
        expect(retried.operation.id).toBe(first.operation.id);
        const releaseAfterSuccess = claimSessionWork('claimed-session');
        releaseAfterSuccess();
    });

    it('releases validation failures and preserves the original intent on conflicting retries', async () => {
        await seedSession('intent-session');
        const rt = runtime();
        await rt.start();
        await expect(
            rt.createOperation('intent-session', {}),
        ).rejects.toMatchObject({
            type: 'invalid_request',
        });
        const original = await rt.createOperation('intent-session', manifest);
        await expect(
            rt.createOperation('intent-session', {
                ...manifest,
                options: { outputMime: 'image/png' },
            }),
        ).rejects.toMatchObject({ type: 'conversion_conflict' });
        await expect(
            rt.createOperation('intent-session', {
                ...manifest,
                files: [{ ...manifest.files[0], name: 'different.png' }],
            }),
        ).rejects.toMatchObject({ type: 'conversion_conflict' });
        const retried = await rt.createOperation('intent-session', manifest);
        expect(retried.operation).toEqual(original.operation);
    });

    it('releases ownership on session read and operation persistence failures', async () => {
        const rt = runtime();
        await rt.start();
        await expect(
            rt.createOperation('retry-session', manifest),
        ).rejects.toMatchObject({ code: 'ENOENT' });
        await seedSession('retry-session');
        vi.spyOn(store, 'create').mockRejectedValueOnce(
            new Error('write failed'),
        );
        await expect(
            rt.createOperation('retry-session', manifest),
        ).rejects.toThrow('write failed');
        const record = await rt.createOperation('retry-session', manifest);
        expect(record.operation.expiresAt).toBe(expiresAt);
    });

    it('serializes concurrent identical and conflicting creation without duplicating the operation', async () => {
        await seedSession('concurrent-session');
        const rt = runtime();
        await rt.start();
        const create = store.create.bind(store);
        let entered!: () => void;
        let release!: () => void;
        const started = new Promise<void>((resolve) => {
            entered = resolve;
        });
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        const persist = vi
            .spyOn(store, 'create')
            .mockImplementationOnce(async (operation) => {
                entered();
                await held;
                return create(operation);
            });
        const first = rt.createOperation('concurrent-session', manifest);
        await started;
        const same = rt.createOperation('concurrent-session', manifest);
        const different = rt.createOperation('concurrent-session', {
            ...manifest,
            requestId: 'different',
        });
        const outcomes = Promise.allSettled([first, same, different]);
        release();
        const [created, retried, rejected] = await outcomes;
        expect(created.status).toBe('fulfilled');
        expect(retried).toEqual(created);
        expect(rejected).toMatchObject({
            status: 'rejected',
            reason: { type: 'conversion_conflict' },
        });
        expect(persist).toHaveBeenCalledTimes(1);
    });

    it('keeps slot ownership independent across sessions and ignores stale release', async () => {
        const rt = runtime();
        await rt.start();
        const first = rt.beginUpload('session-a', 'file-0', expiresAt, vi.fn());
        const other = rt.beginUpload('session-b', 'file-0', expiresAt, vi.fn());
        first.release();
        const replacement = rt.beginUpload(
            'session-a',
            'file-0',
            expiresAt,
            vi.fn(),
        );
        first.release();
        expect(() =>
            rt.beginUpload('session-a', 'file-0', expiresAt, vi.fn()),
        ).toThrow('already has');
        expect(() =>
            rt.beginUpload('session-b', 'file-0', expiresAt, vi.fn()),
        ).toThrow('already has');
        replacement.release();
        other.release();
    });

    it('counts recovered operations and serializes creation at the configured limit', async () => {
        await seed('existing-session', 1, 0);
        const rt = runtime({ config: { ...config, maxOperations: 2 } });
        await rt.start();
        const manifest = {
            requestId: 'request',
            options: { outputMime: 'image/webp' },
            files: [{ clientId: 'client', name: 'a.png', sizeBytes: 4 }],
        };
        await seedSession('new-a');
        await seedSession('new-b');
        const outcomes = await Promise.allSettled([
            rt.createOperation('new-a', manifest),
            rt.createOperation('new-b', manifest),
        ]);
        expect(
            outcomes.filter((outcome) => outcome.status === 'fulfilled'),
        ).toHaveLength(1);
        expect(
            outcomes.find((outcome) => outcome.status === 'rejected'),
        ).toMatchObject({ reason: { type: 'conversion_capacity_exceeded' } });
    });

    it('checks upload deadlines even when timer callbacks were delayed', async () => {
        const rt = runtime({ config: { ...config, uploadIdleMs: 50 } });
        await rt.start();
        const timeout = vi.fn();
        const upload = rt.beginUpload(
            'session-a',
            'file-0',
            expiresAt,
            timeout,
        );
        vi.setSystemTime(new Date(initial.getTime() + 51));
        upload.touch();
        expect(() => upload.assertActive()).toThrow(
            'Upload expired or timed out',
        );
        expect(timeout).toHaveBeenCalledWith('idle');
        upload.release();
    });

    it('bounds concurrent uploads, and timed-out transport retains its slot until release', async () => {
        const rt = runtime({ config: { ...config, uploadIdleMs: 50 } });
        await rt.start();
        const onTimeout = vi.fn();
        const first = rt.beginUpload(
            'session-a',
            'file-0',
            expiresAt,
            onTimeout,
        );
        const second = rt.beginUpload(
            'session-a',
            'file-1',
            expiresAt,
            onTimeout,
        );
        expect(() =>
            rt.beginUpload('session-a', 'file-0', expiresAt, onTimeout),
        ).toThrow('already has');
        expect(() =>
            rt.beginUpload('session-a', 'file-2', expiresAt, onTimeout),
        ).toThrow('Too many');
        await vi.advanceTimersByTimeAsync(50);
        expect(onTimeout).toHaveBeenCalledWith('idle');
        expect(() => first.assertActive()).toThrow('timed out');
        expect(() =>
            rt.beginUpload('session-a', 'file-2', expiresAt, onTimeout),
        ).toThrow('Too many');
        first.release();
        second.release();
        const retry = rt.beginUpload(
            'session-a',
            'file-0',
            expiresAt,
            onTimeout,
        );
        retry.release();
    });

    it('upload activity resets only idle time, and total/expiry deadlines stay bounded', async () => {
        const rt = runtime({
            config: { ...config, uploadIdleMs: 50, uploadTotalMs: 100 },
        });
        await rt.start();
        const onTimeout = vi.fn();
        const upload = rt.beginUpload(
            'session-a',
            'file-0',
            expiresAt,
            onTimeout,
        );
        await vi.advanceTimersByTimeAsync(40);
        upload.touch();
        await vi.advanceTimersByTimeAsync(40);
        upload.touch();
        expect(onTimeout).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(20);
        expect(onTimeout).toHaveBeenCalledExactlyOnceWith('total');
        upload.release();
        const expiring = rt.beginUpload(
            'session-a',
            'file-1',
            new Date(Date.now() + 10).toISOString(),
            onTimeout,
        );
        await vi.advanceTimersByTimeAsync(10);
        expect(onTimeout).toHaveBeenLastCalledWith('expired');
        expiring.release();
    });

    it('prevents two live schedulers from owning the same storage', async () => {
        const first = runtime();
        await first.start();
        const second = runtime();
        await expect(second.start()).rejects.toThrow('already owns');
        await first.stop();
        const third = runtime();
        await third.start();
        expect(third.isReady()).toBe(true);
    });

    it('drains the active file on shutdown and never starts the next file', async () => {
        await seed();
        const current = hold();
        const convert = vi.fn(() => current.promise);
        const rt = runtime({ convert });
        await rt.start();
        await eventually(() => convert.mock.calls.length === 1);
        const stopping = rt.stop();
        expect(rt.isReady()).toBe(false);
        expect(() => rt.acquireSessionUse('session-a')).toThrow(
            'not accepting',
        );
        current.resolve(result());
        expect(await stopping).toEqual({ drained: true });
        expect(convert).toHaveBeenCalledTimes(1);
        expect(
            (await store.read('session-a')).operation.files.map(
                (file) => file.status,
            ),
        ).toEqual(['completed', 'uploaded']);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('reports grace expiry without pretending hung conversion stopped or deleting its input', async () => {
        await seed('session-a', 1);
        const current = hold();
        const rt = runtime({ convert: () => current.promise });
        await rt.start();
        await eventually(() => rt.diagnostics().active !== null);
        const stopping = rt.stop();
        await vi.advanceTimersByTimeAsync(100);
        expect(await stopping).toEqual({ drained: false });
        expect(rt.diagnostics().active).not.toBeNull();
        await expect(
            fs.stat(conversionStoragePaths('session-a', root).input('file-0')),
        ).resolves.toBeDefined();
        current.resolve(result());
        await rt.whenIdle();
    });

    it('waits for outstanding request leases on shutdown', async () => {
        const rt = runtime();
        await rt.start();
        await rt.whenIdle();
        const release = rt.acquireSessionUse('session-a');
        const stopping = rt.stop();
        release();
        expect(await stopping).toEqual({ drained: true });
        expect(vi.getTimerCount()).toBe(0);
    });
});
