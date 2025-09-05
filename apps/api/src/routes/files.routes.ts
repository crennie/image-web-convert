import { Router } from 'express';
import { show, meta, downloadMany } from '../controllers/files.controller';

const filesRouter = Router({ mergeParams: true });

filesRouter.get('/:fileId', show);
filesRouter.get('/:fileId/meta', meta);
filesRouter.post('/download', downloadMany);

export default filesRouter;
