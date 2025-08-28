import { describe, it, expect } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
    it('adds the class string', () => {
        const out = cn('px-2', 'rounded-md');
        expect(out).toMatch(/\brounded-md\b/);
    });

    it('does not add the same class twice', () => {
        const out = cn('px-2', 'px-2');
        const occurrences = out.match(/\bpx-2\b/g) ?? [];
        expect(occurrences).toHaveLength(1);
    });
});