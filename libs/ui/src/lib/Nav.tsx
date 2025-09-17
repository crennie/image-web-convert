import { cn } from "./utils";
import NavButton from "./NavButton";

interface NavProps {
    className?: string;
}
export function Nav({ className }: NavProps) {
    return (
        <nav className={cn(
            "navbar-background",
            "fixed top-0 w-full bg-background border-b border-primary",
            "px-6 flex justify-between items-center",
            className
        )}>
            <NavButton aria-label="Home" href="/" variant="ghost" className="flex items-center gap-4 cursor-pointer">
                <img className="h-auto max-h-[65px]" src="web_convert_logo.png" alt="Site logo"></img>
                <span className="text-xl">Image Web Converter</span>
            </NavButton>
        </nav>
    );
}

export default Nav;
