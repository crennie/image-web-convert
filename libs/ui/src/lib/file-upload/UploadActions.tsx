import { FaCheck } from "react-icons/fa";
import { Button } from "../Button";
import { ValidationErrors } from "./ValidationErrors";
import { FileUploadConfig } from "./file-upload.config";


interface UploadActionsProps {
    outputMimeOptions: FileUploadConfig['outputMimeOptions'];
    uploadFilesCount: number;
    onClearFiles: () => void;
    errors: string[];
}

export function UploadActions({ outputMimeOptions, uploadFilesCount, onClearFiles, errors }: UploadActionsProps) {
    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center gap-6 min-h-10 text-primary shrink-0 flex-wrap sm:flex-nowrap justify-center sm:justify-start">
                <div className="w-full sm:w-fit text-center sm:text-left">
                    <Button type="submit" variant="primary" className="w-55"
                        disabled={!uploadFilesCount}>
                        Start File Uploads
                    </Button>
                </div>
                <div className="flex flex-col pb-4">
                    <label className="" htmlFor="outputMime">Convert To</label>
                    <select id="outputMime" name="outputMime" className="h-10 w-50 rounded-lg bg-white" defaultValue={outputMimeOptions?.[0]?.value ?? ''} required>
                        {outputMimeOptions.map((option, i) => (
                            <option key={i} value={option.value}>{option.display}</option>
                        ))}
                    </select>
                </div>
                {uploadFilesCount ?
                    <Button type="button" onClick={onClearFiles}
                        variant="ghost"
                        className="text-nowrap w-fit px-2 underline-offset-2 decoration-2 hover:underline"
                        disabled={!uploadFilesCount}>
                        Clear all
                    </Button>
                    : null}
            </div>
            {uploadFilesCount ?
                <div className="flex items-center gap-3 w-full sm:w-fit text-primary">
                    <FaCheck className="size-6" />
                    <span>{uploadFilesCount} file{uploadFilesCount === 1 ? '' : 's'} ready to upload.</span>
                </div>
                : null}
            {errors.length ?
                <div className="flex">
                    <ValidationErrors errors={errors} />
                </div>
                : null}
        </div>
    )
}

export default UploadActions;
