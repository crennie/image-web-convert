import { ReactNode } from 'react';
import { cn } from './utils';

interface PageLayoutProps {
    children: ReactNode;
    className?: string;
}

export function PageLayout({ children, className }: PageLayoutProps) {
    return (
        <main
            className={cn(
                'mx-auto w-full max-w-7xl min-h-[50vh] px-4 sm:px-8 pb-16',
                className,
            )}
        >
            {children}
        </main>
    );
}

export default PageLayout;
