import {
    ApiCreateSessionResponseSchema,
    ApiDownloadFilesRequestSchema,
    ApiErrorSchema,
    ApiUploadsRequestSchema,
    ApiUploadsResponseSchema,
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
            }),
        ).toEqual({
            sid: 'session-1',
            expiresAt: '2026-09-02T12:15:00.000Z',
            token: 'secret-token',
        });
    });

    it.each(['image/webp', 'image/jpeg', 'image/png', 'image/avif'])(
        'accepts supported output MIME %s',
        (mime) => expect(OutputMimeTypeSchema.parse(mime)).toBe(mime),
    );

    it('parses successful and partial upload responses', () => {
        const accepted = {
            id: 'file-1',
            url: '/files/file-1',
            metaUrl: '/files/file-1/meta',
            meta: uploadMeta,
            clientId: 'client-1',
        };

        expect(
            ApiUploadsResponseSchema.parse({
                status: 'ok',
                accepted: [accepted],
                rejected: [],
            }).accepted,
        ).toHaveLength(1);

        expect(
            ApiUploadsResponseSchema.parse({
                status: 'partial',
                accepted: [accepted],
                rejected: [
                    {
                        fileName: 'bad.bmp',
                        error: 'Unsupported',
                        clientId: 'client-2',
                    },
                ],
            }).rejected,
        ).toHaveLength(1);
    });

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

    it('parses decoded upload and download request contracts', () => {
        expect(
            ApiUploadsRequestSchema.parse({
                outputMime: 'image/avif',
                clientIds: ['client-1'],
            }),
        ).toEqual({ outputMime: 'image/avif', clientIds: ['client-1'] });

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
            'session_used',
            'invalid_output_mime',
            'missing_files',
            'upload_error',
            'invalid_request',
            'file_not_found',
            'session_not_ready',
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
            ApiUploadsRequestSchema.safeParse({
                outputMime: 'image/gif',
                clientIds: ['client-1'],
            }).success,
        ).toBe(false);
        expect(
            ApiDownloadFilesRequestSchema.safeParse({ ids: [] }).success,
        ).toBe(false);
    });
});
