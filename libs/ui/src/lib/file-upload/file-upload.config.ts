import { INPUT_ACCEPT_ATTR, SessionImageConfig, SESSION_IMAGE_CONFIG, ALLOWED_OUTPUT_MIME_CONST, OutputMimeType, MIME_TO_EXT } from "@image-web-convert/schemas";

export type FileUploadConfig = {
    accept?: string | string[]; // e.g. "image/*,.png,.jpg" or ["image/*", ".png"]
    sessionImageConfig?: SessionImageConfig;
    outputMimeOptions: { value: OutputMimeType, display: string }[]; // Drives dropdown
}

export const FILE_UPLOAD_CONFIG: FileUploadConfig = {
    accept: INPUT_ACCEPT_ATTR,
    sessionImageConfig: SESSION_IMAGE_CONFIG,
    outputMimeOptions: ALLOWED_OUTPUT_MIME_CONST.map(mimeType => ({
        value: mimeType,
        display: MIME_TO_EXT[mimeType]?.[0] ?? '',
    }))
}
