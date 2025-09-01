'use client';

import { useCallback, useState } from "react";
import { ApiUploadAccepted, ApiUploadRejected, ApiUploadsResponse } from "@image-web-convert/schemas";
import { Session } from "../../session/SessionContext";
import { getAuthHeaders } from "../../utils";

export function useFileUploads() {
    const [uploadedFiles, setUploadedFiles] = useState<ApiUploadAccepted[]>([]);
    const [rejectedFiles, setRejectedFiles] = useState<ApiUploadRejected[]>([]);
    const uploadFilesForm = useCallback(async (formData: FormData, session: Session) => {
        if (!session) {
            // TODO: Handle error
            throw Error("No session found");
        }

        try {
            const response = await fetch(`http://localhost:3000/api/sessions/${session.sessionId}/uploads`, {
                method: 'POST',
                headers: getAuthHeaders(session),
                body: formData,
            });

            if (response.ok) {
                const result: ApiUploadsResponse = await response.json();
                console.log('Upload successful:', result);

                setUploadedFiles(result.accepted);
                setRejectedFiles(result.rejected);
                // TODO: Handle successful upload (e.g., clear selected files, display success message)
                return result;
            } else {
                console.error('Upload failed:', response.statusText);
                // TODO: // Handle upload failure
                return null;
            }
        } catch (error) {
            console.error('Error during upload:', error);
            // TODO: // Handle upload failure
            return null;
        }
    }, []);

    return {
        uploadedFiles,
        uploadFilesForm,
        rejectedFiles,
    }
}

export default useFileUploads;
