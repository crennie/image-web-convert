import type { NextFunction, Request, Response } from 'express';
import { readMeta, } from '../services/storage.service';
import { resolveFilesByIds, streamZip } from '../services/files.service';
import { validateRequestWithToken } from '../services/auth.service';
import { ApiUploadsErrorSessionUsed } from '@image-web-convert/schemas';

// GET /sessions/:sid/files/:fileId  -> download/stream processed image (WebP)
export async function show(req: Request, res: Response) {
    const { sid, fileId } = req.params;
    const validateResponse = await validateRequestWithToken(req, res);
    if (validateResponse.valid === false) {
        return res.status(validateResponse.status).json(validateResponse.apiError);
    } else {
        // Extra 409 sealed check for downloads
        if (!validateResponse.info.sealedAt) {
            // TODO: Update error message?
            const response: ApiUploadsErrorSessionUsed = { type: "session_used", message: "" };
            return res.status(409).json(response);
        }
    }

    const { found, missing } = await resolveFilesByIds(sid, [fileId]);
    if (found.length === 0) {
        return res.status(404).json({ status: 'error', message: `Requested file not found: "${missing?.[0] ?? ''}` });
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
        return res.status(validateResponse.status).json(validateResponse.apiError);
    } else {
        // Extra 409 sealed check for downloads
        if (!validateResponse.info.sealedAt) {
            // TODO: Update error message?
            const response: ApiUploadsErrorSessionUsed = { type: "session_used", message: "" };
            return res.status(409).json(response);
        }
    }

    const m = await readMeta(sid, fileId);
    if (!m) return res.status(404).json({ status: 'error', message: 'Not found' });
    return res.json(m);
}

// POST /sessions/:sid/files/download
export async function downloadMany(req: Request, res: Response, next: NextFunction) {
    const { sid } = req.params;
    const validateResponse = await validateRequestWithToken(req, res);
    if (validateResponse.valid === false) {
        return res.status(validateResponse.status).json(validateResponse.apiError);
    } else {
        // Extra 409 sealed check for downloads
        if (!validateResponse.info.sealedAt) {
            // TODO: Update error message?
            const response: ApiUploadsErrorSessionUsed = { type: "session_used", message: "" };
            return res.status(409).json(response);
        }
    }

    const ids: unknown = req.body?.ids;
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every((v) => typeof v === 'string')) {
        res.status(400).json({ status: 'error', message: 'Body must include { ids: string[] }' });
        return
    }

    const { found, missing } = await resolveFilesByIds(sid, ids);
    if (found.length === 0) {
        res.status(404).json({ status: 'error', message: 'None of the requested files were found', missing });
        return;
    }

    if (missing.length) {
        res.setHeader('X-Missing-Ids', missing.join(','));
    }

    const zipName = req.body?.archiveName as string | undefined;
    try {
        await streamZip(res, found, zipName || 'images.zip');
    } catch (err) {
        next(err)
    }
    return Promise<void>;
}
