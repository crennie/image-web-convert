import path from 'node:path';
import fs from 'node:fs/promises';
import type { UploadedFile } from 'express-fileupload';
import { processImageToMimeType } from './image.service';
import { secureId } from '@image-web-convert/node-shared';
import {
    ApiUploadAccepted,
    MIME_TO_EXT,
    OutputMimeType,
    UploadMeta,
} from '@image-web-convert/schemas';
import { pathForStored, sessionMetaPath } from './storage.paths';

export async function saveUploadFile(
    sid: string,
    outputMime: OutputMimeType,
    uf: UploadedFile,
    clientId = '',
): Promise<ApiUploadAccepted> {
    const inputPath = uf.tempFilePath;
    if (!inputPath) {
        throw new Error('Upload is missing a temporary file path');
    }

    const originalName = sanitizeBaseName(uf.name || 'upload');
    let storedPath: string | undefined;
    let metaPath: string | undefined;

    try {
        const processed = await processImageToMimeType({
            inputPath,
            outputMime,
        });

        const id = secureId();
        const extension = MIME_TO_EXT[outputMime]?.[0];
        const storedName = `${id}.${extension}`;
        storedPath = pathForStored(sid, storedName);
        metaPath = sessionMetaPath(sid, id);
        await fs.writeFile(storedPath, processed.buffer);

        const meta: UploadMeta = {
            id,
            original: {
                name: originalName,
                mime: processed.inputMeta.mime,
                sizeBytes: uf.size,
                width: processed.inputMeta.width,
                height: processed.inputMeta.height,
                pages: processed.inputMeta.pages,
            },
            output: {
                storedName,
                mime: processed.outputMime,
                sizeBytes: processed.info.sizeBytes,
                width: processed.info.width,
                height: processed.info.height,
                hasAlpha: processed.inputMeta.hasAlpha ?? false,
                colorSpace: processed.info.colorSpace,
            },
            exifStripped: processed.info.exifStripped,
            animated: processed.info.animated,
            uploadedAt: new Date().toISOString(),
        };

        await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');

        return {
            id,
            url: `/sessions/${sid}/files/${id}`,
            metaUrl: `/sessions/${sid}/files/${id}/meta`,
            meta,
            clientId,
        };
    } catch (error) {
        await Promise.all([
            deleteFileIfPresent(storedPath),
            deleteFileIfPresent(metaPath),
        ]);
        throw error;
    } finally {
        await deleteFileIfPresent(inputPath);
    }
}

// ---------- Helpers ----------
// function sanitizeBaseName(name: string): string {
//     return path.basename(name).replace(/[/\\?%*:|"<>]/g, '_');
// }
// storage.service.ts
function sanitizeBaseName(name: string): string {
    // 1) Attempt to repair mojibake like "â¯" → U+202F
    const repaired = tryFixLatin1Utf8(name);

    // 2) Unicode normalize; convert NBSPs to regular space
    const normalized = repaired.normalize('NFC').replace(/\u00A0|\u202F/g, ' '); // NBSP & NARROW NBSP → space

    // 3) Take just the base segment
    const base = path.basename(normalized);

    // 4) Remove control chars; replace illegal path chars with underscore
    const noControls = base.replace(/\p{C}/gu, '');
    const safe = noControls.replace(/[/\\?%*:|"<>]/g, '_');

    // 5) Collapse whitespace and trim
    return safe.replace(/\s+/g, ' ').trim();
}

function tryFixLatin1Utf8(s: string): string {
    // Heuristic: if the string *looks* like Latin-1 bytes of a UTF-8 string,
    // decoding those bytes as UTF-8 yields a stable round-trip.
    try {
        const maybe = Buffer.from(s, 'latin1').toString('utf8');
        // Only accept if round-trip back to latin1 yields the original bytes
        if (Buffer.from(maybe, 'utf8').toString('latin1') === s) {
            return maybe;
        }
    } catch {
        // ignore
    }
    return s;
}

async function deleteFileIfPresent(filePath?: string): Promise<void> {
    if (!filePath) return;
    try {
        await fs.unlink(filePath);
    } catch {
        // The target may already have been removed.
    }
}

// ---------- External Helpers ----------

export async function readMeta(
    sid: string,
    fileId: string,
): Promise<UploadMeta | null> {
    const metaPath = sessionMetaPath(sid, fileId);
    try {
        const txt = await fs.readFile(metaPath, 'utf8');
        return JSON.parse(txt) as UploadMeta;
    } catch {
        return null;
    }
}
