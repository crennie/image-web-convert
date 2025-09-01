import crypto from "node:crypto";
import { secureId } from "../utils";

export function generateAccessToken(): { token: string; hash: string } {
    const token = secureId(32, "hex")
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    return { token, hash };
}

export function extractBearerToken(authorization?: string): string | null {
    if (!authorization) return null;
    const [scheme, token] = authorization.split(" ");
    return scheme?.toLowerCase() === "bearer" && token ? token : null;
}

export function hashAccessToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
}

export function timingSafeEqHex(aHex: string, bHex: string): boolean {
    const a = Buffer.from(aHex, "hex");
    const b = Buffer.from(bHex, "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}