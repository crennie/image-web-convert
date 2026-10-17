import { Router, type RequestHandler } from 'express';
import { show, meta, downloadMany } from '../controllers/files.controller';
import { requireJson } from '../controllers/request.http';

const filesRouter: Router = Router({ mergeParams: true });

const forwardAsync =
    (handler: typeof show | typeof meta): RequestHandler =>
    (req, res, next) => {
        void handler(req, res, next).catch(next);
    };

filesRouter.get('/:fileId', forwardAsync(show));
filesRouter.get('/:fileId/meta', forwardAsync(meta));
filesRouter.post('/download', requireJson, downloadMany);

export default filesRouter;
