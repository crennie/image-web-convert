import { Router } from 'express';
import sessionsRouter from '../routes/sessions.routes';
import uploadsRouter from '../routes/uploads.routes';
import filesRouter from '../routes/files.routes';

import createConversionsRouter from '../routes/conversions.routes';
import conversionFilesRouter from '../routes/conversion-files.routes';

export default function createApiRouter(): Router {
    const apiRouter: Router = Router();

    apiRouter.use('/sessions', sessionsRouter);
    apiRouter.use('/sessions/:sid/uploads', uploadsRouter);
    apiRouter.use('/sessions/:sid/conversions', createConversionsRouter());
    apiRouter.use('/sessions/:sid/files', conversionFilesRouter);
    apiRouter.use('/sessions/:sid/files', filesRouter);

    return apiRouter;
}
