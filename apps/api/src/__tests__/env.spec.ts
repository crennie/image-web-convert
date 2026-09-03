import { getSessionImageConfig, loadEnv } from '../env';

describe('API environment configuration', () => {
    it('loads backend-owned image limits', () => {
        expect(
            getSessionImageConfig({
                SESSION_TTL_MINUTES: '30',
                SESSION_MAX_FILES: '8',
                SESSION_PER_FILE_BYTES: '1234',
                SESSION_MAX_TOTAL_BYTES: '5678',
            }),
        ).toEqual({
            ttlMinutes: 30,
            maxFiles: 8,
            maxBytesPerFile: 1234,
            maxTotalBytes: 5678,
        });
    });

    it.each([
        ['SESSION_TTL_MINUTES', '0'],
        ['SESSION_MAX_FILES', '-1'],
        ['SESSION_PER_FILE_BYTES', '1.5'],
        ['SESSION_MAX_TOTAL_BYTES', 'not-a-number'],
    ])('rejects invalid %s', (key, value) => {
        expect(() => loadEnv({ [key]: value })).toThrow('Invalid environment');
    });
});
