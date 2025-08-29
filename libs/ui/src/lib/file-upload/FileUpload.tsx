'use client';

import { FormEvent, useCallback } from "react";
import { useFileUpload } from "./hooks/useFileUpload";
import { useFormSubmit } from "./hooks/useFormSubmit";
import { UploadActions } from "./UploadActions";
import { DownloadActions } from "./DownloadActions";
import { FilePicker } from "./FilePicker";
import { FileList } from "./FileList";
import useFileDownloads from "./hooks/useFileDownloads";

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
    const { items, addItems, removeItem, errors, addErrors, clearErrors } = useFileUpload();
    const { submittedFiles, submitFiles } = useFormSubmit();
    const { downloadFiles } = useFileDownloads();

    const handleFilesPicked = useCallback((files: File[]) => {
        if (files.length < 1) return;
        addItems(files);
    }, [addItems]);

    const handleRemove = useCallback((item: FileUploadItem) => {
        removeItem(item);
    }, [removeItem]);

    const handleSubmit = useCallback(async (e: FormEvent) => {
        console.log("form submit", e);
        e.preventDefault();
        // TODO: prepareFormData() call?
        const res = await submitFiles(items);
        // TODO: Hook in better processing
        if (!res) {
            addErrors(["ERROR UPLOADING FILES"]);
        } else {
            alert("files uploaded successfully");
        }
    }, [items, addErrors, submitFiles]);

    const handleDownloadAll = useCallback(async () => {
        const createArchiveName = () => `image_web_convert_${new Date().toJSON().slice(0, 16).replace(/[\-\:T]/g, '_')}.zip`;
        await downloadFiles(submittedFiles.map(f => f.id), createArchiveName());

    }, [downloadFiles, submittedFiles]);

    console.log("SUBMITTED FILES", submittedFiles);

    return (
        <form
            encType="multipart/form-data"
            onSubmit={handleSubmit}
            className=""
        >
            {
                submittedFiles.length ?
                    <DownloadActions onDownload={handleDownloadAll} /> :
                    <UploadActions uploadFilesCount={items.length} errors={errors} />
            }
            <div className="flex flex-wrap gap-6 mt-4">
                <FilePicker clearErrors={clearErrors} onFilesPicked={handleFilesPicked} />
                <FileList items={items} onRemove={handleRemove} />
            </div>
        </form>
    )
}

export default FileUpload;
