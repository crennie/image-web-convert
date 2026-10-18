import type { Request, Response, NextFunction } from 'express';
import { create, SessionStorageError } from '../services/sessions.service';
import { ApiCreateSessionResponse } from '@image-web-convert/schemas';
import { safeErrorSummary } from '@image-web-convert/observability';

export async function createSession(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const { sid, expiresAt, accessToken, imageConfig } = await create();
        const response: ApiCreateSessionResponse = {
            sid,
            expiresAt,
            token: accessToken,
            imageConfig,
        };
        res.status(201).json(response);
    } catch (err) {
        if (err instanceof SessionStorageError) {
            console.error(
                'Session creation storage failure',
                safeErrorSummary(err),
            );
            req.app?.locals.onStorageFault?.(err);
            res.status(503).json({
                type: 'storage_error',
                message: 'Session storage is unavailable',
            });
            return;
        }
        next(err);
    }
}
