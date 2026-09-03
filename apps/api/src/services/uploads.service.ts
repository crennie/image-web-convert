import { removeStoredUpload, saveUploadFile } from './storage.service';
import { ApiUploadAccepted, ApiUploadRejected, OutputMimeType } from '@image-web-convert/schemas';
import { SessionInfo, writeSessionInfo } from './sessions.service';

export interface UploadInput {
    originalName: string;
    tempInputPath: string;
    originalBytes: number;
    clientId?: string;
}

export interface UploadBatchResult {
    accepted: ApiUploadAccepted[];
    rejected: ApiUploadRejected[];
}

export class UploadClaimConflictError extends Error {
    constructor() {
        super('An upload is already in progress for this session');
        this.name = 'UploadClaimConflictError';
    }
}

// This claim is intentionally process-local: the current filesystem-backed API
// runs as one Node process and does not provide a distributed locking guarantee.
const claimedSessions = new Set<string>();

async function convertUploads(sid: string, outputMime: OutputMimeType, uploads: UploadInput[]): Promise<UploadBatchResult> {
    const promises = uploads.map((upload) => saveUploadFile(sid, outputMime, upload));
    const settled = await Promise.allSettled(promises);

    const accepted: ApiUploadAccepted[] = [];
    const rejected: ApiUploadRejected[] = [];

    settled.forEach((result, i) => {
        if (result.status === 'fulfilled') {
            accepted.push(result.value);
        } else {
            rejected.push({
                fileName: uploads[i]?.originalName ?? '(unknown)',
                error: result.reason instanceof Error ? result.reason.message : String(result.reason),
                clientId: uploads[i]?.clientId,
            });
        }
    });

    return { accepted, rejected };
}

export async function processUploadBatch(
    sid: string,
    outputMime: OutputMimeType,
    uploads: UploadInput[],
    sessionInfo: SessionInfo,
): Promise<UploadBatchResult> {
    if (claimedSessions.has(sid)) throw new UploadClaimConflictError();
    claimedSessions.add(sid);

    try {
        const result = await convertUploads(sid, outputMime, uploads);
        const acceptedBytes = result.accepted.reduce(
            (total, upload) => total + (upload.meta.original.sizeBytes ?? 0),
            0,
        );
        const updatedInfo: SessionInfo = {
            ...sessionInfo,
            counts: {
                files: sessionInfo.counts.files + result.accepted.length,
                totalBytes: sessionInfo.counts.totalBytes + acceptedBytes,
            },
            // A completed batch, including an all-rejected batch, consumes the session.
            sealedAt: new Date().toISOString(),
        };

        try {
            await writeSessionInfo(sid, updatedInfo);
        } catch (error) {
            await Promise.all(
                result.accepted.map((upload) => removeStoredUpload(sid, upload)),
            );
            throw error;
        }
        return result;
    } finally {
        claimedSessions.delete(sid);
    }
}
