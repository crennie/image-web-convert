import { z } from 'zod';

export const ALLOWED_IMAGE_MIME_CONST = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/avif',
    'image/heic',
    'image/heif',
    'image/heif-sequence',
    'image/tiff',
] as const;
export const ImageMimeTypeSchema = z.enum(ALLOWED_IMAGE_MIME_CONST);
export type ImageMimeType = z.infer<typeof ImageMimeTypeSchema>;
export const ALLOWED_IMAGE_MIME = new Set<string>(ALLOWED_IMAGE_MIME_CONST);

export const ALLOWED_OUTPUT_MIME_CONST = [
    'image/webp',
    'image/jpeg',
    'image/png',
    'image/avif',
] as const;
export const OutputMimeTypeSchema = z.enum(ALLOWED_OUTPUT_MIME_CONST);
export type OutputMimeType = z.infer<typeof OutputMimeTypeSchema>;
export const ALLOWED_OUTPUT_MIME = new Set<string>(ALLOWED_OUTPUT_MIME_CONST);
// Guard function for parsing from requests
export function isOutputMimeType(x: string): x is OutputMimeType {
    return OutputMimeTypeSchema.safeParse(x).success;
}

export const MIME_TO_EXT: Record<
    (
        | typeof ALLOWED_IMAGE_MIME_CONST
        | typeof ALLOWED_OUTPUT_MIME_CONST
    )[number],
    readonly string[]
> = {
    'image/jpeg': ['jpg', 'jpeg', 'jfif'],
    'image/png': ['png'],
    'image/webp': ['webp'],
    'image/gif': ['gif'],
    'image/avif': ['avif'],
    'image/heic': ['heic', 'heics'],
    'image/heif': ['heif', 'heifs'],
    'image/heif-sequence': ['heifs', 'heics'],
    'image/tiff': ['tif', 'tiff'],
};

export const ALLOWED_IMAGE_EXT = Array.from(
    new Set(
        Object.values(MIME_TO_EXT)
            .flat()
            .map((e) => e.toLowerCase()),
    ),
) as readonly string[];

export const INPUT_ACCEPT_ATTR = Array.from(
    new Set([...ALLOWED_IMAGE_MIME_CONST, ...ALLOWED_IMAGE_EXT]),
).join(',');

export const getFileExt = (name: string) => {
    const i = name.lastIndexOf('.');
    return i >= 0 ? name.slice(i).toLowerCase() : '';
};
