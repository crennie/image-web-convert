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

export const ApiDownloadFilesRequestSchema = z.object({
    ids: z
        .array(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/))
        .min(1)
        .max(32)
        .refine(
            (ids) => new Set(ids).size === ids.length,
            'Duplicate file IDs are not allowed',
        ),
    archiveName: z.string().min(1).max(128).optional(),
});
export type ApiDownloadFilesRequest = z.infer<
    typeof ApiDownloadFilesRequestSchema
>;
