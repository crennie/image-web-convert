import { cn } from './utils';
import NavButton from './NavButton';

interface NavProps {
    className?: string;
}
export function Nav({ className }: NavProps) {
    return (
        <nav
            className={cn(
                'navbar-background',
                'fixed top-0 z-50 w-full border-b border-border',
                'px-6 flex justify-between items-center',
                className,
            )}
        >
            <NavButton
                aria-label="Home"
                href="/"
                variant="ghost"
                className="flex items-center gap-3 cursor-pointer"
            >
                <img
                    className="h-10 w-10 shrink-0 object-contain"
                    src="/logo.svg"
                    width={40}
                    height={40}
                    alt="Site logo"
                ></img>
                <span className="text-base sm:text-lg font-semibold tracking-tight">
                    Image Web Converter
                </span>
            </NavButton>
        </nav>
    );
}

export default Nav;
