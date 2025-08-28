import FileListItem from "./FileListItem";
import { FileUploadItem } from "./FileUpload";

interface FileListProps {
    items: FileUploadItem[];
    onRemove: (item: FileUploadItem) => void;
}

export function FileList({ items, onRemove }: FileListProps) {
    return (
        <>
            {items.map(item => (
                <FileListItem key={item.id} item={item} onRemove={onRemove} />
            ))}
        </>
    )
}

export default FileList;
