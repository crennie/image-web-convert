'use client';

import React, {
    createContext,
    useCallback,
    useContext,
    useMemo,
    useRef,
    useState,
} from 'react';
import { ApiCreateSessionResponseSchema } from '@image-web-convert/schemas';
import type { SessionImageConfig } from '@image-web-convert/schemas';
const VITE_API_URL = import.meta.env.VITE_API_URL;

export type Session = {
    sessionId: string;
    token: string;
    expiresAt: string;
    imageConfig: SessionImageConfig;
};

type SessionContextValue = {
    session: Session | null;
    startSession: () => Promise<Session>;
    clearSession: () => void;
};

const SessionContext = createContext<SessionContextValue | undefined>(
    undefined,
);

export function SessionProvider({ children }: { children: React.ReactNode }) {
    const [session, setSession] = useState<Session | null>(null);
    const startPromiseRef = useRef<Promise<Session> | null>(null);

    const startSession = useCallback(async (): Promise<Session> => {
        if (session && new Date(session.expiresAt).getTime() > Date.now())
            return session;
        if (startPromiseRef.current) return startPromiseRef.current;

        startPromiseRef.current = (async () => {
            try {
                const response = await fetch(`${VITE_API_URL}/sessions`, {
                    method: 'POST',
                });
                if (!response.ok) {
                    throw new Error(
                        `Failed to create session (${response.status})`,
                    );
                }

                const result = ApiCreateSessionResponseSchema.parse(
                    await response.json(),
                );
                const session = {
                    sessionId: result.sid,
                    token: result.token,
                    expiresAt: result.expiresAt,
                    imageConfig: result.imageConfig,
                };
                setSession(session);
                return session;
            } finally {
                startPromiseRef.current = null;
            }
        })();

        return startPromiseRef.current;
    }, [session]);

    const clearSession = useCallback(() => {
        setSession(null);
    }, []);

    const value = useMemo<SessionContextValue>(
        () => ({ session, startSession, clearSession }),
        [session, startSession, clearSession],
    );

    return (
        <SessionContext.Provider value={value}>
            {children}
        </SessionContext.Provider>
    );
}

export function useSession() {
    const ctx = useContext(SessionContext);
    if (!ctx) throw new Error('useSession must be used within SessionProvider');
    return ctx;
}
