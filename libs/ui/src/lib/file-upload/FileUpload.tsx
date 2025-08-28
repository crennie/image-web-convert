'use client';

import { useCallback } from "react";
import useFileUpload from "./hooks/useFileUpload";
import UploadActions from "./UploadActions";
import FilePicker from "./FilePicker";
import FileList from "./FileList";

export interface FileUploadConfig {
    accept?: string | string[];                 // e.g. "image/*,.png,.jpg" or ["image/*", ".png"]
    maxCount?: number;                           // max number of files allowed
    maxPerFileSizeBytes?: number;                       // per-file size cap
    maxTotalBytes?: number;                      // total size cap across all items
}

// TODO: Where to put this type
type FileUploadStatus = 'pending' | 'processing' | 'ready';

export type FileUploadItem = {
    id: string;
    file: File;
    status: FileUploadStatus;
    previewUrl?: string;
    errors?: string[];
}

export function FileUpload() {
    const { items, addItems, removeItem, errors, clearErrors } = useFileUpload();

    const handleFilesPicked = useCallback((files: File[]) => {
        if (files.length < 1) return;
        addItems(files);
    }, [addItems]);

    const handleRemove = useCallback((item: FileUploadItem) => {
        removeItem(item);
    }, [removeItem]);

    return (
        <form
            encType="multipart/form-data"
            onSubmit={() => {// todo
            }}
            action="/" // TODO:
            method="POST"
            className=""
        >
            <UploadActions uploadFilesCount={items.length} errors={errors} />
            <div className="flex flex-wrap gap-6 mt-4">
                <FilePicker clearErrors={clearErrors} onFilesPicked={handleFilesPicked} />
                <FileList items={items} onRemove={handleRemove} />
            </div>
        </form>
    )
}

export default FileUpload;
