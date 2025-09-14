import { Router } from 'express';
import sessionsRouter from '../routes/sessions.routes';
import uploadsRouter from '../routes/uploads.routes';
import filesRouter from '../routes/files.routes';

const apiRouter: Router = Router();

apiRouter.use('/sessions', sessionsRouter);
apiRouter.use('/sessions/:sid/uploads', uploadsRouter);
apiRouter.use('/sessions/:sid/files', filesRouter);

export default apiRouter;
