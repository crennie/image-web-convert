import path from 'node:path';
import fs from 'node:fs/promises';
import { UPLOAD_DIR } from './storage.service';
import { secureId } from '../utils';
import { generateAccessToken } from "../auth/authUtils";

//const isProd = process.env.NODE_ENV === 'production';

// Defaults (can later be moved to env schema)
const DEFAULT_TTL_MINUTES = Number(process.env.SESSION_TTL_MINUTES ?? 15); // 15 minutes
const DEFAULT_MAX_FILES = Number(process.env.SESSION_MAX_FILES ?? 100);
const DEFAULT_MAX_TOTAL_BYTES = Number(process.env.SESSION_MAX_TOTAL_BYTES ?? 500_000_000); // ~500MB

// --- Session file contents ---
export type SessionLimits = {
    maxFiles: number;
    maxTotalBytes: number;
};

export type SessionCounts = {
    files: number;
    totalBytes: number;
};
export type SessionInfo = {
    id: string;
    createdAt: string;   // ISO
    expiresAt: string;   // ISO
    sealedAt: string | null; // set when upload batch completes
    limits: SessionLimits;
    counts: SessionCounts;
    tokenHash: string;
};

interface CreateSessionResponse {
    sid: string;
    expiresAt: string;
    accessToken: string;
}

export async function create(): Promise<CreateSessionResponse> {
    const sid = secureId();
    const ttl = DEFAULT_TTL_MINUTES;
    const now = new Date();
    const expires = new Date(now.getTime() + ttl * 60_000);
    const { token, hash } = generateAccessToken();
    const limits: SessionLimits = {
        maxFiles: DEFAULT_MAX_FILES,
        maxTotalBytes: DEFAULT_MAX_TOTAL_BYTES,
    };
    const info: SessionInfo = {
        id: sid,
        createdAt: now.toISOString(),
        expiresAt: expires.toISOString(),
        sealedAt: null,
        limits,
        counts: { files: 0, totalBytes: 0 },
        tokenHash: hash,
    };

    // Write session.info.json
    await fs.mkdir(sessionDir(sid), { recursive: true });
    await writeSessionInfo(sid, info);

    return { sid, expiresAt: info.expiresAt, accessToken: token };
}

/* ---------------------------- External Helpers -------------------------------- */

export async function readSessionInfo(sid: string): Promise<SessionInfo> {
    const raw = await fs.readFile(sessionInfoPath(sid), "utf8");
    const info = JSON.parse(raw) as SessionInfo;
    return info;
}

export async function writeSessionInfo(sid: string, info: SessionInfo): Promise<void> {
    await fs.writeFile(sessionInfoPath(sid), JSON.stringify(info, null, 2), "utf8");
}

export function isSessionExpired(info: SessionInfo, now = new Date()): boolean {
    return now > new Date(info.expiresAt);
}

export function sessionInfoPath(sid: string): string {
    return path.join(sessionDir(sid), 'session.info.json');
}

export function sessionDir(sid: string): string {
    return path.join(UPLOAD_DIR, sid);
}
