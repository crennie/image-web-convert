import fs from 'node:fs/promises';
import path from 'node:path';
import type { Request, Response } from 'express';
import {
    conversionSnapshot,
    acceptConversionUpload,
    ConversionTransitionError,
} from '../services/conversions.service';
import { claimSessionWork } from '../services/session-work.service';
import { readSessionInfo } from '../services/sessions.service';
import { receiveConversionUpload } from '../services/conversion-upload.service';
import { authorizeConversion, conversionRuntime } from './conversions.http';
import { UPLOAD_TMP_DIR } from '../services/storage.paths';

export async function create(req: Request, res: Response) {
    const session = await authorizeConversion(req, res);
    if (!session) return;
    const release = claimSessionWork(session.id);
    try {
        const current = await readSessionInfo(session.id);
        if (current.sealedAt || current.counts.files)
            throw new ConversionTransitionError(
                'conversion_conflict',
                'Session already used by legacy upload',
            );
        const record = await conversionRuntime(req).createOperation(
            current,
            req.body,
        );
        res.status(201).json(conversionSnapshot(record.operation));
    } finally {
        release();
    }
}
export async function show(req: Request, res: Response) {
    if (!(await authorizeConversion(req, res))) return;
    const runtime = conversionRuntime(req);
    const release = runtime.acquireSessionUse(req.params.sid);
    try {
        const record = await runtime.read(
            req.params.sid,
            req.params.operationId,
        );
        res.setHeader('Cache-Control', 'no-store');
        res.json(conversionSnapshot(record.operation));
    } finally {
        release();
    }
}
export async function cancel(req: Request, res: Response) {
    if (!(await authorizeConversion(req, res))) return;
    const record = await conversionRuntime(req).cancel(
        req.params.sid,
        req.params.operationId,
    );
    res.json(conversionSnapshot(record.operation));
}
export async function upload(req: Request, res: Response) {
    const session = await authorizeConversion(req, res);
    if (!session) return;
    const runtime = conversionRuntime(req);
    const { sid, operationId, fileId } = req.params;
    const record = await runtime.read(sid, operationId);
    const slot = record.operation.files.find((file) => file.id === fileId);
    if (!slot)
        throw new ConversionTransitionError(
            'file_not_found',
            'File does not belong to operation',
        );
    // Validate before consuming bytes, including immutable accepted-slot retries.
    acceptConversionUpload(
        record.operation,
        fileId,
        slot.declaredBytes,
        new Date(),
    );
    if ('uploadedAt' in slot && slot.uploadedAt) {
        res.json(conversionSnapshot(record.operation));
        req.resume();
        return;
    }
    const abort = new AbortController();
    const admission = runtime.beginUpload(
        sid,
        fileId,
        session.expiresAt,
        () => {
            // Capture before abort: pipeline teardown can detach req.socket.
            const socket = req.socket;
            abort.abort();
            socket?.destroy();
        },
    );
    const disconnect = () => abort.abort();
    req.once('aborted', disconnect);
    res.once('close', disconnect);
    let directory: string | undefined;
    try {
        await fs.mkdir(UPLOAD_TMP_DIR, { recursive: true });
        directory = await fs.mkdtemp(path.join(UPLOAD_TMP_DIR, 'conversion-'));
        admission.assertActive();
        const file = await receiveConversionUpload(
            req,
            directory,
            Math.min(
                slot.declaredBytes,
                record.operation.limits.maxBytesPerFile,
            ),
            abort.signal,
            admission.touch,
        );
        admission.assertActive();
        if (abort.signal.aborted)
            throw new ConversionTransitionError(
                'upload_error',
                'Upload interrupted',
            );
        let accepted;
        try {
            accepted = await runtime.acceptUpload(
                sid,
                operationId,
                fileId,
                file.path,
                () => {
                    admission.assertActive();
                    if (abort.signal.aborted)
                        throw new ConversionTransitionError(
                            'upload_error',
                            'Upload interrupted',
                        );
                },
            );
        } catch (error) {
            if (
                error instanceof ConversionTransitionError &&
                (error.type === 'upload_size_mismatch' ||
                    error.type === 'upload_limit_exceeded')
            ) {
                await runtime.rejectUpload(sid, operationId, fileId, {
                    type: error.type,
                    message: error.message,
                });
            }
            throw error;
        }
        res.json(conversionSnapshot(accepted.operation));
    } finally {
        req.off('aborted', disconnect);
        res.off('close', disconnect);
        try {
            if (directory)
                await fs.rm(directory, { recursive: true, force: true });
        } finally {
            admission.release();
        }
    }
}
