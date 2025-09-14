import path from 'node:path';
import fs from 'node:fs';
import { Router } from 'express';
import fileUpload from 'express-fileupload';
import { create as createUpload } from '../controllers/uploads.controller';
import { normalizeAbsolutePath } from '@image-web-convert/node-shared';

const uploadsRouter: Router = Router({ mergeParams: true });

// ---- router-scoped upload middleware (only affects /upload routes) ----
export const UPLOAD_TMP_DIR = normalizeAbsolutePath(process.env.UPLOAD_TMP_DIR ?? path.resolve(process.cwd(), 'data', 'tmp'));

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
        // TODO: Add limits from env files also?
        // limits: { fileSize: 20 * 1024 * 1024 }, // optional per-file cap
    })
);

// POST /sessions/:sid/uploads
uploadsRouter.post('/', createUpload);

export default uploadsRouter;
