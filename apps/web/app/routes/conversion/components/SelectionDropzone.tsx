import { useEffect, useState, type RefObject } from 'react';
import { Button, FILE_UPLOAD_CONFIG, useDropzone } from '@image-web-convert/ui';

export function SelectionDropzone({
    disabled,
    populated,
    onAdd,
    browseRef,
}: {
    disabled: boolean;
    populated: boolean;
    onAdd: (files: File[]) => void;
    browseRef: RefObject<HTMLButtonElement | null>;
}) {
    const { rootProps, inputProps, open, isDragActive } = useDropzone({
        config: FILE_UPLOAD_CONFIG,
        disabled,
        onSelectFiles: onAdd,
    });
    const [pageDrag, setPageDrag] = useState(false);
    useEffect(() => {
        let depth = 0;
        const reset = () => {
            depth = 0;
            setPageDrag(false);
        };
        const enter = (event: DragEvent) => {
            if (!event.dataTransfer?.types.includes('Files')) return;
            depth++;
            if (!disabled) setPageDrag(true);
        };
        const leave = () => {
            depth = Math.max(0, depth - 1);
            if (!depth) reset();
        };
        const over = (event: DragEvent) => {
            if (event.dataTransfer?.types.includes('Files'))
                event.preventDefault();
        };
        const drop = (event: DragEvent) => {
            over(event);
            reset();
        };
        window.addEventListener('dragenter', enter, true);
        window.addEventListener('dragleave', leave, true);
        window.addEventListener('dragover', over, true);
        window.addEventListener('drop', drop, true);
        window.addEventListener('dragend', reset);
        window.addEventListener('blur', reset);
        return () => {
            window.removeEventListener('dragenter', enter, true);
            window.removeEventListener('dragleave', leave, true);
            window.removeEventListener('dragover', over, true);
            window.removeEventListener('drop', drop, true);
            window.removeEventListener('dragend', reset);
            window.removeEventListener('blur', reset);
        };
    }, [disabled]);
    const active = !disabled && (pageDrag || isDragActive);
    return (
        <div
            {...rootProps}
            data-testid="selection-dropzone"
            className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-4 text-center motion-safe:transition-colors ${populated ? 'py-4' : 'py-10'} ${active ? 'border-primary bg-primary/10 ring-2 ring-primary/30' : 'border-border bg-muted/30'}`}
        >
            <input
                {...inputProps}
                aria-label="Choose images"
                disabled={disabled}
            />
            <p>
                {!disabled && isDragActive
                    ? 'Release to add images'
                    : populated
                      ? 'Drop more images here'
                      : 'Drag images here'}
            </p>
            <Button
                ref={browseRef}
                variant="secondary"
                disabled={disabled}
                onClick={open}
            >
                Choose images
            </Button>
        </div>
    );
}
