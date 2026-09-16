import type {
    ApiConversionOperation,
    ApiCreateConversionRequest,
    ConversionOutput,
    OutputMimeType,
} from '@image-web-convert/schemas';
import type { Session } from '@image-web-convert/ui';
import * as api from './api/conversionApi';
import {
    createUploadQueue,
    uploadConversionFile,
    type UploadAttempt,
} from './api/conversionUploadTransport';
import { startConversionPolling } from './api/conversionPolling';
import {
    canRetryUpload,
    isTerminal,
    mergeSnapshot,
} from './conversionViewModel';

export type LocalConversionFile = {
    id: string;
    file: File;
    previewUrl?: string;
};
export type CommandErrors = Partial<
    Record<
        | 'session'
        | 'creation'
        | 'polling'
        | 'cancellation'
        | 'download'
        | 'access',
        string
    >
>;
export type ConversionClientState = {
    operation: ApiConversionOperation | null;
    connected: boolean;
    submitted: boolean;
    creationRejected: boolean;
    creating: boolean;
    cancelling: boolean;
    uploadsStopped: boolean;
    downloading: boolean;
    errors: CommandErrors;
    uploads: Record<string, UploadAttempt>;
};
const initialState = (): ConversionClientState => ({
    operation: null,
    connected: false,
    submitted: false,
    creationRejected: false,
    creating: false,
    cancelling: false,
    uploadsStopped: false,
    downloading: false,
    errors: {},
    uploads: {},
});
const defaultServices = { ...api, uploadConversionFile };

// One instance owns one deliberate batch. The epoch guards ALL async callbacks;
// snapshot revision ordering is centralized separately in accept(). No backend
// lifecycle is reproduced here: fields describe only local commands/transfers.
export class ConversionController {
    private state = initialState();
    private listeners = new Set<() => void>();
    private epoch = 0;
    private requests = new AbortController();
    private session?: Session;
    private intent?: ApiCreateConversionRequest;
    private files: LocalConversionFile[] = [];
    private queue?: ReturnType<typeof createUploadQueue>;
    private stopPolling?: () => void;
    private expiry?: ReturnType<typeof setTimeout>;
    constructor(private services = defaultServices) {}
    getSnapshot = () => this.state;
    subscribe = (listener: () => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };
    private update(patch: Partial<ConversionClientState>) {
        this.state = { ...this.state, ...patch };
        this.listeners.forEach((listener) => listener());
    }
    private error(category: keyof CommandErrors, message?: string) {
        this.update({ errors: { ...this.state.errors, [category]: message } });
    }
    private guard() {
        const epoch = this.epoch;
        return () =>
            this.state.connected &&
            epoch === this.epoch &&
            !this.requests.signal.aborted;
    }
    connect() {
        this.update({ connected: true });
        this.requests = new AbortController();
        if (this.session && this.state.operation) this.observe();
        return () => {
            this.update({ connected: false });
            this.epoch++;
            this.stopPolling?.();
            clearTimeout(this.expiry);
            this.queue?.stop();
            this.requests.abort();
        };
    }
    private accessFailure(error: unknown) {
        if (error instanceof api.ConversionTransportError && error.accessDenied)
            this.expire();
    }
    private expire = () => {
        this.error(
            'access',
            'Session access ended. Start a new batch to continue.',
        );
        this.update({
            uploadsStopped: true,
            creating: false,
            cancelling: false,
            downloading: false,
        });
        this.queue?.stop();
        this.stopPolling?.();
        this.requests.abort();
    };
    private accept = (snapshot: ApiConversionOperation) => {
        if (!this.session) return;
        const operation = mergeSnapshot(
            this.state.operation,
            snapshot,
            this.session.sessionId,
        );
        if (operation !== this.state.operation) {
            this.update({ operation });
            if (
                operation &&
                (operation.cancelRequestedAt || isTerminal(operation))
            )
                this.error('cancellation');
            if (operation && isTerminal(operation)) {
                this.stopPolling?.();
                this.error('polling');
            }
            if (
                operation &&
                (isTerminal(operation) || operation.stopRequestedAt)
            )
                this.queue?.stop();
        }
    };
    private armExpiry(session: Session) {
        const valid = this.guard();
        clearTimeout(this.expiry);
        this.expiry = setTimeout(
            () => {
                if (valid()) this.expire();
            },
            Math.max(0, Date.parse(session.expiresAt) - Date.now()),
        );
    }
    private observe() {
        const valid = this.guard();
        const session = this.session;
        const operation = this.state.operation;
        if (!session || !operation) return;
        const id = operation.id;
        this.stopPolling?.();
        this.armExpiry(session);
        if (isTerminal(operation)) return;
        this.stopPolling = startConversionPolling({
            read: (signal) => this.services.getConversion(session, id, signal),
            snapshot: () => this.state.operation ?? operation,
            accept: (snapshot) => {
                if (valid()) this.accept(snapshot);
            },
            connectivity: (error) => {
                if (valid())
                    this.error(
                        'polling',
                        error
                            ? 'Connection interrupted. Status is unknown; retrying automatically.'
                            : undefined,
                    );
            },
            expired: () => {
                if (valid()) this.expire();
            },
        });
    }
    async submit(
        files: LocalConversionFile[],
        outputMime: OutputMimeType,
        startSession: () => Promise<Session>,
    ) {
        if (
            this.state.creating ||
            this.state.operation ||
            this.state.errors.access
        )
            return;
        if (!this.intent) {
            this.files = [...files];
            this.intent = {
                requestId: crypto.randomUUID(),
                options: { outputMime },
                files: files.map(({ id, file }) => ({
                    clientId: id,
                    name: file.name,
                    sizeBytes: file.size,
                })),
            };
        }
        const valid = this.guard();
        this.update({ submitted: true, creating: true });
        this.error('creation');
        this.error('session');
        try {
            if (!this.session) {
                const session = await startSession();
                if (!valid()) return;
                this.session = session;
                this.armExpiry(session);
            }
            const session = this.session;
            const operation = await this.services.createConversion(
                session,
                this.intent,
                this.requests.signal,
            );
            if (!valid()) return;
            this.accept(operation);
            if (!this.state.operation) throw new Error('Mismatched session');
            this.observe();
            this.queue = createUploadQueue({
                send: (task, signal, progress) =>
                    this.services.uploadConversionFile(
                        session,
                        operation.id,
                        task,
                        signal,
                        progress,
                    ),
                changed: (clientId, attempt) => {
                    if (valid())
                        this.update({
                            uploads: {
                                ...this.state.uploads,
                                [clientId]: attempt,
                            },
                        });
                },
                accepted: (snapshot) => {
                    if (valid()) this.accept(snapshot);
                },
                failed: (error) => {
                    if (valid()) this.accessFailure(error);
                },
            });
            if (!isTerminal(operation) && !operation.stopRequestedAt) {
                for (const slot of operation.files) {
                    const local = this.files.find(
                        (file) => file.id === slot.clientId,
                    );
                    if (slot.status === 'awaiting_upload' && local)
                        this.queue.enqueue({
                            id: slot.id,
                            clientId: slot.clientId,
                            file: local.file,
                        });
                }
            }
        } catch (error) {
            if (valid()) {
                const rejected =
                    error instanceof api.ConversionTransportError &&
                    [400, 413].includes(error.status);
                this.update({ creationRejected: rejected });
                this.error(
                    this.session ? 'creation' : 'session',
                    !this.session
                        ? 'Could not open a session. Please retry.'
                        : rejected
                          ? 'Batch rejected. Start a new batch with fewer or smaller images.'
                          : 'Could not confirm batch creation. Retry uses the same batch.',
                );
                this.accessFailure(error);
            }
        } finally {
            if (valid()) this.update({ creating: false });
        }
    }
    async retryUpload(clientId: string) {
        const operation = this.state.operation;
        const session = this.session;
        const file = operation?.files.find(
            (file) => file.clientId === clientId,
        );
        const local = this.files.find((file) => file.id === clientId);
        if (
            !operation ||
            !session ||
            !file ||
            !local ||
            this.state.uploadsStopped ||
            this.state.errors.access ||
            operation.stopRequestedAt ||
            isTerminal(operation) ||
            !canRetryUpload(file, this.state.uploads[clientId])
        )
            return;
        const valid = this.guard();
        const previous = this.state.uploads[clientId];
        this.update({
            uploads: {
                ...this.state.uploads,
                [clientId]: { ...previous, status: 'reconciling' },
            },
        });
        try {
            const snapshot = await this.services.getConversion(
                session,
                operation.id,
                this.requests.signal,
            );
            if (!valid()) return;
            this.accept(snapshot);
            const current = this.state.operation;
            if (!current) return;
            const slot = current.files.find(
                (file) => file.clientId === clientId,
            );
            if (
                !this.state.uploadsStopped &&
                !current.stopRequestedAt &&
                !isTerminal(current) &&
                slot?.status === 'awaiting_upload'
            ) {
                this.queue?.enqueue({
                    id: slot.id,
                    clientId,
                    file: local.file,
                });
            }
        } catch (error) {
            if (valid()) {
                this.update({
                    uploads: {
                        ...this.state.uploads,
                        [clientId]: {
                            ...previous,
                            status: 'error',
                            reconciliationError: true,
                        },
                    },
                });
                this.accessFailure(error);
            }
        }
    }
    async cancel() {
        const operation = this.state.operation;
        const session = this.session;
        if (
            !operation ||
            !session ||
            isTerminal(operation) ||
            this.state.cancelling ||
            this.state.errors.access
        )
            return;
        const valid = this.guard();
        this.update({ cancelling: true, uploadsStopped: true });
        this.error('cancellation');
        this.queue?.stop();
        try {
            const snapshot = await this.services.cancelConversion(
                session,
                operation.id,
                this.requests.signal,
            );
            if (valid()) this.accept(snapshot);
        } catch (error) {
            if (valid()) {
                const current = this.state.operation;
                if (
                    current &&
                    !isTerminal(current) &&
                    !current.cancelRequestedAt
                )
                    this.error(
                        'cancellation',
                        'Cancellation not confirmed. Please retry cancellation.',
                    );
                this.accessFailure(error);
            }
        } finally {
            if (valid()) this.update({ cancelling: false });
        }
    }
    pageExit = () => {
        if (
            this.session &&
            this.state.operation &&
            !isTerminal(this.state.operation) &&
            !this.state.errors.access
        )
            this.services.cancelOnPageExit(
                this.session,
                this.state.operation.id,
            );
    };
    async download(result: ConversionOutput | string[]) {
        if (!this.session || this.state.downloading || this.state.errors.access)
            return;
        const valid = this.guard();
        this.update({ downloading: true });
        this.error('download');
        try {
            await this.services.downloadConversion(
                this.session,
                result,
                this.requests.signal,
            );
        } catch (error) {
            if (valid()) {
                this.error(
                    'download',
                    'Download failed. Please retry while this session is available.',
                );
                this.accessFailure(error);
            }
        } finally {
            if (valid()) this.update({ downloading: false });
        }
    }
}
