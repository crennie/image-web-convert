'use client';

import { FormEvent, useCallback } from "react";
import { UploadActions } from "./UploadActions";
import { FilePicker } from "./FilePicker";
import { FileList } from "../files/FileList";
import { FileItem } from "../files/FileListItem";
import { useFileItems } from "./hooks/useFileItems";
import { FileUploadConfig } from "./file-upload.config";

type FileUploadProps = Omit<ReturnType<typeof useFileItems>, 'addErrors' | 'clearFiles'> & {
    config?: FileUploadConfig,
    onUploadStart: (formData: FormData) => void;
}

export function FileUpload({
    config,
    items,
    addItems,
    removeItem,
    errors,
    clearErrors,
    onUploadStart,
}: FileUploadProps) {
    const handleSelectFiles = useCallback((files: File[]) => {
        if (files.length < 1) return;
        // Clear existing errors when new files are selected
        clearErrors();
        addItems(files);
    }, [clearErrors, addItems]);

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
                <FilePicker config={config} onSelectFiles={handleSelectFiles} />
                <FileList items={items} showRemove={true} onRemove={handleRemove} />
            </div>
        </form>
    )
}

export default FileUpload;
