'use client';

import { useCallback } from "react";
import { FileUploadConfig } from "../FileUpload";
import { displayBytes, uiId } from "../../utils";
import { FileItem } from "../../files/FileListItem";


// Helper functions
function fileDupKey(file: File): string {
    return `${file.name}:${file.size}:${file.lastModified}`;
}
// function fileExtension(name: string): string | null {
//     const i = name.lastIndexOf('.');
//     if (i < 0 || i === name.length - 1) return null;
//     return name.slice(i).toLowerCase(); // includes the dot, e.g. ".png"
// }

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
            // accept = "image/*",
            maxCount = Infinity,
            maxPerFileSizeBytes = Infinity,
            maxTotalBytes = Infinity,
        } = config;

        const rejected: ValidateFilesRejected[] = [];
        const accepted: FileItem[] = [];

        // Get current files state
        // Build duplicate lookup for existing items
        const currentFilesLookup = new Set(existing.map(item => fileDupKey(item.file)));
        const currentCount = existing.length;
        const currentTotalBytes = existing.reduce((sum, item) => sum + item.file.size, 0);

        // Remaining slots by count
        let remainingSlots = Math.max(0, maxCount - currentCount);
        let runningAddedBytes = 0;

        // Normalize accept list once
        // TODO: Is accept list in the <input> ? Need to validate it again, or?
        //const acceptList = normalizeAcceptList(accept);

        for (const file of incoming) {
            // Check that remaining files are allowed
            if (remainingSlots <= 0) {
                const reason = `You can add up to ${maxCount} file${maxCount === 1 ? '' : 's'}.`;
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

            // TODO: 
            // Type / extension acceptance
            // if (!matchesAccept(file, acceptList)) {
            //     reasons.push('Unsupported file type.');
            // }
            //

            // Per-file size
            if (file.size > maxPerFileSizeBytes) {
                const reason = `Exceeds per-file size limit (${displayBytes(maxPerFileSizeBytes)}).`;
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
