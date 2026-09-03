'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export function useCosmeticProgress() {
    const [cosmeticPercent, setCosmeticPercent] = useState(0);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const cancelCosmeticProgress = useCallback(() => {
        if (intervalRef.current) clearInterval(intervalRef.current);
        intervalRef.current = null;
        setCosmeticPercent(0);
    }, []);

    const startCosmeticProgress = useCallback(() => {
        cancelCosmeticProgress();
        intervalRef.current = setInterval(() => {
            setCosmeticPercent((previous) => Math.min(previous + 10, 90));
        }, 400);
    }, [cancelCosmeticProgress]);

    const completeCosmeticProgress = useCallback(() => {
        if (intervalRef.current) clearInterval(intervalRef.current);
        intervalRef.current = null;
        setCosmeticPercent(100);
    }, []);

    useEffect(() => cancelCosmeticProgress, [cancelCosmeticProgress]);

    return {
        cosmeticPercent,
        startCosmeticProgress,
        completeCosmeticProgress,
        cancelCosmeticProgress,
    };
}

export default useCosmeticProgress;
