import { ApiUploadAccepted, ApiUploadMeta } from '@image-web-convert/schemas';
import {
    processUploadBatch,
    UploadClaimConflictError,
    UploadInput,
} from '../uploads.service';
import { removeStoredUpload, saveUploadFile } from '../storage.service';
import { writeSessionInfo } from '../sessions.service';

vi.mock('../storage.service', () => ({
    saveUploadFile: vi.fn(),
    removeStoredUpload: vi.fn(),
}));
vi.mock('../sessions.service', () => ({ writeSessionInfo: vi.fn() }));

const info = () => ({
    id: 'sid',
    createdAt: new Date(0).toISOString(),
    expiresAt: new Date(100_000).toISOString(),
    sealedAt: null,
    counts: { files: 2, totalBytes: 50 },
    tokenHash: 'hash',
});
const input = (name: string, clientId?: string): UploadInput => ({
    originalName: name,
    tempInputPath: `/tmp/${name}`,
    originalBytes: 10,
    clientId,
});
const accepted = (id: string, bytes = 10): ApiUploadAccepted => ({
    id,
    url: `/files/${id}`,
    metaUrl: `/files/${id}/meta`,
    meta: {
        original: { sizeBytes: bytes },
        output: { storedName: `${id}.webp` },
    } as ApiUploadMeta,
});

describe('processUploadBatch', () => {
    beforeEach(() => vi.resetAllMocks());

    it('preserves partial success, updates accepted counts, and seals once', async () => {
        vi.mocked(saveUploadFile)
            .mockResolvedValueOnce(accepted('a', 12))
            .mockRejectedValueOnce(new Error('bad image'));

        const result = await processUploadBatch(
            'sid',
            'image/webp',
            [input('a.png', 'a'), input('b.png', 'b')],
            info(),
        );

        expect(result.accepted).toHaveLength(1);
        expect(result.rejected).toEqual([
            { fileName: 'b.png', error: 'bad image', clientId: 'b' },
        ]);
        expect(writeSessionInfo).toHaveBeenCalledWith(
            'sid',
            expect.objectContaining({
                sealedAt: expect.any(String),
                counts: { files: 3, totalBytes: 62 },
            }),
        );
    });

    it('seals an all-rejected batch without changing counts', async () => {
        vi.mocked(saveUploadFile).mockRejectedValue(new Error('unsupported'));
        const result = await processUploadBatch(
            'all-fail',
            'image/webp',
            [input('bad.png')],
            info(),
        );
        expect(result.accepted).toEqual([]);
        expect(result.rejected).toHaveLength(1);
        expect(writeSessionInfo).toHaveBeenCalledWith(
            'all-fail',
            expect.objectContaining({ counts: { files: 2, totalBytes: 50 } }),
        );
    });

    it('removes accepted outputs and releases the claim when persistence fails', async () => {
        const saved = accepted('saved');
        vi.mocked(saveUploadFile).mockResolvedValue(saved);
        vi.mocked(writeSessionInfo).mockRejectedValueOnce(new Error('disk full'));

        await expect(
            processUploadBatch('retry', 'image/webp', [input('a.png')], info()),
        ).rejects.toThrow('disk full');
        expect(removeStoredUpload).toHaveBeenCalledWith('retry', saved);

        vi.mocked(writeSessionInfo).mockResolvedValueOnce(undefined);
        await expect(
            processUploadBatch('retry', 'image/webp', [input('a.png')], info()),
        ).resolves.toBeDefined();
    });

    it('rejects a concurrent same-session batch before conversion and releases after success', async () => {
        let finish!: (value: ApiUploadAccepted) => void;
        vi.mocked(saveUploadFile).mockImplementationOnce(
            () => new Promise((resolve) => (finish = resolve)),
        );
        const first = processUploadBatch(
            'claimed',
            'image/webp',
            [input('first.png')],
            info(),
        );

        await expect(
            processUploadBatch(
                'claimed',
                'image/webp',
                [input('second.png')],
                info(),
            ),
        ).rejects.toBeInstanceOf(UploadClaimConflictError);
        expect(saveUploadFile).toHaveBeenCalledTimes(1);
        finish(accepted('first'));
        await first;

        vi.mocked(saveUploadFile).mockResolvedValueOnce(accepted('next'));
        await expect(
            processUploadBatch('claimed', 'image/webp', [input('next.png')], info()),
        ).resolves.toBeDefined();
    });

    it('allows different sessions to proceed independently', async () => {
        let finishFirst!: (value: ApiUploadAccepted) => void;
        vi.mocked(saveUploadFile)
            .mockImplementationOnce(() => new Promise((resolve) => (finishFirst = resolve)))
            .mockResolvedValueOnce(accepted('second'));
        const first = processUploadBatch('one', 'image/webp', [input('a')], info());
        await expect(
            processUploadBatch('two', 'image/webp', [input('b')], info()),
        ).resolves.toBeDefined();
        finishFirst(accepted('first'));
        await first;
    });

    it('releases the claim after conversion orchestration throws', async () => {
        vi.mocked(saveUploadFile).mockImplementationOnce(() => {
            throw new Error('unexpected');
        });
        await expect(
            processUploadBatch('throwing', 'image/webp', [input('a')], info()),
        ).rejects.toThrow('unexpected');
        vi.mocked(saveUploadFile).mockResolvedValueOnce(accepted('retry'));
        await expect(
            processUploadBatch('throwing', 'image/webp', [input('a')], info()),
        ).resolves.toBeDefined();
    });
});
