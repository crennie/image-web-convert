
// TODO: Store defaults for settings
// sync with backend .envs, or have some way to dynamically read settings?

import { ALLOWED_IMAGE_EXT, SESSION_IMAGE_CONFIG } from "@image-web-convert/schemas";
import { displayBytes, displayMinutes } from "@image-web-convert/ui";

export type UiSettingsDisplay = {
    uploadedFileLifespan: string;
    supportedExtensions: readonly string[];
    maxFileSize: string;
    maxTotalSize: string;
}

// 60 minutes
export const UPLOADED_FILE_LIFESPAN_MS = 60 * 60 * 1000;

export const UI_SETTINGS_DISPLAY: UiSettingsDisplay = {
    uploadedFileLifespan: displayMinutes(UPLOADED_FILE_LIFESPAN_MS),
    supportedExtensions: ALLOWED_IMAGE_EXT,
    maxFileSize: displayBytes(SESSION_IMAGE_CONFIG.maxBytesPerFile),
    maxTotalSize: displayBytes(SESSION_IMAGE_CONFIG.maxTotalBytes),
};
