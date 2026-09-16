import {
    ApiConversionOperationSchema,
    type ApiConversionOperation,
} from '@image-web-convert/schemas';
import type { Session } from '@image-web-convert/ui';
import {
    authHeaders,
    ConversionTransportError,
    operationUrl,
    retryAfter,
} from './conversionApi';

export type UploadAttempt = {
    attempt: number;
    status:
        | 'queued'
        | 'sending'
        | 'acknowledged'
        | 'error'
        | 'aborted'
        | 'reconciling';
    loaded: number;
    total?: number;
    conflict?: boolean;
    reconciliationError?: boolean;
};
export type UploadTask = { id: string; clientId: string; file: File };
export function uploadConversionFile(
    session: Session,
    operationId: string,
    task: UploadTask,
    signal: AbortSignal,
    progress: (loaded: number, total?: number) => void,
): Promise<ApiConversionOperation> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const abort = () => xhr.abort();
        const clean = () => {
            signal.removeEventListener('abort', abort);
            xhr.onload = xhr.onerror = xhr.onabort = xhr.ontimeout = null;
            xhr.upload.onprogress = null;
        };
        const fail = (error: unknown) => {
            clean();
            reject(error);
        };
        xhr.open(
            'PUT',
            `${operationUrl(session, operationId)}/files/${encodeURIComponent(task.id)}`,
        );
        xhr.setRequestHeader(
            'Authorization',
            authHeaders(session).Authorization,
        );
        xhr.timeout = 300_000;
        xhr.upload.onprogress = (event) =>
            progress(
                event.loaded,
                event.lengthComputable ? event.total : undefined,
            );
        xhr.onerror = xhr.ontimeout = () =>
            fail(new ConversionTransportError());
        xhr.onabort = () =>
            fail(new DOMException('Upload aborted', 'AbortError'));
        xhr.onload = () => {
            if (xhr.status < 200 || xhr.status >= 300) {
                fail(
                    new ConversionTransportError(
                        xhr.status,
                        retryAfter(xhr.getResponseHeader('Retry-After')),
                    ),
                );
                return;
            }
            try {
                const operation = ApiConversionOperationSchema.parse(
                    JSON.parse(xhr.responseText),
                );
                clean();
                resolve(operation);
            } catch (error) {
                fail(error);
            }
        };
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) {
            fail(new DOMException('Upload aborted', 'AbortError'));
            return;
        }
        const body = new FormData();
        body.append('file', task.file);
        try {
            xhr.send(body);
        } catch (error) {
            fail(error);
        }
    });
}

// One scheduler for initial transfers and explicit retries. Backend processing
// order and readiness are deliberately absent from this transport queue.
export function createUploadQueue(options: {
    send: (
        task: UploadTask,
        signal: AbortSignal,
        progress: (loaded: number, total?: number) => void,
    ) => Promise<ApiConversionOperation>;
    changed: (clientId: string, attempt: UploadAttempt) => void;
    accepted: (snapshot: ApiConversionOperation) => void;
    failed: (error: unknown) => void;
}) {
    const waiting: UploadTask[] = [];
    const active = new Map<string, AbortController>();
    const attempts = new Map<string, UploadAttempt>();
    let stopped = false;
    const publish = (task: UploadTask, patch: Partial<UploadAttempt>) => {
        const previous = attempts.get(task.clientId);
        if (!previous) return;
        const value = { ...previous, ...patch };
        attempts.set(task.clientId, value);
        options.changed(task.clientId, value);
    };
    const pump = () => {
        while (!stopped && active.size < 2 && waiting.length) {
            const task = waiting.shift();
            if (task) start(task);
        }
    };
    const start = (task: UploadTask) => {
        const controller = new AbortController();
        active.set(task.clientId, controller);
        publish(task, { status: 'sending' });
        void options
            .send(task, controller.signal, (loaded, total) => {
                if (!stopped) publish(task, { loaded, total });
            })
            .then((snapshot) => {
                if (!stopped) {
                    publish(task, { status: 'acknowledged' });
                    options.accepted(snapshot);
                }
            })
            .catch((error: unknown) => {
                if (!stopped) {
                    publish(task, {
                        status: 'error',
                        conflict:
                            error instanceof ConversionTransportError &&
                            error.status === 409,
                    });
                    options.failed(error);
                }
            })
            .finally(() => {
                active.delete(task.clientId);
                pump();
            });
    };
    return {
        enqueue(task: UploadTask) {
            if (
                stopped ||
                active.has(task.clientId) ||
                waiting.some((t) => t.clientId === task.clientId)
            )
                return;
            attempts.set(task.clientId, {
                attempt: (attempts.get(task.clientId)?.attempt ?? 0) + 1,
                status: 'queued',
                loaded: 0,
            });
            publish(task, {});
            waiting.push(task);
            pump();
        },
        stop() {
            stopped = true;
            for (const task of waiting.splice(0))
                publish(task, { status: 'aborted' });
            for (const [clientId, controller] of active) {
                const previous = attempts.get(clientId);
                if (!previous) continue;
                const value = {
                    ...previous,
                    status: 'aborted' as const,
                };
                attempts.set(clientId, value);
                options.changed(clientId, value);
                controller.abort();
            }
        },
    };
}
