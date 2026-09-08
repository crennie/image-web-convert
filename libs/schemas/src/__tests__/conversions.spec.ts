import {
    ApiCreateConversionRequestSchema,
    ApiErrorSchema,
    ConversionFileSchema,
    ApiConversionOperationSchema,
} from '../index.js';

const request = {
    requestId: 'request-1',
    options: { outputMime: 'image/webp' },
    files: [{ clientId: 'client-1', name: 'photo.png', sizeBytes: 10 }],
};
const file = {
    id: 'file-1',
    clientId: 'client-1',
    name: 'photo.png',
    declaredBytes: 10,
    status: 'awaiting_upload',
};
const snapshot = {
    id: 'operation-1',
    sessionId: 'session-1',
    revision: 0,
    status: 'awaiting_uploads',
    options: request.options,
    files: [file],
    counts: {
        expected: 1,
        awaitingUpload: 1,
        uploaded: 0,
        processing: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
        settled: 0,
    },
    createdAt: '2026-09-08T12:00:00.000Z',
    updatedAt: '2026-09-08T12:00:00.000Z',
    expiresAt: '2026-09-08T12:15:00.000Z',
    queuedAt: null,
    startedAt: null,
    finishedAt: null,
    cancelRequestedAt: null,
    stopRequestedAt: null,
    stopReason: null,
};

describe('conversion boundary schemas', () => {
    it('accepts a manifest while disallowing client-owned workflow fields', () => {
        expect(ApiCreateConversionRequestSchema.parse(request)).toEqual(
            request,
        );
        expect(
            ApiCreateConversionRequestSchema.safeParse({
                ...request,
                status: 'completed',
            }).success,
        ).toBe(false);
        expect(
            ApiCreateConversionRequestSchema.safeParse({
                ...request,
                options: { ...request.options, quality: 1 },
            }).success,
        ).toBe(false);
        expect(
            ApiCreateConversionRequestSchema.safeParse({
                ...request,
                files: [{ ...request.files[0], id: 'client-assigned-slot' }],
            }).success,
        ).toBe(false);
    });

    it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
        'rejects invalid declared bytes %s',
        (sizeBytes) => {
            expect(
                ApiCreateConversionRequestSchema.safeParse({
                    ...request,
                    files: [{ ...request.files[0], sizeBytes }],
                }).success,
            ).toBe(false);
        },
    );

    it('rejects empty manifests, duplicate IDs, and unsupported output MIME', () => {
        for (const invalid of [
            { ...request, files: [] },
            { ...request, files: [request.files[0], request.files[0]] },
            { ...request, options: { outputMime: 'image/gif' } },
        ])
            expect(
                ApiCreateConversionRequestSchema.safeParse(invalid).success,
            ).toBe(false);
    });

    it('requires evidence appropriate to each file state', () => {
        expect(ConversionFileSchema.parse(file)).toEqual(file);
        for (const status of [
            'uploaded',
            'processing',
            'completed',
            'failed',
            'cancelled',
        ]) {
            expect(
                ConversionFileSchema.safeParse({ ...file, status }).success,
            ).toBe(false);
        }
        expect(
            ConversionFileSchema.safeParse({
                ...file,
                status: 'uploaded',
                actualBytes: 9,
                uploadedAt: snapshot.createdAt,
            }).success,
        ).toBe(false);
        expect(
            ConversionFileSchema.parse({
                ...file,
                status: 'failed',
                finishedAt: snapshot.createdAt,
                error: { type: 'unsupported_image', message: 'Unsupported' },
            }),
        ).toMatchObject({ status: 'failed' });
    });

    it('parses snapshots without internal paths, settings, or credentials', () => {
        const parsed = ApiConversionOperationSchema.parse({
            ...snapshot,
            tokenHash: 'internal',
            processingOptions: {},
            files: [{ ...file, inputPath: '/internal/input' }],
        });
        expect(parsed).toEqual(snapshot);
    });

    it('rejects unsafe slot IDs and duplicate file associations', () => {
        expect(
            ConversionFileSchema.safeParse({ ...file, id: '../file' }).success,
        ).toBe(false);
        expect(
            ApiConversionOperationSchema.safeParse({
                ...snapshot,
                files: [file, file],
            }).success,
        ).toBe(false);
    });

    it('rejects inconsistent counts, premature completion, and incomplete stop requests', () => {
        for (const invalid of [
            { ...snapshot, counts: { ...snapshot.counts, completed: 1 } },
            {
                ...snapshot,
                status: 'completed',
                finishedAt: snapshot.updatedAt,
            },
            { ...snapshot, stopReason: 'conversion_timeout' },
        ])
            expect(
                ApiConversionOperationSchema.safeParse(invalid).success,
            ).toBe(false);
        expect(
            ConversionFileSchema.safeParse({
                ...file,
                status: 'failed',
                actualBytes: 10,
                finishedAt: snapshot.updatedAt,
                error: { type: 'storage_error', message: 'Failed' },
            }).success,
        ).toBe(false);
    });

    it.each([
        'operation_not_found',
        'conversion_conflict',
        'conversion_capacity_exceeded',
        'stale_file_upload',
        'upload_size_mismatch',
        'storage_error',
    ])('uses the existing API error envelope for %s', (type) => {
        expect(ApiErrorSchema.parse({ type, message: 'Details' })).toEqual({
            type,
            message: 'Details',
        });
    });
});
