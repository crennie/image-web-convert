import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Request } from 'express';
import { ConversionTransitionError } from '../services/conversions.service';

// HTTP transport adapter: Express request ownership stops here.
// Node's multipart decoder buffers the bounded body. Spool first so malformed,
// disconnected and over-limit transport never publishes a partially parsed slot.
// The 64 KiB framing allowance is independent of declared file bytes.
export async function receiveConversionUpload(
    req: Request,
    directory: string,
    maxBytes: number,
    signal: AbortSignal,
    touch: () => void,
): Promise<{ path: string; size: number }> {
    const contentType = req.header('content-type') ?? '';
    if (!/^multipart\/form-data\s*;/i.test(contentType))
        throw new ConversionTransitionError(
            'invalid_request',
            'Expected multipart/form-data with exactly one file',
        );
    const bodyPath = path.join(directory, 'request.multipart');
    let received = 0;
    const bounded = new Transform({
        transform(chunk: Buffer, _encoding, done) {
            touch();
            received += chunk.length;
            if (received > maxBytes + 65536)
                done(
                    new ConversionTransitionError(
                        'upload_limit_exceeded',
                        'Multipart request exceeds slot and framing limits',
                    ),
                );
            else done(null, chunk);
        },
    });
    const socket = req.socket;
    try {
        await pipeline(
            req,
            bounded,
            createWriteStream(bodyPath, { flags: 'wx', mode: 0o600 }),
            { signal },
        );
    } catch (error) {
        // Stream teardown can detach IncomingMessage from its socket. Close the
        // captured transport before releasing an incomplete request's admission.
        if (!req.complete) socket.destroy();
        if (error instanceof ConversionTransitionError) throw error;
        if (
            signal.aborted ||
            (error as NodeJS.ErrnoException).code ===
                'ERR_STREAM_PREMATURE_CLOSE' ||
            (error as NodeJS.ErrnoException).code === 'ECONNRESET'
        )
            throw new ConversionTransitionError(
                'upload_error',
                'Upload was interrupted',
            );
        throw error;
    }
    let form: FormData;
    try {
        const body = Readable.toWeb(createReadStream(bodyPath));
        form = await new Response(body as ReadableStream<Uint8Array>, {
            headers: { 'content-type': contentType },
        }).formData();
    } catch {
        throw new ConversionTransitionError(
            'invalid_request',
            'Malformed multipart upload',
        );
    }
    const entries = [...form.values()];
    if (entries.length !== 1 || typeof entries[0] === 'string')
        throw new ConversionTransitionError(
            'invalid_request',
            'Expected exactly one file and no fields',
        );
    signal.throwIfAborted();
    const file = entries[0];
    const filePath = path.join(directory, 'input');
    await pipeline(
        Readable.fromWeb(
            file.stream() as import('node:stream/web').ReadableStream,
        ),
        createWriteStream(filePath, { flags: 'wx', mode: 0o600 }),
        { signal },
    );
    await fs.unlink(bodyPath);
    return { path: filePath, size: file.size };
}

/** Startup only, before HTTP admissions. These uniquely named request directories
 * cannot contain authoritative inputs/results; a crash never acknowledges them. */
export async function recoverConversionRequestStaging(
    root: string,
): Promise<void> {
    await fs.mkdir(root, { recursive: true });
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
        if (
            entry.isDirectory() &&
            /^conversion-[A-Za-z0-9]{6}$/.test(entry.name)
        )
            await fs.rm(path.join(root, entry.name), {
                recursive: true,
                force: true,
            });
    }
}
