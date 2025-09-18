import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { UploadedFile } from 'express-fileupload';
import { processImageToWebp } from '../image.service';

// ---- Hoisted, deterministic fixtures ----
const h = vi.hoisted(() => {
    const sid = 'sid-123';
    const id = 'fixed-id-999';
    const storedName = `${id}.webp`;
    const processed = {
        buffer: Buffer.from('webp-binary'),
        inputMeta: {
            mime: 'image/jpeg',
            width: 1200,
            height: 800,
            pages: 1,
            hasAlpha: false,
        },
        outputMime: 'image/webp',
        info: {
            sizeBytes: 9876,
            width: 1200,
            height: 800,
            colorSpace: 'srgb',
            exifStripped: true,
            animated: false,
        },
    };
    return { sid, id, storedName, processed };
});

vi.mock('../image.service', () => ({
    processImageToWebp: vi.fn().mockResolvedValue(h.processed),
}));

// Compute tmpRoot after imports are ready
const tmpRoot = path.join(
    os.tmpdir(),
    `iwc-api-storage-${Date.now()}-${Math.random().toString(36).slice(2)}`
);

// Need to pass in a new UPLOAD_DIR to session storage based on test root tmpRoot.
// So set that as env var before adding any mocks - avoid hoisting these by using with doMock
let storage: typeof import('../storage.service');
beforeAll(async () => {
    // 1) point UPLOAD_DIR at tmpRoot BEFORE importing the module
    process.env.UPLOAD_DIR = tmpRoot;

    // 2) fresh module graph
    vi.resetModules();

    // 3) mocks that storage.service depends on
    vi.doMock('@image-web-convert/node-shared', async (importOriginal) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const actual = await importOriginal<typeof import('@image-web-convert/node-shared')>();
        return {
            ...actual,
            normalizeAbsolutePath: (p: string) => p, // identity so env value is used as-is
            secureId: () => 'fixed-id-999',
        };
    });
    vi.doMock('../sessions.service', () => ({
        sessionDir: (sid: string) => path.join(tmpRoot, sid),
    }));

    // Ensure tmp root exists (module also mkdirs)
    fssync.mkdirSync(tmpRoot, { recursive: true });

    // 4) NOW import the module under test
    storage = await import('../storage.service');
});

afterAll(async () => {
    // Cleanup
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {
        //
    });
});

const mkUpload = (name: string, tempFilePath: string, size = 4321): UploadedFile =>
({
    name,
    mimetype: 'image/jpeg',
    size,
    tempFilePath,
    mv: vi.fn(),
    md5: 'x',
    encoding: '7bit',
    truncated: false,
} as unknown as UploadedFile);

describe('storage.service config', () => {
    it('uses the temp UPLOAD_DIR for tests', () => {
        expect(storage.UPLOAD_DIR).toBe(tmpRoot);
        expect(fssync.existsSync(storage.UPLOAD_DIR)).toBe(true);
    });
});

describe('pathForStored', () => {
    it('joins sessionDir and stored filename', () => {
        const p = storage.pathForStored(h.sid, h.storedName);
        expect(p).toBe(path.join(tmpRoot, h.sid, h.storedName));
    });
});

describe('saveUploadFile', () => {
    it('processes, writes .webp, writes metadata JSON, deletes temp file, returns ApiUploadAccepted', async () => {
        // Arrange temp input file
        const sessionPath = path.join(tmpRoot, h.sid);
        await fs.mkdir(sessionPath, { recursive: true });

        const tmpInput = path.join(tmpRoot, 'temp-input.jpg');
        await fs.writeFile(tmpInput, Buffer.from('original-binary'));

        const upload = mkUpload('nice/photo:01?.jpg', tmpInput);

        // Act
        const res = await storage.saveUploadFile(h.sid, upload, 'client-42');

        // Assert return object
        expect(res.id).toBe(h.id);
        expect(res.url).toBe(`/files/${h.id}`);
        expect(res.metaUrl).toBe(`/files/${h.id}/meta`);
        expect(res.clientId).toBe('client-42');

        // Stored file exists with processed contents
        const storedPath = path.join(sessionPath, h.storedName);
        const storedBuf = await fs.readFile(storedPath);
        expect(storedBuf.equals(h.processed.buffer)).toBe(true);

        // Meta JSON exists and matches shape (including sanitized original name)
        const metaPath = path.join(sessionPath, `${h.id}.json`);
        const meta = JSON.parse(await fs.readFile(metaPath, 'utf8'));
        expect(meta).toMatchObject({
            id: h.id,
            original: {
                name: 'photo_01_.jpg', // sanitized from `nice/photo:01?.jpg`
                mime: 'image/jpeg',
                sizeBytes: upload.size,
                width: h.processed.inputMeta.width,
                height: h.processed.inputMeta.height,
                pages: h.processed.inputMeta.pages,
            },
            output: {
                storedName: h.storedName,
                mime: h.processed.outputMime,
                sizeBytes: h.processed.info.sizeBytes,
                width: h.processed.info.width,
                height: h.processed.info.height,
                colorSpace: h.processed.info.colorSpace,
            },
            exifStripped: h.processed.info.exifStripped,
            animated: h.processed.info.animated,
        });

        // Temp file is deleted
        await expect(fs.access(tmpInput)).rejects.toBeTruthy();

        // The processor was called with our temp path
        expect(processImageToWebp).toHaveBeenCalledWith({ inputPath: tmpInput });
    });
});

describe('readMeta', () => {
    it('returns parsed meta when file exists; null when it does not', async () => {
        // Existing meta from the previous test run
        const existing = await storage.readMeta(h.sid, h.id);
        expect(existing && existing.id).toBe(h.id);

        // Non-existing
        const none = await storage.readMeta(h.sid, 'does-not-exist');
        expect(none).toBeNull();
    });
});
