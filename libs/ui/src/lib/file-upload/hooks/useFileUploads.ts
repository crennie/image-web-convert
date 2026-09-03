'use client';

import { useCallback, useState } from 'react';
import {
    ApiErrorSchema,
    ApiUploadAccepted,
    ApiUploadRejected,
    ApiUploadsResponseSchema,
} from '@image-web-convert/schemas';
import { Session } from '../../session/SessionContext';
import { getAuthHeaders } from '../../utils';
const VITE_API_URL = import.meta.env.VITE_API_URL;

interface CustomErrorFields {
    statusCode?: number;
    details?: Record<string, unknown>; // For more complex error details
}

export class UploadFilesError extends Error {
    statusCode?: number;
    details?: Record<string, unknown>;

    constructor(message: string, fields?: CustomErrorFields) {
        super(message); // Call the parent Error constructor
        // backwards-compatible explicit proto setting, for "instanceof" in legacy envs
        Object.setPrototypeOf(this, UploadFilesError.prototype);

        this.name = 'UploadFilesError'; // Set a custom name for the error
        // Assign the extra fields if provided
        if (fields) {
            this.statusCode = fields.statusCode;
            this.details = fields.details;
        }
    }
}

export function useFileUploads() {
    const [uploadedFiles, setUploadedFiles] = useState<ApiUploadAccepted[]>([]);
    const [rejectedFiles, setRejectedFiles] = useState<ApiUploadRejected[]>([]);
    const uploadFilesForm = useCallback(
        async (formData: FormData, session: Session) => {
            if (!session) {
                // TODO: Handle error
                throw Error('No session found');
            }

            try {
                const response = await fetch(
                    `${VITE_API_URL}/sessions/${session.sessionId}/uploads`,
                    {
                        method: 'POST',
                        headers: getAuthHeaders(session),
                        body: formData,
                    },
                );
                if (response.ok) {
                    const result = ApiUploadsResponseSchema.parse(
                        await response.json(),
                    );
                    setUploadedFiles(result.accepted);
                    setRejectedFiles(result.rejected);
                    return result;
                } else {
                    const body = await response.json().catch(() => undefined);
                    const apiError = ApiErrorSchema.safeParse(body);
                    throw new UploadFilesError(
                        apiError.success && apiError.data.message
                            ? apiError.data.message
                            : `Upload failed: ${response.statusText}`,
                        {
                            statusCode: response.status,
                            details: apiError.success
                                ? apiError.data
                                : undefined,
                        },
                    );
                }
            } catch (error) {
                if (error instanceof UploadFilesError) throw error;
                throw new UploadFilesError(`Upload failed: ${error}`);
            }
        },
        [],
    );

    return {
        uploadedFiles,
        uploadFilesForm,
        rejectedFiles,
    };
}

export default useFileUploads;
