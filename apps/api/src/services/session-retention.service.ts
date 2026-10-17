import fs from 'node:fs/promises';
import path from 'node:path';
import { ConversionIdSchema } from '@image-web-convert/schemas';
import { ConversionStorageError } from './conversion-storage.service';
import { sessionInfoPath } from './storage.paths';

function missing(error: unknown): boolean {
    return (
        error !== null &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
    );
}

export class InvalidSessionRecordError extends Error {
    constructor(cause: unknown) {
        super('Invalid persisted session record', { cause });
        this.name = 'InvalidSessionRecordError';
    }
}

/** Only directories with a matching, valid session record are owned by retention.
 * A conversion marker delegates deletion to conversion storage's claim checks. */
export function createSessionRetention(root: string, now: () => Date) {
    async function ensureRoot(): Promise<void> {
        await fs.mkdir(root, { recursive: true });
        const stat = await fs.lstat(root);
        if (!stat.isDirectory())
            throw new ConversionStorageError('Upload root is not a directory');
    }

    async function candidates(): Promise<string[]> {
        let entries;
        try {
            const stat = await fs.lstat(root);
            if (!stat.isDirectory())
                throw new Error('Upload root is not a directory');
            entries = await fs.readdir(root, { withFileTypes: true });
        } catch (error) {
            throw new ConversionStorageError(
                'Unable to scan session root',
                error,
            );
        }
        return entries
            .filter(
                (entry) =>
                    entry.isDirectory() &&
                    ConversionIdSchema.safeParse(entry.name).success,
            )
            .map((entry) => entry.name)
            .sort();
    }

    async function expired(sid: string): Promise<boolean> {
        ConversionIdSchema.parse(sid);
        const directory = path.join(root, sid);
        const infoPath = sessionInfoPath(sid, root);
        try {
            const directoryStat = await fs.lstat(directory);
            if (!directoryStat.isDirectory()) return false;
            let stat;
            try {
                stat = await fs.lstat(infoPath);
            } catch (error) {
                if (missing(error)) {
                    // Give session creation time to finish, then surface a
                    // recordless directory for operator repair.
                    if (now().getTime() - directoryStat.mtimeMs >= 300_000)
                        throw new InvalidSessionRecordError(
                            'Missing session record',
                        );
                    return false;
                }
                throw error;
            }
            if (!stat.isFile())
                throw new InvalidSessionRecordError('Not a file');
            const raw = await fs.readFile(infoPath, 'utf8');
            let info: unknown;
            try {
                info = JSON.parse(raw);
            } catch (error) {
                throw new InvalidSessionRecordError(error);
            }
            if (
                !info ||
                typeof info !== 'object' ||
                !('id' in info) ||
                info.id !== sid ||
                !('expiresAt' in info) ||
                typeof info.expiresAt !== 'string' ||
                !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(
                    info.expiresAt,
                ) ||
                !Number.isFinite(Date.parse(info.expiresAt)) ||
                !('createdAt' in info) ||
                typeof info.createdAt !== 'string' ||
                !Number.isFinite(Date.parse(info.createdAt)) ||
                !('tokenHash' in info) ||
                typeof info.tokenHash !== 'string' ||
                !info.tokenHash
            )
                throw new InvalidSessionRecordError('Invalid session fields');
            return Date.parse(info.expiresAt) <= now().getTime();
        } catch (error) {
            if (missing(error)) return false; // Creation may be between mkdir and record write.
            if (error instanceof InvalidSessionRecordError) throw error;
            throw new ConversionStorageError(
                'Unable to read session record',
                error,
            );
        }
    }

    async function removeExpired(sid: string): Promise<boolean> {
        if (!(await expired(sid))) return false;
        const directory = path.join(root, sid);
        try {
            // Never bypass conversion storage's serialized deletion and claims.
            await fs.lstat(path.join(directory, 'conversion.info.json'));
            return false;
        } catch (error) {
            if (!missing(error)) throw error;
        }
        await fs.rm(directory, { recursive: true });
        return true;
    }

    return { ensureRoot, candidates, expired, removeExpired };
}
