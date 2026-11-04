import { loadEnv } from '../env';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
    create,
    show,
    upload,
    cancel,
} from '../controllers/conversions.controller';
import { conversionHandler } from '../controllers/conversions.http';
import { requireJson } from '../controllers/request.http';

export default function createConversionsRouter(): Router {
    const router = Router({ mergeParams: true });
    // Separate from command limits: 500 ms polling is 120 requests/minute per UI.
    const env = loadEnv();
    const polling = rateLimit({
        windowMs: env.RATE_LIMIT_WINDOW_MS,
        max: env.POLLING_RATE_LIMIT_MAX,
        standardHeaders: true,
        legacyHeaders: false,
        message: {
            type: 'invalid_request',
            message: 'Too many status requests; retry shortly',
        },
    });
    router.post('/', requireJson, conversionHandler(create));
    router.get('/:operationId', polling, conversionHandler(show));
    router.put('/:operationId/files/:fileId', conversionHandler(upload));
    router.post('/:operationId/cancel', conversionHandler(cancel));
    return router;
}
