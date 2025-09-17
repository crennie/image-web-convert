import React from 'react';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import Button from './Button';

describe('Button', () => {
    it('renders children and defaults type="button"', () => {
        render(<Button>Click me</Button>);
        const btn = screen.getByRole('button', { name: /click me/i });
        expect(btn).toBeInTheDocument();
        expect(btn).toHaveAttribute('type', 'button'); // default
    });

    it('applies primary variant classes', () => {
        render(<Button variant="primary">Primary</Button>);
        const btn = screen.getByRole('button', { name: /primary/i });
        // spot-check a class that indicates primary
        expect(btn.className).toMatch(/bg-primary/);
        expect(btn.className).toMatch(/text-primary-foreground/);
    });

    it('applies secondary variant classes', () => {
        render(<Button variant="secondary">Secondary</Button>);
        const btn = screen.getByRole('button', { name: /secondary/i });
        expect(btn.className).toMatch(/bg-secondary/);
        expect(btn.className).toMatch(/text-secondary-foreground/);
    });

    it('applies ghost variant classes', () => {
        render(<Button variant="ghost">Ghost</Button>);
        const btn = screen.getByRole('button', { name: /ghost/i });
        expect(btn.className).toMatch(/bg-transparent/);
    });

    it('merges custom className', () => {
        render(<Button className="custom-class">Merge</Button>);
        const btn = screen.getByRole('button', { name: /merge/i });
        expect(btn.className).toMatch(/custom-class/);
    });

    it('respects disabled and sets aria-disabled', async () => {
        render(
            <Button disabled onClick={() => {
                // pass
            }}>
                Disabled
            </Button>
        );
        const btn = screen.getByRole('button', { name: /disabled/i });
        expect(btn).toBeDisabled();
        expect(btn).toHaveAttribute('aria-disabled', 'true');

        // onClick should not fire when disabled
        const handler = vi.fn();
        render(
            <Button disabled onClick={handler}>
                Still Disabled
            </Button>
        );
        await userEvent.click(screen.getByRole('button', { name: /still disabled/i }));
        expect(handler).not.toHaveBeenCalled();
    });

    it('fires onClick when enabled', async () => {
        const handler = vi.fn();
        render(<Button onClick={handler}>Go</Button>);
        await userEvent.click(screen.getByRole('button', { name: /go/i }));
        expect(handler).toHaveBeenCalledTimes(1);
    });

    it('allows overriding type (e.g., submit)', () => {
        render(<Button type="submit">Submit</Button>);
        expect(screen.getByRole('button', { name: /submit/i })).toHaveAttribute('type', 'submit');
    });

    it('does NOT render unknown DOM props like variant', () => {
        // variant is allowed as prop but should not reach the DOM
        render(<Button variant="primary">DOM</Button>);
        const btn = screen.getByRole('button', { name: /dom/i });
        // The DOM should not have a 'variant' attribute
        expect(btn).not.toHaveAttribute('variant');
    });

    it('exposes a ref to the underlying button (forwardRef)', () => {
        const ref = React.createRef<HTMLButtonElement>();
        render(<Button ref={ref}>Ref</Button>);
        expect(ref.current).toBeInstanceOf(HTMLButtonElement);
        expect(ref.current?.tagName).toBe('BUTTON');
    });
});