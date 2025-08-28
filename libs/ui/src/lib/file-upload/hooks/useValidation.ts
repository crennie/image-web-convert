import { useCallback } from "react";
import { FileUploadConfig, FileUploadItem } from "../FileUpload";


// Helper functions
function fileDupKey(file: File): string {
    return `${file.name}:${file.size}:${file.lastModified}`;
}
// function fileExtension(name: string): string | null {
//     const i = name.lastIndexOf('.');
//     if (i < 0 || i === name.length - 1) return null;
//     return name.slice(i).toLowerCase(); // includes the dot, e.g. ".png"
// }

function formatBytes(n: number): string {
    if (!isFinite(n)) return '∞';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0, v = n;
    while (v >= 1024 && i < units.length - 1) {
        v /= 1024; i++;
    }
    return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function safeUuid(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
    // Fallback
    return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Once file has passed the synchronous checks, turn it into an upload item
function processFile(file: File): FileUploadItem {
    const id = safeUuid();
    const previewUrl = URL.createObjectURL(file);
    return {
        id,
        file: file,
        previewUrl,
        status: 'ready',
    };
}

interface ValidateFilesProps {
    incoming: File[];
    existing: FileUploadItem[];
    config?: FileUploadConfig;
}

export type ValidateFilesRejected = {
    file: File;
    reason: string;
}

interface ValidateFilesReturn {
    accepted: FileUploadItem[];
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
        const accepted: FileUploadItem[] = [];

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
                const reason = `Exceeds per-file size limit (${formatBytes(maxPerFileSizeBytes)}).`;
                rejected.push({ file, reason });
                continue;
            }

            // Total size (current + accepted in this call + this file)
            if (currentTotalBytes + runningAddedBytes + file.size > maxTotalBytes) {
                const reason = `Adding this file would exceed the total size limit (${formatBytes(maxTotalBytes)}).`;
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
