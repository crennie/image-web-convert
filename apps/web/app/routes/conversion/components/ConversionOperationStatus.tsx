import type {
    ApiConversionOperation,
    ConversionOutput,
} from '@image-web-convert/schemas';
import { Button } from '@image-web-convert/ui';
import type { ConversionClientState } from '../conversionController';
import {
    batchUploadProgress,
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
}: Pick<
    ConversionClientState,
    'uploads' | 'cancelling' | 'uploadsStopped' | 'downloading' | 'errors'
> & {
    operation: ApiConversionOperation;
    onRetry: (clientId: string) => void;
    onCancel: () => void;
    onDownload: (result: ConversionOutput | string[]) => void;
}) {
    const progress = batchUploadProgress(uploads);
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
            className="flex flex-col gap-4"
        >
            <h1 className="text-2xl font-bold">Image conversion</h1>
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
            <p>
                Upload transport: {progress.loaded} bytes sent
                {progress.total === undefined
                    ? ' (total unknown)'
                    : ` of ${progress.total}`}{' '}
                across current attempts. Server accepted:{' '}
                {operation.counts.uploaded} of {operation.counts.expected}{' '}
                files.
            </p>
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
                        className="rounded border p-3"
                        aria-labelledby={`${file.id}-name`}
                        aria-describedby={`${file.id}-status${file.status === 'failed' ? ` ${file.id}-error` : ''}`}
                    >
                        <p id={`${file.id}-name`} className="font-semibold">
                            {file.name}
                        </p>
                        <p id={`${file.id}-status`}>
                            {fileDisplayState(file, uploads[file.clientId])}
                        </p>
                        {file.status === 'failed' && (
                            <p id={`${file.id}-error`}>
                                File conversion failed (
                                {file.error.type.replace(/_/g, ' ')}). Try a new
                                batch with a supported image.
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
                        {file.status === 'completed' && (
                            <div>
                                <p>
                                    {file.output.meta.output.storedName} —{' '}
                                    {file.output.meta.output.width} ×{' '}
                                    {file.output.meta.output.height},{' '}
                                    {file.output.meta.output.sizeBytes} bytes
                                </p>
                                <Button
                                    disabled={disabled || downloading}
                                    onClick={() => onDownload(file.output)}
                                    aria-label={`Download ${file.output.meta.output.storedName}`}
                                >
                                    Download
                                </Button>
                            </div>
                        )}
                    </li>
                ))}
            </ul>
            {outputs.length > 0 && (
                <Button
                    disabled={disabled || downloading}
                    onClick={() =>
                        onDownload(outputs.map((output) => output.meta.id))
                    }
                >
                    Download completed images as ZIP
                </Button>
            )}
            {!isTerminal(operation) && (
                <Button
                    disabled={
                        disabled ||
                        cancelling ||
                        (!!operation.cancelRequestedAt && !errors.cancellation)
                    }
                    onClick={onCancel}
                >
                    {errors.cancellation
                        ? 'Retry cancellation'
                        : 'Cancel conversion'}
                </Button>
            )}
        </section>
    );
}
