import { Link } from "react-router";
import { AnchorHTMLAttributes, ReactNode } from "react";
import { cn } from "./utils";

type NavButtonProps = Required<Pick<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>> & AnchorHTMLAttributes<HTMLAnchorElement> & {
    children: ReactNode;
    variant?: 'primary' | 'secondary';
}

export function NavButton({ children, ...props }: NavButtonProps) {
    // TODO: Add button variants
    // TODO: Add some way to share CSS/styling between this and regular button?
    return (
        <Link
            to={props.href}
            {...props}
            className={cn(
                props.variant === 'primary' ? 'bg-primary text-primary-foreground' : null,
                props.variant === 'secondary' ? 'bg-secondary text-secondary-foreground' : null,
                "text-lg py-3 px-8 rounded-full decoration-0 cursor-pointer",
                "",
                props.className)}
        >
            {children}
        </Link>
    );
}

export default NavButton;
