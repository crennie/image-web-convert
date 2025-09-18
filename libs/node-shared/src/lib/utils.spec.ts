import crypto from 'node:crypto';
import path from 'node:path';
import { secureId, normalizeAbsolutePath } from './utils';
import { MockInstance } from 'vitest';

describe('secureId', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns a hex string by default (16 bytes -> 32 hex chars)', () => {
        const id = secureId(); // defaults: 16, 'hex'
        expect(typeof id).toBe('string');
        expect(id).toMatch(/^[0-9a-f]+$/);
        expect(id.length).toBe(32); // 16 bytes * 2 hex chars
    });

    it('respects the requested number of bytes in hex output', () => {
        const bytes = 32;
        const id = secureId(bytes, 'hex');
        expect(id).toMatch(/^[0-9a-f]+$/);
        expect(id.length).toBe(bytes * 2);
    });

    it('produces URL-safe base64url (no "+", "/", "=") and expected length', () => {
        const bytes = 16;
        const id = secureId(bytes, 'base64url');
        expect(id).toMatch(/^[A-Za-z0-9\-_]+$/);
        // Base64url without padding -> length is ceil(bytes * 4 / 3)
        const expectedLen = Math.ceil((bytes * 4) / 3);
        expect(id.length).toBe(expectedLen);
        expect(id.includes('+')).toBe(false);
        expect(id.includes('/')).toBe(false);
        expect(id.includes('=')).toBe(false);
    });

    it('delegates to crypto.randomBytes with the requested size', () => {
        const spy = vi.spyOn(crypto, 'randomBytes');
        const bytes = 24;
        secureId(bytes, 'hex');
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith(bytes);
    });

    it('encodes exactly using Buffer#toString for both hex and base64url', () => {
        // Return a deterministic buffer so we can assert exact output.
        // 0x00, 0x01, 0xff
        const buf = Buffer.from([0x00, 0x01, 0xff]);
        (vi.spyOn(crypto, 'randomBytes') as MockInstance).mockReturnValue(buf);

        const hex = secureId(3, 'hex');
        const b64 = secureId(3, 'base64url');

        expect(hex).toBe(buf.toString('hex'));
        expect(b64).toBe(buf.toString('base64url'));
    });

    it('throws on non-positive or non-integer byte counts', () => {
        // zero
        expect(() => secureId(0, 'hex')).toThrow(/bytes.*positive integer/i);
        // negative
        expect(() => secureId(-1, 'hex')).toThrow(/bytes.*positive integer/i);
        // float
        expect(() => secureId(1.5, 'hex')).toThrow(/bytes.*positive integer/i);
        // NaN
        expect(() => secureId(Number.NaN, 'hex')).toThrow(/bytes.*positive integer/i);
    });
});

describe('normalizeAbsolutePath', () => {
    it('returns the input unchanged when it is already absolute', () => {
        // Cross-platform absolute example
        const abs = path.resolve(path.sep, 'var', 'data', 'file.txt');
        expect(path.isAbsolute(abs)).toBe(true);
        expect(normalizeAbsolutePath(abs)).toBe(abs);
    });

    it('resolves a relative path against process.cwd()', () => {
        const rel = path.join('some', 'nested', 'file.txt');
        const expected = path.resolve(process.cwd(), rel);
        expect(normalizeAbsolutePath(rel)).toBe(expected);
    });

    it('treats an empty string as the current working directory', () => {
        const expected = path.resolve(process.cwd(), '');
        expect(normalizeAbsolutePath('')).toBe(expected);
    });
});
