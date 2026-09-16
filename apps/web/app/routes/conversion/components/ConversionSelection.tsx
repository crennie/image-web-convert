import { useRef } from 'react';
import { Button, FILE_UPLOAD_CONFIG } from '@image-web-convert/ui';
import {
    OutputMimeTypeSchema,
    type OutputMimeType,
} from '@image-web-convert/schemas';
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
}: {
    items: LocalConversionFile[];
    errors: string[];
    disabled: boolean;
    outputMime: OutputMimeType;
    onMime: (mime: OutputMimeType) => void;
    onAdd: (files: File[]) => void;
    onRemove: (file: LocalConversionFile) => void;
    onSubmit: () => void;
}) {
    const input = useRef<HTMLInputElement>(null);
    return (
        <section aria-label="Select images" className="flex flex-col gap-4">
            <h1 className="text-2xl font-bold">Convert images</h1>
            <p>
                Select images and an output format. Completed images are
                available as soon as they are ready.
            </p>
            <input
                ref={input}
                hidden
                type="file"
                multiple
                accept={String(FILE_UPLOAD_CONFIG.accept)}
                aria-label="Choose images"
                disabled={disabled}
                onChange={(event) => {
                    onAdd(Array.from(event.target.files ?? []));
                    event.target.value = '';
                }}
            />
            <Button disabled={disabled} onClick={() => input.current?.click()}>
                Choose images
            </Button>
            <label>
                Output format{' '}
                <select
                    disabled={disabled}
                    value={outputMime}
                    onChange={(event) =>
                        onMime(OutputMimeTypeSchema.parse(event.target.value))
                    }
                >
                    {FILE_UPLOAD_CONFIG.outputMimeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                            {option.display.toUpperCase()}
                        </option>
                    ))}
                </select>
            </label>
            {errors.length > 0 && (
                <ul role="alert">
                    {errors.map((error, index) => (
                        <li key={`${index}-${error}`}>{error}</li>
                    ))}
                </ul>
            )}
            <ul className="flex flex-wrap gap-4">
                {items.map((item) => (
                    <li key={item.id} className="rounded border p-3">
                        {item.previewUrl && (
                            <img
                                src={item.previewUrl}
                                alt={`Preview of ${item.file.name}`}
                                className="h-24 w-24 object-contain"
                            />
                        )}
                        <p>{item.file.name}</p>
                        <Button
                            disabled={disabled}
                            aria-label={`Remove ${item.file.name}`}
                            onClick={() => onRemove(item)}
                        >
                            Remove
                        </Button>
                    </li>
                ))}
            </ul>
            {items.length > 0 && (
                <p>
                    {items.length} {items.length === 1 ? 'file' : 'files'} ready
                    to upload.
                </p>
            )}
            <Button disabled={disabled || !items.length} onClick={onSubmit}>
                Start conversion
            </Button>
        </section>
    );
}
