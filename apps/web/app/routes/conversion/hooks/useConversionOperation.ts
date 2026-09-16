import { useEffect, useState, useSyncExternalStore } from 'react';
import { useSession } from '@image-web-convert/ui';
import type { OutputMimeType } from '@image-web-convert/schemas';
import {
    ConversionController,
    type LocalConversionFile,
} from '../conversionController';

export function useConversionOperation() {
    const { startSession, session } = useSession();
    const [controller] = useState(() => new ConversionController());
    const state = useSyncExternalStore(
        controller.subscribe,
        controller.getSnapshot,
        controller.getSnapshot,
    );
    useEffect(() => controller.connect(), [controller]);
    useEffect(() => {
        window.addEventListener('pagehide', controller.pageExit);
        return () =>
            window.removeEventListener('pagehide', controller.pageExit);
    }, [controller]);
    return {
        state,
        imageConfig: session?.imageConfig,
        submit: (files: LocalConversionFile[], mime: OutputMimeType) =>
            controller.submit(files, mime, startSession),
        retryUpload: (id: string) => controller.retryUpload(id),
        cancel: () => controller.cancel(),
        download: controller.download.bind(controller),
    };
}
