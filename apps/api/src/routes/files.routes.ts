import { Router } from 'express';
import { show, meta, downloadMany } from '../controllers/files.controller';

const filesRouter = Router();

filesRouter.get('/:id', show);
filesRouter.get('/:id/meta', meta);
filesRouter.post('/download', downloadMany);


export default filesRouter;
