import type { ApiConversionOperation } from '@image-web-convert/schemas';
import { ConversionTransportError } from './conversionApi';
import { isTerminal } from '../conversionViewModel';

export function startConversionPolling(options: {
    read: (signal: AbortSignal) => Promise<ApiConversionOperation>;
    snapshot: () => ApiConversionOperation;
    accept: (snapshot: ApiConversionOperation) => void;
    connectivity: (error: unknown | null) => void;
    expired: () => void;
}) {
    let stopped = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const remaining = () =>
        Date.parse(options.snapshot().expiresAt) - Date.now();
    const expiry = setTimeout(
        () => {
            stop();
            options.expired();
        },
        Math.max(0, remaining()),
    );
    function stop() {
        stopped = true;
        clearTimeout(timer);
        clearTimeout(expiry);
        controller.abort();
    }
    const tick = async () => {
        if (stopped || isTerminal(options.snapshot())) {
            stop();
            return;
        }
        if (remaining() <= 0) {
            stop();
            options.expired();
            return;
        }
        let delay = 1000;
        try {
            const snapshot = await options.read(controller.signal);
            if (stopped) return;
            options.accept(snapshot);
            options.connectivity(null);
            failures = 0;
        } catch (error) {
            if (stopped) return;
            options.connectivity(error);
            if (
                error instanceof ConversionTransportError &&
                error.accessDenied
            ) {
                stop();
                options.expired();
                return;
            }
            delay = Math.max(
                Math.min(1000 * 2 ** Math.min(++failures, 4), 15_000),
                error instanceof ConversionTransportError
                    ? error.retryAfterMs
                    : 0,
            );
        }
        if (!stopped && !isTerminal(options.snapshot()))
            timer = setTimeout(
                () => void tick(),
                Math.min(delay, Math.max(0, remaining())),
            );
        else stop();
    };
    timer = setTimeout(() => void tick(), 1000);
    return stop;
}
