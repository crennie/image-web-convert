import path from 'node:path';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import type { UploadedFile } from 'express-fileupload';
import { processImageToWebp } from './image.service';
import { secureId } from '../utils';
import { ApiUploadAccepted, UploadMeta } from '@image-web-convert/schemas';
import { sessionDir } from './sessions.service';

// ---------- Config (monorepo-root defaults; docker-friendly overrides) ----------
// TODO: ADD DOCKER LOGIC
//const isProd = process.env.NODE_ENV === 'production';

const DEFAULT_UPLOAD_DIR = path.resolve(process.cwd(), 'data', 'uploads');
export const UPLOAD_DIR = normalizeAbsolutePath(process.env.UPLOAD_DIR || DEFAULT_UPLOAD_DIR);

// Ensure upload dir exists at module load
if (!fssync.existsSync(UPLOAD_DIR)) {
    fssync.mkdirSync(UPLOAD_DIR, { recursive: true });
}

export async function saveUploadFile(sid: string, uf: UploadedFile): Promise<ApiUploadAccepted> {

    // Ensure we have a temp file path (express-fileupload with useTempFiles: true)
    const inputPath = uf.tempFilePath;
    if (!inputPath) {
        // TODO: Throw an error
    }

    const originalName = sanitizeBaseName(uf.name || 'upload');

    // 1) Process to WebP (PII-stripped, sRGB, optional resize)
    const processed = await processImageToWebp({
        inputPath,
        // options: {} // use defaults for Phase 1
    });

    // 2) Create anonymous UUID for each stored file
    const id = secureId();
    const storedName = `${id}.webp`;
    await fs.writeFile(pathForStored(sid, storedName), processed.buffer);

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

    await writeMeta(sid, meta);

    // 4) Delete the original temp file on success
    if (inputPath) await deleteTempFile(inputPath);

    return {
        id,
        url: `/files/${id}`,
        metaUrl: `/files/${id}/meta`,
        meta,
    };
}

// ---------- Helpers ----------
function sanitizeBaseName(name: string): string {
    return path.basename(name).replace(/[/\\?%*:|"<>]/g, '_');
}

/**
 * Utility to delete the original temp file after successful processing.
 * Remove only on success
 */
async function deleteTempFile(path: string): Promise<void> {
    try {
        await fs.unlink(path);
    } catch {
        // swallow (temp file may already be gone)
        // TODO: Log in this case etc?
    }
}

async function writeMeta(sid: string, meta: UploadMeta): Promise<void> {
    const metaPath = path.join(sessionDir(sid), `${meta.id}.json`);
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');
}

// ---------- External Helpers ----------

export async function readMeta(sid: string, fileId: string): Promise<UploadMeta | null> {
    const metaPath = path.join(sessionDir(sid), `${fileId}.json`);
    try {
        const txt = await fs.readFile(metaPath, 'utf8');
        return JSON.parse(txt) as UploadMeta;
    } catch {
        return null;
    }
}

export function normalizeAbsolutePath(envVal: string): string {
    return path.isAbsolute(envVal) ? envVal : path.resolve(process.cwd(), envVal);
}

export function pathForStored(sid: string, storedName: string): string {
    return path.join(sessionDir(sid), storedName);
}
