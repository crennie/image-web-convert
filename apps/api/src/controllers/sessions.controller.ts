import type { Request, Response, NextFunction } from 'express';
import { create } from '../services/sessions.service';
import { ApiCreateSessionResponse } from '@image-web-convert/schemas';

export async function createSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
        const { sid, expiresAt, accessToken } = await create();
        const response: ApiCreateSessionResponse = {
            sid,
            expiresAt,
            token: accessToken,
        }
        res.status(201).json(response);
    } catch (err) {
        next(err);
    }
}
