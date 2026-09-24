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
    metadataReader: typeof readMeta = readMeta,
): Promise<ResolvedFilesResponse> {
    const found: ResolvedDownload[] = [];
    const missing: string[] = [];

    for (const id of ids) {
        const meta = await metadataReader(sid, id);
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
    // Parallel stat callbacks can otherwise enqueue entries out of input order.
    const archive = archiver('zip', { statConcurrency: 1, zlib: { level: 9 } });
    await new Promise<void>((resolve, reject) => {
        let settled = false;
        let outputFinished = false;
        let finalized = false;
        const cleanup = () => {
            output.off('finish', onFinish);
            output.off('close', onClose);
            output.off('error', fail);
            archive.off('error', fail);
            archive.off('warning', fail);
        };
        const complete = () => {
            if (settled || !outputFinished || !finalized) return;
            settled = true;
            cleanup();
            resolve();
        };
        const fail = (error: unknown) => {
            if (settled) return;
            settled = true;
            archive.unpipe(output);
            archive.abort();
            archive.destroy();
            cleanup();
            // The HTTP caller owns the response: it can still send an error
            // before headers, or destroy a partially sent response afterward.
            reject(error);
        };
        const onFinish = () => {
            outputFinished = true;
            complete();
        };
        const onClose = () => {
            if (!outputFinished) fail(new ArchiveClientAbortError());
        };
        output.once('finish', onFinish);
        output.once('close', onClose);
        output.once('error', fail);
        archive.once('error', fail);
        // A file disappearing after resolution must not silently yield a
        // successful ZIP with missing entries.
        archive.once('warning', fail);
        if (output.destroyed) {
            fail(new ArchiveClientAbortError());
            return;
        }
        try {
            archive.pipe(output);
            for (const entry of entries) {
                archive.file(entry.absPath, { name: entry.archiveName });
            }
            // Observe finalization immediately, but do not wait for it before
            // handling output errors/aborts (it may never settle after abort).
            void archive.finalize().then(() => {
                finalized = true;
                complete();
            }, fail);
        } catch (error) {
            fail(error);
        }
    });
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
    const used = new Set<string>();
    // Reserve original names so generated suffixes cannot steal a later name.
    const reserved = new Set(entries.map((entry) => entry.archiveName));
    const suffixes = new Map<string, number>();
    for (const entry of entries) {
        const name = entry.archiveName;
        if (used.has(name)) {
            const ext = path.extname(name);
            const base = name.slice(0, name.length - ext.length);
            let suffix = suffixes.get(name) ?? 2;
            let candidate: string;
            do {
                candidate = `${base} (${suffix++})${ext}`;
            } while (used.has(candidate) || reserved.has(candidate));
            suffixes.set(name, suffix);
            entry.archiveName = candidate;
        }
        used.add(entry.archiveName);
    }
}

function sanitizeZipName(input?: string): string {
    const raw = (input && input.trim()) || 'images.zip';
    const safe = raw.replace(/[/\\?%*:|"<>]/g, '_');
    return safe.toLowerCase().endsWith('.zip') ? safe : `${safe}.zip`;
}
