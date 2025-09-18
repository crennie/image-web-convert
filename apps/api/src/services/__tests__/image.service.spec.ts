import sharp from "sharp";
import { fileTypeFromFile } from "file-type";
import { readFile } from "node:fs/promises";
import heicConvert from "heic-convert";
import { processImageToWebp } from "../image.service";

// ---- Module mocks ----
vi.mock("sharp", () => {
    const sharpMock = vi.fn();
    return { default: sharpMock };
});

vi.mock("file-type", () => ({
    fileTypeFromFile: vi.fn(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:fs/promises")>();
    // Provide BOTH shapes, wired to the SAME spy
    const readFileSpy = vi.fn();
    return {
        ...actual,
        readFile: readFileSpy,
        default: {
            ...actual,
            readFile: readFileSpy,
        },
    };
});

vi.mock("heic-convert", () => ({
    default: vi.fn(),
}));

// Your config + schemas — provide deterministic defaults for tests
vi.mock("../image.config", () => ({
    DEFAULT_IMG_OPTS: {
        limitInputPixels: 268435456, // 16K x 16K
        maxDimension: 4096,
        quality: 80,
        effort: 4,
        normalizeColorSpace: "srgb",
        animatedPolicy: "reject",
    },
}));

vi.mock("@image-web-convert/schemas", () => ({
    ALLOWED_IMAGE_MIME: new Set(["image/png", "image/jpeg", "image/heic", "image/heif", "image/gif"]),
}));

const mockedSharp = vi.mocked(sharp);
const mockedFT = vi.mocked(fileTypeFromFile);
const mockedReadFile = vi.mocked(readFile);
const mockedHeicConvert = vi.mocked(heicConvert);

// ---- helpers to build chainable sharp mocks ----
function makeSharpChain() {

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {};
    chain.rotate = vi.fn(() => chain);
    chain.toColourspace = vi.fn(() => chain);
    chain.resize = vi.fn(() => chain);
    chain.webp = vi.fn(() => chain);
    chain.metadata = vi.fn();
    chain.toBuffer = vi.fn();
    return chain;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setupSharp(meta: any, bufferResult: { data: Buffer; info: { width: number; height: number } }) {
    const metaChain = makeSharpChain();
    metaChain.metadata.mockResolvedValue(meta);

    const pipeChain = makeSharpChain();
    pipeChain.toBuffer.mockResolvedValue(bufferResult);

    mockedSharp
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
        .mockImplementationOnce((_src: any, _opts: any) => metaChain) // baseSharp for metadata
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
        .mockImplementationOnce((_src: any, _opts: any) => pipeChain); // pipeline

    return { metaChain, pipeChain };
}

describe("processImageToWebp (unit)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("throws for unsupported or unrecognized image type (no file-type result)", async () => {
        mockedFT.mockResolvedValueOnce(undefined);

        await expect(
            processImageToWebp({ inputPath: "/tmp/unknown.bin" })
        ).rejects.toThrow(/Unsupported or unrecognized image type/);

        expect(mockedSharp).not.toHaveBeenCalled();
    });

    it("throws for recognized but disallowed mime", async () => {
        mockedFT.mockResolvedValueOnce({ mime: "image/bmp", ext: '.bmp' }); // not in allowed Set

        await expect(
            processImageToWebp({ inputPath: "/tmp/foo.bmp" })
        ).rejects.toThrow(/Unsupported or unrecognized image type: image\/bmp/);

        expect(mockedSharp).not.toHaveBeenCalled();
    });

    it("HEIC: converts via heic-convert, then processes with sharp; returns expected shape", async () => {
        const inputPath = "./unit_test.heic";
        const sniff = { mime: "image/heic", ext: '.heic' };
        const heicBuffer = Buffer.from([1, 2, 3, 4]);
        const converted = Buffer.from("jpegdata"); // heic-convert result consumed by sharp
        mockedFT.mockResolvedValueOnce(sniff);
        mockedReadFile.mockResolvedValueOnce(heicBuffer);
        mockedHeicConvert.mockResolvedValueOnce(converted);

        const meta = { width: 500, height: 300, hasAlpha: false, pages: 1 };
        const out = { data: Buffer.from([9, 9, 9]), info: { width: 400, height: 240 } };
        const { metaChain, pipeChain } = setupSharp(meta, out);

        const result = await processImageToWebp({ inputPath });

        // file-type + heic path
        expect(mockedFT).toHaveBeenCalledWith(inputPath);
        expect(mockedReadFile).toHaveBeenCalledWith(inputPath);
        expect(mockedHeicConvert).toHaveBeenCalledWith(
            expect.objectContaining({ format: "JPEG", quality: 0.9 })
        );

        // sharp was called twice, both with the converted buffer
        expect(mockedSharp).toHaveBeenNthCalledWith(
            1,
            converted,
            expect.objectContaining({ animated: false, failOn: "error", limitInputPixels: 268435456 })
        );
        expect(mockedSharp).toHaveBeenNthCalledWith(
            2,
            converted,
            expect.objectContaining({ animated: false, limitInputPixels: 268435456 })
        );

        // pipeline calls
        expect(metaChain.metadata).toHaveBeenCalledTimes(1);
        expect(pipeChain.rotate).toHaveBeenCalledTimes(1);
        expect(pipeChain.toColourspace).toHaveBeenCalledWith("srgb");
        // default maxDimension=4096 -> resize called
        expect(pipeChain.resize).toHaveBeenCalledWith({
            width: 4096,
            height: 4096,
            fit: "inside",
            withoutEnlargement: true,
            fastShrinkOnLoad: true,
        });
        expect(pipeChain.webp).toHaveBeenCalledWith({ quality: 80, effort: 4 });
        expect(pipeChain.toBuffer).toHaveBeenCalledWith({ resolveWithObject: true });

        // return shape
        expect(result.outputMime).toBe("image/webp");
        expect(result.buffer).toEqual(out.data);
        expect(result.info).toEqual({
            width: 400,
            height: 240,
            sizeBytes: out.data.byteLength,
            colorSpace: "srgb",
            animated: false,
            exifStripped: true,
        });
        expect(result.inputMeta).toEqual({
            mime: "image/heic",
            width: 500,
            height: 300,
            hasAlpha: false,
            pages: 1,
        });
    });

    it("HEIC: if convert throws, continues with original inputPath", async () => {
        const inputPath = "./unit_test.heic";
        mockedFT.mockResolvedValueOnce({ mime: "image/heic", ext: '.heic' });
        mockedReadFile.mockResolvedValueOnce(Buffer.from([7, 7, 7]));
        mockedHeicConvert.mockRejectedValueOnce(new Error("convert fail"));

        const meta = { width: 100, height: 50, hasAlpha: true, pages: 1 };
        const out = { data: Buffer.from([1, 2]), info: { width: 90, height: 45 } };
        setupSharp(meta, out);

        const result = await processImageToWebp({ inputPath });

        // sharp was called with the original path both times
        expect(mockedSharp).toHaveBeenNthCalledWith(
            1,
            inputPath,
            expect.objectContaining({ animated: false, failOn: "error" })
        );
        expect(mockedSharp).toHaveBeenNthCalledWith(
            2,
            inputPath,
            expect.objectContaining({ animated: false })
        );

        expect(result.info.width).toBe(90);
        expect(result.inputMeta.mime).toBe("image/heic");
    });

    it("PNG (non-HEIC): does not call heic-convert and processes straight through", async () => {
        const inputPath = "/tmp/a.png";
        mockedFT.mockResolvedValueOnce({ mime: "image/png", ext: '.png' });

        const meta = { width: 800, height: 600, hasAlpha: true, pages: 1 };
        const out = { data: Buffer.from([3, 3, 3, 3]), info: { width: 800, height: 600 } };
        setupSharp(meta, out);

        const result = await processImageToWebp({ inputPath });

        expect(mockedHeicConvert).not.toHaveBeenCalled();
        expect(mockedReadFile).not.toHaveBeenCalled();
        expect(mockedSharp).toHaveBeenCalledTimes(2);
        expect(result.inputMeta.mime).toBe("image/png");
    });

    it("rejects animated inputs when animatedPolicy='reject'", async () => {
        mockedFT.mockResolvedValueOnce({ mime: "image/png", ext: '.png' });

        const meta = { width: 10, height: 10, hasAlpha: false, pages: 2 }; // animated
        const out = { data: Buffer.from([1]), info: { width: 10, height: 10 } };
        setupSharp(meta, out);

        await expect(
            processImageToWebp({ inputPath: "/tmp/anim.gif" })
        ).rejects.toThrow(/Animated images are not supported/);

        // should have only created baseSharp for metadata; pipeline never runs
        expect(mockedSharp).toHaveBeenCalledTimes(1);
    });

    it("honors maxDimension=0 (no resize call)", async () => {
        mockedFT.mockResolvedValueOnce({ mime: "image/jpeg", ext: '.jpg' });

        const meta = { width: 1200, height: 800, hasAlpha: false, pages: 1 };
        const out = { data: Buffer.from([5, 5, 5]), info: { width: 1200, height: 800 } };
        const { pipeChain } = setupSharp(meta, out);

        const result = await processImageToWebp({
            inputPath: "/tmp/pic.jpg",
            options: { maxDimension: 0 },
        });

        expect(pipeChain.resize).not.toHaveBeenCalled();
        expect(result.info.width).toBe(1200);
        expect(result.info.height).toBe(800);
    });

    it("applies quality/effort/limitInputPixels/colourspace from config & overrides", async () => {
        mockedFT.mockResolvedValueOnce({ mime: "image/png", ext: '.png' });

        const meta = { width: 2000, height: 1500, hasAlpha: false, pages: 1 };
        const out = { data: Buffer.from([8, 8]), info: { width: 1024, height: 768 } };
        const { pipeChain } = setupSharp(meta, out);

        await processImageToWebp({
            inputPath: "/tmp/p.png",
            options: { maxDimension: 1024, quality: 95, effort: 6, normalizeColorSpace: "srgb" },
        });

        expect(pipeChain.toColourspace).toHaveBeenCalledWith("srgb");
        expect(pipeChain.resize).toHaveBeenCalledWith(
            expect.objectContaining({ width: 1024, height: 1024 })
        );
        expect(pipeChain.webp).toHaveBeenCalledWith({ quality: 95, effort: 6 });
    });
});
