import path from 'node:path';

vi.mock('@image-web-convert/node-shared', () => ({
    normalizeAbsolutePath: (value: string) => value,
}));

const originalUploadDir = process.env.UPLOAD_DIR;

beforeEach(() => {
    vi.resetModules();
});

afterEach(() => {
    if (originalUploadDir === undefined) {
        delete process.env.UPLOAD_DIR;
    } else {
        process.env.UPLOAD_DIR = originalUploadDir;
    }
});

describe('storage path primitives', () => {
    it('uses the configured upload root', async () => {
        const uploadDir = path.resolve('/tmp', 'configured-upload-root');
        process.env.UPLOAD_DIR = uploadDir;

        const paths = await import('../storage.paths');

        expect(paths.UPLOAD_DIR).toBe(uploadDir);
    });

    it('defaults to the workspace data/uploads directory', async () => {
        delete process.env.UPLOAD_DIR;

        const paths = await import('../storage.paths');

        expect(paths.UPLOAD_DIR).toBe(
            path.resolve(process.cwd(), 'data', 'uploads'),
        );
    });

    it('builds all session-owned paths beneath the upload root', async () => {
        const uploadDir = path.resolve('/tmp', 'image-web-convert-path-tests');
        process.env.UPLOAD_DIR = uploadDir;
        const paths = await import('../storage.paths');

        expect(paths.sessionDir('session-id')).toBe(
            path.join(uploadDir, 'session-id'),
        );
        expect(paths.sessionInfoPath('session-id')).toBe(
            path.join(uploadDir, 'session-id', 'session.info.json'),
        );
        expect(paths.sessionMetaPath('session-id', 'file-id')).toBe(
            path.join(uploadDir, 'session-id', 'file-id.json'),
        );
        expect(paths.pathForStored('session-id', 'file-id.webp')).toBe(
            path.join(uploadDir, 'session-id', 'file-id.webp'),
        );
    });
});
