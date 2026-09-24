import { ConversionTransitionError } from './conversions.service';

// Application-level exclusion for operation creation and retained legacy batches.
// Process-local only; different sessions are independent. File-slot transports
// use runtime admission instead, so siblings can upload concurrently.
const claims = new Set<string>();
export function claimSessionWork(sid: string): () => void {
    if (claims.has(sid))
        throw new ConversionTransitionError(
            'upload_in_progress',
            'Session work is already in progress',
        );
    claims.add(sid);
    let released = false;
    return () => {
        if (released) return;
        released = true;
        claims.delete(sid);
    };
}
