import { ConversionTransitionError } from './conversions.service';

// Shared by legacy conversion and operation creation during migration. One local process.
const claims = new Set<string>();
export function claimSessionWork(sid: string): () => void {
    if (claims.has(sid))
        throw new ConversionTransitionError(
            'upload_in_progress',
            'Session work is already in progress',
        );
    claims.add(sid);
    return () => {
        claims.delete(sid);
    };
}
