import {
    ApiConversionOperationSchema,
    ApiCreateConversionRequestSchema,
    ConversionIdSchema,
    ConversionOutputSchema,
    ConversionFileErrorSchema,
    SessionImageConfigSchema,
    type ApiConversionOperation,
    type ApiError,
    type ConversionCounts,
    type ConversionFile,
    type ConversionFileError,
    type ConversionOutput,
    type ConversionStopReason,
    type SessionImageConfig,
} from '@image-web-convert/schemas';
import { DEFAULT_IMG_OPTS, type ImageProcessingOptions } from './image.config';

/** Application state only. Persistence, locking, IDs, and scheduling are callers'
 * responsibilities in later phases. All transitions return independent copies
 * and must be persisted before their effects are acted on. */
export type ConversionOperation = Omit<ApiConversionOperation, 'counts'> & {
    schemaVersion: 1;
    requestId: string;
    processingOptions: ImageProcessingOptions;
    limits: SessionImageConfig;
};

export class ConversionTransitionError extends Error {
    constructor(
        public readonly type: ApiError['type'],
        message: string,
    ) {
        super(message);
        this.name = 'ConversionTransitionError';
    }
}

function fail(type: ApiError['type'], message: string): never {
    throw new ConversionTransitionError(type, message);
}

export function isConversionTerminal(operation: ConversionOperation): boolean {
    return ['completed', 'partially_completed', 'failed', 'cancelled'].includes(
        operation.status,
    );
}

export function conversionCounts(
    files: readonly ConversionFile[],
): ConversionCounts {
    const count = (status: ConversionFile['status']) =>
        files.filter((file) => file.status === status).length;
    const completed = count('completed');
    const failed = count('failed');
    const cancelled = count('cancelled');
    return {
        expected: files.length,
        awaitingUpload: count('awaiting_upload'),
        uploaded: files.filter(
            (file) => 'uploadedAt' in file && file.uploadedAt !== undefined,
        ).length,
        processing: count('processing'),
        completed,
        failed,
        cancelled,
        settled: completed + failed + cancelled,
    };
}

/** Explicit allowlist: never spread a persistence record into a response. */
export function conversionSnapshot(
    operation: ConversionOperation,
): ApiConversionOperation {
    return ApiConversionOperationSchema.parse({
        id: operation.id,
        sessionId: operation.sessionId,
        revision: operation.revision,
        status: operation.status,
        options: operation.options,
        files: operation.files,
        counts: conversionCounts(operation.files),
        createdAt: operation.createdAt,
        updatedAt: operation.updatedAt,
        expiresAt: operation.expiresAt,
        queuedAt: operation.queuedAt,
        startedAt: operation.startedAt,
        finishedAt: operation.finishedAt,
        cancelRequestedAt: operation.cancelRequestedAt,
        stopRequestedAt: operation.stopRequestedAt,
        stopReason: operation.stopReason,
    });
}

function timestamp(now: Date): string {
    if (!Number.isFinite(now.getTime()))
        fail('invalid_request', 'Invalid transition time');
    return now.toISOString();
}

export function sanitizeConversionFileName(name: string): string {
    // Treat both separator styles as paths regardless of the local OS.
    return (
        (name.split(/[/\\]/).pop() ?? '')
            .normalize('NFC')
            .replace(/\p{C}/gu, '')
            .replace(/[?%*:|"<>]/g, '_')
            .replace(/\s+/g, ' ')
            .trim() || 'upload'
    );
}

export function createConversionOperation(
    request: unknown,
    context: {
        id: string;
        sessionId: string;
        fileIds: string[];
        expiresAt: string;
        limits: SessionImageConfig;
        now: Date;
        processingOptions?: ImageProcessingOptions;
    },
): ConversionOperation {
    const parsed = ApiCreateConversionRequestSchema.safeParse(request);
    if (!parsed.success)
        fail('invalid_request', 'Invalid conversion manifest or options');
    const intent = parsed.data;
    const limits = SessionImageConfigSchema.parse(context.limits);
    const createdAt = timestamp(context.now);
    const expires = new Date(context.expiresAt);
    if (!Number.isFinite(expires.getTime()))
        fail('invalid_request', 'Invalid session expiry');
    if (expires.getTime() <= context.now.getTime())
        fail('session_expired', 'Session has expired');
    if (
        !ConversionIdSchema.safeParse(context.id).success ||
        !ConversionIdSchema.safeParse(context.sessionId).success ||
        context.fileIds.length !== intent.files.length ||
        new Set(context.fileIds).size !== context.fileIds.length ||
        context.fileIds.some((id) => !ConversionIdSchema.safeParse(id).success)
    ) {
        fail('invalid_request', 'Expected distinct server-assigned file slots');
    }
    const bytes = intent.files.reduce((sum, file) => sum + file.sizeBytes, 0);
    if (
        intent.files.length > limits.maxFiles ||
        bytes > limits.maxTotalBytes ||
        intent.files.some((file) => file.sizeBytes > limits.maxBytesPerFile)
    ) {
        fail('upload_limit_exceeded', 'Manifest exceeds session limits');
    }
    return {
        schemaVersion: 1,
        id: context.id,
        sessionId: context.sessionId,
        requestId: intent.requestId,
        revision: 0,
        status: 'awaiting_uploads',
        options: intent.options,
        processingOptions: {
            ...(context.processingOptions ?? DEFAULT_IMG_OPTS),
        },
        limits,
        files: intent.files.map((file, index) => ({
            id: context.fileIds[index],
            clientId: file.clientId,
            name: sanitizeConversionFileName(file.name),
            declaredBytes: file.sizeBytes,
            status: 'awaiting_upload',
        })),
        createdAt,
        updatedAt: createdAt,
        expiresAt: expires.toISOString(),
        queuedAt: null,
        startedAt: null,
        finishedAt: null,
        cancelRequestedAt: null,
        stopRequestedAt: null,
        stopReason: null,
    };
}

function fileIndex(operation: ConversionOperation, fileId: string): number {
    const index = operation.files.findIndex((file) => file.id === fileId);
    if (index === -1)
        fail('file_not_found', 'File does not belong to this operation');
    return index;
}

function assertCanWork(operation: ConversionOperation, now: Date): void {
    timestamp(now);
    if (now.getTime() >= new Date(operation.expiresAt).getTime()) {
        fail('session_expired', 'Session has expired');
    }
    if (isConversionTerminal(operation) || operation.stopReason) {
        fail('conversion_conflict', 'Operation no longer accepts work');
    }
}

function changed(
    operation: ConversionOperation,
    now: Date,
): ConversionOperation {
    const updatedAt = timestamp(now);
    if (now.getTime() < new Date(operation.updatedAt).getTime()) {
        fail('invalid_request', 'Transition time cannot move backwards');
    }
    return {
        ...structuredClone(operation),
        revision: operation.revision + 1,
        updatedAt,
    };
}

/** Reconcile readiness/outcome in the same transition as the triggering event. */
function settle(
    operation: ConversionOperation,
    now: Date,
): ConversionOperation {
    const counts = conversionCounts(operation.files);
    if (counts.settled === counts.expected) {
        operation.status = operation.cancelRequestedAt
            ? 'cancelled'
            : counts.completed === counts.expected
              ? 'completed'
              : counts.completed > 0
                ? 'partially_completed'
                : 'failed';
        operation.finishedAt = timestamp(now);
    } else if (counts.processing > 0 || operation.startedAt !== null) {
        operation.status = 'processing';
    } else if (counts.awaitingUpload > 0) {
        operation.status = 'awaiting_uploads';
    } else {
        operation.status = 'queued';
        operation.queuedAt ??= timestamp(now);
    }
    return operation;
}

/** Call only after full bytes have been staged. An upload interruption calls no
 * transition; the slot remains retryable. An accepted slot is immutable. */
export function acceptConversionUpload(
    operation: ConversionOperation,
    fileId: string,
    actualBytes: number,
    now: Date,
): ConversionOperation {
    const index = fileIndex(operation, fileId);
    const file = operation.files[index];
    timestamp(now);
    // A lost acknowledgement may be retried after processing already finished.
    // This acknowledges existing bytes only; stopped/expired slots still reject.
    if (
        'uploadedAt' in file &&
        file.uploadedAt &&
        !operation.stopReason &&
        now.getTime() < new Date(operation.expiresAt).getTime()
    )
        return structuredClone(operation);
    assertCanWork(operation, now);
    if (file.status !== 'awaiting_upload')
        fail('stale_file_upload', 'File slot no longer accepts uploads');
    if (!Number.isSafeInteger(actualBytes) || actualBytes < 0)
        fail('invalid_request', 'Invalid byte count');
    if (actualBytes > operation.limits.maxBytesPerFile)
        fail('upload_limit_exceeded', 'File exceeds byte limit');
    if (actualBytes !== file.declaredBytes)
        fail('upload_size_mismatch', 'Uploaded bytes differ from manifest');
    const next = changed(operation, now);
    next.files[index] = {
        ...file,
        status: 'uploaded',
        actualBytes,
        uploadedAt: timestamp(now),
    };
    return settle(next, now);
}

/** Only permanent upload rejection resolves a slot; storage/network failures
 * before acceptance stay retryable. The controller decides whether to retry. */
export function rejectConversionUpload(
    operation: ConversionOperation,
    fileId: string,
    error: ConversionFileError,
    now: Date,
): ConversionOperation {
    const index = fileIndex(operation, fileId);
    assertCanWork(operation, now);
    const file = operation.files[index];
    const parsedError = ConversionFileErrorSchema.parse(error);
    if (
        ![
            'upload_limit_exceeded',
            'upload_size_mismatch',
            'unsupported_image',
            'malformed_image',
        ].includes(parsedError.type)
    ) {
        fail(
            'invalid_request',
            'Only permanent upload failures resolve the slot',
        );
    }
    if (file.status !== 'awaiting_upload')
        fail('stale_file_upload', 'File slot no longer accepts rejection');
    const next = changed(operation, now);
    next.files[index] = {
        ...file,
        status: 'failed',
        error: parsedError,
        finishedAt: timestamp(now),
    };
    return settle(next, now);
}

/** Recovery may discover a lost accepted input before conversion starts, even
 * while another slot is still awaiting upload. Do not manufacture a start. */
export function failUploadedConversionFile(
    operation: ConversionOperation,
    fileId: string,
    error: ConversionFileError,
    now: Date,
): ConversionOperation {
    const index = fileIndex(operation, fileId);
    assertCanWork(operation, now);
    const file = operation.files[index];
    if (file.status !== 'uploaded')
        fail('conversion_conflict', 'Only an uploaded file can lose its input');
    const next = changed(operation, now);
    next.files[index] = {
        ...file,
        status: 'failed',
        error: ConversionFileErrorSchema.parse(error),
        finishedAt: timestamp(now),
    };
    return settle(next, now);
}

/** Scheduling policy/concurrency lives in the later worker, not this contract. */
export function startConversionFile(
    operation: ConversionOperation,
    fileId: string,
    now: Date,
): ConversionOperation {
    const index = fileIndex(operation, fileId);
    assertCanWork(operation, now);
    const file = operation.files[index];
    if (
        !['queued', 'processing'].includes(operation.status) ||
        file.status !== 'uploaded'
    ) {
        fail('conversion_conflict', 'File is not ready for processing');
    }
    const next = changed(operation, now);
    next.files[index] = {
        ...file,
        status: 'processing',
        startedAt: timestamp(now),
    };
    next.startedAt ??= timestamp(now);
    return settle(next, now);
}

export function requestConversionStop(
    operation: ConversionOperation,
    reason: ConversionStopReason,
    now: Date,
): ConversionOperation {
    timestamp(now);
    if (isConversionTerminal(operation)) return structuredClone(operation);
    if (
        reason === 'session_expired' &&
        now.getTime() < new Date(operation.expiresAt).getTime()
    ) {
        fail('invalid_request', 'Session has not expired');
    }
    if (
        reason === 'conversion_timeout' &&
        !operation.files.some((file) => file.status === 'processing')
    ) {
        fail('conversion_conflict', 'No active conversion to time out');
    }
    // A timeout/expiry may supersede a user stop to prevent late publication,
    // but accepted user cancellation retains terminal precedence.
    const cancelRequestedAt =
        reason === 'user_cancelled'
            ? (operation.cancelRequestedAt ?? timestamp(now))
            : operation.cancelRequestedAt;
    const stopReason =
        operation.stopReason && reason === 'user_cancelled'
            ? operation.stopReason
            : reason;
    if (
        operation.stopReason === stopReason &&
        operation.cancelRequestedAt === cancelRequestedAt
    )
        return structuredClone(operation);
    const next = changed(operation, now);
    next.cancelRequestedAt = cancelRequestedAt;
    next.stopRequestedAt ??= timestamp(now);
    next.stopReason = stopReason;
    next.files = next.files.map((file) => {
        if (file.status !== 'awaiting_upload' && file.status !== 'uploaded')
            return file;
        return {
            ...file,
            status: 'cancelled',
            reason: stopReason,
            finishedAt: timestamp(now),
        };
    });
    return settle(next, now);
}

function stopError(
    operation: ConversionOperation,
): ConversionFileError | undefined {
    if (operation.stopReason === 'conversion_timeout')
        return {
            type: 'conversion_timeout',
            message: 'Conversion deadline exceeded',
        };
    if (operation.stopReason === 'session_expired')
        return {
            type: 'session_expired',
            message: 'Session expired during conversion',
        };
    return undefined;
}

/** Called only after the invocation settles. On timeout/expiry, callers must
 * discard uncommitted artifacts; this function does not terminate conversion. */
export function finishConversionFile(
    operation: ConversionOperation,
    fileId: string,
    outcome: { output: ConversionOutput } | { error: ConversionFileError },
    now: Date,
): ConversionOperation {
    const index = fileIndex(operation, fileId);
    const file = operation.files[index];
    if (file.status !== 'processing')
        fail('conversion_conflict', 'Only a processing file can finish');
    const stopped =
        now.getTime() >= new Date(operation.expiresAt).getTime()
            ? requestConversionStop(operation, 'session_expired', now)
            : operation;
    const next = changed(stopped, now);
    const error =
        stopError(stopped) ??
        ('error' in outcome
            ? ConversionFileErrorSchema.parse(outcome.error)
            : undefined);
    if (error) {
        next.files[index] = {
            ...file,
            status: 'failed',
            error,
            finishedAt: timestamp(now),
        };
    } else if ('output' in outcome) {
        const output = ConversionOutputSchema.parse(outcome.output);
        if (
            output.meta.id !== file.id ||
            output.meta.output.mime !== operation.options.outputMime ||
            output.meta.original.sizeBytes !== file.actualBytes
        ) {
            fail(
                'conversion_conflict',
                'Output does not match the file slot and options',
            );
        }
        next.files[index] = {
            ...file,
            status: 'completed',
            output,
            finishedAt: timestamp(now),
        };
    }
    return settle(next, now);
}
