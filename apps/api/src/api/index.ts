import { Router } from 'express';
import sessionsRouter from '../routes/sessions.routes';

import createConversionsRouter from '../routes/conversions.routes';
import conversionFilesRouter from '../routes/conversion-files.routes';
import { ConversionIdSchema } from '@image-web-convert/schemas';
import type { ConversionRuntime } from '../services/conversion-runtime.service';
import { sendConversionError } from '../controllers/conversions.http';

export default function createApiRouter(): Router {
    const apiRouter: Router = Router();

    apiRouter.use('/sessions', sessionsRouter);
    // The retired synchronous /uploads route has no handler; it returns 404.
    apiRouter.use('/sessions/:sid', (req, res, next) => {
        if (!ConversionIdSchema.safeParse(req.params.sid).success)
            return next();
        try {
            const runtime = req.app.locals.conversions as ConversionRuntime;
            const release = runtime.acquireSessionUse(req.params.sid);
            res.once('finish', release);
            res.once('close', release);
            next();
        } catch (error) {
            sendConversionError(res, error);
        }
    });
    apiRouter.use('/sessions/:sid/conversions', createConversionsRouter());
    apiRouter.use('/sessions/:sid/files', conversionFilesRouter);

    return apiRouter;
}
