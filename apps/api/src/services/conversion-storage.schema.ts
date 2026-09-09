import { z } from 'zod';
import {
    ApiConversionOperationSchema,
    ConversionFileSchema,
    ConversionIdSchema,
    ConversionOutputSchema,
    SessionImageConfigSchema,
} from '@image-web-convert/schemas';
import {
    conversionCounts,
    type ConversionOperation,
} from './conversions.service';

const InternalOperationSchema = z
    .object({
        schemaVersion: z.literal(1),
        requestId: z.string().min(1),
        limits: SessionImageConfigSchema,
        processingOptions: z.object({
            quality: z.number().int().min(1).max(100),
            effort: z.number().int().min(0).max(6),
            maxDimension: z.number().int().nonnegative(),
            normalizeColorSpace: z.literal('srgb'),
            stripMetadata: z.literal(true),
            animatedPolicy: z.enum(['first-frame', 'reject']),
            limitInputPixels: z.number().int().positive(),
        }),
        files: z.array(ConversionFileSchema).min(1),
    })
    .passthrough();

export const FingerprintSchema = z.object({
    bytes: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export type Fingerprint = z.infer<typeof FingerprintSchema>;

const StoredEnvelopeSchema = z.object({
    operation: InternalOperationSchema,
    inputs: z.record(
        ConversionIdSchema,
        FingerprintSchema.extend({ storedName: ConversionIdSchema }),
    ),
});
export type StoredConversion = {
    operation: ConversionOperation;
    inputs: z.infer<typeof StoredEnvelopeSchema>['inputs'];
};

export const ConversionCommitSchema = z.object({
    operationId: ConversionIdSchema,
    fileId: ConversionIdSchema,
    finishedAt: z.string().datetime({ offset: true }),
    fingerprint: FingerprintSchema,
    output: ConversionOutputSchema,
});
export type ConversionCommit = z.infer<typeof ConversionCommitSchema>;

/** Validate disk state independently of TypeScript assertions. Counts are never
 * persisted: validate the public projection using counts derived from files. */
export function parseStoredConversion(value: unknown): StoredConversion {
    const parsed = StoredEnvelopeSchema.parse(value);
    const internal = parsed.operation;
    const snapshot = ApiConversionOperationSchema.parse({
        ...internal,
        counts: conversionCounts(internal.files),
    });
    const { counts, ...publicState } = snapshot;
    const operation: ConversionOperation = {
        ...publicState,
        schemaVersion: 1,
        requestId: internal.requestId,
        limits: internal.limits,
        processingOptions: internal.processingOptions,
    };
    const expectedStatus =
        counts.settled === counts.expected
            ? operation.cancelRequestedAt
                ? 'cancelled'
                : counts.completed === counts.expected
                  ? 'completed'
                  : counts.completed > 0
                    ? 'partially_completed'
                    : 'failed'
            : operation.startedAt
              ? 'processing'
              : counts.awaitingUpload > 0
                ? 'awaiting_uploads'
                : 'queued';
    if (
        operation.status !== expectedStatus ||
        (counts.awaitingUpload > 0 && operation.startedAt !== null) ||
        (counts.processing > 0 && operation.startedAt === null) ||
        (operation.stopReason &&
            operation.files.some((file) =>
                ['awaiting_upload', 'uploaded'].includes(file.status),
            ))
    ) {
        throw new Error('Operation lifecycle contradicts file records');
    }
    if (
        operation.files.length > operation.limits.maxFiles ||
        operation.files.some(
            (file) => file.declaredBytes > operation.limits.maxBytesPerFile,
        ) ||
        operation.files.reduce((sum, file) => sum + file.declaredBytes, 0) >
            operation.limits.maxTotalBytes
    ) {
        throw new Error('Manifest exceeds persisted limits');
    }
    const acceptedIds = operation.files
        .filter((file) => 'uploadedAt' in file && file.uploadedAt)
        .map((file) => file.id);
    if (
        Object.keys(parsed.inputs).length !== acceptedIds.length ||
        acceptedIds.some((id) => !parsed.inputs[id])
    ) {
        throw new Error('Input references must match accepted slots');
    }
    for (const file of operation.files) {
        const input = parsed.inputs[file.id];
        if (
            input &&
            (input.storedName !== file.id || input.bytes !== file.declaredBytes)
        ) {
            throw new Error('Invalid input reference');
        }
    }
    return { operation, inputs: parsed.inputs };
}
