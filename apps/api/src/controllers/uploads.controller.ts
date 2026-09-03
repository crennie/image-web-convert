import type { Request, Response } from 'express';
import type { FileArray, UploadedFile } from 'express-fileupload';
import fs from 'node:fs/promises';
import { saveUploads } from '../services/uploads.service';
import {
    ApiErrorInvalidRequest,
    ApiErrorUploadLimitExceeded,
    ApiUploadsErrorFiles,
    ApiUploadsErrorMime,
    ApiUploadsErrorMissingFiles,
    ApiUploadsErrorSessionUsed,
    ApiUploadsRequestSchema,
    ApiUploadsResponse,
} from '@image-web-convert/schemas';
import { writeSessionInfo } from '../services/sessions.service';
import { validateRequestWithToken } from '../services/auth.service';
import { getSessionImageConfig } from '../env';

function toArray<T>(v: T | T[]): T[] {
    return Array.isArray(v) ? v : [v];
}

function extractUploads(files: FileArray | undefined | null): UploadedFile[] {
    if (!files) return [];
    return Object.values(files).flatMap((v) =>
        toArray(v as UploadedFile | UploadedFile[]),
    );
}

// POST /sessions/:sid/uploads
export async function create(req: Request, res: Response) {
    const { sid } = req.params;
    const uploads = extractUploads(req.files as FileArray);
    const validateResponse = await validateRequestWithToken(req, res);
    if (validateResponse.valid === false) {
        return rejectUploads(
            res,
            uploads,
            validateResponse.status,
            validateResponse.apiError,
        );
    } else {
        // Extra 409 sealed check for uploads
        if (validateResponse.info.sealedAt) {
            const response: ApiUploadsErrorSessionUsed = {
                type: 'session_used',
                message: '',
            };
            return rejectUploads(res, uploads, 409, response);
        }
    }

    const manifest = parseManifest(req.body?.manifest);
    const uploadRequest = ApiUploadsRequestSchema.safeParse({
        outputMime: req.body?.outputMime,
        clientIds: manifest,
    });
    if (!uploadRequest.success) {
        const invalidOutputMime = uploadRequest.error.issues.some(
            (issue) => issue.path[0] === 'outputMime',
        );
        if (!invalidOutputMime) {
            const response: ApiErrorInvalidRequest = {
                type: 'invalid_request',
                message: 'Manifest must be a JSON array of client IDs',
            };
            return rejectUploads(res, uploads, 400, response);
        }
        const response: ApiUploadsErrorMime = {
            type: 'invalid_output_mime',
            message: '',
        };
        return rejectUploads(res, uploads, 400, response);
    }
    const { outputMime, clientIds } = uploadRequest.data;

    try {
        if (uploads.length === 0) {
            const response: ApiUploadsErrorMissingFiles = {
                type: 'missing_files',
                message: 'No files uploaded',
            };
            return rejectUploads(res, uploads, 400, response);
        }
        if (clientIds.length !== 0 && clientIds.length !== uploads.length) {
            const response: ApiErrorInvalidRequest = {
                type: 'invalid_request',
                message:
                    'Manifest must contain one client ID per uploaded file',
            };
            return rejectUploads(res, uploads, 400, response);
        }

        const imageConfig = getSessionImageConfig();
        const currentCounts = validateResponse.info.counts;
        const totalIncomingBytes = uploads.reduce(
            (total, upload) => total + upload.size,
            0,
        );
        const oversizedFile = uploads.find(
            (upload) =>
                upload.truncated || upload.size > imageConfig.maxBytesPerFile,
        );
        let limitMessage: string | undefined;
        if (oversizedFile) {
            limitMessage = `File exceeds the ${imageConfig.maxBytesPerFile} byte limit: ${oversizedFile.name}`;
        } else if (
            currentCounts.files + uploads.length >
            imageConfig.maxFiles
        ) {
            limitMessage = `Upload exceeds the ${imageConfig.maxFiles} file limit`;
        } else if (
            currentCounts.totalBytes + totalIncomingBytes >
            imageConfig.maxTotalBytes
        ) {
            limitMessage = `Upload exceeds the ${imageConfig.maxTotalBytes} byte session limit`;
        }
        if (limitMessage) {
            const response: ApiErrorUploadLimitExceeded = {
                type: 'upload_limit_exceeded',
                message: limitMessage,
            };
            return rejectUploads(res, uploads, 413, response);
        }

        // Delegates to service layer (saves files, maps names -> UUIDs, writes metadata, etc.)
        // Expected shape: { accepted: any[]; rejected: { fileName: string; error: string }[] }
        const { accepted, rejected } = await saveUploads(
            sid,
            outputMime,
            uploads,
            clientIds,
        );

        // Update counts
        validateResponse.info.counts.files += accepted.length;
        validateResponse.info.counts.totalBytes += accepted.reduce(
            (total, upload) => total + (upload.meta.original.sizeBytes ?? 0),
            0,
        );

        // Seal regardless of per-file failures
        validateResponse.info.sealedAt = new Date().toISOString();
        await writeSessionInfo(sid, validateResponse.info);

        const hasFailures = rejected && rejected.length > 0;
        const http = hasFailures ? 207 /* Multi-Status */ : 200;
        const status = hasFailures ? 'partial' : 'ok';
        const response: ApiUploadsResponse = { status, accepted, rejected };

        return res.status(http).json(response);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
        await cleanupTempUploads(uploads);
        const response: ApiUploadsErrorFiles = {
            type: 'upload_error',
            message: err?.message || 'Upload failed',
        };
        return res.status(500).json(response);
    }
}

async function rejectUploads(
    res: Response,
    uploads: UploadedFile[],
    status: number,
    response: unknown,
) {
    await cleanupTempUploads(uploads);
    return res.status(status).json(response);
}

async function cleanupTempUploads(uploads: UploadedFile[]): Promise<void> {
    await Promise.all(
        uploads.map(async (upload) => {
            if (!upload.tempFilePath) return;
            await fs.unlink(upload.tempFilePath).catch(() => undefined);
        }),
    );
}

function parseManifest(value: unknown): unknown {
    if (value === undefined || value === null || value === '') return [];
    if (typeof value !== 'string') return value;
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}
