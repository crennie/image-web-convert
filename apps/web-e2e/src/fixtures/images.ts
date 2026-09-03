export type ImageFixture = {
    name: string;
    mimeType: string;
    buffer: Buffer;
};

const onePixelPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
);

export const firstImage: ImageFixture = {
    name: 'first-image.png',
    mimeType: 'image/png',
    buffer: onePixelPng,
};

export const secondImage: ImageFixture = {
    name: 'second-image.png',
    mimeType: 'image/png',
    buffer: onePixelPng,
};
