import { z } from 'zod';

export const SessionImageConfigSchema = z.object({
    ttlMinutes: z.number().int().positive(),
    maxFiles: z.number().int().positive(),
    maxTotalBytes: z.number().int().positive(),
    maxBytesPerFile: z.number().int().positive(),
});
export type SessionImageConfig = z.infer<typeof SessionImageConfigSchema>;

/** Browser fallback while the effective backend configuration is loading. */
export const DEFAULT_SESSION_IMAGE_CONFIG: SessionImageConfig = {
    ttlMinutes: 15,
    maxFiles: 20,
    maxBytesPerFile: 20_000_000,
    maxTotalBytes: 500_000_000,
};
