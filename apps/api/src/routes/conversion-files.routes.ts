import { Router } from 'express';
import {
    ApiDownloadFilesRequestSchema,
    ConversionIdSchema,
} from '@image-web-convert/schemas';
import {
    authorizeConversion,
    conversionHandler,
    conversionRuntime,
} from '../controllers/conversions.http';
import { ConversionTransitionError } from '../services/conversions.service';
import {
    resolveFilesByIds,
    archiveDownloadHeaders,
    writeZip,
    ArchiveClientAbortError,
} from '../services/files.service';

// New operations authorize committed files independently. A missing operation
// falls through to the unchanged legacy sealed-session download controllers.
const router: Router = Router({ mergeParams: true });
router.use(
    conversionHandler(async (req, res, next) => {
        if (!(await authorizeConversion(req, res))) return;
        const runtime = conversionRuntime(req);
        let record;
        try {
            record = await runtime.read(req.params.sid);
        } catch (error) {
            if (
                error instanceof ConversionTransitionError &&
                error.type === 'operation_not_found'
            )
                return next();
            throw error;
        }
        const release = runtime.acquireSessionUse(req.params.sid);
        res.once('close', release);
        res.once('finish', release);
        res.locals.conversionOperationId = record.operation.id;
        next();
    }),
);
const operationRouter = Router({ mergeParams: true });
// Only run these handlers when the operation middleware selected the new flow.
router.use((req, res, next) =>
    res.locals.conversionOperationId ? operationRouter(req, res, next) : next(),
);

async function committed(
    req: import('express').Request,
    oid: string,
    id: string,
) {
    if (!ConversionIdSchema.safeParse(id).success) return null;
    try {
        return (
            await conversionRuntime(req).completedOutput(
                req.params.sid,
                oid,
                id,
            )
        ).meta;
    } catch (error) {
        if (
            error instanceof ConversionTransitionError &&
            error.type === 'file_not_found'
        )
            return null;
        throw error;
    }
}
operationRouter.get(
    '/:fileId/meta',
    conversionHandler(async (req, res) => {
        const meta = await committed(
            req,
            res.locals.conversionOperationId,
            req.params.fileId,
        );
        if (!meta)
            throw new ConversionTransitionError(
                'file_not_found',
                'No completed output for this file',
            );
        res.json(meta);
    }),
);
operationRouter.get(
    '/:fileId',
    conversionHandler(async (req, res) => {
        const { found } = await resolveFilesByIds(
            req.params.sid,
            [req.params.fileId],
            (_sid, id) => committed(req, res.locals.conversionOperationId, id),
        );
        if (!found.length)
            throw new ConversionTransitionError(
                'file_not_found',
                'No completed output for this file',
            );
        res.setHeader('Content-Type', found[0].contentType);
        res.setHeader('Content-Disposition', found[0].contentDisposition);
        // Await actual send completion; the response lease also covers early close.
        await new Promise<void>((resolve, reject) =>
            res.sendFile(found[0].absPath, (error) =>
                error ? reject(error) : resolve(),
            ),
        );
    }),
);
operationRouter.post(
    '/download',
    conversionHandler(async (req, res) => {
        const parsed = ApiDownloadFilesRequestSchema.safeParse(req.body);
        if (
            !parsed.success ||
            parsed.data.ids.some(
                (id) => !ConversionIdSchema.safeParse(id).success,
            )
        )
            throw new ConversionTransitionError(
                'invalid_request',
                'Body must include { ids: string[] }',
            );
        const { found, missing } = await resolveFilesByIds(
            req.params.sid,
            parsed.data.ids,
            (_sid, id) => committed(req, res.locals.conversionOperationId, id),
        );
        if (!found.length)
            throw new ConversionTransitionError(
                'file_not_found',
                'No requested outputs are completed',
            );
        if (missing.length) res.setHeader('X-Missing-Ids', missing.join(','));
        const headers = archiveDownloadHeaders(
            parsed.data.archiveName ?? 'images.zip',
        );
        res.setHeader('Content-Type', headers.contentType);
        res.setHeader('Content-Disposition', headers.contentDisposition);
        try {
            await writeZip(res, found);
        } catch (error) {
            if (!(error instanceof ArchiveClientAbortError)) {
                if (!res.headersSent) {
                    res.removeHeader('Content-Disposition');
                    res.removeHeader('Content-Type');
                }
                throw error;
            }
        }
    }),
);
export default router;
