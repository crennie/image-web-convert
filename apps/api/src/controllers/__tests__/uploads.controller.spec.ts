import type { Request, Response } from 'express';
import type { UploadedFile } from 'express-fileupload';

import { create } from '../uploads.controller';
import { validateRequestWithToken } from '../../services/auth.service';
import {
    processUploadBatch,
    UploadClaimConflictError,
} from '../../services/uploads.service';
import { MockInstance } from 'vitest';
import { ApiUploadAccepted, ApiUploadMeta } from '@image-web-convert/schemas';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// ---- Mocks ----
vi.mock('../../services/auth.service', () => ({
    validateRequestWithToken: vi.fn(),
}));

vi.mock('../../services/uploads.service', () => ({
    processUploadBatch: vi.fn(),
    UploadClaimConflictError: class extends Error {},
}));

vi.mock('../../env', () => ({
    getSessionImageConfig: () => ({
        ttlMinutes: 15,
        maxFiles: 20,
        maxBytesPerFile: 100,
        maxTotalBytes: 200,
    }),
}));

// typed helpers
const mockedValidate = vi.mocked(validateRequestWithToken);
const mockedSave = vi.mocked(processUploadBatch);

// ---- Test helpers ----
function makeReq(opts?: {
    sid?: string;
    files?: Record<string, UploadedFile | UploadedFile[]>;
    manifest?: string;
    outputMime?: string;
}): Request {
    const {
        sid = 'S123',
        files,
        manifest,
        outputMime = 'image/webp',
    } = opts ?? {};
    return {
        params: { sid },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        files: files as any,
        body: Object.assign(
            manifest !== undefined ? { manifest } : {},
            outputMime !== undefined ? { outputMime } : {},
        ),
    } as unknown as Request;
}

function makeRes(): Response & {
    status: MockInstance;
    json: MockInstance;
    _status?: number;
    _json?: unknown;
} {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        status: vi.fn(function (this: any, code: number) {
            res._status = code;
            return res;
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        json: vi.fn(function (this: any, body: unknown) {
            res._json = body;
            return res;
        }),
    };
    return res as Response & { status: MockInstance; json: MockInstance };
}

// Minimal SessionInfo stub
const baseInfo = () =>
    ({
        tokenHash: 'abc',
        counts: { files: 0, totalBytes: 0 },
        sealedAt: undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;

// Helper for creating file responses
function createAcceptedMockFileResponse(
    id: string,
    sizeBytes = 25,
): ApiUploadAccepted {
    return {
        id,
        url: 'url',
        metaUrl: 'metaUrl',
        meta: { original: { sizeBytes } } as unknown as ApiUploadMeta,
    };
}

describe('uploads.controller.create', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns 401 when auth validation fails (delegates service error)', async () => {
        mockedValidate.mockResolvedValueOnce({
            valid: false,
            status: 401,
            apiError: { type: 'invalid_token', message: '' },
        });

        const req = makeReq();
        const res = makeRes();

        await create(req, res);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({
            type: 'invalid_token',
            message: '',
        });
        expect(mockedSave).not.toHaveBeenCalled();
    });

    it('returns 409 when session already sealed', async () => {
        const info = baseInfo();
        info.sealedAt = new Date().toISOString();

        mockedValidate.mockResolvedValueOnce({ valid: true, info });

        const req = makeReq();
        const res = makeRes();

        await create(req, res);

        expect(res.status).toHaveBeenCalledWith(409);
        expect(res.json).toHaveBeenCalledWith({
            type: 'session_used',
            message: '',
        });
        expect(mockedSave).not.toHaveBeenCalled();
    });

    it('returns 400 when no files are provided', async () => {
        const info = baseInfo();
        mockedValidate.mockResolvedValueOnce({ valid: true, info });

        const req = makeReq({ files: undefined });
        const res = makeRes();

        await create(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
            type: 'missing_files',
            message: 'No files uploaded',
        });
        expect(mockedSave).not.toHaveBeenCalled();
    });

    it('passes files (flattened) and empty clientIds to saveUploads; returns 200 OK on full success', async () => {
        const info = baseInfo();
        info.counts.files = 1; // pre-existing files
        mockedValidate.mockResolvedValueOnce({ valid: true, info });

        // files: one single + one array (should flatten to 3)
        const fileA = { name: 'a.png', size: 1 } as UploadedFile;
        const fileB1 = { name: 'b1.jpg', size: 1 } as UploadedFile;
        const fileB2 = { name: 'b2.jpg', size: 1 } as UploadedFile;

        const req = makeReq({
            files: { a: fileA, b: [fileB1, fileB2] },
            // no manifest
        });
        const res = makeRes();

        mockedSave.mockResolvedValueOnce({
            accepted: [
                createAcceptedMockFileResponse('X1'),
                createAcceptedMockFileResponse('X2'),
            ],
            rejected: [],
        });

        await create(req, res);

        // saveUploads called with flattened files array (length 3) and empty clientIds
        expect(mockedSave).toHaveBeenCalledTimes(1);
        const [sidArg, outputMime, filesArg, infoArg] =
            mockedSave.mock.calls[0];
        expect(sidArg).toBe('S123');
        expect(Array.isArray(filesArg)).toBe(true);
        expect(outputMime).toBe('image/webp');
        expect(filesArg).toEqual([
            expect.objectContaining({ originalName: 'a.png', originalBytes: 1 }),
            expect.objectContaining({ originalName: 'b1.jpg', originalBytes: 1 }),
            expect.objectContaining({ originalName: 'b2.jpg', originalBytes: 1 }),
        ]);
        expect(infoArg).toBe(info);

        // response
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({
            status: 'ok',
            accepted: [
                createAcceptedMockFileResponse('X1'),
                createAcceptedMockFileResponse('X2'),
            ],
            rejected: [],
        });
    });

    it("returns 207 Multi-Status with status='partial' when some files are rejected", async () => {
        const info = baseInfo();
        mockedValidate.mockResolvedValueOnce({ valid: true, info });

        const file = { name: 'x.png', size: 1 } as UploadedFile;
        const req = makeReq({ files: { x: file } });
        const res = makeRes();

        mockedSave.mockResolvedValueOnce({
            accepted: [createAcceptedMockFileResponse('A')],
            rejected: [{ fileName: 'x.png', error: 'bad mime' }],
        });

        await create(req, res);

        expect(res.status).toHaveBeenCalledWith(207);
        expect(res.json).toHaveBeenCalledWith({
            status: 'partial',
            accepted: [createAcceptedMockFileResponse('A')],
            rejected: [{ fileName: 'x.png', error: 'bad mime' }],
        });

    });

    it('forwards manifest clientIds to saveUploads', async () => {
        const info = baseInfo();
        mockedValidate.mockResolvedValueOnce({ valid: true, info });

        const file = { name: 'y.png', size: 1 } as UploadedFile;
        const secondFile = { name: 'z.png', size: 1 } as UploadedFile;
        const req = makeReq({
            files: { y: [file, secondFile] },
            manifest: JSON.stringify(['c1', 'c2']),
        });
        const res = makeRes();

        mockedSave.mockResolvedValueOnce({ accepted: [], rejected: [] });

        await create(req, res);

        const [, , inputs] = mockedSave.mock.calls[0];
        expect(inputs.map((input) => input.clientId)).toEqual(['c1', 'c2']);
    });

    it.each([
        { manifest: 'not-json' },
        { manifest: JSON.stringify({ clientId: 'c1' }) },
        { manifest: JSON.stringify(['c1', 2]) },
    ])(
        'returns invalid_request for malformed manifest %#',
        async ({ manifest }) => {
            mockedValidate.mockResolvedValueOnce({
                valid: true,
                info: baseInfo(),
            });
            const req = makeReq({
                files: { upload: { name: 'x.png', size: 1 } as UploadedFile },
                manifest,
            });
            const res = makeRes();

            await create(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'invalid_request',
                }),
            );
            expect(mockedSave).not.toHaveBeenCalled();
        },
    );

    it('requires one manifest ID per uploaded file', async () => {
        mockedValidate.mockResolvedValueOnce({ valid: true, info: baseInfo() });
        const req = makeReq({
            files: { upload: { name: 'x.png', size: 1 } as UploadedFile },
            manifest: JSON.stringify(['c1', 'c2']),
        });
        const res = makeRes();

        await create(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'invalid_request',
            }),
        );
        expect(mockedSave).not.toHaveBeenCalled();
    });

    it.each([
        {
            name: 'per-file bytes',
            info: baseInfo(),
            files: [{ name: 'large.png', size: 101 } as UploadedFile],
        },
        {
            name: 'file count',
            info: { ...baseInfo(), counts: { files: 19, totalBytes: 0 } },
            files: [
                { name: 'a.png', size: 1 } as UploadedFile,
                { name: 'b.png', size: 1 } as UploadedFile,
            ],
        },
        {
            name: 'total bytes',
            info: { ...baseInfo(), counts: { files: 0, totalBytes: 150 } },
            files: [{ name: 'a.png', size: 51 } as UploadedFile],
        },
    ])('returns 413 for the $name limit', async ({ info, files }) => {
        mockedValidate.mockResolvedValueOnce({ valid: true, info });
        const req = makeReq({ files: { uploads: files } });
        const res = makeRes();

        await create(req, res);

        expect(res.status).toHaveBeenCalledWith(413);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'upload_limit_exceeded' }),
        );
        expect(mockedSave).not.toHaveBeenCalled();
    });

    it('removes temporary files when boundary validation rejects the upload', async () => {
        mockedValidate.mockResolvedValueOnce({ valid: true, info: baseInfo() });
        const tmpDir = await fs.mkdtemp(
            path.join(os.tmpdir(), 'iwc-controller-'),
        );
        const tempFilePath = path.join(tmpDir, 'upload.tmp');
        await fs.writeFile(tempFilePath, 'temporary');
        const file = {
            name: 'large.png',
            size: 101,
            tempFilePath,
        } as UploadedFile;

        try {
            await create(makeReq({ files: { upload: file } }), makeRes());
            await expect(fs.access(tempFilePath)).rejects.toBeTruthy();
        } finally {
            await fs.rm(tmpDir, { recursive: true, force: true });
        }
    });

    it('returns 500 upload_error if service throws', async () => {
        const info = baseInfo();
        mockedValidate.mockResolvedValueOnce({ valid: true, info });

        const file = { name: 'z.png', size: 1 } as UploadedFile;
        const req = makeReq({ files: { z: file } });
        const res = makeRes();

        mockedSave.mockRejectedValueOnce(new Error('disk full'));

        await create(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({
            type: 'upload_error',
            message: 'disk full',
        });
    });

    it('returns 409 when the application service reports a concurrent upload', async () => {
        mockedValidate.mockResolvedValueOnce({ valid: true, info: baseInfo() });
        mockedSave.mockRejectedValueOnce(new UploadClaimConflictError());
        const file = { name: 'z.png', size: 1 } as UploadedFile;
        const res = makeRes();

        await create(makeReq({ files: { z: file } }), res);

        expect(res.status).toHaveBeenCalledWith(409);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'upload_in_progress' }),
        );
    });
});
