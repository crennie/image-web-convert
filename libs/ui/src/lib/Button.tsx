import { ButtonHTMLAttributes, forwardRef, ReactNode } from 'react';
import { cn } from './utils';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    children: ReactNode;
    variant?: 'primary' | 'secondary' | 'ghost';
}

export function getButtonStyles({
    variant = 'primary',
    className = '',
}: {
    variant: ButtonProps['variant'];
    className?: string;
}) {
    return cn(
        variant === 'primary'
            ? ' py-3 px-8 bg-primary text-primary-foreground shadow-sm'
            : null,
        variant === 'secondary'
            ? ' py-3 px-8 bg-secondary text-secondary-foreground shadow-sm'
            : null,
        variant === 'ghost'
            ? 'bg-transparent text-foreground shadow-none'
            : null,
        'inline-flex min-h-11 items-center justify-center gap-2 text-base font-semibold leading-snug rounded-xl decoration-0 cursor-pointer border border-transparent motion-safe:transition-colors hover:brightness-95 disabled:hover:brightness-100',
        'disabled:opacity-70 disabled:cursor-not-allowed',
        className,
    );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
    function Button(
        {
            children,
            variant,
            className,
            disabled,
            type = 'button',
            ...props
        }: ButtonProps,
        ref,
    ) {
        return (
            <button
                ref={ref}
                type={type}
                disabled={disabled}
                aria-disabled={disabled || undefined}
                className={getButtonStyles({ variant, className })}
                {...props}
            >
                {children}
            </button>
        );
    },
);

export default Button;
