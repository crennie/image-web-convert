import type { Request, Response } from 'express';
import type { FileArray, UploadedFile } from 'express-fileupload';
import { saveUploads } from '../services/uploads.service';
import { ApiUploadsErrorFiles, ApiUploadsErrorMissingFiles, ApiUploadsErrorSessionUsed, ApiUploadsResponse } from '@image-web-convert/schemas';
import { writeSessionInfo } from '../services/sessions.service';
import { validateRequestWithToken } from '../services/auth.service';

function toArray<T>(v: T | T[]): T[] {
    return Array.isArray(v) ? v : [v];
}

function extractUploads(files: FileArray | undefined | null): UploadedFile[] {
    if (!files) return [];
    return Object.values(files).flatMap((v) => toArray(v as UploadedFile | UploadedFile[]));
}

// POST /sessions/:sid/uploads
export async function create(req: Request, res: Response) {
    const { sid } = req.params;
    const validateResponse = await validateRequestWithToken(req, res);
    if (validateResponse.valid === false) {
        return res.status(validateResponse.status).json(validateResponse.apiError);
    } else {
        // Extra 409 sealed check for uploads
        if (validateResponse.info.sealedAt) {
            const response: ApiUploadsErrorSessionUsed = { type: "session_used", message: "" };
            return res.status(409).json(response);
        }
    }

    try {
        const uploads = extractUploads(req.files as FileArray);
        if (uploads.length === 0) {
            const response: ApiUploadsErrorMissingFiles = { type: "missing_files", message: "No files uploaded" };
            return res.status(400).json(response);
        }

        // Delegates to service layer (saves files, maps names -> UUIDs, writes metadata, etc.)
        // Expected shape: { accepted: any[]; rejected: { fileName: string; error: string }[] }
        const { accepted, rejected } = await saveUploads(sid, uploads);

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
        const response: ApiUploadsResponse = { status, accepted, rejected }

        return res.status(http).json(response);
    } catch (err: any) {
        const response: ApiUploadsErrorFiles = { type: "upload_error", message: err?.message || 'Upload failed' };
        return res
            .status(500)
            .json(response);
    }
}
