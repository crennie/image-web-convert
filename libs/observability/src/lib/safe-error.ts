const filesystemCodes = new Set([
    'EACCES',
    'EBUSY',
    'EIO',
    'EMFILE',
    'ENFILE',
    'ENOENT',
    'ENOSPC',
    'EPERM',
    'EROFS',
]);

/** Preserve a useful I/O classification without logging arbitrary error text or stacks. */
export function safeErrorSummary(error: unknown): {
    kind: 'exception' | 'non_exception';
    code?: string;
} {
    // pino-http wraps and serializes Error before calling its serializer.
    // Treat that object as an exception without reading its message or stack.
    if (
        error !== null &&
        typeof error === 'object' &&
        !(error instanceof Error)
    ) {
        return { kind: 'exception' };
    }
    if (!(error instanceof Error)) return { kind: 'non_exception' };
    const code = (error as NodeJS.ErrnoException).code;
    return typeof code === 'string' && filesystemCodes.has(code)
        ? { kind: 'exception', code }
        : { kind: 'exception' };
}
