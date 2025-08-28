import { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./utils";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    children: ReactNode;
    variant?: 'primary' | 'secondary' | 'ghost';
}
export function Button({ children, ...props }: ButtonProps) {
    // TODO: Add button variants
    return (
        <button
            type="button"
            {...props}
            // TODO: Any default arias to add?
            aria-disabled={props.disabled}
            className={cn(
                props.variant === 'primary' ? ' py-3 px-8 bg-primary text-primary-foreground' : null,
                props.variant === 'secondary' ? ' py-3 px-8 bg-secondary text-secondary-foreground' : null,
                "text-lg rounded-full decoration-0 cursor-pointer",
                "disabled:opacity-70 disabled:cursor-not-allowed",
                props.className)}
        >
            {children}
        </button>
    );
}

export default Button;
