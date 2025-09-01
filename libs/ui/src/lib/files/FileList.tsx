import { FileListItem, FileItem } from "./FileListItem";

interface FileListProps {
    items: FileItem[];
    showRemove?: boolean;
    showDownload?: boolean;
    onRemove?: (item: FileItem) => void;
    onDownload?: (item: FileItem) => void;
}

export function FileList({ items, showRemove=false, showDownload=false, onRemove, onDownload }: FileListProps) {
    return (
        <>
            {items.map(item => (
                <FileListItem key={item.id} item={item} showRemove={showRemove} onRemove={onRemove}
                    showDownload={showDownload} onDownload={onDownload} />
            ))}
        </>
    )
}

export default FileList;
