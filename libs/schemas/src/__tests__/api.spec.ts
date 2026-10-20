import {
    ApiCreateSessionResponseSchema,
    ApiDownloadFilesRequestSchema,
    ApiErrorSchema,
    OutputMimeTypeSchema,
    UploadMetaSchema,
} from '../index.js';

const uploadMeta = {
    id: 'file-1',
    original: {
        name: 'photo.heic',
        mime: 'image/heic',
        sizeBytes: 1024,
        width: 1200,
        height: 800,
        pages: 1,
    },
    output: {
        storedName: 'file-1.webp',
        mime: 'image/webp',
        sizeBytes: 512,
        width: 1200,
        height: 800,
        hasAlpha: false,
        colorSpace: 'srgb',
    },
    exifStripped: true,
    animated: false,
    uploadedAt: '2026-09-02T12:00:00.000Z',
};

describe('public API schemas', () => {
    it('parses a session response', () => {
        expect(
            ApiCreateSessionResponseSchema.parse({
                sid: 'session-1',
                expiresAt: '2026-09-02T12:15:00.000Z',
                token: 'secret-token',
                imageConfig: {
                    ttlMinutes: 15,
                    maxFiles: 20,
                    maxBytesPerFile: 20_000_000,
                    maxTotalBytes: 500_000_000,
                },
            }),
        ).toEqual({
            sid: 'session-1',
            expiresAt: '2026-09-02T12:15:00.000Z',
            token: 'secret-token',
            imageConfig: {
                ttlMinutes: 15,
                maxFiles: 20,
                maxBytesPerFile: 20_000_000,
                maxTotalBytes: 500_000_000,
            },
        });
    });

    it.each(['image/webp', 'image/jpeg', 'image/png', 'image/avif'])(
        'accepts supported output MIME %s',
        (mime) => expect(OutputMimeTypeSchema.parse(mime)).toBe(mime),
    );

    it('rejects malformed upload metadata', () => {
        expect(
            UploadMetaSchema.safeParse({
                ...uploadMeta,
                output: { ...uploadMeta.output, mime: 'image/gif' },
            }).success,
        ).toBe(false);
        expect(
            UploadMetaSchema.safeParse({ ...uploadMeta, exifStripped: false })
                .success,
        ).toBe(false);
    });

    it('parses the download request contract', () => {
        expect(
            ApiDownloadFilesRequestSchema.parse({
                ids: ['file-1'],
                archiveName: 'images.zip',
            }),
        ).toEqual({ ids: ['file-1'], archiveName: 'images.zip' });
    });

    it('parses every currently shared API error', () => {
        const types = [
            'invalid_token',
            'session_not_found',
            'session_expired',
            'upload_in_progress',
            'upload_error',
            'invalid_request',
            'file_not_found',
            'upload_limit_exceeded',
        ];

        for (const type of types) {
            expect(ApiErrorSchema.parse({ type, message: 'Details' })).toEqual({
                type,
                message: 'Details',
            });
        }
    });

    it('rejects unknown errors and malformed request bodies', () => {
        expect(
            ApiErrorSchema.safeParse({ type: 'unknown_error' }).success,
        ).toBe(false);
        expect(
            ApiDownloadFilesRequestSchema.safeParse({ ids: [] }).success,
        ).toBe(false);
        for (const ids of [
            ['a', 'a'],
            Array.from({ length: 33 }, (_, index) => String(index)),
            ['a'.repeat(129)],
            ['bad\r\nheader'],
        ]) {
            expect(
                ApiDownloadFilesRequestSchema.safeParse({ ids }).success,
            ).toBe(false);
        }
        expect(
            ApiDownloadFilesRequestSchema.safeParse({
                ids: ['a'],
                archiveName: 'x'.repeat(129),
            }).success,
        ).toBe(false);
    });
});
