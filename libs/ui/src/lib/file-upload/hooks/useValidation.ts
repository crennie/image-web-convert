'use client';

import { useCallback } from "react";
import { displayBytes, uiId } from "../../utils";
import { FileItem } from "../../files/FileListItem";
import { FileUploadConfig } from "../file-upload.config";
import { getFileExt } from "@image-web-convert/schemas";

// Helper functions
function fileDupKey(file: File): string {
    return `${file.name}:${file.size}:${file.lastModified}`;
}

// accept-matcher.ts
export type AcceptInput =
    | string                       // e.g. "image/*,.jpg,.png"
    | string[]                     // e.g. ["image/*", ".jpg", ".png"]
    | Set<string>
    | undefined
    | null;

type AcceptSpec = {
    mimeExact: Set<string>;    // "image/png"
    mimeWild: Set<string>;     // "image" from "image/*"
    exts: Set<string>;         // ".png"
};

const toArray = (a: AcceptInput): string[] => typeof a === "string" ? a.split(",") :
    Array.isArray(a) ? a : a instanceof Set ? Array.from(a) : [];

export function makeAcceptSpec(accept: AcceptInput): AcceptSpec | ((file: File) => boolean) | null {
    if (!accept) return null;
    if (typeof accept === "function") return accept;

    const spec: AcceptSpec = { mimeExact: new Set(), mimeWild: new Set(), exts: new Set() };

    for (const raw of toArray(accept)) {
        const token = raw.trim().toLowerCase();
        if (!token) continue;

        if (token.includes("/")) {
            // MIME or wildcard like "image/*"
            const [type, subtype] = token.split("/");
            if (!type || !subtype) continue;
            if (subtype === "*") spec.mimeWild.add(type);
            else spec.mimeExact.add(`${type}/${subtype}`);
        } else {
            // Extension like ".jpg" or "jpg"
            spec.exts.add(token.startsWith(".") ? token : `.${token}`);
        }
    }
    return spec;
}

/** Main check: prefer MIME, fall back to extension */
export function matchesAccept(file: File, accept: AcceptInput): boolean {
    if (!accept) return true;

    const spec = makeAcceptSpec(accept) as AcceptSpec | null;
    if (!spec) return true;

    const mime = (file.type || "").toLowerCase();
    const ext = getFileExt(file.name);

    if (mime) {
        if (spec.mimeExact.has(mime)) return true;
        const major = mime.split("/")[0];
        if (spec.mimeWild.has(major)) return true;
    }

    if (ext && spec.exts.has(ext)) return true;

    return false;
}


// Once file has passed the synchronous checks, turn it into an upload item
function processFile(file: File): FileItem {
    const id = uiId();
    const previewUrl = URL.createObjectURL(file);
    return {
        id,
        file: file,
        previewUrl,
    };
}

interface ValidateFilesProps {
    incoming: File[];
    existing: FileItem[];
    config?: FileUploadConfig;
}

export interface ValidateFilesRejected {
    file: File;
    reason: string;
}

interface ValidateFilesReturn {
    accepted: FileItem[];
    rejected: ValidateFilesRejected[];
}

export function useValidation() {

    const validateFiles = useCallback(({ incoming, existing, config = {} }: ValidateFilesProps): ValidateFilesReturn => {
        const {
            accept,
            sessionImageConfig: {
                maxFiles = Infinity,
                maxBytesPerFile = Infinity,
                maxTotalBytes = Infinity,
            } = {}
        } = config;

        const rejected: ValidateFilesRejected[] = [];
        const accepted: FileItem[] = [];

        // Get current files state
        // Build duplicate lookup for existing items
        const currentFilesLookup = new Set(existing.map(item => fileDupKey(item.file)));
        const currentCount = existing.length;
        const currentTotalBytes = existing.reduce((sum, item) => sum + item.file.size, 0);

        // Remaining slots by count
        let remainingSlots = Math.max(0, maxFiles - currentCount);
        let runningAddedBytes = 0;
        ;
        for (const file of incoming) {
            // Check that remaining files are allowed
            if (remainingSlots <= 0) {
                const reason = `You can add up to ${maxFiles} file${maxFiles === 1 ? '' : 's'}.`;
                rejected.push({ file, reason });
                continue;
            }

            // Check for duplicates
            const key = fileDupKey(file);
            if (currentFilesLookup.has(key)) {
                const reason = `Duplicate of a file already added.`;
                rejected.push({ file, reason });
                continue;
            }
            
            // Type / extension acceptance
            if (accept && !matchesAccept(file, accept)) {
                const reason = 'Unsupported file type.'
                rejected.push({ file, reason });
                continue
            }

            // Per-file size
            if (file.size > maxBytesPerFile) {
                const reason = `Exceeds per-file size limit (${displayBytes(maxBytesPerFile)}).`;
                rejected.push({ file, reason });
                continue;
            }

            // Total size (current + accepted in this call + this file)
            if (currentTotalBytes + runningAddedBytes + file.size > maxTotalBytes) {
                const reason = `Adding this file would exceed the total size limit (${displayBytes(maxTotalBytes)}).`;
                rejected.push({ file, reason });
                continue;
            }

            // Checks passed - add processed file 
            const item = processFile(file);
            accepted.push(item);
            remainingSlots -= 1;
            runningAddedBytes += file.size;
            currentFilesLookup.add(key);
        }

        return {
            accepted,
            rejected,
        }
    }, []);

    return { validateFiles };
}

export default useValidation;
