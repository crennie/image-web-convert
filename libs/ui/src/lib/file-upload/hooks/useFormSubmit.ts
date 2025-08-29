'use client';

import { useCallback, useState } from "react";
import { FileUploadItem } from "../FileUpload";

export function useFormSubmit() {
    const [submittedFiles, setSubmittedFiles] = useState<any[]>([]);

    const submitFiles = useCallback(async (files: FileUploadItem[]) => {

        // TODO: Add extra validation logic here?
        const formData = new FormData();
        files.forEach(file => formData.append('uploads', file.file));

        try {
            const response = await fetch('http://localhost:3000/api/upload', {
                method: 'POST',
                body: formData,
            });

            if (response.ok) {
                const result = await response.json();
                console.log('Upload successful:', result);
                
                setSubmittedFiles(result.accepted);
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
        submittedFiles,
        submitFiles,
    }
}

export default useFormSubmit;
