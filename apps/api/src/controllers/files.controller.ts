import type { NextFunction, Request, Response } from 'express';
import { readMeta } from '../services/storage.service';
import {
    ArchiveClientAbortError,
    archiveDownloadHeaders,
    resolveFilesByIds,
    writeZip,
} from '../services/files.service';
import { validateRequestWithToken } from '../services/auth.service';
import {
    ApiDownloadFilesRequestSchema,
    ApiErrorFileNotFound,
    ApiErrorInvalidRequest,
    ApiErrorSessionNotReady,
} from '@image-web-convert/schemas';

// GET /sessions/:sid/files/:fileId  -> download/stream processed image (WebP)
export async function show(req: Request, res: Response) {
    const { sid, fileId } = req.params;
    const validateResponse = await validateRequestWithToken(req, res);
    if (validateResponse.valid === false) {
        return res
            .status(validateResponse.status)
            .json(validateResponse.apiError);
    } else {
        // Extra 409 sealed check for downloads
        if (!validateResponse.info.sealedAt) {
            // TODO: Update error message?
            const response: ApiErrorSessionNotReady = {
                type: 'session_not_ready',
                message: '',
            };
            return res.status(409).json(response);
        }
    }

    const { found, missing } = await resolveFilesByIds(sid, [fileId]);
    if (found.length === 0) {
        const response: ApiErrorFileNotFound = {
            type: 'file_not_found',
            message: `Requested file not found: "${missing?.[0] ?? ''}"`,
        };
        return res.status(404).json(response);
    }
    const file = found[0];

    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', file.contentDisposition);
    return res.sendFile(file.absPath);
}

// GET /sessions/:sid/files/:fileId/meta  -> metadata JSON (includes original + output info)
export async function meta(req: Request, res: Response) {
    const { sid, fileId } = req.params;
    const validateResponse = await validateRequestWithToken(req, res);
    if (validateResponse.valid === false) {
        return res
            .status(validateResponse.status)
            .json(validateResponse.apiError);
    } else {
        // Extra 409 sealed check for downloads
        if (!validateResponse.info.sealedAt) {
            // TODO: Update error message?
            const response: ApiErrorSessionNotReady = {
                type: 'session_not_ready',
                message: '',
            };
            return res.status(409).json(response);
        }
    }

    const m = await readMeta(sid, fileId);
    if (!m) {
        const response: ApiErrorFileNotFound = {
            type: 'file_not_found',
            message: 'Not found',
        };
        return res.status(404).json(response);
    }
    return res.json(m);
}

// POST /sessions/:sid/files/download
export async function downloadMany(
    req: Request,
    res: Response,
    next: NextFunction,
) {
    try {
        const { sid } = req.params;
        const validateResponse = await validateRequestWithToken(req, res);
        if (validateResponse.valid === false) {
            return res
                .status(validateResponse.status)
                .json(validateResponse.apiError);
        } else {
            // Extra 409 sealed check for downloads
            if (!validateResponse.info.sealedAt) {
                // TODO: Update error message?
                const response: ApiErrorSessionNotReady = {
                    type: 'session_not_ready',
                    message: '',
                };
                return res.status(409).json(response);
            }
        }

        const downloadRequest = ApiDownloadFilesRequestSchema.safeParse(
            req.body,
        );
        if (!downloadRequest.success) {
            const response: ApiErrorInvalidRequest = {
                type: 'invalid_request',
                message: 'Body must include { ids: string[] }',
            };
            res.status(400).json(response);
            return;
        }
        const { ids, archiveName } = downloadRequest.data;

        const { found, missing } = await resolveFilesByIds(sid, ids);
        if (found.length === 0) {
            const response: ApiErrorFileNotFound = {
                type: 'file_not_found',
                message: 'None of the requested files were found',
            };
            res.status(404).json(response);
            return;
        }

        if (missing.length) {
            res.setHeader('X-Missing-Ids', missing.join(','));
        }

        const headers = archiveDownloadHeaders(archiveName || 'images.zip');
        res.setHeader('Content-Type', headers.contentType);
        res.setHeader('Content-Disposition', headers.contentDisposition);
        await writeZip(res, found);
    } catch (err) {
        if (err instanceof ArchiveClientAbortError || res.destroyed) return;
        if (res.headersSent) res.destroy();
        else {
            res.removeHeader('Content-Disposition');
            res.removeHeader('Content-Type');
            next(err);
        }
    }
    return;
}
