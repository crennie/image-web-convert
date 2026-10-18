import fs from 'node:fs/promises';
import path from 'node:path';
import {
    create,
    isSessionExpired,
    readSessionInfo,
    InvalidSessionRecordError,
    SessionStorageError,
    writeSessionInfo,
} from '../sessions.service';
import { sessionDir, sessionInfoPath } from '../storage.paths';

// Hoisted constants used inside module mocks.
const h = vi.hoisted(() => {
    const os = require('node:os');
    const p = require('node:path');
    const uploadDir = p.join(
        os.tmpdir(),
        `iwc-api-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    return {
        uploadDir,
        ttlMinutes: 45,
        fixedSid: 'sid-1234567890abcdef1234567890abcdef',
        token: 'token-abc',
        tokenHash: 'a'.repeat(64),
        fixedNow: new Date('2025-09-17T15:00:00.000Z'),
    };
});

// Point the service at a temp upload directory
vi.mock('../storage.paths', () => ({
    UPLOAD_DIR: h.uploadDir,
    sessionDir: (sid: string) => path.join(h.uploadDir, sid),
    sessionInfoPath: (sid: string) =>
        path.join(h.uploadDir, sid, 'session.info.json'),
}));

// Deterministic ID/token + TTL
vi.mock('@image-web-convert/node-shared', () => ({
    secureId: () => h.fixedSid,
}));
vi.mock('../../auth/authUtils', () => ({
    generateAccessToken: () => ({ token: h.token, hash: h.tokenHash }),
}));
vi.mock('../../env', () => ({
    getSessionImageConfig: () => ({
        ttlMinutes: h.ttlMinutes,
        maxFiles: 20,
        maxBytesPerFile: 20_000_000,
        maxTotalBytes: 500_000_000,
    }),
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
afterEach(() => vi.restoreAllMocks());

describe('session.service create()', () => {
    it('creates a new session dir, writes session.info.json, and returns sid/ttl/token/expiry', async () => {
        const result = await create();
        // Returns fixed sid/token and computed expiry
        expect(result.sid).toBe(h.fixedSid);
        const expectedExpires = new Date(
            h.fixedNow.getTime() + h.ttlMinutes * 60_000,
        ).toISOString();
        expect(result.expiresAt).toBe(expectedExpires);
        expect(result.accessToken).toBe(h.token);
        expect(result.imageConfig.ttlMinutes).toBe(h.ttlMinutes);

        // session.info.json exists with expected contents
        const infoPath = sessionInfoPath(h.fixedSid);
        const stat = await fs.stat(infoPath);
        expect(stat.isFile()).toBe(true);
        expect(stat.mode & 0o777).toBe(0o600);
        expect((await fs.stat(sessionDir(h.fixedSid))).mode & 0o777).toBe(
            0o700,
        );
        expect((await fs.stat(h.uploadDir)).mode & 0o777).toBe(0o700);

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
    const validInfo = (sid: string) => ({
        id: sid,
        createdAt: h.fixedNow.toISOString(),
        expiresAt: new Date(h.fixedNow.getTime() + 60_000).toISOString(),
        sealedAt: null,
        counts: { files: 0, totalBytes: 0 },
        tokenHash: 'b'.repeat(64),
    });

    it('tags an unlabelled session file read failure as storage I/O', async () => {
        const sid = 'unlabelled-read';
        await fs.mkdir(sessionDir(sid), { recursive: true });
        await writeSessionInfo(sid, validInfo(sid));
        const failure = new Error('Unlabelled disk failure');
        vi.spyOn(fs, 'readFile').mockRejectedValueOnce(failure);
        await expect(readSessionInfo(sid)).rejects.toMatchObject({
            type: 'storage_error',
            cause: failure,
        });
    });

    it('rejects a successful short write before publishing a session record', async () => {
        const sid = 'short-write';
        await fs.mkdir(sessionDir(sid), { recursive: true });
        const writeFile = fs.writeFile.bind(fs);
        vi.spyOn(fs, 'writeFile').mockImplementation(
            async (target, data, options) => {
                if (String(target).startsWith(`${sessionInfoPath(sid)}.`))
                    return writeFile(
                        target,
                        (data as Buffer).subarray(0, 8),
                        options,
                    );
                return writeFile(target, data, options);
            },
        );
        await expect(
            writeSessionInfo(sid, validInfo(sid)),
        ).rejects.toBeInstanceOf(SessionStorageError);
        await expect(fs.stat(sessionInfoPath(sid))).rejects.toMatchObject({
            code: 'ENOENT',
        });
        expect(await fs.readdir(sessionDir(sid))).toEqual([]);
    });

    it('keeps the prior record when replacement rename fails', async () => {
        const sid = 'rename-failure';
        await fs.mkdir(sessionDir(sid), { recursive: true });
        const original = validInfo(sid);
        await writeSessionInfo(sid, original);
        const rename = fs.rename.bind(fs);
        vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
            if (to === sessionInfoPath(sid))
                throw Object.assign(new Error('Injected rename failure'), {
                    code: 'EIO',
                });
            return rename(from, to);
        });
        await expect(
            writeSessionInfo(sid, {
                ...original,
                counts: { files: 1, totalBytes: 3 },
            }),
        ).rejects.toMatchObject({
            type: 'storage_error',
            cause: { code: 'EIO' },
        });
        expect(await readSessionInfo(sid)).toEqual(original);
        expect(await fs.readdir(sessionDir(sid))).toEqual([
            'session.info.json',
        ]);
    });

    it('writes pretty JSON and can be read back', async () => {
        const sid = 'abc';
        const info = {
            id: sid,
            createdAt: new Date(h.fixedNow.getTime() - 5000).toISOString(),
            expiresAt: new Date(h.fixedNow.getTime() + 5000).toISOString(),
            sealedAt: null,
            counts: { files: 2, totalBytes: 1234 },
            tokenHash: 'b'.repeat(64),
        };

        await fs.mkdir(sessionDir(sid), { recursive: true });
        await writeSessionInfo(sid, info);

        const raw = await fs.readFile(sessionInfoPath(sid), 'utf8');
        expect(raw).toBe(JSON.stringify(info, null, 2)); // pretty, no trailing newline

        const roundTrip = await readSessionInfo(sid);
        expect(roundTrip).toEqual(info);
    });

    it.each([
        { expiresAt: 'not-a-date' },
        { tokenHash: 'invalid' },
        { id: '../other' },
        { counts: { files: -1, totalBytes: 0 } },
    ])('rejects malformed persisted records', async (change) => {
        const sid = 'malformed';
        await fs.mkdir(sessionDir(sid), { recursive: true });
        await fs.writeFile(
            sessionInfoPath(sid),
            JSON.stringify({
                id: sid,
                createdAt: '2025-09-17T15:00:00.000Z',
                expiresAt: '2025-09-17T16:00:00.000Z',
                sealedAt: null,
                counts: { files: 0, totalBytes: 0 },
                tokenHash: 'a'.repeat(64),
                ...change,
            }),
        );
        await expect(readSessionInfo(sid)).rejects.toBeInstanceOf(
            InvalidSessionRecordError,
        );
    });
});
