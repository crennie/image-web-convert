import type { Request, Response } from "express";
import type { UploadedFile } from "express-fileupload";

import { create } from "../uploads.controller";
import { validateRequestWithToken } from "../../services/auth.service";
import { saveUploads } from "../../services/uploads.service";
import { writeSessionInfo } from "../../services/sessions.service";
import { MockInstance } from "vitest";
import { ApiUploadAccepted, ApiUploadMeta } from "@image-web-convert/schemas";


// ---- Mocks ----
vi.mock("../../services/auth.service", () => ({
    validateRequestWithToken: vi.fn(),
}));

vi.mock("../../services/uploads.service", () => ({
    saveUploads: vi.fn(),
}));

vi.mock("../../services/sessions.service", () => ({
    writeSessionInfo: vi.fn(),
}));


// typed helpers
const mockedValidate = vi.mocked(validateRequestWithToken);
const mockedSave = vi.mocked(saveUploads);
const mockedWriteInfo = vi.mocked(writeSessionInfo);

// ---- Test helpers ----
function makeReq(opts?: {
    sid?: string;
    files?: Record<string, UploadedFile | UploadedFile[]>;
    manifest?: string;
    outputMime?: string;
}): Request {
    const { sid = "S123", files, manifest, outputMime = JSON.stringify("image/webp") } = opts ?? {};
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
    tokenHash: "abc",
    counts: { files: 0 },
    sealedAt: undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any);

// Helper for creating file responses
function createAcceptedMockFileResponse(id: string): ApiUploadAccepted {
    return ({
        id,
        url: "url",
        metaUrl: "metaUrl",
        meta: {} as unknown as ApiUploadMeta,
    })
}

describe("uploads.controller.create", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("returns 401 when auth validation fails (delegates service error)", async () => {
        mockedValidate.mockResolvedValueOnce({
            valid: false,
            status: 401,
            apiError: { type: "invalid_token", message: "" },
        });

        const req = makeReq();
        const res = makeRes();

        await create(req, res);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({ type: "invalid_token", message: "" });
        expect(mockedSave).not.toHaveBeenCalled();
        expect(mockedWriteInfo).not.toHaveBeenCalled();
    });

    it("returns 409 when session already sealed", async () => {
        const info = baseInfo();
        info.sealedAt = new Date().toISOString();

        mockedValidate.mockResolvedValueOnce({ valid: true, info });

        const req = makeReq();
        const res = makeRes();

        await create(req, res);

        expect(res.status).toHaveBeenCalledWith(409);
        expect(res.json).toHaveBeenCalledWith({ type: "session_used", message: "" });
        expect(mockedSave).not.toHaveBeenCalled();
        expect(mockedWriteInfo).not.toHaveBeenCalled();
    });

    it("returns 400 when no files are provided", async () => {
        const info = baseInfo();
        mockedValidate.mockResolvedValueOnce({ valid: true, info });

        const req = makeReq({ files: undefined });
        const res = makeRes();

        await create(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
            type: "missing_files",
            message: "No files uploaded",
        });
        expect(mockedSave).not.toHaveBeenCalled();
        expect(mockedWriteInfo).not.toHaveBeenCalled();
    });

    it("passes files (flattened) and empty clientIds to saveUploads; returns 200 OK on full success", async () => {
        const info = baseInfo();
        info.counts.files = 1; // pre-existing files
        mockedValidate.mockResolvedValueOnce({ valid: true, info });

        // files: one single + one array (should flatten to 3)
        const fileA = { name: "a.png" } as UploadedFile;
        const fileB1 = { name: "b1.jpg" } as UploadedFile;
        const fileB2 = { name: "b2.jpg" } as UploadedFile;

        const req = makeReq({
            files: { a: fileA, b: [fileB1, fileB2] },
            // no manifest
        });
        const res = makeRes();

        mockedSave.mockResolvedValueOnce({
            accepted: [createAcceptedMockFileResponse("X1"), createAcceptedMockFileResponse("X2")],
            rejected: [],
        });

        await create(req, res);

        // saveUploads called with flattened files array (length 3) and empty clientIds
        expect(mockedSave).toHaveBeenCalledTimes(1);
        const [sidArg, outputMime, filesArg, clientIdsArg] = mockedSave.mock.calls[0];
        expect(sidArg).toBe("S123");
        expect(Array.isArray(filesArg)).toBe(true);
        expect(outputMime).toBe("image/webp");
        expect((filesArg as UploadedFile[])).toHaveLength(3);
        expect(clientIdsArg).toEqual([]);

        // session info updated: counts.files += accepted.length and sealedAt set
        expect(mockedWriteInfo).toHaveBeenCalledTimes(1);
        const [sid2, infoArg] = mockedWriteInfo.mock.calls[0];
        expect(sid2).toBe("S123");
        expect(infoArg.counts.files).toBe(1 + 2);
        expect(typeof infoArg.sealedAt).toBe("string");

        // response
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({
            status: "ok",
            accepted: [createAcceptedMockFileResponse("X1"), createAcceptedMockFileResponse("X2")],
            rejected: [],
        });
    });

    it("returns 207 Multi-Status with status='partial' when some files are rejected", async () => {
        const info = baseInfo();
        mockedValidate.mockResolvedValueOnce({ valid: true, info });

        const file = { name: "x.png" } as UploadedFile;
        const req = makeReq({ files: { x: file } });
        const res = makeRes();

        mockedSave.mockResolvedValueOnce({
            accepted: [createAcceptedMockFileResponse("A")],
            rejected: [{ fileName: "x.png", error: "bad mime" }],
        });

        await create(req, res);

        expect(res.status).toHaveBeenCalledWith(207);
        expect(res.json).toHaveBeenCalledWith({
            status: "partial",
            accepted: [createAcceptedMockFileResponse("A")],
            rejected: [{ fileName: "x.png", error: "bad mime" }],
        });

        // counts incremented by accepted only
        const [, infoArg] = mockedWriteInfo.mock.calls[0];
        expect(infoArg.counts.files).toBe(0 + 1);
    });

    it("forwards manifest clientIds to saveUploads", async () => {
        const info = baseInfo();
        mockedValidate.mockResolvedValueOnce({ valid: true, info });

        const file = { name: "y.png" } as UploadedFile;
        const req = makeReq({
            files: { y: file },
            manifest: JSON.stringify(["c1", "c2"]),
        });
        const res = makeRes();

        mockedSave.mockResolvedValueOnce({ accepted: [], rejected: [] });

        await create(req, res);

        const [, , , clientIds] = mockedSave.mock.calls[0];
        expect(clientIds).toEqual(["c1", "c2"]);
    });

    it("returns 500 upload_error if service throws", async () => {
        const info = baseInfo();
        mockedValidate.mockResolvedValueOnce({ valid: true, info });

        const file = { name: "z.png" } as UploadedFile;
        const req = makeReq({ files: { z: file } });
        const res = makeRes();

        mockedSave.mockRejectedValueOnce(new Error("disk full"));

        await create(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({
            type: "upload_error",
            message: "disk full",
        });
        expect(mockedWriteInfo).not.toHaveBeenCalled();
    });
});
