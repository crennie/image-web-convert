import { cn, uiId, displayBytes, displayMinutes, displayDateTime, getAuthHeaders } from './utils';

describe('cn', () => {
    it('merges classes and dedupes conflicts', () => {
        const out = cn('px-2', 'rounded-md', 'px-2');
        expect(out).toMatch(/\brounded-md\b/);
        const occurrences = out.match(/\bpx-2\b/g) ?? [];
        expect(occurrences).toHaveLength(1);
    });
});

describe('uiId', () => {
    const realNow = Date.now;
    let randomSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-01-02T03:04:05.000Z'));
        randomSpy = vi.spyOn(Math, 'random');
        vi.spyOn(Date, 'now').mockReturnValue(1735787045000); // 2025-01-02T03:04:05Z
    });

    afterEach(() => {
        vi.useRealTimers();
        randomSpy.mockRestore();
        Date.now = realNow;
    });

    it('builds an id with expected prefix and base36 parts', () => {
        // random -> 0.123..., base36 = "0.3f..." (slice(2) removes "0.")
        randomSpy.mockReturnValue(0.123456789);
        const id = uiId();
        expect(id.startsWith('id-')).toBe(true);
        // only allow safe base36 chars after the prefix
        expect(id.replace(/^id-/, '')).toMatch(/^[a-z0-9]+$/);
    });

    it('changes when Math.random changes (not a constant id)', () => {
        randomSpy.mockReturnValueOnce(0.1);
        const a = uiId();
        randomSpy.mockReturnValueOnce(0.2);
        const b = uiId();
        expect(a).not.toEqual(b);
    });
});

describe('displayBytes', () => {
    it('formats bytes with appropriate units', () => {
        expect(displayBytes(0)).toBe('0 B');
        expect(displayBytes(1023)).toBe('1023 B');
        expect(displayBytes(1024)).toBe('1.0 KB');
        expect(displayBytes(1536)).toBe('1.5 KB');          // 1.5 KB (one decimal for <10)
        expect(displayBytes(10 * 1024 + 512)).toBe('11 KB'); // >=10 rounds to integer
        expect(displayBytes(1048576)).toBe('1.0 MB');
    });

    it('returns infinity symbol for non-finite input', () => {
        expect(displayBytes(Infinity)).toBe('∞');
        expect(displayBytes(NaN)).toBe('∞');
    });
});

describe('displayMinutes', () => {
    it('pluralizes correctly and floors minutes', () => {
        expect(displayMinutes(0)).toBe('0 minutes');
        expect(displayMinutes(59_999)).toBe('0 minutes');   // floor
        expect(displayMinutes(60_000)).toBe('1 minute');
        expect(displayMinutes(61_000)).toBe('1 minute');    // still 1
        expect(displayMinutes(120_000)).toBe('2 minutes');
    });
});

describe('displayDateTime', () => {
    // We can’t rely on timezone; just assert the general US format and seconds toggle.
    const date = new Date('2025-05-06T15:04:30Z');

    it('renders an en-US date/time without seconds by default', () => {
        const out = displayDateTime(date);
        // Example match: "5/6/2025, 8:04 AM" (time varies by TZ)
        expect(out).toMatch(/^\d{1,2}\/\d{1,2}\/\d{4}, \d{1,2}:\d{2} (AM|PM)$/);
    });

    it('includes seconds when displaySeconds=true', () => {
        const out = displayDateTime(date, { displaySeconds: true });
        // Example match: "5/6/2025, 8:04:30 AM"
        expect(out).toMatch(/^\d{1,2}\/\d{1,2}\/\d{4}, \d{1,2}:\d{2}:\d{2} (AM|PM)$/);
    });
});

describe('getAuthHeaders', () => {
    it('returns a Bearer auth header for a session token', () => {
        const headers = getAuthHeaders({ token: 'abc123', sessionId: 'sid', expiresAt: '00:00' });
        expect(headers).toEqual({ Authorization: 'Bearer abc123' });
    });
});
