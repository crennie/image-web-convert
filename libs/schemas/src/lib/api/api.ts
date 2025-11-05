import { OutputMimeType } from "../image.js";

export type ApiCreateSessionResponse = {
    sid: string;
    expiresAt: string;
    token: string;
}

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
        mime: OutputMimeType;
        sizeBytes: number;
        width: number;
        height: number;
        hasAlpha: boolean;
        colorSpace: 'srgb';
    };

    exifStripped: true;
    animated: boolean;
    uploadedAt: string;
};

export type ApiUploadMeta = UploadMeta;

export type ApiUploadAccepted = {
    id: string;
    url: string;                 // e.g. `/files/:id`
    metaUrl: string;             // e.g. `/files/:id/meta`
    meta: ApiUploadMeta;

    // Client session upload metadata
    clientId?: string;
}

export type ApiUploadRejected = {
    fileName: string;
    error: string;

    // Client session upload metadata
    clientId?: string;
}

export type ApiUploadsResponse = {
    status: 'ok' | 'partial';
    accepted: ApiUploadAccepted[];
    rejected: ApiUploadRejected[];
}
