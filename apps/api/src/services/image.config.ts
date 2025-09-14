export type AnimatedPolicy = 'first-frame' | 'reject';
export type ColourSpace = 'srgb'; // Supported colourspace conversions e.g. srgb, rgb, cmyk, lab, b-w ...

export interface ImageProcessingOptions {
    outputFormat: 'webp';
    quality: number;           // WebP quality (0–100)
    effort: number;            // WebP encoder effort (0–6)
    maxDimension: number;      // cap long edge (px); 0 disables
    normalizeColorSpace: ColourSpace;
    stripMetadata: true;       // Sharp omits metadata by default; keep true
    animatedPolicy: AnimatedPolicy;
    limitInputPixels: number;  // safety guard vs decompression bombs
};

// Defaults (tweak as needed)
export const DEFAULT_IMG_OPTS: ImageProcessingOptions = {
    outputFormat: 'webp',
    quality: 85,
    effort: 6,
    maxDimension: 8192,
    normalizeColorSpace: 'srgb',
    stripMetadata: true,
    animatedPolicy: 'first-frame',
    limitInputPixels: 200_000_000, // ~200MP
};
