import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { Session } from './session/SessionContext';

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

// Generate a quick, unique ID to for UI items - THIS IS NOT cryptographically secure
export function uiId(): string {
    return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Display approximate bytes as human readable string
export function displayBytes(numBytes: number): string {
    if (!isFinite(numBytes)) return '∞';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let n = numBytes;
    while (n >= 1024 && i < units.length - 1) {
        n /= 1024; i++;
    }
    return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function getAuthHeaders(session: Session) {
    return { Authorization: `Bearer ${session.token}` };
}
