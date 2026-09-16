import type {
    ApiConversionOperation,
    ConversionFile,
} from '@image-web-convert/schemas';
import type { UploadAttempt } from './api/conversionUploadTransport';

export const isTerminal = (operation: ApiConversionOperation) =>
    ['completed', 'partially_completed', 'failed', 'cancelled'].includes(
        operation.status,
    );
export function mergeSnapshot(
    current: ApiConversionOperation | null,
    next: ApiConversionOperation,
    sessionId: string,
) {
    if (
        next.sessionId !== sessionId ||
        (current &&
            (current.id !== next.id || next.revision <= current.revision))
    )
        return current;
    return next;
}
export function canRetryUpload(file: ConversionFile, upload?: UploadAttempt) {
    return (
        file.status === 'awaiting_upload' &&
        (upload?.status === 'error' || upload?.status === 'aborted')
    );
}
export function fileDisplayState(file: ConversionFile, upload?: UploadAttempt) {
    if (file.status !== 'awaiting_upload')
        return file.status === 'uploaded'
            ? 'Uploaded — waiting for processing'
            : file.status.replace(/_/g, ' ');
    switch (upload?.status) {
        case 'sending':
            return `Uploading: ${upload.loaded} transport bytes${upload.total === undefined ? ' (total unknown)' : ` of ${upload.total}`}`;
        case 'error':
            if (upload.reconciliationError)
                return 'Could not check upload status — retry when connected';
            return upload.conflict
                ? 'Upload conflict — check server and retry'
                : 'Upload not confirmed — check server and retry';
        case 'aborted':
            return 'Local upload stopped — server outcome pending';
        case 'acknowledged':
            return 'Transfer sent — awaiting server confirmation';
        case 'reconciling':
            return 'Checking server before retry';
        default:
            return 'Waiting to upload';
    }
}
export function batchUploadProgress(uploads: Record<string, UploadAttempt>) {
    const attempts = Object.values(uploads);
    return {
        loaded: attempts.reduce((n, a) => n + a.loaded, 0),
        total:
            attempts.length && attempts.every((a) => a.total !== undefined)
                ? attempts.reduce((n, a) => n + (a.total ?? 0), 0)
                : undefined,
    };
}
export const completedDownloads = (operation: ApiConversionOperation) =>
    operation.files.flatMap((file) =>
        file.status === 'completed' ? [file.output] : [],
    );
