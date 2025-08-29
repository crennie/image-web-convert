import { Router } from 'express';
import uploadRouter from '../routes/upload.routes';
import filesRouter from '../routes/files.routes';

const apiRouter = Router();

apiRouter.use('/upload', uploadRouter);
apiRouter.use('/files', filesRouter);

export default apiRouter;
