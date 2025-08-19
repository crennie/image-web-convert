import { z } from 'zod';

export const ImageFormat = z.enum([
    'jpeg',
    'png',
    'webp',
    'avif',
    'gif',
    'tiff',
    'heif',
]);
export type ImageFormat = z.infer<typeof ImageFormat>;

export const ColorSpace = z.enum(['srgb', 'display-p3', 'adobe-rgb']);
export type ColorSpace = z.infer<typeof ColorSpace>;

export const Fit = z.enum(['cover', 'contain', 'fill', 'inside', 'outside']);
export type Fit = z.infer<typeof Fit>;

export const ResizeStrategy = z.enum([
    'lanczos3',
    'lanczos2',
    'cubic',
    'nearest',
]);
export type ResizeStrategy = z.infer<typeof ResizeStrategy>;

export const Uuid = z.uuid();
export type Uuid = z.infer<typeof Uuid>;

// Helpers
export const Quality = z.number().int().min(0).max(100);
