import { Button}  from "../Button";

interface DownloadActionsProps {
    onDownload: () => void;
}
export function DownloadActions({ onDownload }: DownloadActionsProps) {
    return (
        <div className="flex">
            <Button type="button" variant="primary" className="w-fit"
                onClick={onDownload}>
                Download Converted Files (.zip)
            </Button>
        </div>
    )
}

export default DownloadActions;
