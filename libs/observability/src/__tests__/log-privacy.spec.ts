import { createServer } from 'node:http';
import { Writable } from 'node:stream';
import express from 'express';
import pino from 'pino';
import { logContext, requestContext } from '../lib/express.js';
import { safeErrorSummary } from '../lib/safe-error.js';

it('captures useful HTTP status and error class without headers, URL secrets, or error text', async () => {
    const output: string[] = [];
    const stream = new Writable({
        write(chunk, _encoding, callback) {
            output.push(chunk.toString());
            callback();
        },
    });
    const app = express();
    app.use(await logContext(pino({ level: 'info' }, stream)));
    app.use(requestContext());
    app.get('/failure', (req, res) => {
        req.log.error({ err: new Error('private-token-in-error') }, 'failed');
        res.sendStatus(500);
    });
    const server = createServer(app);
    await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No port');
    try {
        const response = await fetch(
            `http://127.0.0.1:${address.port}/failure?token=private-token-in-url`,
            {
                headers: {
                    Authorization: 'Bearer private-token-in-header',
                    Cookie: 'session=private-token-in-cookie',
                },
            },
        );
        expect(response.status).toBe(500);
        const logs = output.join('');
        expect(logs).toContain('"statusCode":500');
        expect(logs).toContain('"method":"GET"');
        expect(logs).toContain('"kind":"exception"');
        for (const secret of [
            'private-token-in-error',
            'private-token-in-url',
            'private-token-in-header',
            'private-token-in-cookie',
        ]) {
            expect(logs).not.toContain(secret);
        }
    } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        stream.destroy();
    }
});

it('reports only known I/O codes and never reads arbitrary error messages', () => {
    const error = new Error(
        'Bearer private-token-in-message',
    ) as NodeJS.ErrnoException;
    error.code = 'ENOSPC';
    expect(safeErrorSummary(error)).toEqual({
        kind: 'exception',
        code: 'ENOSPC',
    });
    error.code = 'EPRIVATE_TOKEN';
    expect(safeErrorSummary(error)).toEqual({ kind: 'exception' });
    expect(safeErrorSummary('private-token-in-string')).toEqual({
        kind: 'non_exception',
    });
});
