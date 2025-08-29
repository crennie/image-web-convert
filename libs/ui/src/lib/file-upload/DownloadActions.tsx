import Button from "../Button";

interface DownloadActionsProps {
    onDownload: () => void;
}
export function DownloadActions({ onDownload }: DownloadActionsProps) {
    return (
        <div className="flex">
            <Button type="button" variant="secondary" className="w-55"
                onClick={onDownload}>
                Download Successful Uploads (.zip)
            </Button>
        </div>
    )
}

export default DownloadActions;
