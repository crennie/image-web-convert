import { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../utils';

interface FileCardLayoutProps extends HTMLAttributes<HTMLDivElement> {
    children: ReactNode;
}

export function FileCardLayout({ children, ...props }: FileCardLayoutProps) {
    return (
        <div
            {...props}
            className={cn(
                'relative flex items-center justify-center w-55 aspect-square bg-surface shadow-sm border border-border rounded-2xl overflow-hidden',
                props.className,
            )}
        >
            {children}
        </div>
    );
}

export default FileCardLayout;
