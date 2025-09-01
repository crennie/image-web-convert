import { Router } from 'express';
import { show, meta, downloadMany } from '../controllers/files.controller';

const filesRouter = Router({ mergeParams: true });

filesRouter.get('/:fileId', show);
filesRouter.get('/:fileId/meta', meta);
filesRouter.post('/download', downloadMany);

filesRouter.use((req, _res, next) => {
    console.log('filesRouter', req.method, req.originalUrl, req.params);
    next();
});

export default filesRouter;
