// Test-only executable. All HTTP/storage/encoding behavior is production code;
// IPC gates only when an encoder invocation may proceed. Never shipped by api:build.
// eslint-disable-next-line @nx/enforce-module-boundaries
import { createApp } from '../../../api/src/app';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { createConversionRuntime } from '../../../api/src/services/conversion-runtime.service';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { processImageToMimeType } from '../../../api/src/services/image.service';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { recoverConversionRequestStaging } from '../../../api/src/controllers/conversion-upload.http';

let calls = 0;
let gate: { at: number; release(): void; wait: Promise<void> } | undefined;
process.on(
    'message',
    (message: { command: string; after?: number; id: number }) => {
        if (message.command === 'hold') {
            if (gate) throw new Error('A conversion gate is already armed');
            let release!: () => void;
            const wait = new Promise<void>((resolve) => {
                release = resolve;
            });
            gate = { at: calls + (message.after ?? 1), release, wait };
        } else if (message.command === 'release') {
            gate?.release();
            gate = undefined;
        }
        process.send?.({ id: message.id });
    },
);
const runtime = createConversionRuntime({
    convert: async (input) => {
        calls++;
        if (gate?.at === calls) {
            process.send?.({ event: 'held' });
            await gate.wait;
        }
        return processImageToMimeType(input);
    },
});
const incoming = process.env.UPLOAD_TMP_DIR;
if (!incoming) throw new Error('Test upload directory is required');
await recoverConversionRequestStaging(incoming);
await runtime.start();
const app = await createApp({ conversions: runtime });
app.locals.setReady(true);
const server = app.listen(Number(process.env.PORT), '127.0.0.1');
let stopping = false;
async function stop() {
    if (stopping) return;
    stopping = true;
    gate?.release();
    const closed = new Promise<void>((resolve) =>
        server.close(() => resolve()),
    );
    const result = await runtime.stop();
    await closed;
    process.exit(result.drained ? 0 : 1);
}
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
