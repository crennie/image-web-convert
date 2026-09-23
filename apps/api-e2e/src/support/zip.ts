import { inflateRawSync } from 'node:zlib';

// Decode the small non-ZIP64 archives emitted for test fixtures. Reading the
// central directory handles streaming ZIP data descriptors without guessing sizes.
export function zipEntries(zip: Buffer): Map<string, Buffer> {
    const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (end < 0 || end + 22 > zip.length)
        throw new Error('Missing ZIP directory');
    const count = zip.readUInt16LE(end + 10);
    let offset = zip.readUInt32LE(end + 16);
    const entries = new Map<string, Buffer>();
    for (let i = 0; i < count; i++) {
        if (zip.readUInt32LE(offset) !== 0x02014b50)
            throw new Error('Invalid ZIP entry');
        const method = zip.readUInt16LE(offset + 10);
        const compressedSize = zip.readUInt32LE(offset + 20);
        const size = zip.readUInt32LE(offset + 24);
        const nameSize = zip.readUInt16LE(offset + 28);
        const extraSize = zip.readUInt16LE(offset + 30);
        const commentSize = zip.readUInt16LE(offset + 32);
        const local = zip.readUInt32LE(offset + 42);
        const name = zip
            .subarray(offset + 46, offset + 46 + nameSize)
            .toString('utf8');
        if (zip.readUInt32LE(local) !== 0x04034b50)
            throw new Error('Invalid local ZIP header');
        const start =
            local +
            30 +
            zip.readUInt16LE(local + 26) +
            zip.readUInt16LE(local + 28);
        const compressed = zip.subarray(start, start + compressedSize);
        if (method !== 0 && method !== 8)
            throw new Error('Unsupported fixture compression');
        const bytes = method === 0 ? compressed : inflateRawSync(compressed);
        if (bytes.length !== size || entries.has(name))
            throw new Error('Invalid ZIP contents');
        entries.set(name, bytes);
        offset += 46 + nameSize + extraSize + commentSize;
    }
    if (offset !== end) throw new Error('Unexpected ZIP directory contents');
    return entries;
}
