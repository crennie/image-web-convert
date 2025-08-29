'use client';

import { useCallback } from "react";

function getFilenameFromContentDisposition(cd: string): string | null {
    // Try RFC 5987 filename* first
    const star = /filename\*\s*=\s*[^']*''([^;]+)/i.exec(cd);
    if (star && star[1]) {
        try { return decodeURIComponent(star[1]); } catch {
            // TODO: Handle error?
        }
    }
    // Then plain filename="..."
    const quoted = /filename\s*=\s*"([^"]+)"/i.exec(cd);
    if (quoted && quoted[1]) return quoted[1];
    // Then unquoted
    const bare = /filename\s*=\s*([^;]+)/i.exec(cd);
    if (bare && bare[1]) return bare[1].trim();
    return null;
}

export function useFileDownloads() {
    const downloadFiles = useCallback(async (fileIds: string[], archiveName: string) => {

        // TODO: Add extra validation logic here?

        const response = await fetch('http://localhost:3000/api/files/download', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ ids: fileIds }),
        });

        // If the server returned JSON (error), surface it nicely
        const ct = response.headers.get('content-type') || '';
        if (!response.ok) {
            if (ct.includes('application/json')) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err?.message || `Download failed (${response.status})`);
            }
            throw new Error(`Download failed (${response.status})`);
        }

        // Expect a zip stream
        const blob = await response.blob();

        // Derive filename from Content-Disposition if present; else use fallback
        const cd = response.headers.get('content-disposition') || '';
        const filename = getFilenameFromContentDisposition(cd) || archiveName || 'images.zip';

        // Trigger browser download
        const url = URL.createObjectURL(blob);
        try {
            const a = document.createElement('a');
            a.href = url;
            a.download = filename; // respected by most browsers
            document.body.appendChild(a);
            a.click();
            a.remove();
        } finally {
            URL.revokeObjectURL(url);
        }
    }, []);

    return {
        downloadFiles,
    }
}

export default useFileDownloads;
