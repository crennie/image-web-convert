import { ReactNode } from "react";
import { cn } from "./utils";

interface PageLayoutProps {
    children: ReactNode;
    className?: string;
}

export function PageLayout({ children, className }: PageLayoutProps) {
    return (
        <main className={cn("min-[100vh] px-6 sm:px-12 pb-12", className)}>
            {children}
        </main>
    )
}

export default PageLayout;
