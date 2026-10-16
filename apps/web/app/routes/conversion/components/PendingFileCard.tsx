import { useState } from 'react';
import { Button } from '@image-web-convert/ui';
import type { LocalConversionFile } from '../conversionController';

export function PendingFileCard({
    item,
    disabled,
    onRemove,
}: {
    item: LocalConversionFile;
    disabled: boolean;
    onRemove: (file: LocalConversionFile) => void;
}) {
    return (
        <li className="flex w-55 max-w-full min-w-0 flex-col gap-3 rounded-xl border border-border bg-muted p-4">
            <Preview key={item.previewUrl ?? 'missing'} item={item} />
            <div
                tabIndex={0}
                role="region"
                aria-label={`Filename: ${item.file.name}`}
                className="w-full overflow-x-auto whitespace-nowrap rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
                {item.file.name}
            </div>
            <Button
                variant="secondary"
                disabled={disabled}
                aria-label={`Remove ${item.file.name}`}
                onClick={() => onRemove(item)}
            >
                Remove
            </Button>
        </li>
    );
}

function Preview({ item }: { item: LocalConversionFile }) {
    const [failed, setFailed] = useState(!item.previewUrl);
    const [fallbackFailed, setFallbackFailed] = useState(false);
    return (
        <div className="flex h-32 w-full flex-col items-center justify-center gap-1">
            {!fallbackFailed && (
                <img
                    src={
                        failed
                            ? '/image-preview-unavailable.svg'
                            : item.previewUrl
                    }
                    alt={failed ? '' : `Preview of ${item.file.name}`}
                    className={
                        failed
                            ? 'h-20 w-20 object-contain'
                            : 'h-full w-full object-contain'
                    }
                    onError={() =>
                        failed ? setFallbackFailed(true) : setFailed(true)
                    }
                />
            )}
            {failed && (
                <span className="text-sm text-muted-foreground">
                    Preview unavailable
                </span>
            )}
        </div>
    );
}
