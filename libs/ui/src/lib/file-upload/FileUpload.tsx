'use client';

import { FormEvent, useCallback, useMemo } from "react";
import { UploadActions } from "./UploadActions";
import { FilePicker } from "./FilePicker";
import { FileList } from "../files/FileList";
import { FileItem } from "../files/FileListItem";
import { useFileItems } from "./hooks/useFileItems";
import { FileUploadConfig } from "./file-upload.config";

type FileUploadProps = Omit<ReturnType<typeof useFileItems>, 'addErrors'> & {
    config?: FileUploadConfig,
    onUploadStart: (formData: FormData, setConversionExt: string) => void;
}

export function FileUpload({
    config,
    items,
    addItems,
    removeItem,
    clearFiles,
    errors,
    clearErrors,
    onUploadStart,
}: FileUploadProps) {
    const outputMimeOptions = useMemo(() => config?.outputMimeOptions ?? [], [config?.outputMimeOptions]);

    const handleSelectFiles = useCallback((files: File[]) => {
        if (files.length < 1) return;
        // Clear existing errors when new files are selected
        clearErrors();
        addItems(files);
    }, [clearErrors, addItems]);

    const handleRemove = useCallback((item: FileItem) => {
        removeItem(item);
    }, [removeItem]);

    const handleSubmit = useCallback((e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const pageForm = new FormData(e.currentTarget);

        // Prepare form data, building a new form object from scratch and extracting form values as needed
        const formData = new FormData();
        items.forEach(item => formData.append('uploads', item.file as File));
        const manifest = items.map(item => item.id);
        formData.append('manifest', JSON.stringify(manifest))

        // "outputMime" should be passed in from the upload form
        const outputMime = pageForm.get('outputMime') ?? '';
        formData.append('outputMime', JSON.stringify(outputMime))

        // conversionExt is used to display the filename on the download page
        const conversionExt = pageForm.get('conversionExt') ?? '';

        onUploadStart(formData, String(conversionExt));
    }, [onUploadStart, items]);

    const handleClearFiles = useCallback(() => {
        clearFiles();
        clearErrors();
    }, [clearErrors, clearFiles]);

    return (
        <form
            encType="multipart/form-data"
            onSubmit={handleSubmit}
            className=""
        >
            <UploadActions
                outputMimeOptions={outputMimeOptions}
                uploadFilesCount={items.length}
                onClearFiles={handleClearFiles}
                errors={errors}
            />
            <hr className="my-8" />
            <div className="flex flex-wrap gap-6 justify-center sm:justify-start">
                <FilePicker config={config} onSelectFiles={handleSelectFiles} />
                <FileList items={items} showRemove={true} onRemove={handleRemove} />
            </div>
        </form>
    )
}

export default FileUpload;
