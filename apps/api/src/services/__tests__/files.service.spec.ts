import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import { resolveFilesByIds, streamZip } from '../files.service';
import { MockInstance } from 'vitest';

// ---- Mocks ----
// 1) Mock normalizeAbsolutePath to identity so we can assert paths exactly
vi.mock('@image-web-convert/node-shared', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@image-web-convert/node-shared')>();
    return {
        ...actual,
        normalizeAbsolutePath: (p: string) => p
    };
});

// 2) Mock storage helpers: readMeta + pathForStored
const readMetaMock = vi.fn();
const pathForStoredMock = vi.fn();
vi.mock('../storage.service', () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readMeta: (...args: any[]) => readMetaMock(...args),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pathForStored: (...args: any[]) => pathForStoredMock(...args),
}));

// 3) Mock archiver (default export is a function that returns an archive instance)
const archiveApi = {
    on: vi.fn(),
    pipe: vi.fn(),
    file: vi.fn(),
    finalize: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn(),
};
vi.mock('archiver', () => ({
    default: vi.fn(() => archiveApi),
}));

// Simple Response stub with header tracking and abort events
class ResStub extends EventEmitter {
    headers: Record<string, string> = {};
    setHeader(name: string, val: string) {
        this.headers[name] = val;
    }
    // Writable-ish surface not really used due to archiver mock
    write() { /* noop */ }
    end() { /* noop */ }
}

const makeMeta = (id: string, originalName: string, storedName = `${id}.webp`) => ({
    id,
    original: {
        name: originalName,
        mime: 'image/jpeg',
        sizeBytes: 123,
        width: 100,
        height: 100,
        pages: 1,
    },
    output: {
        storedName,
        mime: 'image/webp',
        sizeBytes: 456,
        width: 100,
        height: 100,
        colorSpace: 'srgb',
    },
    exifStripped: true,
    animated: false,
    uploadedAt: new Date().toISOString(),
});

describe('resolveFilesByIds', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    });

    it('returns found with all computed fields and missing for absent ids', async () => {
        const sid = 'SID';
        const ids = ['a1', 'a2', 'missing', 'a3'];

        // readMeta returns meta for a1, a2, a3; null for missing
        readMetaMock.mockImplementation(async (_sid: string, id: string) => {
            if (id === 'missing') return null;
            return makeMeta(id, `nice/photo_${id}.jpg`);
        });

        // pathForStored -> absolute-ish path under /tmp
        pathForStoredMock.mockImplementation((_sid: string, stored: string) =>
            path.join('/tmp/uploads', sid, stored)
        );

        // For extra safety, mark one existing file as missing on disk
        (fs.existsSync as unknown as MockInstance).mockImplementation((p: string) => !String(p).includes('a2.webp'));

        const res = await resolveFilesByIds(sid, ids);

        // Missing includes both "missing" (no meta) and "a2" (meta present but file missing)
        expect(res.missing.sort()).toEqual(['a2', 'missing'].sort());

        // Found preserves order of inputs that resolved to files
        expect(res.found.map(f => f.id)).toEqual(['a1', 'a3']);
        
        // Check computed fields for one entry
        const f0 = res.found[0];
        expect(f0.absPath).toBe(path.join('/tmp/uploads', sid, 'a1.webp'));
        expect(f0.downloadName).toBe('photo_a1.webp');
        expect(f0.archiveName).toBe('photo_a1.webp');
        expect(f0.contentType).toBe('image/webp');
        expect(f0.contentDisposition).toMatch(/^attachment; filename="photo_a1\.webp"; filename\*=/);
        expect(f0.meta.output.storedName).toBe('a1.webp');
    });

    it('uniquifies archiveName while preserving order when names collide', async () => {
        const sid = 'SID';
        // Two different ids but same original "image.jpg" -> same base => image.webp
        const ids = ['x1', 'x2', 'x3'];
        readMetaMock.mockResolvedValueOnce(makeMeta('x1', 'image.jpg'))
            .mockResolvedValueOnce(makeMeta('x2', 'image.jpg'))
            .mockResolvedValueOnce(makeMeta('x3', 'image.jpg'));
        pathForStoredMock.mockImplementation((_sid: string, stored: string) => `/abs/${stored}`);
        (fs.existsSync as unknown as MockInstance).mockReturnValue(true);

        const { found } = await resolveFilesByIds(sid, ids);
        expect(found.map(f => f.archiveName)).toEqual([
            'image.webp',        // 1st occurrence
            'image (2).webp',    // 2nd
            'image (3).webp',    // 3rd
        ]);
    });
});

describe('streamZip', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        // Recreate archive API per test (so call counts reset)
        vi.mocked(archiveApi.on).mockImplementation(() => {
            //
        });
        vi.mocked(archiveApi.pipe).mockImplementation(() => {
            //
        });
        vi.mocked(archiveApi.file).mockImplementation(() => {
            //
        });
        vi.mocked(archiveApi.finalize).mockResolvedValue(undefined);
        vi.mocked(archiveApi.destroy).mockImplementation(() => {
            //
        });
    });

    it('sets headers, pipes response, adds files in order, and finalizes', async () => {
        const res = new ResStub() as unknown as Response;

        const entries = [
            {
                id: 'a',
                absPath: '/abs/a.webp',
                downloadName: 'a.webp',
                archiveName: 'image.webp',
                contentType: 'image/webp',
                contentDisposition: 'attachment; filename="a.webp"',
                meta: makeMeta('a', 'a.jpg'),
            },
            {
                id: 'b',
                absPath: '/abs/b.webp',
                downloadName: 'b.webp',
                archiveName: 'image (2).webp',
                contentType: 'image/webp',
                contentDisposition: 'attachment; filename="b.webp"',
                meta: makeMeta('b', 'b.jpg'),
            },
        ];

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await streamZip(res, entries as any, 'My*Bundle'); // no .zip + unsafe chars

        // Headers
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect((res as any).headers['Content-Type']).toBe('application/zip');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cd = (res as any).headers['Content-Disposition'];
        // Sanitized and with .zip appended
        expect(cd).toContain('filename="My_Bundle.zip"');
        expect(cd).toContain("filename*=UTF-8''My_Bundle.zip");

        // archive API usage
        expect(archiveApi.pipe).toHaveBeenCalledWith(res);
        expect(archiveApi.file).toHaveBeenCalledTimes(2);
        expect(archiveApi.file).toHaveBeenNthCalledWith(1, '/abs/a.webp', { name: 'image.webp' });
        expect(archiveApi.file).toHaveBeenNthCalledWith(2, '/abs/b.webp', { name: 'image (2).webp' });
        expect(archiveApi.finalize).toHaveBeenCalledTimes(1);
    });

    it('destroys archive if client aborts', async () => {
        const res = new ResStub() as unknown as Response;

        // Capture "aborted" listener and invoke it
        let abortedHandler: (() => void) | undefined;
        vi.mocked(archiveApi.on).mockImplementation(() => {
            //
        });
        // Replace res.on to intercept 'aborted'

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const originalOn = (res as any).on.bind(res);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (res as any).on = (ev: string, cb: any) => {
            if (ev === 'aborted') abortedHandler = cb;
            return originalOn(ev, cb);
        };

        const entries = [
            { id: 'a', absPath: '/abs/a.webp', downloadName: 'a.webp', archiveName: 'a.webp', contentType: 'image/webp', contentDisposition: '', meta: makeMeta('a', 'a.jpg') },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ] as any;

        const p = streamZip(res, entries, 'bundle');

        // Simulate client abort mid-stream
        abortedHandler?.();

        await p;
        expect(archiveApi.destroy).toHaveBeenCalledTimes(1);
    });

    it('bubbles archiver errors', async () => {
        const res = new ResStub() as unknown as Response;

        // Wire error listener to immediately throw
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(archiveApi.on).mockImplementation((ev: string, cb: (err: any) => void) => {
            if (ev === 'error') {
                // Immediately invoke with a fake error once finalize is awaited
                vi.mocked(archiveApi.finalize).mockImplementation(async () => {
                    cb(new Error('zip-failed'));
                    return undefined;
                });
            }
        });

        const entries = [
            { id: 'a', absPath: '/abs/a.webp', downloadName: 'a.webp', archiveName: 'a.webp', contentType: 'image/webp', contentDisposition: '', meta: makeMeta('a', 'a.jpg') },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ] as any;

        await expect(streamZip(res, entries, 'bundle')).rejects.toThrow(/zip-failed/);
    });
});
