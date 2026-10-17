import fs from 'node:fs/promises';
import { secureId } from '@image-web-convert/node-shared';
import { generateAccessToken } from '../auth/authUtils';
import type { SessionImageConfig } from '@image-web-convert/schemas';
import { ConversionIdSchema } from '@image-web-convert/schemas';
import { z } from 'zod';
import { getSessionImageConfig } from '../env';
import { sessionDir, sessionInfoPath } from './storage.paths';

//const isProd = process.env.NODE_ENV === 'production';

// --- Session file contents ---
export type SessionCounts = {
    files: number;
    totalBytes: number;
};
export type SessionInfo = {
    id: string;
    createdAt: string; // ISO
    expiresAt: string; // ISO
    sealedAt: string | null; // set when upload batch completes
    counts: SessionCounts;
    tokenHash: string;
};

const timestamp = z
    .string()
    .refine(
        (value) =>
            /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
            Number.isFinite(Date.parse(value)) &&
            new Date(value).toISOString() === value,
        'Invalid session timestamp',
    );
const SessionInfoSchema = z.object({
    id: ConversionIdSchema,
    createdAt: timestamp,
    expiresAt: timestamp,
    sealedAt: timestamp.nullable(),
    counts: z.object({
        files: z.number().int().nonnegative(),
        totalBytes: z.number().int().nonnegative(),
    }),
    tokenHash: z.string().regex(/^[0-9a-f]{64}$/),
});

export class InvalidSessionRecordError extends Error {
    constructor(cause: unknown) {
        super('Invalid persisted session record', { cause });
        this.name = 'InvalidSessionRecordError';
    }
}

export function parseSessionInfo(value: unknown, sid: string): SessionInfo {
    try {
        const info = SessionInfoSchema.parse(value);
        if (
            info.id !== sid ||
            Date.parse(info.expiresAt) <= Date.parse(info.createdAt) ||
            (info.sealedAt !== null &&
                (Date.parse(info.sealedAt) < Date.parse(info.createdAt) ||
                    Date.parse(info.sealedAt) > Date.parse(info.expiresAt)))
        )
            throw new Error('Session association or chronology mismatch');
        return info;
    } catch (error) {
        throw new InvalidSessionRecordError(error);
    }
}

interface CreateSessionResponse {
    sid: string;
    expiresAt: string;
    accessToken: string;
    imageConfig: SessionImageConfig;
}

export async function create(): Promise<CreateSessionResponse> {
    const sid = secureId();
    const imageConfig = getSessionImageConfig();
    const ttl = imageConfig.ttlMinutes;
    const now = new Date();
    const expires = new Date(now.getTime() + ttl * 60_000);
    const { token, hash } = generateAccessToken();
    const info: SessionInfo = {
        id: sid,
        createdAt: now.toISOString(),
        expiresAt: expires.toISOString(),
        sealedAt: null,
        counts: { files: 0, totalBytes: 0 },
        tokenHash: hash,
    };

    // Write session.info.json
    await fs.mkdir(sessionDir(sid), { recursive: true, mode: 0o700 });
    await writeSessionInfo(sid, info);

    return { sid, expiresAt: info.expiresAt, accessToken: token, imageConfig };
}

/* ---------------------------- External Helpers -------------------------------- */

export async function readSessionInfo(
    sid: string,
    root?: string,
): Promise<SessionInfo> {
    const raw = await fs.readFile(sessionInfoPath(sid, root), 'utf8');
    try {
        return parseSessionInfo(JSON.parse(raw), sid);
    } catch (error) {
        if (error instanceof InvalidSessionRecordError) throw error;
        throw new InvalidSessionRecordError(error);
    }
}

export async function writeSessionInfo(
    sid: string,
    info: SessionInfo,
): Promise<void> {
    await fs.writeFile(sessionInfoPath(sid), JSON.stringify(info, null, 2), {
        encoding: 'utf8',
        mode: 0o600,
    });
}

export function isSessionExpired(info: SessionInfo, now = new Date()): boolean {
    const expiry = Date.parse(info.expiresAt);
    return !Number.isFinite(expiry) || now.getTime() >= expiry;
}
