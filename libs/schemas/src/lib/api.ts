
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

export type ApiUploadMeta = UploadMeta;

export type ApiUploadAccepted = {
    id: string;
    url: string;                 // e.g. `/files/:id`
    metaUrl: string;             // e.g. `/files/:id/meta`
    meta: ApiUploadMeta;
}

export type ApiUploadRejected = {
    fileName: string;
    error: string;
}

export type ApiUploadsResponse = {
    status: 'ok' | 'partial';
    accepted: ApiUploadAccepted[];
    rejected: ApiUploadRejected[];
}

export type ApiErrorToken = {
    type: "invalid_token";
    message?: string;
}

export type ApiErrorSessionNotFound = {
    type: "session_not_found";
    message?: string;
}

export type ApiErrorSessionExpired = {
    type: "session_expired";
    message?: string;
}

export type ApiUploadsErrorSessionUsed = {
    type: "session_used";
    message?: string;
}

export type ApiUploadsErrorMissingFiles = {
    type: "missing_files";
    message?: string;
}

export type ApiUploadsErrorFiles = {
    type: "upload_error";
    message?: string;
}

export type ApiError = 
    | ApiErrorToken
    | ApiErrorSessionNotFound
    | ApiErrorSessionExpired
    | ApiUploadsErrorSessionUsed
    | ApiUploadsErrorMissingFiles
    | ApiUploadsErrorFiles;
