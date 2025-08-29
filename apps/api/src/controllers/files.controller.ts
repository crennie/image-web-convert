import type { NextFunction, Request, Response } from 'express';
import { readMeta, } from '../services/storage.service';
import { resolveFilesByIds, streamZip } from '../services/files.service';

// function dispositionForDownload(originalName: string): string {
//     // RFC 5987 filename* for UTF-8 + ASCII fallback
//     const fallback = originalName.replace(/[/\\?%*:|"<>]/g, '_') || 'download';
//     return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(originalName)}`;
// }
// function dispositionForDownload(originalName: string): string {
//     const base = path.parse(originalName).name || 'download';
//     const fallback = `${base}.webp`.replace(/[/\\?%*:|"<>]/g, '_');
//     return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(`${base}.webp`)}`;
// }

// GET /files/:id  -> download/stream processed image (WebP)
export async function show(req: Request, res: Response) {
    const { id } = req.params;

    const { found, missing } = await resolveFilesByIds([id]);
    if (found.length === 0) {
        return res.status(404).json({ status: 'error', message: `Requested file not found: "${missing?.[0] ?? ''}` });
    }
    const file = found[0];

    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', file.contentDisposition);
    return res.sendFile(file.absPath);
}

// GET /files/:id/meta  -> metadata JSON (includes original + output info)
export async function meta(req: Request, res: Response) {
    const m = await readMeta(req.params.id);
    if (!m) return res.status(404).json({ status: 'error', message: 'Not found' });
    return res.json(m);
}

// POST /files/download
export async function downloadMany(req: Request, res: Response, next: NextFunction) {
    const ids: unknown = req.body?.ids;
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every((v) => typeof v === 'string')) {
        res.status(400).json({ status: 'error', message: 'Body must include { ids: string[] }' });
        return
    }

    const { found, missing } = await resolveFilesByIds(ids);
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

// // GET /files/:id -> stream/download with original filename
// export async function show2(req: Request, res: Response) {
//     const { id } = req.params;
//     const meta = await readMeta(id);
//     if (!meta) {
//         return res.status(404).json({ status: 'error', message: 'Not found' });
//     }

//     const absPath = normalizeAbsolutePath(pathForStored(id, meta.storedName));
//     if (!fs.existsSync(absPath)) {
//         return res.status(404).json({ status: 'error', message: 'File missing' });
//     }

//     res.setHeader('Content-Type', meta.mimeType || 'application/octet-stream');
//     res.setHeader('Content-Disposition', dispositionForDownload(meta.originalName));
//     res.setHeader('Content-Length', String(meta.size));

//     return res.sendFile(absPath, (err) => {
//         if (err) {
//             // Avoid "headers already sent" issues: only attempt JSON if not started
//             if (!res.headersSent) {
//                 res.status(500).json({ status: 'error', message: 'Failed to send file' });
//             }
//         }
//     });
// }

// // GET /files/:id/meta -> metadata JSON
// export async function meta2(req: Request, res: Response) {
//     const { id } = req.params;
//     const m = await readMeta(id);
//     if (!m) {
//         return res.status(404).json({ status: 'error', message: 'Not found' });
//     }
//     return res.json(m);
// }
