'use callback';

import { startTransition, useCallback, useState } from "react";
import { Button } from "../Button";
import Spinner from "../Spinner";
import { FaDownload } from "react-icons/fa";

interface DownloadActionsProps {
    onDownload: () => Promise<void>;
    disabled?: boolean;
}
export function DownloadActions({ onDownload, disabled }: DownloadActionsProps) {
    const [showDownloadLoader, setShowDownloadLoader] = useState(false);

    // Add loading animation during download
    const handleDownload = useCallback(async () => {
        if (showDownloadLoader) return; // Use loader to gate/debounce downloads
        startTransition(() => setShowDownloadLoader(true));
        await onDownload();
        setShowDownloadLoader(false);
    }, [showDownloadLoader, onDownload]);

    return (
        <div className="flex">
            <Button type="button" variant="primary" className="w-fit flex justify-between items-center gap-2 flex-nowrap"
                onClick={handleDownload}
                disabled={disabled || showDownloadLoader}
            >
                Download Converted Files (.zip)

                {
                    showDownloadLoader ? <Spinner className="size-6 shrink-0 relative -right-3" />
                        : <FaDownload className="size-6 shrink-0 relative -right-3" />
                }
            </Button>
        </div>
    )
}

export default DownloadActions;
