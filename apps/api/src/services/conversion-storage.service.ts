import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { secureId } from '@image-web-convert/node-shared';
import {
    ConversionIdSchema,
    MIME_TO_EXT,
    UploadMetaSchema,
    type ConversionFileError,
    type ConversionOutput,
} from '@image-web-convert/schemas';
import { conversionStoragePaths, UPLOAD_DIR } from './storage.paths';
import {
    acceptConversionUpload,
    finishConversionFile,
    requestConversionStop,
    failUploadedConversionFile,
    isConversionTerminal,
    ConversionTransitionError,
    type ConversionOperation,
} from './conversions.service';
import {
    ConversionCommitSchema,
    parseStoredConversion,
    type ConversionCommit,
    type Fingerprint,
    type StoredConversion,
} from './conversion-storage.schema';
import type { ProcessOutput } from './image.service';

// Shared across store instances in this process, never a distributed lock.
const mutations = new Map<string, Promise<void>>();
const uploadClaims = new Set<string>();
const outputClaims = new Set<string>();

async function serialized<T>(
    key: string,
    action: () => Promise<T>,
): Promise<T> {
    const previous = mutations.get(key) ?? Promise.resolve();
    let release!: () => void;
    const tail = new Promise<void>((resolve) => {
        release = resolve;
    });
    mutations.set(key, tail);
    await previous;
    try {
        return await action();
    } finally {
        release();
        if (mutations.get(key) === tail) mutations.delete(key);
    }
}

export class ConversionStorageError extends Error {
    readonly type = 'storage_error';
    constructor(message: string, cause?: unknown) {
        super(message, { cause });
        this.name = 'ConversionStorageError';
    }
}

export class ConversionStorageIoError extends ConversionStorageError {
    constructor(message: string, cause?: unknown) {
        super(message, cause);
        this.name = 'ConversionStorageIoError';
    }
}

// Corrupt or missing artifacts belong to one session. Filesystem and resource
// failures may affect every session. Transport errors from disconnected clients
// must not stop the process.
const storageErrnoCodes = new Set([
    'EACCES',
    'EPERM',
    'ENOSPC',
    'EDQUOT',
    'EROFS',
    'EIO',
    'EMFILE',
    'ENFILE',
    'EBUSY',
    'ESTALE',
    'ENODEV',
    'ENXIO',
    'EFBIG',
    'ENOMEM',
    'EAGAIN',
    'EINTR',
    'EMLINK',
    'ENOTEMPTY',
    'EXDEV',
    'EEXIST',
    'ENOSYS',
    'ENOTSUP',
    'EOPNOTSUPP',
]);
export function isStorageIoFailure(error: unknown): boolean {
    let current = error;
    const seen = new Set<unknown>();
    while (current && typeof current === 'object' && !seen.has(current)) {
        seen.add(current);
        if (current instanceof ConversionStorageIoError) return true;
        if (
            'code' in current &&
            typeof current.code === 'string' &&
            storageErrnoCodes.has(current.code)
        )
            return true;
        current = 'cause' in current ? current.cause : undefined;
    }
    return false;
}

function missing(error: unknown): boolean {
    return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
    );
}

function invalidStoragePath(error: unknown): boolean {
    return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        ['ENOTDIR', 'EISDIR', 'ELOOP'].includes(String(error.code))
    );
}

async function readCommitArtifact<T>(action: () => Promise<T>): Promise<T> {
    try {
        return await action();
    } catch (error) {
        if (error instanceof ConversionStorageError) throw error;
        if (missing(error) || invalidStoragePath(error))
            throw new ConversionStorageError(
                'Invalid file commit evidence',
                error,
            );
        throw new ConversionStorageIoError(
            'Unable to read file commit evidence',
            error,
        );
    }
}

async function recoverFilesystem<T>(
    action: () => Promise<T>,
    message: string,
): Promise<T> {
    try {
        return await action();
    } catch (error) {
        if (error instanceof ConversionStorageError) throw error;
        if (missing(error)) throw error;
        if (invalidStoragePath(error))
            throw new ConversionStorageError('Invalid recovery path', error);
        throw new ConversionStorageIoError(message, error);
    }
}

async function publishFilesystem<T>(
    action: () => Promise<T>,
    message: string,
): Promise<T> {
    try {
        return await action();
    } catch (error) {
        if (error instanceof ConversionStorageError) throw error;
        if (invalidStoragePath(error))
            throw new ConversionStorageError(
                'Invalid output artifact path',
                error,
            );
        throw new ConversionStorageIoError(message, error);
    }
}

async function acceptFilesystem<T>(
    action: () => Promise<T>,
    message: string,
): Promise<T> {
    try {
        return await action();
    } catch (error) {
        if (error instanceof ConversionStorageError) throw error;
        if (invalidStoragePath(error))
            throw new ConversionStorageError(
                'Invalid upload staging path',
                error,
            );
        throw new ConversionStorageIoError(message, error);
    }
}

async function removeIfPresent(target: string): Promise<void> {
    try {
        await fs.unlink(target);
    } catch (error) {
        if (!missing(error)) throw error;
    }
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
    try {
        await fs.mkdir(directory, { recursive: true, mode: 0o700 });
        const stat = await fs.lstat(directory);
        if (!stat.isDirectory())
            throw new ConversionStorageError('Invalid storage directory');
        await fs.chmod(directory, 0o700);
    } catch (error) {
        if (error instanceof ConversionStorageError) throw error;
        if (invalidStoragePath(error))
            throw new ConversionStorageError('Invalid storage path', error);
        throw new ConversionStorageIoError(
            'Unable to prepare storage directory',
            error,
        );
    }
}

async function ensurePrivateStoredFiles(directory: string): Promise<void> {
    try {
        for (const entry of await fs.readdir(directory, {
            withFileTypes: true,
        })) {
            if (!entry.isFile()) continue;
            const target = path.join(directory, entry.name);
            // Skip symlinks present at inspection; concurrent replacement is outside
            // this single-process storage contract.
            if ((await fs.lstat(target)).isFile())
                await fs.chmod(target, 0o600);
        }
    } catch (error) {
        if (error instanceof ConversionStorageError) throw error;
        if (missing(error) || invalidStoragePath(error))
            throw new ConversionStorageError('Invalid stored file path', error);
        throw new ConversionStorageIoError(
            'Unable to inspect stored files',
            error,
        );
    }
}

async function fingerprint(target: string): Promise<Fingerprint> {
    const stat = await fs.lstat(target);
    if (!stat.isFile())
        throw new ConversionStorageError('Expected a regular stored file');
    const hash = createHash('sha256');
    let bytes = 0;
    for await (const chunk of createReadStream(target)) {
        bytes += chunk.length;
        hash.update(chunk);
    }
    return { bytes, sha256: hash.digest('hex') };
}

async function syncFile(target: string): Promise<void> {
    const handle = await fs.open(target, 'r');
    try {
        await handle.sync();
    } finally {
        await handle.close();
    }
}

async function syncDirectory(directory: string): Promise<void> {
    const handle = await fs.open(directory, 'r');
    try {
        await handle.sync();
    } finally {
        await handle.close();
    }
}

async function writeExact(
    target: string,
    content: Buffer,
): Promise<Fingerprint> {
    await fs.writeFile(target, content, { flag: 'wx', mode: 0o600 });
    await syncFile(target);
    const actual = await fingerprint(target);
    if (
        actual.bytes !== content.length ||
        actual.sha256 !== createHash('sha256').update(content).digest('hex')
    )
        throw new ConversionStorageError('Incomplete stored file write');
    return actual;
}

function storageFailure(error: unknown, message: string): never {
    if (
        error instanceof ConversionStorageError ||
        error instanceof ConversionTransitionError
    )
        throw error;
    throw new ConversionStorageError(message, error);
}

/** Temp and target share a filesystem. Failures after rename have an ambiguous
 * acknowledgement: callers must reread/recover, never roll back other files. */
async function atomicJson(target: string, value: unknown): Promise<void> {
    const temporary = `${target}.${secureId()}.tmp`;
    try {
        await writeExact(
            temporary,
            Buffer.from(JSON.stringify(value, null, 2)),
        );
        await fs.rename(temporary, target);
        await syncDirectory(path.dirname(target));
    } finally {
        await removeIfPresent(temporary);
    }
}

function immutableIntent(operation: ConversionOperation) {
    return {
        id: operation.id,
        sessionId: operation.sessionId,
        requestId: operation.requestId,
        schemaVersion: operation.schemaVersion,
        createdAt: operation.createdAt,
        expiresAt: operation.expiresAt,
        options: operation.options,
        limits: operation.limits,
        processingOptions: operation.processingOptions,
        files: operation.files.map(({ id, clientId, name, declaredBytes }) => ({
            id,
            clientId,
            name,
            declaredBytes,
        })),
    };
}

export function createConversionStorage(
    options: { root?: string; now?: () => Date } = {},
) {
    const root = path.resolve(options.root ?? UPLOAD_DIR);
    const now = options.now ?? (() => new Date());
    const paths = (sid: string) => conversionStoragePaths(sid, root);

    async function read(
        sid: string,
        operationId?: string,
    ): Promise<StoredConversion> {
        const location = paths(sid);
        if (operationId) ConversionIdSchema.parse(operationId);
        let raw: string;
        try {
            const directory = await fs.lstat(location.directory);
            if (!directory.isDirectory())
                throw new ConversionStorageError('Invalid session directory');
            const info = await fs.lstat(location.info);
            if (!info.isFile())
                throw new ConversionStorageError('Invalid operation record');
            raw = await fs.readFile(location.info, 'utf8');
        } catch (error) {
            if (missing(error))
                throw new ConversionTransitionError(
                    'operation_not_found',
                    'Operation not found',
                );
            if (error instanceof ConversionStorageError) throw error;
            if (invalidStoragePath(error))
                throw new ConversionStorageError(
                    'Invalid operation path',
                    error,
                );
            throw new ConversionStorageIoError(
                'Unable to read operation',
                error,
            );
        }
        let record: StoredConversion;
        try {
            record = parseStoredConversion(JSON.parse(raw));
            if (record.operation.sessionId !== sid)
                throw new Error('Session association mismatch');
        } catch (error) {
            throw new ConversionStorageError(
                'Invalid persisted operation',
                error,
            );
        }
        if (operationId && record.operation.id !== operationId) {
            throw new ConversionTransitionError(
                'operation_not_found',
                'Operation not found in this session',
            );
        }
        return record;
    }

    async function write(record: StoredConversion): Promise<StoredConversion> {
        const validated = parseStoredConversion(record);
        try {
            await atomicJson(
                paths(validated.operation.sessionId).info,
                validated,
            );
        } catch (error) {
            throw new ConversionStorageError(
                'Unable to persist operation; reread or recover before continuing',
                error,
            );
        }
        return validated;
    }

    async function pendingCommit(record: StoredConversion): Promise<void> {
        for (const file of record.operation.files) {
            if (file.status !== 'processing') continue;
            try {
                await fs.stat(
                    paths(record.operation.sessionId).receipt(file.id),
                );
            } catch (error) {
                if (missing(error)) continue;
                if (invalidStoragePath(error))
                    throw new ConversionStorageError(
                        'Invalid pending commit receipt path',
                        error,
                    );
                throw new ConversionStorageIoError(
                    'Unable to inspect pending commit receipt',
                    error,
                );
            }
            throw new ConversionStorageError(
                'An interrupted file commit requires recovery before further mutations',
            );
        }
    }

    // Read under the publication lock before checking receipts. Otherwise a
    // normal commit between receipt and snapshot writes looks like a crash.
    async function mutationBase(
        sid: string,
        operationId: string,
    ): Promise<StoredConversion> {
        return serialized(paths(sid).info, async () => {
            const record = await read(sid, operationId);
            await pendingCommit(record);
            return record;
        });
    }

    async function create(
        operation: ConversionOperation,
    ): Promise<StoredConversion> {
        const location = paths(operation.sessionId);
        return serialized(location.info, async () => {
            const record = parseStoredConversion({ operation, inputs: {} });
            if (
                operation.revision !== 0 ||
                operation.status !== 'awaiting_uploads'
            ) {
                throw new ConversionTransitionError(
                    'conversion_conflict',
                    'Only a new operation may be created',
                );
            }
            let existing = false;
            try {
                await fs.stat(location.info);
                existing = true;
            } catch (error) {
                if (!missing(error)) {
                    if (invalidStoragePath(error))
                        throw new ConversionStorageError(
                            'Invalid operation creation path',
                            error,
                        );
                    throw new ConversionStorageIoError(
                        'Unable to inspect existing operation',
                        error,
                    );
                }
            }
            if (existing)
                throw new ConversionTransitionError(
                    'conversion_conflict',
                    'Session already owns an operation',
                );
            await ensurePrivateDirectory(root);
            await ensurePrivateDirectory(location.directory);
            for (const directory of [
                location.inputs,
                location.staging,
                location.receipts,
            ]) {
                await ensurePrivateDirectory(directory);
            }
            try {
                await syncDirectory(location.directory);
            } catch (error) {
                throw new ConversionStorageIoError(
                    'Unable to sync operation directory',
                    error,
                );
            }
            return write(record);
        });
    }

    /** Persist short application transitions (start/reject/stop), never accept
     * bytes or publish outputs through this generic mutation interface. */
    async function update(
        sid: string,
        operationId: string,
        transition: (operation: ConversionOperation) => ConversionOperation,
    ): Promise<StoredConversion> {
        return serialized(paths(sid).info, async () => {
            const record = await read(sid, operationId);
            await pendingCommit(record);
            const next = transition(structuredClone(record.operation));
            if (
                !isDeepStrictEqual(
                    immutableIntent(next),
                    immutableIntent(record.operation),
                )
            ) {
                throw new ConversionTransitionError(
                    'conversion_conflict',
                    'Operation intent is immutable',
                );
            }
            for (const file of record.operation.files) {
                const changed = next.files.find(
                    (candidate) => candidate.id === file.id,
                );
                if (
                    (['completed', 'failed', 'cancelled'].includes(
                        file.status,
                    ) &&
                        !isDeepStrictEqual(file, changed)) ||
                    (file.status !== 'completed' &&
                        changed?.status === 'completed')
                ) {
                    throw new ConversionTransitionError(
                        'conversion_conflict',
                        'File outcomes require an individual commit and cannot be rewritten',
                    );
                }
            }
            if (isDeepStrictEqual(next, record.operation)) return record;
            if (
                next.revision <= record.operation.revision ||
                next.updatedAt < record.operation.updatedAt
            ) {
                throw new ConversionTransitionError(
                    'conversion_conflict',
                    'Operation revision must advance',
                );
            }
            return write({ ...record, operation: next });
        });
    }

    /** Ownership of the completed middleware temp file transfers to this call.
     * Always copy into destination staging: this works across filesystems and
     * leaves accepted input untouched by later request cleanup. */
    async function acceptUpload(
        sid: string,
        operationId: string,
        fileId: string,
        tempPath: string,
        assertRequestActive: () => void = () => undefined,
    ): Promise<StoredConversion> {
        const location = paths(sid);
        const key = location.input(fileId);
        const relativeSource = path.relative(
            location.directory,
            path.resolve(tempPath),
        );
        if (
            !relativeSource.startsWith(`..${path.sep}`) &&
            !path.isAbsolute(relativeSource)
        ) {
            throw new ConversionStorageError(
                'Request staging must be outside operation-owned storage',
            );
        }
        if (uploadClaims.has(key))
            throw new ConversionTransitionError(
                'upload_in_progress',
                'Upload already in progress for this slot',
            );
        uploadClaims.add(key);
        const stage = location.staged(secureId());
        let outcome: PromiseSettledResult<StoredConversion>;
        try {
            const result = await (async () => {
                const initial = await mutationBase(sid, operationId);
                // Validate association/lifecycle before copying a potentially large file.
                const slot = initial.operation.files.find(
                    (file) => file.id === fileId,
                );
                if (!slot)
                    throw new ConversionTransitionError(
                        'file_not_found',
                        'File does not belong to operation',
                    );
                acceptConversionUpload(
                    initial.operation,
                    fileId,
                    slot.declaredBytes,
                    now(),
                );
                if ('uploadedAt' in slot && slot.uploadedAt) return initial;
                const stat = await acceptFilesystem(
                    () => fs.lstat(tempPath),
                    'Unable to inspect upload source',
                );
                if (!stat.isFile())
                    throw new ConversionStorageError(
                        'Upload source must be a regular file',
                    );
                acceptConversionUpload(
                    initial.operation,
                    fileId,
                    stat.size,
                    now(),
                );
                await acceptFilesystem(
                    () =>
                        fs.copyFile(
                            tempPath,
                            stage,
                            fs.constants.COPYFILE_EXCL,
                        ),
                    'Unable to stage upload',
                );
                await acceptFilesystem(
                    () => fs.chmod(stage, 0o600),
                    'Unable to secure upload staging',
                );
                await acceptFilesystem(
                    () => syncFile(stage),
                    'Unable to sync upload staging',
                );
                const input = await acceptFilesystem(
                    () => fingerprint(stage),
                    'Unable to verify upload staging',
                );
                return await serialized(location.info, async () => {
                    const latest = await read(sid, operationId);
                    await pendingCommit(latest);
                    assertRequestActive();
                    const operation = acceptConversionUpload(
                        latest.operation,
                        fileId,
                        input.bytes,
                        now(),
                    );
                    if (operation.revision === latest.operation.revision)
                        return latest;
                    await acceptFilesystem(
                        () => fs.rename(stage, key),
                        'Unable to promote accepted input',
                    );
                    await acceptFilesystem(
                        () => syncDirectory(location.inputs),
                        'Unable to sync accepted input directory',
                    );
                    // If the snapshot fails, input remains unacknowledged; recovery
                    // removes it or a subsequent retry replaces that orphan safely.
                    return write({
                        operation,
                        inputs: {
                            ...latest.inputs,
                            [fileId]: { ...input, storedName: fileId },
                        },
                    });
                });
            })();
            outcome = { status: 'fulfilled', value: result };
        } catch (error) {
            outcome = { status: 'rejected', reason: error };
        }
        let cleanup: PromiseSettledResult<void>[];
        try {
            cleanup = await Promise.allSettled([
                acceptFilesystem(
                    () => removeIfPresent(stage),
                    'Unable to clean upload staging',
                ),
                acceptFilesystem(
                    () => removeIfPresent(tempPath),
                    'Unable to clean upload source',
                ),
            ]);
        } finally {
            uploadClaims.delete(key);
        }
        const failure = cleanup.find((result) => result.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;
        if (outcome.status === 'rejected')
            return storageFailure(outcome.reason, 'Unable to accept upload');
        return outcome.value;
    }

    function makeOutput(
        operation: ConversionOperation,
        fileId: string,
        processed: ProcessOutput,
    ): ConversionOutput {
        const file = operation.files.find(
            (candidate) => candidate.id === fileId,
        );
        if (!file || file.status !== 'processing')
            throw new ConversionTransitionError(
                'conversion_conflict',
                'File is not processing',
            );
        if (processed.info.sizeBytes !== processed.buffer.length)
            throw new ConversionStorageError(
                'Converted buffer size differs from metadata',
            );
        return {
            url: `/sessions/${operation.sessionId}/files/${fileId}`,
            metaUrl: `/sessions/${operation.sessionId}/files/${fileId}/meta`,
            meta: {
                id: fileId,
                original: {
                    name: file.name,
                    mime: processed.inputMeta.mime,
                    sizeBytes: file.actualBytes,
                    width: processed.inputMeta.width,
                    height: processed.inputMeta.height,
                    pages: processed.inputMeta.pages,
                },
                output: {
                    storedName: `${fileId}.${MIME_TO_EXT[operation.options.outputMime][0]}`,
                    mime: processed.outputMime,
                    sizeBytes: processed.buffer.length,
                    width: processed.info.width,
                    height: processed.info.height,
                    hasAlpha: processed.inputMeta.hasAlpha ?? false,
                    colorSpace: processed.info.colorSpace,
                },
                exifStripped: processed.info.exifStripped,
                animated: processed.info.animated,
                uploadedAt: file.uploadedAt,
            },
        };
    }

    /** Conversion already settled before calling. Buffer staging is outside the
     * mutation lock; final lifecycle checks and publication are serialized. */
    async function commitOutput(
        sid: string,
        operationId: string,
        fileId: string,
        processed: ProcessOutput,
    ): Promise<StoredConversion> {
        const location = paths(sid);
        const key = location.receipt(fileId);
        if (outputClaims.has(key))
            throw new ConversionTransitionError(
                'conversion_conflict',
                'File commit already in progress',
            );
        outputClaims.add(key);
        const stage = location.staged(secureId());
        try {
            const initial = await mutationBase(sid, operationId);
            const output = makeOutput(initial.operation, fileId, processed);
            // Validate slot/MIME/metadata before touching final artifact paths.
            finishConversionFile(initial.operation, fileId, { output }, now());
            const digest = await publishFilesystem(
                () => writeExact(stage, processed.buffer),
                'Unable to stage output',
            );
            const committed = await serialized(location.info, async () => {
                const latest = await read(sid, operationId);
                await pendingCommit(latest);
                const finishedAt = now();
                const operation = finishConversionFile(
                    latest.operation,
                    fileId,
                    { output },
                    finishedAt,
                );
                const file = operation.files.find(
                    (candidate) => candidate.id === fileId,
                );
                if (file?.status !== 'completed')
                    return write({ ...latest, operation });
                await publishFilesystem(
                    () =>
                        fs.rename(
                            stage,
                            location.output(
                                fileId,
                                operation.options.outputMime,
                            ),
                        ),
                    'Unable to publish output',
                );
                await publishFilesystem(
                    () => syncDirectory(location.directory),
                    'Unable to sync output directory',
                );
                await publishFilesystem(
                    () => atomicJson(location.meta(fileId), output.meta),
                    'Unable to publish output metadata',
                );
                // Receipt is durable evidence that both artifacts were published.
                // Never roll these back on a subsequent snapshot-write failure.
                await publishFilesystem(
                    () =>
                        atomicJson(key, {
                            operationId,
                            fileId,
                            finishedAt: finishedAt.toISOString(),
                            fingerprint: digest,
                            output,
                        } satisfies ConversionCommit),
                    'Unable to publish output receipt',
                );
                return write({ ...latest, operation });
            });
            await publishFilesystem(
                () => removeIfPresent(location.input(fileId)),
                'Unable to clean committed input',
            );
            return committed;
        } catch (error) {
            return storageFailure(error, 'Unable to commit output');
        } finally {
            outputClaims.delete(key);
            try {
                await publishFilesystem(
                    () => removeIfPresent(stage),
                    'Unable to clean output staging',
                );
            } catch (error) {
                storageFailure(error, 'Unable to clean output staging');
            }
        }
    }

    /** Record a settled converter/storage failure; committed siblings survive. */
    async function commitFailure(
        sid: string,
        operationId: string,
        fileId: string,
        error: ConversionFileError,
    ): Promise<StoredConversion> {
        const location = paths(sid);
        const result = await update(sid, operationId, (operation) =>
            finishConversionFile(operation, fileId, { error }, now()),
        );
        await removeIfPresent(location.input(fileId));
        await removeIfPresent(
            location.output(fileId, result.operation.options.outputMime),
        );
        await removeIfPresent(location.meta(fileId));
        return result;
    }

    async function verifiedCommit(
        record: StoredConversion,
        fileId: string,
    ): Promise<ConversionCommit | null> {
        const operation = record.operation;
        const location = paths(operation.sessionId);
        let raw: string;
        try {
            const receipts = await fs.lstat(location.receipts);
            if (!receipts.isDirectory())
                throw new ConversionStorageError('Invalid commit directory');
            const receipt = await fs.lstat(location.receipt(fileId));
            if (!receipt.isFile())
                throw new ConversionStorageError('Invalid commit receipt');
            raw = await fs.readFile(location.receipt(fileId), 'utf8');
        } catch (error) {
            if (missing(error)) return null;
            if (error instanceof ConversionStorageError) throw error;
            if (invalidStoragePath(error))
                throw new ConversionStorageError(
                    'Invalid commit receipt path',
                    error,
                );
            throw new ConversionStorageIoError(
                'Unable to read commit receipt',
                error,
            );
        }
        try {
            const commit = ConversionCommitSchema.parse(JSON.parse(raw));
            const file = operation.files.find(
                (candidate) => candidate.id === fileId,
            );
            if (
                !file ||
                commit.operationId !== operation.id ||
                commit.fileId !== fileId ||
                commit.output.meta.id !== fileId ||
                commit.output.meta.output.mime !==
                    operation.options.outputMime ||
                commit.output.meta.output.storedName !==
                    `${fileId}.${MIME_TO_EXT[operation.options.outputMime][0]}` ||
                commit.output.meta.original.sizeBytes !== file.declaredBytes ||
                commit.fingerprint.bytes !== commit.output.meta.output.sizeBytes
            )
                throw new Error('Commit association mismatch');
            const metaFile = await readCommitArtifact(() =>
                fs.lstat(location.meta(fileId)),
            );
            if (!metaFile.isFile())
                throw new Error('Invalid output metadata file');
            const meta = UploadMetaSchema.parse(
                JSON.parse(
                    await readCommitArtifact(() =>
                        fs.readFile(location.meta(fileId), 'utf8'),
                    ),
                ),
            );
            const digest = await readCommitArtifact(() =>
                fingerprint(
                    location.output(fileId, operation.options.outputMime),
                ),
            );
            if (
                !isDeepStrictEqual(meta, commit.output.meta) ||
                !isDeepStrictEqual(digest, commit.fingerprint)
            )
                throw new Error('Commit artifacts do not match receipt');
            return commit;
        } catch (error) {
            if (error instanceof ConversionStorageIoError) throw error;
            throw new ConversionStorageError(
                'Invalid file commit evidence',
                error,
            );
        }
    }

    /** Only committed state plus verified artifacts are eligible for downloads. */
    async function completedOutput(
        sid: string,
        operationId: string,
        fileId: string,
    ): Promise<ConversionOutput> {
        const record = await read(sid, operationId);
        if (now().getTime() >= new Date(record.operation.expiresAt).getTime())
            throw new ConversionTransitionError(
                'session_expired',
                'Session has expired',
            );
        const file = record.operation.files.find(
            (candidate) => candidate.id === fileId,
        );
        if (!file || file.status !== 'completed')
            throw new ConversionTransitionError(
                'file_not_found',
                'No committed output for this slot',
            );
        const commit = await verifiedCommit(record, fileId);
        if (!commit || !isDeepStrictEqual(commit.output, file.output))
            throw new ConversionStorageError(
                'Completed file is missing valid commit evidence',
            );
        return file.output;
    }

    /** Startup only, before workers/requests. Never call against a live converter.
     * Invalid completed evidence is reported without deleting any successes;
     * startup orchestration can quarantine/report the affected session. */
    async function recoverAfterRestart(sid: string): Promise<StoredConversion> {
        const location = paths(sid);
        return serialized(location.info, async () => {
            for (const directory of [
                location.directory,
                location.inputs,
                location.staging,
                location.receipts,
            ]) {
                await ensurePrivateDirectory(directory);
                await ensurePrivateStoredFiles(directory);
            }
            let record = await read(sid);
            const commits: ConversionCommit[] = [];
            for (const file of record.operation.files) {
                if (
                    uploadClaims.has(location.input(file.id)) ||
                    outputClaims.has(location.receipt(file.id))
                )
                    throw new ConversionStorageError(
                        'Cannot recover while file I/O is active',
                    );
                if (file.status === 'completed') {
                    const commit = await verifiedCommit(record, file.id);
                    if (
                        !commit ||
                        !isDeepStrictEqual(commit.output, file.output)
                    )
                        throw new ConversionStorageError(
                            'Completed file is missing valid commit evidence',
                        );
                } else if (file.status === 'processing') {
                    const commit = await verifiedCommit(record, file.id);
                    if (commit) commits.push(commit);
                }
            }
            // Reconcile durable publication at its original time, before expiry
            // handling. A later restart does not undo an earlier successful commit.
            for (const commit of commits.sort((a, b) =>
                a.finishedAt.localeCompare(b.finishedAt),
            )) {
                const operation = finishConversionFile(
                    record.operation,
                    commit.fileId,
                    { output: commit.output },
                    new Date(commit.finishedAt),
                );
                record = await write({ ...record, operation });
            }
            const recoveryTime = now();
            if (
                recoveryTime.getTime() >=
                new Date(record.operation.expiresAt).getTime()
            ) {
                record = await write({
                    ...record,
                    operation: requestConversionStop(
                        record.operation,
                        'session_expired',
                        recoveryTime,
                    ),
                });
            }
            for (const file of record.operation.files) {
                if (file.status === 'processing') {
                    record = await write({
                        ...record,
                        operation: finishConversionFile(
                            record.operation,
                            file.id,
                            {
                                error: {
                                    type: 'processing_interrupted',
                                    message: 'API stopped during conversion',
                                },
                            },
                            recoveryTime,
                        ),
                    });
                } else if (file.status === 'uploaded') {
                    let valid = false;
                    try {
                        valid = isDeepStrictEqual(
                            await recoverFilesystem(
                                () => fingerprint(location.input(file.id)),
                                'Unable to verify accepted input',
                            ),
                            {
                                bytes: record.inputs[file.id].bytes,
                                sha256: record.inputs[file.id].sha256,
                            },
                        );
                    } catch (error) {
                        if (!missing(error)) throw error;
                    }
                    if (!valid) {
                        // Readiness is already resolved for queued work. Use a
                        // specific application transition for lost accepted input.
                        record = await write({
                            ...record,
                            operation: failUploadedConversionFile(
                                record.operation,
                                file.id,
                                {
                                    type: 'storage_error',
                                    message:
                                        'Accepted input is missing or corrupt',
                                },
                                recoveryTime,
                            ),
                        });
                    }
                }
            }
            // Snapshot is durable before removal. Failed cleanup is observable
            // and can be repeated next startup without changing completed files.
            await recoverFilesystem(async () => {
                for (const file of record.operation.files) {
                    if (!['uploaded', 'processing'].includes(file.status))
                        await removeIfPresent(location.input(file.id));
                    if (file.status !== 'completed') {
                        await removeIfPresent(
                            location.output(
                                file.id,
                                record.operation.options.outputMime,
                            ),
                        );
                        await removeIfPresent(location.meta(file.id));
                        await removeIfPresent(location.receipt(file.id));
                    }
                }
                for (const entry of await fs.readdir(location.staging))
                    await removeIfPresent(path.join(location.staging, entry));
                for (const entry of await fs.readdir(location.directory)) {
                    if (
                        /^(conversion\.info|[A-Za-z0-9_-]+)\.json\.[a-f0-9]+\.tmp$/.test(
                            entry,
                        )
                    )
                        await removeIfPresent(
                            path.join(location.directory, entry),
                        );
                }
                for (const entry of await fs.readdir(location.receipts)) {
                    if (/\.tmp$/.test(entry))
                        await removeIfPresent(
                            path.join(location.receipts, entry),
                        );
                }
            }, 'Unable to clean recovery artifacts');
            return record;
        });
    }

    /** Discover operation directories only; never read legacy session secrets. */
    async function listSessions(): Promise<string[]> {
        let entries;
        try {
            entries = await fs.readdir(root, { withFileTypes: true });
        } catch (error) {
            throw new ConversionStorageIoError(
                'Unable to discover conversion sessions',
                error,
            );
        }
        const sessions: string[] = [];
        for (const entry of entries) {
            if (
                !entry.isDirectory() ||
                !ConversionIdSchema.safeParse(entry.name).success
            )
                continue;
            try {
                await fs.stat(paths(entry.name).info);
                sessions.push(entry.name);
            } catch (error) {
                if (missing(error)) continue;
                if (invalidStoragePath(error))
                    throw new ConversionStorageError(
                        'Invalid conversion session path',
                        error,
                    );
                throw new ConversionStorageIoError(
                    'Unable to inspect conversion session',
                    error,
                );
            }
        }
        return sessions.sort();
    }

    async function pruneSettledInputs(sid: string): Promise<void> {
        const location = paths(sid);
        await serialized(location.info, async () => {
            const record = await read(sid);
            for (const file of record.operation.files) {
                if (
                    ['completed', 'failed', 'cancelled'].includes(
                        file.status,
                    ) &&
                    !uploadClaims.has(location.input(file.id))
                ) {
                    try {
                        await removeIfPresent(location.input(file.id));
                    } catch (error) {
                        if (invalidStoragePath(error))
                            throw new ConversionStorageError(
                                'Invalid settled input path',
                                error,
                            );
                        throw new ConversionStorageIoError(
                            'Unable to prune settled input',
                            error,
                        );
                    }
                }
            }
        });
    }

    /** Runtime must hold exclusive session-cleanup ownership, with no live
     * request/download/converter leases. Never delete legacy-only sessions. */
    async function deleteExpired(sid: string): Promise<boolean> {
        const location = paths(sid);
        return serialized(location.info, async () => {
            const record = await read(sid);
            if (
                !isConversionTerminal(record.operation) ||
                now().getTime() < new Date(record.operation.expiresAt).getTime()
            )
                return false;
            if (
                record.operation.files.some(
                    (file) =>
                        uploadClaims.has(location.input(file.id)) ||
                        outputClaims.has(location.receipt(file.id)),
                )
            )
                return false;
            await fs.rm(location.directory, { recursive: true });
            await syncDirectory(root);
            return true;
        });
    }
    return {
        create,
        read,
        update,
        acceptUpload,
        commitOutput,
        commitFailure,
        completedOutput,
        recoverAfterRestart,
        listSessions,
        deleteExpired,
        pruneSettledInputs,
    };
}
