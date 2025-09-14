import { Button}  from "../Button";

interface DownloadActionsProps {
    onDownload: () => void;
    disabled?: boolean;
}
export function DownloadActions({ onDownload, disabled }: DownloadActionsProps) {
    return (
        <div className="flex">
            <Button type="button" variant="primary" className="w-fit"
                onClick={onDownload}
                disabled={disabled}
            >
                Download Converted Files (.zip)
            </Button>
        </div>
    )
}

export default DownloadActions;
