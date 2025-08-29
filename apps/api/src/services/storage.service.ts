import path from 'node:path';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import crypto from 'node:crypto';
import type { UploadedFile } from 'express-fileupload';
import { processImageToWebp } from './image.service';

// ---------- Config (monorepo-root defaults; docker-friendly overrides) ----------
// TODO: ADD DOCKER LOGIC
const isProd = process.env.NODE_ENV === 'production';

const DEFAULT_UPLOAD_DIR = path.resolve(process.cwd(), 'data', 'uploads');
export const UPLOAD_DIR = normalizeAbsolutePath(process.env.UPLOAD_DIR || DEFAULT_UPLOAD_DIR);

// Ensure upload dir exists at module load
if (!fssync.existsSync(UPLOAD_DIR)) {
    fssync.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// ---------- Types ----------
export type UploadMeta = {
    id: string;

    // Original (pre-processed) file info
    original: {
        name: string;
        mime?: string;
        sizeBytes?: number;
        width?: number;
        height?: number;
        pages?: number;
    };

    // Processed (stored) file info
    output: {
        storedName: string;        // `${id}.webp`
        mime: 'image/webp';
        sizeBytes: number;
        width: number;
        height: number;
        hasAlpha: boolean;
        colorSpace: 'srgb';
    };

    exifStripped: true;
    animated: boolean;           // Phase 1: false
    uploadedAt: string;
};

export type SaveResult = {
    id: string;
    url: string;                 // e.g. `/files/:id`
    metaUrl: string;             // e.g. `/files/:id/meta`
    meta: UploadMeta;
};
// export type UploadMeta2 = {
//     id: string;
//     originalName: string;
//     storedName: string; // `${id}${ext}`
//     mimeType: string;
//     size: number;
//     uploadedAt: string;
// };

// export type SaveResult2 = {
//     id: string;
//     originalName: string;
//     storedName: string;
//     mimeType: string;
//     size: number;
//     uploadedAt: string;
//     url: string;     // e.g. `/files/:id`
//     metaUrl: string; // e.g. `/files/:id/meta`
// };


// ---------- Public API ----------
// Ensure we have a temp file path (express-fileupload with useTempFiles: true)
export async function saveUploadFile(uf: UploadedFile): Promise<SaveResult> {
    const tempPath = uf.tempFilePath;

    // If not using temp files, write the buffer to a tmp file just for processing
    let cleanupScratch = false;
    let inputPath = tempPath;
    if (!inputPath) {
        const scratch = path.join(UPLOAD_DIR, `.scratch-${uuid()}`);
        await fs.writeFile(scratch, uf.data);
        inputPath = scratch;
        cleanupScratch = true;
    }

    const originalName = sanitizeBaseName(uf.name || 'upload');

    // 1) Process to WebP (PII-stripped, sRGB, optional resize)
    const processed = await processImageToWebp({
        inputPath,
        // options: {} // use defaults for Phase 1
    });

    // 2) Persist result under a UUID name
    const id = uuid();
    const storedName = `${id}.webp`;
    const destPath = path.join(UPLOAD_DIR, storedName);
    await fs.writeFile(destPath, processed.buffer);

    // 3) Build and write sidecar metadata
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

    await writeMeta(meta);

    // 4) Delete the original temp/scratch file on success (Phase 1 policy)
    if (tempPath) await deleteTempFile(tempPath);
    if (cleanupScratch) await deleteTempFile(inputPath);

    return {
        id,
        url: `/files/${id}`,
        metaUrl: `/files/${id}/meta`,
        meta,
    };
}
// export async function saveUploadFile2(uf: UploadedFile): Promise<SaveResult> {
//     const originalName = sanitizeBaseName(uf.name || 'upload');
//     const id = uuid();

//     // Ensure unique stored filename (paranoid collision guard)
//     const ext = extOf(originalName);
//     let storedName = `${id}${ext}`;
//     let destPath = path.join(UPLOAD_DIR, storedName);
//     // If extremely unlucky collision, regenerate id
//     while (fssync.existsSync(destPath)) {
//         const newId = uuid();
//         storedName = `${newId}${ext}`;
//         destPath = path.join(UPLOAD_DIR, storedName);
//     }

//     await moveUploadedFile(uf, destPath);

//     const meta: UploadMeta = {
//         id,
//         originalName,
//         storedName,
//         mimeType: uf.mimetype || 'application/octet-stream',
//         size: uf.size,
//         uploadedAt: new Date().toISOString(),
//     };

//     await writeMeta(meta);

//     return {
//         ...meta,
//         url: `/files/${id}`,
//         metaUrl: `/files/${id}/meta`,
//     };
// }

// ---------- Helpers ----------

/**
 * Utility to delete the original temp file after successful processing.
 * Remove only on success
 */
export async function deleteTempFile(path: string): Promise<void> {
    try {
        await fs.unlink(path);
    } catch {
        // swallow (temp file may already be gone)
        // TODO: Log in this case etc?
    }
}

async function writeMeta(meta: UploadMeta): Promise<void> {
    const metaPath = path.join(UPLOAD_DIR, `${meta.id}.json`);
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');
}

export async function readMeta(id: string): Promise<UploadMeta | null> {
    const metaPath = path.join(UPLOAD_DIR, `${id}.json`);
    try {
        const txt = await fs.readFile(metaPath, 'utf8');
        return JSON.parse(txt) as UploadMeta;
    } catch {
        return null;
    }
}

function uuid(): string {
    return 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function extOf(name: string): string {
    const ext = path.extname(name || '');
    if (!ext || ext.length > 16) return '';
    return ext.toLowerCase();
}

function sanitizeBaseName(name: string): string {
    return path.basename(name).replace(/[/\\?%*:|"<>]/g, '_');
}

async function moveUploadedFile(uf: UploadedFile, destPath: string): Promise<void> {
    // Promise wrapper to support all express-fileupload versions
    await new Promise<void>((resolve, reject) => {
        uf.mv(destPath, (err) => (err ? reject(err) : resolve()));
    });
}

export function normalizeAbsolutePath(envVal: string): string {
    return path.isAbsolute(envVal) ? envVal : path.resolve(process.cwd(), envVal);
}

export function pathForStored(id: string, storedName: string): string {
    return path.join(UPLOAD_DIR, storedName);
}

