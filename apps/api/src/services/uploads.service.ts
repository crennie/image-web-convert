import type { UploadedFile } from 'express-fileupload';
import { saveUploadFile } from './storage.service';
import { ApiUploadAccepted, ApiUploadRejected } from '@image-web-convert/schemas';

interface SaveUploadsResponse {
    accepted: ApiUploadAccepted[];
    rejected: ApiUploadRejected[];
}

export async function saveUploads(sid: string, uploads: UploadedFile[]): Promise<SaveUploadsResponse> {
    const promises = uploads.map((uf) => saveUploadFile(sid, uf));
    const settled = await Promise.allSettled(promises);

    const accepted: ApiUploadAccepted[] = [];
    const rejected: ApiUploadRejected[] = [];

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
