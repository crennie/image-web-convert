'use client';

import { useCallback, useEffect, useRef, useState } from "react";
import useValidation, { ValidateFilesRejected } from "./useValidation";
import { FileItem } from "../../files/FileListItem";
import { FileUploadConfig } from "../file-upload.config";

function rejectedErrorMsg(rejectedItem: ValidateFilesRejected) {
    return `${rejectedItem.file.name} - ${rejectedItem.reason}`;
}

interface UseFileItemsProps {
    config?: FileUploadConfig;
}

export function useFileItems({ config }: UseFileItemsProps) {
    const [items, setItems] = useState<FileItem[]>([]);
    const [errors, setErrors] = useState<string[]>([]);
    const { validateFiles } = useValidation();
    // Keep a ref-based registry of previews to allow cleanup
    const imagePreviewMapRef = useRef(new Map());

    const addErrors = useCallback((newErrors: string[]) => {
        if (newErrors.length) setErrors(prev => [...prev, ...newErrors]);
    }, []);

    const clearErrors = useCallback(() => setErrors([]), []);

    const addItems = useCallback((incoming: File[]) => {
        const { accepted, rejected } = validateFiles({ incoming, existing: items, config });
        if (accepted.length) {
            for (const item of accepted) imagePreviewMapRef.current.set(item.id, item.previewUrl);
            setItems(prev => [...prev, ...accepted]);
        }
        if (rejected.length) addErrors(rejected.map(rejectedErrorMsg));
    }, [items, validateFiles, config, addErrors]);

    // Delete one file preview, or all
    const disposeFilePreviews = useCallback((id?: string) => {
        if (id) {
            if (imagePreviewMapRef.current.has(id)) {
                URL.revokeObjectURL(imagePreviewMapRef.current.get(id))
                imagePreviewMapRef.current.delete(id);
            }
        } else {
            for (const [id, url] of [...imagePreviewMapRef.current]) {
                if (url) URL.revokeObjectURL(url);
                imagePreviewMapRef.current.delete(id);
            }
        }
    }, []);

    const removeItem = useCallback((item: FileItem) => {
        disposeFilePreviews(item.id);
        setItems(prev => prev.filter(item_ => item_.id !== item.id));
    }, [disposeFilePreviews]);

    const clearFiles = useCallback(() => {
        disposeFilePreviews();
        setItems([]);
    }, [disposeFilePreviews]);

    // Clear all files on hook unmount, ensures that URLs are revoked on page nav etc
    useEffect(() => {
        return () => {
            disposeFilePreviews();
        }
    }, [disposeFilePreviews]);

    return {
        items,
        addItems,
        removeItem,
        clearFiles,
        errors,
        addErrors,
        clearErrors,
    }
}

export default useFileItems;
