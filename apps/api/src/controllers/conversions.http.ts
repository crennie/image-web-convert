import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { ConversionIdSchema } from '@image-web-convert/schemas';
import { ConversionTransitionError } from '../services/conversions.service';
import { ConversionStorageError } from '../services/conversion-storage.service';
import type { ConversionRuntime } from '../services/conversion-runtime.service';
import { validateRequestWithToken } from '../services/auth.service';

export function conversionRuntime(req: Request): ConversionRuntime {
    return req.app.locals.conversions;
}
export function sendConversionError(res: Response, error: unknown) {
    if (res.destroyed) return;
    if (res.headersSent) {
        res.destroy();
        return;
    }
    if (error instanceof ConversionTransitionError) {
        const statuses: Partial<Record<string, number>> = {
            operation_not_found: 404,
            file_not_found: 404,
            session_expired: 403,
            conversion_conflict: 409,
            stale_file_upload: 409,
            upload_in_progress: 409,
            conversion_capacity_exceeded: 503,
            upload_limit_exceeded: 413,
        };
        const status = statuses[error.type] ?? 400;
        return res
            .status(status)
            .json({ type: error.type, message: error.message });
    }
    console.error('Conversion request failed', error);
    return res
        .status(error instanceof ConversionStorageError ? 503 : 500)
        .json({
            type: 'storage_error',
            message: 'Conversion storage is unavailable',
        });
}
export function conversionHandler(
    fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
    return (req, res, next) => {
        void fn(req, res, next).catch((error) =>
            sendConversionError(res, error),
        );
    };
}
export async function authorizeConversion(req: Request, res: Response) {
    if (
        Object.values(req.params).some(
            (value) => !ConversionIdSchema.safeParse(value).success,
        )
    ) {
        res.status(400).json({
            type: 'invalid_request',
            message: 'Invalid identifier',
        });
        return;
    }
    const auth = await validateRequestWithToken(req, res);
    if (!auth.valid) {
        res.status(auth.status).json(auth.apiError);
        return;
    }
    return auth.info;
}
