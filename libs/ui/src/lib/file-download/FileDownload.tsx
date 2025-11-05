
import { useCallback, useMemo } from "react";
import { DownloadActions } from "./DownloadActions";
import { useFileDownloads } from "./hooks/useFileDownloads";
import { ApiUploadAccepted, ApiUploadRejected } from "@image-web-convert/schemas";
import { FileItem } from "../files/FileListItem";
import { FileList } from "../files/FileList";
import { FaTimes } from "react-icons/fa";

interface FileDownloadProps {
    conversionExt: string;
    items: FileItem[];
    uploadedFiles: ApiUploadAccepted[];
    rejectedFiles: ApiUploadRejected[];
}

export function FileDownload({ conversionExt, items, uploadedFiles, rejectedFiles }: FileDownloadProps) {
    const { downloadFiles, downloadSingleFile } = useFileDownloads({ conversionExt });

    const handleDownloadAll = useCallback(async () => {
        const createArchiveName = () => `image_web_convert_${new Date().toJSON().slice(0, 16).replace(/[\-\:T]/g, '_')}.zip`;
        await downloadFiles(uploadedFiles.map(f => f.id), createArchiveName());

    }, [downloadFiles, uploadedFiles]);

    const handleDownloadOne = useCallback(async (item: FileItem) => {
        const matchingUpload = uploadedFiles.find(uf => uf.clientId === item.id);
        if (matchingUpload) {
            await downloadSingleFile(matchingUpload.id);
        } else {
            alert("Error downloading file");
        }
    }, [uploadedFiles, downloadSingleFile]);

    const successfulUploadItems = useMemo(() =>
        items.filter(item => uploadedFiles.find(uf => uf.clientId === item.id))
            .map(item => ({
                ...item,
                file: { ...item.file, name: item.file.name.replace(/(\.[^./?#]+)?([?#]|$)/, `.${conversionExt}$2`) }
            }))
        , [items, uploadedFiles, conversionExt]);

    return (
        <div id="file-downloads">
            <DownloadActions disabled={!uploadedFiles.length} onDownload={handleDownloadAll} />
            <div className="mt-8">
                <h2 className="text-xl">Successful Conversions</h2>
                <div className="flex flex-wrap gap-6 mt-2">
                    {
                        uploadedFiles.length ?
                            <FileList items={successfulUploadItems} showDownload={true} onDownload={handleDownloadOne} />

                            : <p className="mt-2">No files were able to be converted. See Conversion Errors section for more information.</p>
                    }
                </div>
                {rejectedFiles.length ? (
                    <div className="mt-8">
                        <h2 className="text-xl flex">
                            <FaTimes className="pr-2 size-8 text-destructive" />
                            Conversion Errors
                        </h2>
                        <div className="">
                            <ul className="list-disc pl-8">
                                {rejectedFiles.map((rejected, i) => (
                                    <li key={i} className="">{rejected.fileName} - {rejected.error}</li>
                                ))}
                            </ul>
                        </div>
                    </div>
                ) : null}
            </div>
        </div>
    )
}

export default FileDownload;
