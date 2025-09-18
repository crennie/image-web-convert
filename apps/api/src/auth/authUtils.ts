import { secureId } from "@image-web-convert/node-shared";
import crypto from "node:crypto";

export function generateAccessToken(): { token: string; hash: string } {
    const token = secureId(32, "hex")
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    return { token, hash };
}

export function extractBearerToken(authorization?: string): string | null {
    if (!authorization) return null;
    const match = authorization.match(/^\s*?Bearer\s+(\S+)\s*?$/i);
    return match ? match[1] : null;
}

export function hashAccessToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
}

export function timingSafeEqHex(aHex: string, bHex: string): boolean {
    // must be even length and only 0-9a-f
    const hexPattern = /^[0-9a-fA-F]+$/;
    if (!hexPattern.test(aHex) || !hexPattern.test(bHex)) return false;
    if (aHex.length % 2 !== 0 || bHex.length % 2 !== 0) return false;

    const a = Buffer.from(aHex, "hex");
    const b = Buffer.from(bHex, "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
}