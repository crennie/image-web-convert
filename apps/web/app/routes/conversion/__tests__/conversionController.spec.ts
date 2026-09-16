import { ConversionController } from '../conversionController';
import * as api from '../api/conversionApi';
import {
    awaiting,
    completed,
    deferred,
    session,
    snapshot,
    time,
} from './conversionFixtures';
import type { ApiConversionOperation } from '@image-web-convert/schemas';

const local = (id = 'a') => ({
    id: `client-${id}`,
    file: new File(['abc'], 'same.png'),
});
function setup() {
    const services = {
        ...api,
        createConversion: vi.fn().mockResolvedValue(snapshot()),
        getConversion: vi.fn().mockResolvedValue(snapshot()),
        cancelConversion: vi.fn().mockResolvedValue(snapshot()),
        cancelOnPageExit: vi.fn(),
        downloadConversion: vi.fn().mockResolvedValue(undefined),
        uploadConversionFile: vi
            .fn()
            .mockRejectedValue(new Error('lost acknowledgement')),
    };
    const controller = new ConversionController(services);
    const disconnect = controller.connect();
    return { services, controller, disconnect };
}
afterEach(() => vi.useRealTimers());
it('retries creation with the same session, frozen intent and request ID', async () => {
    const { controller, services, disconnect } = setup();
    services.createConversion.mockRejectedValueOnce(new Error('offline'));
    const startSession = vi.fn().mockResolvedValue(session);
    await controller.submit([local()], 'image/webp', startSession);
    await controller.submit([local('different')], 'image/png', startSession);
    expect(startSession).toHaveBeenCalledOnce();
    expect(services.createConversion.mock.calls[0].slice(0, 2)).toEqual(
        services.createConversion.mock.calls[1].slice(0, 2),
    );
    expect(controller.getSnapshot().operation?.id).toBe('operation');
    disconnect();
});
it('correlates duplicate names by client ID, reconciles acceptance before retrying bytes', async () => {
    const { controller, services, disconnect } = setup();
    services.createConversion.mockResolvedValue(
        snapshot([awaiting('a'), awaiting('b')]),
    );
    await controller.submit(
        [local('a'), local('b')],
        'image/webp',
        async () => session,
    );
    await vi.waitFor(() =>
        expect(controller.getSnapshot().uploads['client-a']?.status).toBe(
            'error',
        ),
    );
    expect(
        services.uploadConversionFile.mock.calls.map((call) => call[2].id),
    ).toEqual(['a', 'b']);
    services.getConversion.mockResolvedValue(
        snapshot([completed('a'), awaiting('b')], { revision: 3 }),
    );
    await controller.retryUpload('client-a');
    expect(services.uploadConversionFile).toHaveBeenCalledTimes(2);
    await controller.retryUpload('client-b');
    expect(services.uploadConversionFile).toHaveBeenCalledTimes(3);
    expect(controller.getSnapshot().uploads['client-b'].attempt).toBe(2);
    disconnect();
});
it('does not upload after failed reconciliation and preserves its retry action', async () => {
    const { controller, services, disconnect } = setup();
    await controller.submit([local()], 'image/webp', async () => session);
    await vi.waitFor(() =>
        expect(controller.getSnapshot().uploads['client-a']?.status).toBe(
            'error',
        ),
    );
    services.getConversion.mockRejectedValue(new Error('offline'));
    await controller.retryUpload('client-a');
    expect(controller.getSnapshot().uploads['client-a'].status).toBe('error');
    expect(services.uploadConversionFile).toHaveBeenCalledOnce();
    disconnect();
});
it('keeps cancellation as a command, retries unknown outcomes, preserves completed results', async () => {
    vi.useFakeTimers();
    const { controller, services, disconnect } = setup();
    const pending = deferred<ApiConversionOperation>();
    services.cancelConversion.mockReturnValueOnce(pending.promise);
    await controller.submit([local()], 'image/webp', async () => session);
    const cancel = controller.cancel();
    expect(controller.getSnapshot().cancelling).toBe(true);
    expect(controller.getSnapshot().operation?.status).toBe('awaiting_uploads');
    pending.reject(new Error('offline'));
    await cancel;
    expect(controller.getSnapshot().errors.cancellation).toBeDefined();
    services.cancelConversion.mockResolvedValue(
        snapshot(undefined, {
            revision: 2,
            cancelRequestedAt: time,
            stopRequestedAt: time,
            stopReason: 'user_cancelled',
        }),
    );
    await controller.cancel();
    expect(controller.getSnapshot().operation?.status).toBe('awaiting_uploads');
    services.getConversion.mockResolvedValue(
        snapshot([completed()], {
            revision: 3,
            status: 'cancelled',
            cancelRequestedAt: time,
            stopRequestedAt: time,
            stopReason: 'user_cancelled',
        }),
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(controller.getSnapshot().operation?.counts.completed).toBe(1);
    expect(controller.getSnapshot().operation?.status).toBe('cancelled');
    disconnect();
});
it('ignores creation from a disconnected batch and never cancels during cleanup', async () => {
    const { controller, services, disconnect } = setup();
    const pending = deferred<ApiConversionOperation>();
    services.createConversion.mockReturnValue(pending.promise);
    const submit = controller.submit(
        [local()],
        'image/webp',
        async () => session,
    );
    await Promise.resolve();
    disconnect();
    pending.resolve(snapshot());
    await submit;
    expect(controller.getSnapshot().operation).toBeNull();
    expect(services.uploadConversionFile).not.toHaveBeenCalled();
    expect(services.cancelConversion).not.toHaveBeenCalled();
    expect(services.cancelOnPageExit).not.toHaveBeenCalled();
});
it('rejects older upload and cancel revisions after a newer polling snapshot', async () => {
    vi.useFakeTimers();
    const { controller, services, disconnect } = setup();
    const upload = deferred<ApiConversionOperation>();
    services.uploadConversionFile.mockReturnValue(upload.promise);
    await controller.submit([local()], 'image/webp', async () => session);
    services.getConversion.mockResolvedValue(
        snapshot([completed()], { revision: 5 }),
    );
    const cancel = deferred<ApiConversionOperation>();
    services.cancelConversion.mockReturnValue(cancel.promise);
    const cancelling = controller.cancel();
    await vi.advanceTimersByTimeAsync(1000);
    upload.resolve(snapshot());
    cancel.resolve(snapshot(undefined, { revision: 2 }));
    await cancelling;
    expect(controller.getSnapshot().operation?.revision).toBe(5);
    disconnect();
});
it('only page exit cancels active operations; terminal exit does nothing', async () => {
    const { controller, services, disconnect } = setup();
    await controller.submit([local()], 'image/webp', async () => session);
    controller.pageExit();
    expect(services.cancelOnPageExit).toHaveBeenCalledOnce();
    disconnect();
    const terminal = setup();
    terminal.services.createConversion.mockResolvedValue(
        snapshot([completed()]),
    );
    await terminal.controller.submit(
        [local()],
        'image/webp',
        async () => session,
    );
    terminal.controller.pageExit();
    expect(terminal.services.cancelOnPageExit).not.toHaveBeenCalled();
    terminal.disconnect();
});
it('distinguishes session transport failure and manifest rejection', async () => {
    const { controller, services, disconnect } = setup();
    await controller.submit([local()], 'image/webp', async () => {
        throw Error('offline');
    });
    expect(controller.getSnapshot().errors.session).toBeDefined();
    expect(services.createConversion).not.toHaveBeenCalled();
    services.createConversion.mockRejectedValue(
        new api.ConversionTransportError(413),
    );
    await controller.submit([local()], 'image/webp', async () => session);
    expect(controller.getSnapshot().errors.session).toBeUndefined();
    expect(controller.getSnapshot().creationRejected).toBe(true);
    disconnect();
});
it('expires a lost creation acknowledgement and ignores its eventual response', async () => {
    vi.useFakeTimers();
    const { controller, services, disconnect } = setup();
    const pending = deferred<ApiConversionOperation>();
    services.createConversion.mockReturnValue(pending.promise);
    const submit = controller.submit([local()], 'image/webp', async () => ({
        ...session,
        expiresAt: new Date(Date.now() + 2000).toISOString(),
    }));
    await vi.advanceTimersByTimeAsync(2000);
    expect(controller.getSnapshot().errors.access).toBeDefined();
    expect(controller.getSnapshot().creating).toBe(false);
    pending.resolve(snapshot());
    await submit;
    expect(controller.getSnapshot().operation).toBeNull();
    disconnect();
});
it.each([
    'upload',
    'polling',
    'cancellation',
    'reconciliation',
    'download',
] as const)(
    'discards late %s results after the batch disconnects',
    async (source) => {
        vi.useFakeTimers();
        const { controller, services, disconnect } = setup();
        const pending = deferred<ApiConversionOperation>();
        if (source === 'upload')
            services.uploadConversionFile.mockReturnValue(pending.promise);
        await controller.submit([local()], 'image/webp', async () => session);
        await vi.advanceTimersByTimeAsync(0);
        let command: Promise<void> | undefined;
        if (source === 'polling') {
            services.getConversion.mockReturnValue(pending.promise);
            await vi.advanceTimersByTimeAsync(1000);
        }
        if (source === 'cancellation') {
            services.cancelConversion.mockReturnValue(pending.promise);
            command = controller.cancel();
        }
        if (source === 'reconciliation') {
            services.getConversion.mockReturnValue(pending.promise);
            command = controller.retryUpload('client-a');
        }
        if (source === 'download') {
            services.downloadConversion.mockImplementation(() =>
                pending.promise.then(() => undefined),
            );
            command = controller.download(['a']);
        }
        disconnect();
        const before = controller.getSnapshot();
        pending.resolve(snapshot([completed()], { revision: 99 }));
        await command;
        await vi.advanceTimersByTimeAsync(0);
        expect(controller.getSnapshot()).toBe(before);
        expect(services.cancelOnPageExit).not.toHaveBeenCalled();
    },
);
it('clears cancellation uncertainty when polling confirms it, even if the command later fails', async () => {
    vi.useFakeTimers();
    const { controller, services, disconnect } = setup();
    await controller.submit([local()], 'image/webp', async () => session);
    services.cancelConversion.mockRejectedValueOnce(new Error('offline'));
    await controller.cancel();
    expect(controller.getSnapshot().errors.cancellation).toBeDefined();
    const pending = deferred<ApiConversionOperation>();
    services.cancelConversion.mockReturnValue(pending.promise);
    const cancel = controller.cancel();
    services.getConversion.mockResolvedValue(
        snapshot([completed()], {
            revision: 3,
            status: 'cancelled',
            cancelRequestedAt: time,
            stopRequestedAt: time,
            stopReason: 'user_cancelled',
        }),
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(controller.getSnapshot().errors.cancellation).toBeUndefined();
    pending.reject(new Error('late connection error'));
    await cancel;
    expect(controller.getSnapshot().errors.cancellation).toBeUndefined();
    disconnect();
});
