import type { UploadedFile } from 'express-fileupload';
import { saveUploadFile } from './storage.service';
import { ApiUploadAccepted, ApiUploadRejected, OutputMimeType } from '@image-web-convert/schemas';

interface SaveUploadsResponse {
    accepted: ApiUploadAccepted[];
    rejected: ApiUploadRejected[];
}

export async function saveUploads(sid: string, outputMime: OutputMimeType, uploads: UploadedFile[], clientIds: string[] = []):Promise<SaveUploadsResponse> {
    const promises = uploads.map((uf, idx) => saveUploadFile(sid, outputMime, uf, clientIds[idx]));
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
                clientId: clientIds[i],
            });
        }
    });

    return { accepted, rejected };
}
