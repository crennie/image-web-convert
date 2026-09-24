import { FileItem } from '../files/FileListItem';
import { Spinner } from '../Spinner';

interface CosmeticProgressProps {
    items: FileItem[];
    // Retained for legacy callers; never displayed as measured progress.
    cosmeticPercent: number;
}

export function CosmeticProgress({ items }: CosmeticProgressProps) {
    return (
        <div id="cosmetic-activity" className="flex max-w-3xl mt-10">
            <div className="w-full text-lg">
                <h2 className="text-lg font-bold">Waiting for your request</h2>
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
                <p className="mt-3 text-sm">
                    This activity indicator does not measure upload or
                    conversion progress.
                </p>
            </div>
        </div>
    );
}

export default CosmeticProgress;
