import { FaCheck } from "react-icons/fa";
import { Button } from "../Button";
import { ValidationErrors } from "./ValidationErrors";

interface UploadActionsProps {
    uploadFilesCount: number;
    errors: string[];
}

export function UploadActions({ uploadFilesCount, errors }: UploadActionsProps) {
    return (
        <div className="flex flex-col lg:flex-row gap-6">
            <div className="flex items-center gap-6 min-h-10 text-primary shrink-0 justify-center sm:justify-start">
                <Button type="submit" variant="primary" className="w-55"
                    disabled={!uploadFilesCount}>
                    Start File Uploads
                </Button>
                <div className="flex items-center gap-4">
                    {uploadFilesCount ? <div className="flex items-center gap-1">
                        <FaCheck className="size-6" />
                        <span>{uploadFilesCount} file{uploadFilesCount === 1 ? '' : 's'} ready to upload.</span>
                    </div> : null}
                </div>
            </div>
            <div className="flex">
                <ValidationErrors errors={errors} />
            </div>
        </div>
    )
}

export default UploadActions;
