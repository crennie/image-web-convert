import path from 'node:path';
import fs from 'node:fs';
import { Router } from 'express';
import fileUpload from 'express-fileupload';
import { create as createUpload } from '../controllers/upload.controller';
import { normalizeAbsolutePath } from '../services/storage.service';

const uploadRouter = Router();

// ---- router-scoped upload middleware (only affects /upload routes) ----
export const UPLOAD_TMP_DIR = normalizeAbsolutePath(process.env.UPLOAD_TMP_DIR ?? path.resolve(process.cwd(), 'data', 'tmp'));

// ensure temp dir exists (needed when useTempFiles: true)
if (!fs.existsSync(UPLOAD_TMP_DIR)) {
    fs.mkdirSync(UPLOAD_TMP_DIR, { recursive: true });
}

uploadRouter.use(
    fileUpload({
        useTempFiles: true,
        tempFileDir: UPLOAD_TMP_DIR,
        createParentPath: true, // create destination dirs on mv()
        abortOnLimit: false,
        // TODO: Add limits from env files also?
        // limits: { fileSize: 20 * 1024 * 1024 }, // optional per-file cap
    })
);

// POST /upload
uploadRouter.post('/', createUpload);

export default uploadRouter;
