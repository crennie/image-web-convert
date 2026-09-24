import path from 'node:path';
import { normalizeAbsolutePath } from '@image-web-convert/node-shared';
import {
    ConversionIdSchema,
    MIME_TO_EXT,
    type OutputMimeType,
} from '@image-web-convert/schemas';

const DEFAULT_UPLOAD_DIR = path.resolve(process.cwd(), 'data', 'uploads');

export const UPLOAD_DIR = normalizeAbsolutePath(
    process.env.UPLOAD_DIR || DEFAULT_UPLOAD_DIR,
);

export const UPLOAD_TMP_DIR = normalizeAbsolutePath(
    process.env.UPLOAD_TMP_DIR ?? path.resolve(process.cwd(), 'data', 'tmp'),
);

export function sessionDir(sid: string, root = UPLOAD_DIR): string {
    return path.join(root, sid);
}

export function sessionInfoPath(sid: string, root = UPLOAD_DIR): string {
    return path.join(sessionDir(sid, root), 'session.info.json');
}

export function sessionMetaPath(sid: string, fileId: string): string {
    return path.join(sessionDir(sid), `${fileId}.json`);
}

export function pathForStored(sid: string, storedName: string): string {
    return path.join(sessionDir(sid), storedName);
}

/** Paths for new operations only; keep legacy storage contracts unchanged. */
export function conversionStoragePaths(sid: string, root = UPLOAD_DIR) {
    ConversionIdSchema.parse(sid);
    const directory = path.resolve(root, sid);
    const inputs = path.join(directory, 'inputs');
    const staging = path.join(directory, '.conversion-staging');
    const receipts = path.join(directory, '.conversion-commits');
    const id = (fileId: string) => ConversionIdSchema.parse(fileId);
    return {
        directory,
        inputs,
        staging,
        receipts,
        info: path.join(directory, 'conversion.info.json'),
        input: (fileId: string) => path.join(inputs, id(fileId)),
        meta: (fileId: string) => path.join(directory, `${id(fileId)}.json`),
        output: (fileId: string, mime: OutputMimeType) =>
            path.join(directory, `${id(fileId)}.${MIME_TO_EXT[mime][0]}`),
        receipt: (fileId: string) => path.join(receipts, `${id(fileId)}.json`),
        staged: (stageId: string) => path.join(staging, id(stageId)),
    };
}
