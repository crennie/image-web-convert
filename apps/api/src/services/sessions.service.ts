import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
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

export class SessionStorageError extends Error {
    readonly type = 'storage_error';
    constructor(message: string, cause?: unknown) {
        super(message, { cause });
        this.name = 'SessionStorageError';
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
    const directory = sessionDir(sid);
    const root = path.dirname(directory);
    try {
        await fs.mkdir(root, { recursive: true, mode: 0o700 });
        if (!(await fs.lstat(root)).isDirectory())
            throw new InvalidSessionRecordError('Invalid upload root');
        await fs.chmod(root, 0o700);
        await fs.mkdir(directory, { recursive: true, mode: 0o700 });
        if (!(await fs.lstat(directory)).isDirectory())
            throw new InvalidSessionRecordError('Invalid session directory');
        await fs.chmod(directory, 0o700);
        await writeSessionInfo(sid, info);
    } catch (error) {
        if (error instanceof SessionStorageError) throw error;
        throw new SessionStorageError('Unable to create session', error);
    }

    return { sid, expiresAt: info.expiresAt, accessToken: token, imageConfig };
}

/* ---------------------------- External Helpers -------------------------------- */

export async function readSessionInfo(
    sid: string,
    root?: string,
): Promise<SessionInfo> {
    let raw: string;
    try {
        const directory = await fs.lstat(sessionDir(sid, root));
        if (!directory.isDirectory())
            throw new InvalidSessionRecordError('Invalid session directory');
        const record = await fs.lstat(sessionInfoPath(sid, root));
        if (!record.isFile())
            throw new InvalidSessionRecordError('Invalid session record file');
        raw = await fs.readFile(sessionInfoPath(sid, root), 'utf8');
    } catch (error) {
        if (error instanceof InvalidSessionRecordError) throw error;
        if (
            error &&
            typeof error === 'object' &&
            'code' in error &&
            ['ENOENT', 'ENOTDIR', 'EISDIR', 'ELOOP'].includes(
                String(error.code),
            )
        )
            throw error;
        throw new SessionStorageError('Unable to read session record', error);
    }
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
    const target = sessionInfoPath(sid);
    const temporary = `${target}.${randomUUID()}.tmp`;
    const content = Buffer.from(
        JSON.stringify(parseSessionInfo(info, sid), null, 2),
    );
    try {
        await fs.writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
        const file = await fs.open(temporary, 'r');
        try {
            await file.sync();
        } finally {
            await file.close();
        }
        const actual = await fs.readFile(temporary);
        if (
            actual.length !== content.length ||
            createHash('sha256').update(actual).digest('hex') !==
                createHash('sha256').update(content).digest('hex')
        )
            throw new SessionStorageError('Incomplete session record write');
        await fs.rename(temporary, target);
        const directory = await fs.open(path.dirname(target), 'r');
        try {
            await directory.sync();
        } finally {
            await directory.close();
        }
    } catch (error) {
        if (error instanceof SessionStorageError) throw error;
        throw new SessionStorageError(
            'Unable to persist session record',
            error,
        );
    } finally {
        await fs.unlink(temporary).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== 'ENOENT')
                throw new SessionStorageError(
                    'Unable to clean session record staging',
                    error,
                );
        });
    }
}

export function isSessionExpired(info: SessionInfo, now = new Date()): boolean {
    const expiry = Date.parse(info.expiresAt);
    return !Number.isFinite(expiry) || now.getTime() >= expiry;
}
