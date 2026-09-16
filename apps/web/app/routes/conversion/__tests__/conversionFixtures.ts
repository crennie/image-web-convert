import {
    ApiConversionOperationSchema,
    type ApiConversionOperation,
    type ConversionFile,
} from '@image-web-convert/schemas';
import type { Session } from '@image-web-convert/ui';
export const time = '2026-09-16T00:00:00.000Z';
export const session: Session = {
    sessionId: 'session',
    token: 'token',
    expiresAt: new Date(Date.now() + 900_000).toISOString(),
    imageConfig: {
        ttlMinutes: 15,
        maxFiles: 20,
        maxBytesPerFile: 20000000,
        maxTotalBytes: 500000000,
    },
};
export const awaiting = (id = 'a'): ConversionFile => ({
    id,
    clientId: `client-${id}`,
    name: 'same.png',
    declaredBytes: 3,
    status: 'awaiting_upload',
});
export const completed = (id = 'a'): ConversionFile => ({
    ...awaiting(id),
    status: 'completed',
    actualBytes: 3,
    uploadedAt: time,
    startedAt: time,
    finishedAt: time,
    output: {
        url: `/sessions/session/files/${id}`,
        metaUrl: `/sessions/session/files/${id}/meta`,
        meta: {
            id,
            original: { name: 'same.png', sizeBytes: 3 },
            output: {
                storedName: `${id}.webp`,
                mime: 'image/webp',
                sizeBytes: 2,
                width: 10,
                height: 10,
                hasAlpha: false,
                colorSpace: 'srgb',
            },
            exifStripped: true,
            animated: false,
            uploadedAt: time,
        },
    },
});
export function snapshot(
    files: ConversionFile[] = [awaiting()],
    patch: Partial<ApiConversionOperation> = {},
): ApiConversionOperation {
    const count = (status: string) =>
        files.filter((f) => f.status === status).length;
    const settled = count('completed') + count('failed') + count('cancelled');
    return ApiConversionOperationSchema.parse({
        id: 'operation',
        sessionId: session.sessionId,
        revision: 1,
        status: settled === files.length ? 'completed' : 'awaiting_uploads',
        options: { outputMime: 'image/webp' },
        files,
        counts: {
            expected: files.length,
            awaitingUpload: count('awaiting_upload'),
            uploaded: files.filter((f) => 'uploadedAt' in f).length,
            processing: count('processing'),
            completed: count('completed'),
            failed: count('failed'),
            cancelled: count('cancelled'),
            settled,
        },
        createdAt: time,
        updatedAt: time,
        expiresAt: session.expiresAt,
        queuedAt: null,
        startedAt: null,
        finishedAt: settled === files.length ? time : null,
        cancelRequestedAt: null,
        stopRequestedAt: null,
        stopReason: null,
        ...patch,
    });
}
export function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}
