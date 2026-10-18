import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test, expect } from '@playwright/test';
import { createRequestHandler, type ServerBuild } from 'react-router';

function conversionRoute(build: ServerBuild) {
    const route = build.routes['routes/conversion/index'];
    if (!route) throw new Error('Missing built conversion route');
    return route;
}

function serverPort(server: Server) {
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('Missing HTTP test port');
    return address.port;
}

test('built production SSR hides a rendering failure in an HTTP 500 document', async () => {
    const builtPath = path.resolve(
        __dirname,
        '../../../web/build/server/index.js',
    );
    const original = (await import(
        pathToFileURL(builtPath).href
    )) as ServerBuild;
    const route = conversionRoute(original);
    const build: ServerBuild = {
        ...original,
        routes: {
            ...original.routes,
            'routes/conversion/index': {
                ...route,
                module: {
                    ...route.module,
                    default: () => {
                        throw new Error('/internal/private/path?token=secret');
                    },
                },
            },
        },
    };
    const handle = createRequestHandler(build, 'production');
    const server = createServer((request, response) => {
        void handle(new Request(`http://localhost${request.url}`))
            .then(async (result) => {
                response.writeHead(
                    result.status,
                    Object.fromEntries(result.headers),
                );
                response.end(await result.text());
            })
            .catch(() => response.writeHead(500).end());
    });
    await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
    );
    try {
        const result = await fetch(
            `http://127.0.0.1:${serverPort(server)}/conversion`,
        );
        expect(result.status).toBe(500);
        expect(result.headers.get('content-type')).toContain('text/html');
        expect(result.headers.get('content-security-policy')).toContain(
            'frame-ancestors',
        );
        const body = await result.text();
        expect(body).toContain('Something went wrong');
        expect(body).not.toContain('/internal/private/path');
        expect(body).not.toContain('token=secret');
        expect(body).not.toContain('/workspaces/');
    } finally {
        await new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
        );
    }
});
