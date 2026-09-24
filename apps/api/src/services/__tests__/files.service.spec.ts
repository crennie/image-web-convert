import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import type { ResolvedDownload } from '../files.service';
import {
    archiveDownloadHeaders,
    ArchiveClientAbortError,
    resolveFilesByIds,
    writeZip,
} from '../files.service';
import { MockInstance } from 'vitest';

// ---- Mocks ----
// 1) Mock normalizeAbsolutePath to identity so we can assert paths exactly
vi.mock('@image-web-convert/node-shared', async (importOriginal) => {
    const actual =
        await importOriginal<typeof import('@image-web-convert/node-shared')>();
    return {
        ...actual,
        normalizeAbsolutePath: (p: string) => p,
    };
});

// 2) Mock storage metadata and path helpers
const readMetaMock = vi.fn();
const pathForStoredMock = vi.fn();
vi.mock('../storage.service', () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readMeta: (...args: any[]) => readMetaMock(...args),
}));
vi.mock('../storage.paths', () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pathForStored: (...args: any[]) => pathForStoredMock(...args),
}));

// 3) Mock archiver (default export is a function that returns an archive instance)
const archiveApi = Object.assign(new EventEmitter(), {
    pipe: vi.fn(),
    unpipe: vi.fn(),
    abort: vi.fn(),
    file: vi.fn(),
    finalize: vi.fn<() => Promise<void>>(),
    destroy: vi.fn(),
});
vi.mock('archiver', () => ({
    default: vi.fn(() => archiveApi),
}));

const makeMeta = (
    id: string,
    originalName: string,
    storedName = `${id}.webp`,
) => ({
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
            path.join('/tmp/uploads', sid, stored),
        );

        // For extra safety, mark one existing file as missing on disk
        (fs.existsSync as unknown as MockInstance).mockImplementation(
            (p: string) => !String(p).includes('a2.webp'),
        );

        const res = await resolveFilesByIds(sid, ids);

        // Missing includes both "missing" (no meta) and "a2" (meta present but file missing)
        expect(res.missing.sort()).toEqual(['a2', 'missing'].sort());

        // Found preserves order of inputs that resolved to files
        expect(res.found.map((f) => f.id)).toEqual(['a1', 'a3']);

        // Check computed fields for one entry
        const f0 = res.found[0];
        expect(f0.absPath).toBe(path.join('/tmp/uploads', sid, 'a1.webp'));
        expect(f0.downloadName).toBe('photo_a1.webp');
        expect(f0.archiveName).toBe('photo_a1.webp');
        expect(f0.contentType).toBe('image/webp');
        expect(f0.contentDisposition).toMatch(
            /^attachment; filename="photo_a1\.webp"; filename\*=/,
        );
        expect(f0.meta.output.storedName).toBe('a1.webp');
    });

    it('uniquifies archiveName while preserving order when names collide', async () => {
        const sid = 'SID';
        // Two different ids but same original "image.jpg" -> same base => image.webp
        const ids = ['x1', 'x2', 'x3'];
        readMetaMock
            .mockResolvedValueOnce(makeMeta('x1', 'image.jpg'))
            .mockResolvedValueOnce(makeMeta('x2', 'image.jpg'))
            .mockResolvedValueOnce(makeMeta('x3', 'image.jpg'));
        pathForStoredMock.mockImplementation(
            (_sid: string, stored: string) => `/abs/${stored}`,
        );
        (fs.existsSync as unknown as MockInstance).mockReturnValue(true);

        const { found } = await resolveFilesByIds(sid, ids);
        expect(found.map((f) => f.archiveName)).toEqual([
            'image.webp', // 1st occurrence
            'image (2).webp', // 2nd
            'image (3).webp', // 3rd
        ]);
    });
    it('reserves existing suffix names while preserving input order', async () => {
        const names = ['a.jpg', 'a.jpg', 'a (2).jpg', 'a.jpg', 'a (2).jpg'];
        readMetaMock.mockImplementation(async (_sid: string, id: string) =>
            makeMeta(id, names[Number(id)]),
        );
        pathForStoredMock.mockImplementation(
            (_sid: string, stored: string) => `/abs/${stored}`,
        );
        const { found } = await resolveFilesByIds('SID', [
            '0',
            '1',
            '2',
            '3',
            '4',
        ]);
        expect(found.map((file) => file.archiveName)).toEqual([
            'a.webp',
            'a (3).webp',
            'a (2).webp',
            'a (4).webp',
            'a (2) (2).webp',
        ]);
        expect(found.map((file) => file.id)).toEqual(['0', '1', '2', '3', '4']);
    });
});

describe('writeZip', () => {
    const entry = (): ResolvedDownload => ({
        id: 'a',
        absPath: '/abs/a.webp',
        downloadName: 'a.webp',
        archiveName: 'image.webp',
        contentType: 'image/webp',
        contentDisposition: '',
        meta: makeMeta('a', 'a.jpg') as ResolvedDownload['meta'],
    });
    const output = () =>
        new Writable({
            write(_chunk, _encoding, done) {
                done();
            },
        });
    const deferred = () => {
        let resolve!: () => void;
        let reject!: (error: Error) => void;
        const promise = new Promise<void>((yes, no) => {
            resolve = yes;
            reject = no;
        });
        return { promise, resolve, reject };
    };
    const clean = (stream: Writable) => {
        for (const event of ['finish', 'close', 'error'])
            expect(stream.listenerCount(event)).toBe(0);
        for (const event of ['error', 'warning'])
            expect(archiveApi.listenerCount(event)).toBe(0);
    };
    beforeEach(() => {
        vi.resetAllMocks();
        archiveApi.removeAllListeners();
        archiveApi.finalize.mockResolvedValue(undefined);
    });

    it.each(['output', 'finalize'])(
        'waits for both success boundaries when %s completes first',
        async (first) => {
            const stream = output();
            const finalization = deferred();
            archiveApi.finalize.mockReturnValue(finalization.promise);
            const entries = [
                entry(),
                {
                    ...entry(),
                    absPath: '/abs/b.webp',
                    archiveName: 'image (2).webp',
                },
            ];
            const done = vi.fn();
            const pending = writeZip(stream, entries).then(done);
            if (first === 'output') {
                stream.emit('finish');
                stream.emit('close');
            } else finalization.resolve();
            await Promise.resolve();
            expect(done).not.toHaveBeenCalled();
            if (first === 'output') finalization.resolve();
            else stream.emit('finish');
            await pending;
            expect(archiveApi.pipe).toHaveBeenCalledWith(stream);
            expect(archiveApi.file.mock.calls).toEqual([
                ['/abs/a.webp', { name: 'image.webp' }],
                ['/abs/b.webp', { name: 'image (2).webp' }],
            ]);
            expect(archiveApi.destroy).not.toHaveBeenCalled();
            clean(stream);
        },
    );

    it.each(['archive', 'warning', 'output', 'abort'])(
        'rejects promptly on %s while finalization is pending',
        async (source) => {
            const stream = output();
            const finalization = deferred();
            archiveApi.finalize.mockReturnValue(finalization.promise);
            const pending = writeZip(stream, [entry()]);
            const error = new Error('stream failed');
            const assertion =
                source === 'abort'
                    ? expect(pending).rejects.toBeInstanceOf(
                          ArchiveClientAbortError,
                      )
                    : expect(pending).rejects.toBe(error);
            // Emit asynchronously: no throwing event callback can satisfy this test.
            await Promise.resolve();
            if (source === 'abort') stream.emit('close');
            else if (source === 'output') stream.emit('error', error);
            else
                archiveApi.emit(
                    source === 'archive' ? 'error' : 'warning',
                    error,
                );
            await assertion;
            expect(archiveApi.unpipe).toHaveBeenCalledWith(stream);
            expect(archiveApi.abort).toHaveBeenCalledTimes(1);
            expect(archiveApi.destroy).toHaveBeenCalledTimes(1);
            expect(stream.destroyed).toBe(false); // HTTP caller still owns its response.
            clean(stream);
            finalization.reject(new Error('late finalize rejection'));
            await Promise.resolve();
        },
    );

    it('rejects finalization failure and cleans listeners without finishing output', async () => {
        const stream = output();
        archiveApi.finalize.mockRejectedValue(new Error('finalize failed'));
        await expect(writeZip(stream, [entry()])).rejects.toThrow(
            'finalize failed',
        );
        expect(archiveApi.destroy).toHaveBeenCalledTimes(1);
        clean(stream);
    });

    it('cleans up when adding an entry throws', async () => {
        const stream = output();
        archiveApi.file.mockImplementation(() => {
            throw new Error('entry failed');
        });
        await expect(writeZip(stream, [entry()])).rejects.toThrow(
            'entry failed',
        );
        expect(archiveApi.finalize).not.toHaveBeenCalled();
        clean(stream);
    });

    it('does not start archiving for an already destroyed output', async () => {
        const stream = output();
        stream.destroy();
        await expect(writeZip(stream, [entry()])).rejects.toBeInstanceOf(
            ArchiveClientAbortError,
        );
        expect(archiveApi.pipe).not.toHaveBeenCalled();
        expect(archiveApi.finalize).not.toHaveBeenCalled();
        clean(stream);
    });

    it('builds sanitized Unicode HTTP headers separately', () => {
        const headers = archiveDownloadHeaders('My*Bundle é');
        expect(headers.contentType).toBe('application/zip');
        expect(headers.contentDisposition).toContain(
            'filename="My_Bundle é.zip"',
        );
        expect(headers.contentDisposition).toContain(
            "filename*=UTF-8''My_Bundle%20%C3%A9.zip",
        );
    });
});
