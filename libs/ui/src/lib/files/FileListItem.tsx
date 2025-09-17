'use client';

import { useCallback, useState } from "react";
import { FileCardLayout } from "./FileCardLayout";
import { Button } from "../Button";
import { FaDownload, FaTimes } from "react-icons/fa";
import Spinner from "../Spinner";
import { cn } from "../utils";

export type FileItem = {
    id: string;
    file: File;
    previewUrl?: string;
    errors?: string[];
}

interface FileListItemProps {
    item: FileItem;
    showDownload?: boolean;
    showRemove?: boolean;
    onRemove?: (item: FileItem) => void;
    onDownload?: (item: FileItem) => Promise<void>;
}

export function FileListItem({
    item,
    showDownload = false,
    showRemove = false,
    onRemove,
    onDownload,
}: FileListItemProps) {
    const [previewOk, setPreviewOk] = useState(true);
    const [isLoading] = useState(false); // TODO: per-item UI loading until preview is ready?
    const [showDownloadLoader, setShowDownloadLoader] = useState(false);

    const handleImgError = useCallback(() => {
        setPreviewOk(false);
        return item.file;
    }, [item]);

    // Add icon animation to download functionality
    const handleDownloadClick = useCallback(async () => {
        if (typeof onDownload !== 'function') return;
        if (showDownloadLoader) return; // Use loader to gate/debounce downloads

        setShowDownloadLoader(true);
        try {
            await onDownload(item);
        } finally {
            setShowDownloadLoader(false);
        }
    }, [item, onDownload, showDownloadLoader]);

    const cardClickProps = showDownload && typeof onDownload === 'function' ?
        { onClick: handleDownloadClick } : {};
    return (
        <FileCardLayout
            className={cn("bg-muted", showDownload && onDownload ? "cursor-pointer" : null)}
            {...cardClickProps}
        >
            {isLoading ? <>LOADING...</> : null}
            {!isLoading ? (
                <>
                    {showRemove ? (
                        <Button variant="ghost" className="absolute right-2 top-2 text-destructive"
                            onClick={() => onRemove?.(item)}
                        >
                            <FaTimes className="size-8" />
                        </Button>) : null
                    }
                    {showDownload ? (
                        <Button variant="ghost" className="absolute right-2 top-2 text-blue-500"
                            onClick={e => {
                                e.stopPropagation(); // prevents bubbling to the card handler
                                void handleDownloadClick();
                            }}
                        >
                            {
                                showDownloadLoader ? <Spinner className="size-8 text-blue-500" />
                                    : <FaDownload className="size-8" />
                            }
                        </Button>) : null
                    }
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
            ) : null
            }
        </FileCardLayout >
    )
}

export default FileListItem;
