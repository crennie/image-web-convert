import { z } from 'zod';
import { OutputMimeTypeSchema } from '../image.js';
import { UploadMetaSchema } from './api.js';

const TimestampSchema = z.string().datetime({ offset: true });
const BytesSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
// Server-assigned identifiers may become path segments in subsequent phases.
export const ConversionIdSchema = z.string().regex(/^[A-Za-z0-9_-]+$/);

export const ApiCreateConversionRequestSchema = z
    .strictObject({
        requestId: z.string().min(1).max(200),
        options: z.strictObject({ outputMime: OutputMimeTypeSchema }),
        files: z
            .array(
                z.strictObject({
                    clientId: z.string().min(1).max(200),
                    name: z.string().min(1).max(1024),
                    sizeBytes: BytesSchema,
                }),
            )
            .min(1),
    })
    .superRefine(({ files }, ctx) => {
        const seen = new Set<string>();
        files.forEach((file, index) => {
            if (seen.has(file.clientId)) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['files', index, 'clientId'],
                    message: 'Client IDs must be unique',
                });
            }
            seen.add(file.clientId);
        });
    });
export type ApiCreateConversionRequest = z.infer<
    typeof ApiCreateConversionRequestSchema
>;

export const ConversionOperationStatusSchema = z.enum([
    'awaiting_uploads',
    'queued',
    'processing',
    'completed',
    'partially_completed',
    'failed',
    'cancelled',
]);
export type ConversionOperationStatus = z.infer<
    typeof ConversionOperationStatusSchema
>;

export const ConversionFileStatusSchema = z.enum([
    'awaiting_upload',
    'uploaded',
    'processing',
    'completed',
    'failed',
    'cancelled',
]);
export type ConversionFileStatus = z.infer<typeof ConversionFileStatusSchema>;

export const ConversionStopReasonSchema = z.enum([
    'user_cancelled',
    'conversion_timeout',
    'session_expired',
]);
export type ConversionStopReason = z.infer<typeof ConversionStopReasonSchema>;

export const ConversionFileErrorSchema = z.object({
    type: z.enum([
        'upload_limit_exceeded',
        'upload_size_mismatch',
        'unsupported_image',
        'malformed_image',
        'conversion_failed',
        'storage_error',
        'conversion_timeout',
        'processing_interrupted',
        'session_expired',
    ]),
    message: z.string(),
});
export type ConversionFileError = z.infer<typeof ConversionFileErrorSchema>;

export const ConversionOutputSchema = z.object({
    url: z.string().min(1),
    metaUrl: z.string().min(1),
    meta: UploadMetaSchema,
});
export type ConversionOutput = z.infer<typeof ConversionOutputSchema>;

const FileFields = {
    id: ConversionIdSchema,
    clientId: z.string().min(1),
    name: z.string().min(1),
    declaredBytes: BytesSchema,
};
const UploadedFields = {
    actualBytes: BytesSchema,
    uploadedAt: TimestampSchema,
};
// Discriminated states prevent a completed file without an output, or an
// awaiting-upload file with pretend server-side network progress.
export const ConversionFileSchema = z
    .discriminatedUnion('status', [
        z.object({ ...FileFields, status: z.literal('awaiting_upload') }),
        z.object({
            ...FileFields,
            ...UploadedFields,
            status: z.literal('uploaded'),
        }),
        z.object({
            ...FileFields,
            ...UploadedFields,
            status: z.literal('processing'),
            startedAt: TimestampSchema,
        }),
        z.object({
            ...FileFields,
            ...UploadedFields,
            status: z.literal('completed'),
            startedAt: TimestampSchema,
            finishedAt: TimestampSchema,
            output: ConversionOutputSchema,
        }),
        z.object({
            ...FileFields,
            actualBytes: BytesSchema.optional(),
            uploadedAt: TimestampSchema.optional(),
            startedAt: TimestampSchema.optional(),
            status: z.literal('failed'),
            finishedAt: TimestampSchema,
            error: ConversionFileErrorSchema,
        }),
        z.object({
            ...FileFields,
            actualBytes: BytesSchema.optional(),
            uploadedAt: TimestampSchema.optional(),
            status: z.literal('cancelled'),
            finishedAt: TimestampSchema,
            reason: ConversionStopReasonSchema,
        }),
    ])
    .superRefine((file, ctx) => {
        const hasBytes =
            'actualBytes' in file && file.actualBytes !== undefined;
        const hasUploadTime =
            'uploadedAt' in file && file.uploadedAt !== undefined;
        if (hasBytes !== hasUploadTime) {
            ctx.addIssue({
                code: 'custom',
                message:
                    'Accepted upload requires bytes and timestamp together',
            });
        }
        if (
            'actualBytes' in file &&
            file.actualBytes !== undefined &&
            file.actualBytes !== file.declaredBytes
        ) {
            ctx.addIssue({
                code: 'custom',
                message: 'Accepted bytes must match the manifest',
            });
        }
        if (
            file.status === 'completed' &&
            (file.output.meta.id !== file.id ||
                file.output.meta.original.sizeBytes !== file.actualBytes)
        ) {
            ctx.addIssue({
                code: 'custom',
                message: 'Output must belong to its file slot',
            });
        }
    });
export type ConversionFile = z.infer<typeof ConversionFileSchema>;

export const ConversionCountsSchema = z.object({
    expected: z.number().int().positive(),
    awaitingUpload: z.number().int().nonnegative(),
    // Cumulative accepted uploads, including files that have since settled.
    uploaded: z.number().int().nonnegative(),
    processing: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    cancelled: z.number().int().nonnegative(),
    settled: z.number().int().nonnegative(),
});
export type ConversionCounts = z.infer<typeof ConversionCountsSchema>;

// Creation, upload acknowledgement, status, and cancel all return this snapshot.
// Parsing strips internal fields; application projection must also be explicit.
export const ApiConversionOperationSchema = z
    .object({
        id: ConversionIdSchema,
        sessionId: ConversionIdSchema,
        revision: z.number().int().nonnegative(),
        status: ConversionOperationStatusSchema,
        options: z.object({ outputMime: OutputMimeTypeSchema }),
        files: z.array(ConversionFileSchema).min(1),
        counts: ConversionCountsSchema,
        createdAt: TimestampSchema,
        updatedAt: TimestampSchema,
        expiresAt: TimestampSchema,
        queuedAt: TimestampSchema.nullable(),
        startedAt: TimestampSchema.nullable(),
        finishedAt: TimestampSchema.nullable(),
        cancelRequestedAt: TimestampSchema.nullable(),
        stopRequestedAt: TimestampSchema.nullable(),
        stopReason: ConversionStopReasonSchema.nullable(),
    })
    .superRefine((operation, ctx) => {
        const count = (status: ConversionFileStatus) =>
            operation.files.filter((file) => file.status === status).length;
        const counts: ConversionCounts = {
            expected: operation.files.length,
            awaitingUpload: count('awaiting_upload'),
            uploaded: operation.files.filter(
                (file) => 'uploadedAt' in file && file.uploadedAt !== undefined,
            ).length,
            processing: count('processing'),
            completed: count('completed'),
            failed: count('failed'),
            cancelled: count('cancelled'),
            settled: count('completed') + count('failed') + count('cancelled'),
        };
        for (const key of Object.keys(counts) as (keyof ConversionCounts)[]) {
            if (operation.counts[key] !== counts[key]) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['counts', key],
                    message: 'Count must match file records',
                });
            }
        }
        const terminal = [
            'completed',
            'partially_completed',
            'failed',
            'cancelled',
        ].includes(operation.status);
        if (
            terminal !== (counts.settled === counts.expected) ||
            terminal !== (operation.finishedAt !== null)
        ) {
            ctx.addIssue({
                code: 'custom',
                message:
                    'Terminal status requires all files settled and a finish timestamp',
            });
        }
        if (
            (operation.stopReason === null) !==
                (operation.stopRequestedAt === null) ||
            (operation.cancelRequestedAt !== null &&
                operation.stopReason === null)
        ) {
            ctx.addIssue({
                code: 'custom',
                message: 'Stop reason and request timestamps must agree',
            });
        }
        if (
            new Set(operation.files.map((file) => file.id)).size !==
                operation.files.length ||
            new Set(operation.files.map((file) => file.clientId)).size !==
                operation.files.length
        ) {
            ctx.addIssue({
                code: 'custom',
                message: 'File and client IDs must be unique',
            });
        }
        if (
            operation.files.some(
                (file) =>
                    file.status === 'completed' &&
                    file.output.meta.output.mime !==
                        operation.options.outputMime,
            )
        ) {
            ctx.addIssue({
                code: 'custom',
                message: 'Output MIME must match operation options',
            });
        }
    });
export type ApiConversionOperation = z.infer<
    typeof ApiConversionOperationSchema
>;
