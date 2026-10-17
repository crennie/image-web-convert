import path from 'node:path';
import fs from 'node:fs';
import archiver from 'archiver';
import type { Writable } from 'node:stream';
import { pathForStored } from './storage.paths';
import { ConversionStorageError } from './conversion-storage.service';
import {
    ApiUploadMeta,
    MIME_TO_EXT,
    OutputMimeType,
    UploadMetaSchema,
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
    metadataReader: (sid: string, id: string) => Promise<ApiUploadMeta | null>,
): Promise<ResolvedFilesResponse> {
    const found: ResolvedDownload[] = [];
    const missing: string[] = [];

    for (const id of ids) {
        const rawMeta = await metadataReader(sid, id);
        if (!rawMeta) {
            missing.push(id);
            continue;
        }
        const meta = parseFileMetadata(rawMeta, id);
        // Path must be absolute when sending in response
        const absPath = normalizeAbsolutePath(
            pathForStored(sid, meta.output.storedName),
        );
        try {
            const stat = fs.lstatSync(absPath);
            if (!stat.isFile())
                throw new ConversionStorageError('Invalid output file');
        } catch (error) {
            if (
                error &&
                typeof error === 'object' &&
                'code' in error &&
                error.code === 'ENOENT'
            ) {
                missing.push(id);
                continue;
            }
            if (error instanceof ConversionStorageError) throw error;
            throw new ConversionStorageError('Unable to inspect output', error);
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

function parseFileMetadata(value: unknown, fileId: string): ApiUploadMeta {
    const meta = UploadMetaSchema.parse(value);
    if (
        meta.id !== fileId ||
        meta.output.storedName !==
            `${fileId}.${MIME_TO_EXT[meta.output.mime][0]}`
    ) {
        throw new Error('File metadata association mismatch');
    }
    return meta;
}

export class ArchiveClientAbortError extends Error {
    constructor() {
        super('Archive download aborted by client');
        this.name = 'ArchiveClientAbortError';
    }
}

export class ArchiveLimitError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ArchiveLimitError';
    }
}

export const MAX_ACTIVE_ARCHIVES = 2;
export const ARCHIVE_TIMEOUT_MS = 30_000;
let activeArchives = 0;

export function acquireArchiveSlot(): (() => void) | null {
    if (activeArchives >= MAX_ACTIVE_ARCHIVES) return null;
    activeArchives++;
    let released = false;
    return () => {
        if (released) return;
        released = true;
        activeArchives--;
    };
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
        const deadline = setTimeout(
            () => fail(new ArchiveLimitError('Archive stream timed out')),
            ARCHIVE_TIMEOUT_MS,
        );
        deadline.unref();
        const cleanup = () => {
            clearTimeout(deadline);
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
    const safeBase = sanitizeFilename(base, 'image', 100);
    const extension = MIME_TO_EXT[meta.output.mime]?.[0];
    return `${safeBase}.${extension}`;
}

function buildContentDisposition(filename: string): string {
    const safe = sanitizeFilename(filename, 'download');
    const ascii = safe.replace(/[^\x20-\x7e]/g, '_');
    const encoded = encodeURIComponent(safe).replace(
        /[!'()*]/g,
        (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function sanitizeFilename(
    input: string,
    fallback: string,
    maxLength = 120,
): string {
    const cleaned = Array.from(input)
        .map((character) => {
            const codePoint = character.codePointAt(0) ?? 0;
            return codePoint < 32 ||
                codePoint === 127 ||
                (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
                /\p{Cf}/u.test(character) ||
                /[/\\?%*:|"<>]/.test(character)
                ? '_'
                : character;
        })
        .join('')
        .replace(/^\.+|[. ]+$/g, '');
    const bounded = Array.from(cleaned)
        .slice(0, maxLength)
        .join('')
        .replace(/[. ]+$/g, '');
    return bounded || fallback;
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
    const safe = sanitizeFilename(raw, 'images', 112);
    return safe.toLowerCase().endsWith('.zip') ? safe : `${safe}.zip`;
}
