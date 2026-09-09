import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { DEFAULT_SESSION_IMAGE_CONFIG } from '@image-web-convert/schemas';
import {
    createConversionStorage,
    ConversionStorageError,
} from '../conversion-storage.service';
import { conversionStoragePaths } from '../storage.paths';
import {
    createConversionOperation,
    conversionSnapshot,
    finishConversionFile,
    rejectConversionUpload,
    requestConversionStop,
    startConversionFile,
} from '../conversions.service';
import { processImageToMimeType, type ProcessOutput } from '../image.service';

const sid = 'session-1';
const oid = 'operation-1';
let directory: string;
let root: string;
let clock: Date;
let store: ReturnType<typeof createConversionStorage>;
let locations: ReturnType<typeof conversionStoragePaths>;
let requestNumber: number;
const initialTime = '2026-09-08T12:00:00.000Z';
const expiry = '2026-09-08T12:15:00.000Z';
const diskFailure = () =>
    Object.assign(new Error('Injected disk failure'), { code: 'EIO' });

beforeEach(async () => {
    await fs.mkdir(path.resolve('tmp'), { recursive: true });
    directory = await fs.mkdtemp(path.resolve('tmp/conversion-storage-'));
    root = path.join(directory, 'uploads');
    clock = new Date(initialTime);
    store = createConversionStorage({ root, now: () => clock });
    locations = conversionStoragePaths(sid, root);
    requestNumber = 0;
});

afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(directory, { recursive: true, force: true });
});

async function create(count = 2, bytes = 4) {
    return store.create(
        createConversionOperation(
            {
                requestId: 'request-1',
                options: { outputMime: 'image/webp' },
                files: Array.from({ length: count }, (_, i) => ({
                    clientId: `client-${i}`,
                    name: `${i}.png`,
                    sizeBytes: bytes,
                })),
            },
            {
                id: oid,
                sessionId: sid,
                fileIds: Array.from({ length: count }, (_, i) => `file-${i}`),
                expiresAt: expiry,
                limits: DEFAULT_SESSION_IMAGE_CONFIG,
                now: clock,
            },
        ),
    );
}

async function requestFile(contents: Buffer = Buffer.from('data')) {
    const file = path.join(directory, `request-${++requestNumber}`);
    await fs.writeFile(file, contents);
    return file;
}

async function upload(fileId: string, contents?: Buffer) {
    return store.acceptUpload(sid, oid, fileId, await requestFile(contents));
}

async function ready(count = 2) {
    await create(count);
    for (let i = 0; i < count; i++) await upload(`file-${i}`);
    return store.read(sid, oid);
}

async function start(fileId = 'file-0') {
    return store.update(sid, oid, (operation) =>
        startConversionFile(operation, fileId, clock),
    );
}

const processed = (): ProcessOutput => ({
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
    inputMeta: { mime: 'image/png', width: 1, height: 1 },
});

function failRenameTo(target: string) {
    const original = fs.rename.bind(fs);
    return vi
        .spyOn(fs, 'rename')
        .mockImplementation(async (source, destination) => {
            if (destination === target) throw diskFailure();
            return original(source, destination);
        });
}

async function absent(target: string) {
    await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
}

describe('durable conversion records', () => {
    it('round-trips an operation across independent instances without persisting counts', async () => {
        const created = await create();
        const reloaded = await createConversionStorage({ root }).read(sid, oid);
        expect(reloaded).toEqual(created);
        expect(
            JSON.parse(await fs.readFile(locations.info, 'utf8')).operation,
        ).not.toHaveProperty('counts');
        expect(conversionSnapshot(reloaded.operation)).not.toHaveProperty(
            'inputs',
        );
        await expect(store.read(sid, 'other-operation')).rejects.toMatchObject({
            type: 'operation_not_found',
        });
        await expect(store.read('other-session', oid)).rejects.toMatchObject({
            type: 'operation_not_found',
        });
        await expect(store.read('../outside', oid)).rejects.toThrow();
    });

    it('allows only one operation creation per session, across instances', async () => {
        const first = await create();
        const otherStore = createConversionStorage({ root });
        await expect(
            otherStore.create({ ...first.operation, id: 'second-operation' }),
        ).rejects.toMatchObject({ type: 'conversion_conflict' });
        expect((await store.read(sid)).operation.id).toBe(oid);
    });

    it('distinguishes corrupt state and I/O errors from not-found', async () => {
        await create();
        await fs.writeFile(locations.info, '{partial');
        await expect(store.read(sid)).rejects.toBeInstanceOf(
            ConversionStorageError,
        );
        vi.spyOn(fs, 'readFile').mockRejectedValueOnce(diskFailure());
        await expect(store.read(sid)).rejects.toThrow(
            'Unable to read operation',
        );
    });

    it.each(['version', 'association', 'lifecycle', 'input'])(
        'rejects invalid persisted %s',
        async (kind) => {
            await ready(1);
            const raw = JSON.parse(await fs.readFile(locations.info, 'utf8'));
            if (kind === 'version') raw.operation.schemaVersion = 999;
            if (kind === 'association')
                raw.operation.sessionId = 'foreign-session';
            if (kind === 'lifecycle') raw.operation.status = 'awaiting_uploads';
            if (kind === 'input')
                raw.inputs['file-0'].storedName = '../outside';
            await fs.writeFile(locations.info, JSON.stringify(raw));
            await expect(store.read(sid)).rejects.toThrow(
                'Invalid persisted operation',
            );
        },
    );

    it('serializes independent mutations without losing updates and releases failed locks', async () => {
        await create();
        const second = createConversionStorage({ root });
        await Promise.all([
            store.update(sid, oid, (operation) =>
                rejectConversionUpload(
                    operation,
                    'file-0',
                    { type: 'unsupported_image', message: 'Bad A' },
                    clock,
                ),
            ),
            second.update(sid, oid, (operation) =>
                rejectConversionUpload(
                    operation,
                    'file-1',
                    { type: 'unsupported_image', message: 'Bad B' },
                    clock,
                ),
            ),
        ]);
        expect((await store.read(sid)).operation).toMatchObject({
            revision: 2,
            status: 'failed',
        });
        await expect(
            store.update(sid, oid, () => {
                throw new Error('Rejected transition');
            }),
        ).rejects.toThrow('Rejected transition');
        expect(
            (await store.update(sid, oid, (operation) => operation)).operation
                .revision,
        ).toBe(2);
    });

    it('rejects intent changes and direct publication through generic updates', async () => {
        await ready(1);
        await expect(
            store.update(sid, oid, (operation) => ({
                ...operation,
                options: { outputMime: 'image/jpeg' },
            })),
        ).rejects.toThrow('intent is immutable');
        await expect(
            store.update(sid, oid, (operation) => ({
                ...operation,
                files: [],
            })),
        ).rejects.toThrow('intent is immutable');
        await start();
        await store.commitOutput(sid, oid, 'file-0', processed());
        const completed = await store.read(sid);
        await expect(
            store.update(sid, oid, (operation) => ({
                ...operation,
                files: [{ ...operation.files[0], name: 'replacement' }],
            })),
        ).rejects.toThrow('intent is immutable');
        expect(await store.read(sid)).toEqual(completed);
    });
});

describe('staged upload ownership', () => {
    it('promotes accepted input and persists its fingerprint before acknowledgement', async () => {
        await create(1);
        const source = await requestFile();
        const record = await store.acceptUpload(sid, oid, 'file-0', source);
        expect(record.operation.status).toBe('queued');
        expect(record.inputs['file-0']).toMatchObject({
            storedName: 'file-0',
            bytes: 4,
            sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        });
        expect(await fs.readFile(locations.input('file-0'), 'utf8')).toBe(
            'data',
        );
        await absent(source);
        expect(await fs.readdir(locations.staging)).toEqual([]);
        expect(await store.read(sid)).toEqual(record);
    });

    it('copies into destination staging instead of renaming a cross-filesystem request source', async () => {
        await create(1);
        const source = await requestFile();
        const rename = fs.rename.bind(fs);
        const spy = vi
            .spyOn(fs, 'rename')
            .mockImplementation(async (from, to) => {
                if (from === source)
                    throw Object.assign(new Error('Different devices'), {
                        code: 'EXDEV',
                    });
                return rename(from, to);
            });
        await store.acceptUpload(sid, oid, 'file-0', source);
        expect(spy.mock.calls.every(([from]) => from !== source)).toBe(true);
        expect(await fs.readFile(locations.input('file-0'), 'utf8')).toBe(
            'data',
        );
    });

    it('does not credit interrupted or mismatched bytes and cleans request staging', async () => {
        await create(1);
        const source = await requestFile(Buffer.from('da'));
        await expect(
            store.acceptUpload(sid, oid, 'file-0', source),
        ).rejects.toMatchObject({ type: 'upload_size_mismatch' });
        await absent(source);
        expect((await store.read(sid)).operation.status).toBe(
            'awaiting_uploads',
        );
        await absent(locations.input('file-0'));
    });

    it('preserves accepted bytes on replay and refuses operation-owned request sources', async () => {
        const accepted = await ready(1);
        expect(await upload('file-0', Buffer.from('replacement'))).toEqual(
            accepted,
        );
        expect(await fs.readFile(locations.input('file-0'), 'utf8')).toBe(
            'data',
        );
        await expect(
            store.acceptUpload(sid, oid, 'file-0', locations.input('file-0')),
        ).rejects.toThrow('outside operation-owned');
        expect(await fs.readFile(locations.input('file-0'), 'utf8')).toBe(
            'data',
        );
    });

    it('cleans failed copy and permits retry', async () => {
        await create(1);
        vi.spyOn(fs, 'copyFile').mockRejectedValueOnce(diskFailure());
        await expect(upload('file-0')).rejects.toThrow('Injected disk failure');
        expect((await store.read(sid)).operation.files[0].status).toBe(
            'awaiting_upload',
        );
        expect(await fs.readdir(locations.staging)).toEqual([]);
        expect((await upload('file-0')).operation.status).toBe('queued');
    });

    it('rejects duplicate concurrent slot uploads without blocking cancellation during copy', async () => {
        await create(1);
        const copy = fs.copyFile.bind(fs);
        let copying!: () => void;
        let release!: () => void;
        const started = new Promise<void>((resolve) => {
            copying = resolve;
        });
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        vi.spyOn(fs, 'copyFile').mockImplementationOnce(async (...args) => {
            copying();
            await held;
            return copy(...args);
        });
        const first = upload('file-0');
        await started;
        const duplicateSource = await requestFile();
        await expect(
            store.acceptUpload(sid, oid, 'file-0', duplicateSource),
        ).rejects.toMatchObject({ type: 'upload_in_progress' });
        // Admission rejection does not transfer ownership; middleware cleans this source.
        await fs.unlink(duplicateSource);
        const cancelled = await store.update(sid, oid, (operation) =>
            requestConversionStop(operation, 'user_cancelled', clock),
        );
        expect(cancelled.operation.status).toBe('cancelled');
        release();
        await expect(first).rejects.toMatchObject({
            type: 'conversion_conflict',
        });
        await absent(locations.input('file-0'));
        expect(await fs.readdir(locations.staging)).toEqual([]);
    });

    it('serializes simultaneous final uploads and does not lose either input reference', async () => {
        await create();
        await Promise.all([upload('file-0'), upload('file-1')]);
        const result = await store.read(sid);
        expect(result.operation).toMatchObject({
            revision: 2,
            status: 'queued',
        });
        expect(Object.keys(result.inputs)).toEqual(
            expect.arrayContaining(['file-0', 'file-1']),
        );
    });

    it('keeps an unacknowledged input orphan after snapshot failure and removes it on recovery', async () => {
        await create(1);
        const spy = failRenameTo(locations.info);
        await expect(upload('file-0')).rejects.toThrow(
            'Unable to persist operation',
        );
        spy.mockRestore();
        expect((await store.read(sid)).operation.files[0].status).toBe(
            'awaiting_upload',
        );
        expect(await fs.readFile(locations.input('file-0'), 'utf8')).toBe(
            'data',
        );
        await store.recoverAfterRestart(sid);
        await absent(locations.input('file-0'));
        expect((await upload('file-0')).operation.status).toBe('queued');
    });
});

describe('per-file commits and recovery', () => {
    it('waits for an in-flight publication before acknowledging an upload replay', async () => {
        await ready(1);
        await start();
        const rename = fs.rename.bind(fs);
        let publishing!: () => void;
        let release!: () => void;
        const started = new Promise<void>((resolve) => {
            publishing = resolve;
        });
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        vi.spyOn(fs, 'rename').mockImplementation(
            async (source, destination) => {
                if (destination === locations.info) {
                    publishing();
                    await held;
                }
                return rename(source, destination);
            },
        );
        const commit = store.commitOutput(sid, oid, 'file-0', processed());
        await started; // Receipt exists, but snapshot has not been published.
        await expect(
            store.commitOutput(sid, oid, 'file-0', processed()),
        ).rejects.toThrow('already in progress');
        const replaySource = await requestFile();
        const replay = store.acceptUpload(sid, oid, 'file-0', replaySource);
        release();
        expect((await replay).operation.status).toBe('completed');
        expect((await commit).operation.status).toBe('completed');
    });

    it('stores a real converted image without letting conversion delete accepted input', async () => {
        const input = await sharp({
            create: { width: 2, height: 2, channels: 3, background: 'red' },
        })
            .png()
            .toBuffer();
        await create(1, input.length);
        await upload('file-0', input);
        await start();
        const result = await processImageToMimeType({
            inputPath: locations.input('file-0'),
            outputMime: 'image/webp',
        });
        expect(await fs.readFile(locations.input('file-0'))).toEqual(input);
        const record = await store.commitOutput(sid, oid, 'file-0', result);
        expect(record.operation.status).toBe('completed');
        await absent(locations.input('file-0'));
        expect(
            (await sharp(locations.output('file-0', 'image/webp')).metadata())
                .format,
        ).toBe('webp');
        expect((await store.completedOutput(sid, oid, 'file-0')).meta.id).toBe(
            'file-0',
        );
        expect(await store.recoverAfterRestart(sid)).toEqual(record);
    });

    it.each(['output', 'metadata', 'receipt', 'snapshot'])(
        'preserves earlier successes across %s write failure',
        async (step) => {
            await ready();
            await start();
            await store.commitOutput(sid, oid, 'file-0', processed());
            const previous = await store.completedOutput(sid, oid, 'file-0');
            await start('file-1');
            const targets = {
                output: locations.output('file-1', 'image/webp'),
                metadata: locations.meta('file-1'),
                receipt: locations.receipt('file-1'),
                snapshot: locations.info,
            };
            const spy = failRenameTo(targets[step as keyof typeof targets]);
            await expect(
                store.commitOutput(sid, oid, 'file-1', processed()),
            ).rejects.toThrow();
            spy.mockRestore();
            expect(await store.completedOutput(sid, oid, 'file-0')).toEqual(
                previous,
            );
            await expect(
                store.completedOutput(sid, oid, 'file-1'),
            ).rejects.toMatchObject({ type: 'file_not_found' });
            expect((await store.read(sid)).operation.files[1].status).toBe(
                'processing',
            );
            const recovered = await createConversionStorage({
                root,
                now: () => clock,
            }).recoverAfterRestart(sid);
            expect(recovered.operation.files[0]).toMatchObject({
                status: 'completed',
                output: previous,
            });
            expect(recovered.operation.files[1].status).toBe(
                step === 'snapshot' ? 'completed' : 'failed',
            );
            expect(recovered.operation.status).toBe(
                step === 'snapshot' ? 'completed' : 'partially_completed',
            );
            await absent(locations.input('file-1'));
            if (step !== 'snapshot') {
                await absent(locations.output('file-1', 'image/webp'));
                await absent(locations.meta('file-1'));
            }
        },
    );

    it('requires recovery after receipt publication before accepting more mutations', async () => {
        await ready(1);
        await start();
        const spy = failRenameTo(locations.info);
        await expect(
            store.commitOutput(sid, oid, 'file-0', processed()),
        ).rejects.toThrow('Unable to persist');
        spy.mockRestore();
        await expect(
            store.update(sid, oid, (operation) =>
                requestConversionStop(operation, 'user_cancelled', clock),
            ),
        ).rejects.toThrow('requires recovery');
        await expect(
            store.commitFailure(sid, oid, 'file-0', {
                type: 'storage_error',
                message: 'Do not roll back',
            }),
        ).rejects.toThrow('requires recovery');
        expect((await store.recoverAfterRestart(sid)).operation.status).toBe(
            'completed',
        );
    });

    it('keeps completed state when input cleanup fails and cleans it on restart', async () => {
        await ready(1);
        await start();
        const unlink = fs.unlink.bind(fs);
        const spy = vi
            .spyOn(fs, 'unlink')
            .mockImplementation(async (target) => {
                if (target === locations.input('file-0')) throw diskFailure();
                return unlink(target);
            });
        await expect(
            store.commitOutput(sid, oid, 'file-0', processed()),
        ).rejects.toThrow('Injected disk failure');
        spy.mockRestore();
        expect((await store.read(sid)).operation.status).toBe('completed');
        await store.recoverAfterRestart(sid);
        await absent(locations.input('file-0'));
        expect((await store.completedOutput(sid, oid, 'file-0')).meta.id).toBe(
            'file-0',
        );
    });

    it('keeps active input through cancellation, then commits success and preserves it on restart', async () => {
        await ready();
        await start();
        await store.update(sid, oid, (operation) =>
            requestConversionStop(operation, 'user_cancelled', clock),
        );
        expect(await fs.readFile(locations.input('file-0'), 'utf8')).toBe(
            'data',
        );
        const record = await store.commitOutput(
            sid,
            oid,
            'file-0',
            processed(),
        );
        expect(record.operation.status).toBe('cancelled');
        const recovered = await store.recoverAfterRestart(sid);
        expect(recovered.operation.files[0].status).toBe('completed');
        expect(recovered.operation.files[1].status).toBe('cancelled');
        await absent(locations.input('file-1'));
    });

    it.each(['conversion_timeout', 'session_expired'] as const)(
        'does not publish late success after %s',
        async (reason) => {
            await ready();
            await start();
            if (reason === 'session_expired') clock = new Date(expiry);
            await store.update(sid, oid, (operation) =>
                requestConversionStop(operation, reason, clock),
            );
            const result = await store.commitOutput(
                sid,
                oid,
                'file-0',
                processed(),
            );
            expect(result.operation.status).toBe('failed');
            expect(result.operation.files[0]).toMatchObject({
                status: 'failed',
                error: { type: reason },
            });
            await absent(locations.output('file-0', 'image/webp'));
            await absent(locations.receipt('file-0'));
        },
    );

    it('rechecks stop state after output staging, without holding a mutation lock during staging', async () => {
        await ready(1);
        await start();
        const writeFile = fs.writeFile.bind(fs);
        let started!: () => void;
        let release!: () => void;
        const writing = new Promise<void>((resolve) => {
            started = resolve;
        });
        const held = new Promise<void>((resolve) => {
            release = resolve;
        });
        vi.spyOn(fs, 'writeFile').mockImplementationOnce(async (...args) => {
            started();
            await held;
            return writeFile(...args);
        });
        const commit = store.commitOutput(sid, oid, 'file-0', processed());
        await writing;
        await store.update(sid, oid, (operation) =>
            requestConversionStop(operation, 'conversion_timeout', clock),
        );
        release();
        expect((await commit).operation.status).toBe('failed');
        await absent(locations.receipt('file-0'));
    });

    it('recovers interrupted processing without retry and retains queued siblings', async () => {
        await ready();
        await start();
        const result = await store.recoverAfterRestart(sid);
        expect(result.operation.files[0]).toMatchObject({
            status: 'failed',
            error: { type: 'processing_interrupted' },
        });
        expect(result.operation.files[1].status).toBe('uploaded');
        expect(await fs.readFile(locations.input('file-1'), 'utf8')).toBe(
            'data',
        );
        await start('file-1');
        expect(
            (await store.commitOutput(sid, oid, 'file-1', processed()))
                .operation.status,
        ).toBe('partially_completed');
    });

    it.each(['missing', 'corrupt'])(
        'fails %s accepted input without pretending conversion started',
        async (kind) => {
            await create();
            await upload('file-0');
            if (kind === 'missing') await fs.unlink(locations.input('file-0'));
            else await fs.writeFile(locations.input('file-0'), 'evil');
            const recovered = await store.recoverAfterRestart(sid);
            expect(recovered.operation.status).toBe('awaiting_uploads');
            expect(recovered.operation.startedAt).toBeNull();
            expect(recovered.operation.files[0]).toMatchObject({
                status: 'failed',
                error: { type: 'storage_error' },
            });
            expect(recovered.operation.files[1].status).toBe('awaiting_upload');
            expect((await upload('file-1')).operation.status).toBe('queued');
        },
    );

    it('expires unstarted work but restores a pre-expiry commit before applying expiry', async () => {
        await ready();
        await start();
        const spy = failRenameTo(locations.info);
        await expect(
            store.commitOutput(sid, oid, 'file-0', processed()),
        ).rejects.toThrow();
        spy.mockRestore();
        clock = new Date(expiry);
        const record = await store.recoverAfterRestart(sid);
        expect(record.operation.files[0].status).toBe('completed');
        expect(record.operation.files[1]).toMatchObject({
            status: 'cancelled',
            reason: 'session_expired',
        });
        expect(record.operation.status).toBe('partially_completed');
        await expect(
            store.completedOutput(sid, oid, 'file-0'),
        ).rejects.toMatchObject({ type: 'session_expired' });
    });

    it('reports damaged committed artifacts without deleting unaffected successes', async () => {
        await ready();
        await start();
        await store.commitOutput(sid, oid, 'file-0', processed());
        await start('file-1');
        await store.commitOutput(sid, oid, 'file-1', processed());
        await fs.writeFile(
            locations.output('file-1', 'image/webp'),
            'corrupted',
        );
        await expect(store.recoverAfterRestart(sid)).rejects.toThrow(
            'Invalid file commit evidence',
        );
        expect((await store.completedOutput(sid, oid, 'file-0')).meta.id).toBe(
            'file-0',
        );
        expect((await store.read(sid)).operation.files[0].status).toBe(
            'completed',
        );
    });

    it('removes orphan staging and incomplete artifacts without treating sidecars as completed', async () => {
        await create(1);
        await fs.writeFile(locations.staged('abandoned'), 'partial');
        await fs.writeFile(`${locations.info}.abc123.tmp`, 'partial');
        await fs.writeFile(locations.output('file-0', 'image/webp'), 'partial');
        await fs.writeFile(locations.meta('file-0'), '{}');
        await expect(
            store.completedOutput(sid, oid, 'file-0'),
        ).rejects.toMatchObject({ type: 'file_not_found' });
        const result = await store.recoverAfterRestart(sid);
        expect(result.operation.status).toBe('awaiting_uploads');
        expect(await fs.readdir(locations.staging)).toEqual([]);
        await absent(`${locations.info}.abc123.tmp`);
        await absent(locations.output('file-0', 'image/webp'));
        await absent(locations.meta('file-0'));
    });

    it('records a settled conversion failure and cannot overwrite a completed result', async () => {
        await ready();
        await start();
        await store.commitOutput(sid, oid, 'file-0', processed());
        await start('file-1');
        const result = await store.commitFailure(sid, oid, 'file-1', {
            type: 'conversion_failed',
            message: 'Bad image',
        });
        expect(result.operation.status).toBe('partially_completed');
        await absent(locations.input('file-1'));
        await expect(
            store.commitOutput(sid, oid, 'file-0', processed()),
        ).rejects.toThrow('not processing');
        await expect(
            store.update(sid, oid, (operation) =>
                finishConversionFile(
                    operation,
                    'file-0',
                    {
                        error: {
                            type: 'storage_error',
                            message: 'Do not remove',
                        },
                    },
                    clock,
                ),
            ),
        ).rejects.toThrow('Only a processing file');
        expect((await store.completedOutput(sid, oid, 'file-0')).meta.id).toBe(
            'file-0',
        );
    });
});
