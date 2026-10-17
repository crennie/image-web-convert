import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import sharp from 'sharp';
import { processImageToMimeType } from '../src/services/image.service';

const name = process.env.IMAGE_BUDGET_CASE;
if (!['heic-12mp', 'png-20mp'].includes(name)) {
    throw new Error('Expected heic-12mp or png-20mp');
}

const root = path.resolve('apps/api/tmp');
await fs.mkdir(root, { recursive: true });
const directory = await fs.mkdtemp(path.join(root, 'image-budget-'));
try {
    const inputPath = path.join(directory, 'input');
    if (name === 'heic-12mp') {
        await fs.copyFile('apps/api/test_data/photo.heic', inputPath);
    } else {
        await sharp({
            create: {
                width: 5000,
                height: 4000,
                channels: 3,
                background: '#336699',
            },
        })
            .png()
            .toFile(inputPath);
    }
    const initialRssMiB = Math.round(process.memoryUsage().rss / 1024 / 1024);
    const start = performance.now();
    const result = await processImageToMimeType({
        inputPath,
        outputMime: 'image/webp',
        options: { maxDimension: 1024, limitInputPixels: 20_000_000 },
    });
    console.log(
        JSON.stringify({
            name,
            input: result.inputMeta,
            output: result.info,
            elapsedMs: Math.round(performance.now() - start),
            initialRssMiB,
            peakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024),
        }),
    );
} finally {
    await fs.rm(directory, { recursive: true, force: true });
}
