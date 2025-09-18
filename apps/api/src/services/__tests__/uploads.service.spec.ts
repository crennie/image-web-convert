import type { UploadedFile } from 'express-fileupload';
import { saveUploads } from '../uploads.service';
import { saveUploadFile } from '../storage.service';
import { MockInstance } from 'vitest';

// Hoisted fixtures
const h = vi.hoisted(() => ({
    sid: 'sid-abc',
    okResult: { id: 'file-ok', url: '/files/file-ok', metaUrl: '/files/file-ok/meta', meta: {}, clientId: 'c1' },
    err: new Error('boom'),
}));

// Mock the file saver that uploads.service delegates to
vi.mock('../storage.service', () => ({
    saveUploadFile: vi.fn(),
}));

const mkUpload = (name: string, tempFilePath = '/tmp/f'): UploadedFile =>
({
    name,
    mimetype: 'image/png',
    size: 123,
    mv: vi.fn(),
    encoding: '7bit',
    tempFilePath,
    truncated: false,
    md5: 'x',
} as unknown as UploadedFile);

describe('saveUploads', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('returns accepted for fulfilled saves and rejected for failures, preserving clientIds', async () => {
        const uploads = [mkUpload('a.png'), mkUpload('b.png'), mkUpload('c.png')];
        const clientIds = ['c1', 'c2', 'c3'];

        (saveUploadFile as unknown as MockInstance).mockImplementation((_sid: string, uf: UploadedFile, clientId?: string) => {
            if (uf.name === 'b.png') return Promise.reject(h.err);
            if (uf.name === 'c.png') return Promise.reject('bad format');
            return Promise.resolve({ ...h.okResult, clientId, id: 'file-' + uf.name });
        });

        const res = await saveUploads(h.sid, uploads, clientIds);

        // accepted
        expect(res.accepted.map(a => ({ id: a.id, clientId: a.clientId }))).toEqual([
            { id: 'file-a.png', clientId: 'c1' },
        ]);

        // rejected includes filename, message, and matching clientId
        expect(res.rejected).toHaveLength(2);
        expect(res.rejected[0]).toMatchObject({ fileName: 'b.png', error: 'boom', clientId: 'c2' });
        expect(res.rejected[1]).toMatchObject({ fileName: 'c.png', error: 'bad format', clientId: 'c3' });
    });

    it('uses "(unknown)" when an upload is missing a name', async () => {
        const unnamed = mkUpload(undefined as unknown as string);
        (saveUploadFile as unknown as MockInstance).mockRejectedValueOnce(new Error('x'));

        const res = await saveUploads(h.sid, [unnamed], ['cid']);
        expect(res.rejected[0].fileName).toBe('(unknown)');
    });

    it('handles missing clientIds array gracefully (defaults to undefined)', async () => {
        const uploads = [mkUpload('a.png')];
        (saveUploadFile as unknown as MockInstance).mockResolvedValueOnce(h.okResult);

        const res = await saveUploads(h.sid, uploads);
        expect(res.accepted[0].clientId).toBe(h.okResult.clientId);
    });
});
