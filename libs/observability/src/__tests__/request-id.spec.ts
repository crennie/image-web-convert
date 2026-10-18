import { createServer } from 'node:http';
import express from 'express';
import pino from 'pino';
import { logContext, requestContext } from '../lib/express.js';

it('reflects only bounded printable client request IDs', async () => {
    const app = express();
    app.use(await logContext(pino({ level: 'silent' })));
    app.use(requestContext());
    app.get('/', (_req, res) => res.sendStatus(204));
    const server = createServer(app);
    await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No port');
    const url = `http://127.0.0.1:${address.port}`;
    try {
        const valid = await fetch(url, {
            headers: { 'X-Request-Id': 'client:request_42' },
        });
        expect(valid.headers.get('x-request-id')).toBe('client:request_42');

        for (const invalid of ['x'.repeat(129), 'has spaces', 'é']) {
            const response = await fetch(url, {
                headers: { 'X-Request-Id': invalid },
            });
            expect(response.headers.get('x-request-id')).toMatch(
                /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
            );
        }
    } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
});
