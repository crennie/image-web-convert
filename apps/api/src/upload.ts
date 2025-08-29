// import path from 'node:path';
// import fs from 'node:fs/promises';
// import fssync from 'node:fs';
// import crypto from 'node:crypto';
// import express from 'express';
// import fileUpload, { UploadedFile } from 'express-fileupload';

// // TODO: Add docker-friendly elements
// const isProd = process.env.NODE_ENV === 'production';

// // Default to a repo-root ./data directory in monorepo root
// const DEFAULT_UPLOAD_DIR = path.resolve(process.cwd(), 'data', 'uploads');
// const DEFAULT_TMP_DIR = path.resolve(process.cwd(), 'data', 'tmp');

// // Ensures provided env value is absolute (needed for serving with express res.sendFile)
// function normalizeAbsolutePath(envVal: string): string {
//     return path.isAbsolute(envVal) ? envVal : path.resolve(process.cwd(), envVal);
// }

// export const UPLOAD_DIR = normalizeAbsolutePath(process.env.UPLOAD_DIR || DEFAULT_UPLOAD_DIR);
// export const UPLOAD_TMP_DIR = normalizeAbsolutePath(process.env.UPLOAD_TMP_DIR || DEFAULT_TMP_DIR);

// // Ensure dirs exist at boot
// for (const dir of [UPLOAD_DIR, UPLOAD_TMP_DIR]) {
//     if (!fssync.existsSync(dir)) {
//         fssync.mkdirSync(dir, { recursive: true });
//     }
// }

// // ---------- App ----------
// export const app = express();

// app.use(
//     fileUpload({
//         useTempFiles: true,
//         tempFileDir: UPLOAD_TMP_DIR,
//         createParentPath: true,
//         // limits: { fileSize: 20 * 1024 * 1024 }, // optional: 20MB
//         abortOnLimit: false,
//         preserveExtension: false,
//     })
// );

// // TODO: ADD THIS TO SCHEMA?
// // ---------- Helpers ----------
// type UploadMeta = {
//     id: string;
//     originalName: string;
//     storedName: string; // `${id}${ext}`
//     mimeType: string;
//     size: number;
//     uploadedAt: string;
// };

// function uuid() {
//     return 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
// }

// function extOf(name: string): string {
//     const ext = path.extname(name || '');
//     // Normalize & lightly constrain extension
//     if (!ext || ext.length > 16) return '';
//     return ext.toLowerCase();
// }

// function sanitizeBaseName(name: string): string {
//     // Keep a conservative ASCII fallback for Content-Disposition `filename=`
//     return path.basename(name).replace(/[/\\?%*:|"<>]/g, '_');
// }

// function dispositionForDownload(originalName: string) {
//     const fallback = sanitizeBaseName(originalName) || 'download';
//     // RFC 5987 for UTF-8 names
//     return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(originalName)}`;
// }

// function toArray<T>(v: T | T[]): T[] {
//     return Array.isArray(v) ? v : [v];
// }

// function flattenUploadedFiles(files: fileUpload.FileArray | undefined | null): UploadedFile[] {
//     if (!files) return [];
//     return Object.values(files).flatMap((v) => toArray(v as UploadedFile | UploadedFile[]));
// }

// // TODO: Not used?
// async function moveUploadedFile(uf: UploadedFile, destPath: string) {
//     // express-fileupload's mv() returns void if you use callback, OR a Promise if no callback is provided.
//     // Some TS defs lag; use a small adapter to be safe.
//     await new Promise<void>((resolve, reject) => {
//         uf.mv(destPath, (err) => (err ? reject(err) : resolve()));
//     });
// }

// async function writeMeta(meta: UploadMeta) {
//     const metaPath = path.join(UPLOAD_DIR, `${meta.id}.json`);
//     await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');
// }

// async function readMeta(id: string): Promise<UploadMeta | null> {
//     const metaPath = path.join(UPLOAD_DIR, `${id}.json`);
//     try {
//         const txt = await fs.readFile(metaPath, 'utf8');
//         return JSON.parse(txt) as UploadMeta;
//     } catch {
//         return null;
//     }
// }

// // ---------- Routes ----------

// // POST /upload  (accepts any field name; handles single or multiple files)
// app.post('/upload', async (req, res) => {
//     try {
//         const uploads = flattenUploadedFiles(req.files);
//         if (uploads.length === 0) {
//             return res.status(400).json({ status: 'error', message: 'No files uploaded' });
//         }

//         const results = await Promise.allSettled(
//             uploads.map(async (uf) => {
//                 const id = uuid();
//                 const ext = extOf(uf.name);
//                 const storedName = `${id}${ext}`;
//                 const destPath = path.join(UPLOAD_DIR, storedName);

//                 try {
//                     await uf.mv(destPath);
//                 } catch (err) {
//                     // TODO: Add to error stack, continue
//                     // pass
//                 }

//                 const meta: UploadMeta = {
//                     id,
//                     originalName: path.basename(uf.name),
//                     storedName,
//                     mimeType: uf.mimetype || 'application/octet-stream',
//                     size: uf.size,
//                     uploadedAt: new Date().toISOString(),
//                 };
//                 await writeMeta(meta);

//                 return {
//                     ...meta,
//                     // convenience links
//                     url: `/files/${id}`,
//                     metaUrl: `/files/${id}/meta`,
//                 };
//             })
//         );

//         const accepted = results
//             .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
//             .map((r) => r.value);
//         const rejected = results
//             .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
//             .map((r) => ({ error: String(r.reason ?? 'unknown error') }));

//         const status = rejected.length ? 'partial' : 'ok';
//         const http = rejected.length ? 207 /* Multi-Status */ : 200;

//         return res.status(http).json({ status, accepted, rejected });
//     } catch (err: any) {
//         return res.status(500).json({ status: 'error', message: err?.message || 'Upload failed' });
//     }
// });

// // GET /files/:id  (serves with the original filename via Content-Disposition)
// app.get('/files/:id', async (req, res) => {
//     const { id } = req.params;
//     const meta = await readMeta(id);
//     if (!meta) return res.status(404).json({ status: 'error', message: 'Not found' });

//     const absPath = path.join(UPLOAD_DIR, meta.storedName);
//     if (!fssync.existsSync(absPath)) {
//         return res.status(404).json({ status: 'error', message: 'File missing' });
//     }

//     res.setHeader('Content-Type', meta.mimeType);
//     res.setHeader('Content-Disposition', dispositionForDownload(meta.originalName));
//     // You can use res.sendFile; headers set above will be kept.
//     return res.sendFile(absPath);
// });

// // (Optional) GET /files/:id/meta  (metadata only)
// app.get('/files/:id/meta', async (req, res) => {
//     const meta = await readMeta(req.params.id);
//     if (!meta) return res.status(404).json({ status: 'error', message: 'Not found' });
//     res.json(meta);
// });
