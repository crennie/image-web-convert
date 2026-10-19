import { useEffect, useId, useRef, useState } from 'react';
import { StatusHelp } from '../../../components/StatusHelp';
import { BatchNavigationGuard } from './BatchNavigationGuard';
import type {
    ApiConversionOperation,
    ConversionOutput,
} from '@image-web-convert/schemas';
import { Button, displayBytes, displayDateTime } from '@image-web-convert/ui';
import { FaDownload, FaSpinner, FaChevronDown } from 'react-icons/fa';
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

function DownloadIcon({
    target,
    downloading,
    downloadTarget,
}: {
    target: string;
    downloading: boolean;
    downloadTarget: string | null;
}) {
    return downloading && downloadTarget === target ? (
        <FaSpinner
            className="size-4 shrink-0 motion-safe:animate-spin"
            aria-hidden="true"
        />
    ) : (
        <FaDownload className="size-4 shrink-0" aria-hidden="true" />
    );
}

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
    onLeave,
}: Pick<
    ConversionClientState,
    'uploads' | 'cancelling' | 'uploadsStopped' | 'downloading' | 'errors'
> & {
    operation: ApiConversionOperation;
    localFiles?: LocalConversionFile[];
    onNewBatch?: () => void;
    onLeave?: () => void;
    onRetry: (clientId: string) => void;
    onCancel: () => void;
    onDownload: (result: ConversionOutput | string[]) => void;
}) {
    const [listState, setListState] = useState({
        allSucceeded: false,
        expanded: true,
    });
    const [downloadTarget, setDownloadTarget] = useState<string | null>(null);
    const listId = useId();
    const listRef = useRef<HTMLDivElement>(null);
    const toggleRef = useRef<HTMLButtonElement>(null);
    const allSucceeded =
        operation.files.length > 0 &&
        isTerminal(operation) &&
        operation.files.every((file) => file.status === 'completed');
    if (listState.allSucceeded !== allSucceeded)
        setListState({ allSucceeded, expanded: !allSucceeded });
    const expanded =
        listState.allSucceeded === allSucceeded
            ? listState.expanded
            : !allSucceeded;
    useEffect(() => {
        if (!expanded && listRef.current?.contains(document.activeElement))
            toggleRef.current?.focus();
    }, [expanded]);
    const download = (result: ConversionOutput | string[]) => {
        setDownloadTarget(Array.isArray(result) ? 'zip' : result.meta.id);
        onDownload(result);
    };
    const finished = isTerminal(operation);
    const outputs = completedDownloads(operation);
    const pendingCounts = [
        ['awaiting_upload', 'upload pending'],
        ['uploaded', 'queued'],
    ]
        .flatMap(([status, label]) => {
            const count = operation.files.filter(
                (file) => file.status === status,
            ).length;
            return count ? [`${count} ${label}`] : [];
        })
        .join(' · ');
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
                <p>
                    Operation:{' '}
                    <StatusHelp
                        tone={
                            finished
                                ? allSucceeded
                                    ? 'success'
                                    : 'warning'
                                : 'busy'
                        }
                        help={
                            finished
                                ? 'Processing has ended. Download completed images before this session expires. Failed or cancelled files have no result.'
                                : 'Images upload first, then wait for server processing. Completed files can be downloaded while the rest continue.'
                        }
                    >
                        {operation.status.replace(/_/g, ' ')}
                    </StatusHelp>
                </p>
                {!finished && (
                    <p>
                        {operation.counts.settled} of{' '}
                        {operation.counts.expected} files finished
                    </p>
                )}
                <p>
                    {[
                        `${operation.counts.completed} completed`,
                        ...(['failed', 'cancelled', 'processing'] as const)
                            .filter((status) => operation.counts[status] > 0)
                            .map(
                                (status) =>
                                    `${operation.counts[status]} ${status}`,
                            ),
                    ].join(', ')}
                    .
                </p>
                {!finished && pendingCounts && <p>{pendingCounts}</p>}
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
            <button
                ref={toggleRef}
                type="button"
                aria-expanded={expanded}
                aria-controls={listId}
                onClick={() =>
                    setListState((value) => ({
                        ...value,
                        expanded: !value.expanded,
                    }))
                }
                className="flex min-h-11 items-center justify-between gap-3 text-left font-semibold"
            >
                Files ({operation.files.length})
                <FaChevronDown
                    aria-hidden="true"
                    className={`size-4 motion-safe:transition-transform ${expanded ? 'rotate-180' : ''}`}
                />
            </button>
            <div
                ref={listRef}
                id={listId}
                inert={!expanded}
                aria-hidden={!expanded}
                className={`grid motion-safe:transition-[grid-template-rows] motion-safe:duration-300 ${expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
            >
                <div className="min-h-0 overflow-hidden">
                    <ul className="flex flex-col gap-3 py-1">
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
                                            (local) =>
                                                local.id === file.clientId,
                                        )?.previewUrl ?? file.clientId
                                    }
                                    src={
                                        localFiles.find(
                                            (local) =>
                                                local.id === file.clientId,
                                        )?.previewUrl
                                    }
                                    name={file.name}
                                    disabled={disabled || downloading}
                                    onDownload={
                                        file.status === 'completed'
                                            ? () => download(file.output)
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
                                                : displayBytes(
                                                      file.declaredBytes,
                                                  )}
                                        </span>
                                    </div>
                                    <p id={`${file.id}-status`}>
                                        <StatusHelp
                                            tone={
                                                file.status === 'completed'
                                                    ? 'success'
                                                    : file.status ===
                                                            'failed' ||
                                                        file.status ===
                                                            'cancelled' ||
                                                        canRetryUpload(
                                                            file,
                                                            uploads[
                                                                file.clientId
                                                            ],
                                                        )
                                                      ? 'warning'
                                                      : file.status ===
                                                              'processing' ||
                                                          uploads[file.clientId]
                                                              ?.status ===
                                                              'sending'
                                                        ? 'busy'
                                                        : 'waiting'
                                            }
                                            help={
                                                file.status === 'completed'
                                                    ? 'Your converted image is ready. Use its download button or download all completed images as ZIP when the batch finishes.'
                                                    : file.status === 'failed'
                                                      ? 'This image could not be converted. Other files continue; try this image again in a new batch.'
                                                      : file.status ===
                                                          'cancelled'
                                                        ? 'This file was stopped before a result was produced.'
                                                        : canRetryUpload(
                                                                file,
                                                                uploads[
                                                                    file
                                                                        .clientId
                                                                ],
                                                            )
                                                          ? 'The upload outcome is uncertain. Retry checks the server before sending the file again.'
                                                          : file.status ===
                                                              'processing'
                                                            ? 'The server is converting this image to your selected format.'
                                                            : 'This image is waiting for upload, server confirmation, or a processing slot. Keep this page open.'
                                            }
                                        >
                                            {fileDisplayState(
                                                file,
                                                uploads[file.clientId],
                                            )}
                                        </StatusHelp>
                                    </p>
                                    {file.status === 'failed' && (
                                        <p id={`${file.id}-error`}>
                                            File conversion failed (
                                            {file.error.type.replace(/_/g, ' ')}
                                            ). Try a new batch with a supported
                                            image.
                                        </p>
                                    )}
                                    {canRetryUpload(
                                        file,
                                        uploads[file.clientId],
                                    ) && (
                                        <Button
                                            disabled={stopped}
                                            onClick={() =>
                                                onRetry(file.clientId)
                                            }
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
                                        onClick={() => download(file.output)}
                                        aria-busy={
                                            downloading &&
                                            downloadTarget ===
                                                file.output.meta.id
                                        }
                                        aria-label={`Download ${file.output.meta.output.storedName}`}
                                        title={`Download ${file.name}`}
                                    >
                                        <DownloadIcon
                                            target={file.output.meta.id}
                                            downloading={downloading}
                                            downloadTarget={downloadTarget}
                                        />
                                    </Button>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
            <p className="text-sm text-muted-foreground">
                {finished
                    ? `${outputs.length} of ${operation.files.length} images ready to download. ${allSucceeded ? 'All images converted successfully. Expand the file list for individual downloads.' : outputs.length ? 'Review the file list for failed or cancelled images; completed results are still available.' : 'No images are available to download. Review the file list, then start a new batch to try again.'}`
                    : 'Keep this page open while images upload and convert. You can download each completed image now; ZIP download becomes available when the batch finishes.'}
            </p>
            {downloading && (
                <p role="status">
                    Preparing {downloadTarget === 'zip' ? 'ZIP' : 'image'}{' '}
                    download… Your browser will save it when ready.
                </p>
            )}
            <div className="flex flex-wrap items-start justify-end gap-3">
                {finished && outputs.length > 0 && (
                    <Button
                        className="self-start"
                        aria-busy={downloading && downloadTarget === 'zip'}
                        disabled={disabled || downloading}
                        onClick={() =>
                            download(outputs.map((output) => output.meta.id))
                        }
                    >
                        <DownloadIcon
                            target="zip"
                            downloading={downloading}
                            downloadTarget={downloadTarget}
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
                <BatchNavigationGuard
                    active={!finished}
                    onLeave={onLeave}
                    onNewBatch={finished ? onNewBatch : undefined}
                />
            </div>
        </section>
    );
}
