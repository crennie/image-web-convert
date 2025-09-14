'use client';

import { useCallback, useRef, useState } from "react";

export function useFileProgress() {
    const [progressComplete, setProgressComplete] = useState(false);
    const [progress, setProgress] = useState(0);
    const intervalRef = useRef<ReturnType<typeof setTimeout>>(null);
    const DEFAULT_PROGRESS_INCREMENT = 10;
    const startProgress = useCallback((minTimeSeconds = 5, progressIncrement = DEFAULT_PROGRESS_INCREMENT) => {
        const intervalTimeMs = Math.ceil(minTimeSeconds / (100 / progressIncrement)) * 1000;
        setProgressComplete(false);
        intervalRef.current = setInterval(() => {
            setProgress(prev => {
                if (intervalRef.current && prev >= 100) {
                    clearInterval(intervalRef.current);
                    setProgressComplete(true);
                    return prev;
                } else {
                    return prev + progressIncrement;
                }
            });
        }, intervalTimeMs);
    }, []);
    const cancelProgress = useCallback(() => {
        if (intervalRef.current) clearInterval(intervalRef.current);
        setProgress(0);
        setProgressComplete(false);
    }, []);

    return {
        progressComplete,
        progress,
        startProgress,
        cancelProgress,
    }
}

export default useFileProgress;
