import type {
    ApiConversionOperation,
    ConversionOutput,
} from '@image-web-convert/schemas';
import { Button, displayBytes, displayDateTime } from '@image-web-convert/ui';
import { FaDownload } from 'react-icons/fa';
import { ConversionThumbnail } from './ConversionThumbnail';
import type {
    LocalConversionFile,
    ConversionClientState,
} from '../conversionController';
import {
    canRetryUpload,
    completedDownloads,
    fileDisplayState,
    isTerminal,
} from '../conversionViewModel';

export function ConversionOperationStatus({
    operation,
    uploads,
    cancelling,
    uploadsStopped,
    downloading,
    errors,
    onRetry,
    onCancel,
    onDownload,
    localFiles = [],
    onNewBatch,
}: Pick<
    ConversionClientState,
    'uploads' | 'cancelling' | 'uploadsStopped' | 'downloading' | 'errors'
> & {
    operation: ApiConversionOperation;
    localFiles?: LocalConversionFile[];
    onNewBatch?: () => void;
    onRetry: (clientId: string) => void;
    onCancel: () => void;
    onDownload: (result: ConversionOutput | string[]) => void;
}) {
    const finished = isTerminal(operation);
    const outputs = completedDownloads(operation);
    const disabled = !!errors.access;
    const stopped =
        disabled ||
        uploadsStopped ||
        !!operation.stopRequestedAt ||
        isTerminal(operation);
    return (
        <section
            aria-label="Conversion operation"
            className="surface-panel flex flex-col gap-4"
        >
            <h1 className="text-2xl font-bold">Image conversion</h1>
            <p>
                Session expires at{' '}
                <time dateTime={operation.expiresAt}>
                    {displayDateTime(new Date(operation.expiresAt))}
                </time>{' '}
                (local time). Download completed images before then.
            </p>
            <div role="status" aria-live="polite" aria-atomic="true">
                <p>Operation: {operation.status.replace(/_/g, ' ')}</p>
                <p>
                    {operation.counts.completed} completed,{' '}
                    {operation.counts.failed} failed,{' '}
                    {operation.counts.cancelled} cancelled;{' '}
                    {operation.counts.processing} processing.
                </p>
                {!isTerminal(operation) &&
                    (cancelling || operation.cancelRequestedAt) && (
                        <p>
                            Cancellation pending — active processing may finish.
                        </p>
                    )}
            </div>
            {operation.stopReason === 'conversion_timeout' && (
                <p role="alert">
                    Processing time limit reached. Completed results remain
                    available.
                </p>
            )}
            {operation.status === 'failed' && (
                <p role="alert">
                    The server could not complete this batch. See the file
                    outcomes below.
                </p>
            )}
            <ul className="flex flex-col gap-3">
                {operation.files.map((file) => (
                    <li
                        key={file.id}
                        className="flex items-start gap-3 rounded-xl border border-border bg-muted p-4"
                        aria-labelledby={`${file.id}-name`}
                        aria-describedby={`${file.id}-status${file.status === 'failed' ? ` ${file.id}-error` : ''}`}
                    >
                        <ConversionThumbnail
                            key={
                                localFiles.find(
                                    (local) => local.id === file.clientId,
                                )?.previewUrl ?? file.clientId
                            }
                            src={
                                localFiles.find(
                                    (local) => local.id === file.clientId,
                                )?.previewUrl
                            }
                            name={file.name}
                            disabled={disabled || downloading}
                            onDownload={
                                file.status === 'completed'
                                    ? () => onDownload(file.output)
                                    : undefined
                            }
                        />
                        <div className="min-w-0 flex-1 break-words">
                            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                                <p
                                    id={`${file.id}-name`}
                                    className="min-w-0 font-semibold"
                                >
                                    {file.name}
                                </p>
                                <span className="text-sm text-muted-foreground">
                                    {file.status === 'completed'
                                        ? `${file.output.meta.output.width} × ${file.output.meta.output.height} · ${displayBytes(file.output.meta.output.sizeBytes)}`
                                        : displayBytes(file.declaredBytes)}
                                </span>
                            </div>
                            <p id={`${file.id}-status`}>
                                {fileDisplayState(file, uploads[file.clientId])}
                            </p>
                            {file.status === 'failed' && (
                                <p id={`${file.id}-error`}>
                                    File conversion failed (
                                    {file.error.type.replace(/_/g, ' ')}). Try a
                                    new batch with a supported image.
                                </p>
                            )}
                            {canRetryUpload(file, uploads[file.clientId]) && (
                                <Button
                                    disabled={stopped}
                                    onClick={() => onRetry(file.clientId)}
                                    aria-label={`Retry upload ${file.name}`}
                                >
                                    Check server and retry upload
                                </Button>
                            )}
                        </div>
                        {file.status === 'completed' && (
                            <Button
                                variant="secondary"
                                className="size-11 shrink-0 self-center rounded-full p-0"
                                disabled={disabled || downloading}
                                onClick={() => onDownload(file.output)}
                                aria-label={`Download ${file.output.meta.output.storedName}`}
                                title={`Download ${file.name}`}
                            >
                                <FaDownload
                                    className="size-4"
                                    aria-hidden="true"
                                />
                            </Button>
                        )}
                    </li>
                ))}
            </ul>
            <div className="flex flex-wrap items-center gap-3">
                {finished && outputs.length > 0 && (
                    <Button
                        className="self-start"
                        disabled={disabled || downloading}
                        onClick={() =>
                            onDownload(outputs.map((output) => output.meta.id))
                        }
                    >
                        <FaDownload
                            className="size-4 shrink-0"
                            aria-hidden="true"
                        />
                        Download completed images as ZIP
                    </Button>
                )}
                {!isTerminal(operation) && (
                    <Button
                        disabled={
                            disabled ||
                            cancelling ||
                            (!!operation.cancelRequestedAt &&
                                !errors.cancellation)
                        }
                        onClick={onCancel}
                    >
                        {errors.cancellation
                            ? 'Retry cancellation'
                            : 'Cancel conversion'}
                    </Button>
                )}
                {finished && onNewBatch && (
                    <Button
                        variant="ghost"
                        className="self-start px-2 underline-offset-4 hover:underline"
                        onClick={onNewBatch}
                    >
                        Start new batch
                    </Button>
                )}
            </div>
        </section>
    );
}
