import { Link } from "react-router";
import { AnchorHTMLAttributes, forwardRef, ReactNode } from "react";
import { ButtonProps, getButtonStyles } from "./Button";

type NavButtonProps = Required<Pick<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>> & AnchorHTMLAttributes<HTMLAnchorElement> & {
    children: ReactNode;
    variant?: ButtonProps['variant'];
}

export const NavButton = forwardRef<HTMLAnchorElement, NavButtonProps>(function NavButton(
    { children, variant, className, href, ...props }: NavButtonProps, ref
) {
    return (
        <Link
            ref={ref}
            to={href}
            className={getButtonStyles({ variant, className })}
            {...props}
        >
            {children}
        </Link>
    );
});

export default NavButton;
