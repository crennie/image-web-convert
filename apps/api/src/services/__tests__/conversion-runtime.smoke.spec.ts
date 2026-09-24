import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import sharp from 'sharp';
import { getConversionRuntimeConfig } from '../../env';
import { conversionStoragePaths, sessionInfoPath } from '../storage.paths';
import { createConversionRuntime } from '../conversion-runtime.service';
import { createConversionStorage } from '../conversion-storage.service';
import { processImageToMimeType } from '../image.service';

it('automatically converts real PNG, HEIC and AVIF outputs with bounded dimensions', async () => {
    await fs.mkdir(path.resolve('tmp'), { recursive: true });
    const root = await fs.mkdtemp(path.resolve('tmp/conversion-smoke-'));
    const store = createConversionStorage({ root });
    const measurements: object[] = [];
    const runtime = createConversionRuntime({
        root,
        store,
        config: { ...getConversionRuntimeConfig({}), maxDimension: 256 },
        convert: async (input) => {
            const start = performance.now();
            let previous = start;
            let maxGap = 0;
            let ticks = 0;
            const timer = setInterval(() => {
                const now = performance.now();
                maxGap = Math.max(maxGap, now - previous);
                previous = now;
                ticks++;
            }, 10);
            try {
                const result = await processImageToMimeType(input);
                maxGap = Math.max(maxGap, performance.now() - previous);
                measurements.push({
                    input: result.inputMeta.mime,
                    output: result.outputMime,
                    elapsedMs: Math.round(performance.now() - start),
                    maxTimerGapMs: Math.round(maxGap),
                    ticks,
                });
                return result;
            } finally {
                clearInterval(timer);
            }
        },
    });
    try {
        const png = await sharp({
            create: {
                width: 1024,
                height: 768,
                channels: 3,
                background: { r: 30, g: 90, b: 180 },
            },
        })
            .png()
            .toBuffer();
        const heic = await fs.readFile(path.resolve('test_data/photo.heic'));
        await runtime.start();
        const cases = [
            { name: 'png', bytes: png, outputMime: 'image/webp' },
            { name: 'heic', bytes: heic, outputMime: 'image/webp' },
            { name: 'avif', bytes: png, outputMime: 'image/avif' },
        ] as const;
        for (const item of cases) {
            const sid = `smoke-${item.name}`;
            await fs.mkdir(path.join(root, sid), { recursive: true });
            await fs.writeFile(
                sessionInfoPath(sid, root),
                JSON.stringify({
                    id: sid,
                    expiresAt: new Date(Date.now() + 900000).toISOString(),
                    sealedAt: null,
                    counts: { files: 0, totalBytes: 0 },
                }),
            );
            const { operation } = await runtime.createOperation(sid, {
                requestId: sid,
                options: { outputMime: item.outputMime },
                files: [
                    {
                        clientId: item.name,
                        name: `${item.name}.image`,
                        sizeBytes: item.bytes.length,
                    },
                ],
            });
            const source = path.join(root, `${item.name}.source`);
            await fs.writeFile(source, item.bytes);
            await runtime.acceptUpload(
                sid,
                operation.id,
                operation.files[0].id,
                source,
            );
            await runtime.whenIdle();
            const completed = (await store.read(sid)).operation;
            expect(completed.status).toBe('completed');
            const output = await store.completedOutput(
                sid,
                operation.id,
                operation.files[0].id,
            );
            const metadata = await sharp(
                conversionStoragePaths(sid, root).output(
                    operation.files[0].id,
                    output.meta.output.mime,
                ),
            ).metadata();
            expect(
                Math.max(
                    metadata.width ?? Infinity,
                    metadata.height ?? Infinity,
                ),
            ).toBeLessThanOrEqual(256);
            expect(metadata.format).toBe(
                item.name === 'avif' ? 'heif' : 'webp',
            );
        }
        console.info(
            'Conversion smoke measurements (10 ms timer):',
            measurements,
        );
    } finally {
        await runtime.stop();
        await runtime.whenIdle();
        await fs.rm(root, { recursive: true, force: true });
    }
}, 30000);
