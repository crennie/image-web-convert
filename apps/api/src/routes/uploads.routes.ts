import fs from 'node:fs';
import { Router } from 'express';
import fileUpload from 'express-fileupload';
import { create as createUpload } from '../controllers/uploads.controller';
import { UPLOAD_TMP_DIR } from '../services/storage.paths';
export { UPLOAD_TMP_DIR } from '../services/storage.paths';
import { getSessionImageConfig } from '../env';

const uploadsRouter: Router = Router({ mergeParams: true });
const imageConfig = getSessionImageConfig();

// ---- router-scoped upload middleware (only affects /upload routes) ----
// ensure temp dir exists (needed when useTempFiles: true)
if (!fs.existsSync(UPLOAD_TMP_DIR)) {
    fs.mkdirSync(UPLOAD_TMP_DIR, { recursive: true });
}

uploadsRouter.use(
    fileUpload({
        useTempFiles: true,
        tempFileDir: UPLOAD_TMP_DIR,
        createParentPath: true, // create destination dirs on mv()
        abortOnLimit: false,
        limits: { fileSize: imageConfig.maxBytesPerFile },
    }),
);

// POST /sessions/:sid/uploads
uploadsRouter.post('/', createUpload);

export default uploadsRouter;
