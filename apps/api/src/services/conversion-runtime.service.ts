import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { secureId } from '@image-web-convert/node-shared';
import {
    ApiCreateConversionRequestSchema,
    ConversionIdSchema,
    type SessionImageConfig,
    type ConversionStopReason,
    type ConversionFileError,
} from '@image-web-convert/schemas';
import {
    getConversionRuntimeConfig,
    getSessionImageConfig,
    type ConversionRuntimeConfig,
} from '../env';
import {
    createConversionStorage,
    ConversionStorageError,
} from './conversion-storage.service';
import type { StoredConversion } from './conversion-storage.schema';
import { conversionStoragePaths, UPLOAD_DIR } from './storage.paths';
import { DEFAULT_IMG_OPTS } from './image.config';
import {
    processImageToMimeType,
    type ProcessInput,
    type ProcessOutput,
} from './image.service';
import {
    createConversionOperation,
    sanitizeConversionFileName,
    isConversionTerminal,
    requestConversionStop,
    startConversionFile,
    rejectConversionUpload,
    ConversionTransitionError,
} from './conversions.service';

type Store = ReturnType<typeof createConversionStorage>;
type Timer = ReturnType<typeof setTimeout>;
export type ConversionRuntimeClock = {
    now(): Date;
    setTimeout(callback: () => void, ms: number): Timer;
    clearTimeout(timer: Timer): void;
};
const systemClock: ConversionRuntimeClock = {
    now: () => new Date(),
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (timer) => clearTimeout(timer),
};
// Prevent two runtimes from executing the same local storage in one process.
const owners = new Set<string>();

export function createConversionRuntime(
    options: {
        root?: string;
        store?: Store;
        config?: ConversionRuntimeConfig;
        imageLimits?: SessionImageConfig;
        clock?: ConversionRuntimeClock;
        convert?: (input: ProcessInput) => Promise<ProcessOutput>;
        onError?: (error: unknown, sessionId?: string) => void;
    } = {},
) {
    const root = path.resolve(options.root ?? UPLOAD_DIR);
    const clock = options.clock ?? systemClock;
    const config = options.config ?? getConversionRuntimeConfig();
    const imageLimits = options.imageLimits ?? getSessionImageConfig();
    const store =
        options.store ??
        createConversionStorage({ root, now: () => clock.now() });
    const convert = options.convert ?? processImageToMimeType;
    const report =
        options.onError ??
        ((error, sid) =>
            console.error('Conversion runtime error', sid ?? '', error));
    const blockedSessions = new Set<string>();
    const leases = new Map<string, number>();
    const deleting = new Set<string>();
    const uploads = new Set<string>();
    const drainListeners = new Set<() => void>();
    let started = false;
    let initializing = false;
    let accepting = false;
    let closing = false;
    let ownsRoot = false;
    let fault: unknown;
    let maintenanceTimer: Timer | undefined;
    let maintenance: Promise<void> | null = null;
    let worker: Promise<void> | null = null;
    let initialization: Promise<void> | undefined;
    let stopping: Promise<{ drained: boolean }> | undefined;
    let admissionTail: Promise<void> = Promise.resolve();
    let active: {
        sessionId: string;
        operationId: string;
        fileId: string;
    } | null = null;
    let wakeRequested = false;

    function notifyDrained() {
        if (initializing || worker || maintenance || leases.size) return;
        if (closing && ownsRoot) {
            owners.delete(root);
            ownsRoot = false;
        }
        for (const listener of drainListeners) listener();
    }

    function halt(error: unknown, sid?: string) {
        fault = error;
        if (maintenanceTimer) clock.clearTimeout(maintenanceTimer);
        maintenanceTimer = undefined;
        report(error, sid);
    }

    function assertAccepting() {
        if (fault)
            throw new ConversionStorageError(
                'Conversion runtime requires recovery',
                fault,
            );
        if (!accepting)
            throw new ConversionTransitionError(
                'conversion_conflict',
                'Conversion runtime is not accepting work',
            );
    }

    /** Hold from request admission until actual transfer/download/conversion
     * settlement. Timers and cancellation do not release resource ownership. */
    function acquireSessionUse(sid: string): () => void {
        assertAccepting();
        ConversionIdSchema.parse(sid);
        if (deleting.has(sid))
            throw new ConversionTransitionError(
                'session_expired',
                'Expired session is being removed',
            );
        if (blockedSessions.has(sid))
            throw new ConversionStorageError(
                'Session requires storage recovery',
            );
        leases.set(sid, (leases.get(sid) ?? 0) + 1);
        let released = false;
        return () => {
            if (released) return;
            released = true;
            const remaining = (leases.get(sid) ?? 1) - 1;
            if (remaining) leases.set(sid, remaining);
            else leases.delete(sid);
            notifyDrained();
        };
    }

    async function records(): Promise<StoredConversion[]> {
        const results: StoredConversion[] = [];
        for (const sid of await store.listSessions()) {
            if (blockedSessions.has(sid) || deleting.has(sid)) continue;
            try {
                results.push(await store.read(sid));
            } catch (error) {
                if (
                    error instanceof ConversionTransitionError &&
                    error.type === 'operation_not_found'
                )
                    continue;
                blockedSessions.add(sid);
                report(error, sid);
            }
        }
        return results;
    }

    function canProcess(record: StoredConversion) {
        const operation = record.operation;
        return (
            !isConversionTerminal(operation) &&
            !operation.stopReason &&
            new Date(operation.expiresAt).getTime() > clock.now().getTime() &&
            operation.files.some((file) => file.status === 'uploaded') &&
            !operation.files.some(
                (file) =>
                    file.status === 'awaiting_upload' ||
                    file.status === 'processing',
            )
        );
    }

    async function stopOperation(
        sid: string,
        oid: string,
        reason: ConversionStopReason,
    ) {
        return store.update(sid, oid, (operation) =>
            requestConversionStop(operation, reason, clock.now()),
        );
    }

    async function processFile(record: StoredConversion, fileId: string) {
        const { sessionId: sid, id: oid } = record.operation;
        const release = acquireSessionUse(sid);
        let timer: Timer | undefined;
        let deadlineWrite: Promise<unknown> | undefined;
        try {
            const claimed = await store.update(sid, oid, (operation) => {
                assertAccepting();
                return startConversionFile(operation, fileId, clock.now());
            });
            active = { sessionId: sid, operationId: oid, fileId };
            const beganAt = clock.now().getTime();
            const expiresAt = new Date(claimed.operation.expiresAt).getTime();
            const deadline = Math.min(
                beganAt + config.fileTimeoutMs,
                expiresAt,
            );
            const requestDeadline = () => {
                if (!deadlineWrite) {
                    const reason =
                        clock.now().getTime() >= expiresAt
                            ? 'session_expired'
                            : 'conversion_timeout';
                    deadlineWrite = stopOperation(sid, oid, reason).catch(
                        (error) => halt(error, sid),
                    );
                }
            };
            timer = clock.setTimeout(
                requestDeadline,
                Math.max(0, deadline - clock.now().getTime()),
            );
            let result: ProcessOutput | undefined;
            let error: ConversionFileError | undefined;
            try {
                result = await convert({
                    inputPath: conversionStoragePaths(sid, root).input(fileId),
                    outputMime: claimed.operation.options.outputMime,
                    options: {
                        ...claimed.operation.processingOptions,
                        limitInputPixels: Math.min(
                            claimed.operation.processingOptions
                                .limitInputPixels,
                            config.maxInputPixels,
                        ),
                        maxDimension:
                            claimed.operation.processingOptions.maxDimension > 0
                                ? Math.min(
                                      claimed.operation.processingOptions
                                          .maxDimension,
                                      config.maxDimension,
                                  )
                                : config.maxDimension,
                    },
                    timeoutSeconds: Math.max(
                        1,
                        Math.min(3600, Math.ceil((deadline - beganAt) / 1000)),
                    ),
                });
            } catch (cause) {
                error = {
                    type: 'conversion_failed',
                    message:
                        cause instanceof Error
                            ? cause.message
                            : 'Image conversion failed',
                };
            }
            clock.clearTimeout(timer);
            timer = undefined;
            // Synchronous HEIC work can delay timer callbacks; always check time
            // after settlement before publishing any result.
            if (clock.now().getTime() >= deadline) requestDeadline();
            await deadlineWrite;
            if (fault) return; // Leave state/input for recovery, never guess a commit.
            if (result) await store.commitOutput(sid, oid, fileId, result);
            else
                await store.commitFailure(
                    sid,
                    oid,
                    fileId,
                    error ?? {
                        type: 'conversion_failed',
                        message: 'Converter returned no result',
                    },
                );
        } catch (error) {
            // Cancellation/expiry/shutdown may win before the durable claim.
            if (
                !active &&
                error instanceof ConversionTransitionError &&
                ['conversion_conflict', 'session_expired'].includes(error.type)
            )
                return;
            halt(error, sid);
        } finally {
            if (timer) clock.clearTimeout(timer);
            active = null;
            release();
        }
    }

    async function drain() {
        while (accepting && !fault) {
            const ready = (await records())
                .filter(canProcess)
                .sort(
                    (a, b) =>
                        (
                            a.operation.queuedAt ?? a.operation.createdAt
                        ).localeCompare(
                            b.operation.queuedAt ?? b.operation.createdAt,
                        ) || a.operation.id.localeCompare(b.operation.id),
                );
            if (!ready.length) return;
            const selected = ready[0].operation;
            // Retain FIFO operation ownership through its sequential file list.
            while (accepting && !fault) {
                const record = await store.read(
                    selected.sessionId,
                    selected.id,
                );
                if (!accepting || fault || !canProcess(record)) break;
                const file = record.operation.files.find(
                    (candidate) => candidate.status === 'uploaded',
                );
                if (!file) break;
                await processFile(record, file.id);
            }
        }
    }

    function wake() {
        if (!accepting || fault) return;
        wakeRequested = true;
        if (worker) return;
        worker = Promise.resolve()
            .then(async () => {
                do {
                    wakeRequested = false;
                    await drain();
                } while (wakeRequested && accepting && !fault);
            })
            .catch((error) => halt(error))
            .finally(() => {
                worker = null;
                notifyDrained();
                if (wakeRequested && accepting && !fault) wake();
            });
    }

    /** Periodic discovery covers a lost wakeup without requiring status polling. */
    function sweep(): Promise<void> {
        if (maintenance) return maintenance;
        if (!started || closing || fault) return Promise.resolve();
        maintenance = (async () => {
            for (const record of await records()) {
                if (closing || fault) break;
                const operation = record.operation;
                const sid = operation.sessionId;
                if (
                    clock.now().getTime() >=
                    new Date(operation.expiresAt).getTime()
                ) {
                    if (!isConversionTerminal(operation))
                        await stopOperation(
                            sid,
                            operation.id,
                            'session_expired',
                        );
                    if (!leases.has(sid)) {
                        deleting.add(sid);
                        try {
                            await store.deleteExpired(sid);
                        } finally {
                            deleting.delete(sid);
                        }
                    }
                } else {
                    await store.pruneSettledInputs(sid);
                }
            }
            wake();
        })()
            .catch((error) => halt(error))
            .finally(() => {
                maintenance = null;
                notifyDrained();
            });
        return maintenance;
    }

    function armMaintenance() {
        if (closing || fault) return;
        maintenanceTimer = clock.setTimeout(() => {
            maintenanceTimer = undefined;
            void sweep().then(armMaintenance);
        }, config.sweepIntervalMs);
        maintenanceTimer.unref?.();
    }

    function start(): Promise<void> {
        if (initialization) return initialization;
        initialization = (async () => {
            if (closing || owners.has(root))
                throw new ConversionTransitionError(
                    'conversion_conflict',
                    'A runtime already owns this storage, or this runtime is stopped',
                );
            owners.add(root);
            ownsRoot = true;
            initializing = true;
            try {
                for (const sid of await store.listSessions()) {
                    try {
                        await store.recoverAfterRestart(sid);
                    } catch (error) {
                        blockedSessions.add(sid);
                        report(error, sid);
                    }
                }
                if (closing) return;
                started = true;
                accepting = true;
                await sweep();
                if (fault) throw fault;
                armMaintenance();
                wake();
            } catch (error) {
                halt(error);
                accepting = false;
                closing = true;
                throw error;
            } finally {
                initializing = false;
                notifyDrained();
            }
        })();
        return initialization;
    }

    async function createOperation(
        session: { id: string; expiresAt: string },
        request: unknown,
    ) {
        const release = acquireSessionUse(session.id);
        const previous = admissionTail;
        let unlock!: () => void;
        admissionTail = new Promise<void>((resolve) => {
            unlock = resolve;
        });
        await previous;
        try {
            assertAccepting();
            const parsed = ApiCreateConversionRequestSchema.safeParse(request);
            if (!parsed.success)
                throw new ConversionTransitionError(
                    'invalid_request',
                    'Invalid conversion manifest or options',
                );
            const intent = parsed.data;
            const existing = await records();
            const prior = existing.find(
                (record) => record.operation.sessionId === session.id,
            );
            if (prior) {
                if (
                    prior.operation.requestId !== intent.requestId ||
                    prior.operation.files.length !== intent.files.length
                )
                    throw new ConversionTransitionError(
                        'conversion_conflict',
                        'Session already has a different conversion intent',
                    );
                const existingManifest = prior.operation.files.map((file) => ({
                    clientId: file.clientId,
                    name: file.name,
                    sizeBytes: file.declaredBytes,
                }));
                const requestedManifest = intent.files.map((file) => ({
                    ...file,
                    name: sanitizeConversionFileName(file.name),
                }));
                if (
                    !isDeepStrictEqual(
                        prior.operation.options,
                        intent.options,
                    ) ||
                    !isDeepStrictEqual(existingManifest, requestedManifest)
                )
                    throw new ConversionTransitionError(
                        'conversion_conflict',
                        'Session already has a different conversion intent',
                    );
                return prior;
            }
            if (
                existing.filter(
                    (record) => !isConversionTerminal(record.operation),
                ).length +
                    blockedSessions.size >=
                config.maxOperations
            )
                throw new ConversionTransitionError(
                    'conversion_capacity_exceeded',
                    'Too many active conversion operations',
                );
            const operation = createConversionOperation(intent, {
                id: secureId(),
                sessionId: session.id,
                fileIds: intent.files.map(() => secureId()),
                expiresAt: session.expiresAt,
                limits: imageLimits,
                now: clock.now(),
                processingOptions: {
                    ...DEFAULT_IMG_OPTS,
                    limitInputPixels: config.maxInputPixels,
                    maxDimension: config.maxDimension,
                },
            });
            return await store.create(operation);
        } finally {
            unlock();
            release();
            wake();
        }
    }

    async function acceptUpload(
        sid: string,
        oid: string,
        fileId: string,
        tempPath: string,
        assertRequestActive?: () => void,
    ) {
        const release = acquireSessionUse(sid);
        try {
            return await store.acceptUpload(
                sid,
                oid,
                fileId,
                tempPath,
                assertRequestActive,
            );
        } finally {
            release();
            wake();
        }
    }

    async function rejectUpload(
        sid: string,
        oid: string,
        fileId: string,
        error: ConversionFileError,
    ) {
        const release = acquireSessionUse(sid);
        try {
            return await store.update(sid, oid, (operation) =>
                rejectConversionUpload(operation, fileId, error, clock.now()),
            );
        } finally {
            release();
            wake();
        }
    }

    async function cancel(sid: string, oid: string) {
        const release = acquireSessionUse(sid);
        try {
            return await stopOperation(sid, oid, 'user_cancelled');
        } finally {
            release();
            wake();
        }
    }

    /** Future upload middleware acquires this before parsing bytes, calls touch
     * on data, asserts validity before acceptance, and releases on request end.
     * Timeout callback must abort transport; ownership lasts until release. */
    function beginUpload(
        sid: string,
        fileId: string,
        expiresAt: string,
        onTimeout: (reason: 'idle' | 'total' | 'expired') => void,
    ) {
        ConversionIdSchema.parse(fileId);
        assertAccepting();
        const remaining = new Date(expiresAt).getTime() - clock.now().getTime();
        if (!Number.isFinite(remaining) || remaining <= 0)
            throw new ConversionTransitionError(
                'session_expired',
                'Session expired',
            );
        const key = `${sid}/${fileId}`;
        if (uploads.has(key))
            throw new ConversionTransitionError(
                'upload_in_progress',
                'Slot already has an active upload',
            );
        if (uploads.size >= config.maxUploads)
            throw new ConversionTransitionError(
                'conversion_capacity_exceeded',
                'Too many active uploads',
            );
        const releaseUse = acquireSessionUse(sid);
        uploads.add(key);
        let released = false;
        let timedOut = false;
        let idle: Timer;
        const beganAt = clock.now().getTime();
        let lastActivity = beganAt;
        const expire = (reason: 'idle' | 'total' | 'expired') => {
            if (released || timedOut) return;
            timedOut = true;
            try {
                onTimeout(reason);
            } catch (error) {
                report(error, sid);
            }
        };
        const total = clock.setTimeout(
            () =>
                expire(remaining <= config.uploadTotalMs ? 'expired' : 'total'),
            Math.min(remaining, config.uploadTotalMs),
        );
        const checkDeadline = () => {
            const now = clock.now().getTime();
            if (now >= beganAt + Math.min(remaining, config.uploadTotalMs))
                expire(remaining <= config.uploadTotalMs ? 'expired' : 'total');
            else if (now >= lastActivity + config.uploadIdleMs) expire('idle');
        };
        const touch = () => {
            checkDeadline();
            if (released || timedOut) return;
            lastActivity = clock.now().getTime();
            if (idle) clock.clearTimeout(idle);
            idle = clock.setTimeout(() => expire('idle'), config.uploadIdleMs);
        };
        touch();
        return {
            touch,
            assertActive() {
                checkDeadline();
                if (
                    released ||
                    timedOut ||
                    clock.now().getTime() >= new Date(expiresAt).getTime()
                )
                    throw new ConversionTransitionError(
                        'upload_error',
                        'Upload expired or timed out',
                    );
            },
            release() {
                if (released) return;
                released = true;
                clock.clearTimeout(total);
                clock.clearTimeout(idle);
                uploads.delete(key);
                releaseUse();
            },
        };
    }

    function stop(): Promise<{ drained: boolean }> {
        if (stopping) return stopping;
        closing = true;
        accepting = false;
        if (maintenanceTimer) clock.clearTimeout(maintenanceTimer);
        maintenanceTimer = undefined;
        stopping = new Promise((resolve) => {
            const complete = () => {
                drainListeners.delete(complete);
                clock.clearTimeout(timer);
                resolve({ drained: true });
            };
            const timer = clock.setTimeout(() => {
                drainListeners.delete(complete);
                resolve({ drained: false }); // Do not release live work or delete input.
            }, config.shutdownGraceMs);
            drainListeners.add(complete);
            notifyDrained();
        });
        return stopping;
    }

    return {
        read: store.read,
        completedOutput: store.completedOutput,
        start,
        stop,
        wake,
        sweep,
        createOperation,
        acceptUpload,
        rejectUpload,
        cancel,
        beginUpload,
        acquireSessionUse,
        isReady: () => started && accepting && !fault,
        whenIdle: async () => {
            while (worker) await worker;
        },
        diagnostics: () => ({
            active: active ? { ...active } : null,
            blockedSessions: [...blockedSessions],
            failed: Boolean(fault),
        }),
    };
}
export type ConversionRuntime = ReturnType<typeof createConversionRuntime>;
