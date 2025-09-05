import { INPUT_ACCEPT_ATTR, SessionImageConfig, SESSION_IMAGE_CONFIG } from "@image-web-convert/schemas";

export type FileUploadConfig = {
    accept?: string | string[]; // e.g. "image/*,.png,.jpg" or ["image/*", ".png"]
    sessionImageConfig?: SessionImageConfig;
}

export const FILE_UPLOAD_CONFIG: FileUploadConfig = {
    accept: INPUT_ACCEPT_ATTR,
    sessionImageConfig: SESSION_IMAGE_CONFIG,
}
