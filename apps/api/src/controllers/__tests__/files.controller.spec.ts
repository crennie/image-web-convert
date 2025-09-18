import type { NextFunction, Request, Response } from 'express';
import { show, meta, downloadMany } from '../files.controller';

// ---- Mocks ----
const validateMock = vi.fn();
vi.mock('../../services/auth.service', () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    validateRequestWithToken: (...args: any[]) => validateMock(...args),
}));

const resolveMock = vi.fn();
const streamZipMock = vi.fn();
vi.mock('../../services/files.service', () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolveFilesByIds: (...args: any[]) => resolveMock(...args),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    streamZip: (...args: any[]) => streamZipMock(...args),
}));

const readMetaMock = vi.fn();
vi.mock('../../services/storage.service', () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readMeta: (...args: any[]) => readMetaMock(...args),
}));

// ---- Test helpers ----
function makeReq(init: Partial<Request> = {}): Request {
    return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        params: {} as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        body: {} as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        headers: {} as any,
        ...init,
    } as unknown as Request;
}

function makeRes(): Response & {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _json?: any; _status?: number; _headers: Record<string, string>; _filePath?: string;
} {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store: any = { _headers: {} as Record<string, string> };
    const res = {
        setHeader: vi.fn((k: string, v: string) => { store._headers[k] = v; }),
        status: vi.fn((code: number) => { store._status = code; return res; }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        json: vi.fn((v: any) => { store._json = v; return res; }),
        sendFile: vi.fn((p: string) => { store._filePath = p; return res; }),
        on: vi.fn(),
        get _headers() { return store._headers; },
        get _status() { return store._status; },
        get _json() { return store._json; },
        get _filePath() { return store._filePath; },
    } as unknown as Response & typeof store;

    return res;
}

const okValidated = (sealedAt: string | null = '2025-01-01T00:00:00.000Z') => ({
    valid: true,
    info: { sealedAt },
});
const invalidValidated = (status = 401, apiError = { status: 'error', message: 'unauthorized' }) => ({
    valid: false,
    status,
    apiError,
});

// ---- Fixtures ----
const resolved = (id: string) => ({
    id,
    absPath: `/abs/${id}.webp`,
    downloadName: `${id}.webp`,
    archiveName: `${id}.webp`,
    contentType: 'image/webp',
    contentDisposition: `attachment; filename="${id}.webp"`,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    meta: {} as any,
});

// ============================================================================
// show
// ============================================================================
describe('files.controller.show', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('returns auth error when validation fails', async () => {
        validateMock.mockResolvedValueOnce(invalidValidated(403, { status: 'error', message: 'forbidden' }));
        const req = makeReq({ params: { sid: 'S', fileId: 'F' } });
        const res = makeRes();

        await show(req, res);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res._json).toEqual({ status: 'error', message: 'forbidden' });
    });

    it('returns 409 if session not sealed', async () => {
        validateMock.mockResolvedValueOnce(okValidated(null)); // sealedAt null
        const req = makeReq({ params: { sid: 'S', fileId: 'F' } });
        const res = makeRes();

        await show(req, res);

        expect(res.status).toHaveBeenCalledWith(409);
        expect(res._json).toMatchObject({ type: 'session_used' });
    });

    it('404 when file not found', async () => {
        validateMock.mockResolvedValueOnce(okValidated());
        resolveMock.mockResolvedValueOnce({ found: [], missing: ['F'] });

        const req = makeReq({ params: { sid: 'S', fileId: 'F' } });
        const res = makeRes();

        await show(req, res);

        expect(res.status).toHaveBeenCalledWith(404);
        expect(res._json?.message).toMatch(/Requested file not found/i);
    });

    it('sets headers and sends file on success', async () => {
        validateMock.mockResolvedValueOnce(okValidated());
        resolveMock.mockResolvedValueOnce({ found: [resolved('F')], missing: [] });

        const req = makeReq({ params: { sid: 'S', fileId: 'F' } });
        const res = makeRes();

        await show(req, res);

        expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/webp');
        expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', expect.stringContaining('F.webp'));
        expect(res.sendFile).toHaveBeenCalledWith('/abs/F.webp');
    });
});

// ============================================================================
// meta
// ============================================================================
describe('files.controller.meta', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('returns auth error when validation fails', async () => {
        validateMock.mockResolvedValueOnce(invalidValidated(401));
        const req = makeReq({ params: { sid: 'S', fileId: 'F' } });
        const res = makeRes();

        await meta(req, res);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res._json).toEqual({ status: 'error', message: 'unauthorized' });
    });

    it('returns 409 if session not sealed', async () => {
        validateMock.mockResolvedValueOnce(okValidated(null));
        const req = makeReq({ params: { sid: 'S', fileId: 'F' } });
        const res = makeRes();

        await meta(req, res);

        expect(res.status).toHaveBeenCalledWith(409);
        expect(res._json).toMatchObject({ type: 'session_used' });
    });

    it('returns 404 when meta missing', async () => {
        validateMock.mockResolvedValueOnce(okValidated());
        readMetaMock.mockResolvedValueOnce(null);

        const req = makeReq({ params: { sid: 'S', fileId: 'F' } });
        const res = makeRes();

        await meta(req, res);

        expect(res.status).toHaveBeenCalledWith(404);
        expect(res._json?.message).toMatch(/Not found/i);
    });

    it('returns meta JSON on success', async () => {
        validateMock.mockResolvedValueOnce(okValidated());
        const m = { hello: 'world', id: 'F' };
        readMetaMock.mockResolvedValueOnce(m);

        const req = makeReq({ params: { sid: 'S', fileId: 'F' } });
        const res = makeRes();

        await meta(req, res);

        expect(res.json).toHaveBeenCalledWith(m);
    });
});

// ============================================================================
// downloadMany
// ============================================================================
describe('files.controller.downloadMany', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('returns auth error when validation fails', async () => {
        validateMock.mockResolvedValueOnce(invalidValidated(401));
        const req = makeReq({ params: { sid: 'S' }, body: { ids: ['a'] } });
        const res = makeRes();

        await downloadMany(req, res, vi.fn());

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res._json).toEqual({ status: 'error', message: 'unauthorized' });
    });

    it('returns 409 if session not sealed', async () => {
        validateMock.mockResolvedValueOnce(okValidated(null));
        const req = makeReq({ params: { sid: 'S' }, body: { ids: ['a'] } });
        const res = makeRes();

        await downloadMany(req, res, vi.fn());

        expect(res.status).toHaveBeenCalledWith(409);
        expect(res._json).toMatchObject({ type: 'session_used' });
    });

    it('400 when body.ids invalid', async () => {
        console.log("----- 400 body start");
        validateMock.mockResolvedValue(okValidated());
        const badBodies = [undefined, {}, { ids: [] }, { ids: [1, 2] }];

        for (const body of badBodies) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const req = makeReq({ params: { sid: 'S' }, body } as any);
            const res = makeRes();
            await downloadMany(req, res, vi.fn());
            expect(res.status).toHaveBeenCalledWith(400);
            expect(res._json?.message).toMatch(/Body must include \{ ids: string\[\] \}/);
        }
    });

    it('404 when none of the requested files were found', async () => {
        validateMock.mockResolvedValueOnce(okValidated());
        resolveMock.mockResolvedValueOnce({ found: [], missing: ['a', 'b'] });

        const req = makeReq({ params: { sid: 'S' }, body: { ids: ['a', 'b'] } });
        const res = makeRes();

        await downloadMany(req, res, vi.fn());

        expect(res.status).toHaveBeenCalledWith(404);
        expect(res._json).toMatchObject({ status: 'error', missing: ['a', 'b'] });
    });

    it('sets X-Missing-Ids header when some requested files are missing, and streams zip with default name', async () => {
        validateMock.mockResolvedValueOnce(okValidated());
        resolveMock.mockResolvedValueOnce({
            found: [resolved('a'), resolved('b')],
            missing: ['c'],
        });
        streamZipMock.mockResolvedValueOnce(undefined);

        const req = makeReq({ params: { sid: 'S' }, body: { ids: ['a', 'b', 'c'] } });
        const res = makeRes();

        await downloadMany(req, res, vi.fn());

        expect(res.setHeader).toHaveBeenCalledWith('X-Missing-Ids', 'c');
        // default fallback when no archiveName provided in body
        expect(streamZipMock).toHaveBeenCalledWith(res, expect.any(Array), 'images.zip');
    });

    it('uses provided archiveName when present', async () => {
        validateMock.mockResolvedValueOnce(okValidated());
        resolveMock.mockResolvedValueOnce({ found: [resolved('a')], missing: [] });
        streamZipMock.mockResolvedValueOnce(undefined);

        const req = makeReq({ params: { sid: 'S' }, body: { ids: ['a'], archiveName: 'Custom_Name' } });
        const res = makeRes();

        await downloadMany(req, res, vi.fn());

        expect(streamZipMock).toHaveBeenCalledWith(res, expect.any(Array), 'Custom_Name');
    });

    it('forwards errors from streamZip to next(err)', async () => {
        validateMock.mockResolvedValueOnce(okValidated());
        resolveMock.mockResolvedValueOnce({ found: [resolved('a')], missing: [] });
        const err = new Error('zip-fail');
        streamZipMock.mockRejectedValueOnce(err);

        const req = makeReq({ params: { sid: 'S' }, body: { ids: ['a'] } });
        const res = makeRes();
        const next = vi.fn() as NextFunction;

        await downloadMany(req, res, next);

        expect(next).toHaveBeenCalledWith(err);
    });
});
