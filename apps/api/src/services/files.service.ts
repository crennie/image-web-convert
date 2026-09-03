import path from 'node:path';
import fs from 'node:fs';
import archiver from 'archiver';
import type { Writable } from 'node:stream';
import { readMeta } from './storage.service';
import { pathForStored } from './storage.paths';
import {
    ApiUploadMeta,
    MIME_TO_EXT,
    OutputMimeType,
} from '@image-web-convert/schemas';
import { normalizeAbsolutePath } from '@image-web-convert/node-shared';

export type ResolvedDownload = {
    id: string;
    absPath: string; // absolute FS path to the processed asset
    downloadName: string; // suggested filename for single downloads (e.g., "<originalBase>.webp")
    archiveName: string; // filename to use inside a ZIP (unique, order-preserving)
    contentType: OutputMimeType; // e.g., 'image/webp'
    contentDisposition: string; // precomputed header for single downloads
    meta: ApiUploadMeta; // sidecar metadata (not added to ZIP per requirements)
};

interface ResolvedFilesResponse {
    found: ResolvedDownload[];
    missing: string[];
}

export async function resolveFilesByIds(
    sid: string,
    ids: string[],
): Promise<ResolvedFilesResponse> {
    const found: ResolvedDownload[] = [];
    const missing: string[] = [];

    for (const id of ids) {
        const meta = await readMeta(sid, id);
        if (!meta) {
            missing.push(id);
            continue;
        }
        // Path must be absolute when sending in response
        const absPath = normalizeAbsolutePath(
            pathForStored(sid, meta.output.storedName),
        );
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

export class ArchiveClientAbortError extends Error {
    constructor() {
        super('Archive download aborted by client');
        this.name = 'ArchiveClientAbortError';
    }
}

export function archiveDownloadHeaders(zipName: string) {
    const finalZip = sanitizeZipName(zipName);
    return {
        contentType: 'application/zip',
        contentDisposition: buildContentDisposition(finalZip),
    };
}

export async function writeZip(
    output: Writable,
    entries: ResolvedDownload[],
): Promise<void> {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const completed = new Promise<void>((resolve, reject) => {
        let finished = false;
        output.once('finish', () => {
            finished = true;
            resolve();
        });
        output.once('close', () => {
            if (!finished) {
                archive.destroy();
                reject(new ArchiveClientAbortError());
            }
        });
        output.once('error', reject);
        archive.once('error', reject);
    });

    archive.pipe(output);

    // Add files in the same order as the incoming ids
    for (const e of entries) {
        archive.file(e.absPath, { name: e.archiveName });
        // Intentionally NOT adding per-file JSON or a manifest (per requirements)
    }

    await archive.finalize();
    await completed;
}

/* ----------------------------- helpers ----------------------------- */
function buildDownloadName(meta: ApiUploadMeta): string {
    const base = path.parse(meta.original.name).name || meta.id;
    const safeBase = base.replace(/[/\\?%*:|"<>]/g, '_');
    const extension = MIME_TO_EXT[meta.output.mime]?.[0];
    return `${safeBase}.${extension}`;
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
