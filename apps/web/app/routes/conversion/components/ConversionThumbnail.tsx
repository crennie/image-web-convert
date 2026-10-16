import { useState } from 'react';

/** Use the original local preview: result downloads require authenticated requests. */
export function ConversionThumbnail({
    src,
    name,
}: {
    src?: string;
    name: string;
}) {
    const [failed, setFailed] = useState(!src);
    const [fallbackFailed, setFallbackFailed] = useState(false);
    return (
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
}
