export type SessionImageConfig = {
    ttlMinutes: number;
    maxFiles: number;
    maxTotalBytes: number;
    maxBytesPerFile: number;
}

export const SESSION_IMAGE_CONFIG: SessionImageConfig = {
    ttlMinutes: Number((typeof process !== "undefined" ? process?.env?.SESSION_TTL_MINUTES : undefined) ?? 15),
    maxFiles: Number((typeof process !== "undefined" ? process?.env?.SESSION_MAX_FILES : undefined) ?? 20),
    maxBytesPerFile: Number((typeof process !== "undefined" ? process?.env?.SESSION_PER_FILE_BYTES : undefined) ?? 20_000_000), // 20MB per file
    maxTotalBytes: Number((typeof process !== "undefined" ? process?.env?.SESSION_MAX_TOTAL_BYTES : undefined) ?? 500_000_000), // 500MB total
}
