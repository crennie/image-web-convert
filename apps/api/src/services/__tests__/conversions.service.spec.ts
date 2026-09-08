import {
    ApiConversionOperationSchema,
    DEFAULT_SESSION_IMAGE_CONFIG,
    type ConversionOutput,
} from '@image-web-convert/schemas';
import {
    acceptConversionUpload,
    conversionSnapshot,
    createConversionOperation,
    finishConversionFile,
    rejectConversionUpload,
    requestConversionStop,
    startConversionFile,
    type ConversionOperation,
} from '../conversions.service';

const now = new Date('2026-09-08T12:00:00.000Z');
const later = new Date('2026-09-08T12:01:00.000Z');
const expiresAt = '2026-09-08T12:15:00.000Z';
const error = {
    type: 'conversion_failed' as const,
    message: 'Cannot decode image',
};
const uploadError = {
    type: 'unsupported_image' as const,
    message: 'Unsupported image',
};
const intent = (count = 2) => ({
    requestId: 'request-1',
    options: { outputMime: 'image/webp' },
    files: Array.from({ length: count }, (_, i) => ({
        clientId: `client-${i}`,
        name: `${i}.png`,
        sizeBytes: 10,
    })),
});
const context = (count = 2) => ({
    id: 'operation-1',
    sessionId: 'session-1',
    fileIds: Array.from({ length: count }, (_, i) => `file-${i}`),
    expiresAt,
    now,
    limits: { ...DEFAULT_SESSION_IMAGE_CONFIG },
});
const create = (count = 2) =>
    createConversionOperation(intent(count), context(count));
const ready = (count = 2) => {
    let operation = create(count);
    for (const file of operation.files)
        operation = acceptConversionUpload(operation, file.id, 10, now);
    return operation;
};
const output = (id = 'file-0'): ConversionOutput => ({
    url: `/sessions/session-1/files/${id}`,
    metaUrl: `/sessions/session-1/files/${id}/meta`,
    meta: {
        id,
        original: { name: `${id}.png`, sizeBytes: 10 },
        output: {
            storedName: `${id}.webp`,
            mime: 'image/webp',
            sizeBytes: 5,
            width: 1,
            height: 1,
            hasAlpha: false,
            colorSpace: 'srgb',
        },
        exifStripped: true,
        animated: false,
        uploadedAt: now.toISOString(),
    },
});
const succeed = (operation: ConversionOperation, id: string) =>
    finishConversionFile(
        startConversionFile(operation, id, now),
        id,
        { output: output(id) },
        now,
    );

describe('conversion creation and snapshots', () => {
    it('assigns stable ordered slots, sanitizes display names, and isolates caller data', () => {
        const request = intent();
        request.files[0].name = 'C:\\photos\\bad\u0000?.png';
        const ctx = context();
        const operation = createConversionOperation(request, ctx);
        request.files.reverse();
        request.options.outputMime = 'image/jpeg';
        ctx.limits.maxFiles = 1;
        expect(
            operation.files.map((file) => [file.id, file.clientId, file.name]),
        ).toEqual([
            ['file-0', 'client-0', 'bad_.png'],
            ['file-1', 'client-1', '1.png'],
        ]);
        expect(operation.options.outputMime).toBe('image/webp');
        expect(operation.limits.maxFiles).toBe(20);
        expect(operation.processingOptions.limitInputPixels).toBe(200_000_000);
        expect(operation).toMatchObject({
            revision: 0,
            status: 'awaiting_uploads',
            expiresAt,
            schemaVersion: 1,
        });
    });

    it.each([{ maxFiles: 1 }, { maxBytesPerFile: 9 }, { maxTotalBytes: 19 }])(
        'rejects manifests beyond effective limits %j',
        (limits) => {
            const ctx = context();
            ctx.limits = { ...ctx.limits, ...limits };
            expect(() => createConversionOperation(intent(), ctx)).toThrow(
                'Manifest exceeds session limits',
            );
        },
    );

    it('accepts exact effective limits', () => {
        expect(
            createConversionOperation(intent(), {
                ...context(),
                limits: {
                    ttlMinutes: 15,
                    maxFiles: 2,
                    maxBytesPerFile: 10,
                    maxTotalBytes: 20,
                },
            }).files,
        ).toHaveLength(2);
    });

    it.each([
        { files: [] },
        { files: [intent().files[0], intent().files[0]] },
        { options: { outputMime: 'image/gif' } },
    ])('rejects invalid creation intent %j', (patch) => {
        expect(() =>
            createConversionOperation({ ...intent(), ...patch }, context()),
        ).toThrow('Invalid conversion manifest');
    });

    it.each([['file-0'], ['file-0', 'file-0'], ['../outside', 'file-1']])(
        'rejects invalid server slots %j',
        (...fileIds) => {
            expect(() =>
                createConversionOperation(intent(), { ...context(), fileIds }),
            ).toThrow('server-assigned file slots');
        },
    );

    it('rejects expired creation, invalid IDs, and invalid expiry', () => {
        expect(() =>
            createConversionOperation(intent(), {
                ...context(),
                now: new Date(expiresAt),
            }),
        ).toThrow('Session has expired');
        expect(() =>
            createConversionOperation(intent(), {
                ...context(),
                sessionId: '../other',
            }),
        ).toThrow('server-assigned file slots');
        expect(() =>
            createConversionOperation(intent(), {
                ...context(),
                expiresAt: 'invalid',
            }),
        ).toThrow('Invalid session expiry');
    });

    it('projects isolated public data and computes counts from file records', () => {
        const operation = succeed(ready(), 'file-0');
        const snapshot = conversionSnapshot(operation);
        expect(snapshot.counts).toEqual({
            expected: 2,
            awaitingUpload: 0,
            uploaded: 2,
            processing: 0,
            completed: 1,
            failed: 0,
            cancelled: 0,
            settled: 1,
        });
        expect(snapshot).not.toHaveProperty('processingOptions');
        expect(snapshot).not.toHaveProperty('limits');
        expect(snapshot).not.toHaveProperty('requestId');
        expect(snapshot).not.toHaveProperty('schemaVersion');
        snapshot.files[0].name = 'changed';
        expect(operation.files[0].name).toBe('0.png');
    });
});

describe('upload readiness and immutable transitions', () => {
    it('cannot process early, queues on final upload, and leaves input snapshots untouched', () => {
        const initial = create();
        const first = acceptConversionUpload(initial, 'file-0', 10, now);
        expect(initial.files[0].status).toBe('awaiting_upload');
        expect(first.status).toBe('awaiting_uploads');
        expect(() => startConversionFile(first, 'file-0', now)).toThrow(
            'not ready',
        );
        const queued = acceptConversionUpload(first, 'file-1', 10, later);
        expect(queued).toMatchObject({
            status: 'queued',
            revision: 2,
            queuedAt: later.toISOString(),
        });
        expect(queued.options).toEqual(initial.options);
        expect(queued.files.map((file) => file.id)).toEqual(
            initial.files.map((file) => file.id),
        );
        const replay = acceptConversionUpload(queued, 'file-0', 999, later);
        expect(replay).toEqual(queued); // An immutable accepted slot ignores replacement bytes.
    });

    it('does not associate foreign file IDs or accept invalid bytes', () => {
        const operation = create();
        expect(() =>
            acceptConversionUpload(operation, 'foreign-file', 10, now),
        ).toThrow('does not belong');
        for (const bytes of [-1, 1.5, NaN])
            expect(() =>
                acceptConversionUpload(operation, 'file-0', bytes, now),
            ).toThrow('Invalid byte count');
        expect(() =>
            acceptConversionUpload(operation, 'file-0', 11, now),
        ).toThrow('differ from manifest');
        expect(() =>
            acceptConversionUpload(operation, 'file-0', 20_000_001, now),
        ).toThrow('byte limit');
        expect(operation.files[0].status).toBe('awaiting_upload');
    });

    it('resolves permanent rejection but not transient upload errors', () => {
        const operation = acceptConversionUpload(create(), 'file-0', 10, now);
        expect(() =>
            rejectConversionUpload(
                operation,
                'file-1',
                { type: 'storage_error', message: 'Disk unavailable' },
                now,
            ),
        ).toThrow('Only permanent');
        const queued = rejectConversionUpload(
            operation,
            'file-1',
            uploadError,
            now,
        );
        expect(queued.status).toBe('queued');
        expect(() => acceptConversionUpload(queued, 'file-1', 10, now)).toThrow(
            'no longer accepts uploads',
        );
        expect(succeed(queued, 'file-0').status).toBe('partially_completed');
    });

    it('settles all permanently rejected uploads without processing', () => {
        const failed = rejectConversionUpload(
            rejectConversionUpload(create(), 'file-0', uploadError, now),
            'file-1',
            uploadError,
            now,
        );
        expect(failed).toMatchObject({
            status: 'failed',
            startedAt: null,
            finishedAt: now.toISOString(),
        });
    });

    it('rejects backwards time and uploads at expiry', () => {
        expect(() =>
            acceptConversionUpload(
                create(),
                'file-0',
                10,
                new Date(now.getTime() - 1),
            ),
        ).toThrow('backwards');
        expect(() =>
            acceptConversionUpload(create(), 'file-0', 10, new Date(expiresAt)),
        ).toThrow('Session has expired');
    });
});

describe('conversion outcomes', () => {
    it('completes a successful batch and protects committed results', () => {
        const partial = succeed(ready(), 'file-0');
        const completed = succeed(partial, 'file-1');
        expect(completed.status).toBe('completed');
        expect(partial.status).toBe('processing');
        expect(conversionSnapshot(completed).counts.completed).toBe(2);
        expect(acceptConversionUpload(completed, 'file-0', 999, later)).toEqual(
            completed,
        );
        expect(() =>
            finishConversionFile(completed, 'file-0', { error }, now),
        ).toThrow('Only a processing file');
        expect(() =>
            rejectConversionUpload(partial, 'file-0', uploadError, now),
        ).toThrow('no longer accepts rejection');
        expect(
            requestConversionStop(completed, 'user_cancelled', later),
        ).toEqual(completed);
    });

    it.each([true, false])(
        'settles processing failure, prior success=%s',
        (priorSuccess) => {
            let operation = ready();
            operation = priorSuccess
                ? succeed(operation, 'file-0')
                : finishConversionFile(
                      startConversionFile(operation, 'file-0', now),
                      'file-0',
                      { error },
                      now,
                  );
            operation = finishConversionFile(
                startConversionFile(operation, 'file-1', now),
                'file-1',
                { error },
                now,
            );
            expect(operation.status).toBe(
                priorSuccess ? 'partially_completed' : 'failed',
            );
            expect(conversionSnapshot(operation).counts.settled).toBe(2);
        },
    );

    it('rejects duplicate starts and output for another slot or MIME', () => {
        const operation = startConversionFile(ready(), 'file-0', now);
        expect(() => startConversionFile(operation, 'file-0', now)).toThrow(
            'not ready',
        );
        expect(() =>
            finishConversionFile(
                operation,
                'file-0',
                { output: output('file-1') },
                now,
            ),
        ).toThrow('does not match');
        const wrong = output();
        wrong.meta.output.mime = 'image/jpeg';
        expect(() =>
            finishConversionFile(operation, 'file-0', { output: wrong }, now),
        ).toThrow('does not match');
        wrong.meta.output.mime = 'image/webp';
        wrong.meta.original.sizeBytes = 9;
        expect(() =>
            finishConversionFile(operation, 'file-0', { output: wrong }, now),
        ).toThrow('does not match');
    });

    it('supports snapshots with multiple active files without deciding worker concurrency', () => {
        const operation = startConversionFile(
            startConversionFile(ready(), 'file-0', now),
            'file-1',
            now,
        );
        expect(
            ApiConversionOperationSchema.parse(conversionSnapshot(operation))
                .counts.processing,
        ).toBe(2);
    });
});

describe('cancellation, deadlines, and expiry', () => {
    it.each(['awaiting', 'queued'])(
        'cancels %s work immediately and idempotently',
        (state) => {
            const operation = requestConversionStop(
                state === 'queued' ? ready() : create(),
                'user_cancelled',
                now,
            );
            expect(operation.status).toBe('cancelled');
            expect(
                operation.files.every((file) => file.status === 'cancelled'),
            ).toBe(true);
            expect(
                requestConversionStop(operation, 'user_cancelled', later),
            ).toEqual(operation);
            expect(() =>
                acceptConversionUpload(operation, 'file-0', 10, later),
            ).toThrow('no longer accepts work');
            expect(() =>
                startConversionFile(operation, 'file-0', later),
            ).toThrow('no longer accepts work');
        },
    );

    it('preserves completed results when cancelled between files', () => {
        const before = succeed(ready(), 'file-0');
        const cancelled = requestConversionStop(
            before,
            'user_cancelled',
            later,
        );
        expect(cancelled.status).toBe('cancelled');
        expect(cancelled.files[0]).toEqual(before.files[0]);
        expect(conversionSnapshot(cancelled).counts).toMatchObject({
            completed: 1,
            cancelled: 1,
            settled: 2,
        });
    });

    it.each([true, false])(
        'waits for active conversion after cancel, active success=%s',
        (success) => {
            const processing = startConversionFile(ready(), 'file-0', now);
            const stopped = requestConversionStop(
                processing,
                'user_cancelled',
                now,
            );
            expect(stopped).toMatchObject({
                status: 'processing',
                finishedAt: null,
                cancelRequestedAt: now.toISOString(),
            });
            expect(
                requestConversionStop(stopped, 'user_cancelled', later),
            ).toEqual(stopped);
            expect(stopped.files[0].status).toBe('processing');
            expect(stopped.files[1].status).toBe('cancelled');
            const finished = finishConversionFile(
                stopped,
                'file-0',
                success ? { output: output() } : { error },
                later,
            );
            expect(finished.status).toBe('cancelled');
            expect(finished.files[0].status).toBe(
                success ? 'completed' : 'failed',
            );
        },
    );

    it('timeout remains active until settlement, discards late success, and preserves prior results', () => {
        const before = startConversionFile(
            succeed(ready(3), 'file-0'),
            'file-1',
            now,
        );
        const stopped = requestConversionStop(
            before,
            'conversion_timeout',
            later,
        );
        expect(stopped).toMatchObject({
            status: 'processing',
            finishedAt: null,
            cancelRequestedAt: null,
        });
        expect(stopped.files[2]).toMatchObject({
            status: 'cancelled',
            reason: 'conversion_timeout',
        });
        const finished = finishConversionFile(
            stopped,
            'file-1',
            { output: output('file-1') },
            later,
        );
        expect(finished.status).toBe('partially_completed');
        expect(finished.files[0]).toEqual(before.files[0]);
        expect(finished.files[1]).toMatchObject({
            status: 'failed',
            error: { type: 'conversion_timeout' },
        });
        expect(finished.files[1]).not.toHaveProperty('output');
    });

    it('keeps accepted cancellation precedence when a timeout also occurs', () => {
        const processing = startConversionFile(ready(), 'file-0', now);
        for (const reasons of [
            ['user_cancelled', 'conversion_timeout'],
            ['conversion_timeout', 'user_cancelled'],
        ] as const) {
            const stopped = requestConversionStop(
                requestConversionStop(processing, reasons[0], now),
                reasons[1],
                now,
            );
            const finished = finishConversionFile(
                stopped,
                'file-0',
                { output: output() },
                later,
            );
            expect(finished.status).toBe('cancelled');
            expect(finished.files[0]).toMatchObject({
                status: 'failed',
                error: { type: 'conversion_timeout' },
            });
        }
    });

    it('rejects premature expiry or timeout without active conversion', () => {
        expect(() =>
            requestConversionStop(create(), 'session_expired', now),
        ).toThrow('has not expired');
        expect(() =>
            requestConversionStop(ready(), 'conversion_timeout', now),
        ).toThrow('No active conversion');
    });

    it('expires abandoned uploads and prevents publication after expiry even without a timer', () => {
        const expiry = new Date(expiresAt);
        expect(
            requestConversionStop(create(), 'session_expired', expiry),
        ).toMatchObject({ status: 'failed', stopReason: 'session_expired' });
        const finished = finishConversionFile(
            startConversionFile(ready(), 'file-0', now),
            'file-0',
            { output: output() },
            expiry,
        );
        expect(finished.status).toBe('failed');
        expect(finished.files[0]).toMatchObject({
            status: 'failed',
            error: { type: 'session_expired' },
        });
        expect(finished.files[1]).toMatchObject({
            status: 'cancelled',
            reason: 'session_expired',
        });
    });
});
