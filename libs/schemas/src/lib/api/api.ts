import { z } from 'zod';
import { OutputMimeTypeSchema } from '../image.js';
import { SessionImageConfigSchema } from '../session.config.js';

const IsoDateTimeSchema = z.string().datetime({ offset: true });

export const ApiCreateSessionResponseSchema = z.object({
    sid: z.string().min(1),
    expiresAt: IsoDateTimeSchema,
    token: z.string().min(1),
    imageConfig: SessionImageConfigSchema,
});
export type ApiCreateSessionResponse = z.infer<
    typeof ApiCreateSessionResponseSchema
>;

export const UploadMetaSchema = z.object({
    id: z.string().min(1),
    original: z.object({
        name: z.string(),
        mime: z.string().optional(),
        sizeBytes: z.number().nonnegative().optional(),
        width: z.number().int().positive().optional(),
        height: z.number().int().positive().optional(),
        pages: z.number().int().positive().optional(),
    }),
    output: z.object({
        storedName: z.string().min(1),
        mime: OutputMimeTypeSchema,
        sizeBytes: z.number().nonnegative(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        hasAlpha: z.boolean(),
        colorSpace: z.literal('srgb'),
    }),
    exifStripped: z.literal(true),
    animated: z.boolean(),
    uploadedAt: IsoDateTimeSchema,
});
export type UploadMeta = z.infer<typeof UploadMetaSchema>;
export type ApiUploadMeta = UploadMeta;

export const ApiUploadAcceptedSchema = z.object({
    id: z.string().min(1),
    url: z.string().min(1),
    metaUrl: z.string().min(1),
    meta: UploadMetaSchema,
    clientId: z.string().optional(),
});
export type ApiUploadAccepted = z.infer<typeof ApiUploadAcceptedSchema>;

export const ApiUploadRejectedSchema = z.object({
    fileName: z.string(),
    error: z.string(),
    clientId: z.string().optional(),
});
export type ApiUploadRejected = z.infer<typeof ApiUploadRejectedSchema>;

export const ApiUploadsResponseSchema = z.object({
    status: z.enum(['ok', 'partial']),
    accepted: z.array(ApiUploadAcceptedSchema),
    rejected: z.array(ApiUploadRejectedSchema),
});
export type ApiUploadsResponse = z.infer<typeof ApiUploadsResponseSchema>;

/** Decoded upload fields after multipart strings have been parsed. */
export const ApiUploadsRequestSchema = z.object({
    outputMime: OutputMimeTypeSchema,
    clientIds: z.array(z.string()),
});
export type ApiUploadsRequest = z.infer<typeof ApiUploadsRequestSchema>;

export const ApiDownloadFilesRequestSchema = z.object({
    ids: z.array(z.string().min(1)).min(1),
    archiveName: z.string().min(1).optional(),
});
export type ApiDownloadFilesRequest = z.infer<
    typeof ApiDownloadFilesRequestSchema
>;
