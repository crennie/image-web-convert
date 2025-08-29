import type { UploadedFile } from 'express-fileupload';
import { SaveResult, saveUploadFile } from './storage.service';

export type SaveAccepted = SaveResult;

export type SaveRejected = {
    fileName: string;
    error: string;
};

export async function saveUploads(
    uploads: UploadedFile[]
): Promise<{ accepted: SaveAccepted[]; rejected: SaveRejected[] }> {
    const promises = uploads.map((uf) => saveUploadFile(uf));
    const settled = await Promise.allSettled(promises);

    const accepted: SaveAccepted[] = [];
    const rejected: SaveRejected[] = [];

    settled.forEach((result, i) => {
        if (result.status === 'fulfilled') {
            accepted.push(result.value);
        } else {
            rejected.push({
                fileName: uploads[i]?.name ?? '(unknown)',
                error: result.reason instanceof Error ? result.reason.message : String(result.reason),
            });
        }
    });

    return { accepted, rejected };
}
