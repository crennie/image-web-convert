'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import useValidation, { ValidateFilesRejected } from './useValidation';
import { FileItem } from '../../files/FileItem';
import { FileUploadConfig } from '../file-upload.config';

function rejectedErrorMsg(rejectedItem: ValidateFilesRejected) {
    return `${rejectedItem.file.name} - ${rejectedItem.reason}`;
}

export interface SelectionError {
    id: string;
    message: string;
}

function errorEntries(messages: string[]): SelectionError[] {
    return messages.map((message) => ({ id: crypto.randomUUID(), message }));
}

interface UseFileItemsProps {
    config?: FileUploadConfig;
}

export function useFileItems({ config }: UseFileItemsProps) {
    const [items, setItems] = useState<FileItem[]>([]);
    const [errors, setErrors] = useState<SelectionError[]>([]);
    const { validateFiles } = useValidation();
    // Keep a ref-based registry of previews to allow cleanup
    const imagePreviewMapRef = useRef(new Map());

    const addErrors = useCallback((newErrors: string[]) => {
        if (newErrors.length)
            setErrors((prev) => [...prev, ...errorEntries(newErrors)]);
    }, []);

    const clearErrors = useCallback(() => setErrors([]), []);

    const addItems = useCallback(
        (incoming: File[]) => {
            if (!incoming.length) return;
            const { accepted, rejected } = validateFiles({
                incoming,
                existing: items,
                config,
            });
            if (accepted.length) {
                for (const item of accepted)
                    imagePreviewMapRef.current.set(item.id, item.previewUrl);
                setItems((prev) => [...prev, ...accepted]);
            }
            setErrors(errorEntries(rejected.map(rejectedErrorMsg)));
        },
        [items, validateFiles, config],
    );

    // Delete one file preview, or all
    const disposeFilePreviews = useCallback((id?: string) => {
        if (id) {
            if (imagePreviewMapRef.current.has(id)) {
                URL.revokeObjectURL(imagePreviewMapRef.current.get(id));
                imagePreviewMapRef.current.delete(id);
            }
        } else {
            for (const [id, url] of [...imagePreviewMapRef.current]) {
                if (url) URL.revokeObjectURL(url);
                imagePreviewMapRef.current.delete(id);
            }
        }
    }, []);

    const removeItem = useCallback(
        (item: FileItem) => {
            setErrors([]);
            disposeFilePreviews(item.id);
            setItems((prev) => prev.filter((item_) => item_.id !== item.id));
        },
        [disposeFilePreviews],
    );

    const clearFiles = useCallback(() => {
        setErrors([]);
        disposeFilePreviews();
        setItems([]);
    }, [disposeFilePreviews]);

    // Clear all files on hook unmount, ensures that URLs are revoked on page nav etc
    useEffect(() => {
        return () => {
            disposeFilePreviews();
        };
    }, [disposeFilePreviews]);

    return {
        items,
        addItems,
        removeItem,
        clearFiles,
        errors: errors.map((error) => error.message),
        selectionErrors: errors,
        dismissError: (id: string) =>
            setErrors((prev) => prev.filter((error) => error.id !== id)),
        addErrors,
        clearErrors,
    };
}

export default useFileItems;
