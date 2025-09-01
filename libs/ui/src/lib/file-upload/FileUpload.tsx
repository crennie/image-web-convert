'use client';

import { FormEvent, useCallback } from "react";
import { UploadActions } from "./UploadActions";
import { FilePicker } from "./FilePicker";
import { FileList } from "../files/FileList";
import { FileItem } from "../files/FileListItem";
import { useFileItems } from "./hooks/useFileItems";

export interface FileUploadConfig {
    accept?: string | string; // e.g. "image/*,.png,.jpg" or ["image/*", ".png"]
    maxCount?: number; // max number of files allowed
    maxPerFileSizeBytes?: number; // per-file size cap
    maxTotalBytes?: number; // total size cap across all items
}

type FileUploadProps = Omit<ReturnType<typeof useFileItems>, 'addErrors' | 'clearFiles'> & {
    onUploadStart: (formData: FormData) => void;
}

export function FileUpload({
    items,
    addItems,
    removeItem,
    errors,
    clearErrors,
    onUploadStart,
}: FileUploadProps) {
    const handleFilesPicked = useCallback((files: File[]) => {
        if (files.length < 1) return;
        addItems(files);
    }, [addItems]);

    const handleRemove = useCallback((item: FileItem) => {
        removeItem(item);
    }, [removeItem]);

    const handleSubmit = useCallback((e: FormEvent) => {
        e.preventDefault();
        // Prepare form data
        const formData = new FormData();
        items.forEach(item => formData.append('uploads', item.file));
        onUploadStart(formData);
    }, [onUploadStart, items]);

    return (
        <form
            encType="multipart/form-data"
            onSubmit={handleSubmit}
            className=""
        >
            <UploadActions uploadFilesCount={items.length} errors={errors} />
            <div className="flex flex-wrap gap-6 mt-4">
                <FilePicker clearErrors={clearErrors} onFilesPicked={handleFilesPicked} />
                <FileList items={items} showRemove={true} onRemove={handleRemove} />
            </div>
        </form>
    )
}

export default FileUpload;
