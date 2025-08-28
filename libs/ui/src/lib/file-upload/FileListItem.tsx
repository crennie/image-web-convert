'use client';

import { useCallback, useState } from "react";
import FileUploadCardLayout from "./FileUploadCardLayout";
import { FileUploadItem } from "./FileUpload";
import Button from "../Button";
import { FaTimes } from "react-icons/fa";

interface FileListItemProps {
    item: FileUploadItem;
    onRemove: (item: FileUploadItem) => void;
}

export function FileListItem({ item, onRemove }: FileListItemProps) {
    const [previewOk, setPreviewOk] = useState(true);
    const isLoading = item.status !== 'ready';
    const handleImgError = useCallback(() => {
        setPreviewOk(false);
        return item.file;
    }, [item]);

    return (
        <FileUploadCardLayout className="bg-muted">
            {
                isLoading ? <>LOADING...</> : (
                    <>
                        <Button variant="ghost" className="absolute right-2 top-2 text-destructive"
                            onClick={() => onRemove(item)}
                        >
                            <FaTimes className="size-8" />
                        </Button>
                        {previewOk ?
                            <img
                                onError={handleImgError}
                                src={item.previewUrl} alt={item.file.name} /> :
                            <>No preview available</>
                        }
                        <div className="bg-background rounded-t-lg absolute bottom-0 max-w-[80%] truncate px-3">
                            {item.file.name}
                        </div>
                    </>
                )
            }
        </FileUploadCardLayout>
    )
}

export default FileListItem;
