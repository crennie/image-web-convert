import { FileItem } from '../files/FileListItem';
import { Spinner } from '../Spinner';

interface CosmeticProgressProps {
    items: FileItem[];
    cosmeticPercent: number;
}

export function CosmeticProgress({
    items,
    cosmeticPercent,
}: CosmeticProgressProps) {
    return (
        <div id="file-upload-progress" className="flex max-w-3xl mt-10">
            <div className="w-full text-lg">
                <h2 className="text-lg font-bold">Preparing your download</h2>
                <div className="flex items-center gap-3">
                    <Spinner />
                    <span>Please wait while your request completes.</span>
                </div>
                <div aria-label="Selected files" className="mt-3">
                    {items.map((item, index) => (
                        <div key={index} className="truncate">
                            {item.file.name}
                        </div>
                    ))}
                </div>
                <div className="sr-only" aria-live="polite">
                    Visual activity indicator: {cosmeticPercent}%
                </div>
            </div>
        </div>
    );
}

export default CosmeticProgress;
