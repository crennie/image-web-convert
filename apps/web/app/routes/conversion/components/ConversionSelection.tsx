import { useEffect, useRef, useState } from 'react';
import {
    Button,
    displayBytes,
    FILE_UPLOAD_CONFIG,
    type SelectionError,
} from '@image-web-convert/ui';
import {
    OutputMimeTypeSchema,
    type OutputMimeType,
} from '@image-web-convert/schemas';
import { SelectionDropzone } from './SelectionDropzone';
import { PendingFileCard } from './PendingFileCard';
import type { LocalConversionFile } from '../conversionController';

export function ConversionSelection({
    items,
    errors,
    disabled,
    outputMime,
    onMime,
    onAdd,
    onRemove,
    onSubmit,
    onDismissError,
    onClearErrors,
}: {
    items: LocalConversionFile[];
    errors: SelectionError[];
    onDismissError: (id: string) => void;
    onClearErrors: () => void;
    disabled: boolean;
    outputMime: OutputMimeType;
    onMime: (mime: OutputMimeType) => void;
    onAdd: (files: File[]) => void;
    onRemove: (file: LocalConversionFile) => void;
    onSubmit: () => void;
}) {
    const browse = useRef<HTMLButtonElement>(null);
    const dismissButtons = useRef(new Map<string, HTMLButtonElement>());
    const [announcement, setAnnouncement] = useState('');
    const previousIds = useRef(new Set<string>());
    useEffect(() => {
        const added = errors.filter(
            (error) => !previousIds.current.has(error.id),
        );
        previousIds.current = new Set(errors.map((error) => error.id));
        if (added.length)
            setAnnouncement(added.map((error) => error.message).join(' '));
        else if (!errors.length) setAnnouncement('');
    }, [errors]);
    return (
        <section
            aria-label="Select images"
            className="surface-panel flex flex-col gap-5"
        >
            <h1 className="text-3xl sm:text-4xl font-bold">Convert images</h1>
            <p className="text-muted-foreground">
                Select images and an output format. Completed images are
                available as soon as they are ready.
            </p>
            <SelectionDropzone
                disabled={disabled}
                populated={items.length > 0}
                onAdd={onAdd}
                browseRef={browse}
            />
            {items.length > 0 && (
                <p aria-live="polite" aria-atomic="true">
                    {items.length} {items.length === 1 ? 'file' : 'files'} ready
                    to upload.
                </p>
            )}
            <div
                className="sr-only"
                role="status"
                aria-live="polite"
                aria-atomic="true"
            >
                {announcement}
            </div>
            {errors.length > 0 && (
                <div className="border-l-4 border-destructive/60 pl-3 text-destructive">
                    <div className="flex justify-start">
                        <Button
                            variant="ghost"
                            className="px-2 text-sm font-medium text-destructive hover:underline"
                            aria-label="Clear all errors"
                            onClick={() => {
                                browse.current?.focus();
                                onClearErrors();
                            }}
                        >
                            Clear all
                        </Button>
                    </div>
                    <ul
                        aria-label="Selection errors"
                        className="flex flex-col gap-1"
                    >
                        {errors.map((error, index) => (
                            <li
                                key={error.id}
                                className="flex items-start gap-2"
                            >
                                <Button
                                    variant="ghost"
                                    className="w-11 shrink-0 text-destructive font-normal"
                                    aria-label={`Dismiss error: ${error.message}`}
                                    ref={(element) => {
                                        if (element)
                                            dismissButtons.current.set(
                                                error.id,
                                                element,
                                            );
                                        else
                                            dismissButtons.current.delete(
                                                error.id,
                                            );
                                    }}
                                    onClick={() => {
                                        const next =
                                            errors[index + 1] ??
                                            errors[index - 1];
                                        (next
                                            ? dismissButtons.current.get(
                                                  next.id,
                                              )
                                            : browse.current
                                        )?.focus();
                                        onDismissError(error.id);
                                    }}
                                >
                                    <span aria-hidden="true">×</span>
                                </Button>
                                <span className="min-w-0 break-words py-2.5">
                                    {error.message}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {items.length > 0 && (
                <>
                    <ul
                        aria-label="Pending images"
                        className="flex flex-wrap justify-center gap-4 sm:justify-start"
                    >
                        {items.map((item) => (
                            <PendingFileCard
                                key={item.id}
                                item={item}
                                disabled={disabled}
                                onRemove={onRemove}
                            />
                        ))}
                    </ul>
                    <p className="text-sm text-muted-foreground">
                        {items.length} {items.length === 1 ? 'image' : 'images'}{' '}
                        ·{' '}
                        {displayBytes(
                            items.reduce(
                                (total, item) => total + item.file.size,
                                0,
                            ),
                        )}{' '}
                        total · Convert to{' '}
                        {outputMime.split('/')[1].toUpperCase()}. Originals stay
                        unchanged. Keep this page open during conversion, then
                        download individual images or a ZIP.
                    </p>
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
                        <label className="flex flex-col gap-2 font-medium sm:max-w-xs">
                            Output format{' '}
                            <select
                                disabled={disabled}
                                value={outputMime}
                                onChange={(event) =>
                                    onMime(
                                        OutputMimeTypeSchema.parse(
                                            event.target.value,
                                        ),
                                    )
                                }
                            >
                                {FILE_UPLOAD_CONFIG.outputMimeOptions.map(
                                    (option) => (
                                        <option
                                            key={option.value}
                                            value={option.value}
                                        >
                                            {option.display.toUpperCase()}
                                        </option>
                                    ),
                                )}
                            </select>
                        </label>
                        <Button disabled={disabled} onClick={onSubmit}>
                            Start conversion
                        </Button>
                    </div>
                </>
            )}
        </section>
    );
}
