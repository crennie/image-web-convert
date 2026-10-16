import { useState } from 'react';

/** Use the original local preview: result downloads require authenticated requests. */
export function ConversionThumbnail({
    src,
    name,
    onDownload,
    disabled = false,
}: {
    src?: string;
    name: string;
    onDownload?: () => void;
    disabled?: boolean;
}) {
    const [failed, setFailed] = useState(!src);
    const [fallbackFailed, setFallbackFailed] = useState(false);
    const preview = (
        <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-background">
            {fallbackFailed ? (
                <span className="text-center text-xs text-muted-foreground">
                    No preview
                </span>
            ) : (
                <img
                    src={failed ? '/image-preview-unavailable.svg' : src}
                    alt={
                        failed
                            ? `Preview unavailable for ${name}`
                            : `Preview of ${name}`
                    }
                    className="h-full w-full object-contain"
                    onError={() =>
                        failed ? setFallbackFailed(true) : setFailed(true)
                    }
                />
            )}
        </div>
    );
    return onDownload ? (
        <button
            type="button"
            className="shrink-0 rounded-lg cursor-pointer hover:ring-2 hover:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
            aria-label={`Download ${name} from thumbnail`}
            title={`Download ${name}`}
            disabled={disabled}
            onClick={onDownload}
        >
            {preview}
        </button>
    ) : (
        preview
    );
}
