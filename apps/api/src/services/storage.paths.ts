import path from 'node:path';
import { normalizeAbsolutePath } from '@image-web-convert/node-shared';

const DEFAULT_UPLOAD_DIR = path.resolve(process.cwd(), 'data', 'uploads');

export const UPLOAD_DIR = normalizeAbsolutePath(
    process.env.UPLOAD_DIR || DEFAULT_UPLOAD_DIR,
);

export function sessionDir(sid: string): string {
    return path.join(UPLOAD_DIR, sid);
}

export function sessionInfoPath(sid: string): string {
    return path.join(sessionDir(sid), 'session.info.json');
}

export function sessionMetaPath(sid: string, fileId: string): string {
    return path.join(sessionDir(sid), `${fileId}.json`);
}

export function pathForStored(sid: string, storedName: string): string {
    return path.join(sessionDir(sid), storedName);
}
