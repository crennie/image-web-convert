import fs from 'node:fs/promises';
import type { UploadMeta } from '@image-web-convert/schemas';
import { sessionMetaPath } from './storage.paths';

// Sealed sessions created by the retired upload route still serve their metadata.
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
