import fs from 'node:fs/promises';
import path from 'node:path';
import {
    create, isSessionExpired, readSessionInfo, sessionDir, sessionInfoPath, writeSessionInfo
} from '../sessions.service';

// Hoisted constants used inside module mocks.
const h = vi.hoisted(() => {
    const os = require('node:os');
    const p = require('node:path');
    const uploadDir = p.join(
        os.tmpdir(),
        `iwc-api-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    return {
        uploadDir,
        ttlMinutes: 45,
        fixedSid: 'sid-1234567890abcdef1234567890abcdef',
        token: 'token-abc',
        tokenHash: 'hash-abc',
        fixedNow: new Date('2025-09-17T15:00:00.000Z'),
    };
});

// Point the service at a temp upload directory
vi.mock('../storage.service', () => ({
    UPLOAD_DIR: h.uploadDir,
}));

// Deterministic ID/token + TTL
vi.mock('@image-web-convert/node-shared', () => ({
    secureId: () => h.fixedSid,
}));
vi.mock('../../auth/authUtils', () => ({
    generateAccessToken: () => ({ token: h.token, hash: h.tokenHash })
}));
vi.mock('@image-web-convert/schemas', () => ({
    SESSION_IMAGE_CONFIG: { ttlMinutes: h.ttlMinutes },
}));

beforeAll(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(h.fixedNow);
});

afterAll(async () => {
    await fs.rm(h.uploadDir, { recursive: true, force: true }).catch(() => {
        //
    });
    vi.useRealTimers();
});


describe('session.service create()', () => {
    it('creates a new session dir, writes session.info.json, and returns sid/ttl/token/expiry', async () => {
        const result = await create();
        // Returns fixed sid/token and computed expiry
        expect(result.sid).toBe(h.fixedSid);
        const expectedExpires = new Date(
            h.fixedNow.getTime() + h.ttlMinutes * 60_000
        ).toISOString();
        expect(result.expiresAt).toBe(expectedExpires);
        expect(result.accessToken).toBe(h.token);

        // session.info.json exists with expected contents
        const infoPath = sessionInfoPath(h.fixedSid);
        const stat = await fs.stat(infoPath);
        expect(stat.isFile()).toBe(true);

        const parsed = JSON.parse(await fs.readFile(infoPath, 'utf8'));
        expect(parsed).toMatchObject({
            id: h.fixedSid,
            createdAt: h.fixedNow.toISOString(),
            expiresAt: expectedExpires,
            sealedAt: null,
            counts: { files: 0, totalBytes: 0 },
            tokenHash: h.tokenHash,
        });
    });
});


describe('session.service helpers', () => {
    it('sessionDir builds path under UPLOAD_DIR', () => {
        const dir = sessionDir('abc');
        expect(dir).toBe(path.join(h.uploadDir, 'abc'));
    });

    it('sessionInfoPath appends session.info.json', () => {
        const p = sessionInfoPath('abc');
        expect(p).toBe(path.join(h.uploadDir, 'abc', 'session.info.json'));
    });
});

describe('isSessionExpired', () => {
    it('false when expiresAt is in the future', () => {
        const info = {
            id: 'x',
            createdAt: h.fixedNow.toISOString(),
            expiresAt: new Date(h.fixedNow.getTime() + 60_000).toISOString(),
            sealedAt: null,
            counts: { files: 0, totalBytes: 0 },
            tokenHash: h.tokenHash,
        };
        expect(isSessionExpired(info)).toBe(false);
    });

    it('true when expiresAt is in the past', () => {
        const info = {
            id: 'x',
            createdAt: h.fixedNow.toISOString(),
            expiresAt: new Date(h.fixedNow.getTime() - 1).toISOString(),
            sealedAt: null,
            counts: { files: 0, totalBytes: 0 },
            tokenHash: h.tokenHash,
        };
        expect(isSessionExpired(info)).toBe(true);
    });
});

describe('writeSessionInfo / readSessionInfo', () => {
    it('writes pretty JSON and can be read back', async () => {
        const sid = 'abc';
        const info = {
            id: sid,
            createdAt: new Date(h.fixedNow.getTime() - 5000).toISOString(),
            expiresAt: new Date(h.fixedNow.getTime() + 5000).toISOString(),
            sealedAt: null,
            counts: { files: 2, totalBytes: 1234 },
            tokenHash: 'hash-xyz',
        };

        await fs.mkdir(sessionDir(sid), { recursive: true });
        await writeSessionInfo(sid, info);

        const raw = await fs.readFile(sessionInfoPath(sid), 'utf8');
        expect(raw).toBe(JSON.stringify(info, null, 2)); // pretty, no trailing newline

        const roundTrip = await readSessionInfo(sid);
        expect(roundTrip).toEqual(info);
    });
});
