import fs from 'node:fs/promises';
import { secureId } from '@image-web-convert/node-shared';
import { generateAccessToken } from '../auth/authUtils';
import type { SessionImageConfig } from '@image-web-convert/schemas';
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
    await fs.mkdir(sessionDir(sid), { recursive: true });
    await writeSessionInfo(sid, info);

    return { sid, expiresAt: info.expiresAt, accessToken: token, imageConfig };
}

/* ---------------------------- External Helpers -------------------------------- */

export async function readSessionInfo(
    sid: string,
    root?: string,
): Promise<SessionInfo> {
    const raw = await fs.readFile(sessionInfoPath(sid, root), 'utf8');
    const info = JSON.parse(raw) as SessionInfo;
    return info;
}

export async function writeSessionInfo(
    sid: string,
    info: SessionInfo,
): Promise<void> {
    await fs.writeFile(
        sessionInfoPath(sid),
        JSON.stringify(info, null, 2),
        'utf8',
    );
}

export function isSessionExpired(info: SessionInfo, now = new Date()): boolean {
    return now > new Date(info.expiresAt);
}
