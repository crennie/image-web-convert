import type { Request, Response, NextFunction } from "express";
import { createSession } from "../sessions.controller";
import { create } from "../../services/sessions.service";
import { MockInstance } from 'vitest';

vi.mock("../../services/sessions.service", () => ({
    create: vi.fn(),
}));

const mockedCreate = vi.mocked(create);

function makeReq(): Request {
    return {} as unknown as Request;
}

function makeRes(): Response & { status: MockInstance; json: MockInstance } {
    const res = {
        status: vi.fn(),
        json: vi.fn(),
    } as unknown as Response & { status: MockInstance; json: MockInstance };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (res.status as any).mockReturnValue(res);
    return res;
}

function makeNext(): NextFunction {
    return vi.fn() as unknown as NextFunction;
}

describe("createSession controller", () => {
    beforeEach(() => vi.clearAllMocks());
    afterEach(() => vi.restoreAllMocks());

    it("responds 201 with { sid, expiresAt, token } when service succeeds", async () => {
        mockedCreate.mockResolvedValueOnce({
            sid: "S123",
            expiresAt: '2020-10-10',
            accessToken: "tok_abc123",
        });

        const req = makeReq();
        const res = makeRes();
        const next = makeNext();

        await createSession(req, res, next);

        expect(mockedCreate).toHaveBeenCalledTimes(1);
        expect(res.status).toHaveBeenCalledWith(201);
        expect(res.json).toHaveBeenCalledWith({
            sid: "S123",
            expiresAt: '2020-10-10',
            token: "tok_abc123",
        });
        expect(next).not.toHaveBeenCalled();
    });

    it("calls next(err) when service throws", async () => {
        const err = new Error("boom");
        mockedCreate.mockRejectedValueOnce(err);

        const req = makeReq();
        const res = makeRes();
        const next = makeNext();

        await createSession(req, res, next);

        expect(next).toHaveBeenCalledWith(err);
        expect(res.status).not.toHaveBeenCalled();
        expect(res.json).not.toHaveBeenCalled();
    });
});
