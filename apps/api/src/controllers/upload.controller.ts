import type { Request, Response } from 'express';
import type { FileArray, UploadedFile } from 'express-fileupload';
import { saveUploads } from '../services/upload.service';

function toArray<T>(v: T | T[]): T[] {
    return Array.isArray(v) ? v : [v];
}

function extractUploaded(files: FileArray | undefined | null): UploadedFile[] {
    if (!files) return [];
    return Object.values(files).flatMap((v) => toArray(v as UploadedFile | UploadedFile[]));
}

// POST /upload
export async function create(req: Request, res: Response) {
    try {
        const uploads = extractUploaded(req.files as FileArray);
        if (uploads.length === 0) {
            return res.status(400).json({ status: 'error', message: 'No files uploaded' });
        }

        // Delegates to service layer (saves files, maps names -> UUIDs, writes metadata, etc.)
        // Expected shape: { accepted: any[]; rejected: { fileName: string; error: string }[] }
        const { accepted, rejected } = await saveUploads(uploads);

        const hasFailures = rejected && rejected.length > 0;
        const http = hasFailures ? 207 /* Multi-Status */ : 200;
        const status = hasFailures ? 'partial' : 'ok';

        return res.status(http).json({ status, accepted, rejected });
    } catch (err: any) {
        return res
            .status(500)
            .json({ status: 'error', message: err?.message || 'Upload failed' });
    }
}
