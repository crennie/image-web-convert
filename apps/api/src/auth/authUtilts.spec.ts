import crypto from "node:crypto";
import {
    generateAccessToken,
    extractBearerToken,
    hashAccessToken,
    timingSafeEqHex,
} from "./authUtils";
import { secureId } from "@image-web-convert/node-shared";

// Mock the secureId dependency used by generateAccessToken
vi.mock("@image-web-convert/node-shared", () => ({
    secureId: vi.fn(),
}));

const mockedSecureId = vi.mocked(secureId);

describe("authUtils", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("generateAccessToken", () => {
        it("calls secureId(32, 'hex') and returns { token, hash } with sha256(token)", () => {
            const fixedToken = "a".repeat(64); // 32 bytes, hex-encoded (64 chars)
            mockedSecureId.mockReturnValueOnce(fixedToken);

            const { token, hash } = generateAccessToken();

            expect(mockedSecureId).toHaveBeenCalledTimes(1);
            expect(mockedSecureId).toHaveBeenCalledWith(32, "hex");
            expect(token).toBe(fixedToken);

            const expected = crypto
                .createHash("sha256")
                .update(fixedToken)
                .digest("hex");
            expect(hash).toBe(expected);
        });
    });

    describe("extractBearerToken", () => {
        it("returns token for 'Bearer <token>' (case-insensitive)", () => {
            expect(extractBearerToken("Bearer abc123")).toBe("abc123");
            expect(extractBearerToken("bearer abc123")).toBe("abc123");
            expect(extractBearerToken("BEARER abc123")).toBe("abc123");
        });

        it("handles extra/leading/trailing spaces", () => {
            expect(extractBearerToken("Bearer    abc")).toBe("abc");
            expect(extractBearerToken("   BEARER abc   ")).toBe("abc");
        })

        it("returns null for undefined, non-Bearer schemes, or missing token", () => {
            expect(extractBearerToken(undefined)).toBeNull();
            expect(extractBearerToken("Basic xyz")).toBeNull();
            expect(extractBearerToken("Bearer")).toBeNull();
        });
    });

    describe("hashAccessToken", () => {
        it("hashes a known string with SHA-256", () => {
            // SHA-256("foo")
            expect(hashAccessToken("foo")).toBe(
                "2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae"
            );
        });

        it("hashes empty string correctly", () => {
            // SHA-256("")
            expect(hashAccessToken("")).toBe(
                "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
            );
        });

        it("hashes UTF-8 input correctly", () => {
            // SHA-256("päss") — UTF-8
            expect(hashAccessToken("päss")).toBe(
                "73c2e2fd2aec66e50135a01b2a007fcc23e4d35010637f98541e453a8665d25d"
            );
        });
    });

    describe("timingSafeEqHex", () => {
        it("returns true for same hex regardless of case", () => {
            expect(timingSafeEqHex("0aff", "0AFF")).toBe(true);
            expect(timingSafeEqHex("deadbeef", "DEADBEEF")).toBe(true);
        });

        it("returns false for different values of the same length", () => {
            expect(timingSafeEqHex("00", "01")).toBe(false);
            expect(timingSafeEqHex("abcd", "abce")).toBe(false);
        });

        it("returns false for different lengths", () => {
            expect(timingSafeEqHex("00", "0000")).toBe(false);
        });

        it("throws on invalid hex strings (Node Buffer hex parsing)", () => {
            expect(timingSafeEqHex("zz", "zz")).toBe(false); // invalid hex
            expect(timingSafeEqHex("f", "0f")).toBe(false); // odd-length hex is invalid
        });
    });
});
