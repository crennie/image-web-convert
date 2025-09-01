import type { Request, Response } from 'express';
import { extractBearerToken, hashAccessToken, timingSafeEqHex } from "../auth/authUtils";
import { ApiError, ApiErrorSessionExpired, ApiErrorSessionNotFound, ApiErrorToken } from '@image-web-convert/schemas';
import { isSessionExpired, readSessionInfo, SessionInfo } from './sessions.service';

type ValidTokenResponse = {
    valid: true;
    info: SessionInfo;
}
type InvalidTokenResponse = {
    valid: false;
    status: number;
    apiError: ApiError;
}
type ValidateTokenResponse = ValidTokenResponse | InvalidTokenResponse;

export async function validateRequestWithToken(req: Request, res: Response): Promise<ValidateTokenResponse> {
    const { sid } = req.params;
    const token = extractBearerToken(req.header("authorization") || undefined);
    if (!token) {
        res.setHeader("WWW-Authenticate", 'Bearer realm="sessions"');
        const response: ApiErrorToken = { type: "invalid_token", message: "" };
        //return res.status(401).json(response);
        return { valid: false, status: 401, apiError: response };
    }

    let info;
    try {
        info = await readSessionInfo(sid);
    } catch {
        const response: ApiErrorSessionNotFound = { type: "session_not_found", message: "" };
        //return res.status(404).json(response);
        return { valid: false, status: 404, apiError: response };
    }

    // 401 invalid token
    const presentedHash = hashAccessToken(token);
    if (!timingSafeEqHex(presentedHash, info.tokenHash)) {
        res.setHeader("WWW-Authenticate", 'Bearer error="invalid_token"');
        const response: ApiErrorToken = { type: "invalid_token", message: "" };
        //return res.status(401).json(response);
        return { valid: false, status: 401, apiError: response };
    }

    // 403 expired
    if (isSessionExpired(info)) {
        const response: ApiErrorSessionExpired = { type: "session_expired", message: "" };
        //return res.status(403).json(response);
        return { valid: false, status: 403, apiError: response };
    }

    return { valid: true, info };
}
