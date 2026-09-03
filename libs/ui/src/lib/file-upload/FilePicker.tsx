'use client';

import { FileCardLayout } from '../files/FileCardLayout';
import { FaPlus } from 'react-icons/fa';
import { useDropzone } from './hooks/useDropzone';
import { cn } from '../utils';
import { FileUploadConfig } from './file-upload.config';

interface FilePickerProps {
    config?: FileUploadConfig;
    onSelectFiles: (files: File[]) => void;
}

export function FilePicker({ config, onSelectFiles }: FilePickerProps) {
    const { isDragActive, open, rootProps, inputProps } = useDropzone({
        config,
        multiple: true,
        enablePaste: true,
        disabled: false,
        onSelectFiles,
    });

    return (
        <FileCardLayout
            {...rootProps}
            className={cn(
                `relative flex min-h-40 items-center justify-center rounded-2xl border-2 border-dashed p-6 transition cursor-pointer hover:border-solid`,
                isDragActive
                    ? 'border-solid border-blue-500 bg-blue-500/5'
                    : 'border-muted-foreground/30',
            )}
        >
            <input id="file-uploads" {...inputProps} />
            <button
                type="button"
                className="absolute inset-0 flex flex-col items-center justify-center text-center text-lg cursor-pointer"
                onClick={open}
            >
                <FaPlus className="size-10" />
                Drag images here or click to browse
                {isDragActive && (
                    <div className="absolute inset-0 pointer-events-none rounded-2xl ring-2 ring-blue-500/40" />
                )}
            </button>
        </FileCardLayout>
    );
}

export default FilePicker;
