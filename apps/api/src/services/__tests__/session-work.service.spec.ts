import { claimSessionWork } from '../session-work.service';

it('keeps claims independent and prevents stale release from clearing a new owner', () => {
    const first = claimSessionWork('first');
    const other = claimSessionWork('other');
    let replacement: (() => void) | undefined;
    let unexpected: (() => void) | undefined;
    try {
        expect(() => claimSessionWork('first')).toThrow('already in progress');
        first();
        replacement = claimSessionWork('first');
        first();
        expect(() => {
            unexpected = claimSessionWork('first');
        }).toThrow('already in progress');
        expect(() => claimSessionWork('other')).toThrow('already in progress');
    } finally {
        unexpected?.();
        replacement?.();
        first();
        other();
    }
    const retry = claimSessionWork('first');
    retry();
});
