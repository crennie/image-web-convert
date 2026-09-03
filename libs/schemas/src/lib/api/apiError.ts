import { z } from 'zod';

function apiErrorSchema<T extends string>(type: T) {
    return z.object({
        type: z.literal(type),
        message: z.string().optional(),
    });
}

export const ApiErrorTokenSchema = apiErrorSchema('invalid_token');
export type ApiErrorToken = z.infer<typeof ApiErrorTokenSchema>;

export const ApiErrorSessionNotFoundSchema =
    apiErrorSchema('session_not_found');
export type ApiErrorSessionNotFound = z.infer<
    typeof ApiErrorSessionNotFoundSchema
>;

export const ApiErrorSessionExpiredSchema = apiErrorSchema('session_expired');
export type ApiErrorSessionExpired = z.infer<
    typeof ApiErrorSessionExpiredSchema
>;

export const ApiUploadsErrorSessionUsedSchema = apiErrorSchema('session_used');
export type ApiUploadsErrorSessionUsed = z.infer<
    typeof ApiUploadsErrorSessionUsedSchema
>;

export const ApiUploadsErrorInProgressSchema = apiErrorSchema(
    'upload_in_progress',
);
export type ApiUploadsErrorInProgress = z.infer<
    typeof ApiUploadsErrorInProgressSchema
>;

export const ApiUploadsErrorMimeSchema = apiErrorSchema('invalid_output_mime');
export type ApiUploadsErrorMime = z.infer<typeof ApiUploadsErrorMimeSchema>;

export const ApiUploadsErrorMissingFilesSchema =
    apiErrorSchema('missing_files');
export type ApiUploadsErrorMissingFiles = z.infer<
    typeof ApiUploadsErrorMissingFilesSchema
>;

export const ApiUploadsErrorFilesSchema = apiErrorSchema('upload_error');
export type ApiUploadsErrorFiles = z.infer<typeof ApiUploadsErrorFilesSchema>;

export const ApiErrorInvalidRequestSchema = apiErrorSchema('invalid_request');
export type ApiErrorInvalidRequest = z.infer<
    typeof ApiErrorInvalidRequestSchema
>;

export const ApiErrorFileNotFoundSchema = apiErrorSchema('file_not_found');
export type ApiErrorFileNotFound = z.infer<typeof ApiErrorFileNotFoundSchema>;

export const ApiErrorSessionNotReadySchema =
    apiErrorSchema('session_not_ready');
export type ApiErrorSessionNotReady = z.infer<
    typeof ApiErrorSessionNotReadySchema
>;

export const ApiErrorUploadLimitExceededSchema = apiErrorSchema(
    'upload_limit_exceeded',
);
export type ApiErrorUploadLimitExceeded = z.infer<
    typeof ApiErrorUploadLimitExceededSchema
>;

export const ApiErrorSchema = z.discriminatedUnion('type', [
    ApiErrorTokenSchema,
    ApiErrorSessionNotFoundSchema,
    ApiErrorSessionExpiredSchema,
    ApiUploadsErrorSessionUsedSchema,
    ApiUploadsErrorInProgressSchema,
    ApiUploadsErrorMimeSchema,
    ApiUploadsErrorMissingFilesSchema,
    ApiUploadsErrorFilesSchema,
    ApiErrorInvalidRequestSchema,
    ApiErrorFileNotFoundSchema,
    ApiErrorSessionNotReadySchema,
    ApiErrorUploadLimitExceededSchema,
]);
export type ApiError = z.infer<typeof ApiErrorSchema>;
