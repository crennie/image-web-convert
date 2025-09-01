import crypto from "node:crypto";

type IdEncoding = 'hex' | 'base64url';

/**
 * Generate a cryptographically-strong, filesystem-safe ID.
 * - Default: 16 bytes (128-bit) in hex (32 chars)
 * - Use base64url for shorter IDs (no + / =)
 */
export function secureId(bytes = 16, encoding: IdEncoding = 'hex'): string {
    if (!Number.isInteger(bytes) || bytes <= 0) {
        throw new Error('secureId: "bytes" must be a positive integer');
    }
    const buf = crypto.randomBytes(bytes);

    if (encoding === 'hex') return buf.toString('hex');
    return buf.toString('base64url')
}
