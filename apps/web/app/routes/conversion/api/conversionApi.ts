import {
    ApiConversionOperationSchema,
    type ApiCreateConversionRequest,
    type ConversionOutput,
} from '@image-web-convert/schemas';
import { API_URL, type Session } from '@image-web-convert/ui';

export class ConversionTransportError extends Error {
    constructor(
        public status = 0,
        public retryAfterMs = 0,
    ) {
        super('Conversion request could not be confirmed');
    }
    get accessDenied() {
        return this.status === 401 || this.status === 403;
    }
}
export function retryAfter(value: string | null, now = Date.now()) {
    if (!value) return 0;
    const seconds = Number(value);
    return Math.max(
        0,
        Number.isFinite(seconds)
            ? seconds * 1000
            : Date.parse(value) - now || 0,
    );
}
export const operationUrl = (session: Session, id?: string) =>
    `${API_URL}/sessions/${encodeURIComponent(session.sessionId)}/conversions${id ? `/${encodeURIComponent(id)}` : ''}`;
export const authHeaders = (session: Session) => ({
    Authorization: `Bearer ${session.token}`,
});
async function request(session: Session, url: string, init: RequestInit) {
    const response = await fetch(url, {
        ...init,
        headers: { ...authHeaders(session), ...init.headers },
    });
    if (!response.ok)
        throw new ConversionTransportError(
            response.status,
            retryAfter(response.headers.get('Retry-After')),
        );
    return response;
}
async function snapshot(session: Session, url: string, init: RequestInit) {
    return ApiConversionOperationSchema.parse(
        await (await request(session, url, init)).json(),
    );
}
export const createConversion = (
    session: Session,
    intent: ApiCreateConversionRequest,
    signal: AbortSignal,
) =>
    snapshot(session, operationUrl(session), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(intent),
        signal,
    });
export const getConversion = (
    session: Session,
    id: string,
    signal: AbortSignal,
) =>
    snapshot(session, operationUrl(session, id), { signal, cache: 'no-store' });
export const cancelConversion = (
    session: Session,
    id: string,
    signal: AbortSignal,
) =>
    snapshot(session, `${operationUrl(session, id)}/cancel`, {
        method: 'POST',
        signal,
    });
export function cancelOnPageExit(session: Session, id: string) {
    // Only pagehide calls this; never React cleanup. No response may affect UI.
    try {
        void fetch(`${operationUrl(session, id)}/cancel`, {
            method: 'POST',
            headers: authHeaders(session),
            keepalive: true,
        }).catch(() => undefined);
    } catch {
        /* Best effort, including synchronous browser rejection. */
    }
}
function outputUrl(path: string) {
    // Backend URLs are API-relative (/sessions/…). Also accept an /api prefix
    // while preserving a configured API host/base.
    return `${API_URL}/${path.replace(/^\/?api\//, '').replace(/^\//, '')}`;
}
export async function downloadConversion(
    session: Session,
    result: ConversionOutput | string[],
    signal: AbortSignal,
) {
    const zip = Array.isArray(result);
    const response = await request(
        session,
        zip
            ? `${API_URL}/sessions/${encodeURIComponent(session.sessionId)}/files/download`
            : outputUrl(result.url),
        zip
            ? {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                      ids: result,
                      archiveName: 'images.zip',
                  }),
                  signal,
              }
            : { signal },
    );
    const blob = await response.blob();
    if (signal.aborted) return;
    const url = URL.createObjectURL(blob);
    try {
        const link = document.createElement('a');
        link.href = url;
        link.download = zip ? 'images.zip' : result.meta.output.storedName;
        document.body.appendChild(link);
        link.click();
        link.remove();
    } finally {
        URL.revokeObjectURL(url);
    }
}
