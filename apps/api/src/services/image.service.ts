import sharp from 'sharp';
import fs from 'node:fs/promises';
import { fileTypeFromFile } from 'file-type';
import { DEFAULT_IMG_OPTS, type ImageProcessingOptions } from './image.config';
import convert from 'heic-convert';
import { ALLOWED_IMAGE_MIME, OutputMimeType } from '@image-web-convert/schemas';

// file path or in-memory buffer when adding intermediary conversions (e.g. heic-convert)
type SharpSource = string | ArrayBuffer;

export type ProcessInput = {
    inputPath: string; // absolute path to temp file
    outputMime: OutputMimeType;
    options?: Partial<ImageProcessingOptions>;
};

export type ProcessOutput = {
    buffer: Buffer;
    // outputMime: 'image/webp';
    outputMime: OutputMimeType,
    info: {
        width: number;
        height: number;
        sizeBytes: number;
        colorSpace: 'srgb';
        animated: boolean; // true if input reported multi-page and we decided to keep animation (Phase 1: always false, either first frame or rejected)
        exifStripped: true;
    };
    inputMeta: {
        mime?: string;
        width?: number;
        height?: number;
        hasAlpha?: boolean;
        pages?: number;
    };
};

/**
 * Process a temp image file to given output format with PII-stripping and sRGB normalization.
 * Notes:
 * - Sharp omits metadata by default (don’t call withMetadata()).
 * - Default policy keeps only the first frame for animated inputs.
 * - Container images (.e.g HEIC family) only have the first image processed
 */
export async function processImageToMimeType({
    inputPath,
    outputMime,
    options,
}: ProcessInput): Promise<ProcessOutput> {
    const opts: ImageProcessingOptions = { ...DEFAULT_IMG_OPTS, ...options };

    // 1) Magic-byte sniff
    const ft = await fileTypeFromFile(inputPath).catch(() => undefined);
    const sniffedMime = ft?.mime;
    if (!sniffedMime || !ALLOWED_IMAGE_MIME.has(sniffedMime)) {
        throw new Error(
            `Unsupported or unrecognized image type${sniffedMime ? `: ${sniffedMime}` : ''}`
        );
    }

    // 2) Convert HEIC to sharp-processable format
    let sharpInput: SharpSource = inputPath;
    if (ft.mime.includes('/heic') || ft.mime.includes('/heif')) {
        const buf = await fs.readFile(inputPath);
        // Convert buffer to UIntarray for heic convert
        try {
            //
            const buffer = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) as unknown as ArrayBufferLike;
            sharpInput = await convert({ buffer, format: 'JPEG', quality: 0.9 });
        } catch (err) {
            // TODO: Add error logging in services
            //req.log.error({ err });
        }
    }

    // 3) Load + read metadata safely
    const baseSharp = sharp(sharpInput, {
        // Phase 1: we do NOT preserve full animation; first frame only
        animated: false,
        limitInputPixels: opts.limitInputPixels,
        failOn: 'error',
    });

    const meta = await baseSharp.metadata();
    const pages = meta.pages ?? 1;
    if (pages > 1 && opts.animatedPolicy === 'reject') {
        throw new Error('Animated images are not supported in this mode');
    }

    // 4) Build transform: orient -> sRGB -> resize if too large -> webp
    let pipeline = sharp(sharpInput, { animated: false, limitInputPixels: opts.limitInputPixels })
        .rotate() // apply EXIF orientation, then EXIF is dropped
        .toColourspace(opts.normalizeColorSpace);

    if (opts.maxDimension > 0) {
        pipeline = pipeline.resize({
            width: opts.maxDimension,
            height: opts.maxDimension,
            fit: 'inside',
            withoutEnlargement: true,
            fastShrinkOnLoad: true,
        });
    }

    // Run conversion utility based on target output mime type

    // TODO: Add default (or configurable) conversion settings for each type
    // Different web conversions use different ranges, e.g. avif effort is 0-9, while png effort is 1-10
    if (outputMime === 'image/webp') {
        pipeline = pipeline.webp({
            quality: opts.quality,
            effort: opts.effort,
            // alphaQuality defaults okay; can tweak if lots of transparent assets
        });
    } else if (outputMime === 'image/avif') {
        pipeline = pipeline.avif({
            quality: opts.quality,
            effort: opts.effort,
        });
    } else if (outputMime === 'image/jpeg') {
        pipeline = pipeline.jpeg({
            quality: opts.quality,
        });
    } else if (outputMime === 'image/png') {
        pipeline = pipeline.png({
            quality: opts.quality,
            effort: opts.effort,
        });
    }

    // 5) Encode
    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });

    return {
        buffer: data,
        outputMime,
        info: {
            width: info.width,
            height: info.height,
            sizeBytes: data.byteLength,
            colorSpace: 'srgb',
            animated: false,
            exifStripped: true,
        },
        inputMeta: {
            mime: sniffedMime,
            width: meta.width,
            height: meta.height,
            hasAlpha: meta.hasAlpha,
            pages,
        },
    };
}
