import path from 'node:path';
import fs from 'node:fs';
import archiver from 'archiver';
import type { Response } from 'express';
import { readMeta, pathForStored, normalizeAbsolutePath, UploadMeta } from './storage.service';

export type ResolvedDownload = {
    id: string;
    absPath: string;             // absolute FS path to the processed asset
    downloadName: string;        // suggested filename for single downloads (e.g., "<originalBase>.webp")
    archiveName: string;         // filename to use inside a ZIP (unique, order-preserving)
    contentType: string;         // e.g., 'image/webp'
    contentDisposition: string;  // precomputed header for single downloads
    meta: UploadMeta;            // sidecar metadata (not added to ZIP per requirements)
};

export async function resolveFilesByIds(ids: string[]): Promise<{ found: ResolvedDownload[]; missing: string[] }> {
    const found: ResolvedDownload[] = [];
    const missing: string[] = [];

    for (const id of ids) {
        const meta = await readMeta(id);
        if (!meta) {
            missing.push(id);
            continue;
        }
        const absPath = normalizeAbsolutePath(pathForStored(id, meta.output.storedName));
        if (!fs.existsSync(absPath)) {
            missing.push(id);
            continue;
        }

        const downloadName = buildDownloadName(meta);
        const contentDisposition = buildContentDisposition(downloadName);

        found.push({
            id,
            absPath,
            downloadName,
            archiveName: downloadName, // uniquified below to avoid duplicates
            contentType: meta.output.mime,
            contentDisposition,
            meta,
        });
    }

    // Ensure unique archiveName values while preserving input order
    uniquifyArchiveNames(found);

    return { found, missing };
}

export async function streamZip(
    res: Response,
    entries: ResolvedDownload[],
    zipName: string
): Promise<void> {
    const finalZip = sanitizeZipName(zipName);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
        'Content-Disposition',
        buildContentDisposition(finalZip)
    );

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => {
        // Bubble up to the catch in controller
        throw err;
    });

    // If client aborts the request, stop archiving
    res.on('aborted', () => archive.destroy());

    archive.pipe(res);

    // Add files in the same order as the incoming ids
    for (const e of entries) {
        archive.file(e.absPath, { name: e.archiveName });
        // Intentionally NOT adding per-file JSON or a manifest (per requirements)
    }

    await archive.finalize();
}

/* ----------------------------- helpers ----------------------------- */
function buildDownloadName(meta: UploadMeta): string {
    const base = path.parse(meta.original.name).name || meta.id;
    const safeBase = base.replace(/[/\\?%*:|"<>]/g, '_');
    return `${safeBase}.webp`;
}

function buildContentDisposition(filename: string): string {
    const fallback = filename.replace(/[/\\?%*:|"<>]/g, '_');
    return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fallback)}`;
}

function uniquifyArchiveNames(entries: { archiveName: string }[]) {
    const seen = new Map<string, number>();
    for (const e of entries) {
        const name = e.archiveName;
        const n = (seen.get(name) ?? 0) + 1;
        seen.set(name, n);
        if (n > 1) {
            const ext = path.extname(name);
            const base = name.slice(0, -ext.length);
            e.archiveName = `${base} (${n})${ext}`;
        }
    }
}

function sanitizeZipName(input?: string): string {
    const raw = (input && input.trim()) || 'images.zip';
    const safe = raw.replace(/[/\\?%*:|"<>]/g, '_');
    return safe.toLowerCase().endsWith('.zip') ? safe : `${safe}.zip`;
}