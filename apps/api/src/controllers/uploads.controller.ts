import type { Request, Response } from 'express';
import type { FileArray, UploadedFile } from 'express-fileupload';
import { saveUploads } from '../services/uploads.service';
import {
    ApiErrorInvalidRequest,
    ApiUploadsErrorFiles,
    ApiUploadsErrorMime,
    ApiUploadsErrorMissingFiles,
    ApiUploadsErrorSessionUsed,
    ApiUploadsRequestSchema,
    ApiUploadsResponse,
} from '@image-web-convert/schemas';
import { writeSessionInfo } from '../services/sessions.service';
import { validateRequestWithToken } from '../services/auth.service';

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
    const validateResponse = await validateRequestWithToken(req, res);
    if (validateResponse.valid === false) {
        return res
            .status(validateResponse.status)
            .json(validateResponse.apiError);
    } else {
        // Extra 409 sealed check for uploads
        if (validateResponse.info.sealedAt) {
            const response: ApiUploadsErrorSessionUsed = {
                type: 'session_used',
                message: '',
            };
            return res.status(409).json(response);
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
            return res.status(400).json(response);
        }
        const response: ApiUploadsErrorMime = {
            type: 'invalid_output_mime',
            message: '',
        };
        return res.status(400).json(response);
    }
    const { outputMime, clientIds } = uploadRequest.data;

    try {
        const uploads = extractUploads(req.files as FileArray);
        if (uploads.length === 0) {
            const response: ApiUploadsErrorMissingFiles = {
                type: 'missing_files',
                message: 'No files uploaded',
            };
            return res.status(400).json(response);
        }
        if (clientIds.length !== 0 && clientIds.length !== uploads.length) {
            const response: ApiErrorInvalidRequest = {
                type: 'invalid_request',
                message:
                    'Manifest must contain one client ID per uploaded file',
            };
            return res.status(400).json(response);
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
        // TODO: Calculate total bytes from accepted files? Not needed
        // info.counts.totalBytes += totalBytes;

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
        const response: ApiUploadsErrorFiles = {
            type: 'upload_error',
            message: err?.message || 'Upload failed',
        };
        return res.status(500).json(response);
    }
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
