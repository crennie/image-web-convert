import { Router } from 'express';
import sessionsRouter from '../routes/sessions.routes';
import filesRouter from '../routes/files.routes';

import createConversionsRouter from '../routes/conversions.routes';
import conversionFilesRouter from '../routes/conversion-files.routes';

export default function createApiRouter(): Router {
    const apiRouter: Router = Router();

    apiRouter.use('/sessions', sessionsRouter);
    // Synchronous /uploads is retired. Unmatched requests return 404 without
    // loading its multipart parser or starting the legacy converter.
    apiRouter.use('/sessions/:sid/conversions', createConversionsRouter());
    apiRouter.use('/sessions/:sid/files', conversionFilesRouter);
    apiRouter.use('/sessions/:sid/files', filesRouter);

    return apiRouter;
}
