import { startConversionPolling } from '../api/conversionPolling';
import {
    createUploadQueue,
    uploadConversionFile,
} from '../api/conversionUploadTransport';
import {
    ConversionTransportError,
    cancelOnPageExit,
    createConversion,
    downloadConversion,
    retryAfter,
} from '../api/conversionApi';
import {
    batchUploadProgress,
    fileDisplayState,
    mergeSnapshot,
} from '../conversionViewModel';
import {
    awaiting,
    completed,
    deferred,
    session,
    snapshot,
} from './conversionFixtures';
import type { ApiConversionOperation } from '@image-web-convert/schemas';

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('polling transport', () => {
    it('never overlaps requests; backs off, honors Retry-After, recovers and stops at terminal', async () => {
        vi.useFakeTimers();
        let current = snapshot();
        const pending = deferred<ApiConversionOperation>();
        const read = vi
            .fn()
            .mockReturnValueOnce(pending.promise)
            .mockRejectedValueOnce(new ConversionTransportError(429, 7000))
            .mockResolvedValueOnce(snapshot([completed()], { revision: 3 }));
        const connectivity = vi.fn();
        const stop = startConversionPolling({
            read,
            snapshot: () => current,
            accept: (next) => {
                current = next;
            },
            connectivity,
            expired: vi.fn(),
        });
        await vi.advanceTimersByTimeAsync(6000);
        expect(read).toHaveBeenCalledTimes(1);
        pending.resolve(snapshot());
        await vi.advanceTimersByTimeAsync(1000);
        expect(read).toHaveBeenCalledTimes(2);
        expect(current.status).toBe('awaiting_uploads');
        await vi.advanceTimersByTimeAsync(6999);
        expect(read).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(1);
        expect(read).toHaveBeenCalledTimes(3);
        await vi.advanceTimersByTimeAsync(60000);
        expect(read).toHaveBeenCalledTimes(3);
        expect(connectivity).toHaveBeenLastCalledWith(null);
        stop();
    });
    it('aborts and ignores late responses on cleanup', async () => {
        vi.useFakeTimers();
        const pending = deferred<ApiConversionOperation>();
        const accept = vi.fn();
        const read = vi.fn().mockReturnValue(pending.promise);
        const stop = startConversionPolling({
            read,
            snapshot,
            accept,
            connectivity: vi.fn(),
            expired: vi.fn(),
        });
        await vi.advanceTimersByTimeAsync(1000);
        stop();
        expect(read.mock.calls[0][0].aborted).toBe(true);
        pending.resolve(snapshot([completed()]));
        await vi.advanceTimersByTimeAsync(2000);
        expect(accept).not.toHaveBeenCalled();
    });
    it.each([401, 403])('stops on access failure %s', async (status) => {
        vi.useFakeTimers();
        const expired = vi.fn();
        const read = vi
            .fn()
            .mockRejectedValue(new ConversionTransportError(status));
        startConversionPolling({
            read,
            snapshot,
            accept: vi.fn(),
            connectivity: vi.fn(),
            expired,
        });
        await vi.advanceTimersByTimeAsync(5000);
        expect(read).toHaveBeenCalledOnce();
        expect(expired).toHaveBeenCalledOnce();
    });
    it('expires even when an in-flight request never settles', async () => {
        vi.useFakeTimers();
        const expired = vi.fn();
        const read = vi.fn().mockReturnValue(new Promise(() => undefined));
        const operation = snapshot(undefined, {
            expiresAt: new Date(Date.now() + 2000).toISOString(),
        });
        startConversionPolling({
            read,
            snapshot: () => operation,
            accept: vi.fn(),
            connectivity: vi.fn(),
            expired,
        });
        await vi.advanceTimersByTimeAsync(2000);
        expect(expired).toHaveBeenCalledOnce();
        expect(read.mock.calls[0][0].aborted).toBe(true);
    });
});

describe('bounded uploads', () => {
    it('enforces two transfers, resets retries, aborts active and stops admission', async () => {
        const pending = [
            deferred<ApiConversionOperation>(),
            deferred<ApiConversionOperation>(),
            deferred<ApiConversionOperation>(),
        ];
        const send = vi
            .fn()
            .mockImplementation(
                () => pending[send.mock.calls.length - 1].promise,
            );
        const changed = vi.fn();
        const failed = vi.fn();
        const queue = createUploadQueue({
            send,
            changed,
            failed,
            accepted: vi.fn(),
        });
        const task = (id: string) => ({
            id,
            clientId: id,
            file: new File(['abc'], 'same.png'),
        });
        queue.enqueue(task('a'));
        queue.enqueue(task('b'));
        queue.enqueue(task('c'));
        queue.enqueue(task('a'));
        expect(send).toHaveBeenCalledTimes(2);
        send.mock.calls[0][2](100, 200);
        pending[0].reject(new ConversionTransportError(409));
        await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(3));
        queue.enqueue(task('a'));
        expect(changed).toHaveBeenCalledWith('a', {
            attempt: 2,
            status: 'queued',
            loaded: 0,
        });
        queue.stop();
        expect(send.mock.calls[1][1].aborted).toBe(true);
        expect(send.mock.calls[2][1].aborted).toBe(true);
        pending[1].resolve(snapshot());
        pending[2].resolve(snapshot());
        await Promise.resolve();
        expect(send).toHaveBeenCalledTimes(3);
    });
    it('XHR sends one multipart file, reports actual/unknown progress and cleans up on abort', async () => {
        const xhr = {
            open: vi.fn(),
            setRequestHeader: vi.fn(),
            send: vi.fn(),
            abort: vi.fn(() => xhr.onabort?.()),
            upload: { onprogress: null as ((event: object) => void) | null },
            onabort: null as (() => void) | null,
            onerror: null,
            onload: null,
            ontimeout: null,
        };
        vi.stubGlobal(
            'XMLHttpRequest',
            vi.fn(function () {
                return xhr;
            }),
        );
        const abort = new AbortController();
        const progress = vi.fn();
        const promise = uploadConversionFile(
            session,
            'operation',
            {
                id: 'a',
                clientId: 'client-a',
                file: new File(['abc'], 'same.png'),
            },
            abort.signal,
            progress,
        );
        expect(xhr.open).toHaveBeenCalledWith(
            'PUT',
            '/api/sessions/session/conversions/operation/files/a',
        );
        expect(xhr.setRequestHeader).toHaveBeenCalledWith(
            'Authorization',
            'Bearer token',
        );
        expect(
            Array.from((xhr.send.mock.calls[0][0] as FormData).keys()),
        ).toEqual(['file']);
        xhr.upload.onprogress?.({
            loaded: 9,
            total: 12,
            lengthComputable: true,
        });
        xhr.upload.onprogress?.({
            loaded: 10,
            total: 0,
            lengthComputable: false,
        });
        expect(progress.mock.calls).toEqual([
            [9, 12],
            [10, undefined],
        ]);
        abort.abort();
        await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
        expect(xhr.upload.onprogress).toBeNull();
        expect(xhr.onload).toBeNull();
    });
});

it('keeps authoritative revisions, identity and transport progress distinct', () => {
    const current = snapshot([completed()], { revision: 5 });
    expect(mergeSnapshot(current, snapshot(), session.sessionId)).toBe(current);
    expect(
        mergeSnapshot(
            current,
            snapshot([completed()], { id: 'other', revision: 9 }),
            session.sessionId,
        ),
    ).toBe(current);
    expect(mergeSnapshot(null, snapshot(), 'other-session')).toBeNull();
    const attempts = {
        a: { attempt: 2, status: 'sending' as const, loaded: 2 },
    };
    expect(batchUploadProgress(attempts)).toEqual({
        loaded: 2,
        total: undefined,
    });
    expect(fileDisplayState(completed(), attempts.a)).toBe('completed');
    expect(
        fileDisplayState(awaiting(), { ...attempts.a, status: 'aborted' }),
    ).toContain('server outcome pending');
});
it('parses Retry-After dates and seconds', () => {
    expect(retryAfter('3')).toBe(3000);
    expect(
        retryAfter(
            'Wed, 16 Sep 2026 00:00:03 GMT',
            Date.parse('2026-09-16T00:00:00Z'),
        ),
    ).toBe(3000);
});
it('ignores page-exit errors and authenticates keepalive', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetch);
    cancelOnPageExit(session, 'operation');
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledWith(
        '/api/sessions/session/conversions/operation/cancel',
        expect.objectContaining({
            keepalive: true,
            headers: { Authorization: 'Bearer token' },
        }),
    );
});
it('creation parses direct shared snapshots and sends stable intent', async () => {
    const fetch = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify(snapshot())));
    vi.stubGlobal('fetch', fetch);
    const intent = {
        requestId: 'request',
        files: [{ clientId: 'client-a', name: 'same.png', sizeBytes: 3 }],
        options: { outputMime: 'image/webp' as const },
    };
    expect(
        await createConversion(session, intent, new AbortController().signal),
    ).toEqual(snapshot());
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(intent);
});
it('downloads server output without local files and revokes object URLs', async () => {
    const file = completed();
    if (file.status !== 'completed') throw Error();
    const fetch = vi.fn().mockResolvedValue(new Response('bytes'));
    vi.stubGlobal('fetch', fetch);
    URL.createObjectURL = vi.fn().mockReturnValue('blob:test');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
        () => undefined,
    );
    await downloadConversion(
        session,
        file.output,
        new AbortController().signal,
    );
    expect(fetch).toHaveBeenCalledWith(
        '/api/sessions/session/files/a',
        expect.objectContaining({ headers: { Authorization: 'Bearer token' } }),
    );
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test');
});
it('bounds polling backoff and resets it after recovery', async () => {
    vi.useFakeTimers();
    const read = vi.fn().mockRejectedValue(new Error('offline'));
    const stop = startConversionPolling({
        read,
        snapshot,
        accept: vi.fn(),
        connectivity: vi.fn(),
        expired: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(read).toHaveBeenCalledTimes(1);
    for (const [index, delay] of [2000, 4000, 8000, 15000, 15000].entries()) {
        await vi.advanceTimersByTimeAsync(delay - 1);
        expect(read).toHaveBeenCalledTimes(index + 1);
        await vi.advanceTimersByTimeAsync(1);
        expect(read).toHaveBeenCalledTimes(index + 2);
    }
    read.mockResolvedValue(snapshot());
    await vi.advanceTimersByTimeAsync(15000);
    expect(read).toHaveBeenCalledTimes(7);
    await vi.advanceTimersByTimeAsync(1000);
    expect(read).toHaveBeenCalledTimes(8);
    stop();
});
