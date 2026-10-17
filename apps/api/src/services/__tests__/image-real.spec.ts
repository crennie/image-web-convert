import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { processImageToMimeType } from '../image.service';

const fixtureDir = path.resolve('tmp');

async function withInput(
    bytes: Buffer,
    run: (inputPath: string) => Promise<void>,
) {
    await fs.mkdir(fixtureDir, { recursive: true });
    const dir = await fs.mkdtemp(path.join(fixtureDir, 'image-real-'));
    const inputPath = path.join(dir, 'input');
    try {
        await fs.writeFile(inputPath, bytes);
        await run(inputPath);
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
}

describe('real image conversion boundaries', () => {
    it('decodes the checked-in HEIC fixture and rejects its truncated form', async () => {
        const heic = await fs.readFile(
            new URL('../../../test_data/photo.heic', import.meta.url),
        );
        await withInput(heic, async (inputPath) => {
            const result = await processImageToMimeType({
                inputPath,
                outputMime: 'image/webp',
            });
            expect(result.inputMeta.mime).toBe('image/heic');
            expect((await sharp(result.buffer).metadata()).format).toBe('webp');
            await expect(
                processImageToMimeType({
                    inputPath,
                    outputMime: 'image/webp',
                    options: { limitInputPixels: 11_999_999 },
                }),
            ).rejects.toThrow();
        });
        await withInput(heic.subarray(0, 32), async (inputPath) => {
            await expect(
                processImageToMimeType({ inputPath, outputMime: 'image/webp' }),
            ).rejects.toThrow('HEIC decoding failed');
        });
    }, 30000);

    it('enforces the pixel ceiling before encoding', async () => {
        const png = await sharp({
            create: {
                width: 5000,
                height: 4000,
                channels: 3,
                background: '#336699',
            },
        })
            .png()
            .toBuffer();
        await withInput(png, async (inputPath) => {
            await expect(
                processImageToMimeType({
                    inputPath,
                    outputMime: 'image/webp',
                    options: { limitInputPixels: 19_999_999 },
                }),
            ).rejects.toThrow();
            const result = await processImageToMimeType({
                inputPath,
                outputMime: 'image/webp',
                options: { limitInputPixels: 20_000_000, maxDimension: 128 },
            });
            expect([result.info.width, result.info.height]).toEqual([128, 102]);
        });
    });

    it('drops source EXIF and applies orientation', async () => {
        const jpeg = await sharp({
            create: {
                width: 6,
                height: 4,
                channels: 3,
                background: '#336699',
            },
        })
            .withExif({ IFD3: { GPSLatitude: '51/1 30/1 0/1' } })
            .withMetadata({ orientation: 6 })
            .jpeg()
            .toBuffer();
        const inputMetadata = await sharp(jpeg).metadata();
        expect(inputMetadata.orientation).toBe(6);
        expect(inputMetadata.exif?.length).toBeGreaterThan(0);
        await withInput(jpeg, async (inputPath) => {
            const result = await processImageToMimeType({
                inputPath,
                outputMime: 'image/webp',
            });
            const metadata = await sharp(result.buffer).metadata();
            expect([metadata.width, metadata.height]).toEqual([4, 6]);
            expect(metadata.exif).toBeUndefined();
            expect(metadata.icc).toBeUndefined();
        });
    });

    it('flattens transparent pixels to white for JPEG', async () => {
        const png = await sharp({
            create: {
                width: 1,
                height: 1,
                channels: 4,
                background: { r: 0, g: 255, b: 0, alpha: 0 },
            },
        })
            .png()
            .toBuffer();
        await withInput(png, async (inputPath) => {
            const result = await processImageToMimeType({
                inputPath,
                outputMime: 'image/jpeg',
            });
            const pixel = await sharp(result.buffer).raw().toBuffer();
            expect([...pixel]).toEqual([255, 255, 255]);
        });
    });

    it('uses the first animated frame or rejects animation by policy', async () => {
        const gif = await sharp({
            create: {
                width: 2,
                height: 4,
                pageHeight: 2,
                channels: 3,
                background: '#ff0000',
            },
        })
            .gif({ delay: [100, 100], keepDuplicateFrames: true })
            .toBuffer();
        expect((await sharp(gif, { animated: true }).metadata()).pages).toBe(2);
        await withInput(gif, async (inputPath) => {
            const first = await processImageToMimeType({
                inputPath,
                outputMime: 'image/png',
            });
            expect(first.inputMeta.pages).toBe(2);
            expect([
                first.info.width,
                first.info.height,
                first.info.animated,
            ]).toEqual([2, 2, false]);
            await expect(
                processImageToMimeType({
                    inputPath,
                    outputMime: 'image/png',
                    options: { animatedPolicy: 'reject' },
                }),
            ).rejects.toThrow('Animated images are not supported');
        });
    });

    it('normalizes profiled input to sRGB and omits the source ICC profile', async () => {
        const png = await sharp({
            create: {
                width: 2,
                height: 2,
                channels: 3,
                background: '#ff0000',
            },
        })
            .withIccProfile('p3')
            .png()
            .toBuffer();
        expect((await sharp(png).metadata()).icc?.length).toBeGreaterThan(0);
        await withInput(png, async (inputPath) => {
            const result = await processImageToMimeType({
                inputPath,
                outputMime: 'image/png',
            });
            const metadata = await sharp(result.buffer).metadata();
            expect(metadata.space).toBe('srgb');
            expect(metadata.icc).toBeUndefined();
        });
    });

    it('rejects unrecognized magic bytes', async () => {
        await withInput(Buffer.from('not an image'), async (inputPath) => {
            await expect(
                processImageToMimeType({ inputPath, outputMime: 'image/png' }),
            ).rejects.toThrow('Unsupported or unrecognized image type');
        });
    });
});
