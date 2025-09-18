import type { Request, Response } from "express";
import { validateRequestWithToken } from "../auth.service";

import { extractBearerToken, hashAccessToken, timingSafeEqHex } from "../../auth/authUtils";

import { readSessionInfo, isSessionExpired } from "../sessions.service";

// ---- Mocks ----
vi.mock("../../auth/authUtils", () => ({
    extractBearerToken: vi.fn(),
    hashAccessToken: vi.fn(),
    timingSafeEqHex: vi.fn(),
}));

vi.mock("../sessions.service", () => ({
    readSessionInfo: vi.fn(),
    isSessionExpired: vi.fn(),
}));

// typed helpers
const mockedExtract = vi.mocked(extractBearerToken);
const mockedHash = vi.mocked(hashAccessToken);
const mockedTSEq = vi.mocked(timingSafeEqHex);
const mockedRead = vi.mocked(readSessionInfo);
const mockedExpired = vi.mocked(isSessionExpired);

// ---- Test helpers ----
function makeReq(opts?: {
    sid?: string;
    authorization?: string | null;
}): Request {
    const sid = opts?.sid ?? "S123";
    const authorization = opts?.authorization ?? null;

    const headers: Record<string, string> = {};
    if (authorization != null) headers["authorization"] = authorization;

    return {
        params: { sid },
        header: (name: string) => headers[name.toLowerCase()],
    } as unknown as Request;
}

function makeRes(): Response & {
    _headers: Record<string, string>;
} {
    const _headers: Record<string, string> = {};
    return {
        _headers,
        setHeader: vi.fn((k: string, v: string) => {
            _headers[k] = v;
        }),
    } as unknown as Response & { _headers: Record<string, string> };
}

describe("validateRequestWithToken", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("401 when no Bearer token; sets WWW-Authenticate realm", async () => {
        const req = makeReq({ authorization: null });
        const res = makeRes();

        mockedExtract.mockReturnValueOnce(null);

        const result = await validateRequestWithToken(req, res);

        expect(mockedExtract).toHaveBeenCalledTimes(1);
        expect(result).toEqual({
            valid: false,
            status: 401,
            apiError: { type: "invalid_token", message: "" },
        });

        expect(res.setHeader).toHaveBeenCalledWith(
            "WWW-Authenticate",
            'Bearer realm="sessions"',
        );
    });

    it("404 when session not found (readSessionInfo throws)", async () => {
        const req = makeReq({ authorization: "Bearer abc" });
        const res = makeRes();

        mockedExtract.mockReturnValueOnce("abc");
        mockedRead.mockRejectedValueOnce(new Error("nope"));

        const result = await validateRequestWithToken(req, res);

        expect(mockedRead).toHaveBeenCalledWith("S123");
        expect(result).toEqual({
            valid: false,
            status: 404,
            apiError: { type: "session_not_found", message: "" },
        });
        // no header needed here
        expect(res.setHeader).not.toHaveBeenCalled();
    });

    it("401 when token hash mismatch; sets invalid_token header", async () => {
        const req = makeReq({ authorization: "Bearer abc" });
        const res = makeRes();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const info = { tokenHash: "deadbeef" } as any;

        mockedExtract.mockReturnValueOnce("abc");
        mockedRead.mockResolvedValueOnce(info);
        mockedHash.mockReturnValueOnce("cafebabe"); // presented hash
        mockedTSEq.mockReturnValueOnce(false); // mismatch

        const result = await validateRequestWithToken(req, res);

        expect(mockedHash).toHaveBeenCalledWith("abc");
        expect(mockedTSEq).toHaveBeenCalledWith("cafebabe", "deadbeef");

        expect(result).toEqual({
            valid: false,
            status: 401,
            apiError: { type: "invalid_token", message: "" },
        });

        expect(res.setHeader).toHaveBeenCalledWith(
            "WWW-Authenticate",
            'Bearer error="invalid_token"',
        );
    });

    it("403 when session is expired", async () => {
        const req = makeReq({ authorization: "Bearer abc" });
        const res = makeRes();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const info = { tokenHash: "deadbeef" } as any;

        mockedExtract.mockReturnValueOnce("abc");
        mockedRead.mockResolvedValueOnce(info);
        mockedHash.mockReturnValueOnce("deadbeef");
        mockedTSEq.mockReturnValueOnce(true); // hashes match
        mockedExpired.mockReturnValueOnce(true); // expired

        const result = await validateRequestWithToken(req, res);

        expect(result).toEqual({
            valid: false,
            status: 403,
            apiError: { type: "session_expired", message: "" },
        });
        expect(res.setHeader).not.toHaveBeenCalled();
    });

    it("success path: returns { valid: true, info }", async () => {
        const req = makeReq({ authorization: "Bearer abc" });
        const res = makeRes();

        const info = {
            tokenHash: "deadbeef",
            sid: "S123",
            createdAt: Date.now(),

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;

        mockedExtract.mockReturnValueOnce("abc");
        mockedRead.mockResolvedValueOnce(info);
        mockedHash.mockReturnValueOnce("deadbeef");
        mockedTSEq.mockReturnValueOnce(true);
        mockedExpired.mockReturnValueOnce(false);

        const result = await validateRequestWithToken(req, res);

        expect(result).toEqual({ valid: true, info });
        expect(res.setHeader).not.toHaveBeenCalled();
    });
});
